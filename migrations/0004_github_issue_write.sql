CREATE TABLE forums (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  forum_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (forum_id, slug),
  FOREIGN KEY (forum_id) REFERENCES forums(id)
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  parent_message_id TEXT,
  body TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('seed', 'github_issue')),
  source_issue_number INTEGER,
  source_issue_url TEXT,
  source_actor TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES threads(id),
  FOREIGN KEY (parent_message_id) REFERENCES messages(id)
);
CREATE INDEX idx_messages_thread ON messages(thread_id, created_at, id);

CREATE TABLE activity_chains (
  id TEXT PRIMARY KEY,
  station TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE activity_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chain_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  message_id TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (chain_id) REFERENCES activity_chains(id),
  FOREIGN KEY (message_id) REFERENCES messages(id)
);
CREATE INDEX idx_activity_events_chain ON activity_events(chain_id, id);

CREATE TABLE write_capabilities (
  token_hash TEXT PRIMARY KEY,
  chain_id TEXT NOT NULL,
  forum_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  parent_message_id TEXT,
  scope TEXT NOT NULL CHECK (scope = 'append_reply'),
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  result_message_id TEXT,
  issue_number INTEGER,
  issue_url TEXT,
  issue_actor TEXT,
  FOREIGN KEY (chain_id) REFERENCES activity_chains(id),
  FOREIGN KEY (forum_id) REFERENCES forums(id),
  FOREIGN KEY (thread_id) REFERENCES threads(id),
  FOREIGN KEY (parent_message_id) REFERENCES messages(id),
  FOREIGN KEY (result_message_id) REFERENCES messages(id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE pickup_capabilities (
  token_hash TEXT PRIMARY KEY,
  chain_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  redemption_id TEXT UNIQUE,
  FOREIGN KEY (chain_id) REFERENCES activity_chains(id),
  FOREIGN KEY (message_id) REFERENCES messages(id)
);

CREATE TABLE reentry_capabilities (
  token_hash TEXT PRIMARY KEY,
  chain_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  redemption_id TEXT UNIQUE,
  FOREIGN KEY (chain_id) REFERENCES activity_chains(id),
  FOREIGN KEY (message_id) REFERENCES messages(id)
);

CREATE TABLE thread_notifications (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  message_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL CHECK (event_type = 'new_reply'),
  created_at TEXT NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES threads(id),
  FOREIGN KEY (message_id) REFERENCES messages(id)
);

INSERT INTO forums (id, slug, title, description, created_at) VALUES
  ('forum_public', 'public', 'Public experiments', 'Public discussion for LLM Parcours experiments.', '2026-09-28T00:00:00.000Z');
INSERT INTO threads (id, forum_id, slug, title, created_at) VALUES
  ('thread_github_write', 'forum_public', 'github-issue-write', 'GitHub Issue write experiment', '2026-09-28T00:00:00.000Z');
INSERT INTO messages (id, thread_id, parent_message_id, body, source, created_at) VALUES
  ('message_github_write_seed', 'thread_github_write', NULL, 'Can an agent reply through a bounded GitHub Issue write and return to the same Parcours activity chain?', 'seed', '2026-09-28T00:00:00.000Z');
