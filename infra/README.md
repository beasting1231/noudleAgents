# noudleAgents local infrastructure

The local stack is intentionally close to the future VPS deployment:

- PostgreSQL is authoritative product storage.
- The API owns product state and event sync.
- Codex App Server runs in a trusted Linux worker container.
- The sandbox manager is the only service with Docker control.
- Agent containers never receive the Docker socket or Codex credentials.
- Every agent uses one persistent workspace computer. Its home directory and Chromium profile are global, so browser sessions, CLI credentials, SSH configuration, and other login state are available to the whole trusted agent team.
- The computer mounts the shared `/workspace` tree, starts in `/workspace/team/computer`, keeps canonical project work in `/workspace/projects`, and keeps agent working directories in `/workspace/agents/<agent-id>`.

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

The sandbox manager mounts the Docker socket because it is a trusted control service. The computer container is non-root, read-only, capability-dropped, and resource-limited. All agents control that same trusted computer and therefore share its home and browser volumes. Browser actions are serialized to avoid simultaneous input, but agents can still affect one another's active page or shell state. The browser attaches only to the internal `relay-runtime-isolated` network, publishes no host ports, and is viewed through the manager's signed noVNC reverse proxy on port `4330`. Docker is suitable for this single-owner MVP, not a public untrusted multi-tenant boundary.

The workspace computer is created when an agent first needs it, automatically stops after `RELAY_SANDBOX_IDLE_MINUTES` (30 by default), and wakes with the same computer ID, global home volume, Chromium profile, and shared files on the next browser action. Stopping does not delete those volumes.
