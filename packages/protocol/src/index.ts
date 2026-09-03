import { z } from "zod";

export const IdSchema = z.string().min(1).max(160);
export const TimestampSchema = z.string().datetime();

export const AgentStatusSchema = z.enum([
  "idle",
  "queued",
  "planning",
  "working",
  "waiting_agent",
  "waiting_user",
  "blocked",
  "paused",
  "failed",
  "completed",
]);

export const TaskStatusSchema = z.enum([
  "draft",
  "queued",
  "accepted",
  "running",
  "waiting_agent",
  "waiting_user",
  "blocked",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);

export const RunStatusSchema = z.enum([
  "queued",
  "starting",
  "running",
  "waiting_approval",
  "waiting_user",
  "completed",
  "interrupted",
  "failed",
]);

export const MessageRoleSchema = z.enum(["user", "agent", "system"]);
export const ConversationKindSchema = z.enum(["direct", "group", "task"]);
export const RiskSchema = z.enum([
  "external_communication",
  "publish",
  "purchase",
  "delete",
  "overwrite",
  "permission",
  "production",
  "authentication",
  "sensitive_data",
  "custom",
]);

export const AgentSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  name: z.string().trim().min(1).max(80),
  role: z.string().trim().min(1).max(120),
  description: z.string().max(1200).default(""),
  instructions: z.string().max(20_000).default(""),
  avatar: z.string().max(12).default("AI"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#D7FF64"),
  capabilities: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  status: AgentStatusSchema,
  currentTaskId: IdSchema.nullable(),
  codexThreadId: z.string().nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export const ConversationSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  kind: ConversationKindSchema,
  title: z.string().trim().min(1).max(160),
  memberAgentIds: z.array(IdSchema).max(6),
  taskId: IdSchema.nullable(),
  lastMessageAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export const MessageAttachmentSchema = z.object({
  artifactId: IdSchema,
  name: z.string().trim().min(1).max(240),
  mimeType: z.string().min(1).max(160),
  size: z.number().int().nonnegative(),
  path: z.string().min(1).max(2_000),
});

export const MessageSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  conversationId: IdSchema,
  role: MessageRoleSchema,
  authorId: IdSchema.nullable(),
  content: z.string().max(200_000),
  attachments: z.array(MessageAttachmentSchema).max(10).optional(),
  replyToMessageId: IdSchema.nullable(),
  clientOperationId: z.string().max(160).nullable(),
  createdAt: TimestampSchema,
});

export const TaskBudgetSchema = z.object({
  maxTokens: z.number().int().positive().max(10_000_000).default(100_000),
  maxWallSeconds: z.number().int().positive().max(86_400).default(3600),
  maxChildTasks: z.number().int().min(0).max(8).default(4),
});

export const TaskSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  parentTaskId: IdSchema.nullable(),
  conversationId: IdSchema.nullable(),
  title: z.string().trim().min(1).max(180),
  objective: z.string().trim().min(1).max(20_000),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(1000)).max(30).default([]),
  ownerAgentId: IdSchema.nullable(),
  createdByType: z.enum(["user", "agent"]),
  createdById: IdSchema,
  status: TaskStatusSchema,
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  depth: z.number().int().min(0).max(6),
  budget: TaskBudgetSchema,
  blocker: z.string().max(4000).nullable(),
  resultSummary: z.string().max(20_000).nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export const RunSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  agentId: IdSchema,
  conversationId: IdSchema,
  taskId: IdSchema.nullable(),
  triggerMessageId: IdSchema.nullable(),
  status: RunStatusSchema,
  codexTurnId: z.string().nullable(),
  error: z.string().max(8000).nullable(),
  startedAt: TimestampSchema.nullable(),
  completedAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export const ApprovalSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  runId: IdSchema,
  taskId: IdSchema.nullable(),
  agentId: IdSchema,
  tool: z.string().min(1).max(160),
  risk: RiskSchema,
  title: z.string().min(1).max(240),
  description: z.string().max(4000),
  normalizedArguments: z.record(z.string(), z.unknown()),
  signature: z.string().min(16),
  status: z.enum(["pending", "approved", "denied", "expired"]),
  expiresAt: TimestampSchema,
  decidedAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
});

export const ArtifactSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  taskId: IdSchema.nullable(),
  runId: IdSchema.nullable(),
  agentId: IdSchema.nullable(),
  name: z.string().min(1).max(240),
  mimeType: z.string().min(1).max(160),
  size: z.number().int().nonnegative(),
  checksum: z.string().min(16),
  storageKey: z.string().min(1).max(1000),
  createdAt: TimestampSchema,
});

