import test from "node:test";
import assert from "node:assert/strict";
import {
  authorizeAdminRequest,
  createSignedToken,
  handleAuthRoute,
  parseRoleIds,
  verifySignedToken
} from "../src/auth.js";

const secret = "test-session-secret-with-enough-entropy";
const userId = "123456789012345678";
const guildId = "223456789012345678";
const adminRoleId = "323456789012345678";

test("crée et vérifie une session Admin signée", async () => {
  const token = await createSignedToken({
    aud: "frj-membres-admin",
    sub: userId,
    exp: Math.floor(Date.now() / 1000) + 60
  }, secret);
  const payload = await verifySignedToken(token, secret, "frj-membres-admin");
  assert.equal(payload.sub, userId);
});

test("refuse une session expirée ou signée avec un autre secret", async () => {
  const expired = await createSignedToken({
    aud: "frj-membres-admin",
    sub: userId,
    exp: Math.floor(Date.now() / 1000) - 1
  }, secret);
  await assert.rejects(verifySignedToken(expired, secret, "frj-membres-admin"), /expirée/);
  await assert.rejects(verifySignedToken(expired, "another-secret", "frj-membres-admin"), /invalide/);
});

test("normalise plusieurs IDs de rôles", () => {
  assert.deepEqual([...parseRoleIds(`${adminRoleId}, 423456789012345678`)], [
    adminRoleId,
    "423456789012345678"
  ]);
  assert.throws(() => parseRoleIds("Chef d'Expédition"), /invalide/);
});

test("revalide le rôle Discord à chaque requête protégée", async () => {
  const token = await createSignedToken({
    aud: "frj-membres-admin",
    sub: userId,
    name: "Admin Test",
    exp: Math.floor(Date.now() / 1000) + 60
  }, secret);
  const env = {
    ADMIN_AUTH_MODE: "discord",
    ADMIN_SESSION_SECRET: secret,
    ADMIN_DISCORD_ROLE_IDS: adminRoleId,
    DISCORD_BOT_TOKEN: "bot-test",
    DISCORD_GUILD_ID: guildId
  };
  const fetcher = async () => Response.json({ roles: [adminRoleId] });
  const request = new Request("https://api.example.test/", {
    headers: { Authorization: `Bearer ${token}` }
  });

  const result = await authorizeAdminRequest(request, env, fetcher);
  assert.equal(result.authorized, true);
  assert.equal(result.user.id, userId);

  const denied = await authorizeAdminRequest(request, env, async () => Response.json({ roles: [] }));
  assert.equal(denied.authorized, false);
  assert.match(denied.error, /Rôle Discord/);
});

test("accepte temporairement l'ancien token pendant la migration", async () => {
  const env = {
    ADMIN_AUTH_MODE: "discord",
    ALLOW_LEGACY_ADMIN_TOKEN: "true",
    ADMIN_TOKEN: "legacy-secret",
    ADMIN_SESSION_SECRET: secret,
    ADMIN_DISCORD_ROLE_IDS: adminRoleId,
    DISCORD_BOT_TOKEN: "bot-test",
    DISCORD_GUILD_ID: guildId
  };
  const request = new Request("https://api.example.test/", {
    headers: { Authorization: "Bearer legacy-secret" }
  });
  const result = await authorizeAdminRequest(request, env, async () => {
    throw new Error("Discord ne doit pas être appelé pour un token legacy");
  });
  assert.equal(result.authorized, true);
  assert.equal(result.user.id, "legacy");
});

test("effectue le parcours OAuth et renvoie la session dans le fragment", async () => {
  const env = {
    ADMIN_AUTH_MODE: "discord",
    ADMIN_SESSION_SECRET: secret,
    ADMIN_DISCORD_ROLE_IDS: adminRoleId,
    DISCORD_BOT_TOKEN: "bot-test",
    DISCORD_GUILD_ID: guildId,
    DISCORD_OAUTH_CLIENT_ID: "oauth-client",
    DISCORD_OAUTH_CLIENT_SECRET: "oauth-secret",
    PUBLIC_SITE_ORIGIN: "https://site.example.test"
  };
  const clientState = "abcdefghijklmnopqrstuvwxyz123456";
  const loginRequest = new Request(
    `https://api.example.test/auth/discord/login?returnTo=${encodeURIComponent("https://site.example.test/index.html?admin=1")}&clientState=${clientState}`
  );
  const loginResponse = await handleAuthRoute(loginRequest, new URL(loginRequest.url), env);
  assert.equal(loginResponse.status, 302);
  const discordLocation = new URL(loginResponse.headers.get("Location"));
  assert.equal(discordLocation.searchParams.get("scope"), "identify");

  const responses = [
    Response.json({ access_token: "oauth-user-token" }),
    Response.json({ id: userId, username: "Admin Test" }),
    Response.json({ roles: [adminRoleId] })
  ];
  const callbackRequest = new Request(
    `https://api.example.test/auth/discord/callback?code=oauth-code&state=${encodeURIComponent(discordLocation.searchParams.get("state"))}`
  );
  const callbackResponse = await handleAuthRoute(
    callbackRequest,
    new URL(callbackRequest.url),
    env,
    async () => responses.shift()
  );
  assert.equal(callbackResponse.status, 302);
  const callbackLocation = new URL(callbackResponse.headers.get("Location"));
  const fragment = new URLSearchParams(callbackLocation.hash.slice(1));
  assert.ok(fragment.get("admin_session"));
  assert.equal(fragment.get("admin_state"), clientState);
});
