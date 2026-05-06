"""
Веб (dist/) + API публичных профилей + Telegram-бот.

Переменные окружения см. DEPLOY.md и docstring в репозитории.
"""
from __future__ import annotations

import hashlib
import hmac
import io
import json
import logging
import os
import re
import threading
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlparse

from fastapi import FastAPI, File, Header, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field, field_validator, model_validator

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger(__name__)

try:
    _sentry_dsn = os.environ.get("SENTRY_DSN", "").strip()
    if _sentry_dsn:
        import sentry_sdk

        sentry_sdk.init(dsn=_sentry_dsn, traces_sample_rate=0.05)
except ImportError:
    pass

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
_RESERVED_SLUG_FILE = ROOT / "src" / "config" / "reserved-slugs.json"

_DATA_DIR = Path(os.environ.get("DATA_DIR", str(ROOT / "data"))).resolve()
_PROFILES_DIR = _DATA_DIR / "profiles"
_AVATARS_DIR = _DATA_DIR / "avatars"
_BACKGROUNDS_DIR = _DATA_DIR / "backgrounds"
_CLICKS_DIR = _DATA_DIR / "clicks"
_REPORTS_PATH = _DATA_DIR / "reports.log"

_SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

_DEFAULT_RESERVED = frozenset(
    {"edit", "health", "assets", "favicon.ico", "api", "docs", "static", "r", "catalog"},
)

_ALLOWED_THEMES = frozenset({"purple", "ocean", "sunset", "mono", "light"})
_ALLOWED_PLANS = frozenset({"free", "vip"})

_METRICS = {"http_requests": 0, "http_errors": 0}

_RATE_MEMORY: dict[str, list[float]] = {}
_redis_client: Any = None
_redis_checked = False


def _load_reserved_slugs() -> frozenset[str]:
    if not _RESERVED_SLUG_FILE.is_file():
        return _DEFAULT_RESERVED
    try:
        raw = json.loads(_RESERVED_SLUG_FILE.read_text(encoding="utf-8"))
        if isinstance(raw, list):
            return frozenset(str(x).strip().lower() for x in raw if str(x).strip())
    except (OSError, json.JSONDecodeError):
        pass
    return _DEFAULT_RESERVED


_RESERVED_SLUGS = _load_reserved_slugs()


def _get_redis():
    global _redis_client, _redis_checked
    if _redis_checked:
        return _redis_client
    _redis_checked = True
    url = os.environ.get("REDIS_URL", "").strip()
    if not url:
        _redis_client = None
        return None
    try:
        import redis

        r = redis.from_url(url, decode_responses=True)
        r.ping()
        _redis_client = r
        log.info("Redis подключён для rate limit")
        return r
    except Exception as e:
        log.warning("Redis недоступен (%s), лимиты в памяти процесса", e)
        _redis_client = None
        return None


def _rate_allow(bucket_key: str, limit: int, window_sec: float) -> bool:
    r = _get_redis()
    if r is not None:
        try:
            k = f"rl:{bucket_key}"
            n = int(r.incr(k))
            if n == 1:
                r.expire(k, max(1, int(window_sec)))
            return n <= limit
        except Exception:
            pass
    now = time.time()
    bucket = _RATE_MEMORY.setdefault(bucket_key, [])
    bucket[:] = [t for t in bucket if now - t < window_sec]
    if len(bucket) >= limit:
        return False
    bucket.append(now)
    return True


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip() or "unknown"
    if request.client:
        return request.client.host or "unknown"
    return "unknown"


def _magic_image_content_type(data: bytes) -> str | None:
    if len(data) < 12:
        return None
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if data[:4] == b"RIFF" and len(data) >= 12 and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def _magic_video_kind_and_ct(data: bytes) -> tuple[str, str] | None:
    if len(data) < 12:
        return None
    if data[:4] == b"\x1a\x45\xdf\xa3":
        return "video", "video/webm"
    if data[4:8] == b"ftyp":
        return "video", "video/mp4"
    if data[4:8] in (b"qt  ", b"moov", b"wide"):
        return "video", "video/quicktime"
    return None


