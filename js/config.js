const API_URL = "https://script.google.com/macros/s/AKfycbzf40jOrUs79_O5PASuc7Y-OOZv_C2RZV1bY7r97WhF8iVVQ6f4nIpBCCRh_0IOIozSew/exec";

const WH_NOTIF_RH = "https://discord.com/api/webhooks/1483422952786493514/9sMzKb1YgTVwKM2jTUbaZ5DnlI0iPxUTE7mF_bavHckfoVFYPj4SIj6DCf_uJqPl4ap0"

const isAdmin = sessionStorage.getItem("admin") === "true";

if (isAdmin) {
    console.log("Mode admin activé");
} else {
	console.log("Mode admin désactivé");
}
