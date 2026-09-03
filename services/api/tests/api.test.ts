import type { Message, RelayEvent } from "@noudle-agents/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { createRelayApp, type RelayAppContext } from "../src/app.js";
import { MemoryRelayRepository } from "../src/database/memory-repository.js";
import { MockAgentRuntime } from "../src/runtime/mock-runtime.js";
import { agentAuthHeaders, authHeaders, testConfig } from "./helpers.js";

describe("noudleAgents HTTP API", () => {
  let context: RelayAppContext | null = null;

  afterEach(async () => {
    await context?.app.close();
    context = null;
  });

  async function setup(): Promise<RelayAppContext> {
    context = await createRelayApp({
      config: testConfig(),
      repository: new MemoryRelayRepository(),
      runtime: new MockAgentRuntime(0),
      startWorker: false,
    });
    return context;
  }

  it("serves health publicly and protects workspace routes", async () => {
    const { app } = await setup();
    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ status: "ok", storage: "memory", runtime: "mock" });

    expect((await app.inject({ method: "GET", url: "/v1/snapshot" })).statusCode).toBe(401);
    const snapshot = await app.inject({ method: "GET", url: "/v1/snapshot", headers: authHeaders });
    expect(snapshot.statusCode).toBe(200);
    expect(snapshot.json().agents).toHaveLength(3);
    expect(snapshot.json().conversations).toHaveLength(4);

    const eventHistory = await app.inject({ method: "GET", url: "/v1/event-history?after=0&limit=10", headers: authHeaders });
    expect(eventHistory.statusCode).toBe(200);
    expect(Array.isArray(eventHistory.json())).toBe(true);
    expect((await app.inject({ method: "GET", url: "/v1/event-history?after=0" })).statusCode).toBe(401);

    const missingIdentity = await app.inject({
      method: "GET",
      url: "/v1/agents",
      headers: { authorization: "Bearer test-agent-token" },
    });
    expect(missingIdentity.statusCode).toBe(401);
  });

  it("registers and removes mobile push subscriptions", async () => {
    const { app, repository } = await setup();
    const token = "ExponentPushToken[test-device-token]";
    const registered = await app.inject({
      method: "PUT",
      url: "/v1/push-subscriptions",
      headers: authHeaders,
      payload: { token, platform: "ios" },
    });
    expect(registered.statusCode).toBe(204);
    expect(await repository.listPushSubscriptions("workspace-test")).toEqual([
      expect.objectContaining({ token, platform: "ios", workspaceId: "workspace-test" }),
    ]);

    const removed = await app.inject({
      method: "DELETE",
      url: "/v1/push-subscriptions",
      headers: authHeaders,
      payload: { token },
    });
    expect(removed.statusCode).toBe(204);
    expect(await repository.listPushSubscriptions("workspace-test")).toEqual([]);
  });

  it("allows agents to create, reconfigure, and delete agents, including themselves", async () => {
    const { app } = await setup();

    const created = await app.inject({
      method: "POST",
      url: "/v1/agents",
      headers: agentAuthHeaders,
      payload: { name: "Researcher", role: "Find evidence", capabilities: ["research"] },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ name: "Researcher", role: "Find evidence", capabilities: ["research"] });
    const createdAgentId = created.json().id as string;

    const updated = await app.inject({
      method: "PATCH",
      url: "/v1/agents/agent-builder",
      headers: agentAuthHeaders,
      payload: { role: "Lead builder", instructions: "Coordinate and implement the work." },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ id: "agent-builder", role: "Lead builder", instructions: "Coordinate and implement the work." });

    const deleted = await app.inject({ method: "DELETE", url: `/v1/agents/${createdAgentId}`, headers: agentAuthHeaders });
    expect(deleted.statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: `/v1/agents/${createdAgentId}`, headers: authHeaders })).statusCode).toBe(404);

    const eventHistory = await app.inject({ method: "GET", url: "/v1/event-history?after=0&limit=100", headers: authHeaders });
    const agentEvents = (eventHistory.json() as RelayEvent[]).filter((event) => ["agent.created", "agent.updated", "agent.deleted"].includes(event.type));
    expect(agentEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "agent.created", actorType: "agent", actorId: "agent-builder" }),
      expect.objectContaining({ type: "agent.updated", actorType: "agent", actorId: "agent-builder" }),
      expect.objectContaining({ type: "agent.deleted", actorType: "agent", actorId: "agent-builder" }),
    ]));
  });

  it("persists reusable personal information but rejects authentication secrets", async () => {
    const { app } = await setup();
    const saved = await app.inject({
      method: "PATCH",
      url: "/v1/profile",
      headers: { ...authHeaders, "x-relay-agent-id": "agent-builder" },
      payload: { values: { "Full name": "Test Person", city: "Madrid" } },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ updatedKeys: ["full_name", "city"], removedKeys: [] });

    const profile = await app.inject({ method: "GET", url: "/v1/profile", headers: authHeaders });
    expect(profile.json()).toEqual({ full_name: "Test Person", city: "Madrid" });

    const secret = await app.inject({
      method: "PATCH",
      url: "/v1/profile",
      headers: authHeaders,
      payload: { values: { verification_code: "123456" } },
    });
    expect(secret.statusCode).toBe(400);
    expect(secret.json().error.code).toBe("profile_secret_forbidden");
  });

  it("verifies and encrypts connector credentials without returning them", async () => {
    context = await createRelayApp({
      config: testConfig(),
      repository: new MemoryRelayRepository(),
      runtime: new MockAgentRuntime(0),
      startWorker: false,
      connectorFetcher: async (url, init) => {
        expect(init?.headers).toEqual(expect.objectContaining({ authorization: "Bearer github-test-token" }));
        expect(url).toBe("https://api.github.com/user");
        return new Response(JSON.stringify({ login: "relay-owner" }), { status: 200 });
      },
    });
    const connected = await context.app.inject({
      method: "PUT",
      url: "/v1/connectors/github",
      headers: authHeaders,
      payload: { secret: "github-test-token" },
    });
    expect(connected.statusCode).toBe(200);
    expect(connected.json()).toMatchObject({ provider: "github", connected: true, accountLabel: "@relay-owner" });
    expect(connected.body).not.toContain("github-test-token");
    const records = await context.repository.list("connectors", "workspace-test");
    expect(records).toHaveLength(1);
    expect(records[0]?.encryptedSecret).not.toContain("github-test-token");
    const listed = await context.app.inject({ method: "GET", url: "/v1/connectors", headers: authHeaders });
    expect(listed.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: "github", connected: true }),
      expect.objectContaining({ provider: "resend", connected: false }),
      expect.objectContaining({ provider: "notion", connected: false }),
      expect.objectContaining({ provider: "stripe", connected: false }),
      expect.objectContaining({ provider: "firebase", connected: false }),
    ]));
    expect((await context.app.inject({ method: "DELETE", url: "/v1/connectors/github", headers: authHeaders })).statusCode).toBe(204);
  });

  it("verifies Notion and Stripe credentials with their official APIs", async () => {
    context = await createRelayApp({
      config: testConfig(),
      repository: new MemoryRelayRepository(),
      runtime: new MockAgentRuntime(0),
      startWorker: false,
      connectorFetcher: async (url, init) => {
        const headers = init?.headers as Record<string, string> | undefined;
        if (url === "https://api.notion.com/v1/users/me") {
          expect(headers).toEqual(expect.objectContaining({
            authorization: "Bearer notion-test-token",
            "notion-version": "2026-03-11",
          }));
          return new Response(JSON.stringify({ name: "noudleAgents", bot: { workspace_name: "noudleAgents workspace" } }), { status: 200 });
        }
        expect(url).toBe("https://api.stripe.com/v1/balance");
        expect(headers?.authorization).toBe(`Basic ${Buffer.from("sk_test_relay:").toString("base64")}`);
        return new Response(JSON.stringify({ object: "balance", livemode: false }), { status: 200 });
      },
    });

    const notion = await context.app.inject({
      method: "PUT",
      url: "/v1/connectors/notion",
      headers: authHeaders,
      payload: { secret: "notion-test-token" },
    });
    expect(notion.statusCode).toBe(200);
    expect(notion.json()).toMatchObject({ provider: "notion", connected: true, accountLabel: "noudleAgents workspace" });

    const stripe = await context.app.inject({
      method: "PUT",
      url: "/v1/connectors/stripe",
      headers: authHeaders,
      payload: { secret: "sk_test_relay" },
    });
    expect(stripe.statusCode).toBe(200);
    expect(stripe.json()).toMatchObject({ provider: "stripe", connected: true, accountLabel: "Test account" });
    expect(stripe.body).not.toContain("sk_test_relay");

    const records = await context.repository.list("connectors", "workspace-test");
    expect(records).toHaveLength(2);
    expect(records.every((record) => !record.encryptedSecret.includes("test"))).toBe(true);
  });

  it("verifies Firebase refresh tokens and uses short-lived access tokens for requests", async () => {
    const refreshToken = "firebase-refresh-token";
    let tokenExchanges = 0;
    context = await createRelayApp({
      config: testConfig(),
      repository: new MemoryRelayRepository(),
      runtime: new MockAgentRuntime(0),
      startWorker: false,
      connectorFetcher: async (url, init) => {
        if (url === "https://oauth2.googleapis.com/token") {
          tokenExchanges += 1;
          expect(init?.method).toBe("POST");
          expect(init?.headers).toEqual({ "content-type": "application/x-www-form-urlencoded" });
          expect(String(init?.body)).toContain(`refresh_token=${refreshToken}`);
          return new Response(JSON.stringify({ access_token: `short-lived-${tokenExchanges}` }), { status: 200 });
        }
        const headers = init?.headers as Record<string, string> | undefined;
        expect(headers?.authorization).toBe(`Bearer short-lived-${tokenExchanges}`);
        if (url === "https://firebase.googleapis.com/v1beta1/projects?pageSize=1") {
          return new Response(JSON.stringify({ results: [{ projectId: "relay-firebase", displayName: "Relay Firebase" }] }), { status: 200 });
        }
        expect(url).toBe("https://firebase.googleapis.com/v1beta1/projects/relay-firebase");
        return new Response(JSON.stringify({ projectId: "relay-firebase" }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });

    const connected = await context.app.inject({
      method: "PUT",
      url: "/v1/connectors/firebase",
      headers: authHeaders,
      payload: { secret: refreshToken },
    });
    expect(connected.statusCode).toBe(200);
    expect(connected.json()).toMatchObject({ provider: "firebase", connected: true, accountLabel: "Relay Firebase" });
    expect(connected.body).not.toContain(refreshToken);

    const requested = await context.app.inject({
      method: "POST",
      url: "/v1/connectors/firebase/request",
      headers: authHeaders,
      payload: { method: "GET", path: "v1beta1/projects/relay-firebase", headers: {}, body: null },
    });
    expect(requested.statusCode).toBe(200);
    expect(requested.json()).toMatchObject({ status: 200, ok: true });
    expect(tokenExchanges).toBe(2);
  });

  it("lets an agent manage a connector without exposing its credential", async () => {
    context = await createRelayApp({
      config: testConfig(),
      repository: new MemoryRelayRepository(),
      runtime: new MockAgentRuntime(0),
      startWorker: false,
      connectorFetcher: async () => new Response(JSON.stringify({ data: [{ name: "relay.test" }] }), { status: 200 }),
    });
    const connected = await context.app.inject({
      method: "PUT",
      url: "/v1/connectors/resend",
      headers: agentAuthHeaders,
      payload: { secret: "re_agent_supplied_key" },
    });
    expect(connected.statusCode).toBe(200);
    expect(connected.json()).toMatchObject({ provider: "resend", connected: true, accountLabel: "relay.test" });
    expect(connected.body).not.toContain("re_agent_supplied_key");

    const disconnected = await context.app.inject({
      method: "DELETE",
      url: "/v1/connectors/resend",
      headers: agentAuthHeaders,
    });
    expect(disconnected.statusCode).toBe(204);
  });

  it("shares an agent-created custom connector with every agent without exposing its secret", async () => {
    const secret = "hostinger-workspace-secret";
    context = await createRelayApp({
      config: testConfig(),
      repository: new MemoryRelayRepository(),
      runtime: new MockAgentRuntime(0),
      startWorker: false,
      connectorFetcher: async (url, init) => {
        expect(url).toBe("https://api.hostinger.com/v1/servers");
        expect(init?.headers).toEqual(expect.objectContaining({ authorization: `Bearer ${secret}` }));
        expect(init?.redirect).toBe("manual");
        return new Response(JSON.stringify({ servers: [{ id: "srv_1" }] }), {
          status: 200,
          headers: { "content-type": "application/json", "x-ratelimit-remaining": "19" },
        });
      },
    });

    const created = await context.app.inject({
      method: "POST",
      url: "/v1/connectors",
      headers: agentAuthHeaders,
      payload: { name: "Hostinger", baseUrl: "https://api.hostinger.com/v1", authType: "bearer", secret },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ kind: "custom", name: "Hostinger", connected: true, createdByType: "agent", createdById: "agent-builder" });
    expect(created.body).not.toContain(secret);

    const listedByResearcher = await context.app.inject({
      method: "GET",
      url: "/v1/connectors",
      headers: { ...authHeaders, "x-relay-agent-id": "agent-researcher" },
    });
    expect(listedByResearcher.statusCode).toBe(200);
    expect(listedByResearcher.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: created.json().id, name: "Hostinger", createdById: "agent-builder" }),
    ]));
    expect(listedByResearcher.body).not.toContain(secret);

    const usedByResearcher = await context.app.inject({
      method: "POST",
      url: `/v1/connectors/${created.json().id}/request`,
      headers: { ...authHeaders, "x-relay-agent-id": "agent-researcher" },
      payload: { method: "GET", path: "/servers", headers: { accept: "application/json", authorization: "attempted-override" } },
    });
    expect(usedByResearcher.statusCode).toBe(200);
    expect(usedByResearcher.json()).toMatchObject({ status: 200, ok: true, headers: { "content-type": "application/json", "x-ratelimit-remaining": "19" } });
    expect(usedByResearcher.body).not.toContain(secret);

    const records = await context.repository.list("connectors", "workspace-test");
    expect(records[0]?.encryptedSecret).not.toContain(secret);
    expect(JSON.stringify(await context.repository.listEvents("workspace-test", 0))).not.toContain(secret);

    const escaped = await context.app.inject({
      method: "POST",
      url: `/v1/connectors/${created.json().id}/request`,
      headers: agentAuthHeaders,
      payload: { method: "GET", path: "https://attacker.example/collect" },
    });
    expect(escaped.statusCode).toBe(400);
    expect(escaped.json().error.code).toBe("connector_path_invalid");

    const privateConnector = await context.app.inject({
      method: "POST",
      url: "/v1/connectors",
      headers: agentAuthHeaders,
      payload: { name: "Unsafe", baseUrl: "https://127.0.0.1/", authType: "bearer", secret },
    });
    expect(privateConnector.statusCode).toBe(400);
    expect(privateConnector.json().error.code).toBe("connector_host_forbidden");
  });

  it("creates, updates, and deletes agents and conversations with live events", async () => {
    const { app, repository } = await setup();
    const agentResponse = await app.inject({
      method: "POST",
      url: "/v1/agents",
      headers: authHeaders,
      payload: { name: "Designer", role: "Product designer", capabilities: ["design", "review"] },
    });
    expect(agentResponse.statusCode).toBe(201);
    const agent = agentResponse.json();

    const conversation = await app.inject({
      method: "POST",
      url: "/v1/conversations",
      headers: authHeaders,
      payload: { kind: "direct", title: "Design", memberAgentIds: [agent.id] },
    });
    expect(conversation.statusCode).toBe(201);
    expect(conversation.json()).toMatchObject({ title: "Design", memberAgentIds: [agent.id] });

    const updated = await app.inject({
      method: "PATCH",
      url: `/v1/agents/${agent.id}`,
      headers: authHeaders,
      payload: { description: "Owns product interaction design." },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().description).toBe("Owns product interaction design.");

    const conversationUpdated = await app.inject({
      method: "PATCH",
      url: `/v1/conversations/${conversation.json().id}`,
      headers: authHeaders,
      payload: { title: "Product design" },
    });
    expect(conversationUpdated.json().title).toBe("Product design");
    expect((await app.inject({ method: "DELETE", url: `/v1/agents/${agent.id}`, headers: authHeaders })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: `/v1/conversations/${conversation.json().id}`, headers: authHeaders })).statusCode).toBe(404);
    expect((await repository.listEvents("workspace-test", 0)).map((event) => event.type)).toEqual(
      expect.arrayContaining(["conversation.updated", "conversation.deleted", "agent.deleted"]),
    );
  });

  it("deduplicates send-message requests and commits only one run", async () => {
    const { app, repository } = await setup();
    const payload = {
      content: "Build a compact settings screen",
      agentId: "agent-builder",
      clientOperationId: "operation-123",
      settings: { model: "gpt-5.6-terra", reasoning: "high", speed: "extra-fast" },
    };
    const first = await app.inject({
      method: "POST",
      url: "/v1/conversations/conversation-builder/messages",
      headers: { ...authHeaders, "idempotency-key": "operation-123" },
      payload,
    });
    const second = await app.inject({
      method: "POST",
      url: "/v1/conversations/conversation-builder/messages",
      headers: { ...authHeaders, "idempotency-key": "operation-123" },
      payload,
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect(await repository.list("messages", "workspace-test")).toHaveLength(1);
    expect(await repository.list("runs", "workspace-test")).toHaveLength(1);
    const job = await repository.claim("workspace-test", "test-worker", ["agent.run"]);
    expect(job?.payload.settings).toEqual(payload.settings);
    expect((await repository.listEvents("workspace-test", 0)).filter((event) => event.type === "run.created")).toHaveLength(1);
  });

  it("lets an agent create and configure its own recurring schedule", async () => {
    const { app, repository } = await setup();
    const created = await app.inject({
      method: "POST",
      url: "/v1/schedules",
      headers: agentAuthHeaders,
      payload: {
        agentId: "agent-researcher",
        title: "Five minute pulse",
        prompt: "Check the active task and report only new blockers.",
        cronExpression: "*/5 * * * *",
        timezone: "Europe/Amsterdam",
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      agentId: "agent-builder",
      conversationId: "conversation-builder",
      cronExpression: "*/5 * * * *",
      timezone: "Europe/Amsterdam",
      enabled: true,
      createdByType: "agent",
    });
    expect(created.json().nextRunAt).toBeTypeOf("string");

    const paused = await app.inject({
      method: "PATCH",
      url: `/v1/schedules/${created.json().id}`,
      headers: agentAuthHeaders,
      payload: { enabled: false },
    });
    expect(paused.json()).toMatchObject({ enabled: false, nextRunAt: null });
    expect((await app.inject({ method: "GET", url: "/v1/schedules", headers: authHeaders })).json()).toHaveLength(1);
    expect((await repository.listEvents("workspace-test", 0)).map((event) => event.type)).toEqual(expect.arrayContaining(["schedule.created", "schedule.updated"]));
    expect((await app.inject({ method: "DELETE", url: `/v1/schedules/${created.json().id}`, headers: agentAuthHeaders })).statusCode).toBe(204);
  });

  it("dispatches a due schedule into its agent conversation", async () => {
    const { service, repository, worker } = await setup();
    const schedule = await service.createSchedule({
      agentId: "agent-builder",
      title: "Scheduled check",
      prompt: "Inspect the queue and summarize it.",
      cronExpression: "*/5 * * * *",
      timezone: "UTC",
    });
    await repository.put("schedules", { ...schedule, nextRunAt: "2026-01-01T00:00:00.000Z" });

    expect(await worker.drainOnce()).toBe(true);
    expect(await worker.drainOnce()).toBe(true);

    const messages = await service.listMessages("conversation-builder");
    expect(messages.some((message) => message.role === "system" && message.content.includes("Inspect the queue"))).toBe(true);
    expect(messages.some((message) => message.role === "agent")).toBe(true);
    const updated = await service.getSchedule(schedule.id);
    expect(updated.latestRunId).toBeTypeOf("string");
    expect(updated.lastRunAt).toBe("2026-01-01T00:00:00.000Z");
    expect(updated.nextRunAt && updated.nextRunAt > new Date().toISOString()).toBe(true);
  });

  it("runs an agent from a token-protected webhook and honors the enabled toggle", async () => {
    const { app, service, worker } = await setup();
    const created = await app.inject({
      method: "POST",
      url: "/v1/schedules",
      headers: agentAuthHeaders,
      payload: {
        agentId: "agent-builder",
        triggerType: "webhook",
        title: "Issue intake",
        prompt: "Triage the incoming issue and report its priority.",
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ triggerType: "webhook", nextRunAt: null, enabled: true });
    expect(created.json().webhookToken).toHaveLength(32);
    const path = `/v1/webhooks/${created.json().id}/${created.json().webhookToken}`;

    const rejected = await app.inject({ method: "POST", url: `/v1/webhooks/${created.json().id}/${"x".repeat(32)}`, payload: { issue: "wrong token" } });
    expect(rejected.statusCode).toBe(404);

    const accepted = await app.inject({ method: "POST", url: path, payload: { issue: "Checkout is failing", severity: 2 } });
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json()).toMatchObject({ accepted: true });
    expect(await worker.drainOnce()).toBe(true);
    const messages = await service.listMessages("conversation-builder");
    expect(messages.some((message) => message.role === "system" && message.content.includes("Webhook-triggered task") && message.content.includes("Checkout is failing"))).toBe(true);
    expect(messages.some((message) => message.role === "agent")).toBe(true);

    const pauseResponse = await app.inject({ method: "PATCH", url: `/v1/schedules/${created.json().id}`, headers: agentAuthHeaders, payload: { enabled: false } });
    expect(pauseResponse.statusCode).toBe(200);
    expect(pauseResponse.json()).toMatchObject({ triggerType: "webhook", webhookToken: created.json().webhookToken, enabled: false });
    const paused = await app.inject({ method: "POST", url: path, payload: { issue: "Should not run" } });
    expect(paused.statusCode).toBe(409);
    expect(paused.json().error.code).toBe("webhook_disabled");
  });

  it("clears a direct chat, interrupts its run, and resets the Codex thread", async () => {
    const { app, repository, service } = await setup();
    await service.updateAgent("agent-builder", { codexThreadId: "thread-before-clear" });
    const sent = await app.inject({
      method: "POST",
      url: "/v1/conversations/conversation-builder/messages",
      headers: authHeaders,
      payload: {
        content: "Keep this out of the fresh chat",
        agentId: "agent-builder",
        clientOperationId: "clear-operation",
      },
    });
    const cleared = await app.inject({
      method: "POST",
      url: "/v1/conversations/conversation-builder/clear",
      headers: authHeaders,
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json()).toMatchObject({ kind: "direct", memberAgentIds: ["agent-builder"], lastMessageAt: null });
    expect(cleared.json().id).not.toBe("conversation-builder");
    expect((await app.inject({ method: "GET", url: "/v1/conversations/conversation-builder", headers: authHeaders })).statusCode).toBe(404);
    expect(await repository.list("messages", "workspace-test")).toHaveLength(0);
    expect((await repository.get("runs", sent.json().runId))?.status).toBe("interrupted");
    expect((await service.getAgent("agent-builder")).codexThreadId).toBeNull();
  });

  it("runs the mock adapter, streams realistic events, and demonstrates agent delegation", async () => {
    const { app, repository, worker } = await setup();
    const response = await app.inject({
      method: "POST",
      url: "/v1/conversations/conversation-builder/messages",
      headers: authHeaders,
      payload: {
        content: "Delegate research about the safest container setup",
        agentId: "agent-builder",
        clientOperationId: "delegate-operation",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(await worker.drainOnce()).toBe(true);

    const run = await repository.get("runs", response.json().runId as string);
    expect(run?.status).toBe("completed");
    const messages = (await repository.list("messages", "workspace-test")) as Message[];
    expect(messages.some((message) => message.role === "agent" && message.content.includes("Delegated"))).toBe(true);
    const agentResponse = messages.find((message) => message.role === "agent");
    expect(agentResponse?.responseParts).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "tool", toolType: "mcpToolCall", status: "completed" }),
      expect.objectContaining({ type: "text" }),
    ]));
    const tasks = await repository.list("tasks", "workspace-test");
    expect(tasks).toHaveLength(2);
    expect(tasks.find((task) => task.parentTaskId !== null)?.ownerAgentId).toBe("agent-researcher");
    const eventTypes = (await repository.listEvents("workspace-test", 0)).map((event) => event.type);
    expect(eventTypes).toEqual(expect.arrayContaining(["run.started", "tool.started", "message.delta", "task.delegated", "run.completed"]));
    const toolEvent = (await repository.listEvents("workspace-test", 0)).find((event) => event.type === "tool.completed");
    expect(toolEvent?.payload.part).toMatchObject({ type: "tool", status: "completed" });
  });

  it("supports attributed Codex agent collaboration, blocking, and evidence-bearing completion", async () => {
    const { app, repository } = await setup();
    const created = await app.inject({
      method: "POST",
      url: "/v1/tasks",
      headers: { ...authHeaders, "x-relay-agent-id": "agent-builder" },
      payload: { title: "Collaborative task", objective: "Produce and verify an implementation", ownerAgentId: "agent-builder" },
    });
    expect(created.statusCode).toBe(201);
    const taskId = created.json().id as string;

    const message = await app.inject({
      method: "POST",
      url: "/v1/collaboration/messages",
      headers: { ...authHeaders, "x-relay-agent-id": "agent-builder" },
      payload: { agentId: "agent-researcher", taskId, message: "Check the security assumptions", contextRefs: [taskId] },
    });
    expect(message.statusCode).toBe(200);
    expect(message.json()).toMatchObject({ role: "agent", authorId: "agent-builder", content: "Check the security assumptions" });

    const blocked = await app.inject({
      method: "POST",
      url: `/v1/tasks/${taskId}/block`,
      headers: { ...authHeaders, "x-relay-agent-id": "agent-researcher" },
      payload: { blocker: "Owner decision required", needsUser: true },
    });
    expect(blocked.json()).toMatchObject({ status: "waiting_user", blocker: "Owner decision required" });

    const completed = await app.inject({
      method: "POST",
      url: `/v1/tasks/${taskId}/complete`,
      headers: { ...authHeaders, "x-relay-agent-id": "agent-builder" },
      payload: { summary: "Verified and complete", artifactIds: ["artifact-1"], evidenceRefs: ["test-output"] },
    });
    expect(completed.json()).toMatchObject({ status: "completed", resultSummary: "Verified and complete", blocker: null });
    const events = await repository.listEvents("workspace-test", 0);
    expect(events.find((event) => event.type === "message.created" && event.actorId === "agent-builder")?.payload).toMatchObject({
      targetAgentId: "agent-researcher",
      contextRefs: [taskId],
    });
    expect(events.find((event) => event.type === "task.completed")?.payload).toMatchObject({
      artifactIds: ["artifact-1"],
      evidenceRefs: ["test-output"],
    });
  });

  it("turns a teammate information request into an attributed child task and active agent run", async () => {
    const { app, repository, worker } = await setup();
    const parent = await app.inject({
      method: "POST",
      url: "/v1/tasks",
      headers: { ...authHeaders, "x-relay-agent-id": "agent-builder" },
      payload: { title: "Ship shared workspace", objective: "Coordinate the team workspace", ownerAgentId: "agent-builder" },
    });
    const taskId = parent.json().id as string;

    const requested = await app.inject({
      method: "POST",
      url: "/v1/collaboration/requests",
      headers: { ...authHeaders, "x-relay-agent-id": "agent-builder" },
      payload: {
        agentId: "agent-researcher",
        taskId,
        request: "Summarize the storage notes and identify the source file.",
        paths: ["/workspace/team/storage-notes.md"],
      },
    });
    expect(requested.statusCode).toBe(201);
    expect(requested.json().task).toMatchObject({ parentTaskId: taskId, ownerAgentId: "agent-researcher", status: "accepted" });
    expect(requested.json().requestMessage).toMatchObject({ role: "agent", authorId: "agent-builder" });
    expect(requested.json().requestMessage.content).toContain("/workspace/team/storage-notes.md");

    const queuedRun = await repository.get("runs", requested.json().runId as string);
    expect(queuedRun).toMatchObject({ agentId: "agent-researcher", taskId: requested.json().task.id, status: "queued" });
    expect(await worker.drainOnce()).toBe(true);
    expect((await repository.get("runs", requested.json().runId as string))?.status).toBe("completed");
    expect((await repository.get("tasks", requested.json().task.id as string))?.status).toBe("completed");

    const handoff = await app.inject({
      method: "GET",
      url: `/v1/collaboration/requests/${requested.json().task.id}`,
      headers: { ...authHeaders, "x-relay-agent-id": "agent-builder" },
    });
    expect(handoff.statusCode).toBe(200);
    expect(handoff.json().task).toMatchObject({ status: "completed", ownerAgentId: "agent-researcher" });
    expect(handoff.json().runs).toEqual(expect.arrayContaining([expect.objectContaining({ status: "completed" })]));
    expect(handoff.json().messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ authorId: "agent-builder" }),
      expect.objectContaining({ authorId: "agent-researcher" }),
    ]));

    const events = await repository.listEvents("workspace-test", 0);
    expect(events.find((event) => event.type === "run.created" && event.aggregateId === requested.json().runId)?.payload).toMatchObject({
      requestedByAgentId: "agent-builder",
    });
  });

  it("replays stored events over SSE from the requested cursor", async () => {
    const { app, service } = await setup();
    await service.createAgent({ name: "Auditor", role: "Quality auditor" });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP address");
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/events?after=0&token=test-owner-token`, {
      headers: { origin: "http://localhost:5173" },
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(response.headers.get("vary")).toContain("Origin");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Expected SSE response body");
    const chunk = await reader.read();
    controller.abort();
    const text = new TextDecoder().decode(chunk.value);
    const dataLine = text.split("\n").find((line) => line.startsWith("data: "));
    expect(dataLine).toBeDefined();
    const event = JSON.parse(dataLine!.slice(6)) as RelayEvent;
    expect(event.type).toBe("agent.created");
    expect(event.cursor).toBeGreaterThan(0);
  });
});
