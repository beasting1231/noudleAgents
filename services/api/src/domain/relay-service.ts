import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  AgentSchema,
  ApprovalSchema,
  ConversationSchema,
  MessageSchema,
  RunSchema,
  ScheduleSchema,
  TaskBudgetSchema,
  TaskSchema,
  type Agent,
  type Approval,
  type Conversation,
  type CreateAgentInput,
  type CreateConversationInput,
  type CreateScheduleInput,
  type CreateTaskInput,
  type DelegateTaskInput,
  type Message,
  type MessageAttachment,
  type RelayEvent,
  type Run,
  type Schedule,
  type SendMessageInput,
  type Task,
  type UpdateScheduleInput,
} from "@noudle-agents/protocol";
import type { RelayConfig } from "../config.js";
import type { RelayRepository } from "../database/repository.js";
import { EventHub } from "../events.js";
import type { NewEvent, QueueJob, Snapshot } from "../model.js";
import { seedLocalWorkspace } from "../seed.js";
import { nextCronOccurrence, normalizeCronExpression, validateTimezone } from "../schedules/cron.js";
import { conflict, DomainError, notFound } from "./errors.js";

const terminalTaskStatuses = new Set(["completed", "failed", "cancelled"]);
const activeRunStatuses = new Set(["queued", "starting", "running", "waiting_approval", "waiting_user"]);

export interface AgentPatch {
  name?: string | undefined;
  role?: string | undefined;
  description?: string | undefined;
  instructions?: string | undefined;
  avatar?: string | undefined;
  color?: string | undefined;
  capabilities?: string[] | undefined;
  status?: Agent["status"] | undefined;
  codexThreadId?: string | null | undefined;
}

export interface ConversationPatch {
  title?: string | undefined;
  memberAgentIds?: string[] | undefined;
}

export interface TaskPatch {
  title?: string | undefined;
  objective?: string | undefined;
  acceptanceCriteria?: string[] | undefined;
  ownerAgentId?: string | null | undefined;
  parentTaskId?: string | null | undefined;
  conversationId?: string | null | undefined;
  status?: Task["status"] | undefined;
  priority?: Task["priority"] | undefined;
  budget?:
    | { maxTokens?: number | undefined; maxWallSeconds?: number | undefined; maxChildTasks?: number | undefined }
    | undefined;
  blocker?: string | null | undefined;
  resultSummary?: string | null | undefined;
}

export interface UserProfilePatch {
  values: Record<string, string>;
  remove: string[];
}

const forbiddenProfileKey = /(password|passphrase|passcode|pin|otp|two.?factor|2fa|verification.?code|captcha|cvv|cvc|security.?answer|recovery.?code|access.?token|refresh.?token|api.?key|secret|private.?key|card.?number)/i;

function normalizedProfileKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function parseStoredSchedule(value: unknown): Schedule {
  const raw = value && typeof value === "object" ? value as Partial<Schedule> : {};
  return ScheduleSchema.parse({ ...raw, triggerType: raw.triggerType ?? "cron", webhookToken: raw.webhookToken ?? null });
}

export class RelayService {
  private interruptHandler: ((runId: string) => boolean) | null = null;

  constructor(
    readonly repository: RelayRepository,
    readonly config: RelayConfig,
    readonly events: EventHub,
  ) {}

  async initialize(): Promise<void> {
    await seedLocalWorkspace(this.repository, this.config);
  }

  setInterruptHandler(handler: (runId: string) => boolean): void {
    this.interruptHandler = handler;
  }

  private id(prefix: string): string {
    return `${prefix}_${randomUUID()}`;
  }

  private newEvent(
    aggregateType: string,
    aggregateId: string,
    type: NewEvent["type"],
    payload: Record<string, unknown>,
    actorType: NewEvent["actorType"] = "user",
    actorId: string | null = this.config.ownerId,
  ): NewEvent {
    return {
      workspaceId: this.config.workspaceId,
      aggregateType,
      aggregateId,
      type,
      actorType,
      actorId,
      payload,
    };
  }

  async emit(event: NewEvent): Promise<RelayEvent> {
    const stored = await this.repository.appendEvent(event);
    this.events.publish(stored);
    return stored;
  }

  getSnapshot(): Promise<Snapshot> {
    return this.repository.snapshot(this.config.workspaceId);
  }

  async getUserProfile(): Promise<Record<string, string>> {
    const workspace = await this.repository.getWorkspace(this.config.workspaceId);
    if (!workspace) throw notFound("Workspace", this.config.workspaceId);
    return { ...workspace.profile };
  }

