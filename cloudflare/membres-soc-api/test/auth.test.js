import test from "node:test";
import assert from "node:assert/strict";
import {
  authorizeAdminRequest,
  createSignedToken,
  handleAuthRoute,
  parseRoleIds,
  verifySignedToken
} from "../src/auth.js";
import { authorizationErrorResponse, canReadDiscordResponsibilities } from "../src/index.js";

const secret = "test-session-secret-with-enough-entropy";
const userId = "123456789012345678";
const guildId = "223456789012345678";
const adminRoleId = "323456789012345678";
const frjRoleId = "423456789012345678";

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

test("refuse définitivement l'ancien token même si l'ancienne garde est fournie", async () => {
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
    throw new Error("Discord ne doit pas être appelé pour un token invalide");
  });
  assert.equal(result.authenticated, false);
  assert.equal(result.authorized, false);
  assert.equal(result.status, 401);
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

test("connecte un membre du serveur sans lui accorder les droits RH", async () => {
  const env = {
    ADMIN_AUTH_MODE: "discord",
    AUTH_LOGIN_POLICY: "guild_members",
    ADMIN_SESSION_SECRET: secret,
    ADMIN_DISCORD_ROLE_IDS: adminRoleId,
    DISCORD_BOT_TOKEN: "bot-test",
    DISCORD_GUILD_ID: guildId,
    DISCORD_OAUTH_CLIENT_ID: "oauth-client",
    DISCORD_OAUTH_CLIENT_SECRET: "oauth-secret",
    PUBLIC_SITE_ORIGIN: "https://site.example.test"
  };
  const clientState = "memberwithoutrole123456789012";
  const loginRequest = new Request(
    `https://api.example.test/auth/discord/login?returnTo=${encodeURIComponent("https://site.example.test/index.html")}&clientState=${clientState}`
  );
  const loginResponse = await handleAuthRoute(loginRequest, new URL(loginRequest.url), env);
  const oauthState = new URL(loginResponse.headers.get("Location")).searchParams.get("state");
  const responses = [
    Response.json({ access_token: "oauth-user-token" }),
    Response.json({ id: userId, username: "Membre Test" }),
    Response.json({ roles: [] })
  ];
  const callbackRequest = new Request(`https://api.example.test/auth/discord/callback?code=ok&state=${encodeURIComponent(oauthState)}`);
  const callbackResponse = await handleAuthRoute(callbackRequest, new URL(callbackRequest.url), env, async () => responses.shift());
  const token = new URL(callbackResponse.headers.get("Location")).hash.match(/admin_session=([^&]+)/)?.[1];
  assert.ok(token);

  const sessionRequest = new Request("https://api.example.test/auth/session", {
    headers: { Authorization: `Bearer ${decodeURIComponent(token)}` }
  });
  const sessionResponse = await handleAuthRoute(sessionRequest, new URL(sessionRequest.url), env, async () => Response.json({ roles: [] }));
  assert.equal(sessionResponse.status, 200);
  assert.deepEqual(await sessionResponse.json(), {
    authenticated: true,
    authorized: false,
    frjMember: false,
    user: { id: userId, name: "Membre Test" },
    reason: "role_required",
    error: "Rôle Discord administrateur requis"
  });
});

test("accorde la Consultation FRJ sans accorder les droits RH", async () => {
  const token = await createSignedToken({
    aud: "frj-membres-admin",
    sub: userId,
    name: "Membre FRJ",
    exp: Math.floor(Date.now() / 1000) + 60
  }, secret);
  const env = {
    ADMIN_AUTH_MODE: "discord",
    ADMIN_SESSION_SECRET: secret,
    ADMIN_DISCORD_ROLE_IDS: adminRoleId,
    FRJ_MEMBER_ROLE_ID: frjRoleId,
    DISCORD_BOT_TOKEN: "bot-test",
    DISCORD_GUILD_ID: guildId
  };
  const request = new Request("https://api.example.test/auth/session", {
    headers: { Authorization: `Bearer ${token}` }
  });
  const response = await handleAuthRoute(
    request,
    new URL(request.url),
    env,
    async () => Response.json({ roles: [frjRoleId] })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    authenticated: true,
    authorized: false,
    frjMember: true,
    user: { id: userId, name: "Membre FRJ" },
    reason: "role_required",
    error: "Rôle Discord administrateur requis"
  });
});

