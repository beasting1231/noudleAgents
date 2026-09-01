FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY services/sandbox-manager/package.json services/sandbox-manager/package.json
RUN corepack enable && pnpm install --filter @noudle-agents/sandbox-manager... --frozen-lockfile=false
COPY services/sandbox-manager services/sandbox-manager
RUN pnpm --filter @noudle-agents/sandbox-manager build

FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/services/sandbox-manager/node_modules ./services/sandbox-manager/node_modules
COPY --from=build /app/services/sandbox-manager/dist ./services/sandbox-manager/dist
COPY services/sandbox-manager/package.json ./services/sandbox-manager/package.json
ENV NODE_ENV=production
EXPOSE 4330
CMD ["node", "services/sandbox-manager/dist/server.js"]
