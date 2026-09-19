import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const configSource = readFileSync(new URL("../../../js/config.js", import.meta.url), "utf8");
const indexSource = readFileSync(new URL("../../../index.html", import.meta.url), "utf8");
const clientSource = readFileSync(new URL("../../../js/client.js", import.meta.url), "utf8");
const styleSource = readFileSync(new URL("../../../css/style.css", import.meta.url), "utf8");

function loadConfigState(url, initialStorage = {}, afterLoad = "") {
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
  const context = vm.createContext({
    URL,
    URLSearchParams,
    AbortController,
    Uint8Array,
    Promise,
    Error,
    Object,
    String,
    console,
    crypto: webcrypto,
    CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    btoa,
    fetch: async () => Response.json({ mode: "legacy", configured: true }),
    window,
    history: { replaceState(_state, _title, urlValue) { replacedUrl = urlValue; } },
    document: {
      title: "Test",
      readyState: "complete",
      querySelectorAll() { return []; }
    },
    sessionStorage: {
      getItem(key) { return values.has(key) ? values.get(key) : null; },
      setItem(key, value) { values.set(key, String(value)); },
      removeItem(key) { values.delete(key); }
    }
  });
  vm.runInContext(
    `${configSource}\n${afterLoad}\n;globalThis.__result = { preferredBackend, page: buildInternalPageUrl("fiche.html", { id: "abc" }) };`,
    context
  );
  // Ramène l'objet hors du realm vm pour une comparaison stricte fiable.
  return JSON.parse(JSON.stringify({
    result: context.__result,
    testResult: context.__testResult,
    storage: Object.fromEntries(values),
    replacedUrl
  }));
}

function loadConfig(url, initialStorage = {}) {
  return loadConfigState(url, initialStorage).result;
}

test("sélectionne D1 et supprime l'ancien paramètre admin", () => {
  assert.deepEqual(
    loadConfig("https://site.example.test/index.html"),
    { preferredBackend: "d1", page: "fiche.html?id=abc" }
  );
  assert.deepEqual(
    loadConfig("https://site.example.test/index.html?admin=1"),
    { preferredBackend: "d1", page: "fiche.html?id=abc" }
  );
  const legacyAdmin = loadConfigState("https://site.example.test/index.html?admin=1");
  assert.equal(legacyAdmin.storage.admin, undefined);
  assert.equal(legacyAdmin.replacedUrl, "/index.html");
});

test("accepte GAS sans tenir compte de la casse et le conserve dans les liens", () => {
  assert.deepEqual(
    loadConfig("https://site.example.test/index.html?backend=GAS"),
    { preferredBackend: "gas", page: "fiche.html?backend=gas&id=abc" }
  );
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
  assert.deepEqual(loaded.testResult, { first: page, second: "" });
  assert.equal(loaded.storage.FRJ_MEMBRES_AUTH_RETURN_PAGE, undefined);
});

test("rafraîchit après connexion uniquement une page interne mémorisée", () => {
  assert.match(indexSource, /if \(authenticated\) \{[\s\S]*refreshPageAfterAuthentication\(\);/);
  assert.match(indexSource, /target\.origin !== window\.location\.origin/);
  assert.match(indexSource, /target\.pathname\.startsWith\(siteRoot\.pathname\)/);
  assert.match(indexSource, /document\.getElementById\("mainFrame"\)\.src = page;/);
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

test("une panne de la lecture RH GAS conserve la fiche publique déjà affichée", () => {
  const loadFicheSource = clientSource.match(/async function loadFiche\(membreId\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(loadFicheSource, /data = await apiRequest\("getFiche"/);
  assert.match(loadFicheSource, /displayFiche\(container, data\.membre, data\.historique, publicDiscordRoles\)/);
  assert.match(loadFicheSource, /fiche publique conservée/);
  assert.ok(
    loadFicheSource.indexOf("displayFiche(container") < loadFicheSource.indexOf('apiRequest("getDiscordRolesForMember"'),
    "la fiche publique doit être affichée avant l'enrichissement RH"
  );
});

test("sépare fonctions et activités en deux cartes responsives", () => {
  assert.match(clientSource, /<h2>Fonctions<\/h2>/);
  assert.match(clientSource, /<h2>Activités<\/h2>/);
  assert.match(clientSource, /discord-functions-card/);
  assert.match(clientSource, /discord-activities-card/);
  assert.match(styleSource, /\.discord-roles-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(auto-fit, minmax\(260px, 1fr\)\)/);
});
