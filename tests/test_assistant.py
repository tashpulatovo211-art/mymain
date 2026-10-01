import asyncio

from multibot.assistant import Assistant
from tests.fakes import FakeBackend, make_config


def make_assistant(tmp_path, **backends):
    return Assistant(make_config(tmp_path), backends=backends)


def test_history_carries_across_models(tmp_path):
    claude, gpt = FakeBackend("Claude"), FakeBackend("GPT")
    assistant = make_assistant(tmp_path, claude=claude, gpt=gpt)
    chat = assistant.chat(1)
    assert chat.model == "claude"  # DEFAULT_MODEL

    answer = asyncio.run(assistant.ask(chat, "first question"))
    assert (answer.by, answer.text, answer.files) == ("Claude", "Claude reply", [])
    assert "Now talking to GPT" in assistant.switch(chat, "gpt")
    asyncio.run(assistant.ask(chat, "second question"))

    (request,) = gpt.requests
    assert [(t.user, t.reply, t.by) for t in request.history] == [("first question", "Claude reply", "Claude")]
    assert request.cwd == assistant.chat_dir and not request.agent


def test_switch_to_missing_model_explains_setup(tmp_path):
    assistant = make_assistant(tmp_path, claude=FakeBackend("Claude"))
    chat = assistant.chat(1)
    message = assistant.switch(chat, "grok")
    assert "XAI_API_KEY" in message and "SuperGrok" in message
    assert chat.model == "claude"


def test_default_falls_back_to_first_available(tmp_path):
    assistant = make_assistant(tmp_path, gemini=FakeBackend("Gemini"))
    assert assistant.chat(1).model == "gemini"


def test_agent_mode_returns_new_files(tmp_path):
    claude = FakeBackend("Claude", make_file="plan.txt")
    assistant = make_assistant(tmp_path, claude=claude)
    chat = assistant.chat(1)
    assert "Agent mode on" in assistant.toggle_agent(chat)

    answer = asyncio.run(assistant.ask(chat, "make a plan"))
    assert answer.files == [assistant.cfg.workspace / "plan.txt"]
    assert claude.requests[0].agent and claude.requests[0].cwd == assistant.cfg.workspace

    # Files the agent didn't touch this time aren't sent again.
    claude.make_file = ""
    assert asyncio.run(assistant.ask(chat, "nothing new")).files == []


def test_agent_mode_skips_chat_only_backends(tmp_path):
    grok = FakeBackend("Grok", agent=False)
    assistant = make_assistant(tmp_path, grok=grok)
    chat = assistant.chat(1)
    assert "Grok runs on an API key and can only chat" in assistant.toggle_agent(chat)
    asyncio.run(assistant.ask(chat, "hi"))
    assert not grok.requests[0].agent


def test_ask_all_reports_each_model(tmp_path):
    assistant = make_assistant(
        tmp_path, claude=FakeBackend("Claude"), gpt=FakeBackend("GPT", fail="usage limit reached")
    )
    chat = assistant.chat(1)
    seen = {}

    async def on_answer(name, result):
        seen[name] = str(result)

    asyncio.run(assistant.ask_all(chat, "compare", on_answer))
    assert seen == {"Claude": "Claude reply", "GPT": "usage limit reached"}
    (turn,) = chat.turns
    assert turn.user == "compare" and "[Claude]\nClaude reply" in turn.reply and "GPT" not in turn.reply


def test_reset_and_status(tmp_path):
    assistant = make_assistant(tmp_path, claude=FakeBackend("Claude"))
    chat = assistant.chat(1)
    asyncio.run(assistant.ask(chat, "hi"))
    assistant.reset(chat)
    assert chat.turns == []
    status = assistant.status(chat)
    assert "Talking to: Claude" in status and "Not set up: gpt" in status
