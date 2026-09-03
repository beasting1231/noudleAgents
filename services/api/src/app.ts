import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify, { LogController, type FastifyInstance, type FastifyRequest } from "fastify";
import {
  AgentStatusSchema,
  CreateAgentInputSchema,
  CreateConversationInputSchema,
  CreateScheduleInputSchema,
  CreateTaskInputSchema,
  DelegateTaskInputSchema,
  SendMessageInputSchema,
  TaskStatusSchema,
  UpdateScheduleInputSchema,
} from "@noudle-agents/protocol";
import { z, ZodError } from "zod";
import { loadConfig, type RelayConfig } from "./config.js";
import { ArtifactService } from "./artifacts/artifact-service.js";
import { registerArtifactRoutes } from "./artifacts/routes.js";
import { ComputerService } from "./computers/computer-service.js";
import { HttpSandboxManagerClient, type SandboxManagerGateway } from "./computers/sandbox-manager-client.js";
import { registerComputerRoutes } from "./computers/routes.js";
import { ConnectorService, type ConnectorFetch } from "./connectors/connector-service.js";
import { registerConnectorRoutes } from "./connectors/routes.js";
import { openRepository } from "./database/open-repository.js";
import type { RelayRepository } from "./database/repository.js";
import { DomainError } from "./domain/errors.js";
import { RelayService } from "./domain/relay-service.js";
import { EventHub } from "./events.js";
import { MockAgentRuntime } from "./runtime/mock-runtime.js";
import { CodexAgentRuntime } from "./runtime/codex-runtime.js";
import type { AgentRuntime } from "./runtime/runtime.js";
import { RunWorker } from "./worker.js";
import { PushNotificationService, type PushFetch } from "./push-notifications.js";

const IdParamsSchema = z.object({ id: z.string().min(1).max(160) });
const ConversationParamsSchema = z.object({ conversationId: z.string().min(1).max(160) });
const WebhookParamsSchema = z.object({ id: z.string().min(1).max(160), token: z.string().min(32).max(200) });
const AgentPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    role: z.string().trim().min(1).max(120).optional(),
    description: z.string().max(1200).optional(),
    instructions: z.string().max(20_000).optional(),
    avatar: z.string().max(12).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    capabilities: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
    status: AgentStatusSchema.optional(),
  })
  .strict();
const ConversationPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    memberAgentIds: z.array(z.string().min(1).max(160)).min(1).max(6).optional(),
  })
  .strict();
const TaskPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(180).optional(),
    objective: z.string().trim().min(1).max(20_000).optional(),
    acceptanceCriteria: z.array(z.string().trim().min(1).max(1000)).max(30).optional(),
    ownerAgentId: z.string().min(1).max(160).nullable().optional(),
    parentTaskId: z.string().min(1).max(160).nullable().optional(),
    conversationId: z.string().min(1).max(160).nullable().optional(),
    status: TaskStatusSchema.optional(),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
    budget: z
      .object({
        maxTokens: z.number().int().positive().max(10_000_000).optional(),
        maxWallSeconds: z.number().int().positive().max(86_400).optional(),
        maxChildTasks: z.number().int().min(0).max(8).optional(),
      })
      .optional(),
    blocker: z.string().max(4000).nullable().optional(),
    resultSummary: z.string().max(20_000).nullable().optional(),
  })
  .strict();
const CollaborationMessageSchema = z
  .object({
    agentId: z.string().min(1).max(160),
    taskId: z.string().min(1).max(160),
    message: z.string().trim().min(1).max(200_000),
    contextRefs: z.array(z.string().min(1).max(160)).max(50).default([]),
  })
  .strict();
const AgentHelpRequestSchema = z
  .object({
    agentId: z.string().min(1).max(160),
    taskId: z.string().min(1).max(160),
    request: z.string().trim().min(1).max(20_000),
    paths: z.array(z.string().trim().min(1).max(1000).refine((value) => !value.includes("\u0000"))).max(50).default([]),
  })
  .strict();
