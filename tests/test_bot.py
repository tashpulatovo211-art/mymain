"""Runs the bot's handlers through python-telegram-bot against a fake Telegram."""

import asyncio
import itertools

from telegram import Update

from bot import build_app
from multibot.assistant import Assistant
from tests.fakes import FakeBackend, FakeTelegram, make_config

OWNER = 42
_ids = itertools.count(1)


def message(text: str, user: int = OWNER) -> dict:
    data = {
        "update_id": next(_ids),
        "message": {
            "message_id": next(_ids),
            "date": 0,
            "chat": {"id": user, "type": "private"},
            "from": {"id": user, "is_bot": False, "first_name": "Me"},
            "text": text,
        },
    }
    if text.startswith("/"):
        command = text.split()[0]
        data["message"]["entities"] = [{"type": "bot_command", "offset": 0, "length": len(command)}]
    return data


def button(data: str, user: int = OWNER) -> dict:
    return {
        "update_id": next(_ids),
        "callback_query": {
            "id": "cb",
            "from": {"id": user, "is_bot": False, "first_name": "Me"},
            "chat_instance": "c",
            "data": data,
            "message": {"message_id": 1, "date": 0, "chat": {"id": user, "type": "private"}, "text": "menu"},
        },
    }


def run_bot(tmp_path, updates, allowed=str(OWNER), **backends):
    """Feed updates to the bot; return the fake Telegram that recorded its replies."""
    cfg = make_config(tmp_path, TELEGRAM_BOT_TOKEN="123:abc", ALLOWED_USER_IDS=allowed)
    assistant = Assistant(cfg, backends=backends or {"claude": FakeBackend("Claude")})
    telegram = FakeTelegram()

    async def go():
        app = build_app(cfg, assistant, request=telegram)
        await app.initialize()
        await app.post_init(app)
        for data in updates:
            await app.process_update(Update.de_json(data, app.bot))
        await app.shutdown()

    asyncio.run(go())
    return telegram


def test_owner_gets_answers(tmp_path):
    claude = FakeBackend("Claude", reply="hello back")
    telegram = run_bot(tmp_path, [message("hello")], claude=claude)
    assert telegram.texts() == ["hello back"]
    assert claude.requests[0].message == "hello"
    assert telegram.sent("sendMessage")[0]["chat_id"] == OWNER


def test_strangers_are_ignored(tmp_path):
    claude = FakeBackend("Claude")
    telegram = run_bot(tmp_path, [message("hello", user=7), message("/all hi", user=7)], claude=claude)
    assert telegram.texts() == []
    assert claude.requests == []


def test_unconfigured_bot_tells_you_your_id(tmp_path):
    claude = FakeBackend("Claude")
    telegram = run_bot(tmp_path, [message("hello", user=7)], allowed="", claude=claude)
    (text,) = telegram.texts()
    assert "Your Telegram user ID is 7" in text
    assert claude.requests == []


def test_switch_command_with_question(tmp_path):
    gpt = FakeBackend("GPT", reply="gpt answer")
    telegram = run_bot(tmp_path, [message("/gpt what is 2+2?\nshow work")], claude=FakeBackend("Claude"), gpt=gpt)
    assert telegram.texts() == ["Now talking to GPT (fake GPT).", "gpt answer"]
    assert gpt.requests[0].message == "what is 2+2?\nshow work"


def test_switch_to_model_that_is_not_set_up(tmp_path):
    telegram = run_bot(tmp_path, [message("/grok hi")])
    (text,) = telegram.texts()
    assert "grok isn't set up" in text


def test_all_command(tmp_path):
    telegram = run_bot(
        tmp_path,
        [message("/all which is best?")],
        claude=FakeBackend("Claude", reply="me"),
        gemini=FakeBackend("Gemini", fail="Quota exceeded"),
    )
    assert sorted(telegram.texts()) == ["Claude:\nme", "⚠️ Gemini didn't answer:\nQuota exceeded"]


def test_errors_are_reported(tmp_path):
    telegram = run_bot(tmp_path, [message("hi")], claude=FakeBackend("Claude", fail="Not logged in"))
    assert telegram.texts() == ["⚠️ Claude didn't answer:\nNot logged in"]


def test_agent_mode_sends_files(tmp_path):
    claude = FakeBackend("Claude", reply="done", make_file="essay.txt")
    telegram = run_bot(tmp_path, [message("/agent"), message("write it")], claude=claude)
    assert "Agent mode on" in telegram.texts()[0]
    assert telegram.texts()[1] == "done"
    (document,) = telegram.sent("sendDocument")
    assert document["chat_id"] == OWNER


def test_long_replies_are_split(tmp_path):
    telegram = run_bot(tmp_path, [message("essay")], claude=FakeBackend("Claude", reply="word " * 2000))
    texts = telegram.texts()
    assert len(texts) == 3 and all(len(t) <= 4096 for t in texts)


def test_model_menu_and_button(tmp_path):
    gpt = FakeBackend("GPT")
    telegram = run_bot(tmp_path, [message("/model"), button("model:gpt"), message("hi")],
                       claude=FakeBackend("Claude"), gpt=gpt)
    menu = telegram.sent("sendMessage")[0]
    assert "Talking to: Claude" in menu["text"]
    assert "reply_markup" in menu
    (edit,) = telegram.sent("editMessageText")
    assert edit["text"].startswith("Now talking to GPT")
    assert gpt.requests[0].message == "hi"


def test_command_menu_lists_available_models(tmp_path):
    telegram = run_bot(tmp_path, [], claude=FakeBackend("Claude"), grok=FakeBackend("Grok", agent=False))
    (commands,) = telegram.sent("setMyCommands")
    names = [c["command"] for c in commands["commands"]]
    assert names[:2] == ["claude", "grok"] and "all" in names and "gpt" not in names


def test_non_text_messages(tmp_path):
    update = message("x")
    del update["message"]["text"]
    update["message"]["sticker"] = {
        "file_id": "s", "file_unique_id": "s", "type": "regular", "width": 1, "height": 1,
        "is_animated": False, "is_video": False,
    }
    telegram = run_bot(tmp_path, [update])
    assert "only read text" in telegram.texts()[0]
