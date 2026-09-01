import type { Agent, Approval, Conversation, Message, RelayEvent, Task } from "@noudle-agents/protocol";

export type RootTab = "chats" | "tasks" | "computer" | "library";
export type LibraryPage = "root" | "agents" | "files" | "skills" | "routines" | "memory" | "settings";

export interface InstanceConfig {
  baseUrl: string;
  token: string;
}

export interface RelayState {
  agents: Agent[];
  approvals: Approval[];
  conversations: Conversation[];
  messages: Message[];
  tasks: Task[];
  cursor: number;
  connection: "loading" | "live" | "offline" | "error";
  error: string | null;
  source: "server" | "demo";
  activeConversationId: string | null;
  activeTab: RootTab;
  libraryPage: LibraryPage;
  takingControl: boolean;
}

export type RelayAction =
  | { type: "hydrate"; snapshot: Pick<RelayState, "agents" | "approvals" | "conversations" | "messages" | "tasks" | "cursor">; source: "server" | "demo" }
  | { type: "connection"; connection: RelayState["connection"]; error?: string | null }
  | { type: "event"; event: RelayEvent }
  | { type: "selectConversation"; conversationId: string | null }
  | { type: "selectTab"; tab: RootTab }
  | { type: "openLibrary"; page: LibraryPage }
  | { type: "control"; value: boolean }
  | { type: "optimisticMessage"; message: Message }
  | { type: "resolveApproval"; approvalId: string; decision: "approved" | "denied" }
  | { type: "delegateTask"; taskId: string; agentId: string };
