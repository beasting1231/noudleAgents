import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { RelayConfig } from "../config.js";
import type { MessageAttachment } from "@noudle-agents/protocol";
import type { RelayRepository } from "../database/repository.js";
import { conflict, DomainError, notFound } from "../domain/errors.js";
import type { RelayService } from "../domain/relay-service.js";
import type { ArtifactProvenance, ArtifactRecord } from "../model.js";

export interface StagedArtifact {
  path: string;
  size: number;
  checksum: string;
}

export interface CreateArtifactInput {
  name: string;
  originalName: string | null;
  mimeType: string;
  taskId: string | null;
  runId: string | null;
  agentId: string | null;
  parentArtifactId: string | null;
  source: ArtifactProvenance["source"];
  metadata: Record<string, unknown>;
  actorType: "user" | "agent";
  actorId: string;
}

function safeName(value: string): string {
  const name = path.basename(value).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!name || name === "." || name === "..") throw new DomainError(400, "invalid_file_name", "Artifact name is invalid");
  return name.slice(0, 240);
}

export class ArtifactService {
  private readonly root: string;

  constructor(
    private readonly repository: RelayRepository,
    private readonly relay: RelayService,
    private readonly config: RelayConfig,
  ) {
    this.root = path.resolve(config.storagePath);
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    await fs.mkdir(path.join(this.root, ".staging"), { recursive: true, mode: 0o700 });
  }

  async stage(stream: AsyncIterable<Uint8Array | string>): Promise<StagedArtifact> {
    const stagedPath = path.join(this.root, ".staging", `${randomUUID()}.upload`);
    const handle = await fs.open(stagedPath, "wx", 0o600);
    const hash = createHash("sha256");
    let size = 0;
    try {
      for await (const raw of stream) {
        const chunk = typeof raw === "string" ? Buffer.from(raw) : Buffer.from(raw);
        size += chunk.byteLength;
        if (size > this.config.maxArtifactBytes) {
          throw new DomainError(413, "artifact_too_large", `Artifact exceeds the ${this.config.maxArtifactBytes} byte limit`);
        }
        hash.update(chunk);
        await handle.write(chunk);
      }
      await handle.sync();
      return { path: stagedPath, size, checksum: `sha256:${hash.digest("hex")}` };
    } catch (error) {
      await fs.rm(stagedPath, { force: true }).catch(() => undefined);
      throw error;
    } finally {
      await handle.close();
    }
  }

  async discard(staged: StagedArtifact): Promise<void> {
    await fs.rm(staged.path, { force: true });
  }

