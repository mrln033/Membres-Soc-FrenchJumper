const GAS_API_URL = "https://script.google.com/macros/s/AKfycbzf40jOrUs79_O5PASuc7Y-OOZv_C2RZV1bY7r97WhF8iVVQ6f4nIpBCCRh_0IOIozSew/exec";
const D1_API_URL = "https://frj-membres-soc-api.merlin-merzhin-lesage.workers.dev";
const D1_ADMIN_TOKEN_KEY = "FRJ_MEMBRES_D1_ADMIN_TOKEN"; // Repli temporaire pendant la migration OAuth.
const ADMIN_SESSION_KEY = "FRJ_MEMBRES_ADMIN_SESSION";
const ADMIN_OAUTH_STATE_KEY = "FRJ_MEMBRES_ADMIN_OAUTH_STATE";
const ADMIN_AUTH_ERROR_KEY = "FRJ_MEMBRES_ADMIN_AUTH_ERROR";
const D1_HEALTH_TIMEOUT_MS = 3500;

const currentParams = new URLSearchParams(window.location.search);
const requestedBackend = String(currentParams.get("backend") || "").trim().toLowerCase();

// D1 est la cible normale. GAS n'est choisi que sur demande explicite ou après
// une redirection provoquée par l'indisponibilité constatée de D1.
const preferredBackend = requestedBackend === "gas" ? "gas" : "d1";
const API_URL = preferredBackend === "d1" ? D1_API_URL : GAS_API_URL;
const API_BACKENDS = Object.freeze({ gas: GAS_API_URL, d1: D1_API_URL });

let authConfigPromise = null;
let backendReadyPromise = null;

consumeDiscordAuthCallback();

if (currentParams.get("admin") === "1") {
    sessionStorage.setItem("admin", "true");
}

const isAdmin = sessionStorage.getItem("admin") === "true";

/** Extrait la session du fragment OAuth, qui n'est jamais envoyé aux serveurs. */
function consumeDiscordAuthCallback() {
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const session = fragment.get("admin_session");
    const error = fragment.get("admin_error");
    if (!session && !error) return;

    const expectedState = sessionStorage.getItem(ADMIN_OAUTH_STATE_KEY) || "";
    const returnedState = fragment.get("admin_state") || "";
    sessionStorage.removeItem(ADMIN_OAUTH_STATE_KEY);

    if (!expectedState || returnedState !== expectedState) {
        sessionStorage.removeItem(ADMIN_SESSION_KEY);
        sessionStorage.setItem(ADMIN_AUTH_ERROR_KEY, "Réponse OAuth Discord invalide ou expirée.");
    } else if (session) {
        sessionStorage.setItem(ADMIN_SESSION_KEY, session);
        sessionStorage.setItem("admin", "true");
        sessionStorage.removeItem(ADMIN_AUTH_ERROR_KEY);
    } else {
        sessionStorage.removeItem(ADMIN_SESSION_KEY);
        sessionStorage.setItem(ADMIN_AUTH_ERROR_KEY, error || "Connexion Discord refusée.");
    }

    history.replaceState(null, document.title, window.location.pathname + window.location.search);
}

/** Retourne la configuration publique du mode d'authentification du Worker. */
function getAdminAuthConfig() {
    if (!authConfigPromise) {
        authConfigPromise = fetch(D1_API_URL + "/auth/config", { cache: "no-store" })
            .then(response => {
                if (!response.ok) throw new Error("Configuration Admin indisponible");
                return response.json();
            })
            .catch(error => {
                authConfigPromise = null;
                throw error;
            });
    }
    return authConfigPromise;
}

/**
 * Fournit le justificatif d'administration. Le mode legacy reste disponible
 * uniquement pour permettre un déploiement progressif et un retour arrière.
 */
async function getAdminAuthorization() {
    const pendingError = sessionStorage.getItem(ADMIN_AUTH_ERROR_KEY);
    if (pendingError) {
        sessionStorage.removeItem(ADMIN_AUTH_ERROR_KEY);
        throw new Error(pendingError);
    }

    const session = sessionStorage.getItem(ADMIN_SESSION_KEY) || "";
    if (session) return session;

    const config = await getAdminAuthConfig();
    if (config.mode === "discord") {
        if (!config.configured) throw new Error("Connexion Discord non configurée côté serveur.");
        beginDiscordAdminLogin();
        throw new Error("Redirection vers Discord…");
    }

    // Compatibilité temporaire avec la version de production antérieure.
    let token = sessionStorage.getItem(D1_ADMIN_TOKEN_KEY) || "";
    if (!token) {
        token = String(window.prompt("Jeton administrateur D1 :") || "").trim();
        if (!token) throw new Error("Action annulée : aucun jeton administrateur D1 fourni.");
        sessionStorage.setItem(D1_ADMIN_TOKEN_KEY, token);
    }
    return token;
}

