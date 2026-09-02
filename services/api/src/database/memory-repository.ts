import { randomUUID } from "node:crypto";
import type { RelayEvent } from "@noudle-agents/protocol";
import type { EntityKind, EntityMap, NewEvent, QueueJob, Snapshot, Workspace } from "../model.js";
import type { MessageRunCommit, MessageRunCommitResult, PushSubscription, RelayRepository } from "./repository.js";

export interface MemoryRepositoryState {
  workspace: Map<string, Workspace>;
  entities: { [K in EntityKind]: Map<string, EntityMap[K]> };
  events: RelayEvent[];
  jobs: Map<string, QueueJob>;
  idempotency: Map<string, { message: EntityMap["messages"]; runId: string }>;
  scheduleLocks: Map<string, { lockedAt: string; lockedBy: string }>;
  pushSubscriptions: Map<string, PushSubscription>;
  cursor: number;
}

export function createMemoryState(): MemoryRepositoryState {
  return {
    workspace: new Map(),
    entities: {
      agents: new Map(),
      conversations: new Map(),
      messages: new Map(),
      tasks: new Map(),
      runs: new Map(),
      approvals: new Map(),
      artifacts: new Map(),
      computers: new Map(),
      connectors: new Map(),
      schedules: new Map(),
    },
    events: [],
    jobs: new Map(),
    idempotency: new Map(),
    scheduleLocks: new Map(),
    pushSubscriptions: new Map(),
    cursor: 0,
  };
}

export class MemoryRelayRepository implements RelayRepository {
  readonly kind = "memory" as const;

  constructor(readonly state: MemoryRepositoryState = createMemoryState()) {}

  async initialize(): Promise<void> {}
  async close(): Promise<void> {}

  async getWorkspace(id: string): Promise<Workspace | null> {
    return this.state.workspace.get(id) ?? null;
  }

  async putWorkspace(workspace: Workspace): Promise<void> {
    this.state.workspace.set(workspace.id, structuredClone(workspace));
  }

