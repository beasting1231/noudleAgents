import type { FastifyInstance } from "fastify";
import { ConnectorProviderSchema, ConnectorRequestInputSchema, CreateCustomConnectorInputSchema } from "@noudle-agents/protocol";
import { z } from "zod";
import type { ConnectorService } from "./connector-service.js";

const ProviderParamsSchema = z.object({ provider: ConnectorProviderSchema });
const IdParamsSchema = z.object({ id: z.string().min(1).max(160) });
const ConnectSchema = z.object({ secret: z.string().min(1).max(10_000) }).strict();

function agentActor(request: { headers: Record<string, string | string[] | undefined> }): string | null {
  const header = request.headers["x-relay-agent-id"];
  if (Array.isArray(header)) return header[0] ?? null;
  return header ?? null;
}

export function registerConnectorRoutes(app: FastifyInstance, connectors: ConnectorService, ownerId: string): void {
  app.get("/v1/connectors", () => connectors.list());
  app.post("/v1/connectors", async (request, reply) => {
    const actorId = agentActor(request);
    const connector = await connectors.createCustom(
      CreateCustomConnectorInputSchema.parse(request.body),
      actorId ? "agent" : "user",
      actorId ?? ownerId,
    );
    return reply.code(201).send(connector);
  });
  app.put("/v1/connectors/:provider", (request) => {
    const { provider } = ProviderParamsSchema.parse(request.params);
    const actorId = agentActor(request);
    return connectors.connect(provider, ConnectSchema.parse(request.body).secret, actorId ? "agent" : "user", actorId ?? ownerId);
  });
  app.post("/v1/connectors/:id/request", (request) => {
    const actorId = agentActor(request);
    return connectors.request(
      IdParamsSchema.parse(request.params).id,
      ConnectorRequestInputSchema.parse(request.body),
      actorId ? "agent" : "user",
      actorId ?? ownerId,
    );
  });
  app.delete("/v1/connectors/:id", async (request, reply) => {
    const actorId = agentActor(request);
    await connectors.disconnect(IdParamsSchema.parse(request.params).id, actorId ? "agent" : "user", actorId ?? ownerId);
    return reply.code(204).send();
  });
}
