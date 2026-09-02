import type Docker from "dockerode";
import { describe, expect, it } from "vitest";
import { config } from "./config.js";
import { SandboxService } from "./sandboxService.js";

describe("sandbox lifecycle", () => {
  it("treats removal of an already-missing managed container as success", async () => {
    const docker = {
      listContainers: async () => [],
      getContainer: () => {
        throw new Error("getContainer must not be called");
      },
    } as unknown as Docker;
    const service = new SandboxService(docker);
    await expect(service.remove("missing-session")).resolves.toBeUndefined();
  });

  it("suspends an idle browser computer while leaving its persistent volumes intact", async () => {
    let stops = 0;
    const docker = {
      listContainers: async () => [{
        Id: "container-builder",
        State: "running",
        Labels: { "relay.sandbox.id": "cmp-builder", "relay.browser": "true", "relay.managed": "true" },
      }],
      getContainer: () => ({ stop: async () => { stops += 1; } }),
    } as unknown as Docker;
    const service = new SandboxService(docker);

    expect(await service.suspendIdle(1_000)).toEqual([]);
    expect(await service.suspendIdle(1_000 + config.idleMilliseconds - 1)).toEqual([]);
    expect(await service.suspendIdle(1_000 + config.idleMilliseconds)).toEqual(["cmp-builder"]);
    expect(stops).toBe(1);
  });
});
