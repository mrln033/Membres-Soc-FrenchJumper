import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const configSource = readFileSync(new URL("../../../js/config.js", import.meta.url), "utf8");
const indexSource = readFileSync(new URL("../../../index.html", import.meta.url), "utf8");
const clientSource = readFileSync(new URL("../../../js/client.js", import.meta.url), "utf8");
const styleSource = readFileSync(new URL("../../../css/style.css", import.meta.url), "utf8");
const syncSource = readFileSync(new URL("../../../sync.html", import.meta.url), "utf8");

function loadConfigState(url, initialStorage = {}, afterLoad = "", options = {}) {
  const values = new Map(Object.entries(initialStorage));
  let replacedUrl = null;
  const location = new URL(url);
  location.assign = () => {};
  location.replace = () => {};
  const listeners = new Map();
  const window = {
    location,
    addEventListener(type, listener) { listeners.set(type, listener); },
    dispatchEvent() {},
    open() { return null; }
  };
  window.top = window;
  const links = Array.from(options.linkHrefs || [], href => ({ href }));
  const context = vm.createContext({
    URL,
    URLSearchParams,
    AbortController,
    Uint8Array,
    Promise,
    Error,
    Object,
    String,
    setTimeout,
    clearTimeout,
    console,
    crypto: webcrypto,
    CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    btoa,
    Response,
    Headers,
    fetch: options.fetch || (async () => Response.json({ mode: "discord", configured: true })),
    window,
    history: { replaceState(_state, _title, urlValue) { replacedUrl = urlValue; } },
    document: {
      title: "Test",
      readyState: "complete",
      querySelectorAll() { return links; }
    },
    sessionStorage: {
      getItem(key) { return values.has(key) ? values.get(key) : null; },
      setItem(key, value) { values.set(key, String(value)); },
      removeItem(key) { values.delete(key); }
    }
  });
  vm.runInContext(
    `${configSource}\n${afterLoad}\n;globalThis.__result = { preferredBackend, activeBackend: getActiveBackend(), page: buildInternalPageUrl("fiche.html", { id: "abc", backend: "gas" }) };`,
    context
  );
  // Ramène l'objet hors du realm vm pour une comparaison stricte fiable.
  const snapshot = JSON.parse(JSON.stringify({
    result: context.__result,
    testResult: context.__testResult,
    storage: Object.fromEntries(values),
    replacedUrl,
    links: links.map(link => link.href)
  }));
  snapshot.pending = context.__testPromise;
  return snapshot;
}

function loadConfig(url, initialStorage = {}) {
  return loadConfigState(url, initialStorage).result;
}

test("sélectionne D1 et supprime l'ancien paramètre admin", () => {
  assert.deepEqual(
    loadConfig("https://site.example.test/index.html"),
    { preferredBackend: "d1", activeBackend: "d1", page: "fiche.html?id=abc" }
  );
  assert.deepEqual(
    loadConfig("https://site.example.test/index.html?admin=1"),
    { preferredBackend: "d1", activeBackend: "d1", page: "fiche.html?id=abc" }
  );
  const legacyAdmin = loadConfigState("https://site.example.test/index.html?admin=1");
  assert.equal(legacyAdmin.storage.admin, undefined);
  assert.equal(legacyAdmin.replacedUrl, "/index.html");
});

test("ne conserve plus aucun chemin frontend vers l'ancien jeton Admin", () => {
  assert.doesNotMatch(configSource, /FRJ_MEMBRES_D1_ADMIN_TOKEN/);
  assert.doesNotMatch(configSource, /Jeton administrateur D1/);
  assert.doesNotMatch(configSource, /window\.prompt/);
});

test("consomme backend=GAS sans le propager dans les liens", () => {
  const loaded = loadConfigState("https://site.example.test/index.html?backend=GAS");
  assert.deepEqual(loaded.result, { preferredBackend: "gas", activeBackend: "gas", page: "fiche.html?id=abc" });
  assert.equal(loaded.storage.FRJ_MEMBRES_BACKEND_OVERRIDE, "gas");
  assert.equal(loaded.replacedUrl, "/index.html");
});