def _validate_webapp_init_data(init_data: str | None, bot_token: str) -> int | None:
    if not init_data or not bot_token:
        return None
    try:
        try:
            pairs = parse_qsl(init_data, keep_blank_values=True, strict_parsing=False)
        except TypeError:
            pairs = parse_qsl(init_data, keep_blank_values=True)
    except (TypeError, ValueError):
        return None
    parsed: dict[str, str] = dict(pairs)
    recv_hash = parsed.pop("hash", None)
    if not recv_hash:
        return None
    data_check_string = "\n".join(f"{k}={parsed[k]}" for k in sorted(parsed.keys()))
    secret_key = hmac.new(
        b"WebAppData",
        bot_token.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    calc_hash = hmac.new(
        secret_key,
        data_check_string.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(calc_hash, recv_hash):
        return None
    user_raw = parsed.get("user")
    if not user_raw:
        return None
    try:
        user = json.loads(user_raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(user, dict):
        return None
    uid = user.get("id")
    if isinstance(uid, int):
        return uid
    if isinstance(uid, str) and uid.isdigit():
        return int(uid)
    return None


def _allow_insecure_edit() -> bool:
    raw = os.environ.get("ALLOW_INSECURE_EDIT", "").strip().lower()
    # По умолчанию разрешаем веб-редактор в браузере без Telegram Mini App.
    if raw == "":
        return True
    if raw in ("0", "false", "no"):
        return False
    return raw in ("1", "true", "yes")


def _require_write_telegram_user(x_telegram_init_data: str | None) -> int:
    if _allow_insecure_edit():
        return -1
    token = os.environ.get("BOT_TOKEN", "").strip()
    if not token:
        raise HTTPException(status_code=503, detail="bot_token_required_for_edits")
    uid = _validate_webapp_init_data(x_telegram_init_data, token)
    if uid is None:
        raise HTTPException(status_code=401, detail="telegram_auth_required")
    return uid


def _optional_telegram_user(x_telegram_init_data: str | None) -> int | None:
    if _allow_insecure_edit():
        return None
    token = os.environ.get("BOT_TOKEN", "").strip()
    if not token:
        return None
    return _validate_webapp_init_data(x_telegram_init_data, token)


def _ps_get_owner_id(slug: str) -> int | None:
    path = _ps_profile_path(slug)
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    o = data.get("ownerTelegramId")
    if isinstance(o, int):
        return o
    if isinstance(o, str) and o.lstrip("-").isdigit():
        return int(o)
    return None


def _authorize_profile_write(slug: str, user_id: int) -> None:
    if user_id < 0:
        return
    owner = _ps_get_owner_id(slug)
    if owner is None:
        return
    if owner != user_id:
        raise HTTPException(status_code=403, detail="forbidden")


def ps_ensure_dirs() -> None:
    _PROFILES_DIR.mkdir(parents=True, exist_ok=True)
    _AVATARS_DIR.mkdir(parents=True, exist_ok=True)
    _BACKGROUNDS_DIR.mkdir(parents=True, exist_ok=True)
    _CLICKS_DIR.mkdir(parents=True, exist_ok=True)
    _DATA_DIR.mkdir(parents=True, exist_ok=True)


def ps_is_valid_slug(slug: str) -> bool:
    s = slug.strip().lower()
    if len(s) < 2 or len(s) > 30:
        return False
    if s in _RESERVED_SLUGS:
        return False
    return bool(_SLUG_RE.fullmatch(s))


def _ps_profile_path(slug: str) -> Path:
    return _PROFILES_DIR / f"{slug.lower()}.json"


def _ps_avatar_data_path(slug: str) -> Path:
    return _AVATARS_DIR / f"{slug.lower()}.bin"


def _ps_avatar_meta_path(slug: str) -> Path:
    return _AVATARS_DIR / f"{slug.lower()}.json"


def _ps_background_data_path(slug: str) -> Path:
    return _BACKGROUNDS_DIR / f"{slug.lower()}.bin"


def _ps_background_meta_path(slug: str) -> Path:
    return _BACKGROUNDS_DIR / f"{slug.lower()}.json"


def _ps_clicks_path(slug: str) -> Path:
    return _CLICKS_DIR / f"{slug.lower()}.json"


def _read_profile_disk(slug: str) -> dict[str, Any] | None:
    path = _ps_profile_path(slug)
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def _blocked_domains_set() -> frozenset[str]:
    raw = os.environ.get("BLOCKED_LINK_DOMAINS", "").strip().lower()
    if not raw:
        return frozenset()
    return frozenset(x.strip() for x in raw.split(",") if x.strip())


def _url_blocked(url: str) -> tuple[bool, str | None]:
    u = url.strip()
    if not u.startswith(("http://", "https://")):
        return False, None
    try:
        pr = urlparse(u)
    except Exception:
        return True, "suspicious_url"
    host = (pr.hostname or "").lower()
    if host in _blocked_domains_set():
        return True, "blocked_domain"
    if pr.username or pr.password:
        return True, "suspicious_url"
    phishing_kw = ("login-", "secure-", "verify-", "account-", "wallet", "authorize")
    path_low = (pr.path or "").lower()
    if any(k in host for k in phishing_kw) or any(k in path_low for k in phishing_kw):
        return True, "suspicious_url"
    return False, None


def _parse_iso_dt(s: str) -> datetime | None:
    if not s or not str(s).strip():
        return None
    try:
        raw = str(s).strip().replace("Z", "+00:00")
        dt = datetime.fromisoformat(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except (ValueError, TypeError):
        return None


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _link_public_visible(link: dict[str, Any], now: datetime) -> bool:
    if link.get("hidden") is True:
        return False
    vf = _parse_iso_dt(str(link.get("visibleFrom") or ""))
    vu = _parse_iso_dt(str(link.get("visibleUntil") or ""))
    if vf is not None and now < vf:
        return False
    if vu is not None and now > vu:
        return False
    return True


def _filter_links_public(links: Any, now: datetime | None = None) -> list[dict[str, Any]]:
    if not isinstance(links, list):
        return []
    now = now or _now_utc()
    out: list[dict[str, Any]] = []
    for item in links:
        if not isinstance(item, dict):
            continue
        if _link_public_visible(item, now):
            out.append(item)
    return out


def _ps_load_click_counts(slug: str) -> dict[str, int]:
    path = _ps_clicks_path(slug)
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(data, dict):
        return {}
    raw = data.get("counts")
    if not isinstance(raw, dict):
        return {}
    out: dict[str, int] = {}
    for k, v in raw.items():
        kid = str(k)[:40]
        try:
            out[kid] = int(v)
        except (TypeError, ValueError):
            continue
    return out


def ps_increment_click(slug: str, link_id: str) -> None:
    if not ps_is_valid_slug(slug):
        return
    ps_ensure_dirs()
    kid = link_id.strip()[:40]
    if not kid:
        return
    path = _ps_clicks_path(slug)
    data: dict[str, Any] = {}
    if path.is_file():
        try:
            loaded = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                data = loaded
        except (OSError, json.JSONDecodeError):
            pass
    counts = data.get("counts")
    if not isinstance(counts, dict):
        counts = {}
    counts[kid] = int(counts.get(kid, 0)) + 1
    data["counts"] = counts
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def _ps_touch_profile_updated_at(slug: str) -> None:
    path = _ps_profile_path(slug)
    if not path.is_file():
        return
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return
    if not isinstance(data, dict):
        return
    data["updatedAt"] = datetime.now(timezone.utc).isoformat()
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _merge_runtime_public_fields(data: dict[str, Any], slug: str) -> dict[str, Any]:
    data.setdefault("slug", slug.lower())
    data.pop("ownerTelegramId", None)
    data.pop("hasAvatar", None)
    data["hasAvatar"] = _ps_avatar_data_path(slug).is_file()
    data.pop("hasBackground", None)
    data.pop("backgroundKind", None)
    bg_bin = _ps_background_data_path(slug)
    data["hasBackground"] = bg_bin.is_file()
    if data["hasBackground"]:
        kind: str | None = None
        meta_p = _ps_background_meta_path(slug)
        if meta_p.is_file():
            try:
                meta = json.loads(meta_p.read_text(encoding="utf-8"))
                if isinstance(meta, dict) and meta.get("kind") in ("image", "video"):
                    kind = str(meta["kind"])
            except (OSError, json.JSONDecodeError):
                pass
        data["backgroundKind"] = kind or "image"
    clicks = _ps_load_click_counts(slug)
    if clicks:
        data["linkClicks"] = clicks
    else:
        data.pop("linkClicks", None)
    return data


def ps_load_profile_raw(slug: str) -> dict[str, Any] | None:
    if not ps_is_valid_slug(slug):
        return None
    disk = _read_profile_disk(slug)
    if disk is None:
        return None
    return _merge_runtime_public_fields(dict(disk), slug)


def ps_load_profile_public(slug: str) -> dict[str, Any] | None:
    raw = ps_load_profile_raw(slug)
    if raw is None:
        return None
    data = dict(raw)
    links = data.get("links")
    data["links"] = _filter_links_public(links)
    return data


def _ps_sanitize_links(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for item in raw[:30]:
        if not isinstance(item, dict):
            continue
        hid = bool(item.get("hidden"))
        vf = str(item.get("visibleFrom") or "")[:40]
        vu = str(item.get("visibleUntil") or "")[:40]
        out.append(
            {
                "id": str(item.get("id", ""))[:40] or "link",
                "title": str(item.get("title", ""))[:60],
                "url": str(item.get("url", ""))[:2000],
                "hidden": hid,
                "visibleFrom": vf,
                "visibleUntil": vu,
            }
        )
    return out


def ps_save_profile_json(
    slug: str,
    payload: dict[str, Any],
    *,
    claim_owner_id: int | None = None,
) -> dict[str, Any]:
    ps_ensure_dirs()
    if not ps_is_valid_slug(slug):
        raise ValueError("invalid_slug")
    path = _ps_profile_path(slug)
    prev_owner: int | None = None
    if path.is_file():
        try:
            old = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(old, dict):
                o = old.get("ownerTelegramId")
                if isinstance(o, int):
                    prev_owner = o
                elif isinstance(o, str) and o.lstrip("-").isdigit():
                    prev_owner = int(o)
        except (OSError, json.JSONDecodeError):
            pass
    owner = prev_owner
    if claim_owner_id is not None and owner is None:
        owner = claim_owner_id
    now = datetime.now(timezone.utc).isoformat()
    theme_raw = str(payload.get("themeId") or payload.get("theme") or "purple").strip().lower()
    theme_id = theme_raw if theme_raw in _ALLOWED_THEMES else "purple"
    plan_raw = str(payload.get("plan") or "free").strip().lower()
    plan = plan_raw if plan_raw in _ALLOWED_PLANS else "free"
    bg_muted = bool(payload.get("backgroundMuted", True))
    out: dict[str, Any] = {
        "slug": slug.lower(),
        "displayName": str(payload.get("displayName", ""))[:80],
        "bio": str(payload.get("bio", ""))[:500],
        "links": _ps_sanitize_links(payload.get("links")),
        "themeId": theme_id,
        "backgroundMuted": bg_muted,
        "plan": plan,
        "updatedAt": now,
    }
    if owner is not None:
        out["ownerTelegramId"] = owner
    path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    loaded = ps_load_profile_public(slug)
    if loaded is None:
        raise RuntimeError("profile_load_after_write")
    return loaded


def ps_save_avatar(slug: str, data: bytes, content_type: str) -> None:
    if not ps_is_valid_slug(slug):
        raise ValueError("invalid_slug")
    if len(data) > 2_500_000:
        raise ValueError("too_large")
    magic_ct = _magic_image_content_type(data)
    if magic_ct is None:
        raise ValueError("not_image")
    ct = (content_type or "").split(";")[0].strip().lower()
    if ct.startswith("image/") and ct != magic_ct:
        log.info("avatar header vs magic: %s -> %s", ct, magic_ct)
    ps_ensure_dirs()
    _ps_avatar_data_path(slug).write_bytes(data)
    _ps_avatar_meta_path(slug).write_text(json.dumps({"contentType": magic_ct}), encoding="utf-8")


def ps_delete_avatar(slug: str) -> None:
    if not ps_is_valid_slug(slug):
        return
    for p in (_ps_avatar_data_path(slug), _ps_avatar_meta_path(slug)):
        try:
            p.unlink(missing_ok=True)
        except OSError:
            pass


def ps_save_background(slug: str, data: bytes, content_type: str) -> None:
    if not ps_is_valid_slug(slug):
        raise ValueError("invalid_slug")
    magic_img = _magic_image_content_type(data)
    magic_vid = _magic_video_kind_and_ct(data)
    if magic_img:
        kind, eff_ct = "image", magic_img
        max_len = 4_000_000
    elif magic_vid:
        kind, eff_ct = magic_vid[0], magic_vid[1]
        max_len = 14_000_000
    else:
        raise ValueError("unsupported_media")
    if len(data) > max_len:
        raise ValueError("too_large")
    header_kind = _ps_background_kind(content_type)
    if header_kind and header_kind != kind:
        log.info("background header kind %s vs magic %s", header_kind, kind)
    ps_ensure_dirs()
    _ps_background_data_path(slug).write_bytes(data)
    _ps_background_meta_path(slug).write_text(
        json.dumps({"contentType": eff_ct, "kind": kind}),
        encoding="utf-8",
    )


def _ps_background_kind(content_type: str) -> str | None:
    ct = (content_type or "").split(";")[0].strip().lower()
    if ct.startswith("image/"):
        return "image"
    if ct in ("video/mp4", "video/webm", "video/quicktime"):
        return "video"
    return None


def ps_delete_background(slug: str) -> None:
    if not ps_is_valid_slug(slug):
        return
    for p in (_ps_background_data_path(slug), _ps_background_meta_path(slug)):
        try:
            p.unlink(missing_ok=True)
        except OSError:
            pass


def ps_delete_profile_files(slug: str) -> None:
    if not ps_is_valid_slug(slug):
        return
    try:
        _ps_profile_path(slug).unlink(missing_ok=True)
    except OSError:
        pass
    ps_delete_avatar(slug)
    ps_delete_background(slug)
    try:
        _ps_clicks_path(slug).unlink(missing_ok=True)
    except OSError:
        pass


def ps_background_file_response(slug: str) -> FileResponse | None:
    if not ps_is_valid_slug(slug):
        return None
    data_p = _ps_background_data_path(slug)
    meta_p = _ps_background_meta_path(slug)
    if not data_p.is_file():
        return None
    media = "image/jpeg"
    if meta_p.is_file():
        try:
            meta = json.loads(meta_p.read_text(encoding="utf-8"))
            if isinstance(meta, dict) and meta.get("contentType"):
                media = str(meta["contentType"])
        except (OSError, json.JSONDecodeError):
            pass
    return FileResponse(data_p, media_type=media)


def ps_avatar_file_response(slug: str) -> FileResponse | None:
    if not ps_is_valid_slug(slug):
        return None
    data_p = _ps_avatar_data_path(slug)
    meta_p = _ps_avatar_meta_path(slug)
    if not data_p.is_file():
        return None
    media = "image/jpeg"
    if meta_p.is_file():
        try:
            meta = json.loads(meta_p.read_text(encoding="utf-8"))
            if isinstance(meta, dict) and meta.get("contentType"):
                media = str(meta["contentType"])
        except (OSError, json.JSONDecodeError):
            pass
    return FileResponse(data_p, media_type=media)


def _render_og_png(slug: str, title: str, subtitle: str) -> bytes | None:
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        return None
    w, h = 1200, 630
    img = Image.new("RGB", (w, h), color=(16, 17, 31))
    draw = ImageDraw.Draw(img)
    for i in range(h):
        t = i / h
        r = int(90 + (124 - 90) * t)
        g = int(50 + (58 - 50) * t)
        b = int(180 + (237 - 180) * t)
        draw.line([(0, i), (w, i)], fill=(r, g, b))
    margin = 72
    draw.rounded_rectangle(
        [margin, margin, w - margin, h - margin],
        radius=36,
        fill=(15, 16, 26),
        outline=(200, 200, 220),
        width=3,
    )
    try:
        font_title = ImageFont.truetype("DejaVuSans.ttf", 56)
        font_sub = ImageFont.truetype("DejaVuSans.ttf", 28)
    except OSError:
        font_title = ImageFont.load_default()
        font_sub = ImageFont.load_default()
    draw.text((margin + 48, margin + 56), title[:80], fill=(248, 250, 252), font=font_title)
    draw.text((margin + 48, margin + 160), subtitle[:160], fill=(226, 232, 240), font=font_sub)
    draw.text((margin + 48, h - margin - 52), f"/{slug}", fill=(196, 181, 253), font=font_sub)
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


class LinkIn(BaseModel):
    id: str = ""
    title: str = ""
    url: str = ""
    hidden: bool = False
    visibleFrom: str = ""
    visibleUntil: str = ""

    @field_validator("visibleFrom", "visibleUntil")
    @classmethod
    def strip_schedule(cls, v: str) -> str:
        return str(v or "").strip()[:40]


class ProfileIn(BaseModel):
    displayName: str = Field("", max_length=80)
    bio: str = Field("", max_length=500)
    links: list[LinkIn] = Field(default_factory=list)
    themeId: str = Field("purple", max_length=24)
    backgroundMuted: bool = True
    plan: str = Field("free", max_length=12)


class ClickIn(BaseModel):
    linkId: str = Field("", max_length=40)
    website: str = Field("", max_length=120)

    @model_validator(mode="after")
    def honeypot_empty(self):
        if self.website.strip():
            raise ValueError("honeypot")
        return self


class ReportIn(BaseModel):
    reason: str = Field("", max_length=2000)


def _index_response():
    index = DIST / "index.html"
    if not index.is_file():
        return JSONResponse(
            status_code=503,
            content={
                "detail": "Нет папки dist. Выполни npm run build и загрузи dist на сервер.",
            },
        )
    return FileResponse(index)


def _safe_file(path: Path) -> Path | None:
    try:
        path.resolve().relative_to(DIST.resolve())
    except ValueError:
        return None
    return path if path.is_file() else None


def _link_id_allowed_click(slug: str, link_id: str) -> bool:
    disk = _read_profile_disk(slug)
    if not disk:
        return False
    lid = link_id.strip()[:40]
    now = _now_utc()
    for item in disk.get("links") or []:
        if not isinstance(item, dict):
            continue
        if str(item.get("id", "")) != lid:
            continue
        return _link_public_visible(item, now)
    return False


def _click_referer_ok(request: Request, slug: str) -> bool:
    ref = request.headers.get("referer") or request.headers.get("Referer") or ""
    pub = os.environ.get("PUBLIC_URL", "").strip().rstrip("/")
    sl = slug.strip().lower()
    if ref and sl and f"/{sl}" in ref.replace("\\", "/"):
        return True
    if pub and ref.startswith(pub):
        return True
    origin = request.headers.get("origin") or ""
    if pub and origin.startswith(pub):
        return True
    return False


def _catalog_allowed() -> bool:
    return os.environ.get("PUBLIC_CATALOG", "").strip().lower() in ("1", "true", "yes")


@asynccontextmanager
async def lifespan(app: FastAPI):
    ps_ensure_dirs()
    token = os.environ.get("BOT_TOKEN", "").strip()
    use_webhook = os.environ.get("BOT_WEBHOOK", "").strip().lower() in ("1", "true", "yes")
    public = os.environ.get("PUBLIC_URL", "").strip().rstrip("/")
    wh_secret = os.environ.get("BOT_WEBHOOK_SECRET", "").strip()
    app.state.ptb_application = None

    if token and use_webhook and public and wh_secret:
        from telegram.ext import Application, CommandHandler

        from bot import start as bot_start_handler

        ptb_app = Application.builder().token(token).build()
        ptb_app.add_handler(CommandHandler("start", bot_start_handler))
        await ptb_app.initialize()
        await ptb_app.start()
        app.state.ptb_application = ptb_app
        hook_url = f"{public}/telegram/webhook/{wh_secret}"
        await ptb_app.bot.set_webhook(url=hook_url, allowed_updates=["message", "callback_query"])
        log.info("Telegram webhook зарегистрирован: %s", hook_url)
    elif token:
        from bot import run_bot

        t = threading.Thread(target=run_bot, name="telegram-bot", daemon=True)
        t.start()
        log.info("Бот polling в потоке")
    yield

    ptb = getattr(app.state, "ptb_application", None)
    if ptb is not None:
        try:
            await ptb.bot.delete_webhook(drop_pending_updates=True)
        except Exception:
            pass
        try:
            await ptb.stop()
            await ptb.shutdown()
        except Exception as e:
            log.warning("Остановка PTB: %s", e)


app = FastAPI(title="Taplink", lifespan=lifespan)


@app.middleware("http")
async def request_id_and_metrics(request: Request, call_next):
    rid = request.headers.get("x-request-id") or str(uuid.uuid4())
    request.state.request_id = rid
    _METRICS["http_requests"] += 1
    try:
        response = await call_next(request)
    except Exception:
        _METRICS["http_errors"] += 1
        raise
    response.headers["X-Request-ID"] = rid
    return response


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/metrics")
def metrics():
    lines = [
        "# HELP tap_http_requests_total HTTP requests seen",
        "# TYPE tap_http_requests_total counter",
        f"tap_http_requests_total {_METRICS['http_requests']}",
        "# HELP tap_http_errors_total Middleware caught errors",
        "# TYPE tap_http_errors_total counter",
        f"tap_http_errors_total {_METRICS['http_errors']}",
        "",
    ]
    return Response("\n".join(lines), media_type="text/plain; charset=utf-8; version=0.0.4")


@app.post("/telegram/webhook/{secret}")
async def telegram_webhook(secret: str, request: Request):
    expected = os.environ.get("BOT_WEBHOOK_SECRET", "").strip()
    if not expected or secret != expected:
        raise HTTPException(status_code=404, detail="not_found")
    ptb = getattr(request.app.state, "ptb_application", None)
    if ptb is None:
        raise HTTPException(status_code=503, detail="webhook_disabled")
    from telegram import Update

    body = await request.json()
    update = Update.de_json(body, ptb.bot)
    await ptb.process_update(update)
    return {"ok": True}


@app.get("/api/catalog")
def api_catalog():
    if not _catalog_allowed():
        raise HTTPException(status_code=404, detail="not_found")
    ps_ensure_dirs()
    out: list[dict[str, str]] = []
    for path in sorted(_PROFILES_DIR.glob("*.json")):
        try:
            slug = path.stem.lower()
            if not ps_is_valid_slug(slug):
                continue
            raw = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(raw, dict):
                continue
            out.append(
                {
                    "slug": slug,
                    "displayName": str(raw.get("displayName") or slug)[:80],
                }
            )
        except (OSError, json.JSONDecodeError):
            continue
    return {"profiles": out[:500]}


@app.get("/api/public/{slug}")
def api_get_public(slug: str):
    data = ps_load_profile_public(slug)
    if data is None:
        raise HTTPException(status_code=404, detail="not_found")
    return data


@app.get("/api/public/{slug}/editor")
def api_get_editor(
    slug: str,
    x_telegram_init_data: str | None = Header(default=None, alias="X-Telegram-Init-Data"),
):
    if not ps_is_valid_slug(slug):
        raise HTTPException(status_code=400, detail="invalid_slug")
    disk = _read_profile_disk(slug)
    if disk is None:
        raise HTTPException(status_code=404, detail="not_found")
    if _allow_insecure_edit():
        data = _merge_runtime_public_fields(dict(disk), slug)
        data["links"] = disk.get("links") if isinstance(disk.get("links"), list) else []
        return data
    user_id = _optional_telegram_user(x_telegram_init_data)
    if user_id is None:
        pub = ps_load_profile_public(slug)
        if pub is None:
            raise HTTPException(status_code=404, detail="not_found")
        return pub
    owner = _ps_get_owner_id(slug)
    if owner is not None and owner != user_id:
        raise HTTPException(status_code=403, detail="forbidden")
    data = _merge_runtime_public_fields(dict(disk), slug)
    data["links"] = disk.get("links") if isinstance(disk.get("links"), list) else []
    return data


@app.put("/api/public/{slug}")
def api_put_public(
    request: Request,
    slug: str,
    body: ProfileIn,
    x_telegram_init_data: str | None = Header(default=None, alias="X-Telegram-Init-Data"),
):
    if not ps_is_valid_slug(slug):
        raise HTTPException(status_code=400, detail="invalid_slug")
    ip = _client_ip(request)
    if not _rate_allow(f"put_profile:{ip}", 40, 60.0):
        raise HTTPException(status_code=429, detail="rate_limit")
    user_id = _require_write_telegram_user(x_telegram_init_data)
    path_exists = _ps_profile_path(slug).is_file()
    if path_exists:
        _authorize_profile_write(slug, user_id)
    for link in body.links:
        bad, reason = _url_blocked(link.url)
        if bad:
            raise HTTPException(status_code=400, detail=reason or "bad_url")
    plan_raw = body.plan.strip().lower()
    plan = plan_raw if plan_raw in _ALLOWED_PLANS else "free"
    if plan == "free" and len(body.links) > 8:
        raise HTTPException(status_code=402, detail="free_plan_links_limit")
    if plan == "free" and body.backgroundMuted is False:
        raise HTTPException(status_code=402, detail="vip_background_sound_required")
    claim = user_id if user_id >= 0 else None
    try:
        saved = ps_save_profile_json(
            slug,
            {
                "displayName": body.displayName,
                "bio": body.bio,
                "links": [link.model_dump() for link in body.links],
                "themeId": body.themeId,
                "backgroundMuted": body.backgroundMuted,
                "plan": plan,
            },
            claim_owner_id=claim,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return saved


@app.post("/api/public/{slug}/click")
def api_post_click(request: Request, slug: str, body: ClickIn):
    if not ps_is_valid_slug(slug):
        raise HTTPException(status_code=400, detail="invalid_slug")
    ip = _client_ip(request)
    if not _rate_allow(f"click:{ip}", 160, 60.0):
        raise HTTPException(status_code=429, detail="rate_limit")
    if not _rate_allow(f"click_slug:{slug}:{ip}", 60, 60.0):
        raise HTTPException(status_code=429, detail="rate_limit")
    if not _click_referer_ok(request, slug):
        raise HTTPException(status_code=400, detail="bad_referer")
    if ps_load_profile_public(slug) is None:
        raise HTTPException(status_code=404, detail="not_found")
    lid = body.linkId.strip()[:40]
    if not lid or not _link_id_allowed_click(slug, lid):
        raise HTTPException(status_code=400, detail="invalid_link")
    ps_increment_click(slug, lid)
    return {"ok": True}


@app.post("/api/public/{slug}/report")
def api_report(slug: str, body: ReportIn):
    if not ps_is_valid_slug(slug):
        raise HTTPException(status_code=400, detail="invalid_slug")
    if ps_load_profile_public(slug) is None:
        raise HTTPException(status_code=404, detail="not_found")
    ps_ensure_dirs()
    line = json.dumps(
        {
            "ts": datetime.now(timezone.utc).isoformat(),
            "slug": slug.lower(),
            "reason": body.reason.strip()[:2000],
        },
        ensure_ascii=False,
    )
    with open(_REPORTS_PATH, "a", encoding="utf-8") as f:
        f.write(line + "\n")
    return {"ok": True}


@app.get("/api/public/{slug}/export")
def api_export_json(
    slug: str,
    x_telegram_init_data: str | None = Header(default=None, alias="X-Telegram-Init-Data"),
):
    if not ps_is_valid_slug(slug):
        raise HTTPException(status_code=400, detail="invalid_slug")
    user_id = _require_write_telegram_user(x_telegram_init_data)
    disk = _read_profile_disk(slug)
    if disk is None:
        raise HTTPException(status_code=404, detail="not_found")
    _authorize_profile_write(slug, user_id)
    payload = dict(disk)
    payload.pop("ownerTelegramId", None)
    return JSONResponse(payload)


@app.delete("/api/public/{slug}/account")
def api_delete_account(
    request: Request,
    slug: str,
    x_telegram_init_data: str | None = Header(default=None, alias="X-Telegram-Init-Data"),
):
    if not ps_is_valid_slug(slug):
        raise HTTPException(status_code=400, detail="invalid_slug")
    ip = _client_ip(request)
    if not _rate_allow(f"delete_account:{ip}", 5, 3600.0):
        raise HTTPException(status_code=429, detail="rate_limit")
    user_id = _require_write_telegram_user(x_telegram_init_data)
    if not _ps_profile_path(slug).is_file():
        raise HTTPException(status_code=404, detail="not_found")
    _authorize_profile_write(slug, user_id)
    ps_delete_profile_files(slug)
    return {"ok": True}


@app.get("/api/public/{slug}/og.png")
def api_og_png(slug: str):
    base = ps_load_profile_public(slug)
    if base is None:
        raise HTTPException(status_code=404, detail="not_found")
    title = str(base.get("displayName") or slug)[:80]
    sub = str(base.get("bio") or "Taplink")[:180]
    png = _render_og_png(slug, title, sub)
    if png is None:
        raise HTTPException(status_code=503, detail="pillow_not_installed")
    return Response(png, media_type="image/png")


@app.get("/api/public/{slug}/avatar")
def api_get_avatar(slug: str):
    fr = ps_avatar_file_response(slug)
    if fr is None:
        raise HTTPException(status_code=404, detail="no_avatar")
    return fr


@app.post("/api/public/{slug}/avatar")
async def api_post_avatar(
    request: Request,
    slug: str,
    file: UploadFile = File(...),
    x_telegram_init_data: str | None = Header(default=None, alias="X-Telegram-Init-Data"),
):
    if not ps_is_valid_slug(slug):
        raise HTTPException(status_code=400, detail="invalid_slug")
    ip = _client_ip(request)
    if not _rate_allow(f"upload:{ip}", 25, 60.0):
        raise HTTPException(status_code=429, detail="rate_limit")
    user_id = _require_write_telegram_user(x_telegram_init_data)
    if _ps_profile_path(slug).is_file():
        _authorize_profile_write(slug, user_id)
    elif user_id < 0:
        pass
    else:
        raise HTTPException(status_code=404, detail="profile_required")
    data = await file.read()
    try:
        ps_save_avatar(slug, data, file.content_type or "")
    except ValueError as e:
        code = str(e)
        if code == "too_large":
            raise HTTPException(status_code=413, detail="too_large") from e
        if code == "not_image":
            raise HTTPException(status_code=400, detail="not_image") from e
        raise HTTPException(status_code=400, detail=code) from e
    _ps_touch_profile_updated_at(slug)
    return {"ok": True}


@app.delete("/api/public/{slug}/avatar")
def api_delete_avatar(
    request: Request,
    slug: str,
    x_telegram_init_data: str | None = Header(default=None, alias="X-Telegram-Init-Data"),
):
    if not ps_is_valid_slug(slug):
        raise HTTPException(status_code=400, detail="invalid_slug")
    ip = _client_ip(request)
    if not _rate_allow(f"delete_media:{ip}", 40, 60.0):
        raise HTTPException(status_code=429, detail="rate_limit")
    user_id = _require_write_telegram_user(x_telegram_init_data)
    if not _ps_profile_path(slug).is_file():
        raise HTTPException(status_code=404, detail="not_found")
    _authorize_profile_write(slug, user_id)
    ps_delete_avatar(slug)
    disk = _read_profile_disk(slug)
    if disk:
        ps_save_profile_json(
            slug,
            {
                "displayName": disk.get("displayName", ""),
                "bio": disk.get("bio", ""),
                "links": disk.get("links", []),
                "themeId": disk.get("themeId", "purple"),
                "backgroundMuted": bool(disk.get("backgroundMuted", True)),
                "plan": str(disk.get("plan", "free")),
            },
        )
    return {"ok": True}


@app.get("/api/public/{slug}/background")
def api_get_background(slug: str):
    fr = ps_background_file_response(slug)
    if fr is None:
        raise HTTPException(status_code=404, detail="no_background")
    return fr


@app.post("/api/public/{slug}/background")
async def api_post_background(
    request: Request,
    slug: str,
    file: UploadFile = File(...),
    x_telegram_init_data: str | None = Header(default=None, alias="X-Telegram-Init-Data"),
):
    if not ps_is_valid_slug(slug):
        raise HTTPException(status_code=400, detail="invalid_slug")
    ip = _client_ip(request)
    if not _rate_allow(f"upload:{ip}", 25, 60.0):
        raise HTTPException(status_code=429, detail="rate_limit")
    user_id = _require_write_telegram_user(x_telegram_init_data)
    if _ps_profile_path(slug).is_file():
        _authorize_profile_write(slug, user_id)
    elif user_id < 0:
        pass
    else:
        raise HTTPException(status_code=404, detail="profile_required")
    data = await file.read()
    try:
        ps_save_background(slug, data, file.content_type or "")
    except ValueError as e:
        code = str(e)
        if code == "too_large":
            raise HTTPException(status_code=413, detail="too_large") from e
        if code == "unsupported_media":
            raise HTTPException(status_code=400, detail="unsupported_media") from e
        raise HTTPException(status_code=400, detail=code) from e
    _ps_touch_profile_updated_at(slug)
    return {"ok": True}


@app.delete("/api/public/{slug}/background")
def api_delete_background(
    request: Request,
    slug: str,
    x_telegram_init_data: str | None = Header(default=None, alias="X-Telegram-Init-Data"),
):
    if not ps_is_valid_slug(slug):
        raise HTTPException(status_code=400, detail="invalid_slug")
    ip = _client_ip(request)
    if not _rate_allow(f"delete_media:{ip}", 40, 60.0):
        raise HTTPException(status_code=429, detail="rate_limit")
    user_id = _require_write_telegram_user(x_telegram_init_data)
    if not _ps_profile_path(slug).is_file():
        raise HTTPException(status_code=404, detail="not_found")
    _authorize_profile_write(slug, user_id)
    ps_delete_background(slug)
    disk = _read_profile_disk(slug)
    if disk:
        ps_save_profile_json(
            slug,
            {
                "displayName": disk.get("displayName", ""),
                "bio": disk.get("bio", ""),
                "links": disk.get("links", []),
                "themeId": disk.get("themeId", "purple"),
                "backgroundMuted": bool(disk.get("backgroundMuted", True)),
                "plan": str(disk.get("plan", "free")),
            },
        )
    return {"ok": True}


@app.get("/")
async def root():
    return _index_response()


@app.get("/{path:path}")
async def spa_or_static(path: str):
    candidate = _safe_file(DIST / path)
    if candidate is not None:
        return FileResponse(candidate)
    return _index_response()
