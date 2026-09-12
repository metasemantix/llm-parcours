CREATE TABLE experiment_runs (
  id TEXT PRIMARY KEY,
  station TEXT NOT NULL CHECK (station IN ('trail', 'alias')),
  bits TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'created' CHECK (state IN ('created', 'armed')),
  next_step INTEGER NOT NULL DEFAULT 0,
  zero_token TEXT,
  one_token TEXT,
  read_token TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE experiment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  station TEXT NOT NULL CHECK (station IN ('trail', 'alias')),
  event_type TEXT NOT NULL,
  bit INTEGER,
  sequence_number INTEGER,
  step_number INTEGER,
  suffix TEXT,
  request_path TEXT,
  observed_length INTEGER,
  is_replay INTEGER NOT NULL DEFAULT 0,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES experiment_runs(id)
);

CREATE INDEX idx_experiment_events_run_id ON experiment_events(run_id, id);
CREATE UNIQUE INDEX idx_trail_successful_step ON experiment_events(run_id, step_number)
  WHERE station = 'trail' AND event_type = 'write';
CREATE UNIQUE INDEX idx_alias_successful_url ON experiment_events(run_id, bit, suffix)
  WHERE station = 'alias' AND event_type = 'write';
