const GAS_API_URL = "https://script.google.com/macros/s/AKfycbzf40jOrUs79_O5PASuc7Y-OOZv_C2RZV1bY7r97WhF8iVVQ6f4nIpBCCRh_0IOIozSew/exec";
const D1_API_URL = "https://frj-membres-soc-api.merlin-merzhin-lesage.workers.dev";
const D1_ADMIN_TOKEN_KEY = "FRJ_MEMBRES_D1_ADMIN_TOKEN";

const requestedBackend = new URLSearchParams(window.location.search).get("backend");
const preferredBackend = requestedBackend === "d1" ? "d1" : "gas";
const API_URL = preferredBackend === "d1" ? D1_API_URL : GAS_API_URL;
const API_BACKENDS = Object.freeze({ gas: GAS_API_URL, d1: D1_API_URL });

function getD1AdminToken() {
    let token = sessionStorage.getItem(D1_ADMIN_TOKEN_KEY) || "";

    if (!token) {
        token = String(window.prompt("Jeton administrateur D1 :") || "").trim();
        if (!token) {
            throw new Error("Action annulée : aucun jeton administrateur D1 fourni.");
        }
        sessionStorage.setItem(D1_ADMIN_TOKEN_KEY, token);
    }

    return token;
}

function clearD1AdminToken() {
    sessionStorage.removeItem(D1_ADMIN_TOKEN_KEY);
}

function preserveBackendInLinks() {
    if (preferredBackend !== "d1") return;

    document.querySelectorAll('a[href]').forEach(link => {
        const url = new URL(link.href, window.location.href);
        if (url.origin !== window.location.origin || !url.pathname.endsWith(".html")) return;
        url.searchParams.set("backend", "d1");
        link.href = url.toString();
    });
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", preserveBackendInLinks);
} else {
    preserveBackendInLinks();
}

const currentParams = new URLSearchParams(window.location.search);

if (currentParams.get("admin") === "1") {
    sessionStorage.setItem("admin", "true");
}

const isAdmin = sessionStorage.getItem("admin") === "true";

if (isAdmin) {
    console.log("Mode admin activé");
} else {
	console.log("Mode admin désactivé");
}

console.log("Backend prioritaire :", preferredBackend === "d1" ? "Cloudflare D1" : "Google Sheets / GAS");
