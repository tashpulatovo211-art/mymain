"""Chat with the models in a terminal, without Telegram. Run: python console.py"""

from __future__ import annotations

import asyncio

from multibot.assistant import HELP, Assistant
from multibot.backends import FAMILIES, BackendError
from multibot.config import load_config


async def main() -> None:
    assistant = Assistant(load_config())
    chat = assistant.chat("console")
    print(assistant.status(chat))
    print("Type /help for commands and /quit to leave.\n")

    async def show(name: str, result: str | BackendError) -> None:
        prefix = f"{name} didn't answer: " if isinstance(result, BackendError) else f"{name}: "
        print(f"\n{prefix}{result}\n")

    try:
        while True:
            prompt = f"[{chat.model or 'no model'}{', agent' if chat.agent else ''}] you> "
            try:
                line = (await asyncio.to_thread(input, prompt)).strip()
            except EOFError:
                break
            command, _, rest = line.partition(" ")
            rest = rest.strip()
            if not line:
                continue
            if command in ("/quit", "/exit"):
                break
            if command in ("/help", "/start"):
                print(f"{HELP}\n")
            elif command == "/model":
                print(f"{assistant.status(chat)}\n")
            elif command == "/new":
                print(f"{assistant.reset(chat)}\n")
            elif command == "/agent":
                print(f"{assistant.toggle_agent(chat)}\n")
            elif command == "/all":
                if rest:
                    await assistant.ask_all(chat, rest, show)
                else:
                    print("Put the question after the command: /all what should I name my cat?\n")
            elif command.startswith("/") and command[1:] in FAMILIES:
                print(f"{assistant.switch(chat, command[1:])}\n")
                if rest and chat.model == command[1:]:
                    await ask(assistant, chat, rest)
            elif command.startswith("/"):
                print("Unknown command. Type /help.\n")
            else:
                await ask(assistant, chat, line)
    finally:
        await assistant.aclose()


async def ask(assistant: Assistant, chat, text: str) -> None:
    print("(thinking…)")
    try:
        answer = await assistant.ask(chat, text)
    except BackendError as e:
        print(f"\n{e}\n")
        return
    print(f"\n{answer.by}: {answer.text}\n")
    for path in answer.files:
        print(f"  file: {path}")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
