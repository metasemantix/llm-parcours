CREATE TABLE bulk_input_observations (
  id TEXT PRIMARY KEY,
  observed_at TEXT NOT NULL,
  method TEXT NOT NULL,
  request_target TEXT NOT NULL,
  referrer TEXT,
  user_agent TEXT
);
