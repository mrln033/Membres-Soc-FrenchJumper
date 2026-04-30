# Securisation GAS + GitHub Pages

Ce depot GitHub Pages ne doit contenir aucun secret: pas de webhook Discord, pas de token, pas de cle admin.

## Webhook Discord

Le webhook qui etait dans `js/config.js` doit etre considere comme expose. A faire une seule fois:

1. Regenerer ou supprimer l'ancien webhook dans Discord.
2. Creer un nouveau webhook.
3. Le stocker dans les proprietes du projet Apps Script:

```js
PropertiesService.getScriptProperties().setProperty(
  "DISCORD_WEBHOOK_RH",
  "https://discord.com/api/webhooks/..."
);
```

Ensuite, la notification doit etre declenchee cote GAS, idealement directement dans `syncDiscordFromWeb_`. Le webhook reste cote serveur et le front ne l'appelle jamais.

## Action GAS attendue

Ajouter la notification cote Apps Script, soit dans `syncDiscordFromWeb_`, soit via une action POST admin separee:

```js
function doPost(e) {
  const payload = JSON.parse(e.postData.contents || "{}");

  switch (payload.action) {
    case "syncDiscordFromWeb":
      requireAdmin_(payload);
      return json_(syncDiscordFromWeb_(payload));

    case "notifyDiscordSyncLog":
      requireAdmin_(payload);
      return json_(notifyDiscordSyncLog_(payload));

    default:
      return json_({ error: "Action POST inconnue" });
  }
}

function notifyDiscordSyncLog_(payload) {
  const webhookUrl = PropertiesService
    .getScriptProperties()
    .getProperty("DISCORD_WEBHOOK_RH");

  if (!webhookUrl) {
    throw new Error("Webhook Discord non configure");
  }

  const success = payload.success === true;
  const now = new Date();
  const dateStr = Utilities.formatDate(
    now,
    Session.getScriptTimeZone(),
    "dd/MM/yyyy HH:mm"
  );

  const embed = {
    title: "Synchronisation Discord (pour verification)",
    description: success
      ? "Synchronisation effectuee"
      : "Erreur lors de la synchronisation\n\nRole notifie : <@&464706697408020482>",
    color: success ? 0x2ecc71 : 0xe74c3c,
    fields: [
      { name: "Membre", value: String(payload.nomAvatar || "N/A"), inline: true },
      { name: "Discord", value: payload.discordId ? "<@" + payload.discordId + ">" : "N/A", inline: true },
      { name: "Grade", value: String(payload.grade || "N/A"), inline: true },
      { name: "Date", value: dateStr, inline: true },
      { name: "Role notifie", value: "<@&464706697408020482>", inline: false }
    ],
    footer: {
      text: "Log automatique - Notification R.H."
    },
    timestamp: now.toISOString()
  };

  UrlFetchApp.fetch(webhookUrl, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ embeds: [embed] }),
    muteHttpExceptions: true
  });

  return { ok: true };
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
