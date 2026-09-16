(function () {
    "use strict";
    const status = document.getElementById("oauthStatus");
    if (!window.opener || window.opener.closed) {
        status.textContent = "Cette fenêtre de connexion a expiré. Vous pouvez la fermer et continuer en consultation publique.";
        return;
    }
    window.opener.postMessage({ type: "frj-discord-auth", fragment: window.location.hash }, window.location.origin);
    status.textContent = "Connexion traitée. Cette fenêtre va se fermer.";
    window.close();
}());
