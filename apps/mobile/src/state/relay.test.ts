import type { RelayEvent } from "@noudle-agents/protocol";
import { describe, expect, it } from "vitest";

import { demoSnapshot } from "../demo";
import { initialRelayState, relayReducer } from "./relay";

describe("relayReducer", () => {
  it("hydrates a snapshot and selects the first conversation", () => {
    const state = relayReducer(initialRelayState, { type: "hydrate", snapshot: demoSnapshot, source: "demo" });
    expect(state.agents).toHaveLength(3);
    expect(state.activeConversationId).toBe(demoSnapshot.conversations[0]?.id);
    expect(state.connection).toBe("offline");
  });

  it("ignores replayed events at or before the current cursor", () => {
    const state = relayReducer(initialRelayState, { type: "hydrate", snapshot: demoSnapshot, source: "server" });
    const replay = {
      id: "event-replay", cursor: demoSnapshot.cursor, workspaceId: "workspace_local", aggregateType: "agent", aggregateId: "agent-orbit", sequence: 2, type: "agent.updated", actorType: "system", actorId: null, payload: { agent: { ...demoSnapshot.agents[0], name: "Wrong" } }, createdAt: new Date().toISOString(),
    } satisfies RelayEvent;
    expect(relayReducer(state, { type: "event", event: replay })).toBe(state);
  });

  it("upserts an agent from a newer event", () => {
    const state = relayReducer(initialRelayState, { type: "hydrate", snapshot: demoSnapshot, source: "server" });
    const changed = { ...demoSnapshot.agents[0]!, status: "completed" as const };
    const event = {
      id: "event-new", cursor: demoSnapshot.cursor + 1, workspaceId: "workspace_local", aggregateType: "agent", aggregateId: changed.id, sequence: 3, type: "agent.status_changed", actorType: "agent", actorId: changed.id, payload: { agent: changed }, createdAt: new Date().toISOString(),
    } satisfies RelayEvent;
    const next = relayReducer(state, { type: "event", event });
    expect(next.agents.find((agent) => agent.id === changed.id)?.status).toBe("completed");
    expect(next.cursor).toBe(event.cursor);
  });

  it("optimistically resolves an approval", () => {
    const state = relayReducer(initialRelayState, { type: "hydrate", snapshot: demoSnapshot, source: "demo" });
    const next = relayReducer(state, { type: "resolveApproval", approvalId: "approval-network", decision: "approved" });
    expect(next.approvals[0]?.status).toBe("approved");
    expect(next.approvals[0]?.decidedAt).not.toBeNull();
  });

  it("delegates a task without changing the task hierarchy", () => {
    const state = relayReducer(initialRelayState, { type: "hydrate", snapshot: demoSnapshot, source: "demo" });
    const beforeParent = state.tasks.find((task) => task.id === "task-stream")?.parentTaskId;
    const next = relayReducer(state, { type: "delegateTask", taskId: "task-stream", agentId: "agent-vale" });
    expect(next.tasks.find((task) => task.id === "task-stream")?.ownerAgentId).toBe("agent-vale");
    expect(next.tasks.find((task) => task.id === "task-stream")?.parentTaskId).toBe(beforeParent);
  });
});
