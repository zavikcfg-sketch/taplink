"""
Веб (dist/) + API публичных профилей + Telegram-бот.
Один файл хранилища профилей (на хостингах часто копируют только main.py + bot.py).

Переменные: BOT_TOKEN, PUBLIC_URL, DATA_DIR (папка для profiles/, avatars/, backgrounds/).
"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"

# --- файловое хранилище профилей (всё в main.py — проще деплой на Bothost) -----
_DATA_DIR = Path(os.environ.get("DATA_DIR", str(ROOT / "data"))).resolve()
_PROFILES_DIR = _DATA_DIR / "profiles"
_AVATARS_DIR = _DATA_DIR / "avatars"
_BACKGROUNDS_DIR = _DATA_DIR / "backgrounds"
_RESERVED_SLUGS = frozenset(
    {"edit", "health", "assets", "favicon.ico", "api", "docs", "static"},
)
_SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def ps_ensure_dirs() -> None:
    _PROFILES_DIR.mkdir(parents=True, exist_ok=True)
    _AVATARS_DIR.mkdir(parents=True, exist_ok=True)
    _BACKGROUNDS_DIR.mkdir(parents=True, exist_ok=True)


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


def _ps_background_kind(content_type: str) -> str | None:
    ct = (content_type or "").split(";")[0].strip().lower()
    if ct.startswith("image/"):
        return "image"
    if ct in ("video/mp4", "video/webm", "video/quicktime"):
        return "video"
    return None


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


def ps_save_profile_json(slug: str, payload: dict[str, Any]) -> dict[str, Any]:
    ps_ensure_dirs()
    if not ps_is_valid_slug(slug):
        raise ValueError("invalid_slug")
    now = datetime.now(timezone.utc).isoformat()
    out = {
        "slug": slug.lower(),
        "displayName": str(payload.get("displayName", ""))[:80],
        "bio": str(payload.get("bio", ""))[:500],
        "links": _ps_sanitize_links(payload.get("links")),
        "updatedAt": now,
    }
    path = _ps_profile_path(slug)
    path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    return out


def ps_save_avatar(slug: str, data: bytes, content_type: str) -> None:
    if not ps_is_valid_slug(slug):
        raise ValueError("invalid_slug")
    if len(data) > 2_500_000:
        raise ValueError("too_large")
    ct = (content_type or "application/octet-stream").split(";")[0].strip().lower()
    if not ct.startswith("image/"):
        raise ValueError("not_image")
    ps_ensure_dirs()
    _ps_avatar_data_path(slug).write_bytes(data)
    _ps_avatar_meta_path(slug).write_text(
        json.dumps({"contentType": ct}),
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
    ct = (content_type or "application/octet-stream").split(";")[0].strip().lower()
    kind = _ps_background_kind(ct)
    if kind is None:
        raise ValueError("unsupported_media")
    max_len = 14_000_000 if kind == "video" else 4_000_000
    if len(data) > max_len:
        raise ValueError("too_large")
    ps_ensure_dirs()
    _ps_background_data_path(slug).write_bytes(data)
    _ps_background_meta_path(slug).write_text(
        json.dumps({"contentType": ct, "kind": kind}),
        encoding="utf-8",
    )


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
def api_put_public(slug: str, body: ProfileIn):
    if not ps_is_valid_slug(slug):
        raise HTTPException(status_code=400, detail="invalid_slug")
    try:
        saved = ps_save_profile_json(
            slug,
            {
                "displayName": body.displayName,
                "bio": body.bio,
                "links": [link.model_dump() for link in body.links],
            },
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return saved


@app.get("/api/public/{slug}/avatar")
def api_get_avatar(slug: str):
    fr = ps_avatar_file_response(slug)
    if fr is None:
        raise HTTPException(status_code=404, detail="no_avatar")
    return fr


@app.post("/api/public/{slug}/avatar")
async def api_post_avatar(slug: str, file: UploadFile = File(...)):
    if not ps_is_valid_slug(slug):
        raise HTTPException(status_code=400, detail="invalid_slug")
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
    return {"ok": True}


@app.delete("/api/public/{slug}/avatar")
def api_delete_avatar(slug: str):
    if not ps_is_valid_slug(slug):
        raise HTTPException(status_code=400, detail="invalid_slug")
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
async def api_post_background(slug: str, file: UploadFile = File(...)):
    if not ps_is_valid_slug(slug):
        raise HTTPException(status_code=400, detail="invalid_slug")
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
def api_delete_background(slug: str):
    if not ps_is_valid_slug(slug):
        raise HTTPException(status_code=400, detail="invalid_slug")
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
