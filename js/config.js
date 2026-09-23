const GAS_API_URL = "https://script.google.com/macros/s/AKfycbzf40jOrUs79_O5PASuc7Y-OOZv_C2RZV1bY7r97WhF8iVVQ6f4nIpBCCRh_0IOIozSew/exec";
const D1_API_URL = "https://frj-membres-soc-api.merlin-merzhin-lesage.workers.dev";
const ADMIN_SESSION_KEY = "FRJ_MEMBRES_ADMIN_SESSION";
const ADMIN_OAUTH_STATE_KEY = "FRJ_MEMBRES_ADMIN_OAUTH_STATE";
const ADMIN_AUTH_ERROR_KEY = "FRJ_MEMBRES_ADMIN_AUTH_ERROR";
const ADMIN_AUTH_CACHE_KEY = "FRJ_MEMBRES_AUTH_CACHE";
const ADMIN_AUTH_RETURN_PAGE_KEY = "FRJ_MEMBRES_AUTH_RETURN_PAGE";
const BACKEND_OVERRIDE_KEY = "FRJ_MEMBRES_BACKEND_OVERRIDE";
const ADMIN_AUTH_MESSAGE_TYPE = "frj-discord-auth";
const D1_HEALTH_TIMEOUT_MS = 3500;

const currentParams = new URLSearchParams(window.location.search);
const requestedBackend = String(currentParams.get("backend") || "").trim().toLowerCase();
// Le paramètre backend est une commande de test ponctuelle : GAS reste forcé
// dans l'onglet jusqu'à un backend=d1 explicite ou la fermeture de l'onglet.
// Il est ensuite retiré de l'adresse et ne se propage jamais dans les liens.
const preferredBackend = resolvePreferredBackend(requestedBackend);
const API_BACKENDS = Object.freeze({ gas: GAS_API_URL, d1: D1_API_URL });

let authConfigPromise = null;
let authStatePromise = null;
let backendReadyPromise = null;
let activeBackend = preferredBackend;
let authState = Object.freeze({ authenticated: false, authorized: false, frjMember: false, user: null, reason: null });
let isAdmin = false;

consumeDiscordAuthCallback();
removeObsoleteRoutingParameters();
installDiscordAuthMessageListener();

function resolvePreferredBackend(requested) {
    if (requested === "gas") {
        writeBackendOverride("gas");
        return "gas";
    }
    if (requested === "d1") {
        writeBackendOverride("");
        return "d1";
    }
    try {
        return sessionStorage.getItem(BACKEND_OVERRIDE_KEY) === "gas" ? "gas" : "d1";
    } catch {
        return "d1";
    }
}

function writeBackendOverride(value) {
    try {
        if (value === "gas") sessionStorage.setItem(BACKEND_OVERRIDE_KEY, "gas");
        else sessionStorage.removeItem(BACKEND_OVERRIDE_KEY);
    } catch (error) {
        console.warn("Impossible de mémoriser le backend de test dans cet onglet.", error);
    }
}

