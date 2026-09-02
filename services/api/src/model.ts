import type { Agent, Approval, ConnectorAuthType, Conversation, Message, RelayEvent, Run, Schedule, Task } from "@noudle-agents/protocol";

export interface Workspace {
  id: string;
  name: string;
  ownerId: string;
  profile: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface Snapshot {
  agents: Agent[];
  conversations: Conversation[];
  messages: Message[];
  tasks: Task[];
  approvals: Approval[];
  cursor: number;
}

export interface ArtifactProvenance {
  source: "user_upload" | "agent_output" | "sandbox_export";
  createdByType: "user" | "agent" | "system";
  createdById: string;
  originalName: string | null;
}

export interface ArtifactRecord {
  id: string;
  logicalId: string;
  workspaceId: string;
  version: number;
  parentArtifactId: string | null;
  taskId: string | null;
  runId: string | null;
  agentId: string | null;
  name: string;
  mimeType: string;
  size: number;
  checksum: string;
  storageKey: string;
  provenance: ArtifactProvenance;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ComputerSession {
  id: string;
  workspaceId: string;
  agentId: string | null;
  taskId: string | null;
  status: "creating" | "running" | "stopped" | "error";
  browser: boolean;
  networkAccess: boolean;
  computerUrl: string | null;
  computerHostPort: number | null;
  controlMode: "watch" | "user" | "agent";
  controlHolderId: string | null;
  leaseExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectorRecord {
  id: string;
  workspaceId: string;
  provider: string;
  kind: "builtin" | "custom";
  name: string;
  baseUrl: string | null;
  authType: ConnectorAuthType;
  headerName: string | null;
  authPrefix: string;
  accountLabel: string;
  encryptedSecret: string;
  createdByType: "user" | "agent";
  createdById: string;
  connectedAt: string;
  createdAt: string;
  updatedAt: string;
}

export type EntityKind = "agents" | "conversations" | "messages" | "tasks" | "runs" | "approvals" | "artifacts" | "computers" | "connectors" | "schedules";
export interface EntityMap {
  agents: Agent;
  conversations: Conversation;
  messages: Message;
  tasks: Task;
  runs: Run;
  approvals: Approval;
  artifacts: ArtifactRecord;
  computers: ComputerSession;
  connectors: ConnectorRecord;
  schedules: Schedule;
}

export type NewEvent = Omit<RelayEvent, "id" | "cursor" | "sequence" | "createdAt">;

export interface QueueJob<T = Record<string, unknown>> {
  id: string;
  workspaceId: string;
  kind: string;
  payload: T;
  status: "queued" | "running" | "completed" | "failed";
  attempts: number;
  availableAt: string;
  lockedAt: string | null;
  lockedBy: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IdempotentMessageResult {
  message: Message;
  runId: string;
}
