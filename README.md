# noudleAgents

noudleAgents is an open-source, cross-device workspace for persistent Codex agents. It has a shared PostgreSQL control plane, a three-pane Electron desktop client, an Expo/React Native iPhone client, a real Codex App Server runtime, inter-agent task delegation, approval gates, and isolated Linux browser/terminal sandboxes.

Desktop and iPhone are clients of the same server. Chats, agents, tasks, run state, and approvals are authoritative in PostgreSQL and propagate through replayable server-sent events.

## What is implemented

- Agent and conversation management with direct and team chats
- Persistent message history and idempotent message submission
- Durable task graph with child tasks, delegation, blocking, and completion
- Agent roster and task/context inspection available to every agent through the noudleAgents collaboration MCP server
- Agent-to-agent messages and delegated work through authenticated control-plane calls
- Durable run queue with interruption and replay after restart
- Risk-based approval requests and approve/deny flow
- Real Codex CLI integration through `codex app-server --stdio`
- Persistent Codex thread IDs, resume, streamed text/tool events, and interrupt support
- Electron desktop app with chat, agents, tasks, approvals, context panel, and command palette
- React Native iPhone app with chats, tasks, approvals, library/settings, and secure token storage
- Versioned file upload, download, rename, checksum, provenance, and persistent artifact storage
- Live computer sessions with noVNC watch, five-minute takeover leases, return-to-agent, and audited terminal execution
- HMAC-capability noVNC reverse proxy with no sandbox ports exposed on the host
- Hardened non-root Linux agent containers with terminal, Chromium, Playwright, Xvfb, and noVNC
- Seeded demo mode in both clients when no server is reachable

Skills, routines, evidence-backed memory, push notifications, and global search remain the planned P1 beta slice described in the PRD.

## Architecture

```text
Electron desktop ─┐
                  ├── HTTPS / SSE ── noudleAgents API ── PostgreSQL
React Native iOS ─┘                     │
                                       ├── Codex worker ── codex app-server
                                       │       └── noudleAgents collaboration MCP
                                       └── Sandbox manager ── isolated Linux containers
```

The API is the only product-state authority. Codex credentials stay inside the trusted worker. The sandbox manager is the only service with Docker access; spawned agent containers do not receive the Docker socket or Codex credentials. Browser containers sit on an internal no-egress network and expose no host ports; the manager relays noVNC HTTP/WebSocket traffic through a signed, session-specific capability URL.

## Prerequisites

- macOS, Linux, or Windows with Docker Desktop/Engine and Compose
- Node.js 22+
- pnpm 10+ through Corepack
- A Codex account for real agent runs
- Xcode and an Apple developer setup only when building the native iPhone binary

## Fast local start

Install and verify the monorepo:

```bash
corepack enable
pnpm install
pnpm check
```

Build the agent sandbox once:

```bash
docker build -f infra/agent-image/Dockerfile -t relay-agent-sandbox:local .
```

Start PostgreSQL and the API in deterministic mock-agent mode:

```bash
docker compose \
  -f infra/compose/docker-compose.yml \
  -f infra/compose/docker-compose.dev.yml \
  up -d postgres api
```

The API is at `http://127.0.0.1:4310`; the local owner token is `relay-local-owner`. Verify it:

```bash
curl http://127.0.0.1:4310/health
curl -H 'Authorization: Bearer relay-local-owner' http://127.0.0.1:4310/v1/snapshot
```

Run the desktop app:

```bash
pnpm dev:desktop
```

Run the mobile app:

```bash
pnpm dev:mobile
```

In the iPhone app, open Library → Settings and enter:

- Instance URL: `http://YOUR_MAC_LAN_IP:4310`
- Access token: `relay-local-owner`

`localhost` on an iPhone means the iPhone itself. The API is bound to loopback in the default Compose file for safety. On a trusted LAN, expose it to the phone with `pnpm infra:up:lan`, then use the Mac's LAN IP. An authenticated HTTPS tunnel is the safer alternative on an untrusted network. Do not expose the development token to the public internet.

## Run real Codex agents

Build and start the complete stack:

```bash
docker compose -f infra/compose/docker-compose.yml build
docker compose -f infra/compose/docker-compose.yml up -d
```

Authenticate the worker once. Authentication is stored in the private `relay-codex-home` Docker volume and is never copied into an image:

