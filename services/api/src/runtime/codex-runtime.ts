import { createHash } from "node:crypto";
import { AgentSchema, ApprovalSchema, RunSchema, type Approval, type MessageResponsePart } from "@noudle-agents/protocol";
import type { RelayConfig } from "../config.js";
import type { RelayRepository } from "../database/repository.js";
import type { AgentRuntime, RuntimeContext, RuntimeEvent, RuntimeResult } from "./runtime.js";

interface WorkerEvent {
  cursor: number;
  type: string;
  threadId: string | null;
  turnId: string | null;
  payload: unknown;
}

interface WorkerApproval {
  id: string;
  method: string;
  params: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function approvalRisk(method: string): Approval["risk"] {
  if (/fileChange|applyPatch/i.test(method)) return "overwrite";
  if (/permission/i.test(method)) return "permission";
  return "custom";
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("Codex run interrupted");
}

function safeRuntimeItem(value: unknown): unknown {
  const item = asRecord(value);
  let serialized = "";
  try { serialized = JSON.stringify(item); } catch { return item; }
  if (!serialized.includes("connect_connector") && !serialized.includes("create_connector")) return item;
  return {
    type: item.type,
    server: item.server,
    tool: item.tool ?? item.name,
    status: item.status,
    arguments: "[credential redacted]",
  };
}

function clippedString(value: unknown, limit = 100_000): string | null {
  return typeof value === "string" ? value.slice(0, limit) : null;
}

function responseToolPart(value: unknown, fallbackId: string, running: boolean): Extract<MessageResponsePart, { type: "tool" }> {
  const item = asRecord(safeRuntimeItem(value));
  const toolType = typeof item.type === "string" ? item.type : "tool";
  const id = typeof item.id === "string" ? item.id : fallbackId;
  const rawStatus = typeof item.status === "string" ? item.status.toLowerCase() : "";
  const status = running || rawStatus.includes("progress") || rawStatus === "running"
    ? "running"
    : rawStatus.includes("fail") || rawStatus.includes("declin") || item.error
      ? "failed"
      : "completed";
  let data: Record<string, unknown>;
  if (toolType === "commandExecution") {
    data = {
      command: clippedString(item.command, 20_000), cwd: clippedString(item.cwd, 4_000),
      output: clippedString(item.aggregatedOutput), exitCode: item.exitCode, durationMs: item.durationMs,
    };
  } else if (toolType === "fileChange") {
    data = { changes: Array.isArray(item.changes) ? item.changes.slice(0, 100) : [], patchStatus: item.status };
  } else if (toolType === "mcpToolCall" || toolType === "dynamicToolCall") {
    data = {
      server: item.server ?? item.namespace, tool: item.tool, arguments: item.arguments,
      result: item.result ?? item.contentItems, error: item.error, durationMs: item.durationMs, appContext: item.appContext,
    };
  } else if (toolType === "webSearch") {
    data = { query: item.query, action: item.action };
  } else if (toolType === "imageView") {
    data = { path: item.path };
  } else if (toolType === "reasoning" || toolType === "plan") {
    data = { summary: item.summary, text: item.text };
  } else {
    data = Object.fromEntries(Object.entries(item).filter(([key]) => !["id", "type", "status"].includes(key)));
  }
  return { type: "tool", id, toolType, status, data };
}

function agentDeveloperInstructions(context: RuntimeContext): string {
  return [
    `You are ${context.agent.name}, the ${context.agent.role} agent in noudleAgents.`,
    context.agent.description,
    context.agent.instructions,
    "You are one member of a collaborating agent team. Use the relay_collaboration MCP tools to inspect peers, create or reconfigure agents, delegate bounded tasks, report blockers, and share results when that improves the outcome.",
    "The team shares one trusted filesystem and one visible browser computer. Your normal working directory is /workspace/agents/<your-agent-id>. Team projects live in /workspace/projects and reusable team references live in /workspace/team. Every agent can access the full /workspace tree and operates the same shared browser computer.",
    "Keep drafts and temporary work in your own agent directory. Put canonical project files in /workspace/projects/<project-name>. You may read another agent's directory when needed, but do not overwrite their active work without coordinating. Use request_agent_help when another agent's context or unfinished work is needed, and include exact file paths in handoffs.",
    "When the user asks you to do something repeatedly or at a future recurring time, translate their timing into a five-field cron expression and use create_schedule. When they ask for an automation triggered by an incoming webhook, use create_webhook_job and return its private webhook URL. Use list_schedules, update_schedule, or delete_schedule when they ask to inspect or change existing jobs. Confirm the trigger after a successful tool call.",
    "You have full agent-management access. You may create, inspect, edit, duplicate, delete, or reconfigure any agent, including yourself, when requested by the user or when it is useful to complete the team's work. Use the relay_collaboration agent tools instead of calling private endpoints. Preserve active work, and do not delete an agent unless the user explicitly asks or deletion is clearly required by the task.",
    "Work only inside your assigned noudleAgents workspace. Be concise and evidence-driven.",
  ].filter(Boolean).join("\n\n");
}

export class CodexAgentRuntime implements AgentRuntime {
  readonly name = "codex-app-server";

