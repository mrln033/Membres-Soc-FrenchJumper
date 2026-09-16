# FRJ Membres Soc — API Cloudflare D1

Ce Worker est volontairement séparé de `../../worker/worker.js`, qui reste le proxy Discord partagé actuellement en production.

## État actuel

- Base D1 distante : `frj-membres-soc` (`09b3c024-99f9-4add-a12c-ed214a462df5`), région WEUR.
- Worker déployé : <https://frj-membres-soc-api.merlin-merzhin-lesage.workers.dev>.
- La version préparée du site utilise D1 par défaut et redirige vers GAS si la sonde `/health` échoue.
- `ADMIN_AUTH_MODE=discord` active OAuth Discord et `ALLOW_LEGACY_ADMIN_TOKEN=true` conserve encore temporairement
  l'ancien jeton pendant la fenêtre de migration.
- Les écritures exigent une session OAuth valide et l'un des rôles Discord autorisés, sauf usage explicite du repli
  legacy tant qu'il n'est pas fermé.
- Lors d'une sortie, d'une désertion ou d'un bannissement, D1 retire aussi le rôle « Règlement Soc OK » (`1189173135380058133`).
- D-003 prévoit de remplacer `?admin=1` par une connexion explicite dans le menu. Cette évolution est analysée dans
  `../../ANALYSE-D003-CONNEXION-DISCORD.md`, mais elle n'est pas encore implémentée : le comportement courant reste inchangé.

## Sécurité de la migration

- L'absence de paramètre `backend` sélectionne D1 ; seul `backend=gas` force le secours GAS.
- Le Worker D1 possède son propre nom, sa propre configuration et sa propre base.
- Les exports XLSX et les snapshots SQL/JSON sont ignorés par Git.
- Les lectures sont publiques pour conserver le contrat actuel.
- Toutes les écritures D1 exigent `Authorization: Bearer <session>`.
- En mode Discord, le Worker relit les rôles du membre avant chaque écriture ; un retrait de rôle est donc immédiat.
- `ALLOW_LEGACY_ADMIN_TOKEN=true` est exclusivement une garde de migration et doit être remis à `false` après publication.
- Une écriture n'est jamais rejouée automatiquement vers l'autre backend : un délai réseau ne permet pas de savoir
  si la première écriture a déjà été appliquée.
- La synchronisation standard passe par un Service Binding vers le Worker existant `discord-proxy` ; son code et son déploiement ne sont pas modifiés.
- Le retrait du rôle « Règlement Soc OK » est exécuté directement par ce nouveau Worker, uniquement après une synchronisation standard réussie et uniquement pour un mouvement de sortie.

## Synchronisation bidirectionnelle

- `SYNC_MODE=observe` journalise sans expédier vers GAS ; `active` active la file ; `off` la coupe.
- `frj-membres-sync` assure les reprises vers GAS et `frj-membres-sync-dlq` conserve les échecs définitifs.
- Chaque mutation possède un UUID utilisé comme clé d'idempotence.
- Les mouvements sont append-only et dédupliqués par `MouvementID`.
- Les réplications ne rappellent jamais Discord et ne réémettent jamais une mutation inverse.
- Un cron toutes les dix minutes relance les mutations en attente et contrôle les compteurs GAS/D1.
- Le tableau administrateur est disponible via `sync.html?backend=d1&admin=1`.

## Contrat HTTP compatible

- `GET /?action=getMembres`
- `GET /?action=getMouvements`
- `GET /?action=getMouvementsMensuels`
- `GET /?action=getFiche&id=<uuid>`
- `POST /` avec une action `createOrOpenMembre`, `applyMembreAction`, `updateMembreInfos` ou `syncDiscordFromWeb`

## Travail local

1. `npm install`
2. `npm run build:seed`
3. `npm run db:migrate:local`
4. `npm run db:seed:local`
5. `npm test`
6. `npm run dev`

Pour tester le site local avec D1 sans publier GitHub Pages, lancer `npm run dev:site`, puis ouvrir
`http://127.0.0.1:8787/`. Le serveur écoute uniquement sur la machine locale.

Secrets historiques nécessaires :

- `ADMIN_TOKEN` : jeton réservé à l'interface d'administration D1 ;
- `DISCORD_PROXY_SECRET` : secret déjà attendu par `discord-proxy` ;
- `DISCORD_BOT_TOKEN` : token du bot déjà utilisé par GAS ;
- `DISCORD_GUILD_ID` : identifiant du serveur Discord.
- `SYNC_SHARED_SECRET` : secret commun au Worker et aux propriétés Apps Script.

Configuration nécessaire à OAuth Discord :

- `DISCORD_OAUTH_CLIENT_ID` : identifiant public de l'application, conservé dans `wrangler.jsonc` ;
- `DISCORD_OAUTH_CLIENT_SECRET` : secret OAuth de l'application ;
- `ADMIN_SESSION_SECRET` : secret aléatoire de signature, identique dans les propriétés Apps Script ;
- `ADMIN_DISCORD_ROLE_IDS` : IDs des rôles autorisés, séparés par des virgules.

Variables non secrètes de migration dans `wrangler.jsonc` :

- `DISCORD_OAUTH_CLIENT_ID` : `1479825051522957462` ;
- `DISCORD_OAUTH_REDIRECT_URI` : callback déclaré à l'identique dans le portail Discord ;
- `ADMIN_AUTH_MODE` : `legacy` pendant l'installation, puis `discord` ;
- `ALLOW_LEGACY_ADMIN_TOKEN` : `true` pendant le chevauchement des frontends, puis impérativement `false`.

Le token du bot et les autres secrets ne doivent jamais être ajoutés à `wrangler.jsonc` ni à Git.

Le binding local utilise `preview_database_id: "local"`; le binding distant pointe vers la base dédiée ci-dessus.

Le déroulé complet, les contrôles et le retour arrière sont décrits dans
[`../../DEPLOIEMENT-OAUTH-DISCORD.md`](../../DEPLOIEMENT-OAUTH-DISCORD.md).