function clearAdminAuthorization() {
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
    sessionStorage.removeItem(D1_ADMIN_TOKEN_KEY);
}

/** Lance OAuth dans la fenêtre principale, y compris depuis une page iframe. */
function beginDiscordAdminLogin() {
    const random = new Uint8Array(32);
    crypto.getRandomValues(random);
    const clientState = bytesToBase64Url(random);
    sessionStorage.setItem(ADMIN_OAUTH_STATE_KEY, clientState);

    const topUrl = new URL(window.top.location.href);
    topUrl.hash = "";
    topUrl.searchParams.set("admin", "1");
    const loginUrl = new URL(D1_API_URL + "/auth/discord/login");
    loginUrl.searchParams.set("returnTo", topUrl.toString());
    loginUrl.searchParams.set("clientState", clientState);
    window.top.location.assign(loginUrl.toString());
}

/** Déclenche la connexion avant que l'utilisateur remplisse un formulaire. */
async function prepareAdminAuthentication() {
    if (!isAdmin || sessionStorage.getItem(ADMIN_SESSION_KEY)) return true;
    const config = await getAdminAuthConfig();
    if (config.mode === "discord") {
        if (!config.configured) throw new Error("Connexion Discord non configurée côté serveur.");
        beginDiscordAdminLogin();
        return false;
    }
    return true;
}

/**
 * Teste D1 une seule fois par page. Un échec réseau, un délai ou une réponse 5xx
 * provoque une navigation vers GAS ; aucune écriture n'est rejouée en aveugle.
 */
function ensurePreferredBackendAvailable() {
    if (preferredBackend === "gas") return Promise.resolve();
    if (backendReadyPromise) return backendReadyPromise;

    backendReadyPromise = (async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), D1_HEALTH_TIMEOUT_MS);
        try {
            const response = await fetch(D1_API_URL + "/health", {
                cache: "no-store",
                signal: controller.signal
            });
            if (!response.ok) throw new Error("D1 HTTP " + response.status);
            const health = await response.json();
            if (health.ok !== true) throw new Error("Réponse de santé D1 invalide");
        } catch (error) {
            redirectToGas(error);
            throw new Error("D1 indisponible, redirection vers GAS…");
        } finally {
            clearTimeout(timeout);
        }
    })();
    return backendReadyPromise;
}

function redirectToGas(reason) {
    console.warn("D1 indisponible, basculement vers GAS.", reason);
    const target = new URL(window.top.location.href);
    if (String(target.searchParams.get("backend") || "").toLowerCase() === "gas") return;
    target.searchParams.set("backend", "gas");
    window.top.location.replace(target.toString());
}

/** Construit une navigation interne sans perdre le backend de secours ni Admin. */
function buildInternalPageUrl(path, extraParams = {}) {
    const url = new URL(path, window.location.href);
    if (preferredBackend === "gas") url.searchParams.set("backend", "gas");
    else url.searchParams.delete("backend");
    if (sessionStorage.getItem("admin") === "true") url.searchParams.set("admin", "1");
    Object.entries(extraParams).forEach(([key, value]) => url.searchParams.set(key, value));
    return url.pathname.split("/").pop() + url.search;
}

function preserveBackendInLinks() {
    document.querySelectorAll('a[href]').forEach(link => {
        const url = new URL(link.href, window.location.href);
        if (url.origin !== window.location.origin || !url.pathname.endsWith(".html")) return;
        if (preferredBackend === "gas") url.searchParams.set("backend", "gas");
        else url.searchParams.delete("backend");
        if (sessionStorage.getItem("admin") === "true") url.searchParams.set("admin", "1");
        link.href = url.toString();
    });
}

function bytesToBase64Url(bytes) {
    let binary = "";
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", preserveBackendInLinks);
} else {
    preserveBackendInLinks();
}

console.log(isAdmin ? "Mode admin demandé" : "Mode admin désactivé");
console.log("Backend prioritaire :", preferredBackend === "d1" ? "Cloudflare D1" : "Google Sheets / GAS");
