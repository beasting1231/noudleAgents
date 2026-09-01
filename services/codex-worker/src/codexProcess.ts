import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";
import type { WorkerConfig } from "./config.js";
import { EventBuffer } from "./eventBuffer.js";
import { JsonRpcLineClient, type JsonRpcRequest } from "./jsonRpcClient.js";

interface ThreadResponse {
  thread: { id: string };
}

interface TurnResponse {
  turn: { id: string; status?: string };
}

export interface PendingApproval {
  id: string;
  rpcId: number | string;
  method: string;
  params: unknown;
  createdAt: string;
}

export class CodexProcess extends EventEmitter {
  readonly events = new EventBuffer();
  readonly pendingApprovals = new Map<string, PendingApproval>();
  private client: JsonRpcLineClient | null = null;
  private initialized = false;
  private childPid: number | null = null;
  private lastError: string | null = null;
  private readonly config: WorkerConfig;

  constructor(config: WorkerConfig) {
    super();
    this.config = config;
  }

  get health(): { initialized: boolean; lastError: string | null; pid: number | null } {
    return { initialized: this.initialized, lastError: this.lastError, pid: this.childPid };
  }

  async start(): Promise<void> {
    if (this.client) return;
    await fs.mkdir(this.config.workspaceRoot, { recursive: true });
    const env = { ...process.env };
    // A worker started from inside the Codex desktop app must not inherit the
    // parent task's tool pipe or identity. noudleAgents owns its own threads and MCP
    // surface; retaining these variables would leak the parent agent roster.
    for (const key of [
      "CODEX_APP_TOOLS_PIPE_PATH",
      "CODEX_SESSION_ID",
      "CODEX_THREAD_ID",
      "CODEX_PERMISSION_PROFILE",
      "CODEX_INTERNAL_ORIGINATOR_OVERRIDE",
      "CODEX_CI",
      "CODEX_MCP_NODE_PATH",
      "CODEX_SHELL",
    ]) delete env[key];
    if (this.config.codexHome) env.CODEX_HOME = this.config.codexHome;
    const child = spawn(this.config.codexBin, ["app-server", "--stdio"], {
      cwd: this.config.workspaceRoot,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const client = new JsonRpcLineClient(child);
    this.childPid = child.pid ?? null;
    this.client = client;
    client.on("notification", (message: { method: string; params?: unknown }) => {
      this.events.append(message.method, message.params ?? {});
      this.emit("event", message);
    });
    client.on("request", (request: JsonRpcRequest) => this.handleServerRequest(request));
    client.on("stderr", (text: string) => this.emit("stderr", text));
    client.on("protocolError", (error: Error) => this.emit("warning", error.message));
    client.on("close", (error: Error) => {
      this.initialized = false;
      this.client = null;
      this.childPid = null;
      this.lastError = error.message;
      this.events.append("relay/codexProcessExited", { error: error.message });
    });

    try {
      await client.request("initialize", {
        clientInfo: { name: "relay-codex-worker", title: "noudleAgents", version: "0.1.0" },
        capabilities: { experimentalApi: false },
      }, this.config.requestTimeoutMs);
      client.notify("initialized");
      this.initialized = true;
      this.lastError = null;
      this.events.append("relay/codexInitialized", {});
    } catch (error) {
      client.stop();
      this.client = null;
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.client?.stop();
    this.client = null;
    this.childPid = null;
    this.initialized = false;
  }

  async startThread(input: {
    cwd: string;
    developerInstructions?: string | undefined;
    model?: string | undefined;
    speed?: "balanced" | "extra-fast" | undefined;
    ephemeral?: boolean | undefined;
    agentId?: string | undefined;
  }): Promise<{ threadId: string }> {
    const client = await this.requireClient();
    const cwd = await this.resolveWorkspace(input.cwd);
    const collaborationConfig = this.config.collaborationMcpScript && input.agentId
      ? {
          features: { multi_agent: false },
          mcp_servers: {
            relay_collaboration: {
              command: process.execPath,
              args: [this.config.collaborationMcpScript],
              env: {
                RELAY_API_URL: this.config.relayApiUrl,
                RELAY_API_TOKEN: this.config.relayApiToken,
                RELAY_AGENT_ID: input.agentId,
              },
            },
          },
        }
      : {};
    const response = await client.request<ThreadResponse>("thread/start", {
      cwd,
      ...(input.developerInstructions ? { developerInstructions: input.developerInstructions } : {}),
      ...(input.model ?? this.config.model ? { model: input.model ?? this.config.model } : {}),
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandbox: "danger-full-access",
      ...(input.speed === "extra-fast" ? { serviceTier: "fast" } : {}),
      serviceName: "relay",
      ephemeral: input.ephemeral ?? false,
      ...(Object.keys(collaborationConfig).length > 0 ? { config: collaborationConfig } : {}),
    }, this.config.requestTimeoutMs);
    return { threadId: response.thread.id };
  }

  async resumeThread(threadId: string, input: {
    cwd: string;
    agentId?: string | undefined;
    model?: string | undefined;
    speed?: "balanced" | "extra-fast" | undefined;
  }): Promise<{ threadId: string }> {
    const client = await this.requireClient();
    const safeCwd = await this.resolveWorkspace(input.cwd);
    const collaborationConfig = this.collaborationConfig(input.agentId);
    const response = await client.request<ThreadResponse>("thread/resume", {
      threadId,
      cwd: safeCwd,
      ...(input.model ? { model: input.model } : {}),
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandbox: "danger-full-access",
      ...(input.speed === "extra-fast" ? { serviceTier: "fast" } : {}),
      ...(Object.keys(collaborationConfig).length > 0 ? { config: collaborationConfig } : {}),
    }, this.config.requestTimeoutMs);
    return { threadId: response.thread.id };
  }

  async startTurn(input: {
    threadId: string;
    text: string;
    cwd?: string | undefined;
    clientUserMessageId?: string | undefined;
    model?: string | undefined;
    effort?: "low" | "medium" | "high" | "xhigh" | undefined;
    speed?: "balanced" | "extra-fast" | undefined;
  }): Promise<{ turnId: string }> {
    const client = await this.requireClient();
    const response = await client.request<TurnResponse>("turn/start", {
      threadId: input.threadId,
      input: [{ type: "text", text: input.text, text_elements: [] }],
      ...(input.cwd ? { cwd: await this.resolveWorkspace(input.cwd) } : {}),
      ...(input.clientUserMessageId ? { clientUserMessageId: input.clientUserMessageId } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.effort ?? this.config.effort ? { effort: input.effort ?? this.config.effort } : {}),
      approvalPolicy: "never",
      approvalsReviewer: "user",
      ...(input.speed === "extra-fast" ? { serviceTier: "fast" } : {}),
    }, this.config.requestTimeoutMs);
    return { turnId: response.turn.id };
  }

  async interrupt(threadId: string, turnId: string): Promise<void> {
    const client = await this.requireClient();
    await client.request("turn/interrupt", { threadId, turnId }, this.config.requestTimeoutMs);
  }

  async callMcpTool(threadId: string, server: string, tool: string, args: Record<string, unknown>): Promise<unknown> {
    const client = await this.requireClient();
    return client.request("mcpServer/tool/call", { threadId, server, tool, arguments: args }, this.config.requestTimeoutMs);
  }

  resolveApproval(id: string, decision: "accept" | "decline"): void {
    const approval = this.pendingApprovals.get(id);
    if (!approval || !this.client) throw new Error("Approval is no longer pending");
    const result = this.approvalResponse(approval.method, decision, approval.params);
    this.client.respond(approval.rpcId, result);
    this.pendingApprovals.delete(id);
    this.events.append("relay/approvalResolved", { id, decision, method: approval.method });
  }

  private async requireClient(): Promise<JsonRpcLineClient> {
    if (!this.client || !this.initialized) await this.start();
    if (!this.client) throw new Error("Codex App Server failed to initialize");
    return this.client;
  }

  private handleServerRequest(request: JsonRpcRequest): void {
    const approvalMethods = new Set([
      "item/commandExecution/requestApproval",
      "item/fileChange/requestApproval",
      "item/permissions/requestApproval",
      "execCommandApproval",
      "applyPatchApproval",
      "permissions/requestApproval",
    ]);
    if (approvalMethods.has(request.method)) {
      const id = `approval_${String(request.id)}`;
      this.pendingApprovals.set(id, {
        id,
        rpcId: request.id,
        method: request.method,
        params: request.params ?? {},
        createdAt: new Date().toISOString(),
      });
      const params = request.params && typeof request.params === "object"
        ? request.params as Record<string, unknown>
        : {};
      this.events.append("relay/approvalRequested", {
        id,
        method: request.method,
        params,
        ...(typeof params.threadId === "string" ? { threadId: params.threadId } : {}),
        ...(typeof params.turnId === "string" ? { turnId: params.turnId } : {}),
      });
      return;
    }
    this.client?.respondError(request.id, -32601, `noudleAgents does not implement App Server request ${request.method}`);
    this.events.append("relay/unsupportedServerRequest", { method: request.method });
  }

  private approvalResponse(method: string, decision: "accept" | "decline", params: unknown): unknown {
    if (method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval") {
      return { decision: decision === "accept" ? "accept" : "decline" };
    }
    if (method === "item/permissions/requestApproval" || method === "permissions/requestApproval") {
      const request = params && typeof params === "object" ? params as Record<string, unknown> : {};
      return { permissions: decision === "accept" && request.permissions && typeof request.permissions === "object"
        ? request.permissions
        : {} };
    }
    return { decision: decision === "accept" ? "approved" : "denied" };
  }

  private async resolveWorkspace(requested: string): Promise<string> {
    const candidate = path.resolve(this.config.workspaceRoot, requested || ".");
    const relative = path.relative(this.config.workspaceRoot, candidate);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Working directory is outside the noudleAgents workspace root");
    await fs.mkdir(candidate, { recursive: true });
    return candidate;
  }

  private collaborationConfig(agentId?: string): Record<string, unknown> {
    return this.config.collaborationMcpScript && agentId
      ? {
          features: { multi_agent: false },
          mcp_servers: {
            relay_collaboration: {
              command: process.execPath,
              args: [this.config.collaborationMcpScript],
              env: {
                RELAY_API_URL: this.config.relayApiUrl,
                RELAY_API_TOKEN: this.config.relayApiToken,
                RELAY_AGENT_ID: agentId,
              },
            },
          },
        }
      : {};
  }
}
