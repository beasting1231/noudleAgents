import { PassThrough } from "node:stream";
import fs from "node:fs/promises";
import Docker, { type Container } from "dockerode";
import { config } from "./config.js";
import { containerName, requireSafeKey, resolveWorkspace } from "./security.js";
import { ViewAccess } from "./viewAccess.js";

export interface CreateSandboxInput {
  id: string;
  workspaceKey: string;
  browser: boolean;
  networkAccess: boolean;
}

export interface SandboxInfo {
  id: string;
  containerId: string;
  name: string;
  status: string;
  browser: boolean;
  computerUrl: string | null;
  computerPort: number | null;
}

export interface DesktopAction {
  action: "screenshot" | "click" | "move" | "type" | "key" | "scroll" | "drag" | "wait";
  [key: string]: unknown;
}

export interface DesktopActionResult {
  action: DesktopAction["action"];
  width: number;
  height: number;
  mimeType: "image/jpeg";
  image: string;
}

export class SandboxService {
  private readonly docker: Docker;
  private readonly views: ViewAccess;
  private readonly lastActivity = new Map<string, number>();
  private browserActionQueue: Promise<void> = Promise.resolve();
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(docker = new Docker(), views = new ViewAccess(config.viewSecret, config.publicUrl)) {
    this.docker = docker;
    this.views = views;
  }

  async health(): Promise<{ docker: boolean; version?: string }> {
    try {
      const version = await this.docker.version();
      return { docker: true, version: version.Version };
    } catch {
      return { docker: false };
    }
  }

  async ensureNetwork(name: string, internal: boolean): Promise<void> {
    const networks = await this.docker.listNetworks({ filters: { name: [name] } });
    if (!networks.some((network) => network.Name === name)) {
      await this.docker.createNetwork({ Name: name, Driver: "bridge", Internal: internal, CheckDuplicate: true });
    }
  }

  startIdleMonitor(): void {
    if (this.idleTimer) return;
    this.idleTimer = setInterval(() => void this.suspendIdle().catch(() => undefined), 60_000);
    this.idleTimer.unref();
  }

  stopIdleMonitor(): void {
    if (this.idleTimer) clearInterval(this.idleTimer);
    this.idleTimer = null;
  }

  markActive(id: string): void {
    this.lastActivity.set(id, Date.now());
  }

  async suspendIdle(now = Date.now()): Promise<string[]> {
    const containers = await this.docker.listContainers({ all: true, filters: { label: ["relay.managed=true", "relay.browser=true"] } });
    const suspended: string[] = [];
    for (const entry of containers) {
      if (entry.State !== "running") continue;
      const id = entry.Labels["relay.sandbox.id"] ?? entry.Id.slice(0, 12);
      const lastUsed = this.lastActivity.get(id);
      if (lastUsed === undefined) {
        this.lastActivity.set(id, now);
        continue;
      }
      if (now - lastUsed < config.idleMilliseconds) continue;
      await this.docker.getContainer(entry.Id).stop({ t: 5 });
      this.lastActivity.delete(id);
      suspended.push(id);
    }
    return suspended;
  }

