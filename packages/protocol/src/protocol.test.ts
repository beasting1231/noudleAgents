import { describe, expect, it } from "vitest";
import { CreateAgentInputSchema, decodeMobilePairingPayload, encodeMobilePairingPayload, SendMessageInputSchema, TaskBudgetSchema } from "./index.js";

describe("protocol", () => {
  it("normalizes an agent input", () => {
    const result = CreateAgentInputSchema.parse({ name: "Research", role: "Research specialist" });
    expect(result.name).toBe("Research");
  });

  it("applies safe task budget defaults", () => {
    expect(TaskBudgetSchema.parse({})).toEqual({
      maxTokens: 100_000,
      maxWallSeconds: 3600,
      maxChildTasks: 4,
    });
  });

  it("validates composer runtime settings without exposing permissions", () => {
    const result = SendMessageInputSchema.parse({
      content: "Build it",
      agentId: "agent-builder",
      clientOperationId: "operation-1",
      settings: { model: "gpt-5.6-terra", reasoning: "high", speed: "extra-fast" },
    });
    expect(result.settings).toEqual({ model: "gpt-5.6-terra", reasoning: "high", speed: "extra-fast" });
    expect(result.settings).not.toHaveProperty("permissionMode");
  });

  it("round-trips a versioned mobile pairing code", () => {
    const payload = { type: "noudleAgents.mobile-pair" as const, version: 1 as const, baseUrl: "https://agents.example.com", token: "owner-secret" };
    expect(decodeMobilePairingPayload(encodeMobilePairingPayload(payload))).toEqual(payload);
  });

  it("rejects unrelated QR content and unsupported URLs", () => {
    expect(() => decodeMobilePairingPayload("https://example.com")).toThrow();
    expect(() => decodeMobilePairingPayload(JSON.stringify({ type: "noudleAgents.mobile-pair", version: 1, baseUrl: "file:///tmp/server", token: "secret" }))).toThrow();
  });
});
