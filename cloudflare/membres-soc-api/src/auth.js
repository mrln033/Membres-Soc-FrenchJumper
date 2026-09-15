const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
const DISCORD_TOKEN_URL = `${DISCORD_API}/oauth2/token`;
const ADMIN_AUDIENCE = "frj-membres-admin";
const OAUTH_STATE_AUDIENCE = "frj-membres-oauth-state";
const SESSION_TTL_SECONDS = 30 * 60;
const STATE_TTL_SECONDS = 10 * 60;
const MAX_DISCORD_BODY_BYTES = 20_000;

/**
 * Routes publiques du parcours OAuth. Elles sont traitées avant les routes de
 * données afin que l'authentification continue de fonctionner même si D1 est
 * momentanément indisponible.
 */
export async function handleAuthRoute(request, url, env, fetcher = fetch) {
  if (request.method !== "GET") return null;

  if (url.pathname === "/auth/config") {
    return json({
      mode: getAdminAuthMode(env),
      configured: getAdminAuthMode(env) !== "discord" || isDiscordAuthConfigured(env)
    });
  }

  if (url.pathname === "/auth/discord/login") {
    ensureDiscordAuthConfigured(env);
    const returnTo = validateReturnTo(url.searchParams.get("returnTo"), env);
    const clientState = String(url.searchParams.get("clientState") || "");
    if (!/^[A-Za-z0-9_-]{20,200}$/.test(clientState)) {
      return json({ error: "État de connexion invalide" }, 400);
    }

    const state = await createSignedToken({
      aud: OAUTH_STATE_AUDIENCE,
      returnTo,
      clientState,
      exp: unixNow() + STATE_TTL_SECONDS
    }, env.ADMIN_SESSION_SECRET);

    const authorizeUrl = new URL(DISCORD_AUTHORIZE_URL);
    authorizeUrl.search = new URLSearchParams({
      response_type: "code",
      client_id: env.DISCORD_OAUTH_CLIENT_ID,
      scope: "identify",
      redirect_uri: getOAuthRedirectUri(request, env),
      state
    }).toString();
    return Response.redirect(authorizeUrl.toString(), 302);
  }

  if (url.pathname === "/auth/discord/callback") {
    ensureDiscordAuthConfigured(env);
    const state = await verifySignedToken(
      String(url.searchParams.get("state") || ""),
      env.ADMIN_SESSION_SECRET,
      OAUTH_STATE_AUDIENCE
    );
    const code = String(url.searchParams.get("code") || "");
    if (!code) return redirectWithAuthError(state.returnTo, state.clientState, "Connexion Discord annulée");

    try {
      const oauth = await exchangeDiscordCode(code, getOAuthRedirectUri(request, env), env, fetcher);
      const user = await getCurrentDiscordUser(oauth.access_token, fetcher);
      await requireAllowedDiscordRole(user.id, env, fetcher);

      const session = await createSignedToken({
        aud: ADMIN_AUDIENCE,
        sub: user.id,
        name: user.global_name || user.username || "Discord",
        iat: unixNow(),
        exp: unixNow() + SESSION_TTL_SECONDS
      }, env.ADMIN_SESSION_SECRET);
      return redirectWithSession(state.returnTo, state.clientState, session);
    } catch (error) {
      console.warn(JSON.stringify({
        message: "Discord admin login refused",
        error: error instanceof Error ? error.message : String(error)
      }));
      return redirectWithAuthError(
        state.returnTo,
        state.clientState,
        error instanceof Error ? error.message : "Connexion Discord refusée"
      );
    }
  }

  if (url.pathname === "/auth/session") {
    const authorization = await authorizeAdminRequest(request, env, fetcher);
    return authorization.authorized
      ? json({ authenticated: true, user: authorization.user })
      : json({ authenticated: false, error: authorization.error }, 401);
  }

  return null;
}

/**
 * Valide une action administrateur. Le mode legacy permet un déploiement sans
 * rupture avant l'activation explicite d'OAuth dans la configuration.
 */
