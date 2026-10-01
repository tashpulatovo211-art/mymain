"""The part shared by the Telegram bot and the terminal chat."""

from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Awaitable, Callable, Union

import httpx

from .backends import SYSTEM_PROMPT, Backend, BackendError, PromptFiles, Request, build_backends
from .config import Config
from .conversation import Chat, Turn, recent

log = logging.getLogger(__name__)

HELP = """\
Send a message and the current model answers. The conversation carries over when you switch models.

/claude, /gpt, /gemini, /grok - switch model (add a question to ask it right away)
/all question - ask every model at once
/agent - agent mode on/off: the model can make files and browse, and you get the files
/new - start a fresh conversation
/model - what's set up"""

SETUP_HINTS = {
    "claude": "Install Claude Code and sign in with your Claude account, or set ANTHROPIC_API_KEY.",
    "gpt": "Install Codex and run `codex login`, or set OPENAI_API_KEY.",
    "gemini": "Install Gemini CLI and sign in with Google, or set GEMINI_API_KEY.",
    "grok": "Set XAI_API_KEY. SuperGrok doesn't include API access, so Grok is pay per use.",
}

SKIP_DIRS = {"node_modules", "__pycache__", "venv"}
MAX_TRACKED_FILES = 20000

AnswerCallback = Callable[[str, Union[str, BackendError]], Awaitable[None]]


@dataclass
class Answer:
    by: str
    text: str
    files: list[Path] = field(default_factory=list)


class Assistant:
    def __init__(self, cfg: Config, backends: dict[str, Backend] | None = None):
        self.cfg = cfg
        self.http = httpx.AsyncClient(timeout=cfg.timeout)
        # Plain chat runs the CLIs in an empty folder, away from your files.
        self.chat_dir = cfg.state_dir / "chat"
        self.chat_dir.mkdir(parents=True, exist_ok=True)
        cfg.workspace.mkdir(parents=True, exist_ok=True)
        files = PromptFiles.write(cfg.state_dir)
        self.backends = build_backends(cfg, self.http, files) if backends is None else backends
        self.chats: dict[object, Chat] = {}

    async def aclose(self) -> None:
        await self.http.aclose()

    def chat(self, chat_id: object) -> Chat:
        if chat_id not in self.chats:
            default = self.cfg.default_model
            if default not in self.backends:
                default = next(iter(self.backends), "")
            self.chats[chat_id] = Chat(model=default)
        return self.chats[chat_id]

    # Commands. Each returns the text to show the user.

    def switch(self, chat: Chat, family: str) -> str:
        backend = self.backends.get(family)
        if backend is None:
            return f"{family} isn't set up. {SETUP_HINTS.get(family, '')}".strip()
        chat.model = family
        return f"Now talking to {backend.name} ({backend.via})."

    def toggle_agent(self, chat: Chat) -> str:
        chat.agent = not chat.agent
        if not chat.agent:
            return "Agent mode off. Plain chat, no tools."
        lines = [
            f"Agent mode on. The model works in {self.cfg.workspace} and every file it makes "
            "or changes there is sent to you."
        ]
        lines += [f"{b.name} {b.agent_powers}." for b in self.backends.values() if b.supports_agent]
        chat_only = [b.name for b in self.backends.values() if not b.supports_agent]
        if chat_only:
            lines.append(f"{', '.join(chat_only)} runs on an API key and can only chat.")
        return "\n".join(lines)

    def reset(self, chat: Chat) -> str:
        chat.turns.clear()
        return "Started a fresh conversation."

    def status(self, chat: Chat) -> str:
        if not self.backends:
            return "No models are set up yet. See the README."
        current = self.backends.get(chat.model)
        lines = [f"Talking to: {current.name} ({current.via})" if current else "No model selected."]
        lines.append(f"Agent mode: {'on' if chat.agent else 'off'}")
        lines.append("Set up: " + ", ".join(b.name for b in self.backends.values()))
        missing = [f for f in SETUP_HINTS if f not in self.backends]
        for family in missing:
            lines.append(f"Not set up: {family}. {SETUP_HINTS[family]}")
        return "\n".join(lines)

    # Asking.

    async def ask(self, chat: Chat, text: str) -> Answer:
        async with chat.lock:
            backend = self.backends.get(chat.model)
            if backend is None:
                raise BackendError("No model is set up yet. See the README.")
            agent = chat.agent and backend.supports_agent
            cwd = self.cfg.workspace if agent else self.chat_dir
            before = await asyncio.to_thread(snapshot, cwd) if agent else {}
            history = recent(chat.turns, self.cfg.max_history_chars)
            try:
                reply = await backend.ask(Request(SYSTEM_PROMPT, history, text, cwd, agent))
            except BackendError as e:
                raise BackendError(f"{backend.name} didn't answer:\n{e}") from None
            files = changed_files(before, await asyncio.to_thread(snapshot, cwd)) if agent else []
            chat.add(Turn(text, reply, backend.name))
        return Answer(backend.name, reply, files)

    async def ask_all(self, chat: Chat, text: str, on_answer: AnswerCallback) -> None:
        """Ask every model at once, as plain chat, and report each answer as it arrives."""
        async with chat.lock:
            history = recent(chat.turns, self.cfg.max_history_chars)

            async def one(backend: Backend) -> tuple[str, str | BackendError]:
                try:
                    return backend.name, await backend.ask(Request(SYSTEM_PROMPT, history, text, self.chat_dir))
                except BackendError as e:
                    return backend.name, e
                except Exception as e:
                    log.exception("%s failed", backend.name)
                    return backend.name, BackendError(f"Unexpected error: {e}")

            tasks = [asyncio.ensure_future(one(b)) for b in self.backends.values()]
            replies = []
            try:
                for next_done in asyncio.as_completed(tasks):
                    name, result = await next_done
                    if isinstance(result, str):
                        replies.append(f"[{name}]\n{result}")
                    await on_answer(name, result)
            finally:
                for task in tasks:
                    task.cancel()
            if replies:
                chat.add(Turn(text, "\n\n".join(replies), "several models"))


def snapshot(root: Path) -> dict[Path, tuple[int, int]]:
    """Modification time and size of every visible file under root."""
    seen: dict[Path, tuple[int, int]] = {}
    for folder, subdirs, names in os.walk(root):
        subdirs[:] = [d for d in subdirs if not d.startswith(".") and d not in SKIP_DIRS]
        for name in names:
            if name.startswith("."):
                continue
            path = Path(folder) / name
            try:
                stat = path.stat()
            except OSError:
                continue
            seen[path] = (stat.st_mtime_ns, stat.st_size)
            if len(seen) >= MAX_TRACKED_FILES:
                return seen
    return seen


def changed_files(before: dict[Path, tuple[int, int]], after: dict[Path, tuple[int, int]]) -> list[Path]:
    """Files that are new or different, newest first."""
    changed = [path for path, sig in after.items() if before.get(path) != sig]
    return sorted(changed, key=lambda path: after[path][0], reverse=True)