function removeObsoleteRoutingParameters() {
    if (!currentParams.has("admin") && !currentParams.has("backend")) return;
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete("admin");
    cleanUrl.searchParams.delete("backend");
    history.replaceState(null, document.title, cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
}

function consumeDiscordAuthCallback(fragmentValue = window.location.hash) {
    const fragment = new URLSearchParams(String(fragmentValue || "").replace(/^#/, ""));
    const session = fragment.get("admin_session");
    const error = fragment.get("admin_error");
    if (!session && !error) return false;
    const expectedState = sessionStorage.getItem(ADMIN_OAUTH_STATE_KEY) || "";
    const returnedState = fragment.get("admin_state") || "";
    sessionStorage.removeItem(ADMIN_OAUTH_STATE_KEY);
    if (!expectedState || returnedState !== expectedState) {
        clearStoredSession();
        setAuthenticationNotice("Réponse OAuth Discord invalide ou expirée.", "invalid_state");
    } else if (session) {
        sessionStorage.setItem(ADMIN_SESSION_KEY, session);
        sessionStorage.removeItem(ADMIN_AUTH_ERROR_KEY);
        authStatePromise = null;
    } else {
        clearStoredSession();
        setAuthenticationNotice(
            error || "Connexion Discord refusée. La consultation publique reste disponible.",
            fragment.get("admin_error_code") || "discord_login_failed"
        );
    }
    if (window.location.hash) history.replaceState(null, document.title, window.location.pathname + window.location.search);
    return true;
}

function installDiscordAuthMessageListener() {
    window.addEventListener("message", event => {
        if (event.origin !== window.location.origin || event.source === null) return;
        if (!event.data || event.data.type !== ADMIN_AUTH_MESSAGE_TYPE) return;
        if (!consumeDiscordAuthCallback(event.data.fragment)) return;
        ensureAuthState(true).catch(() => {}).finally(() => dispatchAuthStateChanged());
    });
}

function setAuthenticationNotice(message, code = "") {
    sessionStorage.setItem(ADMIN_AUTH_ERROR_KEY, JSON.stringify({ message: String(message), code: String(code) }));
}

function takeAuthenticationNotice() {
    const stored = sessionStorage.getItem(ADMIN_AUTH_ERROR_KEY);
    if (!stored) return null;
    sessionStorage.removeItem(ADMIN_AUTH_ERROR_KEY);
    try { return JSON.parse(stored); } catch { return { message: stored, code: "" }; }
}

function rememberAuthenticationReturnPage(page) {
    const value = sanitizeInternalPage(page);
    if (value) sessionStorage.setItem(ADMIN_AUTH_RETURN_PAGE_KEY, value);
    else sessionStorage.removeItem(ADMIN_AUTH_RETURN_PAGE_KEY);
}

function takeAuthenticationReturnPage() {
    const page = sessionStorage.getItem(ADMIN_AUTH_RETURN_PAGE_KEY) || "";
    sessionStorage.removeItem(ADMIN_AUTH_RETURN_PAGE_KEY);
    return sanitizeInternalPage(page);
}

function sanitizeInternalPage(page) {
    const value = String(page || "").trim();
    if (!value) return "";
    try {
        const target = new URL(value, window.location.href);
        const siteRoot = new URL(".", window.location.href);
        if (target.origin !== window.location.origin || !target.pathname.startsWith(siteRoot.pathname)) return "";
        target.searchParams.delete("backend");
        target.searchParams.delete("admin");
        return target.pathname.slice(siteRoot.pathname.length) + target.search + target.hash;
    } catch {
        return "";
    }
}

function getAdminAuthConfig() {
    if (!authConfigPromise) {
        authConfigPromise = fetch(D1_API_URL + "/auth/config", { cache: "no-store" })
            .then(response => {
                if (!response.ok) throw new Error("Configuration de connexion indisponible");
                return response.json();
            })
            .catch(error => { authConfigPromise = null; throw error; });
    }
    return authConfigPromise;
}

async function ensureAuthState(force = false) {
    if (force) authStatePromise = null;
    if (authStatePromise) return authStatePromise;
    authStatePromise = (async () => {
        const session = sessionStorage.getItem(ADMIN_SESSION_KEY) || "";
        if (!session) return applyAuthState({ authenticated: false, authorized: false, frjMember: false, user: null, reason: null });
        try {
            const response = await fetch(D1_API_URL + "/auth/session", {
                cache: "no-store",
                headers: { Authorization: `Bearer ${session}` }
            });
            // Une indisponibilité serveur doit emprunter le même chemin que
            // l'erreur réseau afin que le secours GAS puisse utiliser le
            // dernier état Discord validé, marqué comme périmé.
            if (response.status >= 500) throw new Error("Vérification Discord temporairement indisponible");
            const result = await response.json().catch(() => ({}));
            if (response.status === 401 || result.authenticated !== true) {
                clearStoredSession();
                return applyAuthState({ authenticated: false, authorized: false, frjMember: false, user: null, reason: "invalid_session" });
            }
            return applyAuthState({
                authenticated: true,
                authorized: result.authorized === true,
                frjMember: result.frjMember === true,
                user: result.user || null,
                reason: result.reason || (response.ok ? null : "discord_unavailable")
            });
        } catch {
            const cached = readCachedAuthState();
            if (cached && cached.authenticated) {
                return applyAuthState({ ...cached, stale: true, reason: "verification_unavailable" }, false);
            }
            return applyAuthState({ authenticated: false, authorized: false, frjMember: false, user: null, reason: "verification_unavailable", stale: true }, false);
        }
    })().finally(() => { authStatePromise = null; });
    return authStatePromise;
}

function applyAuthState(nextState, persist = true) {
    authState = Object.freeze({
        authenticated: Boolean(nextState.authenticated), authorized: Boolean(nextState.authorized),
        frjMember: Boolean(nextState.frjMember),
        user: nextState.user || null, reason: nextState.reason || null, stale: Boolean(nextState.stale)
    });
    isAdmin = authState.authorized;
    if (persist && authState.authenticated) sessionStorage.setItem(ADMIN_AUTH_CACHE_KEY, JSON.stringify(authState));
    else if (!authState.authenticated && !authState.stale) sessionStorage.removeItem(ADMIN_AUTH_CACHE_KEY);
    dispatchAuthStateChanged();
    return authState;
}

function readCachedAuthState() {
    try { return JSON.parse(sessionStorage.getItem(ADMIN_AUTH_CACHE_KEY) || "null"); } catch { return null; }
}

function dispatchAuthStateChanged() {
    window.dispatchEvent(new CustomEvent("frj-auth-state-changed", { detail: authState }));
}

async function getAdminAuthorization() {
    const state = await ensureAuthState();
    if (state.authorized) return sessionStorage.getItem(ADMIN_SESSION_KEY) || "";
    throw new Error(state.authenticated
        ? "Votre compte Discord est connecté, mais ne possède pas un rôle RH autorisé."
        : "Connexion Discord requise pour cette action.");
}

async function getFrjReadAuthorization() {
    const state = await ensureAuthState();
    if (state.authenticated && (state.authorized || state.frjMember)) {
        return sessionStorage.getItem(ADMIN_SESSION_KEY) || "";
    }
    throw new Error("Connexion Discord avec le rôle FRJ requise pour consulter les responsabilités Discord.");
}

function clearStoredSession() {
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
    sessionStorage.removeItem(ADMIN_AUTH_CACHE_KEY);
    authStatePromise = null;
}

function clearAdminAuthorization() {
    clearStoredSession();
    applyAuthState({ authenticated: false, authorized: false, frjMember: false, user: null, reason: null });
}

function markAuthorizationDenied(reason = "role_required", confirmedFrjMember = null) {
    const cached = readCachedAuthState();
    const session = sessionStorage.getItem(ADMIN_SESSION_KEY) || "";
    return applyAuthState({
        authenticated: Boolean(session),
        authorized: false,
        frjMember: confirmedFrjMember === null
            ? Boolean(cached && cached.frjMember)
            : confirmedFrjMember === true,
        user: authState.user || (cached && cached.user) || null,
        reason
    });
}

async function beginDiscordLogin() {
    const config = await getAdminAuthConfig();
    if (config.mode !== "discord" || !config.configured) throw new Error("Connexion Discord non configurée côté serveur.");
    const random = new Uint8Array(32);
    crypto.getRandomValues(random);
    const clientState = bytesToBase64Url(random);
    sessionStorage.setItem(ADMIN_OAUTH_STATE_KEY, clientState);
    const callbackUrl = new URL("oauth-callback.html", window.location.href);
    callbackUrl.search = "";
    callbackUrl.hash = "";
    const popup = window.open(buildDiscordLoginUrl(callbackUrl, clientState), "frjDiscordLogin", "popup,width=520,height=760");
    if (popup) { popup.focus(); return; }
    const fallbackReturn = new URL(window.location.href);
    fallbackReturn.hash = "";
    window.location.assign(buildDiscordLoginUrl(fallbackReturn, clientState));
}

function buildDiscordLoginUrl(returnTo, clientState) {
    const loginUrl = new URL(D1_API_URL + "/auth/discord/login");
    loginUrl.searchParams.set("returnTo", returnTo.toString());
    loginUrl.searchParams.set("clientState", clientState);
    return loginUrl.toString();
}

function logoutDiscord() {
    clearAdminAuthorization();
    setAuthenticationNotice("Vous êtes déconnecté. Consultation publique active.", "logged_out");
}

function ensurePreferredBackendAvailable(forceProbe = false) {
    if (activeBackend === "gas") return Promise.resolve(activeBackend);
    // Une écriture demande une sonde fraîche : D1 a pu tomber depuis la
    // première lecture de la page. Le test reste antérieur à tout envoi métier.
    if (forceProbe) backendReadyPromise = null;
    if (backendReadyPromise) return backendReadyPromise;
    backendReadyPromise = (async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), D1_HEALTH_TIMEOUT_MS);
        try {
            const response = await fetch(D1_API_URL + "/health", { cache: "no-store", signal: controller.signal });
            if (!response.ok) throw new Error("D1 HTTP " + response.status);
            const health = await response.json();
            if (health.ok !== true) throw new Error("Réponse de santé D1 invalide");
        } catch (error) {
            activateGasFallback(error);
        } finally { clearTimeout(timeout); }
        return activeBackend;
    })();
    return backendReadyPromise;
}

