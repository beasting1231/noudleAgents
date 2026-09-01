import { once } from "node:events";
import { createServer, type Server } from "node:http";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { WebSocket, WebSocketServer } from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ViewAccess } from "./viewAccess.js";
import { registerViewProxy } from "./viewProxy.js";

describe("noVNC reverse proxy", () => {
  const id = "session-proxy-test";
  const access = new ViewAccess("proxy-test-secret-at-least-16", "http://127.0.0.1:4330");
  let upstreamServer: Server;
  let upstreamWebSocket: WebSocketServer;
  let app: FastifyInstance;
  let proxyBaseUrl: string;
  let proxyWebSocketUrl: string;
  let upstreamPort: number;
  let transientFailures: number;

  beforeEach(async () => {
    transientFailures = 0;
    upstreamServer = createServer((request, response) => {
      if (request.url?.startsWith("/vnc.html")) {
        if (transientFailures > 0) {
          transientFailures -= 1;
          response.writeHead(503).end();
          return;
        }
        response.writeHead(200, { "content-type": "text/html" });
        response.end("<html>noVNC</html>");
        return;
      }
      if (request.url === "/app/ui.js") {
        response.writeHead(200, { "content-type": "application/javascript" });
        response.end("export const relay = true;");
        return;
      }
      response.writeHead(404).end();
    });
    upstreamWebSocket = new WebSocketServer({ server: upstreamServer, path: "/websockify" });
    upstreamServer.listen(0, "127.0.0.1");
    await once(upstreamServer, "listening");
    const upstreamAddress = upstreamServer.address();
    if (!upstreamAddress || typeof upstreamAddress === "string") throw new Error("Expected upstream TCP address");
    upstreamPort = upstreamAddress.port;
    upstreamWebSocket.on("connection", (socket) => {
      socket.send(Buffer.from("RFB 003.008\n"));
      socket.on("message", (message, isBinary) => socket.send(message, { binary: isBinary }));
    });

    app = Fastify();
    await app.register(websocket);
    registerViewProxy(app, { browserTarget: async () => ({ host: "127.0.0.1", port: upstreamPort }) }, access);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const proxyAddress = app.server.address();
    if (!proxyAddress || typeof proxyAddress === "string") throw new Error("Expected proxy TCP address");
    proxyBaseUrl = `http://127.0.0.1:${proxyAddress.port}`;
    proxyWebSocketUrl = `ws://127.0.0.1:${proxyAddress.port}`;
  });

  afterEach(async () => {
    app.server.closeAllConnections();
    await app.close();
    for (const client of upstreamWebSocket.clients) client.terminate();
    await new Promise<void>((resolve, reject) => upstreamServer.close((error) => (error ? reject(error) : resolve())));
  });

  it("proxies HTTP assets only through a capability-scoped path", async () => {
    const token = access.token(id);
    const initial = await fetch(`${proxyBaseUrl}/view/${id}/${token}/vnc.html?autoconnect=1`);
    expect(initial.status).toBe(200);
    expect(await initial.text()).toContain("noVNC");
    expect(initial.headers.get("referrer-policy")).toBe("no-referrer");

    const asset = await fetch(`${proxyBaseUrl}/view/${id}/${token}/app/ui.js`);
    expect(asset.status).toBe(200);
    expect(await asset.text()).toContain("relay = true");

    const invalid = await fetch(`${proxyBaseUrl}/view/${id}/invalid/vnc.html`);
    expect(invalid.status).toBe(404);
  });

  it("waits through transient browser startup failures", async () => {
    transientFailures = 2;
    const token = access.token(id);
    const initial = await fetch(`${proxyBaseUrl}/view/${id}/${token}/vnc.html?autoconnect=1`);
    expect(initial.status).toBe(200);
    expect(await initial.text()).toContain("noVNC");
    expect(transientFailures).toBe(0);
  });

  it("proxies binary WebSocket traffic to websockify", async () => {
    const socket = new WebSocket(`${proxyWebSocketUrl}/view/${id}/${access.token(id)}/websockify`);
    const greeting = await new Promise<Buffer>((resolve, reject) => {
      socket.once("message", (message) => resolve(Buffer.from(message as ArrayBuffer)));
      socket.once("error", reject);
    });
    expect(greeting.toString()).toBe("RFB 003.008\n");
    socket.send(Buffer.from([1, 2, 3]));
    const echo = await new Promise<Buffer>((resolve, reject) => {
      socket.once("message", (message) => resolve(Buffer.from(message as ArrayBuffer)));
      socket.once("error", reject);
    });
    expect([...echo]).toEqual([1, 2, 3]);
    socket.close();
    await once(socket, "close");
  });

  it("rejects an invalid WebSocket capability before reaching upstream", async () => {
    const socket = new WebSocket(`${proxyWebSocketUrl}/view/${id}/invalid/websockify`);
    const status = await new Promise<number>((resolve) => {
      socket.once("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0));
      socket.once("error", () => resolve(0));
    });
    expect(status).toBe(404);
    socket.terminate();
  });
});
