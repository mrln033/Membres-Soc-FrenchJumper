CREATE TABLE sync_mutations (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('D1', 'GAS', 'SHEET_MANUAL')),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('MEMBER', 'MEMBER_AND_MOVEMENT')),
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  target TEXT NOT NULL CHECK (target IN ('D1', 'GAS')),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'QUEUED', 'APPLIED', 'FAILED', 'CONFLICT')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  queued_at TEXT,
  applied_at TEXT
);

CREATE INDEX idx_sync_mutations_status_target
  ON sync_mutations(status, target, created_at);
CREATE INDEX idx_sync_mutations_entity
  ON sync_mutations(entity_type, entity_id, changed_at DESC);

CREATE TABLE sync_entity_versions (
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  source TEXT NOT NULL,
  mutation_id TEXT NOT NULL,
  PRIMARY KEY (entity_type, entity_id)
);

CREATE TABLE sync_audits (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  members_d1 INTEGER,
  members_gas INTEGER,
  movements_d1 INTEGER,
  movements_gas INTEGER,
  differences INTEGER,
  details_json TEXT
);
