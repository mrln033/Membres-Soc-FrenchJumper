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

`?admin=1` est obsolète dans l'implémentation publiée : le frontend le retire de l'URL et ne lui accorde
aucun droit. L'état d'affichage RH provient désormais de `/auth/session`.

Le Worker réalise le parcours OAuth2 Discord avec le scope minimal `identify`, émet une session HMAC-SHA256 de
30 minutes, puis relit les rôles Discord du demandeur avant chaque action sensible. GAS vérifie la même signature et
relit également les rôles avant ses écritures de secours.

Pour D-004, le frontend conserve temporairement dans `sessionStorage` uniquement l'URL interne de la page affichée
avant l'ouverture de Discord. Cette valeur est supprimée à la première connexion réussie, puis acceptée seulement si
elle appartient à l'origine et à la racine GitHub Pages courantes. Elle ne contient ni jeton ni secret.
L'avis de déconnexion est retiré du stockage dès son affichage et masqué automatiquement après 15 secondes ; son délai
est annulé si une reconnexion réussie efface l'avis plus tôt.

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
- `getDiscordRolesForMember` ;
- `refreshDiscordRoles` ;
- `applyMembreAction` ;
- `createOrOpenMembre` ;
- `updateMembreInfos`.

Les actions `replicateFromD1`, `replicateDiscordRolesFromD1` et `getGasSyncSnapshot` conservent leur authentification séparée par
`SYNC_SHARED_SECRET`. Les interactions Discord existantes restent traitées avant le routage Web.

Pour D-002, `replicateDiscordRolesFromD1` accepte uniquement le secret partagé et crée au besoin les colonnes de
cache dans `MEMBRES_SOC`. La lecture publique ne retourne jamais `ResponsabilitesDiscord`; cette colonne n'est lue
que par `getDiscordRolesForMember` après validation de la session RH. `refreshDiscordRoles` transmet la session au
Worker D1, qui relit Discord et réplique le résultat : GAS ne devient donc jamais une seconde source de vérité.

Le mode `legacy` reste volontairement actif pendant la recette du nouveau frontend publié. Après validation du
parcours complet, passer `ADMIN_AUTH_MODE=discord` dans GAS. Le guide détaillé et le retour arrière figurent dans
`DEPLOIEMENT-OAUTH-DISCORD.md`.

### Évolution D-003 en déploiement progressif

D-003 supprime l'usage de `?admin=1` et ajoute un bouton Connexion/Déconnexion Discord dans le menu. Le code backend
compatible est publié dans GAS v142 et dans le Worker `c475badb-3424-4b95-84d8-edafb36e6f2b` ; le frontend est publié
sur GitHub Pages depuis le commit `fcb60d9`. L'évolution sépare explicitement :

- la session Discord, accessible à tout membre du serveur FRJ correctement authentifié, même sans rôle RH ;
- l'autorisation RH, réservée aux rôles `Chef d'Expédition` et `Conseiller d'Expédition` et relue avant chaque écriture.

GAS continue à vérifier lui-même la signature, l'expiration et les rôles courants. Un utilisateur connecté sans
rôle RH restera connecté mais ses écritures seront refusées. Le plan complet, les tests, l'iframe et le déploiement
progressif sont décrits dans `ANALYSE-D003-CONNEXION-DISCORD.md`.

Un compte absent du serveur Discord ne reçoit aucune session. Le frontend affiche alors un message explicite puis
revient en consultation publique non authentifiée ; ce refus ne doit jamais bloquer l'application. Une panne Discord
doit être distinguée d'une absence réelle et aboutir elle aussi à un retour public sûr.

## Synchronisation bidirectionnelle GAS / D1

La synchronisation est volontairement sans effet tant que la propriete `SYNC_ENABLED` ne vaut pas `true`.
Une panne de synchronisation ne doit jamais annuler une ecriture GAS deja reussie : la mutation est placee dans
la feuille masquee `SYNC_OUTBOX` et sera reessayee par le trigger `flushSyncOutbox`.

Fichiers a publier dans le meme projet Apps Script :

- `gas/Code.gs` ;
- `gas/Sync.gs` dans un second fichier de script `Sync` ;
- `gas/appsscript.json`, copie versionnée du manifeste V8 de la Web App.

Le dépôt est associé au projet Apps Script par `.clasp.json` avec `rootDir=gas`. Avant chaque `clasp push`, exécuter
`clasp show-file-status` et vérifier que seuls ces trois fichiers sont concernés : un push clasp remplace l'ensemble
du contenu distant.

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
4. Vérifier le tableau `sync.html?backend=d1` après connexion avec un compte RH (D1 est le backend par défaut).
5. Passer `SYNC_ENABLED=true`, puis activer `SYNC_MODE=active` dans le Worker seulement apres un test controle.

Les mutations recues de D1 mettent a jour les feuilles sans appeler Discord et sans creer une mutation inverse.
Le trigger installable `syncMemberManualEdit` capture uniquement les modifications manuelles de `MEMBRES_SOC`.
