import type { Agent, Approval, Conversation, Message, Task } from "@noudle-agents/protocol";
import type { RelaySnapshot } from "@noudle-agents/api-client";

export type ConnectionMode = "connecting" | "live" | "demo" | "offline" | "error";
export type CenterView = "conversations" | "tasks";
export type DrawerTab = "computer" | "files";

export interface RelayState extends RelaySnapshot {
  connection: ConnectionMode;
  connectionMessage: string | null;
  selectedConversationId: string | null;
  selectedTaskId: string | null;
  centerView: CenterView;
  drawerTab: DrawerTab;
}

export type RelayAction =
  | { type: "snapshot"; snapshot: RelaySnapshot; connection: ConnectionMode }
  | { type: "connection"; connection: ConnectionMode; message?: string | null }
  | { type: "select_conversation"; id: string }
  | { type: "select_task"; id: string }
  | { type: "center_view"; view: CenterView }
  | { type: "drawer_tab"; tab: DrawerTab }
  | { type: "upsert_agent"; agent: Agent }
  | { type: "remove_agent"; id: string }
  | { type: "upsert_conversation"; conversation: Conversation }
  | { type: "replace_conversation"; previousId: string; conversation: Conversation }
  | { type: "upsert_message"; message: Message }
  | { type: "upsert_task"; task: Task }
  | { type: "resolve_approval"; id: string; decision: "approved" | "denied"; at: string };

function upsert<T extends { id: string }>(items: T[], item: T): T[] {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index < 0) return [...items, item];
  return items.map((candidate) => (candidate.id === item.id ? item : candidate));
}

function directConversationId(conversations: Conversation[], preferredId?: string | null): string | null {
  const preferred = preferredId ? conversations.find(({ id }) => id === preferredId) : null;
  if (preferred?.kind === "direct" && preferred.memberAgentIds.length === 1) return preferred.id;
  return conversations.find(({ kind, memberAgentIds }) => kind === "direct" && memberAgentIds.length === 1)?.id ?? null;
}

export function createInitialState(snapshot: RelaySnapshot): RelayState {
  return {
    ...snapshot,
    connection: "connecting",
    connectionMessage: null,
    selectedConversationId: directConversationId(snapshot.conversations),
    selectedTaskId: snapshot.tasks[0]?.id ?? null,
    centerView: "conversations",
    drawerTab: "computer",
  };
}

export function relayReducer(state: RelayState, action: RelayAction): RelayState {
  switch (action.type) {
    case "snapshot":
      return {
        ...state,
        ...action.snapshot,
        connection: action.connection,
        connectionMessage: null,
        selectedConversationId: directConversationId(action.snapshot.conversations, state.selectedConversationId),
        selectedTaskId:
          state.selectedTaskId && action.snapshot.tasks.some(({ id }) => id === state.selectedTaskId)
            ? state.selectedTaskId
            : (action.snapshot.tasks[0]?.id ?? null),
      };
    case "connection":
      return { ...state, connection: action.connection, connectionMessage: action.message ?? null };
    case "select_conversation": {
      const conversation = state.conversations.find(({ id }) => id === action.id);
      return {
        ...state,
        selectedConversationId: action.id,
        selectedTaskId: conversation?.taskId ?? state.selectedTaskId,
        centerView: "conversations",
      };
    }
    case "select_task": {
      const task = state.tasks.find(({ id }) => id === action.id);
      return {
        ...state,
        selectedTaskId: action.id,
        selectedConversationId: task?.conversationId ?? state.selectedConversationId,
        centerView: "tasks",
        drawerTab: "computer",
      };
    }
    case "center_view":
      return { ...state, centerView: action.view };
    case "drawer_tab":
      return { ...state, drawerTab: action.tab };
    case "upsert_agent":
      return { ...state, agents: upsert(state.agents, action.agent) };
    case "remove_agent": {
      const removedConversationIds = new Set(
        state.conversations
          .filter(({ kind, memberAgentIds }) => kind === "direct" && memberAgentIds.length === 1 && memberAgentIds[0] === action.id)
          .map(({ id }) => id),
      );
      const conversations = state.conversations
        .filter(({ id }) => !removedConversationIds.has(id))
        .map((conversation) => ({ ...conversation, memberAgentIds: conversation.memberAgentIds.filter((id) => id !== action.id) }))
        .filter(({ memberAgentIds }) => memberAgentIds.length > 0);
      return {
        ...state,
        agents: state.agents.filter(({ id }) => id !== action.id),
        conversations,
        messages: state.messages.filter(({ conversationId }) => !removedConversationIds.has(conversationId)),
        selectedConversationId: directConversationId(conversations, state.selectedConversationId),
      };
    }
    case "upsert_conversation":
      return {
        ...state,
        conversations: upsert(state.conversations, action.conversation),
        selectedConversationId:
          action.conversation.kind === "direct" && action.conversation.memberAgentIds.length === 1
            ? action.conversation.id
            : state.selectedConversationId,
        centerView: "conversations",
      };
    case "replace_conversation":
      return {
        ...state,
        conversations: [...state.conversations.filter(({ id }) => id !== action.previousId), action.conversation],
        messages: state.messages.filter(({ conversationId }) => conversationId !== action.previousId),
        selectedConversationId: action.conversation.id,
        selectedTaskId: action.conversation.taskId ?? state.selectedTaskId,
        centerView: "conversations",
      };
    case "upsert_message":
      return {
        ...state,
        messages: upsert(state.messages, action.message),
        conversations: state.conversations.map((conversation) =>
          conversation.id === action.message.conversationId
            ? { ...conversation, lastMessageAt: action.message.createdAt, updatedAt: action.message.createdAt }
            : conversation,
        ),
      };
    case "upsert_task":
      return { ...state, tasks: upsert(state.tasks, action.task) };
    case "resolve_approval":
      return {
        ...state,
        approvals: state.approvals.map((approval): Approval =>
          approval.id === action.id
            ? { ...approval, status: action.decision, decidedAt: action.at }
            : approval,
        ),
      };
  }
}

export function taskChildren(tasks: Task[], parentTaskId: string | null): Task[] {
  return tasks
    .filter((task) => task.parentTaskId === parentTaskId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function taskProgress(tasks: Task[], rootId: string): { complete: number; total: number } {
  const descendants = tasks.filter((task) => task.id === rootId || isDescendant(tasks, task, rootId));
  return {
    complete: descendants.filter((task) => task.status === "completed").length,
    total: descendants.length,
  };
}

function isDescendant(tasks: Task[], task: Task, rootId: string): boolean {
  let current = task;
  const visited = new Set<string>();
  while (current.parentTaskId && !visited.has(current.id)) {
    if (current.parentTaskId === rootId) return true;
    visited.add(current.id);
    const parent = tasks.find(({ id }) => id === current.parentTaskId);
    if (!parent) return false;
    current = parent;
  }
  return false;
}