  async list<K extends EntityKind>(kind: K, workspaceId: string): Promise<EntityMap[K][]> {
    const values = [...this.state.entities[kind].values()] as EntityMap[K][];
    return values
      .filter((value) => value.workspaceId === workspaceId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((value) => structuredClone(value));
  }

  async get<K extends EntityKind>(kind: K, id: string): Promise<EntityMap[K] | null> {
    const value = this.state.entities[kind].get(id) as EntityMap[K] | undefined;
    return value ? structuredClone(value) : null;
  }

  async put<K extends EntityKind>(kind: K, value: EntityMap[K]): Promise<void> {
    const existing = this.state.entities[kind].get(value.id) as EntityMap[K] | undefined;
    if (existing && existing.workspaceId !== value.workspaceId) {
      throw new Error(`Entity id '${value.id}' already belongs to another workspace`);
    }
    (this.state.entities[kind] as Map<string, EntityMap[K]>).set(value.id, structuredClone(value));
    if (kind === "schedules") this.state.scheduleLocks.delete(value.id);
  }

  async delete(kind: EntityKind, id: string): Promise<boolean> {
    const deleted = this.state.entities[kind].delete(id);
    if (kind === "conversations") {
      for (const [messageId, message] of this.state.entities.messages) {
        if (message.conversationId === id) this.state.entities.messages.delete(messageId);
      }
    }
    if (kind === "schedules") this.state.scheduleLocks.delete(id);
    return deleted;
  }

  async snapshot(workspaceId: string): Promise<Snapshot> {
    const [agents, conversations, messages, tasks, approvals, cursor] = await Promise.all([
      this.list("agents", workspaceId),
      this.list("conversations", workspaceId),
      this.list("messages", workspaceId),
      this.list("tasks", workspaceId),
      this.list("approvals", workspaceId),
      this.currentCursor(workspaceId),
    ]);
    return { agents, conversations, messages, tasks, approvals, cursor };
  }

  async appendEvent(event: NewEvent): Promise<RelayEvent> {
    const sequence =
      this.state.events
        .filter(
          (candidate) =>
            candidate.workspaceId === event.workspaceId &&
            candidate.aggregateType === event.aggregateType &&
            candidate.aggregateId === event.aggregateId,
        )
        .at(-1)?.sequence ?? 0;
    const stored: RelayEvent = {
      ...structuredClone(event),
      id: `evt_${randomUUID()}`,
      cursor: ++this.state.cursor,
      sequence: sequence + 1,
      createdAt: new Date().toISOString(),
    };
    this.state.events.push(stored);
    return structuredClone(stored);
  }

  async listEvents(workspaceId: string, after: number, limit = 1000): Promise<RelayEvent[]> {
    return this.state.events
      .filter((event) => event.workspaceId === workspaceId && event.cursor > after)
      .slice(0, limit)
      .map((event) => structuredClone(event));
  }

  async currentCursor(workspaceId: string): Promise<number> {
    return this.state.events.filter((event) => event.workspaceId === workspaceId).at(-1)?.cursor ?? 0;
  }

  async commitMessageRun(input: MessageRunCommit): Promise<MessageRunCommitResult> {
    const key = `${input.message.workspaceId}:send-message:${input.idempotencyKey}`;
    const existing = this.state.idempotency.get(key);
    if (existing) return { ...structuredClone(existing), created: false, events: [] };

    await this.put("messages", input.message);
    await this.put("runs", input.run);
    await this.enqueue(input.job);
    const events: RelayEvent[] = [];
    for (const event of input.events) events.push(await this.appendEvent(event));
    const response = { message: input.message, runId: input.run.id };
    this.state.idempotency.set(key, structuredClone(response));
    return { ...structuredClone(response), created: true, events };
  }

  async enqueue(job: QueueJob): Promise<void> {
    this.state.jobs.set(job.id, structuredClone(job));
  }

  async claim(workspaceId: string, workerId: string, kinds: string[]): Promise<QueueJob | null> {
    const now = new Date().toISOString();
    const staleBefore = new Date(Date.now() - 5 * 60_000).toISOString();
    const job = [...this.state.jobs.values()]
      .filter(
        (candidate) =>
          candidate.workspaceId === workspaceId &&
          kinds.includes(candidate.kind) &&
          ((candidate.status === "queued" && candidate.availableAt <= now) ||
            (candidate.status === "running" && candidate.lockedAt !== null && candidate.lockedAt < staleBefore)),
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
    if (!job) return null;
    const claimed: QueueJob = {
      ...job,
      status: "running",
      attempts: job.attempts + 1,
      lockedAt: now,
      lockedBy: workerId,
      updatedAt: now,
    };
    this.state.jobs.set(claimed.id, claimed);
    return structuredClone(claimed);
  }

  async completeJob(id: string): Promise<void> {
    const job = this.state.jobs.get(id);
    if (!job) return;
    this.state.jobs.set(id, { ...job, status: "completed", updatedAt: new Date().toISOString() });
  }

  async failJob(id: string, error: string, retryAt: string | null): Promise<void> {
    const job = this.state.jobs.get(id);
    if (!job) return;
    this.state.jobs.set(id, {
      ...job,
      status: retryAt ? "queued" : "failed",
      availableAt: retryAt ?? job.availableAt,
      lockedAt: null,
      lockedBy: null,
      error,
      updatedAt: new Date().toISOString(),
    });
  }

  async claimDueSchedule(workspaceId: string, workerId: string, now: string): Promise<EntityMap["schedules"] | null> {
    const staleBefore = new Date(new Date(now).getTime() - 5 * 60_000).toISOString();
    const schedule = [...this.state.entities.schedules.values()]
      .filter((candidate) => {
        const lock = this.state.scheduleLocks.get(candidate.id);
        return candidate.workspaceId === workspaceId && candidate.enabled && candidate.nextRunAt !== null && candidate.nextRunAt <= now && (!lock || lock.lockedAt < staleBefore);
      })
      .sort((left, right) => (left.nextRunAt ?? "").localeCompare(right.nextRunAt ?? ""))[0];
    if (!schedule) return null;
    this.state.scheduleLocks.set(schedule.id, { lockedAt: now, lockedBy: workerId });
    return structuredClone(schedule);
  }

  async releaseScheduleClaim(id: string): Promise<void> {
    this.state.scheduleLocks.delete(id);
  }

  async listPushSubscriptions(workspaceId: string): Promise<PushSubscription[]> {
    return [...this.state.pushSubscriptions.values()]
      .filter((subscription) => subscription.workspaceId === workspaceId)
      .map((subscription) => structuredClone(subscription));
  }

  async putPushSubscription(subscription: PushSubscription): Promise<void> {
    this.state.pushSubscriptions.set(subscription.token, structuredClone(subscription));
  }

  async deletePushSubscription(workspaceId: string, token: string): Promise<boolean> {
    const subscription = this.state.pushSubscriptions.get(token);
    if (!subscription || subscription.workspaceId !== workspaceId) return false;
    return this.state.pushSubscriptions.delete(token);
  }
}
