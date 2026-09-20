import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { syncDiscordRolesAndNickname } from "../../../worker/discord-sync.js";

const proxyWorker = readFileSync(new URL("../../../worker/worker.js", import.meta.url), "utf8");
const proxyConfig = readFileSync(new URL("../../../worker/wrangler.jsonc", import.meta.url), "utf8");

const roles = {
  ROLE_FRJ: "100000000000000001",
  GRADE1: "100000000000000011",
  GRADE2: "100000000000000012",
  GRADE3: "100000000000000013",
  GRADE4: "100000000000000014",
  GRADE5: "100000000000000015",
  GRADE6: "100000000000000016"
};

test("utilise uniquement des secrets Cloudflare pour les deux valeurs sensibles", () => {
  assert.match(proxyConfig, /"required"\s*:\s*\[[\s\S]*"DISCORD_BOT_TOKEN"[\s\S]*"SYNC_SHARED_SECRET"/);
  assert.doesNotMatch(proxyConfig, /"BOT_TOKEN"\s*:/);
  assert.doesNotMatch(proxyConfig, /"SECRET"\s*:/);
  assert.match(proxyWorker, /env\.DISCORD_BOT_TOKEN/);
  assert.match(proxyWorker, /env\.SYNC_SHARED_SECRET/);
  assert.doesNotMatch(proxyWorker, /env\.BOT_TOKEN/);
  assert.doesNotMatch(proxyWorker, /env\.SECRET/);
});

test("conserve le succès des rôles quand Discord refuse seulement le pseudonyme", async () => {
  const calls = [];
  const result = await syncDiscordRolesAndNickname({
    discordId: "200000000000000001",
    guildId: "300000000000000001",
    niveau: 5,
    nomAvatar: "Merlin Merzhin Lesage",
    roles,
    requestDiscord: async (path, options) => {
      calls.push({ path, method: options.method });
      if (options.method === "PATCH") {
        throw new Error('Discord HTTP 403: {"message":"Missing Permissions","code":50013}');
      }
    }
  });

  assert.equal(result.success, true);
  assert.equal(result.nicknameUpdated, false);
  assert.equal(result.warningCode, "NICKNAME_PERMISSION_REFUSED");
  assert.match(result.warning, /rôles Discord ont bien été synchronisés/);
  assert.match(result.warning, /hiérarchie Discord/);
  assert.equal(calls.at(-1).method, "PATCH");
  assert.equal(calls.filter(call => call.method === "PUT").length, 2);
  assert.equal(calls.filter(call => call.method === "DELETE").length, 5);
});

test("un échec de rôle reste bloquant et empêche la modification du pseudonyme", async () => {
  const calls = [];
  const result = await syncDiscordRolesAndNickname({
    discordId: "200000000000000001",
    guildId: "300000000000000001",
    niveau: 5,
    nomAvatar: "Merlin Merzhin Lesage",
    roles,
    requestDiscord: async (path, options) => {
      calls.push({ path, method: options.method });
      throw new Error("Discord HTTP 403: Missing Permissions");
    }
  });

  assert.equal(result.success, false);
  assert.equal(result.failedStep, "roles");
  assert.match(result.error, /Synchronisation des rôles Discord impossible/);
  assert.equal(calls.some(call => call.method === "PATCH"), false);
});

test("signale un succès complet lorsque rôles et pseudonyme sont modifiés", async () => {
  const result = await syncDiscordRolesAndNickname({
    discordId: "200000000000000001",
    guildId: "300000000000000001",
    niveau: 5,
    nomAvatar: "Merlin Merzhin Lesage",
    roles,
    requestDiscord: async () => undefined
  });

  assert.deepEqual(result, { success: true, nicknameUpdated: true });
});
