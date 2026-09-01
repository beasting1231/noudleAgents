import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import { config } from "./config.js";
import { CodexProcess } from "./codexProcess.js";

const app = Fastify({ logger: true });
const codex = new CodexProcess(config);

await app.register(cors, { origin: false });

app.addHook("onRequest", async (request, reply) => {
  if (request.url === "/health") return;
  if (request.headers.authorization !== `Bearer ${config.internalToken}`) {
    await reply.code(401).send({ error: "unauthorized" });
  }
});

app.get("/health", async () => ({ ok: true, codex: codex.health }));

app.post("/v1/threads/start", async (request) => {
  const body = z.object({
    cwd: z.string().default("."),
    developerInstructions: z.string().max(100_000).optional(),
    model: z.string().optional(),
    speed: z.enum(["balanced", "extra-fast"]).optional(),
    ephemeral: z.boolean().optional(),
    agentId: z.string().min(1).optional(),
  }).parse(request.body ?? {});
  return codex.startThread(body);
});

app.post("/v1/threads/:threadId/resume", async (request) => {
  const params = z.object({ threadId: z.string().min(1) }).parse(request.params);
  const body = z.object({
    cwd: z.string().default("."),
    agentId: z.string().min(1).optional(),
    model: z.string().optional(),
    speed: z.enum(["balanced", "extra-fast"]).optional(),
  }).parse(request.body ?? {});
  return codex.resumeThread(params.threadId, body);
});

app.post("/v1/threads/:threadId/turns", async (request) => {
  const params = z.object({ threadId: z.string().min(1) }).parse(request.params);
  const body = z.object({
    text: z.string().trim().min(1).max(500_000),
    cwd: z.string().optional(),
    clientUserMessageId: z.string().optional(),
    model: z.string().optional(),
    effort: z.enum(["low", "medium", "high", "xhigh"]).optional(),
    speed: z.enum(["balanced", "extra-fast"]).optional(),
  }).parse(request.body);
  return codex.startTurn({ threadId: params.threadId, ...body });
});

app.post("/v1/threads/:threadId/mcp/:server/:tool", async (request) => {
  const params = z.object({ threadId: z.string().min(1), server: z.string().min(1), tool: z.string().min(1) }).parse(request.params);
  const body = z.object({ arguments: z.record(z.string(), z.unknown()).default({}) }).parse(request.body ?? {});
  return codex.callMcpTool(params.threadId, params.server, params.tool, body.arguments);
});

app.post("/v1/threads/:threadId/turns/:turnId/interrupt", async (request, reply) => {
  const params = z.object({ threadId: z.string().min(1), turnId: z.string().min(1) }).parse(request.params);
  await codex.interrupt(params.threadId, params.turnId);
  await reply.code(204).send();
});

app.get("/v1/approvals", async () => ({ approvals: [...codex.pendingApprovals.values()] }));

app.post("/v1/approvals/:id/resolve", async (request) => {
  const params = z.object({ id: z.string().min(1) }).parse(request.params);
  const body = z.object({ decision: z.enum(["accept", "decline"]) }).parse(request.body);
  codex.resolveApproval(params.id, body.decision);
  return { ok: true };
});

app.get("/v1/events", async (request, reply) => {
  const query = z.object({ after: z.coerce.number().int().nonnegative().default(0) }).parse(request.query);
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  const send = (event: unknown) => reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
  for (const event of codex.events.after(query.after)) send(event);
  const unsubscribe = codex.events.subscribe(send);
  const heartbeat = setInterval(() => reply.raw.write(": heartbeat\n\n"), 15_000);
  request.raw.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
  return reply.hijack();
});

app.addHook("onClose", async () => codex.stop());

try {
  await codex.start();
} catch (error) {
  app.log.warn({ error }, "Codex App Server did not start; worker will retry on the first request");
}

await app.listen({ host: config.host, port: config.port });
