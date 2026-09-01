import { describe, expect, it } from "vitest";
import { createMemoryState, MemoryRelayRepository } from "../src/database/memory-repository.js";
import { RelayService } from "../src/domain/relay-service.js";
import { EventHub } from "../src/events.js";
import { testConfig } from "./helpers.js";

async function serviceWith(repository: MemoryRelayRepository, maxDelegationDepth = 6): Promise<RelayService> {
  await repository.initialize();
  const service = new RelayService(repository, testConfig({ maxDelegationDepth }), new EventHub());
  await service.initialize();
  return service;
}

describe("noudleAgents domain", () => {
  it("scopes deterministic seed ids outside the local test workspace", async () => {
    const repository = new MemoryRelayRepository();
    await repository.initialize();
    const first = new RelayService(repository, testConfig({ workspaceId: "workspace-alpha" }), new EventHub());
    const second = new RelayService(repository, testConfig({ workspaceId: "workspace-beta" }), new EventHub());
    await first.initialize();
    await second.initialize();

    const firstIds = new Set((await first.listAgents()).map((agent) => agent.id));
    const secondIds = (await second.listAgents()).map((agent) => agent.id);
    expect(secondIds).toHaveLength(3);
    expect(secondIds.every((id) => !firstIds.has(id))).toBe(true);
  });

  it("never lets a worker claim another workspace's queue job", async () => {
    const repository = new MemoryRelayRepository();
    await serviceWith(repository);
    const now = new Date().toISOString();
    await repository.enqueue({
      id: "foreign-job",
      workspaceId: "workspace-foreign",
      kind: "agent.run",
      payload: { runId: "foreign-run" },
      status: "queued",
      attempts: 0,
      availableAt: now,
      lockedAt: null,
      lockedBy: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    });

    expect(await repository.claim("workspace-test", "worker-local", ["agent.run"])).toBeNull();
    expect(await repository.claim("workspace-foreign", "worker-foreign", ["agent.run"])).toMatchObject({ id: "foreign-job" });
  });

  it("preserves state when a repository is reopened over durable state", async () => {
    const state = createMemoryState();
    const firstRepository = new MemoryRelayRepository(state);
    const first = await serviceWith(firstRepository);
    const created = await first.createAgent({ name: "Persistent", role: "State verifier" });
    await firstRepository.close();

    const secondRepository = new MemoryRelayRepository(state);
    const second = await serviceWith(secondRepository);
    expect((await second.getAgent(created.id)).name).toBe("Persistent");
    expect((await secondRepository.listEvents("workspace-test", 0)).some((event) => event.aggregateId === created.id)).toBe(true);
  });

  it("enforces parent fanout", async () => {
    const service = await serviceWith(new MemoryRelayRepository());
    const parent = await service.createTask({
      title: "Parent",
      objective: "Coordinate bounded work",
      budget: { maxTokens: 1000, maxWallSeconds: 60, maxChildTasks: 1 },
    });
    await service.createTask({ title: "Child one", objective: "First child", parentTaskId: parent.id });
    await expect(service.createTask({ title: "Child two", objective: "Second child", parentTaskId: parent.id })).rejects.toMatchObject({
      code: "task_fanout_limit",
    });
  });

  it("enforces delegation depth and prevents parent cycles", async () => {
    const service = await serviceWith(new MemoryRelayRepository(), 2);
    const root = await service.createTask({ title: "Root", objective: "Root objective" });
    const child = await service.createTask({ title: "Child", objective: "Child objective", parentTaskId: root.id });
    const grandchild = await service.createTask({ title: "Grandchild", objective: "Grandchild objective", parentTaskId: child.id });
    await expect(
      service.createTask({ title: "Too deep", objective: "Exceeds configured depth", parentTaskId: grandchild.id }),
    ).rejects.toMatchObject({ code: "task_depth_limit" });
    await expect(service.updateTask(root.id, { parentTaskId: grandchild.id })).rejects.toMatchObject({ code: "task_cycle" });
  });

  it("transfers task ownership and records a delegation event", async () => {
    const repository = new MemoryRelayRepository();
    const service = await serviceWith(repository);
    const task = await service.createTask({ title: "Investigate", objective: "Find evidence", ownerAgentId: "agent-builder" });
    const cursor = await repository.currentCursor("workspace-test");
    const delegated = await service.delegateTask(task.id, {
      agentId: "agent-researcher",
      message: "Use primary sources",
      contextRefs: [task.id],
    });
    expect(delegated.ownerAgentId).toBe("agent-researcher");
    const replay = await repository.listEvents("workspace-test", cursor);
    expect(replay).toHaveLength(1);
    expect(replay[0]).toMatchObject({ type: "task.delegated", sequence: 2 });
  });
});
