import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../migrations/0003_discord_role_cache.sql", import.meta.url), "utf8");
const worker = readFileSync(new URL("../src/discord-roles.js", import.meta.url), "utf8");
const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const client = readFileSync(new URL("../../../js/client.js", import.meta.url), "utf8");

test("verrouille tout le catalogue D-002 en lecture seule", () => {
  assert.match(migration, /site_editable INTEGER NOT NULL DEFAULT 0 CHECK \(site_editable = 0\)/);
  assert.equal((migration.match(/'DISCORD_STAFF'/g) || []).length, 3); // contrainte + deux rôles
  assert.equal((migration.match(/'GAME_FUNCTION'/g) || []).length, 3); // contrainte + deux rôles
  assert.equal((migration.match(/'GAME_ACTIVITY'/g) || []).length, 8); // contrainte + sept rôles
  assert.doesNotMatch(worker, /method:\s*["'](?:PUT|PATCH|DELETE)["']/);
  assert.doesNotMatch(worker, /\/roles\//);
});

test("laisse la synchronisation et l'affichage désactivés par défaut", () => {
  assert.match(config, /"DISCORD_ROLE_SYNC_MODE": "off"/);
  assert.match(config, /"DISCORD_ROLE_DISPLAY_ENABLED": "false"/);
  assert.match(config, /"binding": "DISCORD_ROLE_QUEUE"/);
  assert.match(config, /"max_concurrency": 1/);
});

test("masque les catégories vides et réserve les responsabilités à l'accès RH", () => {
  assert.match(client, /\.filter\(\(\[, values\]\) => Array\.isArray\(values\) && values\.length\)/);
  assert.match(client, /isAdmin \? source\.responsibilities : \[\]/);
  assert.match(client, /Actualiser les rôles Discord/);
});
