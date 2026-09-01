CREATE TABLE IF NOT EXISTS relay_schema_migrations (
  version integer PRIMARY KEY,
  name text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspaces (
  id text PRIMARY KEY,
  name text NOT NULL,
  owner_id text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS agents_workspace_idx ON agents(workspace_id, created_at);

CREATE TABLE IF NOT EXISTS conversations (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS conversations_workspace_idx ON conversations(workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  client_operation_id text,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages(conversation_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS messages_operation_idx
  ON messages(workspace_id, client_operation_id) WHERE client_operation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS tasks (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  parent_task_id text REFERENCES tasks(id) ON DELETE RESTRICT,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS tasks_workspace_idx ON tasks(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS tasks_parent_idx ON tasks(parent_task_id);

CREATE TABLE IF NOT EXISTS runs (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS runs_workspace_idx ON runs(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS approvals (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS approvals_workspace_idx ON approvals(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS relay_events (
  cursor bigserial PRIMARY KEY,
  id text NOT NULL UNIQUE,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  sequence integer NOT NULL,
  type text NOT NULL,
  actor_type text NOT NULL,
  actor_id text,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (workspace_id, aggregate_type, aggregate_id, sequence)
);
CREATE INDEX IF NOT EXISTS relay_events_replay_idx ON relay_events(workspace_id, cursor);

CREATE TABLE IF NOT EXISTS queue_jobs (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL,
  locked_at timestamptz,
  locked_by text,
  error text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS queue_jobs_claim_idx ON queue_jobs(status, available_at, created_at);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  operation text NOT NULL,
  key text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, operation, key)
);