```bash
docker compose -f infra/compose/docker-compose.yml run --rm codex-worker codex login --device-auth
docker compose -f infra/compose/docker-compose.yml restart codex-worker
```

Check the services:

```bash
curl http://127.0.0.1:4310/health
docker compose -f infra/compose/docker-compose.yml exec codex-worker \
  curl -fsS http://127.0.0.1:4320/health
docker compose -f infra/compose/docker-compose.yml ps
```

Sending a message to an agent now creates a durable run, starts or resumes that agent's Codex thread, streams progress to every connected client, and stores the final response. Agents receive the collaboration MCP server automatically, so they can inspect the roster, read task context, delegate child tasks, send agent messages, and report blocked/completed work.

## Configuration

Copy `.env.example` to `.env` for local overrides. Important values:

| Variable | Purpose | Default |
|---|---|---|
| `RELAY_DEV_AUTH_TOKEN` | Local client bearer token | `relay-local-owner` |
| `RELAY_INTERNAL_TOKEN` | Service-to-service token | local development value |
| `RELAY_CODEX_MODE` | `codex` or deterministic `mock` | `codex` |
| `RELAY_CODEX_MODEL` | Optional Codex model override | Codex default |
| `RELAY_CODEX_REASONING_EFFORT` | Worker reasoning effort | `medium` |
| `RELAY_POSTGRES_PORT` | Host PostgreSQL port | `55432` |
| `RELAY_SANDBOX_PUBLIC_URL` | Public base URL used in computer-view links | `http://127.0.0.1:4330` |
| `RELAY_SANDBOX_VIEW_SECRET` | HMAC secret for short unguessable computer-view URLs | local development value |
| `RELAY_MAX_CONCURRENT_RUNS` | Concurrent agent runs | `4` |

Use real random secrets, HTTPS, and a proper identity provider before any remote deployment.

## Repository layout

```text
apps/desktop/              Electron + React client
apps/mobile/               Expo + React Native iPhone client
packages/protocol/         Shared schemas and event contract
packages/api-client/       Shared HTTP/SSE client
packages/design-tokens/    Shared visual tokens
services/api/              Fastify control plane and PostgreSQL store
services/codex-worker/     Codex App Server bridge
services/collaboration-mcp Agent collaboration tool server
services/sandbox-manager/  Trusted Docker sandbox controller
infra/agent-image/         Linux browser/terminal agent image
infra/compose/             Local and VPS-shaped Compose files
```

## Verification

```bash
pnpm check
RELAY_TEST_DATABASE_URL=postgres://relay:relay@127.0.0.1:55432/relay \
  pnpm --filter @noudle-agents/api test
```

The automated suite covers shared schemas, API auth/CRUD/idempotency/events, delegation invariants, approvals, queue processing, Codex protocol handling, sandbox policy and proxy capabilities, desktop state, mobile state, and production builds. The runtime has also been smoke-tested against a real Codex App Server with thread resume and the collaboration MCP connection. The Linux computer has been verified end to end with headed Chromium over Xvfb/noVNC, a five-minute control lease, audited terminal execution, no host port bindings, and blocked outbound traffic.

## VPS path

Develop locally first, then deploy the same control plane to a VPS. For a single-owner MVP, start with 4 vCPU, 8 GB RAM, 100+ GB NVMe, Ubuntu LTS, Docker Compose, automatic backups, and a domain behind Caddy or Traefik. Expose only HTTPS; keep PostgreSQL, the Codex worker, the sandbox manager, and Docker internal. Add WireGuard/Tailscale for administration.

Hostinger shared web hosting is not sufficient because noudleAgents needs long-running Node services, PostgreSQL, Docker, SSE, and isolated containers. A Hostinger VPS can work if its plan and virtualization allow Docker; verify the current plan in hPanel before deployment.

## Design and product documents

- [Full PRD](./PRD.md)
- [Reference-product research and open-source architecture](./REFERENCE_PRODUCT_RESEARCH.md)
- [Infrastructure notes](./infra/README.md)
- [API notes](./services/api/README.md)

## Security boundary

This build is for a trusted single owner or small trusted team. Docker hardening reduces mistakes but is not a sufficient boundary for hostile public multi-tenancy. Keep human approval for destructive file operations, credential access, financial actions, publishing, external communication, and infrastructure changes. Never mount the Docker socket into agent containers.

## License

Apache-2.0. See [LICENSE](./LICENSE).
