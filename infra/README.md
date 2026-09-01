# noudleAgents local infrastructure

The local stack is intentionally close to the future VPS deployment:

- PostgreSQL is authoritative product storage.
- The API owns product state and event sync.
- Codex App Server runs in a trusted Linux worker container.
- The sandbox manager is the only service with Docker control.
- Agent containers never receive the Docker socket or Codex credentials.
- Workspaces use persistent host mounts; each browser profile lives only inside its sandbox session.

## Build the Linux agent image

```bash
docker build -f infra/agent-image/Dockerfile -t relay-agent-sandbox:local .
```

## Start the development control plane

```bash
docker compose -f infra/compose/docker-compose.yml -f infra/compose/docker-compose.dev.yml up -d postgres api
```

The default API port is loopback-only. To connect a physical iPhone on a trusted local network, use the LAN override:

```bash
docker compose -f infra/compose/docker-compose.yml -f infra/compose/docker-compose.lan.yml up -d
```

Use a strong `RELAY_DEV_AUTH_TOKEN`; never use this LAN override on a public or untrusted network.

Enable the real Codex worker only after authenticating its persistent Codex home. Never commit or copy `auth.json` into an image.

The sandbox manager mounts the Docker socket because it is a trusted control service. The agent containers it creates are non-root, read-only, capability-dropped, resource-limited, and receive only their authorized workspace mount. Browser sandboxes attach only to the internal `relay-runtime-isolated` network, publish no host ports, and are viewed through the manager's signed noVNC reverse proxy on port `4330`. Docker is suitable for this single-owner MVP, not a public untrusted multi-tenant boundary.
