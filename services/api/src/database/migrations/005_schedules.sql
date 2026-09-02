CREATE TABLE IF NOT EXISTS schedules (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  next_run_at timestamptz,
  locked_at timestamptz,
  locked_by text,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS schedules_due_idx
  ON schedules(workspace_id, enabled, next_run_at) WHERE enabled=true;