test("sépare lecture FRJ et écritures RH", () => {
  assert.equal(canReadDiscordResponsibilities({ authorized: true, frjMember: false }), true);
  assert.equal(canReadDiscordResponsibilities({ authorized: false, frjMember: true }), true);
  assert.equal(canReadDiscordResponsibilities({ authorized: false, frjMember: false }), false);
  assert.equal(canReadDiscordResponsibilities(null), false);
});

test("refuse un compte absent du serveur avec un code fonctionnel explicite", async () => {
  const env = {
    ADMIN_AUTH_MODE: "discord",
    AUTH_LOGIN_POLICY: "guild_members",
    ADMIN_SESSION_SECRET: secret,
    ADMIN_DISCORD_ROLE_IDS: adminRoleId,
    DISCORD_BOT_TOKEN: "bot-test",
    DISCORD_GUILD_ID: guildId,
    DISCORD_OAUTH_CLIENT_ID: "oauth-client",
    DISCORD_OAUTH_CLIENT_SECRET: "oauth-secret",
    PUBLIC_SITE_ORIGIN: "https://site.example.test"
  };
  const clientState = "notguildmember123456789012345";
  const loginRequest = new Request(
    `https://api.example.test/auth/discord/login?returnTo=${encodeURIComponent("https://site.example.test/index.html")}&clientState=${clientState}`
  );
  const loginResponse = await handleAuthRoute(loginRequest, new URL(loginRequest.url), env);
  const oauthState = new URL(loginResponse.headers.get("Location")).searchParams.get("state");
  const responses = [
    Response.json({ access_token: "oauth-user-token" }),
    Response.json({ id: userId, username: "Hors serveur" }),
    Response.json({ message: "Unknown Member" }, { status: 404 })
  ];
  const callbackRequest = new Request(`https://api.example.test/auth/discord/callback?code=ok&state=${encodeURIComponent(oauthState)}`);
  const callbackResponse = await handleAuthRoute(callbackRequest, new URL(callbackRequest.url), env, async () => responses.shift());
  const fragment = new URLSearchParams(new URL(callbackResponse.headers.get("Location")).hash.slice(1));
  assert.equal(fragment.get("admin_session"), null);
  assert.equal(fragment.get("admin_error_code"), "not_guild_member");
  assert.match(fragment.get("admin_error"), /n'est pas membre/);
});

test("ne confond pas une panne Discord avec une absence du serveur", async () => {
  const token = await createSignedToken({
    aud: "frj-membres-admin", sub: userId, name: "Admin Test",
    exp: Math.floor(Date.now() / 1000) + 60
  }, secret);
  const env = {
    ADMIN_AUTH_MODE: "discord", ADMIN_SESSION_SECRET: secret,
    ADMIN_DISCORD_ROLE_IDS: adminRoleId, DISCORD_BOT_TOKEN: "bot-test", DISCORD_GUILD_ID: guildId
  };
  const request = new Request("https://api.example.test/auth/session", { headers: { Authorization: `Bearer ${token}` } });
  const response = await handleAuthRoute(request, new URL(request.url), env, async () => Response.json({ message: "rate limited" }, { status: 429 }));
  const result = await response.json();
  assert.equal(response.status, 503);
  assert.equal(result.authenticated, true);
  assert.equal(result.reason, "discord_unavailable");
});

test("traduit l'authentification et l'autorisation en statuts HTTP distincts", async () => {
  const invalidSession = authorizationErrorResponse({ authenticated: false, authorized: false, error: "Session invalide" });
  assert.equal(invalidSession.status, 401);

  const missingRole = authorizationErrorResponse({
    authenticated: true, authorized: false, status: 200,
    reason: "role_required", error: "Rôle Discord administrateur requis"
  });
  assert.equal(missingRole.status, 403);
  assert.equal((await missingRole.json()).reason, "role_required");

  const discordUnavailable = authorizationErrorResponse({
    authenticated: true, authorized: false, status: 503,
    reason: "discord_unavailable", error: "Discord indisponible"
  });
  assert.equal(discordUnavailable.status, 503);
});
