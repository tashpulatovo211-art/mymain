"""Settings from the .env file and the environment."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import dotenv_values

APP_DIR = Path(__file__).resolve().parent.parent

# If one of these reaches a CLI, the CLI bills that key instead of your
# subscription, so CLIs never get them (see cli_env).
API_KEY_VARS = (
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "OPENAI_API_KEY",
    "CODEX_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "XAI_API_KEY",
)


@dataclass
class Config:
    values: dict[str, str]
    telegram_token: str
    allowed_user_ids: frozenset[int]
    default_model: str
    workspace: Path
    state_dir: Path
    timeout: float
    max_history_chars: int

    def get(self, name: str, default: str = "") -> str:
        value = self.values.get(name, "").strip()
        return value or default


def load_config(env_file: Path | None = None, environ: dict[str, str] | None = None) -> Config:
    # The .env file is read into a dict instead of os.environ, so API keys
    # in it never leak into the CLI processes this app starts.
    env_file = env_file or APP_DIR / ".env"
    values = {k: v for k, v in dotenv_values(env_file).items() if v is not None}
    values.update(os.environ if environ is None else environ)

    def get(name: str, default: str = "") -> str:
        return values.get(name, "").strip() or default

    return Config(
        values=values,
        telegram_token=get("TELEGRAM_BOT_TOKEN"),
        allowed_user_ids=parse_user_ids(get("ALLOWED_USER_IDS")),
        default_model=get("DEFAULT_MODEL", "claude").lower(),
        workspace=Path(get("WORKSPACE_DIR", "~/multibot-workspace")).expanduser(),
        state_dir=Path(get("STATE_DIR", "~/.multibot")).expanduser(),
        timeout=float(get("REPLY_TIMEOUT", "300")),
        max_history_chars=int(get("MAX_HISTORY_CHARS", "30000")),
    )


def parse_user_ids(raw: str) -> frozenset[int]:
    ids = set()
    for part in raw.replace(" ", ",").split(","):
        if part:
            try:
                ids.add(int(part))
            except ValueError:
                raise SystemExit(f"ALLOWED_USER_IDS has a value that isn't a number: {part!r}") from None
    return frozenset(ids)


def cli_env(extra: dict[str, str] | None = None) -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if k not in API_KEY_VARS}
    env.update(extra or {})
    return env
