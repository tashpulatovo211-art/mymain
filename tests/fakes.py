"""Stand-ins for the CLIs, the model backends and Telegram."""

from __future__ import annotations

import json
import os
import stat
import sys
import textwrap
from pathlib import Path

from telegram.request import BaseRequest

from multibot.backends import Backend, BackendError, Request

# A fake claude/codex/gemini. It records how it was started (argv, stdin,
# cwd, env) to $FAKE_LOG and answers in the real CLI's output format.
# $FAKE_MODE picks the behavior: ok, error, hang.
FAKE_CLI = textwrap.dedent(
    r'''
    import json, os, sys, time
    from pathlib import Path

    kind = Path(sys.argv[0]).name
    argv = sys.argv[1:]
    prompt = sys.stdin.read()
    mode = os.environ.get("FAKE_MODE", "ok")
    with open(os.environ["FAKE_LOG"], "a", encoding="utf-8") as log:
        log.write(json.dumps({"kind": kind, "argv": argv, "stdin": prompt, "cwd": os.getcwd(),
                              "env": dict(os.environ)}) + "\n")
    if mode == "hang":
        time.sleep(60)
    last_line = prompt.strip().splitlines()[-1]
    agent = "--permission-mode" in argv or "workspace-write" in argv or "auto_edit" in argv
    if agent and mode == "ok":
        Path(f"made-by-{kind}.txt").write_text("hello", encoding="utf-8")

    if kind == "claude":
        if mode == "error":
            print(json.dumps({"type": "result", "subtype": "success", "is_error": True,
                              "result": "Not logged in · Please run /login"}))
        else:
            print(json.dumps({"type": "result", "subtype": "success", "is_error": False,
                              "result": f"claude says: {last_line}"}))
    elif kind == "codex":
        if mode == "error":
            print("ERROR: unexpected status 401 Unauthorized", file=sys.stderr)
            sys.exit(1)
        out = argv[argv.index("--output-last-message") + 1]
        Path(out).write_text(f"codex says: {last_line}", encoding="utf-8")
        print("progress noise", file=sys.stderr)
    elif kind == "gemini":
        print("Loaded cached credentials.")
        if mode == "error":
            inner = json.dumps({"error": {"code": 400, "message": "API key not valid. Please pass a valid API key."}})
            outer = json.dumps({"error": {"message": inner, "code": 400}})
            print(json.dumps({"session_id": "x", "error": {"type": "Error", "message": outer, "code": 400}}, indent=2))
            sys.exit(1)
        print(json.dumps({"session_id": "x", "response": f"gemini says: {last_line}", "stats": {}}, indent=2))
    '''
)


def install_fake_clis(folder: Path) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    for name in ("claude", "codex", "gemini"):
        path = folder / name
        path.write_text(f"#!{sys.executable}\n{FAKE_CLI}", encoding="utf-8")
        path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return folder


def read_log(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


class FakeBackend(Backend):
    def __init__(self, name: str, reply: str = "", fail: str = "", agent: bool = True, make_file: str = ""):
        self.name = name
        self.via = f"fake {name}"
        self.reply = reply or f"{name} reply"
        self.fail = fail
        self.supports_agent = agent
        self.agent_powers = "can do fake things"
        self.make_file = make_file
        self.requests: list[Request] = []

    async def ask(self, req: Request) -> str:
        self.requests.append(req)
        if self.fail:
            raise BackendError(self.fail)
        if req.agent and self.make_file:
            (req.cwd / self.make_file).write_text("made by agent", encoding="utf-8")
        return self.reply


class FakeTelegram(BaseRequest):
    """Answers Bot API calls locally and records them."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []

    @property
    def read_timeout(self) -> float | None:
        return 5

    async def initialize(self) -> None:
        pass

    async def shutdown(self) -> None:
        pass

    async def do_request(self, url, method, request_data=None, *args, **kwargs):
        name = url.rsplit("/", 1)[-1]
        params = dict(request_data.parameters) if request_data else {}
        self.calls.append((name, params))
        if name == "getMe":
            result = {"id": 999, "is_bot": True, "first_name": "Bot", "username": "test_bot"}
        elif name in ("sendMessage", "sendDocument", "editMessageText"):
            result = {"message_id": len(self.calls), "date": 0, "chat": {"id": params.get("chat_id", 0), "type": "private"},
                      "text": params.get("text", "")}
        else:
            result = True
        return 200, json.dumps({"ok": True, "result": result}).encode()

    def sent(self, name: str = "sendMessage") -> list[dict]:
        return [params for call, params in self.calls if call == name]

    def texts(self) -> list[str]:
        return [params["text"] for params in self.sent()]


def fake_environ(**extra: str) -> dict[str, str]:
    env = {"PATH": os.environ.get("PATH", "")}
    env.update(extra)
    return env


def make_config(tmp_path: Path, **values: str):
    from multibot.config import load_config

    environ = fake_environ(STATE_DIR=str(tmp_path / "state"), WORKSPACE_DIR=str(tmp_path / "workspace"), **values)
    return load_config(env_file=tmp_path / "no.env", environ=environ)