  async create(input: CreateSandboxInput): Promise<SandboxInfo> {
    requireSafeKey(input.id, "sandbox id");
    const name = containerName(input.id);
    const workspace = resolveWorkspace(config.workspaceRoot, input.workspaceKey);
    const teamDirectories = [
      config.workspaceRoot,
      resolveWorkspace(config.workspaceRoot, "agents"),
      resolveWorkspace(config.workspaceRoot, "projects"),
      resolveWorkspace(config.workspaceRoot, "team"),
      workspace,
    ];
    for (const directory of teamDirectories) {
      await fs.mkdir(directory, { recursive: true });
      await fs.chown(directory, 10001, 10001).catch(() => undefined);
      await fs.chmod(directory, 0o775).catch(() => undefined);
    }
    const networkMode = input.networkAccess ? config.network : input.browser ? config.isolatedNetwork : "none";
    if (networkMode !== "none") await this.ensureNetwork(networkMode, !input.networkAccess);

    let existing = await this.findByName(name);
    if (existing) {
      const inspect = await existing.inspect();
      if (inspect.Config.Labels?.["relay.workspace.layout"] !== "workspace-computer-v2") {
        if (inspect.State.Running) await existing.stop({ t: 5 });
        await existing.remove({ force: false, v: false });
        existing = null;
      } else {
        if (!inspect.State.Running) await existing.start();
        this.markActive(input.id);
        return this.describe(existing, input.browser);
      }
    }

    const browserVolume = "relay-workspace-browser";
    const homeVolume = "relay-workspace-home";
    if (input.browser) {
      for (const volumeName of [homeVolume, browserVolume]) {
        try {
          await this.docker.createVolume({ Name: volumeName, Labels: { "relay.managed": "true" } });
        } catch (error) {
          if (!(error instanceof Error) || !error.message.includes("already exists")) throw error;
        }
      }
    }

    const binds = [`${config.workspaceRoot}:/workspace:rw`];
    if (input.browser) binds.push(`${homeVolume}:/home/agent:rw`, `${browserVolume}:/home/agent/.relay-browser:rw`);
    const container = await this.docker.createContainer({
      name,
      Image: config.image,
      Env: [`RELAY_SANDBOX_ID=${input.id}`, `RELAY_BROWSER=${input.browser ? "1" : "0"}`],
      User: "10001:10001",
      WorkingDir: `/workspace/${input.workspaceKey}`,
      Tty: false,
      OpenStdin: false,
      Labels: {
        "relay.managed": "true",
        "relay.sandbox.id": input.id,
        "relay.workspace.key": input.workspaceKey,
        "relay.workspace.layout": "workspace-computer-v2",
        "relay.browser": String(input.browser),
      },
      ExposedPorts: input.browser ? { "6080/tcp": {} } : undefined,
      HostConfig: {
        AutoRemove: false,
        Binds: binds,
        ReadonlyRootfs: true,
        Tmpfs: {
          "/tmp": "rw,noexec,nosuid,size=512m,uid=10001,gid=10001",
          "/run": "rw,noexec,nosuid,size=64m,uid=10001,gid=10001",
        },
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges:true"],
        Memory: config.memoryBytes,
        NanoCpus: config.nanoCpus,
        PidsLimit: config.pidsLimit,
        Init: true,
        ShmSize: 512 * 1024 * 1024,
        NetworkMode: networkMode,
      },
    });
    await container.start();
    this.markActive(input.id);
    return this.describe(container, input.browser);
  }

  async start(id: string): Promise<SandboxInfo> {
    const container = await this.requireContainer(containerName(requireSafeKey(id, "sandbox id")));
    const inspect = await container.inspect();
    if (!inspect.State.Running) await container.start();
    this.markActive(id);
    return this.describe(container, inspect.Config.Labels?.["relay.browser"] === "true");
  }

  async stop(id: string): Promise<SandboxInfo> {
    const container = await this.requireContainer(containerName(requireSafeKey(id, "sandbox id")));
    const inspect = await container.inspect();
    if (inspect.State.Running) await container.stop({ t: 5 });
    this.lastActivity.delete(id);
    return this.describe(container, inspect.Config.Labels?.["relay.browser"] === "true");
  }

  async list(): Promise<SandboxInfo[]> {
    const containers = await this.docker.listContainers({ all: true, filters: { label: ["relay.managed=true"] } });
    return Promise.all(containers.map(async (entry) => {
      const container = this.docker.getContainer(entry.Id);
      return this.describe(container, entry.Labels["relay.browser"] === "true");
    }));
  }

  async exec(id: string, command: string[], timeoutMs: number): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    if (command.length === 0 || command.length > 64) throw new Error("Command must contain 1-64 arguments");
    if (command.some((part) => part.length > 32_000 || part.includes("\u0000"))) throw new Error("Command argument is invalid");
    const container = await this.requireContainer(containerName(id));
    const inspect = await container.inspect();
    this.markActive(id);
    const execution = await container.exec({
      Cmd: command,
      AttachStdout: true,
      AttachStderr: true,
      WorkingDir: inspect.Config.WorkingDir || "/workspace",
      User: "10001:10001",
    });
    const stream = await execution.start({ hijack: true, stdin: false });
    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    stdoutStream.on("data", (chunk: Buffer) => stdout.push(chunk));
    stderrStream.on("data", (chunk: Buffer) => stderr.push(chunk));
    this.docker.modem.demuxStream(stream, stdoutStream, stderrStream);