  async list(filters: { taskId?: string | undefined; runId?: string | undefined; agentId?: string | undefined }): Promise<ArtifactRecord[]> {
    const artifacts = await this.repository.list("artifacts", this.config.workspaceId);
    return artifacts
      .filter((artifact) => !filters.taskId || artifact.taskId === filters.taskId)
      .filter((artifact) => !filters.runId || artifact.runId === filters.runId)
      .filter((artifact) => !filters.agentId || artifact.agentId === filters.agentId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async get(id: string): Promise<ArtifactRecord> {
    const artifact = await this.repository.get("artifacts", id);
    if (!artifact || artifact.workspaceId !== this.config.workspaceId) throw notFound("Artifact", id);
    return artifact;
  }

  private async validateReferences(input: CreateArtifactInput): Promise<void> {
    if (input.actorType === "agent") await this.relay.getAgent(input.actorId);
    if (input.taskId) await this.relay.getTask(input.taskId);
    if (input.runId) await this.relay.getRun(input.runId);
    if (input.agentId) await this.relay.getAgent(input.agentId);
    if (input.actorType === "agent" && input.agentId && input.agentId !== input.actorId) {
      throw new DomainError(403, "artifact_agent_mismatch", "An agent cannot attribute an upload to another agent");
    }
  }

  async create(staged: StagedArtifact, input: CreateArtifactInput): Promise<ArtifactRecord> {
    await this.validateReferences(input);
    const parent = input.parentArtifactId ? await this.get(input.parentArtifactId) : null;
    const existing = parent
      ? (await this.repository.list("artifacts", this.config.workspaceId)).filter((item) => item.logicalId === parent.logicalId)
      : [];
    const version = parent ? Math.max(...existing.map((item) => item.version)) + 1 : 1;
    const id = `art_${randomUUID()}`;
    const logicalId = parent?.logicalId ?? `artifact_${randomUUID()}`;
    const workspaceHash = createHash("sha256").update(this.config.workspaceId).digest("hex").slice(0, 24);
    const storageKey = `${workspaceHash}/${id}/v${version}.blob`;
    const destination = this.resolveStorageKey(storageKey);
    const now = new Date().toISOString();
    const artifact: ArtifactRecord = {
      id,
      logicalId,
      workspaceId: this.config.workspaceId,
      version,
      parentArtifactId: parent?.id ?? null,
      taskId: input.taskId ?? parent?.taskId ?? null,
      runId: input.runId ?? parent?.runId ?? null,
      agentId: input.agentId ?? parent?.agentId ?? null,
      name: safeName(input.name),
      mimeType: input.mimeType,
      size: staged.size,
      checksum: staged.checksum,
      storageKey,
      provenance: {
        source: input.source,
        createdByType: input.actorType,
        createdById: input.actorId,
        originalName: input.originalName ? safeName(input.originalName) : null,
      },
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
    };
    await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await fs.rename(staged.path, destination);
    try {
      await this.repository.put("artifacts", artifact);
      await this.relay.emit({
        workspaceId: artifact.workspaceId,
        aggregateType: "artifact",
        aggregateId: artifact.id,
        type: "artifact.created",
        actorType: input.actorType,
        actorId: input.actorId,
        payload: { artifact },
      });
      return artifact;
    } catch (error) {
      await fs.rm(destination, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async rename(id: string, name: string, actorType: "user" | "agent", actorId: string): Promise<ArtifactRecord> {
    if (actorType === "agent") await this.relay.getAgent(actorId);
    const current = await this.get(id);
    const artifact: ArtifactRecord = { ...current, name: safeName(name), updatedAt: new Date().toISOString() };
    await this.repository.put("artifacts", artifact);
    await this.relay.emit({
      workspaceId: artifact.workspaceId,
      aggregateType: "artifact",
      aggregateId: artifact.id,
      type: "artifact.updated",
      actorType,
      actorId,
      payload: { artifact, changed: ["name"] },
    });
    return artifact;
  }

  async download(id: string): Promise<{ artifact: ArtifactRecord; path: string }> {
    const artifact = await this.get(id);
    const filePath = this.resolveStorageKey(artifact.storageKey);
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat?.isFile()) throw conflict("artifact_missing", "Artifact metadata exists but its content is unavailable");
    if (stat.size !== artifact.size) throw conflict("artifact_size_mismatch", "Artifact content failed its size integrity check");
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
    if (`sha256:${hash.digest("hex")}` !== artifact.checksum) {
      throw conflict("artifact_checksum_mismatch", "Artifact content failed its checksum integrity check");
    }
    return { artifact, path: filePath };
  }

  async materializeForMessage(ids: string[], messageId: string): Promise<MessageAttachment[]> {
    if (new Set(ids).size !== ids.length) throw new DomainError(400, "duplicate_attachment", "Each attachment can only be added once");
    const targetDirectory = path.resolve(this.config.workspacePath, "team", "chat-attachments", messageId);
    // The API and Codex worker run as different unprivileged users while sharing
    // this workspace volume. Materialized message attachments must therefore be
    // readable by the worker, while remaining immutable to it.
    await fs.mkdir(targetDirectory, { recursive: true, mode: 0o755 });
    const attachments: MessageAttachment[] = [];
    try {
      for (const [index, id] of ids.entries()) {
        const { artifact, path: source } = await this.download(id);
        const name = safeName(artifact.name);
        const storedName = `${String(index + 1).padStart(2, "0")}-${name}`;
        const target = path.join(targetDirectory, storedName);
        await fs.copyFile(source, target);
        await fs.chmod(target, 0o644);
        attachments.push({
          artifactId: artifact.id,
          name,
          mimeType: artifact.mimeType,
          size: artifact.size,
          path: `/workspace/team/chat-attachments/${messageId}/${storedName}`,
        });
      }
      return attachments;
    } catch (error) {
      await fs.rm(targetDirectory, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  private resolveStorageKey(storageKey: string): string {
    if (path.isAbsolute(storageKey) || storageKey.includes("\u0000")) {
      throw new DomainError(500, "unsafe_storage_key", "Artifact storage key is unsafe");
    }
    const resolved = path.resolve(this.root, storageKey);
    if (resolved !== this.root && !resolved.startsWith(`${this.root}${path.sep}`)) {
      throw new DomainError(500, "unsafe_storage_key", "Artifact storage key escapes the configured root");
    }
    return resolved;
  }
}
