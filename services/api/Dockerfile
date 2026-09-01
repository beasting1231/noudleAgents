FROM node:22-bookworm-slim AS build
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/protocol ./packages/protocol
COPY services/api ./services/api
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @noudle-agents/protocol build && pnpm --filter @noudle-agents/api build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /workspace
RUN corepack enable
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/packages/protocol ./packages/protocol
COPY --from=build /workspace/packages/protocol/node_modules ./packages/protocol/node_modules
COPY --from=build /workspace/services/api/package.json ./services/api/package.json
COPY --from=build /workspace/services/api/node_modules ./services/api/node_modules
COPY --from=build /workspace/services/api/dist ./services/api/dist
RUN mkdir -p /data/artifacts && chown node:node /data/artifacts
USER node
EXPOSE 4310
CMD ["node", "services/api/dist/src/main.js"]
