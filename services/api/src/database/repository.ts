import type { RelayEvent } from "@noudle-agents/protocol";
import type {
  EntityKind,
  EntityMap,
  IdempotentMessageResult,
  NewEvent,
  QueueJob,
  Snapshot,
  Workspace,
} from "../model.js";

export interface MessageRunCommit {
  message: EntityMap["messages"];
  run: EntityMap["runs"];
  job: QueueJob;
  idempotencyKey: string;
  events: NewEvent[];
}

export interface MessageRunCommitResult extends IdempotentMessageResult {
  created: boolean;
  events: RelayEvent[];
}

export interface PushSubscription {
  token: string;
  workspaceId: string;
  platform: "ios" | "android";
  deviceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RelayRepository {
  readonly kind: "memory" | "postgres";
  initialize(): Promise<void>;
  close(): Promise<void>;
  getWorkspace(id: string): Promise<Workspace | null>;
  putWorkspace(workspace: Workspace): Promise<void>;
  list<K extends EntityKind>(kind: K, workspaceId: string): Promise<EntityMap[K][]>;
  get<K extends EntityKind>(kind: K, id: string): Promise<EntityMap[K] | null>;
  put<K extends EntityKind>(kind: K, value: EntityMap[K]): Promise<void>;
  delete(kind: EntityKind, id: string): Promise<boolean>;
  snapshot(workspaceId: string): Promise<Snapshot>;
  appendEvent(event: NewEvent): Promise<RelayEvent>;
  listEvents(workspaceId: string, after: number, limit?: number): Promise<RelayEvent[]>;
  currentCursor(workspaceId: string): Promise<number>;
  commitMessageRun(input: MessageRunCommit): Promise<MessageRunCommitResult>;
  enqueue(job: QueueJob): Promise<void>;
  claim(workspaceId: string, workerId: string, kinds: string[]): Promise<QueueJob | null>;
  completeJob(id: string): Promise<void>;
  failJob(id: string, error: string, retryAt: string | null): Promise<void>;
  claimDueSchedule(workspaceId: string, workerId: string, now: string): Promise<EntityMap["schedules"] | null>;
  releaseScheduleClaim(id: string): Promise<void>;
  listPushSubscriptions(workspaceId: string): Promise<PushSubscription[]>;
  putPushSubscription(subscription: PushSubscription): Promise<void>;
  deletePushSubscription(workspaceId: string, token: string): Promise<boolean>;
}
