import type {
  CreateSandboxInput,
  SandboxExecResult,
  SandboxInfo,
  SandboxManagerGateway,
  DesktopActionResult,
} from "../src/computers/sandbox-manager-client.js";

export class FakeSandboxManager implements SandboxManagerGateway {
  readonly sandboxes = new Map<string, SandboxInfo>();
  readonly executions: Array<{ id: string; command: string[]; timeoutMs: number }> = [];
  readonly creations: CreateSandboxInput[] = [];

  async list(): Promise<SandboxInfo[]> {
    return [...this.sandboxes.values()].map((sandbox) => structuredClone(sandbox));
  }

  async create(input: CreateSandboxInput): Promise<SandboxInfo> {
    this.creations.push(structuredClone(input));
    const sandbox: SandboxInfo = {
      id: input.id,
      status: "running",
      browser: input.browser,
      computerUrl: input.browser ? "http://127.0.0.1:61234/vnc.html?autoconnect=1" : null,
    };
    this.sandboxes.set(input.id, sandbox);
    return structuredClone(sandbox);
  }

  async start(id: string): Promise<SandboxInfo> {
    const current = this.sandboxes.get(id);
    if (!current) throw new Error("Sandbox not found");
    const started = { ...current, status: "running" };
    this.sandboxes.set(id, started);
    return structuredClone(started);
  }

  async stop(id: string): Promise<SandboxInfo> {
    const current = this.sandboxes.get(id);
    if (!current) throw new Error("Sandbox not found");
    const stopped = { ...current, status: "exited" };
    this.sandboxes.set(id, stopped);
    return structuredClone(stopped);
  }

  async get(id: string): Promise<SandboxInfo | null> {
    return structuredClone(this.sandboxes.get(id) ?? null);
  }

  async exec(id: string, command: string[], timeoutMs: number): Promise<SandboxExecResult> {
    if (!this.sandboxes.has(id)) throw new Error("Sandbox not found");
    this.executions.push({ id, command, timeoutMs });
    return { exitCode: 0, stdout: `ran:${command[0]}`, stderr: "" };
  }

  async browserNavigate(id: string, url: string): Promise<{ url: string; title: string }> {
    if (!this.sandboxes.has(id)) throw new Error("Sandbox not found");
    return { url, title: new URL(url).hostname };
  }

  async desktopAction(id: string, input: Record<string, unknown>): Promise<DesktopActionResult> {
    if (!this.sandboxes.has(id)) throw new Error("Sandbox not found");
    return { action: String(input.action), width: 1440, height: 900, mimeType: "image/jpeg", image: "ZmFrZQ==" };
  }

  async remove(id: string): Promise<void> {
    if (!this.sandboxes.delete(id)) throw new Error("Sandbox not found");
  }
}
