"""
Telegram-бот Taplink. Запуск:
  • только бот:  python bot.py
  • сайт + бот:  uvicorn main:app --host 0.0.0.0 --port 3000   (см. main.py)

Переменные окружения:
  BOT_TOKEN     — токен от @BotFather
  PUBLIC_URL    — https://твой-сайт без слэша в конце (кнопки в боте)
"""
from __future__ import annotations

import logging
import os

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update, WebAppInfo
from telegram.ext import Application, CommandHandler, ContextTypes

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
log = logging.getLogger(__name__)


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    public = (os.environ.get("PUBLIC_URL") or "").strip().rstrip("/")
    if not public:
        await update.effective_message.reply_text(
            "Задайте переменную PUBLIC_URL на хостинге (https://…).",
        )
        return

    edit_url = f"{public}/edit"
    keyboard = InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton(
                    text="Открыть редактор",
                    web_app=WebAppInfo(url=edit_url),
                )
            ],
            [InlineKeyboardButton(text="Сайт", url=public)],
        ]
    )
    await update.effective_message.reply_text(
        "Настройте свою страницу Taplink:",
        reply_markup=keyboard,
    )


def run_bot() -> None:
    """Блокирующий polling (удобно вызывать из отдельного потока)."""
    token = os.environ.get("BOT_TOKEN", "").strip()
    if not token:
        raise SystemExit("BOT_TOKEN не задан в переменных окружения")

    application = Application.builder().token(token).build()
    application.add_handler(CommandHandler("start", start))
    log.info("Бот polling запущен (bot.py)")
    application.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    run_bot()
