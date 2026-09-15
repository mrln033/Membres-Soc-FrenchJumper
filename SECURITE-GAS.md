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

## Authentification Admin Discord

`?admin=1` reste uniquement un interrupteur d'affichage. Il ne donne aucun droit côté Worker ou GAS.

Le Worker réalise le parcours OAuth2 Discord avec le scope minimal `identify`, émet une session HMAC-SHA256 de
30 minutes, puis relit les rôles Discord du demandeur avant chaque action sensible. GAS vérifie la même signature et
relit également les rôles avant ses écritures de secours.

Propriétés Apps Script à ajouter avant l'activation :

```text
ADMIN_AUTH_MODE = legacy
ADMIN_SESSION_SECRET = valeur identique au secret Cloudflare
ADMIN_DISCORD_ROLE_IDS = id_role_chef,id_role_conseiller
```

`BOT_TOKEN` et `GUILD_ID` sont utilisés côté GAS pour interroger le membre Discord. Aucun de ces secrets ne doit être
transmis dans l'URL ou ajouté au dépôt.

Actions protégées dans `doPost` :

- `syncDiscordFromWeb` ;
- `applyMembreAction` ;
- `createOrOpenMembre` ;
- `updateMembreInfos`.

Les actions `replicateFromD1` et `getGasSyncSnapshot` conservent leur authentification séparée par
`SYNC_SHARED_SECRET`. Les interactions Discord existantes restent traitées avant le routage Web.

Le mode `legacy` est volontairement le défaut tant que le nouveau frontend n'est pas publié. Après validation du
parcours complet, passer `ADMIN_AUTH_MODE=discord` dans GAS. Le guide détaillé et le retour arrière figurent dans
`DEPLOIEMENT-OAUTH-DISCORD.md`.

## Synchronisation bidirectionnelle GAS / D1

La synchronisation est volontairement sans effet tant que la propriete `SYNC_ENABLED` ne vaut pas `true`.
Une panne de synchronisation ne doit jamais annuler une ecriture GAS deja reussie : la mutation est placee dans
la feuille masquee `SYNC_OUTBOX` et sera reessayee par le trigger `flushSyncOutbox`.

Fichiers a publier dans le meme projet Apps Script :

- `gas/Code.gs` ;
- `gas/Sync.gs` dans un second fichier de script `Sync`.

Proprietes Apps Script necessaires :

```text
D1_SYNC_URL = https://frj-membres-soc-api.merlin-merzhin-lesage.workers.dev
SYNC_SHARED_SECRET = valeur identique au secret Cloudflare
SYNC_ENABLED = false
```

Ordre d'activation :

1. Ajouter les deux fichiers et les proprietes ci-dessus avec `SYNC_ENABLED=false`.
2. Deployer une nouvelle version de l'application Web en conservant l'URL `/exec` actuelle.
3. Executer manuellement `setupBidirectionalSync` une fois depuis l'editeur Apps Script et accepter les autorisations.
4. Vérifier le tableau `sync.html?admin=1` (D1 est désormais le backend par défaut).
5. Passer `SYNC_ENABLED=true`, puis activer `SYNC_MODE=active` dans le Worker seulement apres un test controle.

Les mutations recues de D1 mettent a jour les feuilles sans appeler Discord et sans creer une mutation inverse.
Le trigger installable `syncMemberManualEdit` capture uniquement les modifications manuelles de `MEMBRES_SOC`.
