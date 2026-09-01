import { execFileSync } from "node:child_process";
import fs from "node:fs";

const [action, encodedPayload = ""] = process.argv.slice(2);
const allowedActions = new Set(["screenshot", "click", "move", "type", "key", "scroll", "drag", "wait"]);
if (!action || !allowedActions.has(action)) {
  console.error("Unsupported desktop action");
  process.exit(2);
}

let payload = {};
try {
  payload = encodedPayload ? JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) : {};
} catch {
  console.error("Desktop action payload is invalid");
  process.exit(2);
}

process.env.DISPLAY = process.env.DISPLAY || ":99";
const run = (command, args) => execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const integer = (value, name, min, max) => {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return value;
};
const pause = (milliseconds) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);

const [screenWidth, screenHeight] = run("xdotool", ["getdisplaygeometry"]).split(/\s+/).map(Number);
const point = (x, y) => [
  String(integer(x, "x", 0, screenWidth - 1)),
  String(integer(y, "y", 0, screenHeight - 1)),
];

if (action === "click") {
  const button = integer(payload.button ?? 1, "button", 1, 3);
  const count = integer(payload.count ?? 1, "count", 1, 3);
  run("xdotool", ["mousemove", "--sync", ...point(payload.x, payload.y), "click", "--repeat", String(count), "--delay", "90", String(button)]);
} else if (action === "move") {
  run("xdotool", ["mousemove", "--sync", ...point(payload.x, payload.y)]);
} else if (action === "type") {
  if (typeof payload.text !== "string" || payload.text.length > 20_000) throw new Error("text must contain at most 20000 characters");
  execFileSync("xdotool", ["type", "--clearmodifiers", "--delay", "8", "--file", "-"], {
    input: payload.text,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
} else if (action === "key") {
  if (typeof payload.key !== "string" || !/^[A-Za-z0-9_+\-]+$/.test(payload.key) || payload.key.length > 80) throw new Error("key is invalid");
  const aliases = { ENTER: "Return", ESC: "Escape", TAB: "Tab", BACKSPACE: "BackSpace", DELETE: "Delete", SPACE: "space", UP: "Up", DOWN: "Down", LEFT: "Left", RIGHT: "Right", HOME: "Home", END: "End", PAGEUP: "Prior", PAGEDOWN: "Next" };
  const normalized = payload.key.split("+").map((part) => aliases[part.toUpperCase()] ?? part.toLowerCase()).join("+");
  run("xdotool", ["key", "--clearmodifiers", normalized]);
} else if (action === "scroll") {
  const amount = integer(payload.amount, "amount", -30, 30);
  if (amount !== 0) {
    if (Number.isInteger(payload.x) && Number.isInteger(payload.y)) run("xdotool", ["mousemove", "--sync", ...point(payload.x, payload.y)]);
    run("xdotool", ["click", "--repeat", String(Math.abs(amount)), "--delay", "25", amount > 0 ? "5" : "4"]);
  }
} else if (action === "drag") {
  const button = integer(payload.button ?? 1, "button", 1, 3);
  const steps = integer(payload.steps ?? 12, "steps", 1, 100);
  const [fromX, fromY] = point(payload.fromX, payload.fromY);
  const [toX, toY] = point(payload.toX, payload.toY);
  run("xdotool", ["mousemove", "--sync", fromX, fromY, "mousedown", String(button), "mousemove", "--sync", "--steps", String(steps), toX, toY, "mouseup", String(button)]);
} else if (action === "wait") {
  pause(integer(payload.milliseconds ?? 1000, "milliseconds", 100, 10_000));
}

if (action !== "screenshot") pause(300);
const screenshotPath = `/tmp/relay-desktop-${process.pid}.jpg`;
try {
  run("scrot", ["-o", "-q", "70", screenshotPath]);
  const image = fs.readFileSync(screenshotPath).toString("base64");
  console.log(JSON.stringify({ ok: true, action, width: screenWidth, height: screenHeight, mimeType: "image/jpeg", image }));
} finally {
  fs.rmSync(screenshotPath, { force: true });
}
