export type ArtifactSource = "user_upload" | "agent_output" | "sandbox_export";

export interface ArtifactRecord {
  id: string;
  logicalId: string;
  workspaceId: string;
  version: number;
  parentArtifactId: string | null;
  taskId: string | null;
  runId: string | null;
  agentId: string | null;
  name: string;
  mimeType: string;
  size: number;
  checksum: string;
  storageKey: string;
  provenance: {
    source: ArtifactSource;
    createdByType: "user" | "agent" | "system";
    createdById: string;
    originalName: string | null;
  };
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UploadAsset {
  uri: string;
  name: string;
  mimeType: string;
  size?: number;
  file?: Blob;
}

export interface ComputerSession {
  id: string;
  workspaceId: string;
  agentId: string | null;
  taskId: string | null;
  status: "creating" | "running" | "stopped" | "error";
  browser: boolean;
  networkAccess: boolean;
  computerUrl: string | null;
  computerHostPort: number | null;
  controlMode: "watch" | "user" | "agent";
  controlHolderId: string | null;
  leaseExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export const safeTerminalActions = [
  { id: "pwd", label: "Current folder", command: ["pwd"] },
  { id: "list", label: "List files", command: ["ls", "-la"] },
  { id: "status", label: "Git status", command: ["git", "status", "--short"] },
  { id: "diff", label: "Diff summary", command: ["git", "diff", "--stat"] },
] as const;

export function resolveComputerUrl(computerUrl: string, instanceUrl: string): string {
  try {
    const stream = new URL(computerUrl, instanceUrl);
    const instance = new URL(instanceUrl);
    const loopback = stream.hostname === "127.0.0.1" || stream.hostname === "localhost" || stream.hostname === "[::1]";
    if (loopback && (instance.protocol === "http:" || instance.protocol === "https:")) stream.hostname = instance.hostname;
    return stream.toString();
  } catch {
    return computerUrl;
  }
}

export class WorkspaceApi {
  readonly baseUrl: string;
  readonly token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...init.headers,
      },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(body || `noudleAgents request failed (${response.status})`);
    }
    return response.json() as Promise<T>;
  }

  listArtifacts(filters: { taskId?: string; runId?: string; agentId?: string } = {}): Promise<ArtifactRecord[]> {
    const query = new URLSearchParams();
    if (filters.taskId) query.set("taskId", filters.taskId);
    if (filters.runId) query.set("runId", filters.runId);
    if (filters.agentId) query.set("agentId", filters.agentId);
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    return this.request(`/v1/artifacts${suffix}`);
  }

  uploadArtifact(asset: UploadAsset, options: { name?: string; taskId?: string; agentId?: string; parentArtifactId?: string } = {}): Promise<ArtifactRecord> {
    const form = new FormData();
    if (asset.file) {
      form.append("file", asset.file, asset.name);
    } else {
      form.append("file", { uri: asset.uri, name: asset.name, type: asset.mimeType } as unknown as Blob);
    }
    form.append("name", options.name ?? asset.name);
    form.append("source", "user_upload");
    if (options.taskId) form.append("taskId", options.taskId);
    if (options.agentId) form.append("agentId", options.agentId);
    if (options.parentArtifactId) form.append("parentArtifactId", options.parentArtifactId);
    return this.request("/v1/artifacts", { method: "POST", body: form });
  }

  renameArtifact(id: string, name: string): Promise<ArtifactRecord> {
    return this.request(`/v1/artifacts/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
  }

  async downloadArtifact(id: string): Promise<Response> {
    const response = await fetch(`${this.baseUrl}/v1/artifacts/${encodeURIComponent(id)}/download`, {
      headers: { authorization: `Bearer ${this.token}` },
    });
    if (!response.ok) throw new Error((await response.text()) || `Download failed (${response.status})`);
    return response;
  }

  artifactDownloadUrl(id: string): string {
    return `${this.baseUrl}/v1/artifacts/${encodeURIComponent(id)}/download`;
  }

  listComputers(): Promise<ComputerSession[]> {
    return this.request("/v1/computers");
  }

  createComputer(input: { agentId?: string; taskId?: string; browser?: boolean; networkAccess?: boolean }): Promise<ComputerSession> {
    return this.request("/v1/computers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ browser: true, networkAccess: true, ...input }),
    });
  }

  takeoverComputer(id: string, leaseSeconds = 300): Promise<ComputerSession> {
    return this.request(`/v1/computers/${encodeURIComponent(id)}/takeover`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ leaseSeconds }),
    });
  }

  returnComputer(id: string): Promise<ComputerSession> {
    return this.request(`/v1/computers/${encodeURIComponent(id)}/return`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
  }

  execComputer(id: string, command: readonly string[]): Promise<ExecResult> {
    const allowed = safeTerminalActions.some((action) => action.command.length === command.length && action.command.every((part, index) => part === command[index]));
    if (!allowed) return Promise.reject(new Error("Only pre-approved read-only terminal actions are available on mobile"));
    return this.request(`/v1/computers/${encodeURIComponent(id)}/exec`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command, timeoutMs: 30_000 }),
    });
  }
}