test("conserve le forçage GAS dans l'onglet avec des liens canoniques", () => {
  const loaded = loadConfigState(
    "https://site.example.test/fiche.html?id=abc",
    { FRJ_MEMBRES_BACKEND_OVERRIDE: "gas" },
    "",
    { linkHrefs: ["https://site.example.test/mouvements.html?backend=gas&id=abc#detail"] }
  );
  assert.deepEqual(loaded.result, { preferredBackend: "gas", activeBackend: "gas", page: "fiche.html?id=abc" });
  assert.equal(loaded.links[0], "https://site.example.test/mouvements.html?id=abc#detail");
});

test("backend=d1 rétablit le mode automatique D1 dans l'onglet", () => {
  const loaded = loadConfigState(
    "https://site.example.test/index.html?backend=d1&vue=actifs",
    { FRJ_MEMBRES_BACKEND_OVERRIDE: "gas" }
  );
  assert.deepEqual(loaded.result, { preferredBackend: "d1", activeBackend: "d1", page: "fiche.html?id=abc" });
  assert.equal(loaded.storage.FRJ_MEMBRES_BACKEND_OVERRIDE, undefined);
  assert.equal(loaded.replacedUrl, "/index.html?vue=actifs");
});

test("une panne de santé D1 active GAS sans ajouter de paramètre à l'URL", async () => {
  const loaded = loadConfigState(
    "https://site.example.test/index.html",
    {},
    "globalThis.__testPromise = ensurePreferredBackendAvailable().then(() => ({ backend: getActiveBackend() }));",
    { fetch: async url => String(url).endsWith("/health") ? new Response("indisponible", { status: 503 }) : Response.json({}) }
  );
  assert.deepEqual(JSON.parse(JSON.stringify(await loaded.pending)), { backend: "gas" });
  assert.equal(loaded.replacedUrl, null);
  assert.equal(loaded.storage.FRJ_MEMBRES_BACKEND_OVERRIDE, undefined);
});

test("une lecture D1 en échec est rejouée une seule fois sur GAS", async () => {
  const calls = [];
  const loaded = loadConfigState(
    "https://site.example.test/index.html",
    {},
    `${clientSource}
     globalThis.__testPromise = apiRequest("getMembres");`,
    { fetch: async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method || "GET" });
      if (String(url).endsWith("/health")) return Response.json({ ok: true });
      if (String(url).startsWith("https://frj-membres-soc-api")) {
        return Response.json({ error: "D1 indisponible" }, { status: 503 });
      }
      return Response.json({ source: "gas" });
    } }
  );
  assert.deepEqual(JSON.parse(JSON.stringify(await loaded.pending)), { source: "gas" });
  assert.equal(calls.filter(call => call.url.includes("script.google.com")).length, 1);
});

test("une écriture D1 déjà envoyée n'est jamais rejouée sur GAS", async () => {
  const calls = [];
  const loaded = loadConfigState(
    "https://site.example.test/index.html",
    { FRJ_MEMBRES_ADMIN_SESSION: "session-signee" },
    `${clientSource}
     globalThis.__testPromise = apiRequest("updateMembreInfos", { membreId: "abc" }, "POST");`,
    { fetch: async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method || "GET" });
      if (String(url).endsWith("/health")) return Response.json({ ok: true });
      if (String(url).endsWith("/auth/session")) {
        return Response.json({ authenticated: true, authorized: true, frjMember: true, user: { id: "1", name: "RH" } });
      }
      return Response.json({ error: "résultat incertain" }, { status: 503 });
    } }
  );
  await assert.rejects(loaded.pending, /résultat incertain/);
  const businessPosts = calls.filter(call => call.method === "POST");
  assert.equal(businessPosts.length, 1);
  assert.equal(businessPosts[0].url, "https://frj-membres-soc-api.merlin-merzhin-lesage.workers.dev");
});

test("une sonde D1 en échec route une écriture non envoyée vers GAS", async () => {
  const calls = [];
  const loaded = loadConfigState(
    "https://site.example.test/index.html",
    { FRJ_MEMBRES_ADMIN_SESSION: "session-signee" },
    `${clientSource}
     globalThis.__testPromise = apiRequest("updateMembreInfos", { membreId: "abc" }, "POST");`,
    { fetch: async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method || "GET" });
      if (String(url).endsWith("/health")) return new Response("indisponible", { status: 503 });
      if (String(url).endsWith("/auth/session")) {
        return Response.json({ authenticated: true, authorized: true, frjMember: true, user: { id: "1", name: "RH" } });
      }
      return Response.json({ success: true, source: "gas" });
    } }
  );
  assert.deepEqual(JSON.parse(JSON.stringify(await loaded.pending)), { success: true, source: "gas" });
  const businessPosts = calls.filter(call => call.method === "POST");
  assert.equal(businessPosts.length, 1);
  assert.match(businessPosts[0].url, /^https:\/\/script\.google\.com\//);
});

