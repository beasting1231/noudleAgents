export interface RelayConfig {
  host: string;
  port: number;
  databaseUrl: string | null;
  requireDatabase: boolean;
  authToken: string;
  agentAuthToken: string;
  workspaceId: string;
  ownerId: string;
  runtimeMode: "mock" | "codex";
  codexWorkerUrl: string;
  internalToken: string;
  sandboxManagerUrl: string;
  computerPublicHost: string | null;
  storagePath: string;
  maxArtifactBytes: number;
  agentWorkspaceRoot: string;
  workerPollMs: number;
  maxDelegationDepth: number;
  maxConcurrentRuns: number;
  corsOrigins: string[];
  connectorSecretKey: string;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RelayConfig {
  return {
    host: env.RELAY_HOST ?? "0.0.0.0",
    port: positiveInteger(env.RELAY_PORT, 4310),
    databaseUrl: env.RELAY_DATABASE_URL?.trim() || null,
    requireDatabase: env.RELAY_REQUIRE_DATABASE === "true" || env.NODE_ENV === "production",
    authToken: env.RELAY_DEV_AUTH_TOKEN ?? "relay-local-owner",
    agentAuthToken: env.RELAY_AGENT_API_TOKEN ?? "relay-local-agent-token",
    workspaceId: env.RELAY_WORKSPACE_ID ?? "workspace-local",
    ownerId: env.RELAY_OWNER_ID ?? "local-owner",
    runtimeMode: env.RELAY_CODEX_MODE === "codex" ? "codex" : "mock",
    codexWorkerUrl: (env.RELAY_CODEX_WORKER_URL ?? "http://127.0.0.1:4320").replace(/\/$/, ""),
    internalToken: env.RELAY_INTERNAL_TOKEN ?? "relay-local-internal-token",
    sandboxManagerUrl: (env.RELAY_SANDBOX_MANAGER_URL ?? "http://127.0.0.1:4330").replace(/\/$/, ""),
    computerPublicHost: env.RELAY_COMPUTER_PUBLIC_HOST?.trim() || null,
    storagePath: env.RELAY_STORAGE_PATH ?? "./data/artifacts",
    maxArtifactBytes: positiveInteger(env.RELAY_MAX_ARTIFACT_MB, 100) * 1024 * 1024,
    agentWorkspaceRoot: env.RELAY_AGENT_WORKSPACE_ROOT ?? "agents",
    workerPollMs: positiveInteger(env.RELAY_WORKER_POLL_MS, 50),
    maxDelegationDepth: positiveInteger(env.RELAY_MAX_DELEGATION_DEPTH, 6),
    maxConcurrentRuns: positiveInteger(env.RELAY_MAX_CONCURRENT_RUNS, 4),
    corsOrigins: (env.RELAY_CORS_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    connectorSecretKey: env.RELAY_CONNECTOR_SECRET_KEY ?? env.RELAY_INTERNAL_TOKEN ?? "relay-local-connector-secret",
  };
}
