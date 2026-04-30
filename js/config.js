const API_URL = "https://script.google.com/macros/s/AKfycbx1HSpPHHJIXlCdIyAn-0WNo8S059_0IEYEJXW2AtDt78GFDUW2IOpd5Xh3UUCfq6w9xw/exec";

const WH_NOTIF_RH = "https://discord.com/api/webhooks/1483422952786493514/9sMzKb1YgTVwKM2jTUbaZ5DnlI0iPxUTE7mF_bavHckfoVFYPj4SIj6DCf_uJqPl4ap0"

const isAdmin = sessionStorage.getItem("admin") === "true";

if (isAdmin) {
    console.log("Mode admin activé");
} else {
	console.log("Mode admin désactivé");
}
