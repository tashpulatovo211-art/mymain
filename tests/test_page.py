"""Plushie Chat in a real browser. Needs Playwright and Chromium; skipped otherwise.

    pip install playwright && playwright install chromium
"""

import os
import threading
from pathlib import Path

import pytest

from multibot.assistant import Assistant
from tests.fakes import FakeBackend, make_config
from web import SHELL, start, stop

sync_api = pytest.importorskip("playwright.sync_api")

PAGE = Path(__file__).resolve().parent.parent / "web" / "plushie-chat.html"

# A stand-in for claude.ai's runtime: sample() streams a fixed answer.
FAKE_CLAUDE = """
window.claude = { use: async (name) => name === "sample" ? sample : null };
window.calls = [];
async function sample(turns, opts) {
  window.calls.push(turns);
  const text = "Black holes **pull** hard.\\n\\n- one\\n- two";
  let shown = "";
  for (const part of text.split(/(?<= )/)) {
    await new Promise((r) => setTimeout(r, 5));
    shown += part;
    opts.onText({ text: shown, delta: part });
  }
  return { text, truncated: false, modelTierApplied: "default" };
}
"""


@pytest.fixture(scope="module")
def browser():
    with sync_api.sync_playwright() as p:
        try:
            launched = p.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH") or None)
        except Exception as e:  # browser not installed
            pytest.skip(f"Chromium isn't available: {e}")
        yield launched
        launched.close()


def new_page(browser, width=390):
    page = browser.new_page(viewport={"width": width, "height": 800})
    page.route("https://fonts.googleapis.com/**", lambda route: route.abort())
    page.route("https://fonts.gstatic.com/**", lambda route: route.abort())
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    return page, errors


def assert_fits(page):
    width, viewport = page.evaluate("[document.documentElement.scrollWidth, innerWidth]")
    assert width <= viewport


def test_on_claude_ai_claude_answers_and_others_sleep(browser):
    page, errors = new_page(browser)
    html = SHELL + PAGE.read_text(encoding="utf-8") + "</body></html>"
    page.route("https://plushie.test/", lambda route: route.fulfill(body=html, content_type="text/html"))
    page.add_init_script(FAKE_CLAUDE)
    page.goto("https://plushie.test/")
    page.wait_for_selector(".pal[data-key=claude] .plush:not(.asleep)")
    assert page.locator(".pal[data-key=gpt] .plush.asleep").count() == 1
    assert_fits(page)

    page.fill("#msg", "Tell me about black holes")
    page.keyboard.press("Enter")
    page.wait_for_selector(".msg.pal .bubble li")
    assert "pull" in page.inner_text(".msg.pal .bubble strong")
    turns = page.evaluate("calls[0]")
    assert turns[0]["role"] == "user" and "Plushie Chat" in turns[0]["content"]
    assert turns[-1] == {"role": "user", "content": "Tell me about black holes"}

    page.click(".pal[data-key=gemini]")
    assert page.is_disabled("#msg")
    assert "home app" in page.inner_text("#tag")

    page.reload()
    page.wait_for_selector(".msg.pal")
    assert page.locator(".msg").count() == 2
    assert errors == []


def test_on_your_computer_all_four_answer(browser, tmp_path):
    cfg = make_config(tmp_path, WEB_PORT="0")
    backends = {
        "claude": FakeBackend("Claude", reply="made it", make_file="plan.md"),
        "gpt": FakeBackend("GPT", reply="gpt says hi"),
        "gemini": FakeBackend("Gemini", fail="quota reached"),
    }
    server, app = start(cfg, Assistant(cfg, backends=backends))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        page, errors = new_page(browser, width=360)
        page.goto(f"http://127.0.0.1:{server.server_address[1]}/")
        page.wait_for_selector("#agent-wrap:not([hidden])")
        assert page.locator(".pal[data-key=grok] .plush.asleep").count() == 1
        assert_fits(page)

        page.click(".pal[data-key=all]")
        page.fill("#msg", "hello everyone")
        page.click("#send")
        page.wait_for_function("document.querySelectorAll('.msg.pal').length === 3 && !document.querySelector('.yarn')")
        bubbles = " ".join(page.locator(".msg.pal .bubble").all_inner_texts())
        assert "gpt says hi" in bubbles and "quota reached" in bubbles

        page.click(".pal[data-key=claude]")
        page.check("#agent")
        page.wait_for_function("document.querySelector('#tag').innerText.includes('makes files')")
        page.fill("#msg", "make a plan")
        page.click("#send")
        page.wait_for_selector(".file")
        with page.expect_download() as download:
            page.click(".file")
        assert download.value.suggested_filename == "plan.md"
        assert errors == []
    finally:
        server.shutdown()
        stop(server, app)
