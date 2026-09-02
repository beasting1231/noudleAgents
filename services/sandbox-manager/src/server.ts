import { pathToFileURL } from "node:url";
import websocket from "@fastify/websocket";
import Fastify, { LogController, type FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { config } from "./config.js";
import { SandboxService } from "./sandboxService.js";
import { ViewAccess } from "./viewAccess.js";
import { registerViewProxy } from "./viewProxy.js";

export interface SandboxAppOptions {
  sandboxes?: SandboxService;
  views?: ViewAccess;
  logger?: boolean;
}

export async function buildSandboxApp(options: SandboxAppOptions = {}): Promise<FastifyInstance> {
  // View capability tokens live in the URL because browser WebSocket APIs
  // cannot attach an Authorization header. Never log request URLs here.
  const app = Fastify({
    logger: options.logger ?? false,
    logController: new LogController({ disableRequestLogging: true }),
  });
  const sandboxes = options.sandboxes ?? new SandboxService();
  const views = options.views ?? new ViewAccess(config.viewSecret, config.publicUrl);

  await app.register(websocket, { options: { maxPayload: 8 * 1024 * 1024, perMessageDeflate: false } });
  sandboxes.startIdleMonitor();
  app.addHook("onClose", async () => sandboxes.stopIdleMonitor());

  app.addHook("onRequest", async (request, reply) => {
    if (request.url === "/health" || request.url.startsWith("/view/")) return;
    if (request.headers.authorization !== `Bearer ${config.internalToken}`) {
      await reply.code(401).send({ error: "unauthorized" });
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      void reply.code(400).send({ error: "invalid_request", issues: error.issues });
      return;
    }
    app.log.error(error);
    void reply.code(500).send({ error: "internal_error" });
  });

  app.get("/health", async (_request, reply) => {
    const health = await sandboxes.health();
    if (!health.docker) return reply.code(503).send({ ok: false, ...health });
    return { ok: true, ...health };
  });

  app.get("/v1/sandboxes", async () => ({ sandboxes: await sandboxes.list() }));

  app.post("/v1/sandboxes", async (request, reply) => {
    const body = z
      .object({
        id: z.string().min(1).max(80),
        workspaceKey: z.string().min(1).max(320),
        browser: z.boolean().default(false),
        networkAccess: z.boolean().default(false),
      })
      .parse(request.body ?? {});
    const sandbox = await sandboxes.create(body);
    return reply.code(201).send(sandbox);
  });

  app.post("/v1/sandboxes/:id/start", async (request) => {
    const params = z.object({ id: z.string().min(1).max(80) }).parse(request.params);
    return sandboxes.start(params.id);
  });

  app.post("/v1/sandboxes/:id/stop", async (request) => {
    const params = z.object({ id: z.string().min(1).max(80) }).parse(request.params);
    return sandboxes.stop(params.id);
  });

  app.post("/v1/sandboxes/:id/exec", async (request) => {
    const params = z.object({ id: z.string().min(1).max(80) }).parse(request.params);
    const body = z
      .object({
        command: z.array(z.string()).min(1).max(64),
        timeoutMs: z.number().int().min(250).max(120_000).default(30_000),
      })
      .parse(request.body);
    return sandboxes.exec(params.id, body.command, body.timeoutMs);
  });

  app.post("/v1/sandboxes/:id/browser/navigate", async (request) => {
    const params = z.object({ id: z.string().min(1).max(80) }).parse(request.params);
    const body = z.object({ url: z.string().url().max(8_000) }).strict().parse(request.body);
    return sandboxes.browserNavigate(params.id, body.url);
  });

  app.post("/v1/sandboxes/:id/desktop/action", async (request) => {
    const params = z.object({ id: z.string().min(1).max(80) }).parse(request.params);
    const body = z.discriminatedUnion("action", [
      z.object({ action: z.literal("screenshot") }).strict(),
      z.object({ action: z.literal("click"), x: z.number().int().min(0).max(10_000), y: z.number().int().min(0).max(10_000), button: z.number().int().min(1).max(3).default(1), count: z.number().int().min(1).max(3).default(1) }).strict(),
      z.object({ action: z.literal("move"), x: z.number().int().min(0).max(10_000), y: z.number().int().min(0).max(10_000) }).strict(),
      z.object({ action: z.literal("type"), text: z.string().max(20_000) }).strict(),
      z.object({ action: z.literal("key"), key: z.string().min(1).max(80) }).strict(),
      z.object({ action: z.literal("scroll"), amount: z.number().int().min(-30).max(30), x: z.number().int().min(0).max(10_000).optional(), y: z.number().int().min(0).max(10_000).optional() }).strict(),
      z.object({ action: z.literal("drag"), fromX: z.number().int().min(0).max(10_000), fromY: z.number().int().min(0).max(10_000), toX: z.number().int().min(0).max(10_000), toY: z.number().int().min(0).max(10_000), button: z.number().int().min(1).max(3).default(1), steps: z.number().int().min(1).max(100).default(12) }).strict(),
      z.object({ action: z.literal("wait"), milliseconds: z.number().int().min(100).max(10_000).default(1000) }).strict(),
    ]).parse(request.body);
    return sandboxes.desktopAction(params.id, body);
  });

  app.delete("/v1/sandboxes/:id", async (request, reply) => {
    const params = z.object({ id: z.string().min(1).max(80) }).parse(request.params);
    await sandboxes.remove(params.id);
    return reply.code(204).send();
  });

  registerViewProxy(app, sandboxes, views);
  return app;
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entry === import.meta.url) {
  const app = await buildSandboxApp({ logger: true });
  await app.listen({ host: config.host, port: config.port });
}