export async function authorizeAdminRequest(request, env, fetcher = fetch) {
  const bearer = getBearerToken(request);
  if (getAdminAuthMode(env) === "legacy") {
    const authorized = await constantTimeSecretEquals(bearer, env.ADMIN_TOKEN);
    return { authorized, user: authorized ? { id: "legacy", name: "Legacy admin" } : null };
  }

  try {
    const session = await verifySignedToken(bearer, env.ADMIN_SESSION_SECRET, ADMIN_AUDIENCE);
    await requireAllowedDiscordRole(session.sub, env, fetcher);
    return { authorized: true, user: { id: session.sub, name: session.name || "Discord" } };
  } catch (error) {
    // Fenêtre de migration volontaire : l'ancien frontend peut continuer à
    // écrire entre l'activation OAuth du Worker et la publication du site.
    if (String(env.ALLOW_LEGACY_ADMIN_TOKEN || "").toLowerCase() === "true") {
      const legacyAuthorized = await constantTimeSecretEquals(bearer, env.ADMIN_TOKEN);
      if (legacyAuthorized) {
        return { authorized: true, user: { id: "legacy", name: "Legacy admin" } };
      }
    }
    return {
      authorized: false,
      user: null,
      error: error instanceof Error ? error.message : "Session administrateur invalide"
    };
  }
}

export function getAdminAuthMode(env) {
  return String(env.ADMIN_AUTH_MODE || "legacy").trim().toLowerCase() === "discord"
    ? "discord"
    : "legacy";
}

export function parseRoleIds(value) {
  const ids = String(value || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (!ids.length || ids.some((id) => !/^\d{17,20}$/.test(id))) {
    throw new Error("ADMIN_DISCORD_ROLE_IDS invalide ou manquant");
  }
  return new Set(ids);
}

export async function requireAllowedDiscordRole(userId, env, fetcher = fetch) {
  if (!/^\d{17,20}$/.test(String(userId || ""))) throw new Error("Utilisateur Discord invalide");
  if (!env.DISCORD_BOT_TOKEN) throw new Error("DISCORD_BOT_TOKEN manquant");
  if (!/^\d{17,20}$/.test(String(env.DISCORD_GUILD_ID || ""))) {
    throw new Error("DISCORD_GUILD_ID invalide ou manquant");
  }

  const allowedRoleIds = parseRoleIds(env.ADMIN_DISCORD_ROLE_IDS);
  const response = await fetcher(
    `${DISCORD_API}/guilds/${env.DISCORD_GUILD_ID}/members/${userId}`,
    { headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } }
  );
  const member = await readJsonResponse(response, "membre Discord");
  const roles = Array.isArray(member.roles) ? member.roles.map(String) : [];
  if (!roles.some((roleId) => allowedRoleIds.has(roleId))) {
    throw new Error("Rôle Discord administrateur requis");
  }
  return { userId: String(userId), roles };
}

