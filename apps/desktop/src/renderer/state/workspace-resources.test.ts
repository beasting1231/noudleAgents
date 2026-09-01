import { describe, expect, it } from "vitest";
import { createWorkspaceResourceState, formatBytes, workspaceResourceReducer } from "./workspace-resources";

describe("workspaceResourceReducer", () => {
  it("keeps the selected computer across a server refresh", () => {
    const initial = createWorkspaceResourceState();
    const selected = workspaceResourceReducer(initial, { type: "select_computer", id: "computer-fabric-demo" });
    const refreshed = workspaceResourceReducer(selected, { type: "replace", artifacts: initial.artifacts, computers: initial.computers, mode: "live" });
    expect(refreshed.selectedComputerId).toBe("computer-fabric-demo");
    expect(refreshed.mode).toBe("live");
  });

  it("records takeover changes without duplicating a session", () => {
    const initial = createWorkspaceResourceState();
    const computer = initial.computers[0];
    if (!computer) throw new Error("demo computer missing");
    const result = workspaceResourceReducer(initial, { type: "upsert_computer", computer: { ...computer, controlMode: "user", controlHolderId: "user_local_owner" } });
    expect(result.computers).toHaveLength(1);
    expect(result.computers[0]?.controlMode).toBe("user");
  });

  it("removes a stopped session and clears selection", () => {
    const initial = createWorkspaceResourceState();
    const id = initial.computers[0]?.id;
    if (!id) throw new Error("demo computer missing");
    const result = workspaceResourceReducer(initial, { type: "remove_computer", id });
    expect(result.computers).toHaveLength(0);
    expect(result.selectedComputerId).toBeNull();
  });
});

describe("formatBytes", () => {
  it("formats compact file sizes", () => {
    expect(formatBytes(850)).toBe("850 B");
    expect(formatBytes(12_480)).toBe("12 KB");
    expect(formatBytes(2_621_440)).toBe("2.5 MB");
  });
});
