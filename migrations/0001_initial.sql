CREATE TABLE binary_runs (
  id TEXT PRIMARY KEY,
  bits TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'created' CHECK (state IN ('created', 'armed')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE binary_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  bit INTEGER,
  sequence_number INTEGER,
  observed_length INTEGER,
  request_path TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES binary_runs(id)
);

CREATE INDEX idx_binary_events_run_id ON binary_events(run_id);
