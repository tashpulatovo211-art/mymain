import asyncio
import json
import time

import httpx
import pytest

from multibot.backends import (
    AnthropicAPI,
    BackendError,
    ClaudeCLI,
    CodexCLI,
    GeminiCLI,
    OpenAICompatibleAPI,
    PromptFiles,
    Request,
    build_backends,
    error_message,
    find_json,
)
from multibot.conversation import Turn
from tests.fakes import install_fake_clis, make_config, read_log

HISTORY = [Turn("what's 2+2?", "4", "Claude")]


@pytest.fixture
def fake(tmp_path, monkeypatch):
    bin_dir = install_fake_clis(tmp_path / "bin")
    log = tmp_path / "calls.jsonl"
    monkeypatch.setenv("FAKE_LOG", str(log))
    monkeypatch.setenv("FAKE_MODE", "ok")
    # Keys that must never reach a CLI, or it would bill them instead of your plan.
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-leak")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-leak")
    monkeypatch.setenv("GEMINI_API_KEY", "leak")
    files = PromptFiles.write(tmp_path / "state")
    chat_dir = tmp_path / "chat"
    workspace = tmp_path / "workspace"
    chat_dir.mkdir()
    workspace.mkdir()
    return {"bin": bin_dir, "log": log, "files": files, "chat": chat_dir, "workspace": workspace}


def make(cls, fake, model="", timeout=20):
    return cls(str(fake["bin"] / {"ClaudeCLI": "claude", "CodexCLI": "codex", "GeminiCLI": "gemini"}[cls.__name__]),
               model, fake["files"], timeout)


def req(fake, message="and 3+3?", agent=False):
    return Request("SYSTEM TEXT", HISTORY, message, fake["workspace"] if agent else fake["chat"], agent)


@pytest.mark.parametrize("cls", [ClaudeCLI, CodexCLI, GeminiCLI])
def test_cli_chat_reply_and_safety(cls, fake):
    reply = asyncio.run(make(cls, fake).ask(req(fake)))
    assert reply.endswith("says: and 3+3?")

    (call,) = read_log(fake["log"])
    # The prompt, history included, goes through stdin, never the command line.
    assert "and 3+3?" in call["stdin"] and "what's 2+2?" in call["stdin"]
    assert not any("3+3" in arg for arg in call["argv"])
    for key in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY"):
        assert key not in call["env"]
    assert call["cwd"] == str(fake["chat"])


def test_claude_flags(fake):
    asyncio.run(make(ClaudeCLI, fake, model="opus").ask(req(fake)))
    asyncio.run(make(ClaudeCLI, fake).ask(req(fake, agent=True)))
    chat, agent = read_log(fake["log"])
    assert chat["argv"][chat["argv"].index("--tools") + 1] == ""
    assert chat["argv"][chat["argv"].index("--model") + 1] == "opus"
    assert "--system-prompt-file" in chat["argv"]
    tools = agent["argv"][agent["argv"].index("--tools") + 1]
    assert "Write" in tools and "Bash" not in tools
    assert agent["argv"][agent["argv"].index("--permission-mode") + 1] == "acceptEdits"
    assert agent["cwd"] == str(fake["workspace"])


def test_codex_flags(fake):
    asyncio.run(make(CodexCLI, fake).ask(req(fake)))
    asyncio.run(make(CodexCLI, fake).ask(req(fake, agent=True)))
    chat, agent = read_log(fake["log"])
    assert chat["argv"][chat["argv"].index("--sandbox") + 1] == "read-only"
    assert agent["argv"][agent["argv"].index("--sandbox") + 1] == "workspace-write"
    assert chat["argv"][-1] == "-"
    # Codex gets no system prompt flag, so the instructions lead the prompt.
    assert chat["stdin"].startswith("SYSTEM TEXT")
    assert "Agent mode is on" in agent["stdin"]


def test_gemini_flags(fake):
    asyncio.run(make(GeminiCLI, fake).ask(req(fake)))
    asyncio.run(make(GeminiCLI, fake).ask(req(fake, agent=True)))
    chat, agent = read_log(fake["log"])
    assert chat["env"]["GEMINI_SYSTEM_MD"] == str(fake["files"].chat_system)
    assert chat["argv"][chat["argv"].index("--policy") + 1] == str(fake["files"].gemini_chat_policy)
    assert 'toolName = "*"' in fake["files"].gemini_chat_policy.read_text()
    assert agent["argv"][agent["argv"].index("--approval-mode") + 1] == "auto_edit"
    assert "run_shell_command" in fake["files"].gemini_agent_policy.read_text()
    assert "GEMINI_SYSTEM_MD" not in agent["env"]


@pytest.mark.parametrize(
    "cls, expected, hint",
    [
        (ClaudeCLI, "Not logged in", "run `claude`"),
        (CodexCLI, "401 Unauthorized", "codex login"),
        (GeminiCLI, "API key not valid. Please pass a valid API key.", "Sign in with Google"),
    ],
)
def test_cli_errors_are_readable(cls, expected, hint, fake, monkeypatch):
    monkeypatch.setenv("FAKE_MODE", "error")
    with pytest.raises(BackendError) as err:
        asyncio.run(make(cls, fake).ask(req(fake)))
    assert expected in str(err.value)
    assert hint in str(err.value)