  async updateUserProfile(input: UserProfilePatch): Promise<{ updatedKeys: string[]; removedKeys: string[] }> {
    const workspace = await this.repository.getWorkspace(this.config.workspaceId);
    if (!workspace) throw notFound("Workspace", this.config.workspaceId);
    const profile = { ...workspace.profile };
    const updatedKeys: string[] = [];
    const removedKeys: string[] = [];
    for (const [rawKey, rawValue] of Object.entries(input.values)) {
      const key = normalizedProfileKey(rawKey);
      if (!key || key.length > 80) throw new DomainError(400, "invalid_profile_key", "Profile keys must be 1 to 80 characters");
      if (forbiddenProfileKey.test(key)) {
        throw new DomainError(400, "profile_secret_forbidden", `Do not store authentication or one-time secret '${key}' in the reusable profile`);
      }
      const value = rawValue.trim();
      if (!value) throw new DomainError(400, "invalid_profile_value", `Profile value '${key}' cannot be empty; remove the key instead`);
      profile[key] = value;
      updatedKeys.push(key);
    }
    for (const rawKey of input.remove) {
      const key = normalizedProfileKey(rawKey);
      if (key && Object.hasOwn(profile, key)) {
        delete profile[key];
        removedKeys.push(key);
      }
    }
    if (Object.keys(profile).length > 100) throw new DomainError(400, "profile_too_large", "The reusable profile is limited to 100 fields");
    await this.repository.putWorkspace({ ...workspace, profile, updatedAt: new Date().toISOString() });
    return { updatedKeys, removedKeys };
  }

  listAgents(): Promise<Agent[]> {
    return this.repository.list("agents", this.config.workspaceId);
  }

  async getAgent(id: string): Promise<Agent> {
    return (await this.repository.get("agents", id)) ?? Promise.reject(notFound("Agent", id));
  }

  async createAgent(
    input: CreateAgentInput,
    actorType: "user" | "agent" = "user",
    actorId = this.config.ownerId,
  ): Promise<Agent> {
    const now = new Date().toISOString();
    const agent = AgentSchema.parse({
      id: this.id("agt"),
      workspaceId: this.config.workspaceId,
      name: input.name,
      role: input.role,
      description: input.description ?? "",
      instructions: input.instructions ?? "",
      avatar: input.avatar ?? input.name.slice(0, 2).toUpperCase(),
      color: input.color ?? "#D7FF64",
      capabilities: input.capabilities ?? [],
      status: "idle",
      currentTaskId: null,
      codexThreadId: null,
      createdAt: now,
      updatedAt: now,
    });
    await this.repository.put("agents", agent);
    await this.emit(this.newEvent("agent", agent.id, "agent.created", { agent }, actorType, actorId));
    return agent;
  }

  async updateAgent(
    id: string,
    patch: AgentPatch,
    actorType: "user" | "agent" = "user",
    actorId = this.config.ownerId,
  ): Promise<Agent> {
    const current = await this.getAgent(id);
    const agent = AgentSchema.parse({ ...current, ...patch, id: current.id, workspaceId: current.workspaceId, updatedAt: new Date().toISOString() });
    await this.repository.put("agents", agent);
    await this.emit(this.newEvent("agent", agent.id, "agent.updated", { agent }, actorType, actorId));
    return agent;
  }

  async deleteAgent(id: string, actorType: "user" | "agent" = "user", actorId = this.config.ownerId): Promise<void> {
    const agent = await this.getAgent(id);
    const [tasks, runs, conversations] = await Promise.all([this.listTasks(), this.listRuns(), this.listConversations()]);
    if (tasks.some((task) => task.ownerAgentId === id && !terminalTaskStatuses.has(task.status))) {
      throw conflict("agent_in_use", "Agent owns an active task and cannot be deleted");
    }
    if (runs.some((run) => run.agentId === id && activeRunStatuses.has(run.status))) {
      throw conflict("agent_in_use", "Agent has an active run and cannot be deleted");
    }
    for (const conversation of conversations.filter(({ memberAgentIds }) => memberAgentIds.includes(id))) {
      const remainingMembers = conversation.memberAgentIds.filter((agentId) => agentId !== id);
      if (conversation.kind === "direct" || remainingMembers.length === 0) {
        await this.repository.delete("conversations", conversation.id);
        await this.emit(this.newEvent("conversation", conversation.id, "conversation.deleted", { conversation, conversationId: conversation.id }, actorType, actorId));
      } else {
        const updated = ConversationSchema.parse({ ...conversation, memberAgentIds: remainingMembers, updatedAt: new Date().toISOString() });
        await this.repository.put("conversations", updated);
        await this.emit(this.newEvent("conversation", updated.id, "conversation.updated", { conversation: updated }, actorType, actorId));
      }
    }
    await this.repository.delete("agents", id);
    await this.emit(this.newEvent("agent", id, "agent.deleted", { agent, agentId: id }, actorType, actorId));
  }

  listConversations(): Promise<Conversation[]> {
    return this.repository.list("conversations", this.config.workspaceId);
  }

  async getConversation(id: string): Promise<Conversation> {
    return (await this.repository.get("conversations", id)) ?? Promise.reject(notFound("Conversation", id));
  }

  async validateAgentIds(ids: string[]): Promise<void> {
    const unique = new Set(ids);
    if (unique.size !== ids.length) throw new DomainError(400, "duplicate_agents", "Agent members must be unique");
    for (const id of ids) await this.getAgent(id);
  }

