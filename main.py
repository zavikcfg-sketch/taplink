"""
Веб (dist/) + API публичных профилей + Telegram-бот.
Один файл хранилища профилей (на хостингах часто копируют только main.py + bot.py).

Переменные:
  BOT_TOKEN, PUBLIC_URL, DATA_DIR (profiles/, avatars/, backgrounds/, clicks/).
  ALLOW_INSECURE_EDIT=1 — только отладка: API записи без X-Telegram-Init-Data (не для публичного прода).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import re
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl

from fastapi import FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
_RESERVED_SLUG_FILE = ROOT / "src" / "config" / "reserved-slugs.json"

# --- файловое хранилище профилей (всё в main.py — проще деплой на Bothost) -----
_DATA_DIR = Path(os.environ.get("DATA_DIR", str(ROOT / "data"))).resolve()
_PROFILES_DIR = _DATA_DIR / "profiles"
_AVATARS_DIR = _DATA_DIR / "avatars"
_BACKGROUNDS_DIR = _DATA_DIR / "backgrounds"
_CLICKS_DIR = _DATA_DIR / "clicks"
_SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

_DEFAULT_RESERVED = frozenset(
    {"edit", "health", "assets", "favicon.ico", "api", "docs", "static"},
)


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

_RATE_STORAGE: dict[str, list[float]] = {}


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip() or "unknown"
    if request.client:
        return request.client.host or "unknown"
    return "unknown"


def _rate_allow(bucket_key: str, limit: int, window_sec: float) -> bool:
    now = time.time()
    bucket = _RATE_STORAGE.setdefault(bucket_key, [])
    bucket[:] = [t for t in bucket if now - t < window_sec]
    if len(bucket) >= limit:
        return False
    bucket.append(now)
    return True


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
    return os.environ.get("ALLOW_INSECURE_EDIT", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )


def _require_write_telegram_user(x_telegram_init_data: str | None) -> int:
    """Возвращает user id Telegram или -1 в небезопасном режиме."""
    if _allow_insecure_edit():
        return -1
    token = os.environ.get("BOT_TOKEN", "").strip()
    if not token:
        raise HTTPException(
            status_code=503,
            detail="bot_token_required_for_edits",
        )
    uid = _validate_webapp_init_data(x_telegram_init_data, token)
    if uid is None:
        raise HTTPException(
            status_code=401,
            detail="telegram_auth_required",
        )
    return uid


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


def ps_load_profile(slug: str) -> dict[str, Any] | None:
    if not ps_is_valid_slug(slug):
        return None
    path = _ps_profile_path(slug)
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
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
        if kind is None:
            kind = "image"
        data["backgroundKind"] = kind
    clicks = _ps_load_click_counts(slug)
    if clicks:
        data["linkClicks"] = clicks
    return data


def _ps_sanitize_links(raw: Any) -> list[dict[str, str]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, str]] = []
    for item in raw[:30]:
        if not isinstance(item, dict):
            continue
        out.append(
            {
                "id": str(item.get("id", ""))[:40] or "link",
                "title": str(item.get("title", ""))[:60],
                "url": str(item.get("url", ""))[:2000],
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
    out: dict[str, Any] = {
        "slug": slug.lower(),
        "displayName": str(payload.get("displayName", ""))[:80],
        "bio": str(payload.get("bio", ""))[:500],
        "links": _ps_sanitize_links(payload.get("links")),
        "updatedAt": now,
    }
    if owner is not None:
        out["ownerTelegramId"] = owner
    path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    loaded = ps_load_profile(slug)
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
        log.info("avatar content-type mismatch, using magic: %s -> %s", ct, magic_ct)
    ps_ensure_dirs()
    _ps_avatar_data_path(slug).write_bytes(data)
    _ps_avatar_meta_path(slug).write_text(
        json.dumps({"contentType": magic_ct}),
        encoding="utf-8",
    )


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
        log.info("background header kind %s vs magic %s — trusting magic", header_kind, kind)
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


class LinkIn(BaseModel):
    id: str = ""
    title: str = ""
    url: str = ""


class ProfileIn(BaseModel):
    displayName: str = Field("", max_length=80)
    bio: str = Field("", max_length=500)
    links: list[LinkIn] = Field(default_factory=list)


class ClickIn(BaseModel):
    linkId: str = Field("", max_length=40)


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


def _link_id_allowed(slug: str, link_id: str) -> bool:
    p = ps_load_profile(slug)
    if not p:
        return False
    lid = link_id.strip()[:40]
    for item in p.get("links") or []:
        if isinstance(item, dict) and str(item.get("id", "")) == lid:
            return True
    return False


@asynccontextmanager
async def lifespan(_: FastAPI):
    ps_ensure_dirs()
    from bot import run_bot

    t = threading.Thread(target=run_bot, name="telegram-bot", daemon=True)
    t.start()
    log.info("Поток бота запущен (если нет BOT_TOKEN — см. логи bot)")
    yield


app = FastAPI(title="Taplink", lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/public/{slug}")
def api_get_public(slug: str):
    data = ps_load_profile(slug)
    if data is None:
        raise HTTPException(status_code=404, detail="not_found")
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
    claim = user_id if user_id >= 0 else None
    try:
        saved = ps_save_profile_json(
            slug,
            {
                "displayName": body.displayName,
                "bio": body.bio,
                "links": [link.model_dump() for link in body.links],
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
    if not _rate_allow(f"click:{ip}", 180, 60.0):
        raise HTTPException(status_code=429, detail="rate_limit")
    if ps_load_profile(slug) is None:
        raise HTTPException(status_code=404, detail="not_found")
    lid = body.linkId.strip()[:40]
    if not lid or not _link_id_allowed(slug, lid):
        raise HTTPException(status_code=400, detail="invalid_link")
    ps_increment_click(slug, lid)
    return {"ok": True}


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
    p = ps_load_profile(slug)
    if p:
        ps_save_profile_json(
            slug,
            {
                "displayName": p.get("displayName", ""),
                "bio": p.get("bio", ""),
                "links": p.get("links", []),
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
    p = ps_load_profile(slug)
    if p:
        ps_save_profile_json(
            slug,
            {
                "displayName": p.get("displayName", ""),
                "bio": p.get("bio", ""),
                "links": p.get("links", []),
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
