import path from "node:path";
import { z } from "zod";

const raw = z.object({
  RELAY_SANDBOX_HOST: z.string().default("0.0.0.0"),
  RELAY_SANDBOX_PORT: z.coerce.number().int().min(1).max(65_535).default(4330),
  RELAY_INTERNAL_TOKEN: z.string().min(16).default("relay-local-internal-token"),
  RELAY_WORKSPACE_PATH: z.string().default(path.resolve(process.cwd(), "../../data/workspaces")),
  RELAY_AGENT_IMAGE: z.string().default("relay-agent-sandbox:local"),
  RELAY_DOCKER_NETWORK: z.string().default("relay-runtime"),
  RELAY_DOCKER_ISOLATED_NETWORK: z.string().default("relay-runtime-isolated"),
  RELAY_SANDBOX_PUBLIC_URL: z.string().url().default("http://127.0.0.1:4330"),
  RELAY_SANDBOX_VIEW_SECRET: z.string().min(16).optional(),
  RELAY_SANDBOX_MEMORY_MB: z.coerce.number().int().min(256).max(16_384).default(2048),
  RELAY_SANDBOX_CPUS: z.coerce.number().min(0.25).max(16).default(1.5),
  RELAY_SANDBOX_PIDS: z.coerce.number().int().min(128).max(4096).default(768),
}).parse(process.env);

export const config = {
  host: raw.RELAY_SANDBOX_HOST,
  port: raw.RELAY_SANDBOX_PORT,
  internalToken: raw.RELAY_INTERNAL_TOKEN,
  workspaceRoot: path.resolve(raw.RELAY_WORKSPACE_PATH),
  image: raw.RELAY_AGENT_IMAGE,
  network: raw.RELAY_DOCKER_NETWORK,
  isolatedNetwork: raw.RELAY_DOCKER_ISOLATED_NETWORK,
  publicUrl: raw.RELAY_SANDBOX_PUBLIC_URL.replace(/\/$/, ""),
  viewSecret: raw.RELAY_SANDBOX_VIEW_SECRET ?? raw.RELAY_INTERNAL_TOKEN,
  memoryBytes: raw.RELAY_SANDBOX_MEMORY_MB * 1024 * 1024,
  nanoCpus: Math.round(raw.RELAY_SANDBOX_CPUS * 1_000_000_000),
  pidsLimit: raw.RELAY_SANDBOX_PIDS,
};