  async createConversation(
    input: CreateConversationInput,
    actorType: "user" | "agent" = "user",
    actorId = this.config.ownerId,
  ): Promise<Conversation> {
    await this.validateAgentIds(input.memberAgentIds);
    if (input.taskId) await this.getTask(input.taskId);
    if (input.kind === "direct" && input.memberAgentIds.length === 1) {
      const existing = (await this.listConversations()).find(
        ({ kind, memberAgentIds }) => kind === "direct" && memberAgentIds.length === 1 && memberAgentIds[0] === input.memberAgentIds[0],
      );
      if (existing) return existing;
    }
    const now = new Date().toISOString();
    const conversation = ConversationSchema.parse({
      id: this.id("cnv"),
      workspaceId: this.config.workspaceId,
      kind: input.kind,
      title: input.title,
      memberAgentIds: input.memberAgentIds,
      taskId: input.taskId ?? null,
      lastMessageAt: null,
      createdAt: now,
      updatedAt: now,
    });
    await this.repository.put("conversations", conversation);
    await this.emit(this.newEvent("conversation", conversation.id, "conversation.created", { conversation }, actorType, actorId));
    return conversation;
  }

  async updateConversation(
    id: string,
    patch: ConversationPatch,
    actorType: "user" | "agent" = "user",
    actorId = this.config.ownerId,
  ): Promise<Conversation> {
    if (actorType === "agent") await this.getAgent(actorId);
    const current = await this.getConversation(id);
    if (patch.memberAgentIds) await this.validateAgentIds(patch.memberAgentIds);
    const conversation = ConversationSchema.parse({
      ...current,
      ...patch,
      id: current.id,
      workspaceId: current.workspaceId,
      updatedAt: new Date().toISOString(),
    });
    await this.repository.put("conversations", conversation);
    await this.emit(this.newEvent("conversation", conversation.id, "conversation.updated", { conversation }, actorType, actorId));
    return conversation;
  }

  async deleteConversation(id: string, actorType: "user" | "agent" = "user", actorId = this.config.ownerId): Promise<void> {
    if (actorType === "agent") await this.getAgent(actorId);
    const conversation = await this.getConversation(id);
    const runs = await this.listRuns();
    if (runs.some((run) => run.conversationId === id && activeRunStatuses.has(run.status))) {
      throw conflict("conversation_in_use", "Conversation has an active run and cannot be deleted");
    }
    await this.repository.delete("conversations", id);
    await this.emit(
      this.newEvent("conversation", id, "conversation.deleted", { conversation, conversationId: id }, actorType, actorId),
    );
  }

  async clearConversation(id: string, actorType: "user" | "agent" = "user", actorId = this.config.ownerId): Promise<Conversation> {
    if (actorType !== "user") throw new DomainError(403, "user_only", "Only the workspace owner can clear a conversation");
    const conversation = await this.getConversation(id);
    if (conversation.kind !== "direct" || conversation.memberAgentIds.length !== 1) {
      throw new DomainError(400, "direct_conversation_required", "Only a direct agent conversation can be cleared");
    }
    const agentId = conversation.memberAgentIds[0]!;
    const activeRuns = (await this.listRuns()).filter(
      (run) => run.conversationId === id && activeRunStatuses.has(run.status),
    );
    for (const run of activeRuns) await this.interruptRun(run.id);
    await this.deleteConversation(id, actorType, actorId);
    await this.updateAgent(agentId, { status: "idle", codexThreadId: null }, actorType, actorId);
    return this.createConversation(
      { kind: "direct", title: conversation.title, memberAgentIds: [agentId], taskId: null },
      actorType,
      actorId,
    );
  }

  async listMessages(conversationId: string): Promise<Message[]> {
    await this.getConversation(conversationId);
    return (await this.repository.list("messages", this.config.workspaceId)).filter(
      (message) => message.conversationId === conversationId,
    );
  }

