"""Telegram bot. Run: python bot.py"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import sys
from pathlib import Path

from telegram import BotCommand, InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.constants import ChatAction
from telegram.error import InvalidToken, NetworkError
from telegram.ext import (
    Application,
    ApplicationHandlerStop,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    TypeHandler,
    filters,
)
from telegram.request import BaseRequest

from multibot.assistant import HELP, Assistant
from multibot.backends import FAMILIES, BackendError
from multibot.config import Config, load_config
from multibot.text import split_message

log = logging.getLogger("multibot")

MAX_FILES_SENT = 5
MAX_UPLOAD_BYTES = 45 * 1024 * 1024  # bots can upload up to 50 MB


def rest_of_command(text: str) -> str:
    """'/claude what is 2+2' -> 'what is 2+2' (keeps line breaks)."""
    parts = text.split(maxsplit=1)
    return parts[1] if len(parts) > 1 else ""


async def send_text(update: Update, text: str) -> None:
    for chunk in split_message(text):
        await update.effective_message.reply_text(chunk)


@contextlib.asynccontextmanager
async def typing(bot, chat_id: int):
    """Show 'typing…' in Telegram until the block finishes."""

    async def keep_typing() -> None:
        while True:
            with contextlib.suppress(Exception):
                await bot.send_chat_action(chat_id, ChatAction.TYPING)
            await asyncio.sleep(4)

    task = asyncio.create_task(keep_typing())
    try:
        yield
    finally:
        task.cancel()


def build_app(cfg: Config, assistant: Assistant, request: BaseRequest | None = None) -> Application:
    builder = Application.builder().token(cfg.telegram_token).concurrent_updates(True)
    if request is not None:  # tests swap in a fake Telegram
        builder = builder.request(request).get_updates_request(request)

    async def guard(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        # Runs before every handler. Only the owner gets through: the bot runs on
        # your subscriptions, and sharing them breaks the providers' terms.
        user = update.effective_user
        if user and user.id in cfg.allowed_user_ids:
            return
        if not cfg.allowed_user_ids and user and update.effective_message:
            await update.effective_message.reply_text(
                f"This bot isn't set up yet. Your Telegram user ID is {user.id}.\n"
                "Put it in ALLOWED_USER_IDS in the .env file, restart the bot, and message again."
            )
        raise ApplicationHandlerStop

    async def ask_and_reply(update: Update, context: ContextTypes.DEFAULT_TYPE, text: str) -> None:
        chat = assistant.chat(update.effective_chat.id)
        async with typing(context.bot, update.effective_chat.id):
            try:
                answer = await assistant.ask(chat, text)
            except BackendError as e:
                await send_text(update, f"⚠️ {e}")
                return
        await send_text(update, answer.text)
        await send_files(update, context, answer.files)

    async def send_files(update: Update, context: ContextTypes.DEFAULT_TYPE, files: list[Path]) -> None:
        for path in files[:MAX_FILES_SENT]:
            try:
                size = path.stat().st_size
            except OSError:
                continue
            if size == 0 or size > MAX_UPLOAD_BYTES:
                await send_text(update, f"Made {path.name} but can't send it ({size:,} bytes). It's at {path}")
                continue
            with path.open("rb") as f:
                await context.bot.send_document(update.effective_chat.id, document=f, filename=path.name)
        if len(files) > MAX_FILES_SENT:
            extra = len(files) - MAX_FILES_SENT
            await send_text(update, f"{extra} more changed files are in {cfg.workspace}")

    async def on_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        await ask_and_reply(update, context, update.effective_message.text)

    def switch_command(family: str):
        async def handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
            chat = assistant.chat(update.effective_chat.id)
            await send_text(update, assistant.switch(chat, family))
            question = rest_of_command(update.effective_message.text)
            if question and chat.model == family:
                await ask_and_reply(update, context, question)

        return handler

    async def on_all(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        question = rest_of_command(update.effective_message.text)
        if not question:
            await send_text(update, "Put the question after the command: /all what should I name my cat?")
            return
        if not assistant.backends:
            await send_text(update, assistant.status(assistant.chat(update.effective_chat.id)))
            return

        async def on_answer(name: str, result: str | BackendError) -> None:
            if isinstance(result, BackendError):
                await send_text(update, f"⚠️ {name} didn't answer:\n{result}")
            else:
                await send_text(update, f"{name}:\n{result}")

        chat = assistant.chat(update.effective_chat.id)
        async with typing(context.bot, update.effective_chat.id):
            await assistant.ask_all(chat, question, on_answer)

    async def on_model(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        chat = assistant.chat(update.effective_chat.id)
        buttons = [
            [InlineKeyboardButton(("✅ " if key == chat.model else "") + b.name, callback_data=f"model:{key}")]
            for key, b in assistant.backends.items()
        ]
        markup = InlineKeyboardMarkup(buttons) if buttons else None
        await update.effective_message.reply_text(assistant.status(chat), reply_markup=markup)

    async def on_model_button(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        query = update.callback_query
        await query.answer()
        chat = assistant.chat(update.effective_chat.id)
        await query.edit_message_text(assistant.switch(chat, query.data.removeprefix("model:")))

    async def on_help(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        chat = assistant.chat(update.effective_chat.id)
        await send_text(update, f"{HELP}\n\n{assistant.status(chat)}")

    async def on_agent(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        await send_text(update, assistant.toggle_agent(assistant.chat(update.effective_chat.id)))

    async def on_new(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        await send_text(update, assistant.reset(assistant.chat(update.effective_chat.id)))

    async def on_other(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        await send_text(update, "I can only read text messages for now. Send /help for commands.")

    async def on_error(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
        log.error("Error while handling an update", exc_info=context.error)
        if isinstance(update, Update) and update.effective_message:
            with contextlib.suppress(Exception):
                await update.effective_message.reply_text(f"⚠️ Something broke: {context.error}")

    async def post_init(app: Application) -> None:
        commands = [BotCommand(key, f"Talk to {b.name}") for key, b in assistant.backends.items()]
        commands += [
            BotCommand("all", "Ask every model at once"),
            BotCommand("agent", "Agent mode on/off"),
            BotCommand("new", "Fresh conversation"),
            BotCommand("model", "What's set up"),
            BotCommand("help", "How to use this bot"),
        ]
        await app.bot.set_my_commands(commands)

    async def post_shutdown(app: Application) -> None:
        await assistant.aclose()

    app = builder.post_init(post_init).post_shutdown(post_shutdown).build()
    new = filters.UpdateType.MESSAGE  # ignore edits, so editing a message doesn't ask again
    app.add_handler(TypeHandler(Update, guard), group=-1)
    app.add_handler(CommandHandler(["start", "help"], on_help, filters=new))
    for family in FAMILIES:
        app.add_handler(CommandHandler(family, switch_command(family), filters=new))
    app.add_handler(CommandHandler("all", on_all, filters=new))
    app.add_handler(CommandHandler("model", on_model, filters=new))
    app.add_handler(CommandHandler("agent", on_agent, filters=new))
    app.add_handler(CommandHandler("new", on_new, filters=new))
    app.add_handler(CallbackQueryHandler(on_model_button, pattern=r"^model:"))
    app.add_handler(MessageHandler(new & filters.TEXT & ~filters.COMMAND, on_text))
    app.add_handler(MessageHandler(new & ~filters.COMMAND, on_other))
    app.add_handler(MessageHandler(new & filters.COMMAND, on_help))
    app.add_error_handler(on_error)
    return app


def main() -> None:
    logging.basicConfig(format="%(asctime)s %(levelname)s %(name)s: %(message)s", level=logging.INFO)
    # httpx logs every Telegram request URL at INFO, and those URLs contain the bot token.
    logging.getLogger("httpx").setLevel(logging.WARNING)

    cfg = load_config()
    if not cfg.telegram_token:
        sys.exit("TELEGRAM_BOT_TOKEN is missing. Copy .env.example to .env and fill it in (see README).")
    assistant = Assistant(cfg)
    for backend in assistant.backends.values():
        log.info("%s: %s", backend.name, backend.via)
    if not assistant.backends:
        log.warning("No models are set up. Sign in to a CLI or add an API key (see README).")
    if not cfg.allowed_user_ids:
        log.warning("ALLOWED_USER_IDS is empty. Message your bot and it will tell you your ID.")
    try:
        build_app(cfg, assistant).run_polling(allowed_updates=Update.ALL_TYPES)
    except InvalidToken:
        sys.exit("Telegram rejected TELEGRAM_BOT_TOKEN. Copy it again from @BotFather.")
    except NetworkError as e:
        sys.exit(f"Couldn't reach Telegram ({e}). Check the internet connection and try again.")


if __name__ == "__main__":
    main()