const BlockTaskSchema = z.object({ blocker: z.string().trim().min(1).max(4000), needsUser: z.boolean().default(false) }).strict();
const CompleteTaskSchema = z
  .object({
    summary: z.string().trim().min(1).max(20_000),
    artifactIds: z.array(z.string().min(1).max(160)).max(100).default([]),
    evidenceRefs: z.array(z.string().min(1).max(1000)).max(100).default([]),
  })
  .strict();
const UserProfilePatchSchema = z
  .object({
    values: z.record(z.string().min(1).max(120), z.string().min(1).max(2000)).default({}),
    remove: z.array(z.string().min(1).max(120)).max(100).default([]),
  })
  .strict();
const PushSubscriptionSchema = z.object({
  token: z.string().regex(/^(?:Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$/).max(200),
  platform: z.enum(["ios", "android"]),
  deviceId: z.string().min(1).max(200).nullable().optional(),
}).strict();
const DeletePushSubscriptionSchema = z.object({ token: z.string().min(1).max(200) }).strict();

export interface CreateRelayAppOptions {
  config?: RelayConfig;
  repository?: RelayRepository;
  runtime?: AgentRuntime;
  startWorker?: boolean;
  logger?: boolean;
  sandboxManager?: SandboxManagerGateway;
  connectorFetcher?: ConnectorFetch;
  pushFetch?: PushFetch;
}

export interface RelayAppContext {
  app: FastifyInstance;
  config: RelayConfig;
  repository: RelayRepository;
  service: RelayService;
  worker: RunWorker;
  artifacts: ArtifactService;
  computers: ComputerService;
  connectors: ConnectorService;
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1] ?? null;
}

