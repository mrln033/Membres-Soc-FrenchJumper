const GAS_API_URL = "https://script.google.com/macros/s/AKfycbzf40jOrUs79_O5PASuc7Y-OOZv_C2RZV1bY7r97WhF8iVVQ6f4nIpBCCRh_0IOIozSew/exec";
const D1_API_URL = "https://frj-membres-soc-api.merlin-merzhin-lesage.workers.dev";
const D1_ADMIN_TOKEN_KEY = "FRJ_MEMBRES_D1_ADMIN_TOKEN";
const ADMIN_SESSION_KEY = "FRJ_MEMBRES_ADMIN_SESSION";
const ADMIN_OAUTH_STATE_KEY = "FRJ_MEMBRES_ADMIN_OAUTH_STATE";
const ADMIN_AUTH_ERROR_KEY = "FRJ_MEMBRES_ADMIN_AUTH_ERROR";
const ADMIN_AUTH_CACHE_KEY = "FRJ_MEMBRES_AUTH_CACHE";
const ADMIN_AUTH_MESSAGE_TYPE = "frj-discord-auth";
const D1_HEALTH_TIMEOUT_MS = 3500;

const currentParams = new URLSearchParams(window.location.search);
const requestedBackend = String(currentParams.get("backend") || "").trim().toLowerCase();
const preferredBackend = requestedBackend === "gas" ? "gas" : "d1";
const API_URL = preferredBackend === "d1" ? D1_API_URL : GAS_API_URL;
const API_BACKENDS = Object.freeze({ gas: GAS_API_URL, d1: D1_API_URL });

let authConfigPromise = null;
let authStatePromise = null;
let backendReadyPromise = null;
let authState = Object.freeze({ authenticated: false, authorized: false, user: null, reason: null });
let isAdmin = false;

consumeDiscordAuthCallback();
removeObsoleteAdminParameter();
installDiscordAuthMessageListener();

function removeObsoleteAdminParameter() {
    if (!currentParams.has("admin")) return;
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete("admin");
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
        if (!session) return applyAuthState({ authenticated: false, authorized: false, user: null, reason: null });
        try {
            const response = await fetch(D1_API_URL + "/auth/session", {
                cache: "no-store",
                headers: { Authorization: `Bearer ${session}` }
            });
            const result = await response.json().catch(() => ({}));
            if (response.status === 401 || result.authenticated !== true) {
                clearStoredSession();
                return applyAuthState({ authenticated: false, authorized: false, user: null, reason: "invalid_session" });
            }
            return applyAuthState({
                authenticated: true,
                authorized: result.authorized === true,
                user: result.user || null,
                reason: result.reason || (response.ok ? null : "discord_unavailable")
            });
        } catch {
            const cached = readCachedAuthState();
            if (cached && cached.authenticated) {
                return applyAuthState({ ...cached, stale: true, reason: "verification_unavailable" }, false);
            }
            return applyAuthState({ authenticated: false, authorized: false, user: null, reason: "verification_unavailable", stale: true }, false);
        }
    })().finally(() => { authStatePromise = null; });
    return authStatePromise;
}

function applyAuthState(nextState, persist = true) {
    authState = Object.freeze({
        authenticated: Boolean(nextState.authenticated), authorized: Boolean(nextState.authorized),
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
    const config = await getAdminAuthConfig();
    if (config.mode === "discord") {
        throw new Error(state.authenticated
            ? "Votre compte Discord est connecté, mais ne possède pas un rôle RH autorisé."
            : "Connexion Discord requise pour cette action.");
    }
    let token = sessionStorage.getItem(D1_ADMIN_TOKEN_KEY) || "";
    if (!token) {
        token = String(window.prompt("Jeton administrateur D1 :") || "").trim();
        if (!token) throw new Error("Action annulée : aucun jeton administrateur D1 fourni.");
        sessionStorage.setItem(D1_ADMIN_TOKEN_KEY, token);
    }
    return token;
}

function clearStoredSession() {
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
    sessionStorage.removeItem(ADMIN_AUTH_CACHE_KEY);
    authStatePromise = null;
}

function clearAdminAuthorization() {
    clearStoredSession();
    sessionStorage.removeItem(D1_ADMIN_TOKEN_KEY);
    applyAuthState({ authenticated: false, authorized: false, user: null, reason: null });
}

function markAuthorizationDenied(reason = "role_required") {
    const cached = readCachedAuthState();
    const session = sessionStorage.getItem(ADMIN_SESSION_KEY) || "";
    return applyAuthState({
        authenticated: Boolean(session),
        authorized: false,
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
    setAuthenticationNotice("Vous êtes déconnecté. La consultation publique reste disponible.", "logged_out");
}

function ensurePreferredBackendAvailable() {
    if (preferredBackend === "gas") return Promise.resolve();
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
            redirectToGas(error);
            throw new Error("D1 indisponible, redirection vers GAS…");
        } finally { clearTimeout(timeout); }
    })();
    return backendReadyPromise;
}

function redirectToGas(reason) {
    console.warn("D1 indisponible, basculement vers GAS.", reason);
    const target = new URL(window.location.href);
    if (String(target.searchParams.get("backend") || "").toLowerCase() === "gas") return;
    target.searchParams.set("backend", "gas");
    window.location.replace(target.toString());
}

function buildInternalPageUrl(path, extraParams = {}) {
    const url = new URL(path, window.location.href);
    if (preferredBackend === "gas") url.searchParams.set("backend", "gas");
    else url.searchParams.delete("backend");
    url.searchParams.delete("admin");
    Object.entries(extraParams).forEach(([key, value]) => url.searchParams.set(key, value));
    return url.pathname.split("/").pop() + url.search;
}

function preserveBackendInLinks() {
    document.querySelectorAll("a[href]").forEach(link => {
        const url = new URL(link.href, window.location.href);
        if (url.origin !== window.location.origin || !url.pathname.endsWith(".html")) return;
        if (preferredBackend === "gas") url.searchParams.set("backend", "gas");
        else url.searchParams.delete("backend");
        url.searchParams.delete("admin");
        link.href = url.toString();
    });
}

function bytesToBase64Url(bytes) {
    let binary = "";
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", preserveBackendInLinks);
else preserveBackendInLinks();
console.log("Backend prioritaire :", preferredBackend === "d1" ? "Cloudflare D1" : "Google Sheets / GAS");
