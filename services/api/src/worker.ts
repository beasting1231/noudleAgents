import { randomUUID } from "node:crypto";
import { AgentSchema, ComposerSettingsSchema, MessageSchema, RunSchema, type Agent, type Run, type Task } from "@noudle-agents/protocol";
import type { RelayConfig } from "./config.js";
import type { RelayRepository } from "./database/repository.js";
import { RelayService } from "./domain/relay-service.js";
import type { QueueJob } from "./model.js";
import type { AgentRuntime, RuntimeEvent } from "./runtime/runtime.js";

export class RunWorker {
  private readonly workerId = `worker_${randomUUID()}`;
  private readonly controllers = new Map<string, AbortController>();
  private readonly active = new Set<Promise<void>>();
  private timer: NodeJS.Timeout | null = null;
  private polling = false;

  constructor(
    private readonly repository: RelayRepository,
    private readonly service: RelayService,
    private readonly runtime: AgentRuntime,
    private readonly config: RelayConfig,
  ) {
    service.setInterruptHandler((runId) => this.interrupt(runId));
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.poll(), this.config.workerPollMs);
    this.timer.unref();
    void this.poll();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const controller of this.controllers.values()) controller.abort(new Error("Worker stopped"));
    await Promise.allSettled([...this.active]);
  }

  interrupt(runId: string): boolean {
    const controller = this.controllers.get(runId);
    if (!controller) return false;
    controller.abort(new Error("Run interrupted"));
    return true;
  }

  async drainOnce(): Promise<boolean> {
    const job = await this.repository.claim(this.config.workspaceId, this.workerId, ["agent.run"]);
    if (!job) return false;
    await this.process(job);
    return true;
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      while (this.active.size < this.config.maxConcurrentRuns) {
        const job = await this.repository.claim(this.config.workspaceId, this.workerId, ["agent.run"]);
        if (!job) break;
        let processPromise: Promise<void>;
        processPromise = this.process(job).finally(() => this.active.delete(processPromise));
        this.active.add(processPromise);
      }
    } finally {
      this.polling = false;
    }
  }

  private async setAgentRunning(agent: Agent, taskId: string | null): Promise<Agent> {
    const updated = AgentSchema.parse({
      ...agent,
      status: "working",
      currentTaskId: taskId,
      updatedAt: new Date().toISOString(),
    });
    await this.repository.put("agents", updated);
    await this.service.emit({
      workspaceId: updated.workspaceId,
      aggregateType: "agent",
      aggregateId: updated.id,
      type: "agent.status_changed",
      actorType: "system",
      actorId: null,
      payload: { agent: updated, previousStatus: agent.status },
    });
    return updated;
  }

  private async setAgentIdle(agent: Agent): Promise<void> {
    const updated = AgentSchema.parse({
      ...agent,
      status: "idle",
      currentTaskId: null,
      updatedAt: new Date().toISOString(),
    });
    await this.repository.put("agents", updated);
    await this.service.emit({
      workspaceId: updated.workspaceId,
      aggregateType: "agent",
      aggregateId: updated.id,
      type: "agent.status_changed",
      actorType: "system",
      actorId: null,
      payload: { agent: updated, previousStatus: agent.status },
    });
  }

  private async emitRuntime(run: Run, agent: Agent, event: RuntimeEvent): Promise<void> {
    await this.service.emit({
      workspaceId: run.workspaceId,
      aggregateType: "run",
      aggregateId: run.id,
      type: event.type,
      actorType: "agent",
      actorId: agent.id,
      payload: event.payload,
    });
  }

  private async process(job: QueueJob): Promise<void> {
    const runId = typeof job.payload.runId === "string" ? job.payload.runId : null;
    if (!runId) {
      await this.repository.failJob(job.id, "Job has no runId", null);
      return;
    }
    let run = await this.repository.get("runs", runId);
    if (!run || run.status === "interrupted") {
      await this.repository.completeJob(job.id);
      return;
    }
    const [agent, trigger, task] = await Promise.all([
      this.repository.get("agents", run.agentId),
      run.triggerMessageId ? this.repository.get("messages", run.triggerMessageId) : Promise.resolve(null),
      run.taskId ? this.repository.get("tasks", run.taskId) : Promise.resolve(null),
    ]);
    if (!agent || !trigger) {
      await this.repository.failJob(job.id, "Run references missing agent or trigger message", null);
      return;
    }

    const controller = new AbortController();
    const settingsResult = ComposerSettingsSchema.safeParse(job.payload.settings);
    const settings = settingsResult.success ? settingsResult.data : undefined;
    this.controllers.set(run.id, controller);
    let activeAgent = agent;
    try {
      const startedAt = new Date().toISOString();
      run = RunSchema.parse({ ...run, status: "running", startedAt, updatedAt: startedAt });
      await this.repository.put("runs", run);
      await this.service.emit({
        workspaceId: run.workspaceId,
        aggregateType: "run",
        aggregateId: run.id,
        type: "run.started",
        actorType: "agent",
        actorId: agent.id,
        payload: { run, runtime: this.runtime.name },
      });
      activeAgent = await this.setAgentRunning(agent, run.taskId);

      const result = await this.runtime.execute(
        { run, agent: activeAgent, trigger, task, settings },
        controller.signal,
        (event) => this.emitRuntime(run!, activeAgent, event),
      );

      let parentTask: Task | null = task;
      let delegatedTask: Task | null = null;
      if (result.suggestedDelegation) {
        parentTask ??= await this.service.createTask(
          {
            title: `Handle: ${trigger.content.slice(0, 80)}`,
            objective: trigger.content,
            ownerAgentId: activeAgent.id,
            conversationId: run.conversationId,
          },
          "agent",
          activeAgent.id,
        );
        delegatedTask = await this.service.createDelegatedChild(
          parentTask,
          activeAgent,
          result.suggestedDelegation.role,
          result.suggestedDelegation.title,
          result.suggestedDelegation.objective,
        );
        if (delegatedTask) {
          await this.service.updateTask(parentTask.id, {
            status: "waiting_agent",
            resultSummary: `Delegated ${delegatedTask.title} to ${delegatedTask.ownerAgentId}`,
          });
        }
      } else if (parentTask) {
        await this.service.updateTask(parentTask.id, { status: "completed", resultSummary: result.summary });
      }

      const now = new Date().toISOString();
      const suffix = delegatedTask ? `\n\nDelegated “${delegatedTask.title}” to another agent.` : "";
      const response = MessageSchema.parse({
        id: `msg_${randomUUID()}`,
        workspaceId: run.workspaceId,
        conversationId: run.conversationId,
        role: "agent",
        authorId: activeAgent.id,
        content: `${result.content}${suffix}`,
        replyToMessageId: trigger.id,
        clientOperationId: null,
        createdAt: now,
      });
      await this.repository.put("messages", response);
      await this.service.emit({
        workspaceId: response.workspaceId,
        aggregateType: "message",
        aggregateId: response.id,
        type: "message.created",
        actorType: "agent",
        actorId: activeAgent.id,
        payload: { message: response },
      });
      const conversation = await this.repository.get("conversations", run.conversationId);
      if (conversation) await this.repository.put("conversations", { ...conversation, lastMessageAt: now, updatedAt: now });

      const completed = RunSchema.parse({ ...run, status: "completed", completedAt: now, updatedAt: now });
      await this.repository.put("runs", completed);
      await this.service.emit({
        workspaceId: run.workspaceId,
        aggregateType: "run",
        aggregateId: run.id,
        type: "run.completed",
        actorType: "agent",
        actorId: activeAgent.id,
        payload: { run: completed, summary: result.summary },
      });
      await this.setAgentIdle(activeAgent);
      await this.repository.completeJob(job.id);
    } catch (error) {
      const latest = await this.repository.get("runs", run.id);
      if (controller.signal.aborted || latest?.status === "interrupted") {
        await this.repository.completeJob(job.id);
      } else {
        const now = new Date().toISOString();
        const failed = RunSchema.parse({ ...run, status: "failed", error: String(error), completedAt: now, updatedAt: now });
        await this.repository.put("runs", failed);
        await this.service.emit({
          workspaceId: run.workspaceId,
          aggregateType: "run",
          aggregateId: run.id,
          type: "run.failed",
          actorType: "system",
          actorId: null,
          payload: { run: failed, error: String(error) },
        });
        await this.setAgentIdle(activeAgent);
        await this.repository.failJob(job.id, String(error), job.attempts < 3 ? new Date(Date.now() + 250 * 2 ** job.attempts).toISOString() : null);
      }
    } finally {
      this.controllers.delete(run.id);
    }
  }
}
