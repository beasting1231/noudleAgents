import { EventEmitter } from "node:events";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";

export interface JsonRpcRequest {
  id: number | string;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

export class JsonRpcLineClient extends EventEmitter {
  private nextId = 1;
  private readonly pending = new Map<number | string, PendingRequest>();
  private readonly process: ChildProcessWithoutNullStreams;
  private closed = false;

  constructor(child: ChildProcessWithoutNullStreams) {
    super();
    this.process = child;
    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY });
    lines.on("line", (line) => this.handleLine(line));
    child.stderr.on("data", (chunk: Buffer) => this.emit("stderr", chunk.toString("utf8")));
    child.on("exit", (code, signal) => this.close(new Error(`codex app-server exited code=${String(code)} signal=${String(signal)}`)));
    child.on("error", (error) => this.close(error));
  }

  request<T>(method: string, params: unknown, timeoutMs = 30_000): Promise<T> {
    if (this.closed) return Promise.reject(new Error("Codex App Server is not running"));
    const id = this.nextId++;
    const payload: JsonRpcRequest = { id, method, params };
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      this.write(payload);
    });
  }

  notify(method: string, params?: unknown): void {
    this.write(params === undefined ? { method } : { method, params });
  }

  respond(id: number | string, result: unknown): void {
    this.write({ id, result });
  }

  respondError(id: number | string, code: number, message: string, data?: unknown): void {
    this.write({ id, error: { code, message, ...(data === undefined ? {} : { data }) } });
  }

  stop(): void {
    this.process.kill("SIGTERM");
  }

  private write(payload: unknown): void {
    if (this.closed || !this.process.stdin.writable) throw new Error("Codex App Server transport is closed");
    this.process.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      this.emit("protocolError", new Error(`Invalid JSON from Codex App Server: ${line.slice(0, 500)}`));
      return;
    }
    if (!value || typeof value !== "object") return;
    const message = value as Record<string, unknown>;
    if ((typeof message.id === "number" || typeof message.id === "string") && ("result" in message || "error" in message)) {
      const request = this.pending.get(message.id);
      if (!request) return;
      clearTimeout(request.timer);
      this.pending.delete(message.id);
      if (message.error && typeof message.error === "object") {
        const error = message.error as { message?: unknown; code?: unknown };
        request.reject(new Error(`Codex RPC ${String(error.code ?? "error")}: ${String(error.message ?? "Unknown error")}`));
      } else {
        request.resolve(message.result);
      }
      return;
    }
    if (typeof message.method === "string" && (typeof message.id === "number" || typeof message.id === "string")) {
      this.emit("request", message as unknown as JsonRpcRequest);
      return;
    }
    if (typeof message.method === "string") this.emit("notification", message as unknown as JsonRpcNotification);
  }

  private close(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
    this.emit("close", error);
  }
}