def test_login_hint_for_unconfigured_gemini(fake):
    error = make(GeminiCLI, fake).fail("Please set an Auth method in your /root/.gemini/settings.json")
    assert "Sign in with Google" in str(error)


def test_cli_timeout_kills_process(fake, monkeypatch):
    monkeypatch.setenv("FAKE_MODE", "hang")
    start = time.monotonic()
    with pytest.raises(BackendError, match="No answer after 1 seconds"):
        asyncio.run(make(ClaudeCLI, fake, timeout=1).ask(req(fake)))
    assert time.monotonic() - start < 10


def test_missing_program(fake):
    backend = ClaudeCLI("/nowhere/claude", "", fake["files"], 5)
    with pytest.raises(BackendError, match="Is it installed"):
        asyncio.run(backend.ask(req(fake)))


def mock_http(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def test_anthropic_api():
    seen = {}

    def handler(request):
        seen["url"] = str(request.url)
        seen["headers"] = request.headers
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"content": [{"type": "text", "text": "hi there"}], "stop_reason": "end_turn"})

    backend = AnthropicAPI(mock_http(handler), "sk-ant-x", "claude-sonnet-5-5")
    reply = asyncio.run(backend.ask(Request("SYS", HISTORY, "and 3+3?", None)))
    assert reply == "hi there"
    assert seen["url"] == "https://api.anthropic.com/v1/messages"
    assert seen["headers"]["x-api-key"] == "sk-ant-x"
    assert seen["body"]["system"] == "SYS"
    assert [m["role"] for m in seen["body"]["messages"]] == ["user", "assistant", "user"]


def test_openai_compatible_api():
    seen = {}

    def handler(request):
        seen["url"] = str(request.url)
        seen["auth"] = request.headers["authorization"]
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"choices": [{"message": {"content": "grok here"}}]})

    backend = OpenAICompatibleAPI(mock_http(handler), "Grok", "https://api.x.ai/v1", "xai-k", "grok-4.6", "xAI API key")
    reply = asyncio.run(backend.ask(Request("SYS", HISTORY, "and 3+3?", None)))
    assert reply == "grok here"
    assert seen["url"] == "https://api.x.ai/v1/chat/completions"
    assert seen["auth"] == "Bearer xai-k"
    assert seen["body"]["model"] == "grok-4.6"
    assert seen["body"]["messages"][0] == {"role": "system", "content": "SYS"}


def test_api_error_message():
    def handler(request):
        return httpx.Response(401, json={"error": {"message": "Incorrect API key provided"}})

    backend = OpenAICompatibleAPI(mock_http(handler), "GPT", "https://api.openai.com/v1", "bad", "gpt-5.5", "OpenAI")
    with pytest.raises(BackendError, match="API error 401: Incorrect API key provided"):
        asyncio.run(backend.ask(Request("SYS", [], "hi", None)))


def test_build_backends_prefers_cli_then_api(tmp_path):
    bin_dir = install_fake_clis(tmp_path / "bin")
    cfg = make_config(
        tmp_path,
        CLAUDE_BIN=str(bin_dir / "claude"),
        CODEX_BIN=str(bin_dir / "codex"),
        GEMINI_BIN=str(tmp_path / "not-installed"),
        ANTHROPIC_API_KEY="sk-ant",
        GEMINI_API_KEY="g",
        XAI_API_KEY="x",
    )
    backends = build_backends(cfg, None, PromptFiles.write(tmp_path / "state"))
    assert list(backends) == ["claude", "gpt", "gemini", "grok"]
    assert isinstance(backends["claude"], ClaudeCLI)  # CLI wins over the API key
    assert isinstance(backends["gpt"], CodexCLI)
    assert isinstance(backends["gemini"], OpenAICompatibleAPI)  # no CLI, so the key
    assert backends["grok"].model == "grok-4.6"


def test_build_backends_source_override(tmp_path):
    bin_dir = install_fake_clis(tmp_path / "bin")
    cfg = make_config(tmp_path, CLAUDE_BIN=str(bin_dir / "claude"), ANTHROPIC_API_KEY="k", CLAUDE_SOURCE="api",
                      CODEX_BIN=str(tmp_path / "none"), GEMINI_BIN=str(tmp_path / "none"))
    backends = build_backends(cfg, None, PromptFiles.write(tmp_path / "state"))
    assert isinstance(backends["claude"], AnthropicAPI)
    assert "gpt" not in backends

    bad = make_config(tmp_path, GROK_SOURCE="subscription")
    with pytest.raises(SystemExit):
        build_backends(bad, None, PromptFiles.write(tmp_path / "state"))


def test_find_json_skips_noise():
    text = 'Warning: something\n{\n  "response": "hi",\n  "stats": {\n    "a": 1\n  }\n}\ntrailing'
    assert find_json(text) == {"response": "hi", "stats": {"a": 1}}
    assert find_json("no json here") is None


def test_error_message_unwraps_nested_json():
    inner = json.dumps({"error": {"code": 429, "message": "Quota exceeded"}})
    assert error_message({"error": {"message": json.dumps({"error": {"message": inner}})}}) == "Quota exceeded"
    assert error_message({"error": {"message": "plain"}}) == "plain"
    assert error_message(None) == ""
