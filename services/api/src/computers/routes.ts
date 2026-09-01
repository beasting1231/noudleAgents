import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { RelayConfig } from "../config.js";
import type { ComputerService, ComputerActor } from "./computer-service.js";

const IdParamsSchema = z.object({ id: z.string().min(1).max(160) });
const CreateComputerSchema = z
  .object({
    agentId: z.string().min(1).max(160).nullable().optional(),
    taskId: z.string().min(1).max(160).nullable().optional(),
    browser: z.boolean().default(true),
    networkAccess: z.boolean().default(false),
  })
  .strict();
const TakeoverSchema = z.object({ leaseSeconds: z.number().int().min(30).max(3600).default(300) }).strict();
const ExecSchema = z
  .object({
    command: z.array(z.string().max(32_000).refine((value) => !value.includes("\u0000"))).min(1).max(64),
    timeoutMs: z.number().int().min(250).max(120_000).default(30_000),
  })
  .strict();
const BrowserNavigateSchema = z.object({
  computerId: z.string().min(1).max(160).nullable().optional(),
  url: z.string().url().max(8_000),
}).strict();
const DesktopActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("screenshot"), computerId: z.string().min(1).max(160).nullable().optional() }).strict(),
  z.object({ action: z.literal("click"), computerId: z.string().min(1).max(160).nullable().optional(), x: z.number().int().min(0).max(10_000), y: z.number().int().min(0).max(10_000), button: z.number().int().min(1).max(3).default(1), count: z.number().int().min(1).max(3).default(1) }).strict(),
  z.object({ action: z.literal("move"), computerId: z.string().min(1).max(160).nullable().optional(), x: z.number().int().min(0).max(10_000), y: z.number().int().min(0).max(10_000) }).strict(),
  z.object({ action: z.literal("type"), computerId: z.string().min(1).max(160).nullable().optional(), text: z.string().max(20_000) }).strict(),
  z.object({ action: z.literal("key"), computerId: z.string().min(1).max(160).nullable().optional(), key: z.string().min(1).max(80) }).strict(),
  z.object({ action: z.literal("scroll"), computerId: z.string().min(1).max(160).nullable().optional(), amount: z.number().int().min(-30).max(30), x: z.number().int().min(0).max(10_000).optional(), y: z.number().int().min(0).max(10_000).optional() }).strict(),
  z.object({ action: z.literal("drag"), computerId: z.string().min(1).max(160).nullable().optional(), fromX: z.number().int().min(0).max(10_000), fromY: z.number().int().min(0).max(10_000), toX: z.number().int().min(0).max(10_000), toY: z.number().int().min(0).max(10_000), button: z.number().int().min(1).max(3).default(1), steps: z.number().int().min(1).max(100).default(12) }).strict(),
  z.object({ action: z.literal("wait"), computerId: z.string().min(1).max(160).nullable().optional(), milliseconds: z.number().int().min(100).max(10_000).default(1000) }).strict(),
]);

function actor(request: FastifyRequest, config: RelayConfig): ComputerActor {
  const raw = request.headers["x-relay-agent-id"];
  const agentId = Array.isArray(raw) ? raw[0] : raw;
  return agentId ? { type: "agent", id: agentId } : { type: "user", id: config.ownerId };
}

export function registerComputerRoutes(app: FastifyInstance, computers: ComputerService, config: RelayConfig): void {
  app.get("/v1/computers", () => computers.list());
  app.get("/v1/computers/:id", (request) => computers.get(IdParamsSchema.parse(request.params).id));
  app.post("/v1/computers", async (request, reply) => {
    const input = CreateComputerSchema.parse(request.body ?? {});
    const session = await computers.create(
      {
        agentId: input.agentId ?? null,
        taskId: input.taskId ?? null,
        browser: input.browser,
        networkAccess: input.networkAccess,
      },
      actor(request, config),
    );
    return reply.code(201).send(session);
  });
  app.post("/v1/computers/:id/takeover", (request) => {
    const input = TakeoverSchema.parse(request.body ?? {});
    return computers.takeover(IdParamsSchema.parse(request.params).id, input.leaseSeconds, actor(request, config));
  });
  app.post("/v1/computers/:id/return", (request) =>
    computers.returnControl(IdParamsSchema.parse(request.params).id, actor(request, config)),
  );
  app.post("/v1/computers/:id/exec", (request) => {
    const input = ExecSchema.parse(request.body);
    return computers.exec(IdParamsSchema.parse(request.params).id, input.command, input.timeoutMs, actor(request, config));
  });
  app.post("/v1/computers/browser/navigate", (request) => {
    const input = BrowserNavigateSchema.parse(request.body);
    return computers.navigateBrowser(input.computerId ?? null, input.url, actor(request, config));
  });
  app.post("/v1/computers/desktop/action", (request) => {
    const input = DesktopActionSchema.parse(request.body);
    const { computerId, ...action } = input;
    return computers.desktopAction(computerId ?? null, action, actor(request, config));
  });
  app.delete("/v1/computers/:id", async (request) => {
    await computers.remove(IdParamsSchema.parse(request.params).id, actor(request, config));
    return {};
  });
}
