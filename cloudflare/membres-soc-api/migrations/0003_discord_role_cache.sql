CREATE TABLE discord_role_catalog (
  discord_role_id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('DISCORD_STAFF', 'GAME_FUNCTION', 'GAME_ACTIVITY')),
  display_order INTEGER NOT NULL DEFAULT 0,
  public_visible INTEGER NOT NULL DEFAULT 1 CHECK (public_visible IN (0, 1)),
  site_editable INTEGER NOT NULL DEFAULT 0 CHECK (site_editable = 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE member_discord_roles (
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  discord_role_id TEXT NOT NULL REFERENCES discord_role_catalog(discord_role_id),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (member_id, discord_role_id)
);

CREATE INDEX idx_member_discord_roles_member
  ON member_discord_roles(member_id);

CREATE TABLE member_discord_role_sync (
  member_id TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  discord_id TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'OK', 'ABSENT', 'INVALID_ID', 'ERROR')),
  role_hash TEXT,
  last_attempt_at TEXT,
  last_success_at TEXT,
  gas_synced_at TEXT,
  last_error TEXT
);

INSERT INTO discord_role_catalog
  (discord_role_id, label, category, display_order, public_visible, site_editable, active)
VALUES
  ('464513638414417930', 'Administrateur', 'DISCORD_STAFF', 10, 0, 0, 1),
  ('464514892355993600', 'Modérateur', 'DISCORD_STAFF', 20, 0, 0, 1),
  ('464706697408020482', 'Enzoboy', 'GAME_FUNCTION', 10, 1, 0, 1),
  ('1538203076434075668', 'Pilote PF13', 'GAME_FUNCTION', 20, 1, 0, 1),
  ('811239593675456523', 'Chasseur', 'GAME_ACTIVITY', 10, 1, 0, 1),
  ('811240383127879691', 'Mineur', 'GAME_ACTIVITY', 20, 1, 0, 1),
  ('811240450123890688', 'Crafteur', 'GAME_ACTIVITY', 30, 1, 0, 1),
  ('1070296235782701097', 'Tradeur', 'GAME_ACTIVITY', 40, 1, 0, 1),
  ('811240547552854050', 'Healeur', 'GAME_ACTIVITY', 50, 1, 0, 1),
  ('811240494390312973', 'Sweateur', 'GAME_ACTIVITY', 60, 1, 0, 1),
  ('962964676956790844', 'Streameur', 'GAME_ACTIVITY', 70, 1, 0, 1);
