import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRelayApp, type RelayAppContext } from "../src/app.js";
import { MemoryRelayRepository } from "../src/database/memory-repository.js";
import type { ComputerSession } from "../src/model.js";
import { FakeSandboxManager } from "./fake-sandbox-manager.js";
import { HttpSandboxManagerClient } from "../src/computers/sandbox-manager-client.js";
import { authHeaders, testConfig } from "./helpers.js";

describe("computer session APIs", () => {
  let context: RelayAppContext;
  let manager: FakeSandboxManager;

  beforeEach(async () => {
    manager = new FakeSandboxManager();
    context = await createRelayApp({
      config: testConfig({ computerPublicHost: "192.168.20.10" }),
      repository: new MemoryRelayRepository(),
      sandboxManager: manager,
      startWorker: false,
    });
  });

  afterEach(async () => context.app.close());

  it("proxies lifecycle without exposing Docker and rewrites the explicit public host", async () => {
    const createdResponse = await context.app.inject({
      method: "POST",
      url: "/v1/computers",
      headers: authHeaders,
      payload: { agentId: "agent-builder", browser: true, networkAccess: false },
    });
    expect(createdResponse.statusCode).toBe(201);
    const created = createdResponse.json() as ComputerSession & Record<string, unknown>;
    expect(created).toMatchObject({
      agentId: "agent-builder",
      status: "running",
      browser: true,
      controlMode: "agent",
      controlHolderId: "agent-builder",
      computerHostPort: 61234,
    });
    expect(created.computerUrl).toContain("192.168.20.10:61234");
    expect(created.containerId).toBeUndefined();
    expect(created.name).toBeUndefined();

    const list = await context.app.inject({ method: "GET", url: "/v1/computers", headers: authHeaders });
    expect(list.json()).toHaveLength(1);
    expect((await context.app.inject({ method: "GET", url: `/v1/computers/${created.id}`, headers: authHeaders })).statusCode).toBe(200);

    const removed = await context.app.inject({ method: "DELETE", url: `/v1/computers/${created.id}`, headers: authHeaders });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toEqual({});
    expect(manager.sandboxes.size).toBe(0);
    expect((await context.repository.listEvents("workspace-test", 0)).filter((event) => event.type === "computer.updated")).toHaveLength(2);
  });

  it("enforces takeover leases and audits terminal execution without command contents", async () => {
    const created = (
      await context.app.inject({
        method: "POST",
        url: "/v1/computers",
        headers: authHeaders,
        payload: { agentId: "agent-builder", browser: false },
      })
    ).json() as ComputerSession;

    const denied = await context.app.inject({
      method: "POST",
      url: `/v1/computers/${created.id}/exec`,
      headers: authHeaders,
      payload: { command: ["printf", "super-secret"] },
    });
    expect(denied.statusCode).toBe(409);
    expect(denied.json().error.code).toBe("computer_takeover_required");

    const takeover = await context.app.inject({
      method: "POST",
      url: `/v1/computers/${created.id}/takeover`,
      headers: authHeaders,
      payload: { leaseSeconds: 60 },
    });
    expect(takeover.json()).toMatchObject({ controlMode: "user", controlHolderId: "owner-test" });

    const executed = await context.app.inject({
      method: "POST",
      url: `/v1/computers/${created.id}/exec`,
      headers: authHeaders,
      payload: { command: ["printf", "super-secret"], timeoutMs: 1000 },
    });
    expect(executed.json()).toEqual({ exitCode: 0, stdout: "ran:printf", stderr: "" });

    await context.app.inject({ method: "POST", url: `/v1/computers/${created.id}/return`, headers: authHeaders, payload: {} });
    const agentExecution = await context.app.inject({
      method: "POST",
      url: `/v1/computers/${created.id}/exec`,
      headers: { ...authHeaders, "x-relay-agent-id": "agent-builder" },
      payload: { command: ["pwd"] },
    });
    expect(agentExecution.statusCode).toBe(200);

    const commandEvents = (await context.repository.listEvents("workspace-test", 0)).filter(
      (event) => event.type === "computer.updated" && event.payload.action === "command_executed",
    );
    expect(commandEvents).toHaveLength(2);
    expect(commandEvents[0]?.payload).toMatchObject({ executable: "printf", argumentCount: 2, exitCode: 0 });
    expect(JSON.stringify(commandEvents)).not.toContain("super-secret");
  });

  it("prevents agents from enabling network access or controlling another agent's computer", async () => {
    const network = await context.app.inject({
      method: "POST",
      url: "/v1/computers",
      headers: { ...authHeaders, "x-relay-agent-id": "agent-builder" },
      payload: { agentId: "agent-builder", networkAccess: true },
    });
    expect(network.statusCode).toBe(403);

    const created = (
      await context.app.inject({
        method: "POST",
        url: "/v1/computers",
        headers: authHeaders,
        payload: { agentId: "agent-builder", browser: false },
      })
    ).json() as ComputerSession;
    const foreign = await context.app.inject({
      method: "POST",
      url: `/v1/computers/${created.id}/exec`,
      headers: { ...authHeaders, "x-relay-agent-id": "agent-researcher" },
      payload: { command: ["pwd"] },
    });
    expect(foreign.statusCode).toBe(403);
  });

  it("automatically gives each agent a persistent independent browser", async () => {
    const shared = (
      await context.app.inject({
        method: "POST",
        url: "/v1/computers",
        headers: authHeaders,
        payload: { browser: true, networkAccess: true },
      })
    ).json() as ComputerSession;
    const response = await context.app.inject({
      method: "POST",
      url: "/v1/computers/browser/navigate",
      headers: { ...authHeaders, "x-relay-agent-id": "agent-builder" },
      payload: { url: "https://www.reddit.com/" },
    });
    expect(response.statusCode).toBe(200);
    const builderComputer = response.json().computer as ComputerSession;
    expect(builderComputer).toMatchObject({ agentId: "agent-builder", networkAccess: true, controlMode: "agent" });
    expect(builderComputer.id).not.toBe(shared.id);

    const sharedDenied = await context.app.inject({
      method: "POST",
      url: "/v1/computers/desktop/action",
      headers: { ...authHeaders, "x-relay-agent-id": "agent-builder" },
      payload: { action: "screenshot", computerId: shared.id },
    });
    expect(sharedDenied.statusCode).toBe(403);
    expect(sharedDenied.json().error.code).toBe("computer_agent_mismatch");

    const reused = await context.app.inject({
      method: "POST",
      url: "/v1/computers/desktop/action",
      headers: { ...authHeaders, "x-relay-agent-id": "agent-builder" },
      payload: { action: "screenshot" },
    });
    expect(reused.json().computer.id).toBe(builderComputer.id);

    const researcher = await context.app.inject({
      method: "POST",
      url: "/v1/computers/desktop/action",
      headers: { ...authHeaders, "x-relay-agent-id": "agent-researcher" },
      payload: { action: "screenshot" },
    });
    expect(researcher.json().computer).toMatchObject({ agentId: "agent-researcher", controlMode: "agent" });
    expect(researcher.json().computer.id).not.toBe(builderComputer.id);
    expect(manager.sandboxes.size).toBe(3);
    const events = await context.repository.listEvents("workspace-test", 0);
    expect(events.some((event) => event.payload.action === "browser_navigated" && event.payload.url === "https://www.reddit.com/")).toBe(true);
  });

  it("lets an agent operate its own desktop while respecting user takeover", async () => {
    const screenshot = await context.app.inject({
      method: "POST",
      url: "/v1/computers/desktop/action",
      headers: { ...authHeaders, "x-relay-agent-id": "agent-builder" },
      payload: { action: "screenshot" },
    });
    expect(screenshot.statusCode).toBe(200);
    const computer = screenshot.json().computer as ComputerSession;
    expect(computer).toMatchObject({ agentId: "agent-builder", controlMode: "agent" });
    expect(screenshot.json()).toMatchObject({ result: { action: "screenshot", width: 1440, height: 900, mimeType: "image/jpeg" } });

    await context.app.inject({ method: "POST", url: `/v1/computers/${computer.id}/takeover`, headers: authHeaders, payload: { leaseSeconds: 60 } });
    const blocked = await context.app.inject({
      method: "POST",
      url: "/v1/computers/desktop/action",
      headers: { ...authHeaders, "x-relay-agent-id": "agent-builder" },
      payload: { action: "click", x: 200, y: 300 },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe("computer_controlled_by_user");
  });
});

describe("sandbox manager HTTP gateway", () => {
  it("authenticates every internal request without forwarding owner credentials", async () => {
    let authorization: string | undefined;
    const server = createServer((request, response) => {
      authorization = request.headers.authorization;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ sandboxes: [] }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP address");
    try {
      const client = new HttpSandboxManagerClient(
        testConfig({ sandboxManagerUrl: `http://127.0.0.1:${address.port}`, internalToken: "dedicated-internal-token" }),
      );
      expect(await client.list()).toEqual([]);
      expect(authorization).toBe("Bearer dedicated-internal-token");
      expect(authorization).not.toContain("test-owner-token");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});
import { once } from "node:events";
import { createServer } from "node:http";
