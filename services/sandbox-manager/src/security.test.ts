import { describe, expect, it } from "vitest";
import { containerName, requireSafeKey, resolveWorkspace } from "./security.js";

describe("sandbox security", () => {
  it("accepts bounded identifiers", () => {
    expect(containerName("Agent_12")).toBe("relay-agent-agent_12");
    expect(resolveWorkspace("/srv/relay/workspaces", "workspace-1")).toBe("/srv/relay/workspaces/workspace-1");
    expect(resolveWorkspace("/srv/relay/workspaces", "agents/agent-builder")).toBe("/srv/relay/workspaces/agents/agent-builder");
  });

  it("rejects traversal and shell-like identifiers", () => {
    expect(() => requireSafeKey("../escape", "key")).toThrow();
    expect(() => requireSafeKey("agent;rm", "key")).toThrow();
    expect(() => resolveWorkspace("/srv/relay/workspaces", "agents/../escape")).toThrow();
    expect(() => resolveWorkspace("/srv/relay/workspaces", "/absolute/path")).toThrow();
  });
});
