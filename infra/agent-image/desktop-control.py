#!/usr/bin/env python3
import base64
import json
import os
import re
import subprocess
import sys
import tempfile
import time


ALLOWED_ACTIONS = {"screenshot", "click", "move", "type", "key", "scroll", "drag", "wait"}


def run(command, args, input_text=None):
    completed = subprocess.run(
        [command, *args],
        input=input_text,
        text=True,
        capture_output=True,
        check=True,
        env={**os.environ, "DISPLAY": os.environ.get("DISPLAY", ":99")},
    )
    return completed.stdout.strip()


def integer(value, name, minimum, maximum):
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum or value > maximum:
        raise ValueError(f"{name} must be an integer from {minimum} to {maximum}")
    return value


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else ""
    encoded = sys.argv[2] if len(sys.argv) > 2 else ""
    if action not in ALLOWED_ACTIONS:
        raise ValueError("Unsupported desktop action")

    if encoded:
        padding = "=" * (-len(encoded) % 4)
        payload = json.loads(base64.urlsafe_b64decode(encoded + padding).decode("utf-8"))
    else:
        payload = {}

    screen_width, screen_height = map(int, run("xdotool", ["getdisplaygeometry"]).split())

    def point(x, y):
        return [
            str(integer(x, "x", 0, screen_width - 1)),
            str(integer(y, "y", 0, screen_height - 1)),
        ]

    if action == "click":
        button = integer(payload.get("button", 1), "button", 1, 3)
        count = integer(payload.get("count", 1), "count", 1, 3)
        run("xdotool", ["mousemove", "--sync", *point(payload.get("x"), payload.get("y")), "click", "--repeat", str(count), "--delay", "90", str(button)])
    elif action == "move":
        run("xdotool", ["mousemove", "--sync", *point(payload.get("x"), payload.get("y"))])
    elif action == "type":
        text = payload.get("text")
        if not isinstance(text, str) or len(text) > 20_000:
            raise ValueError("text must contain at most 20000 characters")
        run("xdotool", ["type", "--clearmodifiers", "--delay", "8", "--file", "-"], text)
    elif action == "key":
        key = payload.get("key")
        if not isinstance(key, str) or len(key) > 80 or not re.fullmatch(r"[A-Za-z0-9_+\-]+", key):
            raise ValueError("key is invalid")
        aliases = {
            "ENTER": "Return", "ESC": "Escape", "TAB": "Tab", "BACKSPACE": "BackSpace",
            "DELETE": "Delete", "SPACE": "space", "UP": "Up", "DOWN": "Down", "LEFT": "Left",
            "RIGHT": "Right", "HOME": "Home", "END": "End", "PAGEUP": "Prior", "PAGEDOWN": "Next",
        }
        normalized = "+".join(aliases.get(part.upper(), part.lower()) for part in key.split("+"))
        run("xdotool", ["key", "--clearmodifiers", normalized])
    elif action == "scroll":
        amount = integer(payload.get("amount"), "amount", -30, 30)
        if amount:
            if isinstance(payload.get("x"), int) and isinstance(payload.get("y"), int):
                run("xdotool", ["mousemove", "--sync", *point(payload["x"], payload["y"])])
            run("xdotool", ["click", "--repeat", str(abs(amount)), "--delay", "25", "5" if amount > 0 else "4"])
    elif action == "drag":
        button = integer(payload.get("button", 1), "button", 1, 3)
        steps = integer(payload.get("steps", 12), "steps", 1, 100)
        run("xdotool", [
            "mousemove", "--sync", *point(payload.get("fromX"), payload.get("fromY")),
            "mousedown", str(button), "mousemove", "--sync", "--steps", str(steps),
            *point(payload.get("toX"), payload.get("toY")), "mouseup", str(button),
        ])
    elif action == "wait":
        milliseconds = integer(payload.get("milliseconds", 1000), "milliseconds", 100, 10_000)
        time.sleep(milliseconds / 1000)

    if action != "screenshot":
        time.sleep(0.3)

    screenshot_path = ""
    try:
        with tempfile.NamedTemporaryFile(prefix="relay-desktop-", suffix=".jpg", delete=False) as handle:
            screenshot_path = handle.name
        run("scrot", ["-o", "-q", "70", screenshot_path])
        with open(screenshot_path, "rb") as image_file:
            image = base64.b64encode(image_file.read()).decode("ascii")
        print(json.dumps({
            "ok": True,
            "action": action,
            "width": screen_width,
            "height": screen_height,
            "mimeType": "image/jpeg",
            "image": image,
        }, separators=(",", ":")))
    finally:
        if screenshot_path:
            try:
                os.remove(screenshot_path)
            except FileNotFoundError:
                pass


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