function activateGasFallback(reason) {
    if (activeBackend === "gas") return activeBackend;
    console.warn("D1 indisponible, basculement vers GAS.", reason);
    activeBackend = "gas";
    window.dispatchEvent(new CustomEvent("frj-backend-changed", {
        detail: { backend: activeBackend, automatic: preferredBackend === "d1" }
    }));
    return activeBackend;
}

function getActiveBackend() {
    return activeBackend;
}

function buildInternalPageUrl(path, extraParams = {}) {
    const url = new URL(path, window.location.href);
    Object.entries(extraParams).forEach(([key, value]) => url.searchParams.set(key, value));
    // Même un appelant ancien ne peut plus réintroduire ces paramètres dans un lien.
    url.searchParams.delete("backend");
    url.searchParams.delete("admin");
    return url.pathname.split("/").pop() + url.search + url.hash;
}

function removeRoutingParametersFromLinks() {
    document.querySelectorAll("a[href]").forEach(link => {
        const url = new URL(link.href, window.location.href);
        if (url.origin !== window.location.origin) return;
        url.searchParams.delete("backend");
        url.searchParams.delete("admin");
        link.href = url.toString();
    });
}

function bytesToBase64Url(bytes) {
    let binary = "";
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", removeRoutingParametersFromLinks);
else removeRoutingParametersFromLinks();
console.log("Backend prioritaire :", preferredBackend === "d1" ? "Cloudflare D1" : "Google Sheets / GAS");
