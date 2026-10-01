import os

import pytest

from multibot.config import cli_env, load_config, parse_user_ids
from multibot.conversation import Turn, recent, render_prompt, to_messages
from multibot.text import split_message


def test_env_file_keys_stay_out_of_the_environment(tmp_path, monkeypatch):
    monkeypatch.delenv("XAI_API_KEY", raising=False)
    env_file = tmp_path / ".env"
    env_file.write_text("XAI_API_KEY=xai-secret\nALLOWED_USER_IDS=123, 456\nDEFAULT_MODEL=GPT\n")
    cfg = load_config(env_file=env_file, environ={})
    assert cfg.get("XAI_API_KEY") == "xai-secret"
    assert cfg.allowed_user_ids == {123, 456}
    assert cfg.default_model == "gpt"
    assert "XAI_API_KEY" not in os.environ


def test_environment_overrides_env_file(tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text("DEFAULT_MODEL=claude\n")
    assert load_config(env_file=env_file, environ={"DEFAULT_MODEL": "grok"}).default_model == "grok"


def test_bad_user_id():
    with pytest.raises(SystemExit):
        parse_user_ids("123,@me")


def test_cli_env_strips_api_keys(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "x")
    monkeypatch.setenv("GOOGLE_API_KEY", "y")
    env = cli_env({"EXTRA": "1"})
    assert "ANTHROPIC_API_KEY" not in env and "GOOGLE_API_KEY" not in env
    assert env["EXTRA"] == "1" and "PATH" in env


def test_recent_keeps_newest_turns_within_budget():
    turns = [Turn("a" * 10, "b" * 10, "X"), Turn("c" * 10, "d" * 10, "Y"), Turn("e", "f", "Z")]
    assert recent(turns, 21) == turns[2:]
    assert recent(turns, 22) == turns[1:]
    assert recent(turns, 42) == turns
    assert recent(turns, 0) == []


def test_render_prompt_labels_who_said_what():
    prompt = render_prompt([Turn("hi", "hello", "Gemini")], "how are you?", "SYSTEM")
    assert prompt.startswith("SYSTEM")
    assert "User: hi\n\nAssistant (Gemini): hello" in prompt
    assert prompt.endswith("how are you?")
    assert render_prompt([], "just this") == "just this"


def test_to_messages_alternates():
    messages = to_messages([Turn("q", "a", "X")], "next")
    assert messages == [
        {"role": "user", "content": "q"},
        {"role": "assistant", "content": "a"},
        {"role": "user", "content": "next"},
    ]


def test_split_message():
    assert split_message("short") == ["short"]
    assert split_message("   ") == ["(empty reply)"]
    lines = "\n".join(f"line {i:04d}" for i in range(1000))
    chunks = split_message(lines, limit=100)
    assert all(len(c) <= 100 for c in chunks)
    assert "\n".join(chunks) == lines
    assert split_message("x" * 250, limit=100) == ["x" * 100, "x" * 100, "x" * 50]
