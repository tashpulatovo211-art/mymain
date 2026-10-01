import asyncio
import http.client
import json
import threading
from contextlib import contextmanager

import pytest

from multibot.assistant import Assistant
from tests.fakes import FakeBackend, make_config
from web import host_allowed, start, stop


@contextmanager
def running(tmp_path, backends, **values):
    cfg = make_config(tmp_path, WEB_PORT="0", **values)
    server, app = start(cfg, Assistant(cfg, backends=backends))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        yield server.server_address[1], app
    finally:
        server.shutdown()
        stop(server, app)


def call(port, method, path, body=None, token=None, headers=None):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    sent = {"Content-Type": "application/json"}
    if token:
        sent["X-Multibot-Token"] = token
    sent.update(headers or {})
    conn.request(method, path, None if body is None else json.dumps(body), sent)
    resp = conn.getresponse()
    data = resp.read()
    conn.close()
    return resp.status, data


def test_page_carries_a_token(tmp_path):
    with running(tmp_path, {"claude": FakeBackend("Claude")}) as (port, app):
        status, body = call(port, "GET", "/")
        assert status == 200
        page = body.decode()
        assert page.startswith("<!doctype html>")
        assert f'"token": "{app.token}"' in page
        assert "<title>Plushie Chat</title>" in page


def test_api_needs_the_token(tmp_path):
    with running(tmp_path, {"claude": FakeBackend("Claude")}) as (port, app):
        assert call(port, "GET", "/api/state")[0] == 401
        assert call(port, "POST", "/api/ask", {"text": "hi"}, token="wrong")[0] == 401
        status, body = call(port, "GET", "/api/state", token=app.token)
        state = json.loads(body)
        assert status == 200
        assert state["current"] == "claude"
        assert [m["key"] for m in state["models"]] == ["claude"]
        assert "grok" in state["missing"]


def test_other_websites_are_refused(tmp_path):
    with running(tmp_path, {"claude": FakeBackend("Claude")}) as (port, app):
        # A DNS-rebinding page reaches the server under its own domain name.
        assert call(port, "GET", "/", headers={"Host": f"evil.example:{port}"})[0] == 403
        assert call(port, "GET", "/api/state", token=app.token, headers={"Host": f"evil.example:{port}"})[0] == 403
        # A cross-site form or fetch carries its own Origin.
        status, _ = call(port, "POST", "/api/ask", {"text": "hi"}, token=app.token, headers={"Origin": "https://evil.example"})
        assert status == 403


def test_host_allowed():
    assert host_allowed("localhost:8765")
    assert host_allowed("127.0.0.1:8765")
    assert host_allowed("192.168.1.20:8765")
    assert host_allowed("[::1]:8765")
    assert not host_allowed("evil.example:8765")
    assert not host_allowed("")


def test_ask_switches_model_and_answers(tmp_path):
    claude, gpt = FakeBackend("Claude"), FakeBackend("GPT", reply="gpt here")
    with running(tmp_path, {"claude": claude, "gpt": gpt}) as (port, app):
        status, body = call(port, "POST", "/api/ask", {"text": "hello", "model": "gpt"}, token=app.token)
        assert status == 200
        assert json.loads(body) == {"key": "gpt", "text": "gpt here", "files": []}
        state = json.loads(call(port, "GET", "/api/state", token=app.token)[1])
        assert state["current"] == "gpt"
        assert state["turns"] == [{"user": "hello", "reply": "gpt here", "key": "gpt"}]


def test_ask_errors(tmp_path):
    with running(tmp_path, {"claude": FakeBackend("Claude", fail="Not logged in")}) as (port, app):
        body = json.loads(call(port, "POST", "/api/ask", {"text": "hi"}, token=app.token)[1])
        assert body == {"error": "Claude didn't answer:\nNot logged in"}
        body = json.loads(call(port, "POST", "/api/ask", {"text": "hi", "model": "grok"}, token=app.token)[1])
        assert "grok isn't set up" in body["error"]
        assert call(port, "POST", "/api/ask", {"text": "  "}, token=app.token)[0] == 400


def test_ask_all_streams_each_answer(tmp_path):
    backends = {"claude": FakeBackend("Claude"), "gemini": FakeBackend("Gemini", fail="quota")}
    with running(tmp_path, backends) as (port, app):
        status, body = call(port, "POST", "/api/all", {"text": "compare"}, token=app.token)
        lines = [json.loads(line) for line in body.decode().splitlines()]
        assert status == 200
        assert sorted(lines, key=lambda item: item["key"]) == [
            {"key": "claude", "name": "Claude", "text": "Claude reply"},
            {"key": "gemini", "name": "Gemini", "error": "quota"},
        ]


def test_agent_files_can_be_downloaded(tmp_path):
    claude = FakeBackend("Claude", make_file="notes.txt")
    with running(tmp_path, {"claude": claude}) as (port, app):
        assert json.loads(call(port, "POST", "/api/agent", {"on": True}, token=app.token)[1])["agent"] is True
        body = json.loads(call(port, "POST", "/api/ask", {"text": "write notes"}, token=app.token)[1])
        assert body["files"] == [{"name": "notes.txt", "path": "notes.txt", "size": 13}]
        status, content = call(port, "GET", "/api/file?path=notes.txt", token=app.token)
        assert (status, content) == (200, b"made by agent")
        (tmp_path / "secret.txt").write_text("nope")
        assert call(port, "GET", "/api/file?path=../secret.txt", token=app.token)[0] == 404


def test_passcode(tmp_path):
    with running(tmp_path, {"claude": FakeBackend("Claude")}, WEB_PASSCODE="plush123") as (port, app):
        status, body = call(port, "GET", "/api/state", token=app.token)
        assert status == 401 and json.loads(body)["passcode"] is True
        headers = {"X-Multibot-Passcode": "plush123"}
        assert call(port, "GET", "/api/state", token=app.token, headers=headers)[0] == 200


def test_other_devices_need_a_passcode(tmp_path):
    cfg = make_config(tmp_path, WEB_HOST="0.0.0.0", WEB_PORT="0")
    assistant = Assistant(cfg, backends={})
    with pytest.raises(SystemExit, match="WEB_PASSCODE"):
        start(cfg, assistant)
    asyncio.run(assistant.aclose())
