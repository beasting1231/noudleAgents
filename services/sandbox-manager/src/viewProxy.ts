import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { WebSocket, type RawData } from "ws";
import { z } from "zod";
import { ViewAccess } from "./viewAccess.js";

export interface BrowserTargetResolver {
  browserTarget(id: string): Promise<{ host: string; port: number }>;
}

const ViewParamsSchema = z.object({ id: z.string().min(1).max(80), token: z.string().min(1).max(128), "*": z.string().optional() });
const MAX_ASSET_BYTES = 16 * 1024 * 1024;
const MAX_QUEUED_WEBSOCKET_BYTES = 2 * 1024 * 1024;
const UPSTREAM_STARTUP_TIMEOUT_MS = 5_000;
const UPSTREAM_RETRY_DELAY_MS = 100;

function forwardedCloseCode(code: number): number {
  if (code < 1000 || code > 4999 || code === 1004 || code === 1005 || code === 1006 || code === 1015) return 1000;
  return code;
}

async function authorize(request: FastifyRequest, reply: FastifyReply, access: ViewAccess): Promise<void> {
  const parsed = ViewParamsSchema.safeParse(request.params);
  if (!parsed.success || !access.validate(parsed.data.id, parsed.data.token)) {
    await reply.code(404).send({ error: "not_found" });
  }
}

function upstreamUrl(target: { host: string; port: number }, assetPath: string, requestUrl: string): URL {
  const url = new URL(`http://${target.host}:${target.port}`);
  url.pathname = `/${assetPath || "vnc.html"}`;
  const incoming = new URL(requestUrl, "http://relay.invalid");
  for (const [key, value] of incoming.searchParams) {
    url.searchParams.append(key, value);
  }
  return url;
}

async function boundedBody(response: Response): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_ASSET_BYTES) throw new Error("noVNC asset exceeded proxy limit");
      chunks.push(Buffer.from(next.value));
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchUpstream(url: URL, method: string, headers: HeadersInit): Promise<Response> {
  const deadline = Date.now() + UPSTREAM_STARTUP_TIMEOUT_MS;
  for (;;) {
    try {
      const response = await fetch(url, {
        method,
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(1_500),
      });
      if (response.status < 500 || Date.now() >= deadline) return response;
      await response.body?.cancel().catch(() => undefined);
    } catch (error) {
      if (Date.now() >= deadline) throw error;
    }
    await wait(UPSTREAM_RETRY_DELAY_MS);
  }
}

export function registerViewProxy(app: FastifyInstance, resolver: BrowserTargetResolver, access: ViewAccess): void {
  app.get(
    "/view/:id/:token/websockify",
    { websocket: true, preValidation: (request, reply) => authorize(request, reply, access) },
    (socket, request) => {
      const params = ViewParamsSchema.parse(request.params);
      const targetPromise = resolver.browserTarget(params.id);
      const queued: Array<{ data: RawData; isBinary: boolean }> = [];
      let queuedBytes = 0;
      let upstream: WebSocket | null = null;

      socket.on("message", (data, isBinary) => {
        if (upstream?.readyState === WebSocket.OPEN) {
          upstream.send(data, { binary: isBinary });
          return;
        }
        const size =
          typeof data === "string"
            ? Buffer.byteLength(data)
            : data instanceof ArrayBuffer
              ? data.byteLength
              : Array.isArray(data)
                ? data.reduce((total, chunk) => total + chunk.byteLength, 0)
                : data.byteLength;
        queuedBytes += size;
        if (queuedBytes > MAX_QUEUED_WEBSOCKET_BYTES) {
          socket.close(1009, "Proxy queue limit exceeded");
          return;
        }
        queued.push({ data, isBinary });
      });
      socket.on("close", (code, reason) => {
        if (upstream && (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING)) {
          upstream.close(forwardedCloseCode(code), reason.toString());
        }
      });
      socket.on("error", () => upstream?.terminate());

      void targetPromise
        .then((target) => {
          const protocols = String(request.headers["sec-websocket-protocol"] ?? "")
            .split(",")
            .map((protocol) => protocol.trim())
            .filter(Boolean);
          upstream = new WebSocket(
            `ws://${target.host}:${target.port}/websockify`,
            protocols.length ? protocols : undefined,
            { handshakeTimeout: 5000, perMessageDeflate: false, maxPayload: 8 * 1024 * 1024 },
          );
          upstream.binaryType = "arraybuffer";
          upstream.on("open", () => {
            for (const item of queued) upstream?.send(item.data, { binary: item.isBinary });
            queued.length = 0;
            queuedBytes = 0;
          });
          upstream.on("message", (data, isBinary) => {
            if (socket.readyState === WebSocket.OPEN) socket.send(data, { binary: isBinary });
          });
          upstream.on("close", (code, reason) => {
            if (socket.readyState === WebSocket.OPEN) socket.close(forwardedCloseCode(code), reason.toString());
          });
          upstream.on("error", () => {
            if (socket.readyState === WebSocket.OPEN) socket.close(1011, "Browser proxy unavailable");
          });
        })
        .catch(() => {
          if (socket.readyState === WebSocket.OPEN) socket.close(1008, "Browser session unavailable");
        });
    },
  );

  app.route({
    method: ["GET", "HEAD"],
    url: "/view/:id/:token/*",
    preValidation: (request, reply) => authorize(request, reply, access),
    handler: async (request, reply) => {
      const params = ViewParamsSchema.parse(request.params);
      const target = await resolver.browserTarget(params.id).catch(() => null);
      if (!target) return reply.code(404).send({ error: "not_found" });
      let response: Response;
      try {
        response = await fetchUpstream(
          upstreamUrl(target, params["*"] ?? "vnc.html", request.raw.url ?? "/"),
          request.method,
          {
            accept: request.headers.accept ?? "*/*",
            "user-agent": "relay-sandbox-view-proxy/1",
          },
        );
      } catch {
        return reply.code(502).send({ error: "browser_proxy_unavailable" });
      }
      reply.code(response.status);
      for (const header of ["content-type", "cache-control", "etag", "last-modified"] as const) {
        const value = response.headers.get(header);
        if (value) reply.header(header, value);
      }
      reply
        .header("x-content-type-options", "nosniff")
        .header("referrer-policy", "no-referrer");
      if (request.method === "HEAD") return reply.send();
      try {
        return reply.send(await boundedBody(response));
      } catch {
        return reply.code(502).send({ error: "browser_proxy_response_invalid" });
      }
    },
  });
}
