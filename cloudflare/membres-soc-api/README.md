# FRJ Membres Soc — API Cloudflare D1

Ce Worker est volontairement séparé de `../../worker/worker.js`, qui reste le proxy Discord partagé actuellement en production.

## État actuel

- Base D1 distante : `frj-membres-soc` (`09b3c024-99f9-4add-a12c-ed214a462df5`), région WEUR.
- Worker déployé : <https://frj-membres-soc-api.merlin-merzhin-lesage.workers.dev>.
- La version préparée du site utilise D1 par défaut et redirige vers GAS si la sonde `/health` échoue.
- OAuth Discord est l'unique authentification des accès RH. L'ancien jeton administrateur et ses variables de
  compatibilité ont été supprimés le 20 septembre 2026.
- Les écritures exigent une session OAuth valide et l'un des rôles Discord autorisés.
- Lors d'une sortie, d'une désertion ou d'un bannissement, D1 retire aussi le rôle « Règlement Soc OK » (`1189173135380058133`).
- Le Worker compatible D-003 est déployé depuis le 16 septembre 2026 sous la version
  `c475badb-3424-4b95-84d8-edafb36e6f2b`. Le frontend remplaçant `?admin=1` est publié depuis le commit `fcb60d9`.
- `AUTH_LOGIN_POLICY=guild_members` permet à tout membre du serveur de conserver une session. Le rôle FRJ
  (`FRJ_MEMBER_ROLE_ID`) accorde le niveau de lecture « Consultation FRJ » ; les rôles RH restent seuls habilités à
  modifier les données.
- Un compte absent du serveur ne reçoit jamais de session et revient, après un message explicite, à la consultation
  publique non bloquante. Une panne Discord est identifiée séparément.
- D-002 est activée avec `DISCORD_ROLE_SYNC_MODE=active` et `DISCORD_ROLE_DISPLAY_ENABLED=true`. Discord reste
  l'unique source et le site ne possède aucune route de modification des fonctions, activités ou responsabilités.
- Le Worker optimisé actif depuis le 20 septembre 2026 est `8fcb2f52-a9a8-4448-9cd3-5dcd2bfb3686`. La version
  D-002 précédente `8968e108-2274-49ac-9b97-50aff3b81c73` reste le repère de retour arrière. Le remplissage initial
  a traité 125 membres en 8 min 13 s (118 `OK`, 7 `ABSENT`, 0 `ERROR`) et n'a laissé aucune réplication GAS en attente.
- D-006 est déployée sous la version `cb729f06-1a5f-49ae-b823-ebd8fee39aa6` avec `guild_members` et
  `FRJ_MEMBER_ROLE_ID=464706220905857026`. La version `8fcb2f52-a9a8-4448-9cd3-5dcd2bfb3686` est son retour arrière
  immédiat. Le frontend correspondant est publié par la PR #13 au commit de fusion `4bc3c447` ; la construction Pages
  et le contrôle direct des ressources servies ont réussi.
- La clôture D-001 est active sous la version `b753d68b-7900-4f41-b09e-b565363c2b0e` : le code OAuth exclusif a été
  déployé dans `f5df761e-ec5e-4b49-9bb9-88b738c87f01`, puis la suppression du secret historique `ADMIN_TOKEN` a créé
  la version de configuration actuellement servie. L'utilisateur a validé le parcours sur PC ; aucune validation
  mobile ou tablette n'est encore revendiquée. Le nettoyage frontend et la documentation sont publiés par la PR #18.
- Le frontend D-002 est publié sur GitHub Pages depuis la PR #7, commit de fusion `e8c8209`.
- La fiche rend d'abord le contrat public, puis enrichit séparément les responsabilités en accès RH ou Consultation FRJ : un échec de cet
  appel protégé conserve la consultation publique. Les fonctions et activités sont affichées dans deux cartes
  responsives distinctes.
- En mode frontend `backend=gas`, la fiche publique et son historique proviennent de GAS, mais la lecture semi-privée des
  responsabilités appelle directement l'action D1 protégée avec la même session OAuth. La déconnexion recharge la page
  interne courante pour éliminer immédiatement toute donnée RH déjà rendue.