export async function createSignedToken(payload, secret) {
  if (!secret) throw new Error("ADMIN_SESSION_SECRET manquant");
  const header = { alg: "HS256", typ: "JWT" };
  const signingInput = `${encodeJson(header)}.${encodeJson(payload)}`;
  const key = await importHmacKey(secret, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64UrlEncodeBytes(new Uint8Array(signature))}`;
}

export async function verifySignedToken(token, secret, expectedAudience) {
  if (!secret || !token) throw new Error("Session administrateur absente");
  const parts = String(token).split(".");
  if (parts.length !== 3) throw new Error("Session administrateur invalide");

  const signingInput = `${parts[0]}.${parts[1]}`;
  const key = await importHmacKey(secret, ["verify"]);
  let signature;
  try {
    signature = base64UrlDecodeBytes(parts[2]);
  } catch {
    throw new Error("Session administrateur invalide");
  }
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    new TextEncoder().encode(signingInput)
  );
  if (!valid) throw new Error("Session administrateur invalide");

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecodeBytes(parts[1])));
  } catch {
    throw new Error("Session administrateur invalide");
  }
  if (payload.aud !== expectedAudience || !Number.isFinite(payload.exp) || payload.exp <= unixNow()) {
    throw new Error("Session administrateur expirée");
  }
  return payload;
}

async function exchangeDiscordCode(code, redirectUri, env, fetcher) {
  const response = await fetcher(DISCORD_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: env.DISCORD_OAUTH_CLIENT_ID,
      client_secret: env.DISCORD_OAUTH_CLIENT_SECRET
    })
  });
  const result = await readJsonResponse(response, "jeton OAuth Discord");
  if (!result.access_token) throw new Error("Jeton OAuth Discord absent");
  return result;
}

async function getCurrentDiscordUser(accessToken, fetcher) {
  const response = await fetcher(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const user = await readJsonResponse(response, "profil Discord");
  if (!/^\d{17,20}$/.test(String(user.id || ""))) throw new Error("Profil Discord invalide");
  return user;
}

async function readJsonResponse(response, label) {
  const text = await readBoundedText(response.body, MAX_DISCORD_BODY_BYTES);
  let result = {};
  try {
    result = JSON.parse(text || "{}");
  } catch {
    throw new Error(`Réponse ${label} invalide`);
  }
  if (!response.ok) {
    throw new Error(result.message || `Discord HTTP ${response.status} (${label})`);
  }
  return result;
}

async function readBoundedText(body, limit) {
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > limit) {
      await reader.cancel("Payload too large");
      throw new Error("Réponse Discord trop volumineuse");
    }
    chunks.push(decoder.decode(value, { stream: true }));
  }
  chunks.push(decoder.decode());
  return chunks.join("");
}

function validateReturnTo(value, env) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new Error("URL de retour invalide");
  }
  if (!allowedSiteOrigins(env).has(url.origin)) throw new Error("URL de retour refusée");
  url.hash = "";
  return url.toString();
}

function allowedSiteOrigins(env) {
  return new Set([
    env.PUBLIC_SITE_ORIGIN,
    "http://localhost:8787",
    "http://127.0.0.1:8787"
  ].filter(Boolean));
}

function getOAuthRedirectUri(request, env) {
  return env.DISCORD_OAUTH_REDIRECT_URI || new URL("/auth/discord/callback", request.url).toString();
}

function ensureDiscordAuthConfigured(env) {
  if (!isDiscordAuthConfigured(env)) throw new Error("Authentification Discord incomplètement configurée");
  parseRoleIds(env.ADMIN_DISCORD_ROLE_IDS);
}

function isDiscordAuthConfigured(env) {
  return Boolean(
    env.DISCORD_OAUTH_CLIENT_ID &&
    env.DISCORD_OAUTH_CLIENT_SECRET &&
    env.ADMIN_SESSION_SECRET &&
    env.DISCORD_BOT_TOKEN &&
    env.DISCORD_GUILD_ID &&
    env.ADMIN_DISCORD_ROLE_IDS
  );
}

function redirectWithSession(returnTo, clientState, session) {
  const target = new URL(returnTo);
  target.hash = new URLSearchParams({ admin_session: session, admin_state: clientState }).toString();
  return Response.redirect(target.toString(), 302);
}

function redirectWithAuthError(returnTo, clientState, message) {
  const target = new URL(returnTo);
  target.hash = new URLSearchParams({ admin_error: message, admin_state: clientState }).toString();
  return Response.redirect(target.toString(), 302);
}

function getBearerToken(request) {
  const header = request.headers.get("Authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

async function constantTimeSecretEquals(supplied, expected) {
  if (!supplied || !expected) return false;
  // subtle.verify est disponible à la fois dans Workers et dans Node, à la
  // différence de l'extension timingSafeEqual propre au runtime Workers.
  const message = new TextEncoder().encode("frj-admin-token-check");
  const [expectedKey, suppliedKey] = await Promise.all([
    importHmacKey(expected, ["sign"]),
    importHmacKey(supplied, ["verify"])
  ]);
  const signature = await crypto.subtle.sign("HMAC", expectedKey, message);
  return crypto.subtle.verify("HMAC", suppliedKey, signature, message);
}

async function importHmacKey(secret, usages) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages
  );
}

function encodeJson(value) {
  return base64UrlEncodeBytes(new TextEncoder().encode(JSON.stringify(value)));
}

function base64UrlEncodeBytes(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecodeBytes(value) {
  const padded = String(value).replace(/-/g, "+").replace(/_/g, "/") + "===".slice((String(value).length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function unixNow() {
  return Math.floor(Date.now() / 1000);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Cache-Control": "no-store"
    }
  });
}
