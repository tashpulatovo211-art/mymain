"""Model backends.

CLI backends run the official command-line apps (claude, codex, gemini) that
you signed in to with your own subscription. This app never reads or copies
their login tokens; it starts the unmodified programs the same way you would
in a terminal. API backends call a provider's HTTP API with a pay-per-use key.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import signal
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

import httpx

from .config import Config, cli_env
from .conversation import Turn, render_prompt, to_messages

FAMILIES = ("claude", "gpt", "gemini", "grok")

SYSTEM_PROMPT = (
    "You are a personal assistant inside a private chat bot that can switch between "
    "several AI models (Claude, GPT, Gemini, Grok). Earlier replies in the conversation "
    "may have come from a different model. Answer directly and keep replies short unless "
    "the user asks for detail. The user often reads on a phone, so prefer plain text or "
    "light Markdown over wide tables."
)

AGENT_NOTE = (
    "Agent mode is on. You may create and edit files in the current folder and use the "
    "tools you have, but stay inside the current folder. Every file you create or change "
    "there is sent to the user when you finish, so save deliverables as files instead of "
    "pasting long content. End with a short summary of what you did."
)

GEMINI_OPENAI_URL = "https://generativelanguage.googleapis.com/v1beta/openai"

_AUTH_ERROR = re.compile(
    r"/login|\blog ?in\b|sign ?in|not logged|unauthori[sz]ed|authenticat|auth method|credential|api key",
    re.IGNORECASE,
)


class BackendError(Exception):
    """A model call failed. The message is meant for the user."""


@dataclass
class Request:
    system: str
    history: list[Turn]
    message: str
    cwd: Path
    agent: bool = False


class Backend:
    name = ""
    via = ""
    supports_agent = False
    agent_powers = ""  # what it can do in agent mode, for the user

    async def ask(self, req: Request) -> str:
        raise NotImplementedError


@dataclass
class PromptFiles:
    """Files the CLIs read their instructions from."""

    chat_system: Path
    agent_note: Path
    gemini_chat_policy: Path
    gemini_agent_policy: Path

    @classmethod
    def write(cls, folder: Path) -> PromptFiles:
        folder.mkdir(parents=True, exist_ok=True)
        files = cls(
            chat_system=folder / "chat-system.md",
            agent_note=folder / "agent-note.md",
            gemini_chat_policy=folder / "gemini-chat-policy.toml",
            gemini_agent_policy=folder / "gemini-agent-policy.toml",
        )
        files.chat_system.write_text(SYSTEM_PROMPT, encoding="utf-8")
        files.agent_note.write_text(f"{SYSTEM_PROMPT}\n\n{AGENT_NOTE}", encoding="utf-8")
        # Plain chat gets no tools at all; agent mode gets everything but the shell.
        files.gemini_chat_policy.write_text(_deny_rule("*"), encoding="utf-8")
        files.gemini_agent_policy.write_text(_deny_rule("run_shell_command"), encoding="utf-8")
        return files


def _deny_rule(tool: str) -> str:
    return f'[[rule]]\ntoolName = "{tool}"\ndecision = "deny"\npriority = 999\n'


# ---------------------------------------------------------------- CLI backends


async def run_cli(
    argv: list[str], prompt: str, cwd: Path, env: dict[str, str], timeout: float
) -> tuple[int, str, str]:
    """Run a CLI with the prompt on stdin. Returns (exit code, stdout, stderr)."""
    # The prompt never goes on the command line: on Windows the CLIs are .cmd
    # scripts, and cmd.exe would act on characters like & and " in arguments.
    try:
        proc = await asyncio.create_subprocess_exec(
            *argv,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=cwd,
            env=env,
            start_new_session=os.name != "nt",
        )
    except FileNotFoundError:
        raise BackendError(f"Couldn't start {argv[0]}. Is it installed?") from None
    try:
        out, err = await asyncio.wait_for(proc.communicate(prompt.encode("utf-8")), timeout)
    except asyncio.TimeoutError:
        _kill(proc)
        await proc.wait()
        raise BackendError(f"No answer after {timeout:.0f} seconds, so I stopped it.") from None
    except asyncio.CancelledError:
        _kill(proc)
        raise
    return proc.returncode, out.decode("utf-8", "replace"), err.decode("utf-8", "replace")


def _kill(proc: asyncio.subprocess.Process) -> None:
    if proc.returncode is not None:
        return
    try:
        if os.name == "nt":
            # /T also ends the node process that the .cmd script started.
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)], capture_output=True)
        else:
            os.killpg(proc.pid, signal.SIGKILL)
    except OSError:
        pass


class CliBackend(Backend):
    supports_agent = True
    service = ""
    login_hint = ""

    def __init__(self, binary: str, model: str, files: PromptFiles, timeout: float):
        self.binary = binary
        self.model = model
        self.files = files
        self.timeout = timeout
        self.via = self.service + (f", model {model}" if model else "")

    def fail(self, detail: str) -> BackendError:
        detail = detail.strip() or "It stopped without an answer."
        if _AUTH_ERROR.search(detail):
            detail += f"\n\n{self.login_hint}"
        return BackendError(detail)


class ClaudeCLI(CliBackend):
    name = "Claude"
    service = "Claude Code, your Claude plan"
    agent_powers = "can read, write and edit files there and search the web, but can't run commands"
    login_hint = "On the bot's computer, run `claude` in a terminal and sign in with your Claude account."

    def command(self, req: Request) -> list[str]:
        cmd = [self.binary, "-p", "--output-format", "json", "--no-session-persistence", "--strict-mcp-config"]
        if req.agent:
            # File tools and web access, no shell. acceptEdits lets it write
            # files in the working folder without stopping to ask.
            cmd += [
                "--tools", "Read,Write,Edit,Glob,Grep,WebSearch,WebFetch",
                "--allowedTools", "WebSearch,WebFetch",
                "--permission-mode", "acceptEdits",
                "--append-system-prompt-file", str(self.files.agent_note),
            ]
        else:
            cmd += ["--tools", "", "--system-prompt-file", str(self.files.chat_system)]
        if self.model:
            cmd += ["--model", self.model]
        return cmd

    async def ask(self, req: Request) -> str:
        prompt = render_prompt(req.history, req.message)
        code, out, err = await run_cli(self.command(req), prompt, req.cwd, cli_env(), self.timeout)
        data = find_json(out)
        if data is None:
            raise self.fail(tail(err) or tail(out) or f"claude exited with code {code}.")
        if data.get("is_error") or data.get("subtype") != "success":
            raise self.fail(str(data.get("result") or data.get("subtype") or ""))
        return str(data.get("result") or "").strip()


class CodexCLI(CliBackend):
    name = "GPT"
    service = "Codex, your ChatGPT plan"
    agent_powers = "can edit files and run commands, inside Codex's sandbox that only lets it write in that folder"
    login_hint = "On the bot's computer, run `codex login` and choose Sign in with ChatGPT."

    def command(self, req: Request, reply_file: Path) -> list[str]:
        cmd = [
            self.binary, "exec", "--skip-git-repo-check", "--ephemeral", "--color", "never",
            # read-only: Codex may look but not change anything. workspace-write:
            # Codex's own sandbox, which only lets it write in the working folder.
            "--sandbox", "workspace-write" if req.agent else "read-only",
            "--cd", str(req.cwd),
            "--output-last-message", str(reply_file),
        ]
        if self.model:
            cmd += ["--model", self.model]
        cmd.append("-")  # read the prompt from stdin
        return cmd

    async def ask(self, req: Request) -> str:
        system = f"{req.system}\n\n{AGENT_NOTE}" if req.agent else req.system
        prompt = render_prompt(req.history, req.message, system)
        with tempfile.TemporaryDirectory() as tmp:
            reply_file = Path(tmp) / "reply.txt"
            code, out, err = await run_cli(self.command(req, reply_file), prompt, req.cwd, cli_env(), self.timeout)
            reply = reply_file.read_text(encoding="utf-8").strip() if reply_file.exists() else ""
        if code != 0 or not reply:
            raise self.fail(tail(err) or tail(out) or f"codex exited with code {code}.")
        return reply


class GeminiCLI(CliBackend):
    name = "Gemini"
    service = "Gemini CLI, your Google account"
    agent_powers = "can read, write and edit files there and search the web, but can't run commands"
    login_hint = (
        "On the bot's computer, run `gemini` in a terminal and choose Sign in with Google, "
        "using the account that has your Google AI plan."
    )

    def command(self, req: Request) -> list[str]:
        cmd = [self.binary, "--output-format", "json", "--skip-trust"]
        if req.agent:
            # auto_edit approves file edits; the policy file blocks shell commands.
            cmd += ["--approval-mode", "auto_edit", "--policy", str(self.files.gemini_agent_policy)]
        else:
            cmd += ["--approval-mode", "default", "--policy", str(self.files.gemini_chat_policy)]
        if self.model:
            cmd += ["--model", self.model]
        return cmd

    async def ask(self, req: Request) -> str:
        if req.agent:
            env = cli_env()
            prompt = render_prompt(req.history, req.message, f"{req.system}\n\n{AGENT_NOTE}")
        else:
            # Swap Gemini CLI's coding-agent system prompt for ours.
            env = cli_env({"GEMINI_SYSTEM_MD": str(self.files.chat_system)})
            prompt = render_prompt(req.history, req.message)
        # With stdin and stdout piped, Gemini CLI runs headless and reads the prompt from stdin.
        code, out, err = await run_cli(self.command(req), prompt, req.cwd, env, self.timeout)
        data = find_json(out) or find_json(err)
        if data is None:
            raise self.fail(tail(err) or tail(out) or f"gemini exited with code {code}.")
        if data.get("error"):
            raise self.fail(error_message(data["error"]) or str(data["error"]))
        reply = str(data.get("response") or "").strip()
        if not reply:
            raise self.fail(f"gemini exited with code {code} and no answer.")
        return reply


# ---------------------------------------------------------------- API backends


class AnthropicAPI(Backend):
    name = "Claude"
    url = "https://api.anthropic.com/v1/messages"

    def __init__(self, http: httpx.AsyncClient, key: str, model: str):
        self.http = http
        self.key = key
        self.model = model
        self.via = f"Anthropic API key, {model}, pay per use"

    async def ask(self, req: Request) -> str:
        data = await post_json(
            self.http,
            self.url,
            headers={"x-api-key": self.key, "anthropic-version": "2023-06-01"},
            body={
                "model": self.model,
                "max_tokens": 8192,
                "system": req.system,
                "messages": to_messages(req.history, req.message),
            },
        )
        blocks = data.get("content") or []
        text = "".join(b.get("text", "") for b in blocks if isinstance(b, dict) and b.get("type") == "text")
        if not text.strip():
            raise BackendError(f"Empty reply (stop reason: {data.get('stop_reason')}).")
        return text.strip()


class OpenAICompatibleAPI(Backend):
    """Any chat-completions API: OpenAI, xAI (Grok), and Gemini's compatible endpoint."""

    def __init__(self, http: httpx.AsyncClient, name: str, base_url: str, key: str, model: str, service: str):
        self.http = http
        self.name = name
        self.base_url = base_url.rstrip("/")
        self.key = key
        self.model = model
        self.via = f"{service}, {model}, pay per use"

    async def ask(self, req: Request) -> str:
        data = await post_json(
            self.http,
            f"{self.base_url}/chat/completions",
            headers={"Authorization": f"Bearer {self.key}"},
            body={
                "model": self.model,
                "messages": [{"role": "system", "content": req.system}, *to_messages(req.history, req.message)],
            },
        )
        try:
            text = data["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError):
            text = ""
        if not text.strip():
            raise BackendError("The API sent back an empty reply.")
        return text.strip()


async def post_json(http: httpx.AsyncClient, url: str, headers: dict[str, str], body: dict) -> dict:
    try:
        resp = await http.post(url, headers=headers, json=body)
    except httpx.TimeoutException:
        raise BackendError("The API took too long to answer.") from None
    except httpx.HTTPError as e:
        raise BackendError(f"Couldn't reach the API: {e}") from None
    try:
        data = resp.json()
    except ValueError:
        data = None
    if resp.status_code != 200:
        detail = error_message(data) or resp.text[:300]
        raise BackendError(f"API error {resp.status_code}: {detail}")
    if not isinstance(data, dict):
        raise BackendError("The API sent back something that isn't JSON.")
    return data


# ---------------------------------------------------------------- setup


def find_program(name: str) -> str | None:
    return shutil.which(os.path.expanduser(name)) if name else None


def build_backends(cfg: Config, http: httpx.AsyncClient, files: PromptFiles) -> dict[str, Backend]:
    """Pick one backend per model family: the CLI (your plan) first, else an API key."""
    clis: dict[str, Backend] = {}
    if path := find_program(cfg.get("CLAUDE_BIN", "claude")):
        clis["claude"] = ClaudeCLI(path, cfg.get("CLAUDE_MODEL"), files, cfg.timeout)
    if path := find_program(cfg.get("CODEX_BIN", "codex")):
        clis["gpt"] = CodexCLI(path, cfg.get("CODEX_MODEL"), files, cfg.timeout)
    if path := find_program(cfg.get("GEMINI_BIN", "gemini")):
        clis["gemini"] = GeminiCLI(path, cfg.get("GEMINI_MODEL"), files, cfg.timeout)

    apis: dict[str, Backend] = {}
    if key := cfg.get("ANTHROPIC_API_KEY"):
        apis["claude"] = AnthropicAPI(http, key, cfg.get("ANTHROPIC_MODEL", "claude-sonnet-5-5"))
    if key := cfg.get("OPENAI_API_KEY"):
        model = cfg.get("OPENAI_MODEL", "gpt-5.5")
        apis["gpt"] = OpenAICompatibleAPI(http, "GPT", "https://api.openai.com/v1", key, model, "OpenAI API key")
    if key := cfg.get("GEMINI_API_KEY"):
        model = cfg.get("GEMINI_API_MODEL", "gemini-3.5-flash")
        apis["gemini"] = OpenAICompatibleAPI(http, "Gemini", GEMINI_OPENAI_URL, key, model, "Gemini API key")
    if key := cfg.get("XAI_API_KEY"):
        model = cfg.get("XAI_MODEL", "grok-4.6")
        apis["grok"] = OpenAICompatibleAPI(http, "Grok", "https://api.x.ai/v1", key, model, "xAI API key")

    backends: dict[str, Backend] = {}
    for family in FAMILIES:
        source = cfg.get(f"{family.upper()}_SOURCE", "auto").lower()
        if source not in ("auto", "cli", "api"):
            raise SystemExit(f"{family.upper()}_SOURCE must be auto, cli or api, not {source!r}")
        if source != "api" and family in clis:
            backends[family] = clis[family]
        elif source != "cli" and family in apis:
            backends[family] = apis[family]
    return backends


# ---------------------------------------------------------------- parsing helpers


def find_json(text: str) -> dict | None:
    """The last top-level JSON object in text. CLIs sometimes print warnings around it."""
    decoder = json.JSONDecoder()
    found = None
    for match in re.finditer(r"^\{", text, re.MULTILINE):
        try:
            obj, _ = decoder.raw_decode(text, match.start())
        except ValueError:
            continue
        if isinstance(obj, dict):
            found = obj
    return found


def error_message(data: object) -> str:
    """The innermost "message" in an error. Gemini nests JSON error text inside strings."""
    message = _first_key(data, "message")
    for _ in range(5):
        if not isinstance(message, str):
            return ""
        try:
            inner = json.loads(message)
        except ValueError:
            break
        deeper = _first_key(inner, "message")
        if not isinstance(deeper, str):
            break
        message = deeper
    return message.strip()


def _first_key(data: object, key: str) -> object:
    if isinstance(data, dict):
        if key in data:
            return data[key]
        children = list(data.values())
    elif isinstance(data, list):
        children = data
    else:
        return None
    for child in children:
        found = _first_key(child, key)
        if found is not None:
            return found
    return None


def tail(text: str, limit: int = 600) -> str:
    text = text.strip()
    return text if len(text) <= limit else "…" + text[-limit:]
