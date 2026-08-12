PRAGMA foreign_keys = ON;

CREATE TABLE grades (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  level INTEGER NOT NULL UNIQUE CHECK (level BETWEEN 0 AND 6),
  is_unique INTEGER NOT NULL DEFAULT 0 CHECK (is_unique IN (0, 1))
);

CREATE TABLE members (
  id TEXT PRIMARY KEY,
  avatar_name TEXT NOT NULL,
  normalized_avatar_name TEXT NOT NULL,
  grade_id TEXT NOT NULL REFERENCES grades(id),
  first_entry_at TEXT,
  created_at TEXT,
  updated_at TEXT,
  discord_name TEXT,
  discord_id TEXT,
  on_frj_server INTEGER NOT NULL DEFAULT 0 CHECK (on_frj_server IN (0, 1)),
  rules_accepted INTEGER NOT NULL DEFAULT 0 CHECK (rules_accepted IN (0, 1))
);

CREATE INDEX idx_members_normalized_name ON members(normalized_avatar_name);
CREATE INDEX idx_members_grade ON members(grade_id);
CREATE INDEX idx_members_discord_id ON members(discord_id);

CREATE TABLE movements (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  recorded_at TEXT,
  effective_at TEXT NOT NULL,
  movement_type TEXT NOT NULL,
  old_grade_id TEXT REFERENCES grades(id),
  new_grade_id TEXT REFERENCES grades(id),
  comment TEXT,
  manager_id TEXT
);

CREATE INDEX idx_movements_member_effective
  ON movements(member_id, effective_at DESC);
CREATE INDEX idx_movements_effective ON movements(effective_at DESC);
CREATE INDEX idx_movements_type ON movements(movement_type);
