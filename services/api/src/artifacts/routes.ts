import { createReadStream } from "node:fs";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { RelayConfig } from "../config.js";
import { DomainError } from "../domain/errors.js";
import type { ArtifactService, StagedArtifact } from "./artifact-service.js";

const IdParamsSchema = z.object({ id: z.string().min(1).max(160) });
const ListQuerySchema = z.object({
  taskId: z.string().min(1).max(160).optional(),
  runId: z.string().min(1).max(160).optional(),
  agentId: z.string().min(1).max(160).optional(),
});
const RenameSchema = z.object({ name: z.string().trim().min(1).max(240) }).strict();
const MetadataSchema = z.record(z.string(), z.unknown());

function actor(request: FastifyRequest, config: RelayConfig): { type: "user" | "agent"; id: string } {
  const raw = request.headers["x-relay-agent-id"];
  const agentId = Array.isArray(raw) ? raw[0] : raw;
  return agentId ? { type: "agent", id: agentId } : { type: "user", id: config.ownerId };
}

function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export function registerArtifactRoutes(
  app: FastifyInstance,
  artifacts: ArtifactService,
  config: RelayConfig,
): void {
  app.get("/v1/artifacts", (request) => artifacts.list(ListQuerySchema.parse(request.query)));
  app.get("/v1/artifacts/:id", (request) => artifacts.get(IdParamsSchema.parse(request.params).id));

  app.post("/v1/artifacts", async (request, reply) => {
    if (!request.isMultipart()) throw new DomainError(415, "multipart_required", "Artifact upload requires multipart/form-data");
    const fields = new Map<string, string>();
    let staged: StagedArtifact | null = null;
    let fileName: string | null = null;
    let mimeType = "application/octet-stream";
    try {
      for await (const part of request.parts()) {
        if (part.type === "file") {
          if (staged) throw new DomainError(400, "multiple_files", "Exactly one artifact file is allowed");
          fileName = part.filename;
          mimeType = part.mimetype;
          staged = await artifacts.stage(part.file);
          if (part.file.truncated) throw new DomainError(413, "artifact_too_large", "Artifact exceeds the upload limit");
        } else {
          if (fields.has(part.fieldname)) throw new DomainError(400, "duplicate_field", `Duplicate field '${part.fieldname}'`);
          fields.set(part.fieldname, String(part.value));
        }
      }
      if (!staged || !fileName) throw new DomainError(400, "file_required", "Multipart field 'file' is required");
      const requestActor = actor(request, config);
      const source = z
        .enum(["user_upload", "agent_output", "sandbox_export"])
        .parse(fields.get("source") ?? (requestActor.type === "agent" ? "agent_output" : "user_upload"));
      const metadata = fields.has("metadata") ? MetadataSchema.parse(JSON.parse(fields.get("metadata")!)) : {};
      const artifact = await artifacts.create(staged, {
        name: fields.get("name") ?? fileName,
        originalName: fileName,
        mimeType: z.string().min(1).max(160).regex(/^[^\r\n]+$/).parse(mimeType),
        taskId: fields.get("taskId") ?? null,
        runId: fields.get("runId") ?? null,
        agentId: fields.get("agentId") ?? (requestActor.type === "agent" ? requestActor.id : null),
        parentArtifactId: fields.get("parentArtifactId") ?? null,
        source,
        metadata,
        actorType: requestActor.type,
        actorId: requestActor.id,
      });
      staged = null;
      return reply.code(201).send(artifact);
    } catch (error) {
      if (staged) await artifacts.discard(staged).catch(() => undefined);
      if (error instanceof SyntaxError) throw new DomainError(400, "invalid_metadata", "Artifact metadata must be valid JSON");
      throw error;
    }
  });

  app.get("/v1/artifacts/:id/download", async (request, reply) => {
    const { artifact, path } = await artifacts.download(IdParamsSchema.parse(request.params).id);
    return reply
      .header("content-type", artifact.mimeType)
      .header("content-length", String(artifact.size))
      .header("content-disposition", contentDisposition(artifact.name))
      .header("etag", `"${artifact.checksum}"`)
      .header("x-content-type-options", "nosniff")
      .send(createReadStream(path));
  });

  app.patch("/v1/artifacts/:id", (request) => {
    const requestActor = actor(request, config);
    return artifacts.rename(
      IdParamsSchema.parse(request.params).id,
      RenameSchema.parse(request.body).name,
      requestActor.type,
      requestActor.id,
    );
  });
}
