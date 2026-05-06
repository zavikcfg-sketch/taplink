"""
Telegram-бот Taplink. Запуск:
  • только бот:  python bot.py
  • сайт + бот:  uvicorn main:app --host 0.0.0.0 --port 3000   (см. main.py)

Переменные окружения:
  BOT_TOKEN     — токен от @BotFather
  PUBLIC_URL    — https://твой-сайт без слэша в конце (кнопки в боте)
"""
from __future__ import annotations

import asyncio
import logging
import os
import threading

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import Application, CommandHandler, ContextTypes

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
log = logging.getLogger(__name__)


def _public_base() -> str | None:
    u = (os.environ.get("PUBLIC_URL") or "").strip().rstrip("/")
    return u or None


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    public = _public_base()
    if not public:
        await update.effective_message.reply_text(
            "Задайте переменную PUBLIC_URL на хостинге (https://…).",
        )
        return

    args = context.args or []
    mode = (args[0] or "").strip().lower() if args else ""

    edit_url = f"{public}/1"
    pricing_url = f"{public}/pricing"
    profile_url = f"{public}/profil"
    site_url = public

    keyboard = InlineKeyboardMarkup(
        [
            [InlineKeyboardButton(text="Открыть редактор", url=edit_url)],
            [InlineKeyboardButton(text="Профиль и настройки", url=profile_url)],
            [InlineKeyboardButton(text="Тарифы VIP", url=pricing_url)],
            [InlineKeyboardButton(text="Открыть сайт", url=site_url)],
        ]
    )

    if mode == "return":
        text = (
            "С возвращением!\n\n"
            "Нажмите «Открыть редактор», чтобы изменить страницу, ссылки и аватар в браузере. "
            "После «Сохранить» в редакторе ваша публичная ссылка обновится для всех.\n\n"
            "Сайт: " + site_url
        )
    else:
        # register, пустой start и любые другие deep-link
        text = (
            "Добро пожаловать в Taplink — регистрация в пару шагов.\n\n"
            "1) Нажмите «Открыть редактор» (обычный сайт в браузере).\n"
            "2) Придумайте адрес страницы (латиницей), имя, описание и ссылки.\n"
            "3) Нажмите «Сохранить» — профиль уйдёт на сервер.\n"
            "4) Делитесь ссылкой вида:\n"
            f"   {site_url}/ваш-ник\n"
            "Она откроется у друзей в обычном браузере, не только в Telegram.\n\n"
            "Если уже создавали страницу — на сайте нажмите «Уже регистрировался»."
        )

    await update.effective_message.reply_text(text, reply_markup=keyboard)


async def themes(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    public = _public_base()
    if not public:
        await update.effective_message.reply_text(
            "Задайте переменную PUBLIC_URL на хостинге (https://…).",
        )
        return
    base = f"{public}/1"
    kb = InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton(text="Purple", url=f"{base}?theme=purple"),
                InlineKeyboardButton(text="Ocean", url=f"{base}?theme=ocean"),
            ],
            [
                InlineKeyboardButton(text="Sunset", url=f"{base}?theme=sunset"),
                InlineKeyboardButton(text="Mono", url=f"{base}?theme=mono"),
            ],
            [InlineKeyboardButton(text="Light", url=f"{base}?theme=light")],
        ]
    )
    await update.effective_message.reply_text(
        "Выбери тему — откроется редактор с предустановкой.",
        reply_markup=kb,
    )


def run_bot() -> None:
    """Блокирующий polling (удобно вызывать из отдельного потока)."""
    token = os.environ.get("BOT_TOKEN", "").strip()
    if not token:
        log.error(
            "BOT_TOKEN не задан — бот не запущен. Сайт из dist/ всё равно работает.",
        )
        return

    worker = threading.current_thread() is not threading.main_thread()

    if worker:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

    application = Application.builder().token(token).build()
    application.add_handler(CommandHandler("start", start))
    application.add_handler(CommandHandler("themes", themes))
    log.info("Бот polling запущен (bot.py)")
    if worker:
        application.run_polling(
            allowed_updates=Update.ALL_TYPES,
            stop_signals=None,
        )
    else:
        application.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    run_bot()