test("une commande réservée à D1 n'est jamais envoyée à GAS", async () => {
  const calls = [];
  const loaded = loadConfigState(
    "https://site.example.test/sync.html",
    { FRJ_MEMBRES_ADMIN_SESSION: "session-signee" },
    `${clientSource}
     globalThis.__testPromise = apiRequestD1Only("runSyncAudit");`,
    { fetch: async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method || "GET" });
      return new Response("indisponible", { status: 503 });
    } }
  );
  await assert.rejects(loaded.pending, /ne peut pas être exécutée sur GAS/);
  assert.equal(calls.some(call => call.url.includes("script.google.com")), false);
  assert.equal(calls.some(call => call.method === "POST"), false);
});

test("une erreur serveur de vérification Discord conserve le dernier accès validé pour GAS", async () => {
  const cachedState = {
    authenticated: true,
    authorized: true,
    frjMember: true,
    user: { id: "1", name: "RH en cache" }
  };
  const loaded = loadConfigState(
    "https://site.example.test/index.html",
    {
      FRJ_MEMBRES_ADMIN_SESSION: "session-signee",
      FRJ_MEMBRES_AUTH_CACHE: JSON.stringify(cachedState)
    },
    "globalThis.__testPromise = ensureAuthState(true);",
    { fetch: async () => new Response("indisponible", { status: 503 }) }
  );
  const state = JSON.parse(JSON.stringify(await loaded.pending));
  assert.equal(state.authenticated, true);
  assert.equal(state.authorized, true);
  assert.equal(state.stale, true);
  assert.equal(state.reason, "verification_unavailable");
});

test("un refus OAuth nettoie la session et conserve un message public explicite", () => {
  const state = "oauthstate12345678901234567890";
  const loaded = loadConfigState(
    `https://site.example.test/index.html#admin_error=Compte+absent&admin_error_code=not_guild_member&admin_state=${state}`,
    {
      FRJ_MEMBRES_ADMIN_OAUTH_STATE: state,
      FRJ_MEMBRES_ADMIN_SESSION: "ancienne-session",
      FRJ_MEMBRES_AUTH_CACHE: "ancienne-valeur"
    }
  );
  assert.equal(loaded.storage.FRJ_MEMBRES_ADMIN_SESSION, undefined);
  assert.equal(loaded.storage.FRJ_MEMBRES_AUTH_CACHE, undefined);
  assert.deepEqual(JSON.parse(loaded.storage.FRJ_MEMBRES_ADMIN_AUTH_ERROR), {
    message: "Compte absent",
    code: "not_guild_member"
  });
  assert.equal(loaded.replacedUrl, "/index.html");
});

test("un retour OAuth valide stocke la session seulement si l'état correspond", () => {
  const state = "oauthstate12345678901234567890";
  const accepted = loadConfigState(
    `https://site.example.test/index.html#admin_session=session-signee&admin_state=${state}`,
    { FRJ_MEMBRES_ADMIN_OAUTH_STATE: state }
  );
  assert.equal(accepted.storage.FRJ_MEMBRES_ADMIN_SESSION, "session-signee");
  assert.equal(accepted.storage.FRJ_MEMBRES_ADMIN_OAUTH_STATE, undefined);

  const refused = loadConfigState(
    `https://site.example.test/index.html#admin_session=session-attaquant&admin_state=mauvais-etat`,
    { FRJ_MEMBRES_ADMIN_OAUTH_STATE: state }
  );
  assert.equal(refused.storage.FRJ_MEMBRES_ADMIN_SESSION, undefined);
  assert.equal(JSON.parse(refused.storage.FRJ_MEMBRES_ADMIN_AUTH_ERROR).code, "invalid_state");
});

