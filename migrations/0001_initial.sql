CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  capability_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  request_text TEXT NOT NULL,
  intent TEXT NOT NULL,
  parameters_json TEXT NOT NULL,
  sources_json TEXT NOT NULL,
  plan_json TEXT,
  trace_json TEXT NOT NULL DEFAULT '[]',
  assertions_json TEXT NOT NULL DEFAULT '[]',
  result_json TEXT,
  status TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, request_key)
);
CREATE INDEX IF NOT EXISTS runs_workspace_created ON runs(workspace_id, created_at DESC);
