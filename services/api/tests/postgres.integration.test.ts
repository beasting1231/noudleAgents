import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createRelayApp } from "../src/app.js";
import { PostgresRelayRepository } from "../src/database/postgres-repository.js";
import { MockAgentRuntime } from "../src/runtime/mock-runtime.js";
import { testConfig } from "./helpers.js";
import { FakeSandboxManager } from "./fake-sandbox-manager.js";

const connectionString = process.env.RELAY_TEST_DATABASE_URL;

describe.skipIf(!connectionString)("PostgreSQL integration", () => {
  it("migrates and persists workspace state across repository instances", async () => {
    const workspaceId = `test-${randomUUID()}`;
    const now = new Date().toISOString();
    const first = new PostgresRelayRepository(connectionString!);
    await first.initialize();
    await first.putWorkspace({ id: workspaceId, name: "Persistence test", ownerId: "test", profile: {}, createdAt: now, updatedAt: now });
    await first.close();

    const second = new PostgresRelayRepository(connectionString!);
    await second.initialize();
    expect(await second.getWorkspace(workspaceId)).toMatchObject({ id: workspaceId, name: "Persistence test" });
    await second.pool.query("DELETE FROM workspaces WHERE id=$1", [workspaceId]);
    await second.close();
  });

  it("atomically queues and executes a run with durable events", async () => {
    const workspaceId = `test-${randomUUID()}`;
    const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), "relay-postgres-artifacts-"));
    const repository = new PostgresRelayRepository(connectionString!);
    await repository.initialize();
    const context = await createRelayApp({
      config: testConfig({ workspaceId, storagePath }),
      repository,
      runtime: new MockAgentRuntime(0),
      sandboxManager: new FakeSandboxManager(),
      startWorker: false,
    });
    try {
      const builder = (await context.service.listAgents()).find((agent) => agent.name === "Builder")!;
      const builderConversation = (await context.service.listConversations()).find(
        (conversation) => conversation.kind === "direct" && conversation.memberAgentIds.includes(builder.id),
      )!;
      const response = await context.app.inject({
        method: "POST",
        url: `/v1/conversations/${builderConversation.id}/messages`,
        headers: { authorization: "Bearer test-owner-token", "idempotency-key": "postgres-operation" },
        payload: { content: "Verify PostgreSQL execution", agentId: builder.id, clientOperationId: "postgres-operation" },
      });
      expect(response.statusCode).toBe(200);
      expect(await context.worker.drainOnce()).toBe(true);
      expect((await repository.get("runs", response.json().runId as string))?.status).toBe("completed");
      expect((await repository.listEvents(workspaceId, 0)).map((event) => event.type)).toContain("run.completed");

      const staged = await context.artifacts.stage(Readable.from([Buffer.from("postgres artifact")]));
      const artifact = await context.artifacts.create(staged, {
        name: "postgres.txt",
        originalName: "postgres.txt",
        mimeType: "text/plain",
        taskId: null,
        runId: null,
        agentId: null,
        parentArtifactId: null,
        source: "user_upload",
        metadata: { database: true },
        actorType: "user",
        actorId: "owner-test",
      });
      expect((await repository.get("artifacts", artifact.id))?.checksum).toBe(artifact.checksum);

      const computer = await context.app.inject({
        method: "POST",
        url: "/v1/computers",
        headers: { authorization: "Bearer test-owner-token" },
        payload: { browser: false },
      });
      expect(computer.statusCode).toBe(201);
      expect((await repository.get("computers", computer.json().id as string))?.status).toBe("running");
    } finally {
      await repository.pool.query("DELETE FROM workspaces WHERE id=$1", [workspaceId]).catch(() => undefined);
      await context.app.close();
      await fs.rm(storagePath, { recursive: true, force: true });
    }
  });
});
