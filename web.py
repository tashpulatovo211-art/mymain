"""Plushie Chat on your own computer. Run: python web.py, then open http://localhost:8765"""

from __future__ import annotations

import asyncio
import hmac
import ipaddress
import json
import logging
import mimetypes
import queue
import secrets
import socket
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse

from multibot.assistant import SETUP_HINTS, Assistant
from multibot.backends import BackendError
from multibot.config import APP_DIR, Config, load_config

log = logging.getLogger("multibot.web")

PAGE = APP_DIR / "web" / "plushie-chat.html"
CHAT_ID = "web"
MAX_BODY = 1_000_000
MAX_TEXT = 20_000
LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}

# The same small document shell claude.ai wraps around the page.
SHELL = (
    '<!doctype html><html><head><meta charset="utf-8">'
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
    "<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);"
    "padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px/1.5 system-ui,sans-serif;"
    "background:#fafafa}img{max-width:100%}[hidden]{display:none!important}</style></head><body>"
)


class WebApp:
    """Connects the HTTP handler threads to the assistant, which runs on one asyncio loop."""

    def __init__(self, cfg: Config, assistant: Assistant, loop: asyncio.AbstractEventLoop):
        self.cfg = cfg
        self.assistant = assistant
        self.loop = loop
        # Pages get this token when they load; API calls without it are refused,
        # so other websites open in your browser can't talk to the plushies.
        self.token = secrets.token_urlsafe(24)
        self.passcode = cfg.get("WEB_PASSCODE")

    def run(self, coro):
        return asyncio.run_coroutine_threadsafe(coro, self.loop).result()

    def call(self, fn, *args):
        async def on_loop():
            return fn(*args)

        return self.run(on_loop())

    def chat(self):
        return self.call(self.assistant.chat, CHAT_ID)

    def key_for(self, name: str) -> str:
        for key, backend in self.assistant.backends.items():
            if backend.name == name:
                return key
        return "all"

    def page(self) -> bytes:
        config = {"local": True, "token": self.token}
        script = "<script>window.MULTIBOT=" + json.dumps(config).replace("</", "<\\/") + "</script>"
        html = PAGE.read_text(encoding="utf-8")
        return (SHELL + script + html + "</body></html>").encode("utf-8")

    def state(self) -> dict:
        chat = self.chat()

        def build() -> dict:
            backends = self.assistant.backends
            return {
                "models": [{"key": k, "name": b.name, "via": b.via, "agent": b.supports_agent} for k, b in backends.items()],
                "missing": {k: hint for k, hint in SETUP_HINTS.items() if k not in backends},
                "current": chat.model,
                "agent": chat.agent,
                "workspace": short_path(self.cfg.workspace),
                "turns": [{"user": t.user, "reply": t.reply, "key": self.key_for(t.by)} for t in chat.turns[-100:]],
            }

        return self.call(build)

    def file_info(self, path: Path) -> dict:
        rel = path.relative_to(self.cfg.workspace).as_posix()
        return {"name": path.name, "path": rel, "size": path.stat().st_size}


def short_path(path: Path) -> str:
    try:
        return "~/" + path.relative_to(Path.home()).as_posix()
    except ValueError:
        return str(path)


def host_allowed(host_header: str) -> bool:
    """Only localhost and plain IP addresses: blocks DNS-rebinding sites that pose as this server."""
    hostname = urlparse("//" + host_header).hostname or ""
    if hostname == "localhost":
        return True
    try:
        ipaddress.ip_address(hostname)
    except ValueError:
        return False
    return True