    const completion = new Promise<void>((resolve, reject) => {
      stream.once("end", resolve);
      stream.once("error", reject);
    });
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Sandbox command timed out")), timeoutMs));
    await Promise.race([completion, timeout]);
    const result = await execution.inspect();
    this.markActive(id);
    return {
      exitCode: result.ExitCode ?? -1,
      stdout: Buffer.concat(stdout).toString("utf8").slice(0, 2_000_000),
      stderr: Buffer.concat(stderr).toString("utf8").slice(0, 2_000_000),
    };
  }

  async browserNavigate(id: string, url: string): Promise<{ url: string; title: string }> {
    return this.withBrowserActionLock(async () => {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error("Browser URL must use http or https");
      let result = await this.exec(id, ["node", "/opt/relay/browser-control.mjs", "navigate", parsed.toString()], 60_000);
      if (result.exitCode !== 0) {
        const recovery = await this.exec(id, ["/opt/relay/restart-chromium"], 30_000);
        if (recovery.exitCode !== 0) throw new Error(recovery.stderr.trim() || "Browser recovery failed");
        result = await this.exec(id, ["node", "/opt/relay/browser-control.mjs", "navigate", parsed.toString()], 60_000);
      }
      if (result.exitCode !== 0) throw new Error(result.stderr.trim() || "Browser navigation failed");
      const payload = JSON.parse(result.stdout.trim()) as { ok?: boolean; url?: string; title?: string };
      if (!payload.ok || !payload.url) throw new Error("Browser navigation returned an invalid response");
      return { url: payload.url, title: payload.title ?? "" };
    });
  }

  async desktopAction(id: string, input: DesktopAction): Promise<DesktopActionResult> {
    return this.withBrowserActionLock(async () => {
      const encoded = Buffer.from(JSON.stringify(input)).toString("base64url");
      const result = await this.exec(id, ["python3", "/opt/relay/desktop-control.py", input.action, encoded], 30_000);
      if (result.exitCode !== 0) throw new Error(result.stderr.trim() || "Desktop action failed");
      const payload = JSON.parse(result.stdout.trim()) as DesktopActionResult & { ok?: boolean };
      if (!payload.ok || !payload.image || payload.mimeType !== "image/jpeg") throw new Error("Desktop action returned an invalid response");
      return { action: payload.action, width: payload.width, height: payload.height, mimeType: payload.mimeType, image: payload.image };
    });
  }

  private async withBrowserActionLock<T>(action: () => Promise<T>): Promise<T> {
    const previous = this.browserActionQueue;
    let release!: () => void;
    this.browserActionQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await action();
    } finally {
      release();
    }
  }

  async remove(id: string): Promise<void> {
    const container = await this.findByName(containerName(requireSafeKey(id, "sandbox id")));
    if (!container) return;
    const state = await container.inspect();
    if (state.State.Running) await container.stop({ t: 5 });
    await container.remove({ force: false, v: false });
    this.lastActivity.delete(id);
  }

  async browserTarget(id: string): Promise<{ host: string; port: number }> {
    const container = await this.requireContainer(containerName(requireSafeKey(id, "sandbox id")));
    const inspect = await container.inspect();
    if (inspect.Config.Labels?.["relay.browser"] !== "true") throw new Error("Sandbox has no browser");
    if (!inspect.State.Running) throw new Error("Sandbox is not running");
    this.markActive(id);
    const network = inspect.NetworkSettings.Networks?.[config.isolatedNetwork] ?? inspect.NetworkSettings.Networks?.[config.network];
    const host = network?.IPAddress;
    if (!host) throw new Error("Browser sandbox is not reachable from the proxy network");
    return { host, port: 6080 };
  }

  private async findByName(name: string): Promise<Container | null> {
    const containers = await this.docker.listContainers({ all: true, filters: { name: [name] } });
    const match = containers.find((container) => container.Names.some((entry) => entry === `/${name}`));
    return match ? this.docker.getContainer(match.Id) : null;
  }

  private async requireContainer(name: string): Promise<Container> {
    const container = await this.findByName(name);
    if (!container) throw new Error("Sandbox not found");
    return container;
  }

  private async describe(container: Container, browser: boolean): Promise<SandboxInfo> {
    const inspect = await container.inspect();
    const id = inspect.Config.Labels?.["relay.sandbox.id"] ?? inspect.Id.slice(0, 12);
    const computerUrl = browser ? this.views.viewUrl(id) : null;
    const proxyPort = computerUrl ? Number(new URL(computerUrl).port || (new URL(computerUrl).protocol === "https:" ? 443 : 80)) : null;
    return {
      id,
      containerId: inspect.Id,
      name: inspect.Name.replace(/^\//, ""),
      status: inspect.State.Status,
      browser,
      computerUrl,
      computerPort: proxyPort,
    };
  }
}