test("une reconnexion réussie efface l'ancien avis de déconnexion", () => {
  assert.match(indexSource, /if \(authenticated\) \{\s*clearAuthenticationNotice\(\);/);
  assert.match(indexSource, /function clearAuthenticationNotice\(\) \{[\s\S]*notice\.textContent = "";[\s\S]*notice\.style\.display = "none";/);
});

test("mémorise la page courante une seule fois pendant la connexion", () => {
  const page = "fiche.html?backend=gas&id=abc#historique";
  const loaded = loadConfigState(
    "https://site.example.test/index.html",
    {},
    `rememberAuthenticationReturnPage(${JSON.stringify(page)});
     globalThis.__testResult = {
       first: takeAuthenticationReturnPage(),
       second: takeAuthenticationReturnPage()
     };`
  );
  assert.deepEqual(loaded.testResult, { first: "fiche.html?id=abc#historique", second: "" });
  assert.equal(loaded.storage.FRJ_MEMBRES_AUTH_RETURN_PAGE, undefined);
});

test("rafraîchit après connexion uniquement une page interne mémorisée", () => {
  assert.match(indexSource, /if \(authenticated\) \{[\s\S]*refreshPageAfterAuthentication\(\);/);
  assert.match(indexSource, /target\.origin !== window\.location\.origin/);
  assert.match(indexSource, /target\.pathname\.startsWith\(siteRoot\.pathname\)/);
  assert.match(indexSource, /document\.getElementById\("mainFrame"\)\.src = page;/);
});

test("affiche explicitement le niveau Consultation FRJ", () => {
  assert.match(indexSource, /frjMember \? `\$\{name\} — Consultation FRJ`/);
});

test("recharge la fiche à la déconnexion pour retirer immédiatement les données RH", () => {
  assert.match(indexSource, /const currentPage = getCurrentFramePage\(\);\s*logoutDiscord\(\);/);
  assert.match(indexSource, /renderAuthentication\(authState\);\s*reloadInternalPage\(currentPage\);/);
});

test("mémorise l'URL réellement affichée dans l'iframe plutôt que son ancien attribut src", () => {
  assert.match(indexSource, /rememberAuthenticationReturnPage\(getCurrentFramePage\(\)\)/);
  assert.match(indexSource, /frame\.contentWindow\.location\.href/);
  assert.match(indexSource, /target\.pathname\.slice\(siteRoot\.pathname\.length\) \+ target\.search \+ target\.hash/);
});

test("masque automatiquement l'avis de déconnexion après quinze secondes", () => {
  assert.match(indexSource, /notice\.code === "logged_out" \? 15000 : 0/);
  assert.match(indexSource, /setTimeout\(clearAuthenticationNotice, timeoutMs\)/);
  assert.match(indexSource, /clearTimeout\(authenticationNoticeTimer\)/);
  assert.match(indexSource, /logoutDiscord\(\);\s*const notice = takeAuthenticationNotice\(\);/);
});

test("un refus d'autorisation déclasse immédiatement l'interface sans supprimer la session", () => {
  const cachedState = {
    authenticated: true,
    authorized: true,
    user: { id: "123456789012345678", name: "RH Test" },
    reason: null
  };
  const loaded = loadConfigState(
    "https://site.example.test/index.html?backend=gas",
    {
      FRJ_MEMBRES_ADMIN_SESSION: "session-signee",
      FRJ_MEMBRES_AUTH_CACHE: JSON.stringify(cachedState)
    },
    'markAuthorizationDenied("role_required");'
  );
  assert.equal(loaded.storage.FRJ_MEMBRES_ADMIN_SESSION, "session-signee");
  const downgraded = JSON.parse(loaded.storage.FRJ_MEMBRES_AUTH_CACHE);
  assert.equal(downgraded.authenticated, true);
  assert.equal(downgraded.authorized, false);
  assert.equal(downgraded.user.name, "RH Test");
  assert.equal(downgraded.reason, "role_required");
});

test("un refus d'écriture conserve le niveau de lecture FRJ", () => {
  const cachedState = {
    authenticated: true,
    authorized: false,
    frjMember: true,
    user: { id: "123456789012345678", name: "FRJ Test" },
    reason: null
  };
  const loaded = loadConfigState(
    "https://site.example.test/index.html",
    {
      FRJ_MEMBRES_ADMIN_SESSION: "session-signee",
      FRJ_MEMBRES_AUTH_CACHE: JSON.stringify(cachedState)
    },
    'markAuthorizationDenied("role_required");'
  );
  const downgraded = JSON.parse(loaded.storage.FRJ_MEMBRES_AUTH_CACHE);
  assert.equal(downgraded.authorized, false);
  assert.equal(downgraded.frjMember, true);
});

test("un refus D1 confirmé retire un ancien niveau FRJ du cache", () => {
  const cachedState = {
    authenticated: true,
    authorized: false,
    frjMember: true,
    user: { id: "123456789012345678", name: "Ancien FRJ" }
  };
  const loaded = loadConfigState(
    "https://site.example.test/index.html",
    {
      FRJ_MEMBRES_ADMIN_SESSION: "session-signee",
      FRJ_MEMBRES_AUTH_CACHE: JSON.stringify(cachedState)
    },
    'markAuthorizationDenied("role_required", false);'
  );
  const downgraded = JSON.parse(loaded.storage.FRJ_MEMBRES_AUTH_CACHE);
  assert.equal(downgraded.authenticated, true);
  assert.equal(downgraded.frjMember, false);
});

test("une panne de la lecture RH GAS conserve la fiche publique déjà affichée", () => {
  const loadFicheSource = clientSource.match(/async function loadFiche\(membreId, forceRefresh = false\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(loadFicheSource, /data = await apiRequest\(\s*"getFiche"/);
  assert.match(loadFicheSource, /displayFiche\(container, data\.membre, data\.historique, publicDiscordRoles\)/);
  assert.match(loadFicheSource, /fiche publique conservée/);
  assert.ok(
    loadFicheSource.indexOf("displayFiche(container") < loadFicheSource.indexOf("loadProtectedDiscordRoles(membreId)"),
    "la fiche publique doit être affichée avant l'enrichissement RH"
  );
});

test("relit la fiche sans cache après une modification RH", () => {
  const loadFicheSource = clientSource.match(/async function loadFiche\(membreId, forceRefresh = false\) \{[\s\S]*?\n\}/)?.[0] || "";
  const memberActionSource = clientSource.match(/async function handleMembreAction\([\s\S]*?\n\}/)?.[0] || "";
  const editInfoSource = clientSource.match(/async function handleEditMembreInfos\([\s\S]*?\n\}/)?.[0] || "";

  assert.match(loadFicheSource, /forceRefresh \? \{ refresh: Date\.now\(\) \} : \{\}/);
  assert.match(memberActionSource, /await loadFiche\(membre\.id, true\)/);
  assert.match(editInfoSource, /await loadFiche\(membre\.id, true\)/);
});

test("lit toujours les responsabilités semi-privées via D1", () => {
  assert.match(clientSource, /await getFrjReadAuthorization\(\)/);
  assert.match(clientSource, /return apiRequestToBackend\(\s*"d1",\s*"getDiscordRolesForMember"/);
  assert.match(clientSource, /await loadProtectedDiscordRoles\(membreId\)/);
});

test("le retour de synchronisation remplace le shell parent", () => {
  assert.match(syncSource, /<a href="index\.html" target="_parent" class="link-header">/);
});

test("la page de synchronisation vérifie D1 avant toute commande réservée à D1", () => {
  assert.match(syncSource, /await ensurePreferredBackendAvailable\(\);[\s\S]*getActiveBackend\(\) !== "d1"/);
  assert.match(syncSource, /apiRequestD1Only\("getSyncStatus"\)/);
  assert.match(syncSource, /async function runD1SyncAction\(action\)[\s\S]*await apiRequestD1Only\(action\);/);
  assert.match(clientSource, /async function apiRequestD1Only[\s\S]*cette commande ne peut pas être exécutée sur GAS/);
});

test("sépare fonctions et activités en deux cartes responsives", () => {
  assert.match(clientSource, /<h2>Fonctions<\/h2>/);
  assert.match(clientSource, /<h2>Activités<\/h2>/);
  assert.match(clientSource, /discord-functions-card/);
  assert.match(clientSource, /discord-activities-card/);
  assert.match(styleSource, /\.discord-roles-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(auto-fit, minmax\(260px, 1fr\)\)/);
});

test("centre tout le contenu des cartes Fonctions et Activités", () => {
  assert.match(styleSource, /\.discord-role-card\s*\{[\s\S]*text-align:\s*center/);
  assert.match(styleSource, /\.discord-role-badges\s*\{[\s\S]*justify-content:\s*center/);
  assert.match(styleSource, /\.discord-role-badge\s*\{[\s\S]*justify-content:\s*center/);
  assert.match(styleSource, /\.discord-staff-section\s*\{[\s\S]*text-align:\s*center/);
  assert.match(styleSource, /\.discord-roles-synced-at\s*\{[\s\S]*text-align:\s*center/);
});
