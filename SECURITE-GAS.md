# Securisation GAS + GitHub Pages

Ce depot GitHub Pages ne doit contenir aucun secret: pas de webhook Discord, pas de token, pas de cle admin.

## Secrets Discord

Le webhook qui etait dans `js/config.js` doit etre considere comme expose. A faire une seule fois:

1. Regenerer ou supprimer l'ancien webhook dans Discord.
2. Creer un nouveau webhook.
3. Stocker le nouveau webhook et le secret du proxy dans les proprietes du projet Apps Script:

```js
DISCORD_WEBHOOK_RH = https://discord.com/api/webhooks/...
DISCORD_PROXY_SECRET = valeur_du_secret_du_worker
```

`syncDiscordFromWeb` declenche maintenant la notification cote GAS. Le webhook reste cote serveur et le front ne l'appelle jamais. Le front transmet uniquement le `membreId`; le nom, l'identifiant Discord et le grade sont relus dans la feuille cote serveur.

## Implementation GAS

La fonction `notifyDiscordSyncLog_` de `gas/Code.gs` reproduit le rendu historique du webhook et lit `DISCORD_WEBHOOK_RH` dans les proprietes du script. Les appels au Worker lisent `DISCORD_PROXY_SECRET` au meme endroit.

Apres toute modification de `gas/Code.gs`, mettre a jour le deploiement de l'application Web. Une nouvelle URL `/exec` n'est necessaire que si Google en genere une.

## Exemple de routage admin futur

Les actions sensibles devront a terme etre protegees par une authentification serveur:

```js
function doPost(e) {
  const payload = JSON.parse(e.postData.contents || "{}");

  switch (payload.action) {
    case "syncDiscordFromWeb":
      requireAdmin_(payload);
      return json_(syncDiscordFromWeb_(payload));

    default:
      return json_({ error: "Action POST inconnue" });
  }
}

function json_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
```

## Admin a terme

Le parametre `?admin=1` peut rester un interrupteur d'affichage pendant le developpement, mais il ne doit jamais decider des droits.

La cible recommandee:

- Meme fichier HTML pour le public et l'admin.
- Le front affiche les boutons admin seulement si `getSession` ou `getMe` renvoie `isAdmin: true`.
- Chaque action sensible cote GAS appelle `requireAdmin_`.
- Les donnees admin-only ne sont jamais envoyees dans les endpoints publics.

Exemple de garde cote GAS:

```js
function requireAdmin_(payload) {
  const adminKey = PropertiesService
    .getScriptProperties()
    .getProperty("ADMIN_KEY");

  if (!adminKey || payload.adminKey !== adminKey) {
    throw new Error("Acces admin refuse");
  }
}
```

Cette cle simple est suffisante pour remplacer temporairement `?admin=1`, mais l'etape suivante la plus propre sera une authentification Google ou Discord OAuth si l'interface admin devient vraiment sensible.
