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

export const MessageSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  conversationId: IdSchema,
  role: MessageRoleSchema,
  authorId: IdSchema.nullable(),
  content: z.string().max(200_000),
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

export const ConnectorProviderSchema = z.enum(["github", "resend", "notion", "stripe"]);
export const ConnectorSummarySchema = z.object({
  provider: ConnectorProviderSchema,
  connected: z.boolean(),
  accountLabel: z.string().nullable(),
  connectedAt: TimestampSchema.nullable(),
  updatedAt: TimestampSchema.nullable(),
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
  content: z.string().trim().min(1).max(200_000),
  agentId: IdSchema,
  taskId: IdSchema.nullable().optional(),
  replyToMessageId: IdSchema.nullable().optional(),
  clientOperationId: z.string().min(1).max(160),
  settings: ComposerSettingsSchema.optional(),
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

export type Agent = z.infer<typeof AgentSchema>;
export type AgentStatus = z.infer<typeof AgentStatusSchema>;
export type Conversation = z.infer<typeof ConversationSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type Run = z.infer<typeof RunSchema>;
export type Approval = z.infer<typeof ApprovalSchema>;
export type Artifact = z.infer<typeof ArtifactSchema>;
export type ConnectorProvider = z.infer<typeof ConnectorProviderSchema>;
export type ConnectorSummary = z.infer<typeof ConnectorSummarySchema>;
export type RelayEvent = z.infer<typeof RelayEventSchema>;
export type CreateAgentInput = z.infer<typeof CreateAgentInputSchema>;
export type CreateConversationInput = z.infer<typeof CreateConversationInputSchema>;
export type SendMessageInput = z.infer<typeof SendMessageInputSchema>;
export type ComposerSettings = z.infer<typeof ComposerSettingsSchema>;
export type CreateTaskInput = z.infer<typeof CreateTaskInputSchema>;
export type DelegateTaskInput = z.infer<typeof DelegateTaskInputSchema>;

export const DEFAULT_WORKSPACE_ID = "workspace_local";
export const LOCAL_OWNER_ID = "user_local_owner";