  constructor(
    private readonly repository: RelayRepository,
    private readonly config: RelayConfig,
  ) {}

  async execute(
    context: RuntimeContext,
    signal: AbortSignal,
    emit: (event: RuntimeEvent) => Promise<void>,
  ): Promise<RuntimeResult> {
    const threadId = await this.ensureThread(context);
    const turn = await this.request<{ turnId: string }>(`/v1/threads/${encodeURIComponent(threadId)}/turns`, {
      method: "POST",
      body: JSON.stringify({
        text: this.buildPrompt(context),
        cwd: `${this.config.agentWorkspaceRoot}/${context.agent.id}`,
        clientUserMessageId: context.trigger.id,
        model: context.settings?.model,
        effort: context.settings?.reasoning,
        speed: context.settings?.speed,
      }),
    });
    context.run.codexTurnId = turn.turnId;
    await this.repository.put("runs", RunSchema.parse({ ...context.run, codexTurnId: turn.turnId, updatedAt: new Date().toISOString() }));

    const onAbort = (): void => {
      void this.request(`/v1/threads/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(turn.turnId)}/interrupt`, {
        method: "POST",
      }).catch(() => undefined);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      return await this.consumeTurn(context, threadId, turn.turnId, signal, emit);
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }

  private async ensureThread(context: RuntimeContext): Promise<string> {
    const cwd = `${this.config.agentWorkspaceRoot}/${context.agent.id}`;
    const developerInstructions = agentDeveloperInstructions(context);
    if (context.agent.codexThreadId) {
      try {
        const resumed = await this.request<{ threadId: string }>(
          `/v1/threads/${encodeURIComponent(context.agent.codexThreadId)}/resume`,
          { method: "POST", body: JSON.stringify({
            cwd,
            agentId: context.agent.id,
            model: context.settings?.model,
            speed: context.settings?.speed,
            developerInstructions,
          }) },
        );
        return resumed.threadId;
      } catch {
        // A worker or CODEX_HOME can be replaced. Start a fresh durable thread and
        // update the control plane instead of leaving the agent unusable.
      }
    }
    const started = await this.request<{ threadId: string }>("/v1/threads/start", {
      method: "POST",
      body: JSON.stringify({
        cwd,
        agentId: context.agent.id,
        model: context.settings?.model,
        speed: context.settings?.speed,
        developerInstructions,
      }),
    });
    context.agent.codexThreadId = started.threadId;
    await this.repository.put("agents", AgentSchema.parse({
      ...context.agent,
      codexThreadId: started.threadId,
      updatedAt: new Date().toISOString(),
    }));
    return started.threadId;
  }

  private buildPrompt(context: RuntimeContext): string {
    const task = context.task
      ? `\n\nActive task: ${context.task.title}\nObjective: ${context.task.objective}\nAcceptance criteria:\n${context.task.acceptanceCriteria.map((item) => `- ${item}`).join("\n") || "- Complete the stated objective."}`
      : "";
    const computerGuidance = [
      "You have full agent-management access. You may create, inspect, edit, duplicate, delete, or reconfigure any agent, including yourself, using the relay_collaboration agent tools. Preserve active work, and only delete an agent when the user explicitly asks or deletion is clearly required by the task.",
      `You are part of the noudleAgents team. Your working directory is /workspace/${this.config.agentWorkspaceRoot}/${context.agent.id}. All agents share /workspace: use /workspace/projects for canonical project work, /workspace/team for shared references and policies, and /workspace/${this.config.agentWorkspaceRoot}/<agent-id> for agent-specific drafts. All agents also operate the same shared browser computer and browser profile.`,
      "Before starting substantial work, inspect the active task and relevant project directory. Keep project status and durable decisions in the project's shared files rather than only in chat. You may read a teammate's directory when needed; coordinate before modifying their active files. If you need a teammate's explanation, work-in-progress, or unpublished files, use request_agent_help with the relevant task and paths.",
      "When the user asks you to use the visible noudleAgents computer, operate it directly with the relay_collaboration computer tools. Start with computer_screenshot, then use computer_click, computer_type, computer_key, computer_scroll, computer_move, or computer_drag and inspect the returned screenshot after every action. Use browser_navigate only when direct URL navigation is helpful. The VM is remote; never try xdg-open, open, or a local desktop launcher.",
      "Continue autonomously through forms, account flows, personal-information fields, and verification steps. Personal information is not itself a blocker: first use get_user_profile and browser autofill, fill every known field, and ask only for a specific missing value. Never invent an unknown personal fact. When the user explicitly supplies stable reusable information, save it with remember_user_info and resume the same workflow immediately.",
      "Use passwords and other login secrets through the browser password manager or user takeover. Never save or repeat passwords, PINs, one-time codes, CAPTCHA answers, recovery codes, security answers, tokens, private keys, or payment-card security data in the reusable profile or chat.",
      "Connectors are workspace-wide and available to every agent. When the user supplies a credential, use connect_connector for GitHub, Resend, Notion, Stripe, or Firebase, or create_connector for another HTTPS API. Firebase CLI is installed in the agent environment for deploys. Pass credentials only as the tool's secret argument; never echo them, write them to files, store them in profile data, or mention any portion in your response. Use connector_request to call a connected API without retrieving its raw secret.",
      "When the user explicitly asks to remove a connector, use disconnect_connector. Do not disconnect services without that explicit request.",
      "Complete 2FA autonomously when the verification is accessible in the authorized noudleAgents computer. If a code, push approval, number match, hardware key, biometric, phone interaction, identity document, or other user-only step is required, ask for only that exact code or action, keep the broader task pending, and continue automatically as soon as the user responds. If a CAPTCHA requires human completion, ask the user to complete that one challenge; do not bypass it and do not abandon the broader task.",
      "If the user has taken control, wait until control is returned, inspect the screen, and resume from the current state.",
      "Computer control state must come from the latest computer tool result, never from an earlier turn or your prior response. A shared computer with controlMode 'watch' is available for agent actions; controlMode 'user' means the owner currently has control. When the user says control was returned or asks you to retry, immediately call computer_screenshot or browser_navigate again. If that call succeeds, continue the requested browser work and do not claim that control is blocked.",
    ].join("\n\n");
    const attachments = context.trigger.attachments?.length
      ? `\n\nAttachments from the user:\n${context.trigger.attachments.map((attachment) => `- ${attachment.name} (${attachment.mimeType}): ${attachment.path}`).join("\n")}\nInspect these files directly. Images can be opened with the image viewing tool.`
      : "";
    return `${computerGuidance}\n\n${context.trigger.content}${attachments}${task}`;
  }

  private async consumeTurn(
    context: RuntimeContext,
    threadId: string,
    turnId: string,
    signal: AbortSignal,
    emit: (event: RuntimeEvent) => Promise<void>,
  ): Promise<RuntimeResult> {
    const response = await fetch(`${this.config.codexWorkerUrl}/v1/events?after=0`, {
      headers: { authorization: `Bearer ${this.config.internalToken}` },
      signal,
    });
    if (!response.ok || !response.body) throw new Error(`Codex event stream failed (${response.status})`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    const responseParts: MessageResponsePart[] = [];
    let activeTextPart: Extract<MessageResponsePart, { type: "text" }> | null = null;
    const appendText = (text: string): void => {
      content += text;
      if (!activeTextPart) {
        activeTextPart = { type: "text", text: "" };
        responseParts.push(activeTextPart);
      }
      activeTextPart.text += text;
    };
    const upsertTool = (item: unknown, running: boolean): Extract<MessageResponsePart, { type: "tool" }> => {
      const candidate = responseToolPart(item, `tool-${responseParts.length + 1}`, running);
      const index = responseParts.findIndex((part) => part.type === "tool" && part.id === candidate.id);
      if (index >= 0) responseParts[index] = candidate;
      else responseParts.push(candidate);
      activeTextPart = null;
      return candidate;
    };
    let completed = false;
    let agentMessageItems = 0;
    try {
      while (!completed) {
        if (signal.aborted) throw abortError(signal);
        const next = await reader.read();
        if (next.done) throw new Error("Codex event stream ended before the turn completed");
        buffer += decoder.decode(next.value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const data = frame.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
          if (!data) continue;
          const event = JSON.parse(data) as WorkerEvent;
          if (event.threadId !== threadId || (event.turnId && event.turnId !== turnId)) continue;
          const payload = asRecord(event.payload);
          if (event.type === "item/agentMessage/delta") {
            const delta = typeof payload.delta === "string" ? payload.delta : "";
            appendText(delta);
            if (delta) await emit({ type: "message.delta", payload: { runId: context.run.id, turnId, delta } });
          } else if (event.type === "item/started") {
            const item = asRecord(payload.item);
            if (item.type === "agentMessage") {
              if (agentMessageItems > 0 && content && !content.endsWith("\n\n")) {
                appendText("\n\n");
                await emit({ type: "message.delta", payload: { runId: context.run.id, turnId, delta: "\n\n" } });
              }
              agentMessageItems += 1;
            } else if (item.type) {
              const part = upsertTool(item, true);
              await emit({ type: "tool.started", payload: { turnId, item: safeRuntimeItem(item), part } });
            }
          } else if (event.type === "item/completed") {
            const item = asRecord(payload.item);
            if (!content && item.type === "agentMessage" && typeof item.text === "string") appendText(item.text);
            if (item.type && item.type !== "agentMessage") {
              const part = upsertTool(item, false);
              await emit({ type: "tool.completed", payload: { turnId, item: safeRuntimeItem(item), part } });
            }
          } else if (event.type === "item/commandExecution/outputDelta") {
            const itemId = typeof payload.itemId === "string" ? payload.itemId : null;
            const part = itemId ? responseParts.find((candidate) => candidate.type === "tool" && candidate.id === itemId) : null;
            if (part?.type === "tool") part.data.output = `${typeof part.data.output === "string" ? part.data.output : ""}${typeof payload.delta === "string" ? payload.delta : ""}`.slice(0, 100_000);
            await emit({ type: "tool.output", payload: { turnId, delta: payload.delta ?? "" } });
          } else if (event.type === "item/fileChange/patchUpdated") {
            const itemId = typeof payload.itemId === "string" ? payload.itemId : null;
            const part = itemId ? responseParts.find((candidate) => candidate.type === "tool" && candidate.id === itemId) : null;
            if (part?.type === "tool" && Array.isArray(payload.changes)) part.data.changes = payload.changes;
          } else if (event.type === "relay/approvalRequested") {
            await this.handleApproval(context, asRecord(event.payload), emit, signal);
          } else if (event.type === "turn/completed") {
            const turn = asRecord(payload.turn);
            const status = typeof turn.status === "string" ? turn.status : "completed";
            if (status === "failed") throw new Error(`Codex turn failed: ${JSON.stringify(turn.error ?? payload)}`);
            completed = true;
          } else if (event.type === "error") {
            throw new Error(`Codex error: ${JSON.stringify(payload)}`);
          }
        }
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    const normalized = content.trim() || "Codex completed the turn without a text response.";
    return {
      content: normalized,
      summary: normalized.slice(0, 500),
      ...(responseParts.length ? { responseParts } : {}),
    };
  }

  private async handleApproval(
    context: RuntimeContext,
    payload: Record<string, unknown>,
    emit: (event: RuntimeEvent) => Promise<void>,
    signal: AbortSignal,
  ): Promise<void> {
    const workerApproval = payload as unknown as WorkerApproval;
    if (!workerApproval.id || !workerApproval.method) return;
    const now = new Date();
    const approval = ApprovalSchema.parse({
      id: workerApproval.id,
      workspaceId: context.run.workspaceId,
      runId: context.run.id,
      taskId: context.run.taskId,
      agentId: context.agent.id,
      tool: workerApproval.method,
      risk: approvalRisk(workerApproval.method),
      title: `${context.agent.name} requests approval`,
      description: `Codex requested ${workerApproval.method} before continuing this run.`,
      normalizedArguments: asRecord(workerApproval.params),
      signature: createHash("sha256").update(JSON.stringify([context.run.id, workerApproval])).digest("hex"),
      status: "pending",
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
      decidedAt: null,
      createdAt: now.toISOString(),
    });
    await this.repository.put("approvals", approval);
    await emit({ type: "approval.requested", payload: { approval } });
    await this.repository.put("runs", RunSchema.parse({ ...context.run, status: "waiting_approval", updatedAt: new Date().toISOString() }));

    let decision: "accept" | "decline" | null = null;
    while (!decision) {
      if (signal.aborted) throw abortError(signal);
      const current = await this.repository.get("approvals", approval.id);
      if (current?.status === "approved") decision = "accept";
      if (current?.status === "denied" || current?.status === "expired") decision = "decline";
      if (!decision) await new Promise((resolve) => setTimeout(resolve, 200));
    }
    await this.request(`/v1/approvals/${encodeURIComponent(workerApproval.id)}/resolve`, {
      method: "POST",
      body: JSON.stringify({ decision }),
    });
    context.run.status = "running";
    await this.repository.put("runs", RunSchema.parse({ ...context.run, status: "running", updatedAt: new Date().toISOString() }));
  }

  private async request<T = unknown>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${this.config.codexWorkerUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.config.internalToken}`,
        "content-type": "application/json",
        ...init.headers,
      },
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Codex worker ${path} failed (${response.status}): ${detail}`);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}
