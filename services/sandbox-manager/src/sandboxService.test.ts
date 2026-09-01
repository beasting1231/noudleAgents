import type Docker from "dockerode";
import { describe, expect, it } from "vitest";
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
});