def same(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


def make_handler(app: WebApp):
    class Handler(BaseHTTPRequestHandler):
        server_version = "multibot"

        def log_message(self, format: str, *args) -> None:
            log.debug("%s %s", self.address_string(), format % args)

        # Responses

        def send_bytes(self, status: int, body: bytes, content_type: str, extra: dict | None = None) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            for name, value in (extra or {}).items():
                self.send_header(name, value)
            self.end_headers()
            self.wfile.write(body)

        def send_json(self, status: int, data: dict) -> None:
            self.send_bytes(status, json.dumps(data).encode("utf-8"), "application/json")

        # Checks

        def allowed(self) -> bool:
            if not host_allowed(self.headers.get("Host", "")):
                self.send_json(403, {"error": "Open the page with localhost or the computer's IP address."})
                return False
            origin = self.headers.get("Origin")
            if origin and urlparse(origin).netloc != self.headers.get("Host", ""):
                self.send_json(403, {"error": "Requests from other websites aren't allowed."})
                return False
            return True

        def authorized(self) -> bool:
            if not self.allowed():
                return False
            if not same(self.headers.get("X-Multibot-Token", ""), app.token):
                self.send_json(401, {"error": "The home app restarted. Reload the page."})
                return False
            if app.passcode and not same(self.headers.get("X-Multibot-Passcode", ""), app.passcode):
                self.send_json(401, {"error": "Passcode needed.", "passcode": True})
                return False
            return True

        def read_json(self) -> dict | None:
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                length = -1
            if not 0 <= length <= MAX_BODY:
                self.send_json(413, {"error": "That message is too big."})
                return None
            try:
                data = json.loads(self.rfile.read(length) or b"{}")
            except ValueError:
                data = None
            if not isinstance(data, dict):
                self.send_json(400, {"error": "Bad request."})
                return None
            return data

        def read_text(self, data: dict) -> str | None:
            text = data.get("text")
            if not isinstance(text, str) or not text.strip():
                self.send_json(400, {"error": "Type a message first."})
                return None
            if len(text) > MAX_TEXT:
                self.send_json(400, {"error": f"Keep messages under {MAX_TEXT:,} characters."})
                return None
            return text

        # Routes

        def do_GET(self) -> None:
            url = urlparse(self.path)
            if url.path == "/":
                if self.allowed():
                    self.send_bytes(200, app.page(), "text/html; charset=utf-8")
                return
            if not self.authorized():
                return
            if url.path == "/api/state":
                self.send_json(200, app.state())
            elif url.path == "/api/file":
                self.send_file(parse_qs(url.query).get("path", [""])[0])
            else:
                self.send_json(404, {"error": "Not found."})

        def do_POST(self) -> None:
            if not self.authorized():
                return
            data = self.read_json()
            if data is None:
                return
            route = urlparse(self.path).path
            if route == "/api/ask":
                self.ask(data)
            elif route == "/api/all":
                self.ask_all(data)
            elif route == "/api/model":
                chat = app.chat()
                message = app.call(app.assistant.switch, chat, str(data.get("model", "")))
                self.send_json(200, {"current": chat.model, "message": message})
            elif route == "/api/agent":
                chat = app.chat()
                message = ""
                if bool(data.get("on")) != chat.agent:
                    message = app.call(app.assistant.toggle_agent, chat)
                self.send_json(200, {"agent": chat.agent, "message": message})
            elif route == "/api/new":
                app.call(app.assistant.reset, app.chat())
                self.send_json(200, {"ok": True})
            else:
                self.send_json(404, {"error": "Not found."})

        def ask(self, data: dict) -> None:
            text = self.read_text(data)
            if text is None:
                return
            chat = app.chat()
            model = data.get("model")
            if model:
                message = app.call(app.assistant.switch, chat, str(model))
                if chat.model != model:
                    self.send_json(200, {"error": message})
                    return
            try:
                answer = app.run(app.assistant.ask(chat, text))
            except BackendError as e:
                self.send_json(200, {"error": str(e)})
                return
            files = [app.file_info(p) for p in answer.files[:10] if p.is_file()]
            self.send_json(200, {"key": app.key_for(answer.by), "text": answer.text, "files": files})

        def ask_all(self, data: dict) -> None:
            text = self.read_text(data)
            if text is None:
                return
            answers: queue.Queue = queue.Queue()

            async def on_answer(name: str, result) -> None:
                item = {"key": app.key_for(name), "name": name}
                if isinstance(result, BackendError):
                    item["error"] = str(result)
                else:
                    item["text"] = result
                answers.put(item)

            job = asyncio.run_coroutine_threadsafe(app.assistant.ask_all(app.chat(), text, on_answer), app.loop)
            job.add_done_callback(lambda _: answers.put(None))
            # One JSON object per line, sent as each plushie answers.
            self.send_response(200)
            self.send_header("Content-Type", "application/x-ndjson")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            try:
                while (item := answers.get()) is not None:
                    self.wfile.write((json.dumps(item) + "\n").encode("utf-8"))
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                job.cancel()

        def send_file(self, rel: str) -> None:
            root = app.cfg.workspace.resolve()
            target = (root / rel).resolve()
            if not rel or not target.is_relative_to(root) or not target.is_file():
                self.send_json(404, {"error": "That file isn't there anymore."})
                return
            content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
            disposition = f"attachment; filename*=UTF-8''{quote(target.name)}"
            self.send_bytes(200, target.read_bytes(), content_type, {"Content-Disposition": disposition})

    return Handler


def lan_address() -> str:
    """This computer's address on the local network (no packets are sent)."""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        try:
            s.connect(("192.0.2.1", 80))
            return s.getsockname()[0]
        except OSError:
            return "this-computers-ip"


def start(cfg: Config, assistant: Assistant | None = None) -> tuple[ThreadingHTTPServer, WebApp]:
    """Start the assistant loop and the HTTP server (not yet serving)."""
    host = cfg.get("WEB_HOST", "127.0.0.1")
    port = int(cfg.get("WEB_PORT", "8765"))
    if host not in LOCAL_HOSTS and not cfg.get("WEB_PASSCODE"):
        raise SystemExit("Set WEB_PASSCODE in .env before letting other devices open the page.")
    loop = asyncio.new_event_loop()
    thread = threading.Thread(target=loop.run_forever, name="assistant", daemon=True)
    thread.start()
    app = WebApp(cfg, assistant or Assistant(cfg), loop)
    app.thread = thread
    try:
        server = ThreadingHTTPServer((host, port), make_handler(app))
    except OSError as e:
        stop(None, app)
        raise SystemExit(f"Couldn't use port {port} ({e.strerror}). Set WEB_PORT in .env to another number.") from None
    server.daemon_threads = True
    return server, app


def stop(server: ThreadingHTTPServer | None, app: WebApp) -> None:
    if server is not None:
        server.server_close()
    app.run(app.assistant.aclose())
    app.loop.call_soon_threadsafe(app.loop.stop)
    app.thread.join(timeout=5)
    app.loop.close()


def main() -> None:
    logging.basicConfig(format="%(asctime)s %(levelname)s %(name)s: %(message)s", level=logging.INFO)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    cfg = load_config()
    server, app = start(cfg)
    host, port = server.server_address[:2]
    url = f"http://localhost:{port}"
    print(f"Plushie Chat is open at {url}")
    if host not in LOCAL_HOSTS:
        print(f"On your phone (same Wi-Fi): http://{lan_address()}:{port}  (passcode from WEB_PASSCODE)")
    for backend in app.assistant.backends.values():
        print(f"  {backend.name}: {backend.via}")
    if not app.assistant.backends:
        print("  No plushies are set up yet. See the README.")
    if cfg.get("WEB_OPEN_BROWSER", "yes").lower() not in ("0", "no", "false"):
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nBye!")
    finally:
        stop(server, app)


if __name__ == "__main__":
    main()
