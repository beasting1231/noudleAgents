import { createHash, randomUUID } from "node:crypto";
import type { RelayConfig } from "../config.js";
import type { RelayRepository } from "../database/repository.js";
import { conflict, DomainError, notFound } from "../domain/errors.js";
import type { RelayService } from "../domain/relay-service.js";
import type { ComputerSession } from "../model.js";
import type { DesktopActionResult, SandboxExecResult, SandboxInfo, SandboxManagerGateway } from "./sandbox-manager-client.js";

export interface ComputerActor {
  type: "user" | "agent" | "system";
  id: string;
}

export interface CreateComputerInput {
  agentId: string | null;
  taskId: string | null;
  browser: boolean;
  networkAccess: boolean;
}

export class ComputerService {
  private readonly agentProvisioning = new Map<string, Promise<ComputerSession>>();

  constructor(
    private readonly repository: RelayRepository,
    private readonly relay: RelayService,
    private readonly manager: SandboxManagerGateway,
    private readonly config: RelayConfig,
  ) {}

  private status(value: string): ComputerSession["status"] {
    if (value === "running") return "running";
    if (["created", "restarting"].includes(value)) return "creating";
    if (["exited", "dead", "removing"].includes(value)) return "stopped";
    return "error";
  }

  private computerAddress(value: string | null): { url: string | null; port: number | null } {
    if (!value) return { url: null, port: null };
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) return { url: null, port: null };
      const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
      if (this.config.computerPublicHost) url.hostname = this.config.computerPublicHost;
      return { url: url.toString(), port: Number.isSafeInteger(port) ? port : null };
    } catch {
      return { url: null, port: null };
    }
  }

  private withSandbox(session: ComputerSession, sandbox: SandboxInfo): ComputerSession {
    const address = this.computerAddress(sandbox.computerUrl);
    return {
      ...session,
      status: this.status(sandbox.status),
      browser: sandbox.browser,
      computerUrl: address.url,
      computerHostPort: address.port,
      updatedAt: new Date().toISOString(),
    };
  }

  private async validateActor(actor: ComputerActor): Promise<void> {
    if (actor.type === "agent") await this.relay.getAgent(actor.id);
  }

  private provisionAgentComputer(agentId: string): Promise<ComputerSession> {
    const pending = this.agentProvisioning.get(agentId);
    if (pending) return pending;
    const provisioning = this.create(
      { agentId, taskId: null, browser: true, networkAccess: true },
      { type: "system", id: this.config.ownerId },
    ).finally(() => this.agentProvisioning.delete(agentId));
    this.agentProvisioning.set(agentId, provisioning);
    return provisioning;
  }

  private async emit(session: ComputerSession, action: string, actor: ComputerActor, extra: Record<string, unknown> = {}): Promise<void> {
    await this.relay.emit({
      workspaceId: session.workspaceId,
      aggregateType: "computer",
      aggregateId: session.id,
      type: "computer.updated",
      actorType: actor.type,
      actorId: actor.id,
      payload: { action, computer: session, ...extra },
    });
  }

  async create(input: CreateComputerInput, actor: ComputerActor): Promise<ComputerSession> {
    await this.validateActor(actor);
    if (input.agentId) await this.relay.getAgent(input.agentId);
    if (input.taskId) await this.relay.getTask(input.taskId);
    if (actor.type === "agent" && actor.id !== input.agentId) {
      throw new DomainError(403, "computer_agent_mismatch", "An agent can only create its own computer session");
    }
    if (actor.type === "agent" && input.networkAccess) {
      throw new DomainError(403, "network_access_forbidden", "Agents cannot enable sandbox network access directly");
    }
    const id = `cmp_${randomUUID()}`;
    const workspaceKey = `ws-${createHash("sha256")
      .update(`${this.config.workspaceId}:${input.agentId ?? "owner"}:${input.taskId ?? "general"}`)
      .digest("hex")
      .slice(0, 32)}`;
    const now = new Date().toISOString();
    const initial: ComputerSession = {
      id,
      workspaceId: this.config.workspaceId,
      agentId: input.agentId,
      taskId: input.taskId,
      status: "creating",
      browser: input.browser,
      networkAccess: input.networkAccess,
      computerUrl: null,
      computerHostPort: null,
      controlMode: input.agentId ? "agent" : "watch",
      controlHolderId: input.agentId,
      leaseExpiresAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.repository.put("computers", initial);
    try {
      const sandbox = await this.manager.create({ id, workspaceKey, browser: input.browser, networkAccess: input.networkAccess });
      if (sandbox.id !== id) throw new DomainError(502, "sandbox_identity_mismatch", "Sandbox manager returned the wrong session identity");
      const session = this.withSandbox(initial, sandbox);
      await this.repository.put("computers", session);
      await this.emit(session, "created", actor);
      return session;
    } catch (error) {
      await this.repository.delete("computers", id);
      await this.manager.remove(id).catch(() => undefined);
      throw error;
    }
  }

  private async normalizeLease(session: ComputerSession): Promise<ComputerSession> {
    if (session.controlMode !== "user" || !session.leaseExpiresAt || new Date(session.leaseExpiresAt).getTime() > Date.now()) return session;
    const normalized: ComputerSession = {
      ...session,
      controlMode: session.agentId ? "agent" : "watch",
      controlHolderId: session.agentId,
      leaseExpiresAt: null,
      updatedAt: new Date().toISOString(),
    };
    await this.repository.put("computers", normalized);
    await this.emit(normalized, "lease_expired", { type: "system", id: this.config.ownerId });
    return normalized;
  }

  async list(): Promise<ComputerSession[]> {
    const persisted = await this.repository.list("computers", this.config.workspaceId);
    const sandboxes = await this.manager.list();
    const byId = new Map(sandboxes.map((sandbox) => [sandbox.id, sandbox]));
    const sessions: ComputerSession[] = [];
    for (const stored of persisted) {
      const sandbox = byId.get(stored.id);
      const refreshed: ComputerSession = sandbox
        ? this.withSandbox(stored, sandbox)
        : { ...stored, status: "stopped", computerUrl: null, computerHostPort: null, updatedAt: new Date().toISOString() };
      await this.repository.put("computers", refreshed);
      sessions.push(await this.normalizeLease(refreshed));
    }
    return sessions.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async get(id: string): Promise<ComputerSession> {
    const stored = await this.repository.get("computers", id);
    if (!stored || stored.workspaceId !== this.config.workspaceId) throw notFound("Computer", id);
    const sandbox = await this.manager.get(id);
    const refreshed: ComputerSession = sandbox
      ? this.withSandbox(stored, sandbox)
      : { ...stored, status: "stopped", computerUrl: null, computerHostPort: null, updatedAt: new Date().toISOString() };
    await this.repository.put("computers", refreshed);
    return this.normalizeLease(refreshed);
  }

  async takeover(id: string, leaseSeconds: number, actor: ComputerActor): Promise<ComputerSession> {
    if (actor.type !== "user") throw new DomainError(403, "user_control_only", "Only the workspace owner can take over a computer");
    const current = await this.get(id);
    if (current.status !== "running") throw conflict("computer_not_running", "Computer must be running before control can be taken");
    const session: ComputerSession = {
      ...current,
      controlMode: "user",
      controlHolderId: actor.id,
      leaseExpiresAt: new Date(Date.now() + leaseSeconds * 1000).toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await this.repository.put("computers", session);
    await this.emit(session, "control_taken", actor, { leaseSeconds });
    return session;
  }

  async returnControl(id: string, actor: ComputerActor): Promise<ComputerSession> {
    if (actor.type !== "user") throw new DomainError(403, "user_control_only", "Only the workspace owner can return computer control");
    const current = await this.get(id);
    const session: ComputerSession = {
      ...current,
      controlMode: current.agentId ? "agent" : "watch",
      controlHolderId: current.agentId,
      leaseExpiresAt: null,
      updatedAt: new Date().toISOString(),
    };
    await this.repository.put("computers", session);
    await this.emit(session, "control_returned", actor);
    return session;
  }

  async exec(id: string, command: string[], timeoutMs: number, actor: ComputerActor): Promise<SandboxExecResult> {
    await this.validateActor(actor);
    const session = await this.get(id);
    if (session.status !== "running") throw conflict("computer_not_running", "Computer is not running");
    if (actor.type === "agent") {
      if (session.agentId !== actor.id) throw new DomainError(403, "computer_agent_mismatch", "Agent is not assigned to this computer");
      if (session.controlMode === "user") throw conflict("computer_controlled_by_user", "Computer is currently controlled by the user");
    } else if (
      session.controlMode !== "user" ||
      session.controlHolderId !== actor.id ||
      !session.leaseExpiresAt ||
      new Date(session.leaseExpiresAt).getTime() <= Date.now()
    ) {
      throw conflict("computer_takeover_required", "Take over the computer before running terminal commands");
    }
    const started = Date.now();
    const result = await this.manager.exec(id, command, timeoutMs);
    await this.emit(session, "command_executed", actor, {
      executable: command[0],
      argumentCount: command.length,
      timeoutMs,
      exitCode: result.exitCode,
      durationMs: Date.now() - started,
    });
    return result;
  }

  async navigateBrowser(id: string | null, url: string, actor: ComputerActor): Promise<{ computer: ComputerSession; url: string; title: string }> {
    await this.validateActor(actor);
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new DomainError(400, "invalid_browser_url", "Browser navigation requires an http or https URL");
    }
    const available = await this.list();
    const session = id
      ? available.find((candidate) => candidate.id === id)
      : actor.type === "agent"
        ? available.find((candidate) => candidate.agentId === actor.id && candidate.browser && candidate.status === "running")
          ?? await this.provisionAgentComputer(actor.id)
        : available.find((candidate) => candidate.agentId === null && candidate.browser && candidate.status === "running");
    if (!session) throw notFound("Running browser computer", id ?? actor.id);
    if (!session.browser || session.status !== "running") throw conflict("computer_browser_unavailable", "Computer browser is not running");
    if (actor.type === "agent") {
      if (session.agentId !== actor.id) {
        throw new DomainError(403, "computer_agent_mismatch", "Agent cannot control another agent's computer");
      }
      if (session.controlMode === "user") throw conflict("computer_controlled_by_user", "Computer is currently controlled by the user");
    }
    const navigated = await this.manager.browserNavigate(session.id, parsed.toString());
    await this.emit(session, "browser_navigated", actor, { url: navigated.url, title: navigated.title });
    return { computer: session, ...navigated };
  }

  async desktopAction(id: string | null, input: Record<string, unknown>, actor: ComputerActor): Promise<{ computer: ComputerSession; result: DesktopActionResult }> {
    await this.validateActor(actor);
    const available = await this.list();
    const session = id
      ? available.find((candidate) => candidate.id === id)
      : actor.type === "agent"
        ? available.find((candidate) => candidate.agentId === actor.id && candidate.browser && candidate.status === "running")
          ?? await this.provisionAgentComputer(actor.id)
        : available.find((candidate) => candidate.agentId === null && candidate.browser && candidate.status === "running");
    if (!session) throw notFound("Running browser computer", id ?? actor.id);
    if (!session.browser || session.status !== "running") throw conflict("computer_browser_unavailable", "Computer desktop is not running");
    if (actor.type === "agent") {
      if (session.agentId !== actor.id) throw new DomainError(403, "computer_agent_mismatch", "Agent cannot control another agent's computer");
      if (session.controlMode === "user") throw conflict("computer_controlled_by_user", "Computer is currently controlled by the user");
    }
    const result = await this.manager.desktopAction(session.id, input);
    await this.emit(session, "desktop_interacted", actor, { interaction: input.action, width: result.width, height: result.height });
    return { computer: session, result };
  }

  async remove(id: string, actor: ComputerActor): Promise<void> {
    await this.validateActor(actor);
    const session = await this.get(id);
    if (actor.type === "agent" && session.agentId !== actor.id) {
      throw new DomainError(403, "computer_agent_mismatch", "Agent is not assigned to this computer");
    }
    await this.manager.remove(id);
    await this.repository.delete("computers", id);
    await this.emit({ ...session, status: "stopped", computerUrl: null, computerHostPort: null, updatedAt: new Date().toISOString() }, "deleted", actor);
  }
}
