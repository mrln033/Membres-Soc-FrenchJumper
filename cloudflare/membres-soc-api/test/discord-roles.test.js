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

test("configure explicitement la synchronisation et la garde d'affichage", () => {
  assert.match(config, /"DISCORD_ROLE_SYNC_MODE": "(?:off|active)"/);
  assert.match(config, /"DISCORD_ROLE_DISPLAY_ENABLED": "(?:false|true)"/);
  assert.match(config, /"binding": "DISCORD_ROLE_QUEUE"/);
  assert.match(config, /"max_concurrency": 1/);
  assert.match(config, /"crons": \["17 3 \* \* \*"\]/);
  assert.doesNotMatch(config, /\*\/10 \* \* \* \*/);
});

test("limite les lectures et écritures D1 du rafraîchissement périodique", () => {
  assert.match(worker, /const allowedRoleIds = await getActiveDiscordRoleIds\(env\);/);
  assert.match(worker, /LEFT JOIN member_discord_role_sync s ON s\.member_id = m\.id/);
  assert.doesNotMatch(worker, /UPDATE member_discord_roles SET last_seen_at/);
});

test("masque les catégories vides et réserve les responsabilités à l'accès RH", () => {
  assert.match(client, /const staff = isAdmin \? source\.responsibilities : \[\]/);
  assert.match(client, /if \(!showFunctions && !showActivities\) return null/);
  assert.match(client, /if \(showFunctions\)/);
  assert.match(client, /if \(showActivities\)/);
  assert.match(client, /Actualiser les rôles Discord/);
});
