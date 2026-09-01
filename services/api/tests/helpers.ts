import type { RelayConfig } from "../src/config.js";

export function testConfig(overrides: Partial<RelayConfig> = {}): RelayConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    databaseUrl: null,
    requireDatabase: false,
    authToken: "test-owner-token",
    agentAuthToken: "test-agent-token",
    workspaceId: "workspace-test",
    ownerId: "owner-test",
    runtimeMode: "mock",
    codexWorkerUrl: "http://127.0.0.1:4320",
    internalToken: "test-internal-token",
    sandboxManagerUrl: "http://127.0.0.1:4330",
    computerPublicHost: null,
    storagePath: "./data/test-artifacts",
    maxArtifactBytes: 5 * 1024 * 1024,
    agentWorkspaceRoot: "agents",
    workerPollMs: 10,
    maxDelegationDepth: 6,
    maxConcurrentRuns: 2,
    corsOrigins: [],
    connectorSecretKey: "test-connector-secret",
    ...overrides,
  };
}

export const authHeaders = { authorization: "Bearer test-owner-token" };
export const agentAuthHeaders = { authorization: "Bearer test-agent-token", "x-relay-agent-id": "agent-builder" };
