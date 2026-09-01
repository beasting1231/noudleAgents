CREATE TABLE IF NOT EXISTS artifacts (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  logical_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  parent_artifact_id text REFERENCES artifacts(id) ON DELETE RESTRICT,
  checksum text NOT NULL,
  storage_key text NOT NULL UNIQUE,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (workspace_id, logical_id, version)
);
CREATE INDEX IF NOT EXISTS artifacts_workspace_idx ON artifacts(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS artifacts_logical_idx ON artifacts(workspace_id, logical_id, version DESC);

CREATE TABLE IF NOT EXISTS computer_sessions (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS computer_sessions_workspace_idx ON computer_sessions(workspace_id, created_at DESC);
