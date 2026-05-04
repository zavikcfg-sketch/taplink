"""
Веб (раздача собранного React из dist/) + Telegram-бот в фоне.

На хостинге (Bothost и т.п.) укажи запуск Uvicorn на это приложение, например:
  uvicorn main:app --host 0.0.0.0 --port 3000

Перед деплоем обязательно:
  npm ci && npm run build
и в репозитории/архиве должна быть папка dist/ с index.html и assets/.

Переменные: BOT_TOKEN, PUBLIC_URL (как в bot.py).
"""
from __future__ import annotations

import logging
import os
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse

log = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"


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
    """Файл только внутри dist/, без выхода наружу."""
    try:
        path.resolve().relative_to(DIST.resolve())
    except ValueError:
        return None
    return path if path.is_file() else None


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Фоновый polling бота."""
    from bot import run_bot

    t = threading.Thread(target=run_bot, name="telegram-bot", daemon=True)
    t.start()
    log.info("Поток бота запущен")
    yield


app = FastAPI(title="Taplink", lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/")
async def root():
    return _index_response()


@app.get("/{path:path}")
async def spa_or_static(path: str):
    candidate = _safe_file(DIST / path)
    if candidate is not None:
        return FileResponse(candidate)
    return _index_response()
