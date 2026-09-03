import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ArtifactRecord } from "../src/model.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRelayApp, type RelayAppContext } from "../src/app.js";
import { MemoryRelayRepository } from "../src/database/memory-repository.js";
import { FakeSandboxManager } from "./fake-sandbox-manager.js";
import { testConfig } from "./helpers.js";

describe("artifact APIs", () => {
  let directory: string;
  let context: RelayAppContext;
  let baseUrl: string;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "relay-artifacts-test-"));
    context = await createRelayApp({
      config: testConfig({ storagePath: directory, workspacePath: path.join(directory, "workspace") }),
      repository: new MemoryRelayRepository(),
      sandboxManager: new FakeSandboxManager(),
      startWorker: false,
    });
    await context.app.listen({ host: "127.0.0.1", port: 0 });
    const address = context.app.server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP address");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    context.app.server.closeAllConnections();
    await context.app.close();
    await fs.rm(directory, { recursive: true, force: true });
  });

  async function upload(contents: string, fields: Record<string, string> = {}): Promise<Response> {
    const body = new FormData();
    body.append("file", new Blob([contents], { type: "text/plain" }), "notes.txt");
    for (const [key, value] of Object.entries(fields)) body.append(key, value);
    return fetch(`${baseUrl}/v1/artifacts`, {
      method: "POST",
      headers: { authorization: "Bearer test-owner-token" },
      body,
    });
  }

  it("uploads, lists, renames, and downloads content with checksum provenance", async () => {
    const response = await upload("verified artifact content", {
      name: "evidence.txt",
      taskId: (await context.service.createTask({ title: "Evidence", objective: "Store evidence" })).id,
      metadata: JSON.stringify({ purpose: "test" }),
    });
    expect(response.status).toBe(201);
    const artifact = (await response.json()) as ArtifactRecord;
    expect(artifact).toMatchObject({
      name: "evidence.txt",
      version: 1,
      mimeType: "text/plain",
      provenance: { source: "user_upload", createdByType: "user", createdById: "owner-test", originalName: "notes.txt" },
      metadata: { purpose: "test" },
    });
    expect(artifact.checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(path.isAbsolute(artifact.storageKey)).toBe(false);

    const list = await fetch(`${baseUrl}/v1/artifacts?taskId=${artifact.taskId}`, {
      headers: { authorization: "Bearer test-owner-token" },
    });
    expect(await list.json()).toEqual([artifact]);

    const renamed = await fetch(`${baseUrl}/v1/artifacts/${artifact.id}`, {
      method: "PATCH",
      headers: { authorization: "Bearer test-owner-token", "content-type": "application/json" },
      body: JSON.stringify({ name: "verified.txt" }),
    });
    expect((await renamed.json()).name).toBe("verified.txt");

    const download = await fetch(`${baseUrl}/v1/artifacts/${artifact.id}/download`, {
      headers: { authorization: "Bearer test-owner-token" },
    });
    expect(download.status).toBe(200);
    expect(await download.text()).toBe("verified artifact content");
    expect(download.headers.get("content-disposition")).toContain("verified.txt");
    expect(download.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await context.repository.listEvents("workspace-test", 0)).map((event) => event.type)).toEqual(
      expect.arrayContaining(["artifact.created", "artifact.updated"]),
    );
  });

  it("creates immutable logical versions linked to the parent", async () => {
    const first = (await (await upload("version one")).json()) as ArtifactRecord;
    const second = (await (await upload("version two", { parentArtifactId: first.id, name: "notes-v2.txt" })).json()) as ArtifactRecord;
    expect(second).toMatchObject({ logicalId: first.logicalId, version: 2, parentArtifactId: first.id });
    expect(second.checksum).not.toBe(first.checksum);
    expect((await context.artifacts.list({})).map((artifact) => artifact.version).sort()).toEqual([1, 2]);
  });

  it("attaches uploaded files to a message and materializes an agent-readable workspace path", async () => {
    const artifact = (await (await upload("visual evidence")).json()) as ArtifactRecord;
    const response = await fetch(`${baseUrl}/v1/conversations/conversation-builder/messages`, {
      method: "POST",
      headers: { authorization: "Bearer test-owner-token", "content-type": "application/json", "idempotency-key": "attachment-message" },
      body: JSON.stringify({ content: "Inspect this", attachmentIds: [artifact.id], agentId: "agent-builder", clientOperationId: "attachment-message" }),
    });
    expect(response.status).toBe(200);
    const message = (await response.json()).message;
    expect(message.attachments).toEqual([expect.objectContaining({ artifactId: artifact.id, name: "notes.txt", path: expect.stringMatching(/^\/workspace\/team\/chat-attachments\//) })]);
    const storedPath = path.join(directory, "workspace", message.attachments[0].path.replace("/workspace/", ""));
    expect(await fs.readFile(storedPath, "utf8")).toBe("visual evidence");
    expect((await fs.stat(path.dirname(storedPath))).mode & 0o777).toBe(0o755);
    expect((await fs.stat(storedPath)).mode & 0o777).toBe(0o644);
  });

  it("rejects agent attribution spoofing and storage path escapes", async () => {
    const body = new FormData();
    body.append("file", new Blob(["spoof"], { type: "text/plain" }), "spoof.txt");
    body.append("agentId", "agent-researcher");
    const spoof = await fetch(`${baseUrl}/v1/artifacts`, {
      method: "POST",
      headers: { authorization: "Bearer test-owner-token", "x-relay-agent-id": "agent-builder" },
      body,
    });
    expect(spoof.status).toBe(403);

    const valid = (await (await upload("valid")).json()) as ArtifactRecord;
    await context.repository.put("artifacts", { ...valid, storageKey: "../../outside.txt" });
    const escaped = await fetch(`${baseUrl}/v1/artifacts/${valid.id}/download`, {
      headers: { authorization: "Bearer test-owner-token" },
    });
    expect(escaped.status).toBe(500);
    expect((await escaped.json()).error.code).toBe("unsafe_storage_key");
    expect((await fetch(`${baseUrl}/v1/artifacts`)).status).toBe(401);
  });
});
