"""Chat history and how it is turned into a prompt."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

MAX_STORED_TURNS = 200


@dataclass
class Turn:
    user: str
    reply: str
    by: str  # name of the model that answered


@dataclass
class Chat:
    model: str
    agent: bool = False
    turns: list[Turn] = field(default_factory=list)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def add(self, turn: Turn) -> None:
        self.turns.append(turn)
        del self.turns[:-MAX_STORED_TURNS]


def recent(turns: list[Turn], max_chars: int) -> list[Turn]:
    """The newest turns whose text fits in max_chars."""
    kept: list[Turn] = []
    used = 0
    for turn in reversed(turns):
        used += len(turn.user) + len(turn.reply)
        if used > max_chars:
            break
        kept.append(turn)
    kept.reverse()
    return kept


def render_prompt(history: list[Turn], message: str, system: str = "") -> str:
    """One block of text for CLIs, which take a single prompt per run."""
    parts = [system] if system else []
    if history:
        parts.append(
            "Conversation so far. Earlier replies may have come from other AI models; "
            "use them as context."
        )
        for turn in history:
            parts.append(f"User: {turn.user}")
            parts.append(f"Assistant ({turn.by}): {turn.reply}")
        parts.append("New message from the user. Reply to it directly, without a speaker label:")
    parts.append(message)
    return "\n\n".join(parts)


def to_messages(history: list[Turn], message: str) -> list[dict[str, str]]:
    """Role-tagged messages for HTTP APIs."""
    messages = []
    for turn in history:
        messages.append({"role": "user", "content": turn.user})
        messages.append({"role": "assistant", "content": turn.reply})
    messages.append({"role": "user", "content": message})
    return messages
