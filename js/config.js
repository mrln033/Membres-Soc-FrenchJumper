const API_URL = "https://script.google.com/macros/s/AKfycbzf40jOrUs79_O5PASuc7Y-OOZv_C2RZV1bY7r97WhF8iVVQ6f4nIpBCCRh_0IOIozSew/exec";

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
