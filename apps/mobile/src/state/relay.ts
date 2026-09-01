import type { Agent, Approval, Message, RelayEvent, Task } from "@noudle-agents/protocol";

import { demoSnapshot } from "../demo";
import type { RelayAction, RelayState } from "../model";

export const initialRelayState: RelayState = {
  agents: [],
  approvals: [],
  conversations: [],
  messages: [],
  tasks: [],
  cursor: 0,
  connection: "loading",
  error: null,
  source: "demo",
  activeConversationId: null,
  activeTab: "chats",
  libraryPage: "root",
  takingControl: false,
};

function upsert<T extends { id: string }>(items: T[], value: T): T[] {
  const index = items.findIndex((item) => item.id === value.id);
  if (index === -1) return [...items, value];
  return items.map((item, itemIndex) => (itemIndex === index ? value : item));
}

function payloadValue<T>(event: RelayEvent, key: string): T | null {
  const value = event.payload[key];
  return value && typeof value === "object" ? (value as T) : null;
}

function applyEvent(state: RelayState, event: RelayEvent): RelayState {
  if (event.cursor <= state.cursor) return state;
  const next = { ...state, cursor: event.cursor };

  if (event.type.startsWith("agent.")) {
    const agent = payloadValue<Agent>(event, "agent");
    return agent ? { ...next, agents: upsert(state.agents, agent) } : next;
  }
  if (event.type === "message.created") {
    const message = payloadValue<Message>(event, "message");
    return message ? { ...next, messages: upsert(state.messages, message) } : next;
  }
  if (event.type.startsWith("task.")) {
    const task = payloadValue<Task>(event, "task");
    return task ? { ...next, tasks: upsert(state.tasks, task) } : next;
  }
  if (event.type.startsWith("approval.")) {
    const approval = payloadValue<Approval>(event, "approval");
    return approval ? { ...next, approvals: upsert(state.approvals, approval) } : next;
  }
  return next;
}

export function relayReducer(state: RelayState, action: RelayAction): RelayState {
  switch (action.type) {
    case "hydrate": {
      const activeExists = action.snapshot.conversations.some((conversation) => conversation.id === state.activeConversationId);
      return {
        ...state,
        ...action.snapshot,
        activeConversationId: activeExists
          ? state.activeConversationId
          : (action.snapshot.conversations[0]?.id ?? null),
        connection: action.source === "server" ? "live" : "offline",
        error: null,
        source: action.source,
      };
    }
    case "connection":
      return { ...state, connection: action.connection, error: action.error ?? null };
    case "event":
      return applyEvent(state, action.event);
    case "selectConversation":
      return { ...state, activeConversationId: action.conversationId };
    case "selectTab":
      return { ...state, activeTab: action.tab, libraryPage: action.tab === "library" ? state.libraryPage : "root" };
    case "openLibrary":
      return { ...state, libraryPage: action.page };
    case "control":
      return { ...state, takingControl: action.value };
    case "optimisticMessage":
      return { ...state, messages: upsert(state.messages, action.message) };
    case "resolveApproval":
      return {
        ...state,
        approvals: state.approvals.map((approval) => approval.id === action.approvalId
          ? { ...approval, status: action.decision, decidedAt: new Date().toISOString() }
          : approval),
      };
    case "delegateTask":
      return {
        ...state,
        tasks: state.tasks.map((task) => task.id === action.taskId
          ? { ...task, ownerAgentId: action.agentId, status: "accepted", updatedAt: new Date().toISOString() }
          : task),
      };
    default:
      return state;
  }
}

export function demoRelayState(): RelayState {
  return relayReducer(initialRelayState, { type: "hydrate", snapshot: demoSnapshot, source: "demo" });
}