export const ConnectorProviderSchema = z.enum(["github", "resend", "notion", "stripe", "firebase"]);
export const ConnectorAuthTypeSchema = z.enum(["bearer", "header", "basic"]);
export const MobilePairingPayloadSchema = z.object({
  type: z.literal("noudleAgents.mobile-pair"),
  version: z.literal(1),
  baseUrl: z.string().url().refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }, "Pairing URL must use HTTP or HTTPS"),
  token: z.string().min(1).max(10_000),
}).strict();
export const ConnectorSummarySchema = z.object({
  id: IdSchema,
  provider: z.string().min(1).max(80),
  kind: z.enum(["builtin", "custom"]),
  name: z.string().min(1).max(100),
  baseUrl: z.string().url().nullable(),
  authType: ConnectorAuthTypeSchema,
  headerName: z.string().min(1).max(100).nullable(),
  connected: z.boolean(),
  accountLabel: z.string().nullable(),
  createdByType: z.enum(["user", "agent"]).nullable(),
  createdById: IdSchema.nullable(),
  connectedAt: TimestampSchema.nullable(),
  updatedAt: TimestampSchema.nullable(),
});

export const CreateCustomConnectorInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  baseUrl: z.string().trim().url().max(2000),
  authType: ConnectorAuthTypeSchema.default("bearer"),
  headerName: z.string().trim().min(1).max(100).nullable().default(null),
  authPrefix: z.string().max(100).default(""),
  secret: z.string().trim().min(1).max(10_000),
}).strict();

export const ConnectorRequestInputSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
  path: z.string().min(1).max(4000),
  headers: z.record(z.string().min(1).max(100), z.string().max(4000)).default({}),
  body: z.string().max(2_000_000).nullable().default(null),
}).strict();

export const ConnectorResponseSchema = z.object({
  status: z.number().int().min(100).max(599),
  ok: z.boolean(),
  headers: z.record(z.string(), z.string()),
  body: z.string(),
});

export const ScheduleSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  triggerType: z.enum(["cron", "webhook"]),
  agentId: IdSchema,
  conversationId: IdSchema,
  title: z.string().trim().min(1).max(160),
  prompt: z.string().trim().min(1).max(200_000),
  cronExpression: z.string().trim().min(9).max(120),
  timezone: z.string().trim().min(1).max(120),
  enabled: z.boolean(),
  nextRunAt: TimestampSchema.nullable(),
  lastRunAt: TimestampSchema.nullable(),
  latestRunId: IdSchema.nullable(),
  webhookToken: z.string().min(32).max(200).nullable().default(null),
  createdByType: z.enum(["user", "agent"]),
  createdById: IdSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export const EventTypeSchema = z.enum([
  "agent.created",
  "agent.updated",
  "agent.deleted",
  "agent.status_changed",
  "conversation.created",
  "conversation.updated",
  "conversation.deleted",
  "message.created",
  "message.delta",
  "run.created",
  "run.started",
  "run.completed",
  "run.failed",
  "run.interrupted",
  "task.created",
  "task.updated",
  "task.delegated",
  "task.completed",
  "task.blocked",
  "approval.requested",
  "approval.resolved",
  "artifact.created",
  "artifact.updated",
  "tool.started",
  "tool.output",
  "tool.completed",
  "computer.updated",
  "connector.updated",
  "schedule.created",
  "schedule.updated",
  "schedule.deleted",
  "schedule.triggered",
]);

export const RelayEventSchema = z.object({
  id: IdSchema,
  cursor: z.number().int().positive(),
  workspaceId: IdSchema,
  aggregateType: z.string().min(1).max(80),
  aggregateId: IdSchema,
  sequence: z.number().int().positive(),
  type: EventTypeSchema,
  actorType: z.enum(["user", "agent", "system"]),
  actorId: IdSchema.nullable(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: TimestampSchema,
});

export const CreateAgentInputSchema = AgentSchema.pick({
  name: true,
  role: true,
  description: true,
  instructions: true,
  avatar: true,
  color: true,
  capabilities: true,
}).partial({ description: true, instructions: true, avatar: true, color: true, capabilities: true });

export const CreateConversationInputSchema = z.object({
  kind: ConversationKindSchema,
  title: z.string().trim().min(1).max(160),
  memberAgentIds: z.array(IdSchema).min(1).max(6),
  taskId: IdSchema.nullable().optional(),
});

export const ComposerSettingsSchema = z.object({
  model: z.enum(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]).default("gpt-5.6-sol"),
  reasoning: z.enum(["low", "medium", "high", "xhigh"]).default("medium"),
  speed: z.enum(["balanced", "extra-fast"]).default("balanced"),
});

