import test from "node:test";
import assert from "node:assert/strict";
import { removeDiscordRole } from "../src/discord.js";

const discordId = "123456789012345678";
const guildId = "223456789012345678";
const roleId = "1189173135380058133";

test("retire uniquement le rôle Discord demandé", async () => {
  let capturedUrl;
  let capturedOptions;
  const fetcher = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return new Response(null, { status: 204 });
  };

  const result = await removeDiscordRole({
    discordId,
    guildId,
    roleId,
    botToken: "secret-test"
  }, fetcher);

  assert.equal(
    capturedUrl,
    `https://discord.com/api/v10/guilds/${guildId}/members/${discordId}/roles/${roleId}`
  );
  assert.equal(capturedOptions.method, "DELETE");
  assert.equal(capturedOptions.headers.Authorization, "Bot secret-test");
  assert.deepEqual(result, { success: true, roleId });
});

test("refuse un identifiant Discord invalide avant tout appel réseau", async () => {
  let called = false;
  const fetcher = async () => {
    called = true;
    return new Response(null, { status: 204 });
  };

  await assert.rejects(
    removeDiscordRole({ discordId: "invalide", guildId, roleId, botToken: "secret-test" }, fetcher),
    /Identifiant Discord invalide/
  );
  assert.equal(called, false);
});

test("remonte un refus de Discord sans masquer le statut HTTP", async () => {
  const fetcher = async () => new Response("Missing Permissions", { status: 403 });

  await assert.rejects(
    removeDiscordRole({ discordId, guildId, roleId, botToken: "secret-test" }, fetcher),
    /Discord HTTP 403: Missing Permissions/
  );
});
