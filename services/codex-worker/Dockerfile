FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY patches ./patches
COPY services/codex-worker/package.json services/codex-worker/package.json
COPY services/collaboration-mcp/package.json services/collaboration-mcp/package.json
RUN corepack enable && pnpm install --filter @noudle-agents/codex-worker... --filter @noudle-agents/collaboration-mcp... --frozen-lockfile=false
COPY services/codex-worker services/codex-worker
COPY services/collaboration-mcp services/collaboration-mcp
RUN pnpm --filter @noudle-agents/codex-worker build && pnpm --filter @noudle-agents/collaboration-mcp build

FROM node:22-bookworm-slim

ARG CODEX_VERSION=0.144.1
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git curl ripgrep \
  && rm -rf /var/lib/apt/lists/* \
  && npm install --global "@openai/codex@${CODEX_VERSION}" firebase-tools@15.28.2 \
  && useradd --create-home --uid 10001 relay \
  && mkdir -p /workspace /home/relay/.codex \
  && chown -R relay:relay /workspace /home/relay

WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/services/codex-worker/node_modules ./services/codex-worker/node_modules
COPY --from=build /app/services/codex-worker/dist ./services/codex-worker/dist
COPY --from=build /app/services/collaboration-mcp/node_modules ./services/collaboration-mcp/node_modules
COPY --from=build /app/services/collaboration-mcp/dist ./services/collaboration-mcp/dist
COPY services/codex-worker/package.json ./services/codex-worker/package.json
COPY services/collaboration-mcp/package.json ./services/collaboration-mcp/package.json

USER relay
ENV NODE_ENV=production
ENV RELAY_WORKSPACE_PATH=/workspace
ENV RELAY_CODEX_HOME=/home/relay/.codex
ENV XDG_CONFIG_HOME=/home/relay/.codex/config
EXPOSE 4320
CMD ["node", "services/codex-worker/dist/server.js"]
