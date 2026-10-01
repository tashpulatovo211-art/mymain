# multibot

Talk to Claude, GPT and Gemini through the subscriptions you already pay for, plus Grok through an xAI API key, all in one place. You can switch models mid-conversation and the context carries over, ask all of them the same question at once, and turn on an agent mode where the model makes files for you.

It comes in two forms that share the same engine:

- **Plushie Chat**, a web page where each model is a plushie on a shelf. Run `python web.py` and it opens in your browser.
- **A private Telegram bot**, for when you're away from the computer. Run `python bot.py`.

It's an alternative to xAI's Grok Bot, which is a closed product: there's no way to plug your Claude, ChatGPT or Google subscriptions into it.

## Plushie Chat on claude.ai: no setup, Claude only

[Plushie Chat](https://claude.ai/artifact/PRzoADmUhpW6USkxz9h2ZQ) is also published on claude.ai. There, the Claude bunny answers using your own Claude account. The first message asks you to allow it, and its usage counts toward your Claude plan. GPT, Gemini and Grok sleep on the shelf. A page on claude.ai can't reach OpenAI, Google or xAI, and those plans only work through the apps on your computer. To wake them up, set up the home app below and open Plushie Chat with `python web.py`.

## How it uses your subscriptions

Claude Pro/Max, ChatGPT Plus/Pro and Google AI Pro don't come with API keys. What they do include is each company's official command-line app: Claude Code, Codex and Gemini CLI. You sign in to those apps once with your normal account. When you message the bot, it starts the matching app on your computer, hands it your message, and sends back the answer. The app never touches your login tokens.

This matters because the rules are strict:

- **Anthropic** says subscription logins are for ordinary use of Claude Code and its own apps. Third-party apps may not offer Claude login or route requests through Pro/Max credentials for other people. Signing in to the unmodified `claude` program with your own subscription is allowed. This bot does only that, for you alone. A chat bot still isn't what Claude Code was built for, and Anthropic says it may enforce its rules without notice. If you want zero risk on the Claude side, set `CLAUDE_SOURCE=api` and use an API key. Source: [Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance).
- **Google** says using Gemini CLI's login from other software is a violation and can get your account suspended. Running Gemini CLI itself in headless mode with your cached login is documented. Gemini CLI's quota page lists Google AI Pro at 1,500 requests a day.
- **OpenAI** lets you sign in to Codex with ChatGPT Plus/Pro, and its Codex usage counts against your plan.
- **Grok** has no subscription route. SuperGrok doesn't include API access, so Grok needs a pay-per-use key from [console.x.ai](https://console.x.ai).

Don't share the bot or the web page with anyone. They run on your accounts, and letting other people use them would break these rules. The bot ignores everyone whose Telegram ID isn't in `ALLOWED_USER_IDS`, and the web page only answers on your computer unless you set a passcode.

Every message counts against your plan's usage limits, the same as using the apps directly. The bot re-sends recent conversation with each message (up to `MAX_HISTORY_CHARS`), so long chats cost more. `/new` starts fresh.

## Setup

You need Python 3.10 or newer, and the computer has to stay on while you use it. Steps 2, 4 and 5 are only for the Telegram bot; for Plushie Chat alone, do steps 1 and 3 (and put `XAI_API_KEY` in `.env` if you want Grok), then run `python web.py`.

**1. Install the apps you have plans for, and sign in to each once.**

Claude Code ([install guide](https://code.claude.com/docs/en/setup)):

```
curl -fsSL https://claude.ai/install.sh | bash      # macOS / Linux
irm https://claude.ai/install.ps1 | iex             # Windows PowerShell
claude                                              # sign in with your Claude account, then type /exit
```

Codex and Gemini CLI need [Node.js](https://nodejs.org) 20 or newer:

```
npm install -g @openai/codex
codex login                                         # choose Sign in with ChatGPT

npm install -g @google/gemini-cli
gemini                                              # choose Sign in with Google, then type /quit
```

Check each one answers before going on: `claude -p "hi"`, `codex exec --skip-git-repo-check "hi"`, `gemini -p "hi"`. If one of these fails, the bot will fail the same way.

**2. Make a Telegram bot.** In Telegram, message [@BotFather](https://t.me/BotFather), send `/newbot`, and copy the token it gives you.

**3. Install this app.**

```
git clone https://github.com/tashpulatovo211-art/mymain.git multibot
cd multibot
python -m venv .venv
source .venv/bin/activate           # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                # Windows: copy .env.example .env
```

**4. Fill in `.env`.** Paste the token into `TELEGRAM_BOT_TOKEN`. Add `XAI_API_KEY` if you want Grok.

**5. Start it and lock it to you.**

```
python bot.py
```

Message your bot. It replies with your Telegram user ID. Put that number in `ALLOWED_USER_IDS` in `.env`, stop the bot with Ctrl+C, and start it again.

To try the models without Telegram, run `python console.py`. It has the same commands, in the terminal.

## Plushie Chat on your computer

```
python web.py
```

This opens http://localhost:8765 in your browser. Every plushie you set up in step 1 is awake: tap one to talk to it, or tap Everyone to ask them all at once. The Make files switch turns on agent mode, and each file the plushie makes shows up under its answer so you can download it. Ctrl+C stops it.

To open it on your phone over the same Wi-Fi, add a passcode and let other devices in:

```
WEB_HOST=0.0.0.0
WEB_PASSCODE=pick-something-long
```

Restart `python web.py`; it prints the address to open on your phone. The page asks for the passcode once. Without `WEB_PASSCODE` the app refuses to listen beyond your own computer, because anyone on the Wi-Fi could otherwise use your plans.

## Commands

| Command | What it does |
| --- | --- |
| `/claude`, `/gpt`, `/gemini`, `/grok` | Switch model. Add a question to ask it right away: `/gpt explain this error` |
| `/all question` | Ask every model at once and get each answer as it arrives |
| `/agent` | Agent mode on or off |
| `/new` | Start a fresh conversation |
| `/model` | See what's set up, with buttons to switch |

## Agent mode

With agent mode on, the model works inside one folder (`~/multibot-workspace` by default). Whatever files it creates or changes there are sent to you in Telegram, up to five per reply. Ask for things like "make a study schedule as a spreadsheet" or "research X and write a one-page summary".

What each model can do in agent mode:

- **Claude** can read, write and edit files in that folder and search the web. It has no shell, so it can't run commands.
- **Gemini** can edit files there and search the web. A policy file blocks shell commands.
- **GPT (Codex)** can edit files and run commands, inside Codex's sandbox, which only lets it write in that folder.
- **Grok**, and any model running on an API key, only chats.

`/all` always runs as plain chat, so several agents never edit the same folder at once.

## Settings

Everything is in `.env`; see `.env.example` for the full list. The ones you're most likely to change:

- `DEFAULT_MODEL`: the model new chats start with.
- `CLAUDE_MODEL`, `CODEX_MODEL`, `GEMINI_MODEL`: pick a model inside each app, for example `CLAUDE_MODEL=opus`. Empty means the app's default.
- `CLAUDE_SOURCE`, `GPT_SOURCE`, `GEMINI_SOURCE`: `auto` uses the app if it's installed and an API key otherwise; `cli` or `api` forces one.
- `REPLY_TIMEOUT`: seconds before a slow answer is stopped (default 300).
- `WEB_PORT`, `WEB_HOST`, `WEB_PASSCODE`: where Plushie Chat listens (default port 8765, this computer only) and the passcode other devices need.

API keys in `.env` are never passed to the apps. Otherwise Claude Code, for one, would bill the key instead of your plan.

## If something goes wrong

- **"didn't answer: Not logged in" or similar.** Run that app once in a terminal on the bot's computer and sign in again. The bot's error message says which command to run.
- **"No answer after 300 seconds".** The app hung or the task was big. Check that the app works in a terminal, or raise `REPLY_TIMEOUT`.
- **A model is missing from `/model`.** The bot didn't find its app on your PATH. Set `CLAUDE_BIN`, `CODEX_BIN` or `GEMINI_BIN` in `.env` to the full path.
- **You hit a usage limit.** That's your plan's limit. Switch models or wait for it to reset.

## Tests

```
pip install -r requirements-dev.txt
pytest
```

The tests start fake `claude`, `codex` and `gemini` programs to check exactly what the bot runs, feed messages through the real Telegram library against a fake Telegram server, and check the web server's locks (token, host check, passcode, file paths). `tests/test_page.py` also drives Plushie Chat in Chromium; it runs when Playwright is installed (`pip install playwright && playwright install chromium`) and is skipped otherwise.

What was tested beyond that: the Claude Code path ran for real (chat, memory across a model switch, and agent mode writing a file). Codex and Gemini CLI were checked against their current versions (0.159.3 and 0.62.0) up to the sign-in step; they couldn't be signed in on the test machine. Everything ran on Linux; Windows and macOS weren't tested.
