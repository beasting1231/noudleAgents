import { describe, expect, it } from "vitest";
import { CreateAgentInputSchema, SendMessageInputSchema, TaskBudgetSchema } from "./index.js";

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
});