## Sécurité de la migration

- L'absence de paramètre `backend` sélectionne D1 ; seul `backend=gas` force le secours GAS.
- Le Worker D1 possède son propre nom, sa propre configuration et sa propre base.
- Les exports XLSX et les snapshots SQL/JSON sont ignorés par Git.
- Les lectures sont publiques pour conserver le contrat actuel.
- Toutes les écritures D1 exigent `Authorization: Bearer <session>`.
- En mode Discord, le Worker relit les rôles du membre avant chaque écriture ; un retrait de rôle est donc immédiat.
- Aucun jeton administrateur historique n'est accepté ; une session OAuth Discord est obligatoire.
- Une écriture n'est jamais rejouée automatiquement vers l'autre backend : un délai réseau ne permet pas de savoir
  si la première écriture a déjà été appliquée.
- La synchronisation standard passe par un Service Binding vers le Worker `discord-proxy`. Depuis D-009, le proxy
  traite séparément les rôles et le pseudonyme : un refus hiérarchique sur le pseudonyme devient un avertissement
  explicite sans masquer la réussite des rôles. Depuis D-010, le proxy lit exclusivement les secrets Cloudflare
  chiffrés `DISCORD_BOT_TOKEN` et `SYNC_SHARED_SECRET` ; les anciennes variables en clair sont absentes de sa version
  active et les déploiements ne doivent pas utiliser `--keep-vars`.
- D-010 est déployée avec le proxy `e77228b5-ec13-4dfe-89fc-3a3293215089` ; son retour arrière technique immédiat
  `c0d20694-b993-4a70-b0c1-95e1fe094070` contient encore les anciens bindings en clair et ne doit servir qu'en ultime
  recours. Le Worker D1 reste `158c60f0-55a9-4508-bf58-c719c989fff6`, avec
  `b753d68b-7900-4f41-b09e-b565363c2b0e` comme retour arrière immédiat.
- Le retrait du rôle « Règlement Soc OK » est exécuté directement par ce nouveau Worker, uniquement après une synchronisation standard réussie et uniquement pour un mouvement de sortie.

## Synchronisation bidirectionnelle

- `SYNC_MODE=observe` journalise sans expédier vers GAS ; `active` active la file ; `off` la coupe.
- `frj-membres-sync` assure les reprises vers GAS et `frj-membres-sync-dlq` conserve les échecs définitifs.
- Chaque mutation possède un UUID utilisé comme clé d'idempotence.
- Les mouvements sont append-only et dédupliqués par `MouvementID`.
- Les réplications ne rappellent jamais Discord et ne réémettent jamais une mutation inverse.
- Un cron quotidien à 03:17 UTC relance les mutations en attente et contrôle les compteurs GAS/D1.
- Le tableau de synchronisation apparaît après connexion d'un compte autorisé et reste accessible avec `backend=d1`.

## Cache des fonctions et activités Discord (D-002)

- La migration additive `0003_discord_role_cache.sql` crée le catalogue, les associations membre/rôle et l'état de
  synchronisation. Tous les rôles du catalogue ont `site_editable=0`.
- `frj-discord-role-sync` est une file distincte, limitée à un lot concurrent ; sa DLQ est
  `frj-discord-role-sync-dlq`. La file métier `frj-membres-sync` reste inchangée.
- Le cron existant programme une lecture des membres une fois par jour lorsque
  `DISCORD_ROLE_SYNC_MODE=active`.
- Le catalogue des rôles suivis est lu une seule fois par lot Queue et une association membre/rôle inchangée n'est
  plus réécrite. La migration `0004_reduce_discord_role_writes.sql` retire l'index redondant déjà couvert par la
  clé primaire composite.
- Une erreur Discord conserve la dernière copie connue. Un membre réellement absent du serveur reçoit une copie vide.
- Les fonctions et activités sont publiques. Les responsabilités Administrateur/Modérateur sont retournées uniquement
  par une action protégée accessible aux sessions RH ou porteuses du rôle FRJ.
