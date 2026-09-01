import type { FastifyInstance } from "fastify";
import { ConnectorProviderSchema } from "@noudle-agents/protocol";
import { z } from "zod";
import type { ConnectorService } from "./connector-service.js";

const ParamsSchema = z.object({ provider: ConnectorProviderSchema });
const ConnectSchema = z.object({ secret: z.string().min(1).max(10_000) }).strict();

function agentActor(request: { headers: Record<string, string | string[] | undefined> }): string | null {
  const header = request.headers["x-relay-agent-id"];
  if (Array.isArray(header)) return header[0] ?? null;
  return header ?? null;
}

export function registerConnectorRoutes(app: FastifyInstance, connectors: ConnectorService, ownerId: string): void {
  app.get("/v1/connectors", () => connectors.list());
  app.put("/v1/connectors/:provider", (request) => {
    const { provider } = ParamsSchema.parse(request.params);
    const actorId = agentActor(request);
    return connectors.connect(provider, ConnectSchema.parse(request.body).secret, actorId ? "agent" : "user", actorId ?? ownerId);
  });
  app.delete("/v1/connectors/:provider", async (request, reply) => {
    const actorId = agentActor(request);
    await connectors.disconnect(ParamsSchema.parse(request.params).provider, actorId ? "agent" : "user", actorId ?? ownerId);
    return reply.code(204).send();
  });
}
