# noudleAgents API

Fastify control plane for the noudleAgents MVP. It owns workspace state, task collaboration, run scheduling, event replay, and the runtime adapter boundary.

## Run locally

From the repository root:

```bash
pnpm --filter @noudle-agents/protocol build
pnpm --filter @noudle-agents/api dev
```

Without `RELAY_DATABASE_URL`, development uses ephemeral in-memory storage. When a PostgreSQL URL is present, migrations run automatically at startup. Production refuses to fall back to memory.

The default owner token is `relay-local-owner`. Send it as:

```http
Authorization: Bearer relay-local-owner
```

Agent-originated collaboration calls additionally send:

```http
X-Relay-Agent-Id: agent-builder
```

## Main routes

- `GET /health`
- `GET /v1/snapshot`
- CRUD under `/v1/agents` and `/v1/conversations`
- `GET|POST /v1/conversations/:conversationId/messages`
- `GET|POST|PATCH /v1/tasks`
- `POST /v1/tasks/:id/delegate`
- `POST /v1/tasks/:id/block`
- `POST /v1/tasks/:id/complete`
- `POST /v1/collaboration/messages`
- `GET /v1/runs` and `POST /v1/runs/:id/interrupt`
- `GET /v1/approvals` and approval resolution routes
- `GET /v1/events?after=<cursor>` for replayable SSE
- `GET|POST /v1/artifacts`, `GET /v1/artifacts/:id/download`, and `PATCH /v1/artifacts/:id`
- `GET|POST /v1/computers` and computer get, takeover, return, exec, and delete routes

`POST` message requests are idempotent by `clientOperationId`. Supplying `Idempotency-Key` is recommended and, when present, must match the body.

## Runtime and queue

`AgentRuntime` is the replaceable execution boundary. The bundled mock runtime emits message deltas and tool events, then demonstrates delegation by creating a bounded child task for the Researcher agent. The queue is stored in `queue_jobs`; PostgreSQL claims use `FOR UPDATE SKIP LOCKED` so multiple workers can safely compete.

## Verification

```bash
pnpm --filter @noudle-agents/api typecheck
pnpm --filter @noudle-agents/api test
pnpm --filter @noudle-agents/api build
```

Set `RELAY_TEST_DATABASE_URL` to include migration, restart-persistence, durable queue, runtime, and event-store integration tests against PostgreSQL.

## Artifacts

Uploads use `multipart/form-data` with one required `file`. Optional text fields are `name`, `taskId`, `runId`, `agentId`, `source`, `parentArtifactId`, and JSON-object `metadata`. Supplying `parentArtifactId` creates the next immutable version in that artifact's logical lineage. Content is stored under a server-generated key below `RELAY_STORAGE_PATH`; names and client paths never select a filesystem destination. Downloads verify both size and SHA-256 before streaming.

## Computers

The API talks to `RELAY_SANDBOX_MANAGER_URL` using only `RELAY_INTERNAL_TOKEN`. Clients never receive container IDs, Docker names, workspace mount keys, or the internal token.

Create with:

```json
{
  "agentId": "agent-builder",
  "taskId": null,
  "browser": true,
  "networkAccess": false
}
```

The owner must call `POST /v1/computers/:id/takeover` before terminal execution. `POST /v1/computers/:id/return` restores the assigned agent's control. Command audit events store the executable, argument count, timing, and exit code—not arguments or output.

The sandbox manager defaults to loopback-only noVNC ports. `computerHostPort` exposes the assigned port, and `RELAY_COMPUTER_PUBLIC_HOST` rewrites the host in `computerUrl` for an explicitly configured LAN or VPN environment. Rewriting alone does not expose the port: the sandbox manager must also be deliberately configured to bind noVNC beyond loopback.
