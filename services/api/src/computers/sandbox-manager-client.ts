import type { RelayConfig } from "../config.js";
import { DomainError } from "../domain/errors.js";

export interface SandboxInfo {
  id: string;
  status: string;
  browser: boolean;
  computerUrl: string | null;
}

export interface CreateSandboxInput {
  id: string;
  workspaceKey: string;
  browser: boolean;
  networkAccess: boolean;
}

export interface SandboxExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface DesktopActionResult {
  action: string;
  width: number;
  height: number;
  mimeType: "image/jpeg";
  image: string;
}

export interface SandboxManagerGateway {
  list(): Promise<SandboxInfo[]>;
  create(input: CreateSandboxInput): Promise<SandboxInfo>;
  get(id: string): Promise<SandboxInfo | null>;
  exec(id: string, command: string[], timeoutMs: number): Promise<SandboxExecResult>;
  browserNavigate(id: string, url: string): Promise<{ url: string; title: string }>;
  desktopAction(id: string, input: Record<string, unknown>): Promise<DesktopActionResult>;
  remove(id: string): Promise<void>;
}

export class HttpSandboxManagerClient implements SandboxManagerGateway {
  constructor(private readonly config: RelayConfig) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.config.sandboxManagerUrl}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${this.config.internalToken}`,
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...init.headers,
        },
        signal: AbortSignal.timeout(125_000),
      });
    } catch (error) {
      throw new DomainError(502, "sandbox_manager_unavailable", `Sandbox manager is unavailable: ${String(error)}`);
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new DomainError(502, "sandbox_manager_error", `Sandbox manager failed (${response.status})`, {
        status: response.status,
        detail: detail.slice(0, 2000),
      });
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  async list(): Promise<SandboxInfo[]> {
    const response = await this.request<{ sandboxes: SandboxInfo[] }>("/v1/sandboxes");
    return response.sandboxes;
  }

  create(input: CreateSandboxInput): Promise<SandboxInfo> {
    return this.request("/v1/sandboxes", { method: "POST", body: JSON.stringify(input) });
  }

  async get(id: string): Promise<SandboxInfo | null> {
    return (await this.list()).find((sandbox) => sandbox.id === id) ?? null;
  }

  exec(id: string, command: string[], timeoutMs: number): Promise<SandboxExecResult> {
    return this.request(`/v1/sandboxes/${encodeURIComponent(id)}/exec`, {
      method: "POST",
      body: JSON.stringify({ command, timeoutMs }),
    });
  }

  browserNavigate(id: string, url: string): Promise<{ url: string; title: string }> {
    return this.request(`/v1/sandboxes/${encodeURIComponent(id)}/browser/navigate`, {
      method: "POST",
      body: JSON.stringify({ url }),
    });
  }

  desktopAction(id: string, input: Record<string, unknown>): Promise<DesktopActionResult> {
    return this.request(`/v1/sandboxes/${encodeURIComponent(id)}/desktop/action`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  remove(id: string): Promise<void> {
    return this.request(`/v1/sandboxes/${encodeURIComponent(id)}`, { method: "DELETE" });
  }
}
