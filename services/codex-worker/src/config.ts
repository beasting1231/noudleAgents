import path from "node:path";
import { z } from "zod";

const ConfigSchema = z.object({
  RELAY_CODEX_WORKER_HOST: z.string().default("0.0.0.0"),
  RELAY_CODEX_WORKER_PORT: z.coerce.number().int().min(1).max(65_535).default(4320),
  RELAY_CODEX_BIN: z.string().default("codex"),
  RELAY_CODEX_HOME: z.string().optional(),
  RELAY_CODEX_MODEL: z.string().optional(),
  RELAY_CODEX_REASONING_EFFORT: z.enum(["minimal", "low", "medium", "high", "xhigh", "max", "ultra"]).optional(),
  RELAY_WORKSPACE_PATH: z.string().default(path.resolve(process.cwd(), "../../data/workspaces")),
  RELAY_INTERNAL_TOKEN: z.string().min(16).default("relay-local-internal-token"),
  RELAY_CODEX_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30_000),
  RELAY_COLLABORATION_MCP_SCRIPT: z.string().optional(),
  RELAY_API_URL: z.string().url().default("http://127.0.0.1:4310"),
  RELAY_AGENT_API_TOKEN: z.string().default("relay-local-agent-token"),
});

const raw = ConfigSchema.parse(process.env);

export const config = {
  host: raw.RELAY_CODEX_WORKER_HOST,
  port: raw.RELAY_CODEX_WORKER_PORT,
  codexBin: raw.RELAY_CODEX_BIN,
  codexHome: raw.RELAY_CODEX_HOME,
  model: raw.RELAY_CODEX_MODEL,
  effort: raw.RELAY_CODEX_REASONING_EFFORT,
  workspaceRoot: path.resolve(raw.RELAY_WORKSPACE_PATH),
  internalToken: raw.RELAY_INTERNAL_TOKEN,
  requestTimeoutMs: raw.RELAY_CODEX_REQUEST_TIMEOUT_MS,
  collaborationMcpScript: raw.RELAY_COLLABORATION_MCP_SCRIPT,
  relayApiUrl: raw.RELAY_API_URL,
  relayApiToken: raw.RELAY_AGENT_API_TOKEN,
};

export type WorkerConfig = typeof config;
