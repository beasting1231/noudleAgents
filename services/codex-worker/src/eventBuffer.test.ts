import { describe, expect, it } from "vitest";
import { EventBuffer } from "./eventBuffer.js";

describe("EventBuffer", () => {
  it("orders, replays, and publishes events", () => {
    const buffer = new EventBuffer();
    const seen: number[] = [];
    const unsubscribe = buffer.subscribe((event) => seen.push(event.cursor));
    buffer.append("turn/started", { threadId: "thread_1", turnId: "turn_1" });
    buffer.append("item/agentMessage/delta", { threadId: "thread_1", turnId: "turn_1", delta: "Hi" });
    unsubscribe();
    buffer.append("turn/completed", { threadId: "thread_1", turn: { id: "turn_1" } });
    expect(seen).toEqual([1, 2]);
    expect(buffer.after(1).map((event) => event.cursor)).toEqual([2, 3]);
    expect(buffer.after(2)[0]?.turnId).toBe("turn_1");
  });
});
