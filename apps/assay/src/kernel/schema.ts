// Store schema. Each migration runs inside one transaction (absurd's migrations did not).

export const MIGRATIONS: string[] = [
  `
CREATE TABLE cases (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, workspace TEXT, parent_case TEXT, forked_at INTEGER,
  status TEXT NOT NULL, created_at INTEGER NOT NULL, meta TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE case_events (
  case_id TEXT NOT NULL, seq INTEGER NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, at INTEGER NOT NULL,
  prev_hash TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY (case_id, seq)
);
CREATE TABLE tasks (
  id TEXT PRIMARY KEY, queue TEXT NOT NULL, kind TEXT NOT NULL, params TEXT,
  state TEXT NOT NULL CHECK (state IN ('pending','running','completed','failed','cancelled','parked')),
  case_id TEXT, parent_id TEXT, idem_key TEXT UNIQUE, attempts INTEGER NOT NULL, crash_count INTEGER NOT NULL,
  max_attempts INTEGER NOT NULL, result TEXT, error TEXT, available_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX tasks_queue ON tasks(queue, state, available_at);
CREATE TABLE attempts (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), n INTEGER NOT NULL, worker TEXT NOT NULL,
  lease_until INTEGER NOT NULL, state TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER,
  UNIQUE (task_id, n)
);
CREATE TABLE checkpoints (
  task_id TEXT NOT NULL, name TEXT NOT NULL, value TEXT NOT NULL, attempt_id TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (task_id, name)
);
CREATE TABLE intents (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL, attempt_id TEXT NOT NULL, name TEXT NOT NULL, key TEXT NOT NULL,
  replay TEXT NOT NULL CHECK (replay IN ('safe','keyed','unsafe')), args_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','done','interrupted','failed')), replays INTEGER NOT NULL,
  result TEXT, created_at INTEGER NOT NULL, settled_at INTEGER, UNIQUE (task_id, name)
);
CREATE TABLE receipts (key TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, result TEXT, created_at INTEGER NOT NULL);
CREATE TABLE topics (
  topic TEXT NOT NULL, seq INTEGER NOT NULL, dedupe_key TEXT NOT NULL, payload TEXT, created_at INTEGER NOT NULL,
  PRIMARY KEY (topic, seq), UNIQUE (topic, dedupe_key)
);
CREATE TABLE mailbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT, recipient TEXT NOT NULL, sender TEXT NOT NULL, kind TEXT NOT NULL,
  body TEXT, case_id TEXT, created_at INTEGER NOT NULL, acked_at INTEGER
);
CREATE INDEX mailbox_recipient ON mailbox(recipient, acked_at);
CREATE TABLE evidence (
  observation_id TEXT PRIMARY KEY, probe_key TEXT NOT NULL, record TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX evidence_probe ON evidence(probe_key);
CREATE TABLE case_evidence (
  case_id TEXT NOT NULL, observation_id TEXT NOT NULL REFERENCES evidence(observation_id), delivered INTEGER NOT NULL,
  event_seq INTEGER, at INTEGER NOT NULL, PRIMARY KEY (case_id, observation_id)
);
CREATE TABLE claims (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL, author TEXT NOT NULL, record TEXT NOT NULL, verdict TEXT,
  verdict_record TEXT, event_seq INTEGER, created_at INTEGER NOT NULL
);
CREATE INDEX claims_case ON claims(case_id);
CREATE TABLE unknowns (
  id TEXT NOT NULL, rev INTEGER NOT NULL, case_id TEXT NOT NULL, body TEXT NOT NULL, prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL, event_seq INTEGER, at INTEGER NOT NULL, PRIMARY KEY (case_id, id, rev)
);
CREATE TABLE approvals (
  id TEXT PRIMARY KEY, case_id TEXT, worker_id TEXT, action TEXT NOT NULL, detail TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','approved','denied','expired')), reason TEXT,
  created_at INTEGER NOT NULL, decided_at INTEGER
);
CREATE TABLE budgets (scope TEXT PRIMARY KEY, limit_json TEXT NOT NULL, spent_json TEXT NOT NULL);
CREATE TABLE usage (
  id TEXT PRIMARY KEY, at INTEGER NOT NULL, case_id TEXT, account_id TEXT, provider TEXT NOT NULL, model TEXT,
  worker_id TEXT, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cost_usd REAL, resent INTEGER NOT NULL
);
CREATE TABLE accounts (
  id TEXT PRIMARY KEY, provider TEXT NOT NULL, label TEXT NOT NULL, home TEXT, status TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, checked_at INTEGER
);
CREATE TABLE calibration (
  producer TEXT NOT NULL, question_class TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0,
  refuted INTEGER NOT NULL DEFAULT 0, unverifiable INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (producer, question_class)
);
`,
];

export const SCHEMA_VERSION = MIGRATIONS.length;