function sameToken(left: string | null, right: string): boolean {
  if (left === null || left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < right.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

function agentActor(request: FastifyRequest): string | null {
  const header = request.headers["x-relay-agent-id"];
  if (Array.isArray(header)) return header[0] ?? null;
  return header ?? null;
}

function requiredAgentActor(request: FastifyRequest): string {
  const agentId = agentActor(request);
  if (!agentId) throw new DomainError(400, "agent_identity_required", "x-relay-agent-id is required for agent collaboration");
  return agentId;
}

function isAllowedOrigin(origin: string | undefined, config: RelayConfig): boolean {
  return !origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) || config.corsOrigins.includes(origin);
}

export async function createRelayApp(options: CreateRelayAppOptions = {}): Promise<RelayAppContext> {
  const config = options.config ?? loadConfig();
  const repository = options.repository ?? (await openRepository(config));
  // EventSource authentication uses a query token because the browser API
  // cannot attach an Authorization header. Disable Fastify's automatic URL
  // logging so that token never lands in request logs.
  const app = Fastify({
    logger: options.logger ?? false,
    logController: new LogController({ disableRequestLogging: true }),
  });
  const events = new EventHub();
  const service = new RelayService(repository, config, events);
  await service.initialize();
  const artifacts = new ArtifactService(repository, service, config);
  await artifacts.initialize();
  const computers = new ComputerService(
    repository,
    service,
    options.sandboxManager ?? new HttpSandboxManagerClient(config),
    config,
  );
  const connectors = new ConnectorService(repository, service, config, options.connectorFetcher);
  const runtime = options.runtime ?? (config.runtimeMode === "codex"
    ? new CodexAgentRuntime(repository, config)
    : new MockAgentRuntime());
  const pushNotifications = new PushNotificationService(repository, options.pushFetch);
  const worker = new RunWorker(repository, service, runtime, config, pushNotifications);

  await app.register(cors, {
    origin(origin, callback) {
      if (isAllowedOrigin(origin, config)) {
        callback(null, true);
      } else {
        callback(new Error("Origin is not allowed"), false);
      }
    },
    allowedHeaders: ["authorization", "content-type", "idempotency-key", "last-event-id", "x-relay-agent-id"],
  });
  await app.register(multipart, {
    limits: { fileSize: config.maxArtifactBytes, files: 1, fields: 12, parts: 13 },
  });

  app.addHook("onRequest", async (request, reply) => {
    if (request.url === "/health" || request.method === "OPTIONS" || (request.method === "POST" && request.url.startsWith("/v1/webhooks/"))) return;
    const query = request.query as { token?: string } | undefined;
    const eventToken = request.url.startsWith("/v1/events") ? (query?.token ?? null) : null;
    const token = bearerToken(request.headers.authorization) ?? eventToken;
    const callerAgentId = agentActor(request);
    const ownerAuthenticated = sameToken(token, config.authToken);
    const agentAuthenticated = sameToken(token, config.agentAuthToken) && Boolean(callerAgentId);
    if (!ownerAuthenticated && !agentAuthenticated) {
      await reply.code(401).send({ error: { code: "unauthorized", message: "A valid noudleAgents bearer token and caller identity are required" } });
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      void reply.code(400).send({ error: { code: "invalid_request", message: "Request validation failed", issues: error.issues } });
      return;
    }
    if (error instanceof DomainError) {
      void reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, details: error.details } });
      return;
    }
    if (typeof error === "object" && error !== null && "statusCode" in error && error.statusCode === 413) {
      void reply.code(413).send({ error: { code: "artifact_too_large", message: "Artifact exceeds the upload limit" } });
      return;
    }
    app.log.error(error);
    void reply.code(500).send({ error: { code: "internal_error", message: "An unexpected error occurred" } });
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "relay-api",
    storage: repository.kind,
    runtime: runtime.name,
    timestamp: new Date().toISOString(),
  }));
  app.get("/v1/snapshot", () => service.getSnapshot());
  app.get("/v1/profile", () => service.getUserProfile());
  app.patch("/v1/profile", (request) => service.updateUserProfile(UserProfilePatchSchema.parse(request.body)));
  app.put("/v1/push-subscriptions", async (request, reply) => {
    await pushNotifications.register(config.workspaceId, PushSubscriptionSchema.parse(request.body));
    return reply.code(204).send();
  });
  app.delete("/v1/push-subscriptions", async (request, reply) => {
    await pushNotifications.unregister(config.workspaceId, DeletePushSubscriptionSchema.parse(request.body).token);
    return reply.code(204).send();
  });
  registerConnectorRoutes(app, connectors, config.ownerId);

  app.get("/v1/agents", () => service.listAgents());
  app.get("/v1/agents/:id", (request) => service.getAgent(IdParamsSchema.parse(request.params).id));
  app.post("/v1/agents", (request, reply) => {
    const actorId = agentActor(request);
    return service.createAgent(
      CreateAgentInputSchema.parse(request.body),
      actorId ? "agent" : "user",
      actorId ?? config.ownerId,
    ).then((value) => reply.code(201).send(value));
  });
  app.patch("/v1/agents/:id", (request) => {
    const actorId = agentActor(request);
    return service.updateAgent(
      IdParamsSchema.parse(request.params).id,
      AgentPatchSchema.parse(request.body),
      actorId ? "agent" : "user",
      actorId ?? config.ownerId,
    );
  });
  app.delete("/v1/agents/:id", async (request, reply) => {
    const actorId = agentActor(request);
    await service.deleteAgent(IdParamsSchema.parse(request.params).id, actorId ? "agent" : "user", actorId ?? config.ownerId);
    return reply.code(204).send();
  });

  app.get("/v1/conversations", () => service.listConversations());
  app.get("/v1/conversations/:id", (request) => service.getConversation(IdParamsSchema.parse(request.params).id));
  app.post("/v1/conversations", async (request, reply) => {
    const actorId = agentActor(request);
    const conversation = await service.createConversation(
      CreateConversationInputSchema.parse(request.body),
      actorId ? "agent" : "user",
      actorId ?? config.ownerId,
    );
    return reply.code(201).send(conversation);
  });
  app.patch("/v1/conversations/:id", (request) => {
    const actorId = agentActor(request);
    return service.updateConversation(
      IdParamsSchema.parse(request.params).id,
      ConversationPatchSchema.parse(request.body),
      actorId ? "agent" : "user",
      actorId ?? config.ownerId,
    );
  });
  app.delete("/v1/conversations/:id", async (request, reply) => {
    const actorId = agentActor(request);
    await service.deleteConversation(
      IdParamsSchema.parse(request.params).id,
      actorId ? "agent" : "user",
      actorId ?? config.ownerId,
    );
    return reply.code(204).send();
  });
  app.post("/v1/conversations/:id/clear", (request) => {
    const actorId = agentActor(request);
    return service.clearConversation(
      IdParamsSchema.parse(request.params).id,
      actorId ? "agent" : "user",
      actorId ?? config.ownerId,
    );
  });
  app.get("/v1/conversations/:conversationId/messages", (request) =>
    service.listMessages(ConversationParamsSchema.parse(request.params).conversationId),
  );
  app.post("/v1/conversations/:conversationId/messages", (request) => {
    const input = SendMessageInputSchema.parse(request.body);
    const headerKey = request.headers["idempotency-key"];
    if (typeof headerKey === "string" && headerKey !== input.clientOperationId) {
      throw new DomainError(400, "idempotency_mismatch", "Idempotency header must match clientOperationId");
    }
    return service.sendMessage(
      ConversationParamsSchema.parse(request.params).conversationId,
      input,
      (messageId, artifactIds) => artifacts.materializeForMessage(artifactIds, messageId),
    );
  });

  app.get("/v1/schedules", async (request) => {
    const schedules = await service.listSchedules();
    const actorId = agentActor(request);
    return actorId ? schedules.filter((schedule) => schedule.agentId === actorId) : schedules;
  });
  app.get("/v1/schedules/:id", (request) => service.getSchedule(IdParamsSchema.parse(request.params).id));
  app.post("/v1/schedules", async (request, reply) => {
    const actorId = agentActor(request);
    const schedule = await service.createSchedule(
      CreateScheduleInputSchema.parse(request.body),
      actorId ? "agent" : "user",
      actorId ?? config.ownerId,
    );
    return reply.code(201).send(schedule);
  });
  app.patch("/v1/schedules/:id", (request) => {
    const actorId = agentActor(request);
    return service.updateSchedule(
      IdParamsSchema.parse(request.params).id,
      UpdateScheduleInputSchema.parse(request.body),
      actorId ? "agent" : "user",
      actorId ?? config.ownerId,
    );
  });
  app.delete("/v1/schedules/:id", async (request, reply) => {
    const actorId = agentActor(request);
    await service.deleteSchedule(
      IdParamsSchema.parse(request.params).id,
      actorId ? "agent" : "user",
      actorId ?? config.ownerId,
    );
    return reply.code(204).send();
  });
  app.post("/v1/webhooks/:id/:token", async (request, reply) => {
    const { id, token } = WebhookParamsSchema.parse(request.params);
    const result = await service.triggerWebhook(id, token, request.body ?? {});
    return reply.code(202).send({ accepted: true, ...result });
  });

  app.get("/v1/tasks", () => service.listTasks());
  app.get("/v1/tasks/:id", (request) => service.getTask(IdParamsSchema.parse(request.params).id));
  app.post("/v1/tasks", async (request, reply) => {
    const actorId = agentActor(request);
    const task = await service.createTask(
      CreateTaskInputSchema.parse(request.body),
      actorId ? "agent" : "user",
      actorId ?? config.ownerId,
    );
    return reply.code(201).send(task);
  });
  app.patch("/v1/tasks/:id", async (request) => {
    const actorId = agentActor(request);
    return service.updateTask(
      IdParamsSchema.parse(request.params).id,
      TaskPatchSchema.parse(request.body),
      actorId ? "agent" : "user",
      actorId ?? config.ownerId,
    );
  });
  app.post("/v1/tasks/:id/delegate", async (request) => {
    const actorId = agentActor(request);
    return service.delegateTask(
      IdParamsSchema.parse(request.params).id,
      DelegateTaskInputSchema.parse(request.body),
      actorId ? "agent" : "user",
      actorId ?? config.ownerId,
    );
  });
  app.post("/v1/tasks/:id/block", (request) => {
    const input = BlockTaskSchema.parse(request.body);
    return service.blockTask(IdParamsSchema.parse(request.params).id, input.blocker, input.needsUser, requiredAgentActor(request));
  });
  app.post("/v1/tasks/:id/complete", (request) => {
    const input = CompleteTaskSchema.parse(request.body);
    return service.completeTask(
      IdParamsSchema.parse(request.params).id,
      input.summary,
      input.artifactIds,
      input.evidenceRefs,
      requiredAgentActor(request),
    );
  });
  app.post("/v1/collaboration/messages", (request) => {
    const input = CollaborationMessageSchema.parse(request.body);
    return service.sendCollaborationMessage(
      requiredAgentActor(request),
      input.agentId,
      input.taskId,
      input.message,
      input.contextRefs,
    );
  });
  app.post("/v1/collaboration/requests", async (request, reply) => {
    const input = AgentHelpRequestSchema.parse(request.body);
    const result = await service.requestAgentHelp(
      requiredAgentActor(request),
      input.agentId,
      input.taskId,
      input.request,
      input.paths,
    );
    return reply.code(201).send(result);
  });
  app.get("/v1/collaboration/requests/:id", (request) => service.readAgentHelp(
    requiredAgentActor(request),
    IdParamsSchema.parse(request.params).id,
  ));

  app.get("/v1/runs", () => service.listRuns());
  app.get("/v1/runs/:id", (request) => service.getRun(IdParamsSchema.parse(request.params).id));
  app.post("/v1/runs/:id/interrupt", (request) => service.interruptRun(IdParamsSchema.parse(request.params).id).then(() => ({})));

  app.get("/v1/approvals", () => service.listApprovals());
  app.get("/v1/approvals/:id", (request) => service.getApproval(IdParamsSchema.parse(request.params).id));
  app.post("/v1/approvals/:id/approve", (request) => service.resolveApproval(IdParamsSchema.parse(request.params).id, "approve"));
  app.post("/v1/approvals/:id/deny", (request) => service.resolveApproval(IdParamsSchema.parse(request.params).id, "deny"));

  registerArtifactRoutes(app, artifacts, config);
  registerComputerRoutes(app, computers, config);

  app.get("/v1/events", async (request, reply) => {
    const query = z.object({ after: z.coerce.number().int().nonnegative().default(0), token: z.string().optional() }).parse(request.query);
    reply.hijack();
    const origin = request.headers.origin;
    const corsHeaders = origin && isAllowedOrigin(origin, config) ? { "access-control-allow-origin": origin, vary: "Origin" } : {};
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      ...corsHeaders,
    });
    reply.raw.write(": connected\n\n");
    let cursor = query.after;
    const pending: import("@noudle-agents/protocol").RelayEvent[] = [];
    let replaying = true;
    const send = (event: import("@noudle-agents/protocol").RelayEvent): void => {
      if (event.cursor <= cursor) return;
      cursor = event.cursor;
      reply.raw.write(`id: ${event.cursor}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    const unsubscribe = events.subscribe(config.workspaceId, (event) => {
      if (replaying) pending.push(event);
      else send(event);
    });
    for (const event of await repository.listEvents(config.workspaceId, cursor, 5000)) send(event);
    replaying = false;
    for (const event of pending) send(event);
    const heartbeat = setInterval(() => reply.raw.write(`: heartbeat ${Date.now()}\n\n`), 15_000);
    heartbeat.unref();
    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  app.addHook("onClose", async () => {
    await worker.stop();
    await repository.close();
  });
  if (options.startWorker !== false) worker.start();
  return { app, config, repository, service, worker, artifacts, computers, connectors };
}