- D1 réplique les snapshots vers les colonnes GAS `FonctionsDiscord`, `ActivitesDiscord`,
  `ResponsabilitesDiscord`, `RolesDiscordSyncedAt` et `RolesDiscordStatus`.
- Le consommateur regroupe jusqu'à dix snapshots dans une seule exécution GAS ; GAS verrouille l'écriture du lot afin
  de préserver la cohérence de la feuille.

## Contrat HTTP compatible

- `GET /auth/config` : mode OAuth public et politique de connexion ;
- `GET /auth/session` : `401` si la session est invalide, sinon identité et booléens `authorized` / `frjMember` ;
- `GET /?action=getMembres`
- `GET /?action=getMouvements`
- `GET /?action=getMouvementsMensuels`
- `GET /?action=getFiche&id=<uuid>`
- `POST /` avec une action `createOrOpenMembre`, `applyMembreAction`, `updateMembreInfos`, `syncDiscordFromWeb`,
  `getDiscordRolesForMember` ou `refreshDiscordRoles`

Les routes protégées répondent `401` pour une session absente/invalide, `403` pour un niveau insuffisant et `503`
lorsque Discord ne permet momentanément pas de revalider les rôles. Seule la lecture
`getDiscordRolesForMember` accepte le niveau FRJ ; toutes les écritures exigent toujours l'accès RH.

## Travail local

1. `npm install`
2. `npm run build:seed`
3. `npm run db:migrate:local`
4. `npm run db:seed:local`
5. `npm test`
6. `npm run dev`

Pour tester le site local avec D1 sans publier GitHub Pages, lancer `npm run dev:site`, puis ouvrir
`http://127.0.0.1:8787/`. Le serveur écoute uniquement sur la machine locale.

Secrets nécessaires :

- `DISCORD_PROXY_SECRET` : secret déjà attendu par `discord-proxy` ;
- `DISCORD_BOT_TOKEN` : token du bot déjà utilisé par GAS ;
- `DISCORD_GUILD_ID` : identifiant du serveur Discord.
- `SYNC_SHARED_SECRET` : secret commun au Worker et aux propriétés Apps Script.

Configuration nécessaire à OAuth Discord :

- `DISCORD_OAUTH_CLIENT_ID` : identifiant public de l'application, conservé dans `wrangler.jsonc` ;
- `DISCORD_OAUTH_CLIENT_SECRET` : secret OAuth de l'application ;
- `ADMIN_SESSION_SECRET` : secret aléatoire de signature, identique dans les propriétés Apps Script ;
- `ADMIN_DISCORD_ROLE_IDS` : IDs des rôles autorisés, séparés par des virgules.

Variables non secrètes dans `wrangler.jsonc` :

- `DISCORD_OAUTH_CLIENT_ID` : `1479825051522957462` ;
- `DISCORD_OAUTH_REDIRECT_URI` : callback déclaré à l'identique dans le portail Discord ;
- `AUTH_LOGIN_POLICY` : `guild_members` pour conserver une session à tout membre du serveur ;
- `FRJ_MEMBER_ROLE_ID` : `464706220905857026`, niveau « Consultation FRJ » en lecture seule ;
- `DISCORD_ROLE_SYNC_MODE` : `off` tant que le cache D-002 n'est pas prêt, puis `active` après migration et publication GAS ;
- `DISCORD_ROLE_DISPLAY_ENABLED` : `false` pendant le remplissage initial, puis `true` après comparaison D1/GAS.

Le token du bot et les autres secrets ne doivent jamais être ajoutés à `wrangler.jsonc` ni à Git.

Le binding local utilise `preview_database_id: "local"`; le binding distant pointe vers la base dédiée ci-dessus.

Le déroulé complet, les contrôles et le retour arrière sont décrits dans
[`../../DEPLOIEMENT-OAUTH-DISCORD.md`](../../DEPLOIEMENT-OAUTH-DISCORD.md).
Le déploiement et le retour arrière propres à D-002 sont décrits dans
[`../../DEPLOIEMENT-D002-ROLES-DISCORD.md`](../../DEPLOIEMENT-D002-ROLES-DISCORD.md).
