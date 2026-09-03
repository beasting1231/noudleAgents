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

  it("forwards mobile keyboard text and control keys to the selected computer", async () => {
    const payload = { computer: { id: "computer-1" }, result: { action: "type", width: 1280, height: 720, mimeType: "image/jpeg", image: "jpeg" } };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response(JSON.stringify(payload), { status: 200 })));
    const api = new WorkspaceApi("http://relay.local", "secret");
    await api.typeComputer("computer-1", "hello");
    await api.keyComputer("computer-1", "ENTER");
    expect(fetchMock).toHaveBeenNthCalledWith(1, "http://relay.local/v1/computers/desktop/action", expect.objectContaining({ body: JSON.stringify({ action: "type", computerId: "computer-1", text: "hello" }) }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "http://relay.local/v1/computers/desktop/action", expect.objectContaining({ body: JSON.stringify({ action: "key", computerId: "computer-1", key: "ENTER" }) }));
  });

  it("builds a stable authenticated computer view URL", () => {
    expect(new WorkspaceApi("https://relay.example.com/", "secret").computerViewUrl("computer/a b"))
      .toBe("https://relay.example.com/v1/computers/computer%2Fa%20b/view");
  });

  it("rewrites only loopback stream hosts for phone access", () => {
    expect(resolveComputerUrl("http://127.0.0.1:49152/vnc.html?x=1", "http://192.168.1.20:4310")).toBe("http://192.168.1.20:49152/vnc.html?x=1");
    expect(resolveComputerUrl("https://stream.example.com/view", "http://192.168.1.20:4310")).toBe("https://stream.example.com/view");
  });
});