  async sendMessage(
    conversationId: string,
    input: SendMessageInput,
    resolveAttachments?: (messageId: string, artifactIds: string[]) => Promise<MessageAttachment[]>,
  ): Promise<{ message: Message; runId: string }> {
    const conversation = await this.getConversation(conversationId);
    const agent = await this.getAgent(input.agentId);
    if (!conversation.memberAgentIds.includes(agent.id)) {
      throw new DomainError(400, "agent_not_in_conversation", "Target agent is not a member of this conversation");
    }
    if (input.taskId) await this.getTask(input.taskId);
    if (input.replyToMessageId) {
      const reply = await this.repository.get("messages", input.replyToMessageId);
      if (!reply || reply.conversationId !== conversationId) {
        throw new DomainError(400, "invalid_reply", "Reply target must be a message in this conversation");
      }
    }
    const now = new Date().toISOString();
    const messageId = this.id("msg");
    const attachments = input.attachmentIds.length > 0
      ? await resolveAttachments?.(messageId, input.attachmentIds)
      : [];
    if (input.attachmentIds.length > 0 && !attachments) {
      throw new DomainError(500, "attachment_service_unavailable", "Attachments could not be prepared for the agent");
    }
    const message = MessageSchema.parse({
      id: messageId,
      workspaceId: this.config.workspaceId,
      conversationId,
      role: "user",
      authorId: this.config.ownerId,
      content: input.content,
      attachments,
      replyToMessageId: input.replyToMessageId ?? null,
      clientOperationId: input.clientOperationId,
      createdAt: now,
    });
    const run = RunSchema.parse({
      id: this.id("run"),
      workspaceId: this.config.workspaceId,
      agentId: agent.id,
      conversationId,
      taskId: input.taskId ?? null,
      triggerMessageId: message.id,
      status: "queued",
      codexTurnId: null,
      error: null,
      startedAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    const job: QueueJob = {
      id: this.id("job"),
      workspaceId: this.config.workspaceId,
      kind: "agent.run",
      payload: { runId: run.id, settings: input.settings },
      status: "queued",
      attempts: 0,
      availableAt: now,
      lockedAt: null,
      lockedBy: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    const result = await this.repository.commitMessageRun({
      message,
      run,
      job,
      idempotencyKey: input.clientOperationId,
      events: [
        this.newEvent("message", message.id, "message.created", { message }),
        this.newEvent("run", run.id, "run.created", { run }),
      ],
    });
    for (const event of result.events) this.events.publish(event);
    if (result.created) {
      await this.repository.put("conversations", { ...conversation, lastMessageAt: now, updatedAt: now });
    }
    return { message: result.message, runId: result.runId };
  }

  async listSchedules(): Promise<Schedule[]> {
    return (await this.repository.list("schedules", this.config.workspaceId)).map(parseStoredSchedule);
  }

  async getSchedule(id: string): Promise<Schedule> {
    const schedule = await this.repository.get("schedules", id);
    if (!schedule) throw notFound("Schedule", id);
    return parseStoredSchedule(schedule);
  }

  private async scheduleConversation(agentId: string, conversationId?: string): Promise<Conversation> {
    if (conversationId) {
      const conversation = await this.getConversation(conversationId);
      if (!conversation.memberAgentIds.includes(agentId)) {
        throw new DomainError(400, "agent_not_in_conversation", "Scheduled agent must belong to the selected conversation");
      }
      return conversation;
    }
    const conversation = (await this.listConversations()).find(
      (candidate) => candidate.kind === "direct" && candidate.memberAgentIds.length === 1 && candidate.memberAgentIds[0] === agentId,
    );
    if (!conversation) throw new DomainError(400, "schedule_conversation_required", "This agent has no direct conversation for scheduled runs");
    return conversation;
  }

  async createSchedule(
    input: CreateScheduleInput,
    actorType: "user" | "agent" = "user",
    actorId = this.config.ownerId,
  ): Promise<Schedule> {
    const agentId = actorType === "agent" ? actorId : input.agentId;
    const agent = await this.getAgent(agentId);
    const conversation = await this.scheduleConversation(agent.id, input.conversationId);
    const now = new Date();
    const triggerType = input.triggerType ?? "cron";
    const cronExpression = normalizeCronExpression(input.cronExpression ?? "0 9 * * *");
    const timezone = validateTimezone(input.timezone ?? "UTC");
    const enabled = input.enabled ?? true;
    const schedule = ScheduleSchema.parse({
      id: this.id("sch"),
      workspaceId: this.config.workspaceId,
      triggerType,
      agentId: agent.id,
      conversationId: conversation.id,
      title: input.title,
      prompt: input.prompt,
      cronExpression,
      timezone,
      enabled,
      nextRunAt: enabled && triggerType === "cron" ? nextCronOccurrence(cronExpression, timezone, now) : null,
      lastRunAt: null,
      latestRunId: null,
      webhookToken: triggerType === "webhook" ? randomUUID().replaceAll("-", "") : null,
      createdByType: actorType,
      createdById: actorId,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    await this.repository.put("schedules", schedule);
    await this.emit(this.newEvent("schedule", schedule.id, "schedule.created", { schedule }, actorType, actorId));
    return schedule;
  }

  async updateSchedule(
    id: string,
    input: UpdateScheduleInput,
    actorType: "user" | "agent" = "user",
    actorId = this.config.ownerId,
  ): Promise<Schedule> {
    const current = await this.getSchedule(id);
    if (actorType === "agent" && (current.agentId !== actorId || (input.agentId !== undefined && input.agentId !== actorId))) {
      throw new DomainError(403, "schedule_owner_forbidden", "Agents can only configure their own schedules");
    }
    const agentId = actorType === "agent" ? actorId : (input.agentId ?? current.agentId);
    await this.getAgent(agentId);
    const conversation = await this.scheduleConversation(agentId, input.conversationId ?? (agentId === current.agentId ? current.conversationId : undefined));
    const triggerType = input.triggerType ?? current.triggerType;
    const cronExpression = normalizeCronExpression(input.cronExpression ?? current.cronExpression);
    const timezone = validateTimezone(input.timezone ?? current.timezone);
    const enabled = input.enabled ?? current.enabled;
    const now = new Date();
    const timingChanged = triggerType !== current.triggerType || cronExpression !== current.cronExpression || timezone !== current.timezone || (!current.enabled && enabled);
    const schedule = ScheduleSchema.parse({
      ...current,
      ...input,
      triggerType,
      agentId,
      conversationId: conversation.id,
      cronExpression,
      timezone,
      enabled,
      nextRunAt: enabled && triggerType === "cron" ? (timingChanged || current.nextRunAt === null ? nextCronOccurrence(cronExpression, timezone, now) : current.nextRunAt) : null,
      webhookToken: triggerType === "webhook" ? (current.triggerType === "webhook" ? current.webhookToken : randomUUID().replaceAll("-", "")) : null,
      updatedAt: now.toISOString(),
    });
    await this.repository.put("schedules", schedule);
    await this.emit(this.newEvent("schedule", schedule.id, "schedule.updated", { schedule }, actorType, actorId));
    return schedule;
  }

  async deleteSchedule(id: string, actorType: "user" | "agent" = "user", actorId = this.config.ownerId): Promise<void> {
    const schedule = await this.getSchedule(id);
    if (actorType === "agent" && schedule.agentId !== actorId) {
      throw new DomainError(403, "schedule_owner_forbidden", "Agents can only delete their own schedules");
    }
    await this.repository.delete("schedules", id);
    await this.emit(this.newEvent("schedule", id, "schedule.deleted", { scheduleId: id }, actorType, actorId));
  }

  async triggerSchedule(
    schedule: Schedule,
    triggeredAt: string,
    source: "cron" | "webhook" = "cron",
    payload?: unknown,
    operationId = `schedule:${schedule.id}:${triggeredAt}`,
  ): Promise<{ message: Message; runId: string }> {
    const now = new Date().toISOString();
    const payloadText = source === "webhook" && payload !== undefined ? `\n\nWebhook payload:\n${JSON.stringify(payload)}` : "";
    const message = MessageSchema.parse({
      id: this.id("msg"),
      workspaceId: this.config.workspaceId,
      conversationId: schedule.conversationId,
      role: "system",
      authorId: null,
      content: `${source === "webhook" ? "Webhook-triggered" : "Scheduled"} task: ${schedule.prompt}${payloadText}`,
      replyToMessageId: null,
      clientOperationId: operationId,
      createdAt: now,
    });
    const run = RunSchema.parse({
      id: this.id("run"),
      workspaceId: this.config.workspaceId,
      agentId: schedule.agentId,
      conversationId: schedule.conversationId,
      taskId: null,
      triggerMessageId: message.id,
      status: "queued",
      codexTurnId: null,
      error: null,
      startedAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    const job: QueueJob = {
      id: this.id("job"), workspaceId: this.config.workspaceId, kind: "agent.run",
      payload: { runId: run.id }, status: "queued", attempts: 0, availableAt: now,
      lockedAt: null, lockedBy: null, error: null, createdAt: now, updatedAt: now,
    };
    const result = await this.repository.commitMessageRun({
      message, run, job, idempotencyKey: operationId,
      events: [
        this.newEvent("message", message.id, "message.created", { message }, "system", null),
        this.newEvent("run", run.id, "run.created", { run }, "system", null),
      ],
    });
    for (const event of result.events) this.events.publish(event);
    const nextSchedule = ScheduleSchema.parse({
      ...schedule,
      lastRunAt: triggeredAt,
      latestRunId: result.runId,
      nextRunAt: schedule.enabled && schedule.triggerType === "cron" ? nextCronOccurrence(schedule.cronExpression, schedule.timezone, new Date()) : null,
      updatedAt: now,
    });
    await this.repository.put("schedules", nextSchedule);
    await this.emit(this.newEvent("schedule", schedule.id, "schedule.triggered", { schedule: nextSchedule, runId: result.runId, source }, "system", null));
    const conversation = await this.repository.get("conversations", schedule.conversationId);
    if (conversation) await this.repository.put("conversations", { ...conversation, lastMessageAt: now, updatedAt: now });
    return { message: result.message, runId: result.runId };
  }

  async triggerWebhook(id: string, token: string, payload: unknown): Promise<{ runId: string }> {
    const schedule = await this.getSchedule(id);
    if (schedule.triggerType !== "webhook" || !schedule.webhookToken) throw notFound("Webhook", id);
    const expected = Buffer.from(schedule.webhookToken);
    const received = Buffer.from(token);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw notFound("Webhook", id);
    if (!schedule.enabled) throw conflict("webhook_disabled", "This webhook job is paused");
    const triggeredAt = new Date().toISOString();
    const result = await this.triggerSchedule(schedule, triggeredAt, "webhook", payload, `webhook:${schedule.id}:${randomUUID()}`);
    return { runId: result.runId };
  }

  listTasks(): Promise<Task[]> {
    return this.repository.list("tasks", this.config.workspaceId);
  }

  async getTask(id: string): Promise<Task> {
    return (await this.repository.get("tasks", id)) ?? Promise.reject(notFound("Task", id));
  }

  private async validateParent(taskId: string | null, parentId: string | null, budget?: Task["budget"]): Promise<number> {
    if (!parentId) return 0;
    if (parentId === taskId) throw conflict("task_cycle", "A task cannot be its own parent");
    const parent = await this.getTask(parentId);
    const siblings = (await this.listTasks()).filter((task) => task.parentTaskId === parentId && task.id !== taskId);
    if (siblings.length >= parent.budget.maxChildTasks) {
      throw conflict("task_fanout_limit", `Parent task allows at most ${parent.budget.maxChildTasks} child tasks`, {
        parentTaskId: parentId,
        limit: parent.budget.maxChildTasks,
      });
    }
    const visited = new Set<string>();
    let cursor: Task | null = parent;
    while (cursor) {
      if (cursor.id === taskId) throw conflict("task_cycle", "Parent change would create a task cycle");
      if (visited.has(cursor.id)) throw conflict("task_cycle", "Existing task hierarchy contains a cycle");
      visited.add(cursor.id);
      cursor = cursor.parentTaskId ? await this.getTask(cursor.parentTaskId) : null;
    }
    const depth = parent.depth + 1;
    if (depth > this.config.maxDelegationDepth) {
      throw conflict("task_depth_limit", `Task delegation depth cannot exceed ${this.config.maxDelegationDepth}`);
    }
    if (budget && depth > 0 && budget.maxChildTasks > 8) throw new DomainError(400, "invalid_budget", "Invalid task budget");
    return depth;
  }

  async createTask(input: CreateTaskInput, actorType: "user" | "agent" = "user", actorId = this.config.ownerId): Promise<Task> {
    if (actorType === "agent") await this.getAgent(actorId);
    if (input.ownerAgentId) await this.getAgent(input.ownerAgentId);
    if (input.conversationId) await this.getConversation(input.conversationId);
    const budget = TaskBudgetSchema.parse(input.budget ?? {});
    const depth = await this.validateParent(null, input.parentTaskId ?? null, budget);
    const now = new Date().toISOString();
    const task = TaskSchema.parse({
      id: this.id("tsk"),
      workspaceId: this.config.workspaceId,
      parentTaskId: input.parentTaskId ?? null,
      conversationId: input.conversationId ?? null,
      title: input.title,
      objective: input.objective,
      acceptanceCriteria: input.acceptanceCriteria ?? [],
      ownerAgentId: input.ownerAgentId ?? null,
      createdByType: actorType,
      createdById: actorId,
      status: input.ownerAgentId ? "accepted" : "draft",
      priority: input.priority ?? "normal",
      depth,
      budget,
      blocker: null,
      resultSummary: null,
      createdAt: now,
      updatedAt: now,
    });
    await this.repository.put("tasks", task);
    await this.emit(this.newEvent("task", task.id, "task.created", { task }, actorType, actorId));
    return task;
  }

  async updateTask(
    id: string,
    patch: TaskPatch,
    actorType: "user" | "agent" = "user",
    actorId = this.config.ownerId,
  ): Promise<Task> {
    if (actorType === "agent") await this.getAgent(actorId);
    const current = await this.getTask(id);
    if (patch.ownerAgentId) await this.getAgent(patch.ownerAgentId);
    if (patch.conversationId) await this.getConversation(patch.conversationId);
    const parentTaskId = patch.parentTaskId === undefined ? current.parentTaskId : patch.parentTaskId;
    const depth = parentTaskId === current.parentTaskId ? current.depth : await this.validateParent(id, parentTaskId ?? null);
    const budget = TaskBudgetSchema.parse({ ...current.budget, ...(patch.budget ?? {}) });
    const task = TaskSchema.parse({
      ...current,
      ...patch,
      budget,
      parentTaskId,
      depth,
      id: current.id,
      workspaceId: current.workspaceId,
      updatedAt: new Date().toISOString(),
    });
    await this.repository.put("tasks", task);
    const type = task.status === "completed" ? "task.completed" : task.status === "blocked" ? "task.blocked" : "task.updated";
    await this.emit(this.newEvent("task", task.id, type, { task }, actorType, actorId));
    return task;
  }

  async delegateTask(id: string, input: DelegateTaskInput, actorType: "user" | "agent" = "user", actorId = this.config.ownerId): Promise<Task> {
    if (actorType === "agent") await this.getAgent(actorId);
    const task = await this.getTask(id);
    const agent = await this.getAgent(input.agentId);
    if (terminalTaskStatuses.has(task.status)) throw conflict("task_terminal", "A terminal task cannot be delegated");
    await this.validateParent(task.id, task.parentTaskId);
    const delegated = TaskSchema.parse({ ...task, ownerAgentId: agent.id, status: "accepted", updatedAt: new Date().toISOString() });
    await this.repository.put("tasks", delegated);
    await this.emit(
      this.newEvent(
        "task",
        task.id,
        "task.delegated",
        { task: delegated, fromAgentId: task.ownerAgentId, toAgentId: agent.id, message: input.message, contextRefs: input.contextRefs },
        actorType,
        actorId,
      ),
    );
    return delegated;
  }

  async sendCollaborationMessage(
    senderAgentId: string,
    targetAgentId: string,
    taskId: string,
    content: string,
    contextRefs: string[],
  ): Promise<Message> {
    const [sender, target, task] = await Promise.all([
      this.getAgent(senderAgentId),
      this.getAgent(targetAgentId),
      this.getTask(taskId),
    ]);
    let conversation = task.conversationId ? await this.getConversation(task.conversationId) : null;
    if (!conversation) {
      conversation = await this.createConversation(
        {
          kind: "task",
          title: task.title,
          memberAgentIds: [...new Set([sender.id, target.id])],
          taskId: task.id,
        },
        "agent",
        sender.id,
      );
      await this.updateTask(task.id, { conversationId: conversation.id }, "agent", sender.id);
    } else {
      const memberAgentIds = [...new Set([...conversation.memberAgentIds, sender.id, target.id])];
      if (memberAgentIds.length > 6) throw conflict("conversation_member_limit", "Task conversation cannot have more than 6 agents");
      if (memberAgentIds.length !== conversation.memberAgentIds.length) {
        conversation = await this.updateConversation(conversation.id, { memberAgentIds }, "agent", sender.id);
      }
    }
    const now = new Date().toISOString();
    const message = MessageSchema.parse({
      id: this.id("msg"),
      workspaceId: this.config.workspaceId,
      conversationId: conversation.id,
      role: "agent",
      authorId: sender.id,
      content,
      replyToMessageId: null,
      clientOperationId: null,
      createdAt: now,
    });
    await this.repository.put("messages", message);
    await this.repository.put("conversations", { ...conversation, lastMessageAt: now, updatedAt: now });
    await this.emit(
      this.newEvent(
        "message",
        message.id,
        "message.created",
        { message, taskId: task.id, targetAgentId: target.id, contextRefs },
        "agent",
        sender.id,
      ),
    );
    return message;
  }

  async requestAgentHelp(
    senderAgentId: string,
    targetAgentId: string,
    parentTaskId: string,
    request: string,
    paths: string[],
  ): Promise<{ task: Task; requestMessage: Message; runId: string }> {
    const [sender, target, parent] = await Promise.all([
      this.getAgent(senderAgentId),
      this.getAgent(targetAgentId),
      this.getTask(parentTaskId),
    ]);
    if (sender.id === target.id) throw new DomainError(400, "same_agent_request", "An agent cannot request help from itself");

    let task = await this.createTask(
      {
        title: `Help ${sender.name}: ${request}`.slice(0, 180),
        objective: request,
        acceptanceCriteria: [
          "Return a concise answer to the requesting agent",
          "Include exact /workspace paths for every shared file",
          "Preserve existing files unless the request explicitly asks for changes",
        ],
        parentTaskId: parent.id,
        ownerAgentId: target.id,
        priority: parent.priority,
        budget: {
          maxTokens: Math.max(1, Math.floor(parent.budget.maxTokens / 2)),
          maxWallSeconds: parent.budget.maxWallSeconds,
          maxChildTasks: Math.max(0, parent.budget.maxChildTasks - 1),
        },
      },
      "agent",
      sender.id,
    );
    const conversation = await this.createConversation(
      {
        kind: "task",
        title: task.title,
        memberAgentIds: [sender.id, target.id],
        taskId: task.id,
      },
      "agent",
      sender.id,
    );
    task = await this.updateTask(task.id, { conversationId: conversation.id }, "agent", sender.id);

    const now = new Date().toISOString();
    const pathContext = paths.length > 0
      ? `\n\nRelevant shared paths:\n${paths.map((filePath) => `- ${filePath}`).join("\n")}`
      : "";
    const requestMessage = MessageSchema.parse({
      id: this.id("msg"),
      workspaceId: this.config.workspaceId,
      conversationId: conversation.id,
      role: "agent",
      authorId: sender.id,
      content: `Teammate request from ${sender.name} (${sender.id}):\n\n${request}${pathContext}\n\nThe team shares /workspace. Inspect the relevant project and agent directories, then respond with your findings and exact paths to any files the requester should use.`,
      replyToMessageId: null,
      clientOperationId: null,
      createdAt: now,
    });
    const run = RunSchema.parse({
      id: this.id("run"),
      workspaceId: this.config.workspaceId,
      agentId: target.id,
      conversationId: conversation.id,
      taskId: task.id,
      triggerMessageId: requestMessage.id,
      status: "queued",
      codexTurnId: null,
      error: null,
      startedAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    const job: QueueJob = {
      id: this.id("job"),
      workspaceId: this.config.workspaceId,
      kind: "agent.run",
      payload: { runId: run.id },
      status: "queued",
      attempts: 0,
      availableAt: now,
      lockedAt: null,
      lockedBy: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    const committed = await this.repository.commitMessageRun({
      message: requestMessage,
      run,
      job,
      idempotencyKey: `agent-help:${requestMessage.id}`,
      events: [
        this.newEvent("message", requestMessage.id, "message.created", { message: requestMessage, taskId: task.id, targetAgentId: target.id, paths }, "agent", sender.id),
        this.newEvent("run", run.id, "run.created", { run, requestedByAgentId: sender.id }, "agent", sender.id),
      ],
    });
    for (const event of committed.events) this.events.publish(event);
    await this.repository.put("conversations", { ...conversation, lastMessageAt: now, updatedAt: now });
    return { task, requestMessage, runId: committed.runId };
  }

  async readAgentHelp(
    actorAgentId: string,
    taskId: string,
  ): Promise<{ task: Task; runs: Run[]; messages: Message[] }> {
    await this.getAgent(actorAgentId);
    const task = await this.getTask(taskId);
    if (!task.conversationId) {
      throw new DomainError(400, "help_conversation_missing", "This task is not linked to an agent help conversation");
    }
    const conversation = await this.getConversation(task.conversationId);
    if (!conversation.memberAgentIds.includes(actorAgentId)) {
      throw new DomainError(403, "help_request_forbidden", "Agent is not a member of this help request");
    }
    const [runs, messages] = await Promise.all([
      this.listRuns().then((items) => items.filter((run) => run.taskId === task.id)),
      this.listMessages(conversation.id),
    ]);
    return { task, runs, messages };
  }

  async blockTask(id: string, blocker: string, needsUser: boolean, actorAgentId: string): Promise<Task> {
    await this.getAgent(actorAgentId);
    return this.updateTask(
      id,
      { status: needsUser ? "waiting_user" : "blocked", blocker },
      "agent",
      actorAgentId,
    );
  }

  async completeTask(
    id: string,
    summary: string,
    artifactIds: string[],
    evidenceRefs: string[],
    actorAgentId: string,
  ): Promise<Task> {
    await this.getAgent(actorAgentId);
    const current = await this.getTask(id);
    if (terminalTaskStatuses.has(current.status) && current.status !== "completed") {
      throw conflict("task_terminal", "A failed or cancelled task cannot be completed");
    }
    const task = TaskSchema.parse({
      ...current,
      status: "completed",
      blocker: null,
      resultSummary: summary,
      updatedAt: new Date().toISOString(),
    });
    await this.repository.put("tasks", task);
    await this.emit(
      this.newEvent(
        "task",
        task.id,
        "task.completed",
        { task, summary, artifactIds, evidenceRefs },
        "agent",
        actorAgentId,
      ),
    );
    return task;
  }

  async createDelegatedChild(parent: Task, delegator: Agent, role: "research" | "operations", title: string, objective: string): Promise<Task | null> {
    const agents = await this.listAgents();
    const recipient = agents.find(
      (agent) => agent.id !== delegator.id && (agent.capabilities.includes(role) || agent.role.toLowerCase().includes(role)),
    );
    if (!recipient) return null;
    const child = await this.createTask(
      {
        title,
        objective,
        acceptanceCriteria: ["Return a concise result with evidence"],
        ownerAgentId: recipient.id,
        parentTaskId: parent.id,
        conversationId: parent.conversationId,
        priority: parent.priority,
        budget: { ...parent.budget, maxTokens: Math.max(1, Math.floor(parent.budget.maxTokens / 2)) },
      },
      "agent",
      delegator.id,
    );
    await this.emit(
      this.newEvent(
        "task",
        child.id,
        "task.delegated",
        { task: child, fromAgentId: delegator.id, toAgentId: recipient.id, message: "Mock runtime collaboration demonstration", contextRefs: [parent.id] },
        "agent",
        delegator.id,
      ),
    );
    return child;
  }

  listRuns(): Promise<Run[]> {
    return this.repository.list("runs", this.config.workspaceId);
  }

  async getRun(id: string): Promise<Run> {
    return (await this.repository.get("runs", id)) ?? Promise.reject(notFound("Run", id));
  }

  async interruptRun(id: string): Promise<Run> {
    const current = await this.getRun(id);
    if (!activeRunStatuses.has(current.status)) return current;
    this.interruptHandler?.(id);
    const now = new Date().toISOString();
    const run = RunSchema.parse({ ...current, status: "interrupted", completedAt: now, updatedAt: now });
    await this.repository.put("runs", run);
    await this.emit(this.newEvent("run", run.id, "run.interrupted", { run }));
    const agent = await this.getAgent(run.agentId);
    if (agent.currentTaskId === run.taskId || agent.status !== "idle") await this.updateAgent(agent.id, { status: "idle" });
    return run;
  }

  listApprovals(): Promise<Approval[]> {
    return this.repository.list("approvals", this.config.workspaceId);
  }

  async getApproval(id: string): Promise<Approval> {
    return (await this.repository.get("approvals", id)) ?? Promise.reject(notFound("Approval", id));
  }

  async resolveApproval(id: string, decision: "approve" | "deny"): Promise<Approval> {
    const current = await this.getApproval(id);
    if (current.status !== "pending") throw conflict("approval_resolved", "Approval has already been resolved");
    if (new Date(current.expiresAt).getTime() <= Date.now()) {
      throw conflict("approval_expired", "Approval has expired");
    }
    const approval = ApprovalSchema.parse({
      ...current,
      status: decision === "approve" ? "approved" : "denied",
      decidedAt: new Date().toISOString(),
    });
    await this.repository.put("approvals", approval);
    await this.emit(this.newEvent("approval", approval.id, "approval.resolved", { approval, decision }));
    return approval;
  }
}
