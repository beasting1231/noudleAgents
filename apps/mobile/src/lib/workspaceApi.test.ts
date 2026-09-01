import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveComputerUrl, WorkspaceApi } from "./workspaceApi";

afterEach(() => vi.restoreAllMocks());

describe("WorkspaceApi", () => {
  it("authorizes and filters artifact requests", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("[]", { status: 200, headers: { "content-type": "application/json" } }));
    await new WorkspaceApi("http://relay.local/", "secret").listArtifacts({ taskId: "task 1" });
    expect(fetchMock).toHaveBeenCalledWith("http://relay.local/v1/artifacts?taskId=task+1", expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer secret" }) }));
  });

  it("sends rename requests as JSON", async () => {
    const artifact = { id: "artifact-1", name: "new.md" };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(artifact), { status: 200 }));
    await new WorkspaceApi("http://relay.local", "secret").renameArtifact("artifact-1", "new.md");
    expect(fetchMock).toHaveBeenCalledWith("http://relay.local/v1/artifacts/artifact-1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ name: "new.md" }) }));
  });

  it("blocks arbitrary terminal commands on the client", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(new WorkspaceApi("http://relay.local", "secret").execComputer("computer-1", ["rm", "-rf", "/workspace"])).rejects.toThrow("pre-approved read-only");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows a predefined terminal action", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ exitCode: 0, stdout: "/workspace\n", stderr: "" }), { status: 200 }));
    await new WorkspaceApi("http://relay.local", "secret").execComputer("computer-1", ["pwd"]);
    expect(fetchMock).toHaveBeenCalledWith("http://relay.local/v1/computers/computer-1/exec", expect.objectContaining({ method: "POST" }));
  });

  it("rewrites only loopback stream hosts for phone access", () => {
    expect(resolveComputerUrl("http://127.0.0.1:49152/vnc.html?x=1", "http://192.168.1.20:4310")).toBe("http://192.168.1.20:49152/vnc.html?x=1");
    expect(resolveComputerUrl("https://stream.example.com/view", "http://192.168.1.20:4310")).toBe("https://stream.example.com/view");
  });
});