export const SendMessageInputSchema = z.object({
  content: z.string().trim().max(200_000),
  attachmentIds: z.array(IdSchema).max(10).default([]),
  agentId: IdSchema,
  taskId: IdSchema.nullable().optional(),
  replyToMessageId: IdSchema.nullable().optional(),
  clientOperationId: z.string().min(1).max(160),
  settings: ComposerSettingsSchema.optional(),
}).refine((input) => input.content.length > 0 || input.attachmentIds.length > 0, {
  message: "A message needs text or at least one attachment",
  path: ["content"],
});

export const CreateTaskInputSchema = TaskSchema.pick({
  title: true,
  objective: true,
  acceptanceCriteria: true,
  ownerAgentId: true,
  parentTaskId: true,
  conversationId: true,
  priority: true,
  budget: true,
}).partial({ acceptanceCriteria: true, ownerAgentId: true, parentTaskId: true, conversationId: true, priority: true, budget: true });

export const DelegateTaskInputSchema = z.object({
  agentId: IdSchema,
  message: z.string().max(4000).default(""),
  contextRefs: z.array(IdSchema).max(50).default([]),
});

export const CreateScheduleInputSchema = ScheduleSchema.pick({
  triggerType: true,
  agentId: true,
  conversationId: true,
  title: true,
  prompt: true,
  cronExpression: true,
  timezone: true,
  enabled: true,
}).partial({ triggerType: true, conversationId: true, cronExpression: true, timezone: true, enabled: true }).superRefine((value, context) => {
  if ((value.triggerType ?? "cron") === "cron" && !value.cronExpression) {
    context.addIssue({ code: "custom", path: ["cronExpression"], message: "Cron schedules require a cronExpression" });
  }
});

export const UpdateScheduleInputSchema = ScheduleSchema.pick({
  triggerType: true,
  agentId: true,
  conversationId: true,
  title: true,
  prompt: true,
  cronExpression: true,
  timezone: true,
  enabled: true,
}).partial().refine((value) => Object.keys(value).length > 0, "At least one schedule field is required");

export type Agent = z.infer<typeof AgentSchema>;
export type AgentStatus = z.infer<typeof AgentStatusSchema>;
export type Conversation = z.infer<typeof ConversationSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type MessageAttachment = z.infer<typeof MessageAttachmentSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type Run = z.infer<typeof RunSchema>;
export type Approval = z.infer<typeof ApprovalSchema>;
export type Artifact = z.infer<typeof ArtifactSchema>;
export type ConnectorProvider = z.infer<typeof ConnectorProviderSchema>;
export type ConnectorAuthType = z.infer<typeof ConnectorAuthTypeSchema>;
export type MobilePairingPayload = z.infer<typeof MobilePairingPayloadSchema>;
export type ConnectorSummary = z.infer<typeof ConnectorSummarySchema>;
export type CreateCustomConnectorInput = z.infer<typeof CreateCustomConnectorInputSchema>;
export type ConnectorRequestInput = z.infer<typeof ConnectorRequestInputSchema>;
export type ConnectorResponse = z.infer<typeof ConnectorResponseSchema>;

export function encodeMobilePairingPayload(payload: MobilePairingPayload): string {
  return JSON.stringify(MobilePairingPayloadSchema.parse(payload));
}

export function decodeMobilePairingPayload(value: string): MobilePairingPayload {
  return MobilePairingPayloadSchema.parse(JSON.parse(value) as unknown);
}
export type Schedule = z.infer<typeof ScheduleSchema>;
export type RelayEvent = z.infer<typeof RelayEventSchema>;
export type CreateAgentInput = z.infer<typeof CreateAgentInputSchema>;
export type CreateConversationInput = z.infer<typeof CreateConversationInputSchema>;
export type SendMessageInput = z.infer<typeof SendMessageInputSchema>;
export type ComposerSettings = z.infer<typeof ComposerSettingsSchema>;
export type CreateTaskInput = z.infer<typeof CreateTaskInputSchema>;
export type DelegateTaskInput = z.infer<typeof DelegateTaskInputSchema>;
export type CreateScheduleInput = z.infer<typeof CreateScheduleInputSchema>;
export type UpdateScheduleInput = z.infer<typeof UpdateScheduleInputSchema>;

export const DEFAULT_WORKSPACE_ID = "workspace_local";
export const LOCAL_OWNER_ID = "user_local_owner";
