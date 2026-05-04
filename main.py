"""
Веб (dist/) + API публичных профилей + Telegram-бот.

Переменные: BOT_TOKEN, PUBLIC_URL, DATA_DIR (папка для profiles/ и avatars/).
"""
from __future__ import annotations

import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
from pathlib import Path

import profile_store

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"


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
    profile_store.ensure_dirs()
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
    data = profile_store.load_profile(slug)
    if data is None:
        raise HTTPException(status_code=404, detail="not_found")
    return data


@app.put("/api/public/{slug}")
def api_put_public(slug: str, body: ProfileIn):
    if not profile_store.is_valid_slug(slug):
        raise HTTPException(status_code=400, detail="invalid_slug")
    try:
        saved = profile_store.save_profile_json(
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
    fr = profile_store.avatar_file_response(slug)
    if fr is None:
        raise HTTPException(status_code=404, detail="no_avatar")
    return fr


@app.post("/api/public/{slug}/avatar")
async def api_post_avatar(slug: str, file: UploadFile = File(...)):
    if not profile_store.is_valid_slug(slug):
        raise HTTPException(status_code=400, detail="invalid_slug")
    data = await file.read()
    try:
        profile_store.save_avatar(slug, data, file.content_type or "")
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
    if not profile_store.is_valid_slug(slug):
        raise HTTPException(status_code=400, detail="invalid_slug")
    profile_store.delete_avatar(slug)
    # обновить json профиля без hasAvatar
    p = profile_store.load_profile(slug)
    if p:
        profile_store.save_profile_json(
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
