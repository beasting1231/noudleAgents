import { describe, expect, it } from "vitest";
import { demoSnapshot } from "../data/demo";
import { createInitialState, relayReducer, taskChildren, taskProgress } from "./relay-state";

describe("relayReducer", () => {
  it("keeps the selected conversation when a fresh snapshot still contains it", () => {
    const initial = createInitialState(demoSnapshot);
    const selected = relayReducer(initial, { type: "select_conversation", id: "conversation-lumen" });
    const refreshed = relayReducer(selected, { type: "snapshot", snapshot: demoSnapshot, connection: "live" });
    expect(refreshed.selectedConversationId).toBe("conversation-lumen");
    expect(refreshed.connection).toBe("live");
  });

  it("replaces a cleared conversation and removes its visible messages", () => {
    const initial = createInitialState(demoSnapshot);
    const previous = initial.conversations.find(({ kind }) => kind === "direct")!;
    const replacement = { ...previous, id: "conversation-fresh", lastMessageAt: null };
    const next = relayReducer(initial, { type: "replace_conversation", previousId: previous.id, conversation: replacement });
    expect(next.selectedConversationId).toBe(replacement.id);
    expect(next.conversations.some(({ id }) => id === previous.id)).toBe(false);
    expect(next.messages.some(({ conversationId }) => conversationId === previous.id)).toBe(false);
  });

  it("resolves approvals without removing their audit record", () => {
    const initial = createInitialState(demoSnapshot);
    const result = relayReducer(initial, {
      type: "resolve_approval",
      id: "approval-1",
      decision: "denied",
      at: "2026-08-31T11:00:00.000Z",
    });
    expect(result.approvals).toHaveLength(1);
    expect(result.approvals[0]?.status).toBe("denied");
    expect(result.approvals[0]?.decidedAt).toBe("2026-08-31T11:00:00.000Z");
  });

  it("moves a conversation forward when a streamed message arrives", () => {
    const initial = createInitialState(demoSnapshot);
    const original = demoSnapshot.messages[0];
    if (!original) throw new Error("demo message missing");
    const message = {
      ...original,
      id: "message-new",
      createdAt: "2026-08-31T12:00:00.000Z",
    };
    const result = relayReducer(initial, { type: "upsert_message", message });
    expect(result.conversations.find(({ id }) => id === message.conversationId)?.lastMessageAt).toBe(message.createdAt);
  });

  it("removes an agent and its direct conversation from local state", () => {
    const initial = createInitialState(demoSnapshot);
    const result = relayReducer(initial, { type: "remove_agent", id: "agent-lumen" });
    expect(result.agents.some(({ id }) => id === "agent-lumen")).toBe(false);
    expect(result.conversations.some(({ id }) => id === "conversation-lumen")).toBe(false);
    expect(result.messages.some(({ conversationId }) => conversationId === "conversation-lumen")).toBe(false);
  });
});

describe("task graph selectors", () => {
  it("returns direct children and recursive progress", () => {
    expect(taskChildren(demoSnapshot.tasks, "task-launch")).toHaveLength(3);
    expect(taskProgress(demoSnapshot.tasks, "task-launch")).toEqual({ complete: 0, total: 4 });
  });
});
