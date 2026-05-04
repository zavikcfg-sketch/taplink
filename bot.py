"""
Точка входа Telegram-бота для хостингов вроде Bothost (Python).
Укажи в панели запуска файла: bot.py (не vite.config.ts).

Переменные окружения:
  BOT_TOKEN     — токен от @BotFather
  PUBLIC_URL    — https://твой-сайт без слэша в конце (кнопка Mini App)
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


def main() -> None:
    token = os.environ.get("BOT_TOKEN", "").strip()
    if not token:
        raise SystemExit("BOT_TOKEN не задан в переменных окружения")

    app = Application.builder().token(token).build()
    app.add_handler(CommandHandler("start", start))
    log.info("Бот polling запущен (bot.py)")
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
