# FRJ Membres Soc — API Cloudflare D1

Ce Worker est volontairement séparé de `../../worker/worker.js`, qui reste le proxy Discord partagé actuellement en production.

## État actuel

- Base D1 distante : `frj-membres-soc` (`09b3c024-99f9-4add-a12c-ed214a462df5`), région WEUR.
- Worker déployé : <https://frj-membres-soc-api.merlin-merzhin-lesage.workers.dev>.
- Le site publié reste sur GAS par défaut.
- Tant que `ADMIN_TOKEN` et les secrets Discord ne sont pas configurés, les écritures D1 restent volontairement indisponibles.
- Lors d'une sortie, d'une désertion ou d'un bannissement, D1 retire aussi le rôle « Règlement Soc OK » (`1189173135380058133`).

## Sécurité de la migration

- Le site publié continue d'appeler GAS par défaut.
- Le Worker D1 possède son propre nom, sa propre configuration et sa propre base.
- Les exports XLSX et les snapshots SQL/JSON sont ignorés par Git.
- Les lectures sont publiques pour conserver le contrat actuel.
- Toutes les écritures exigent `Authorization: Bearer <ADMIN_TOKEN>`.
- Une écriture ne doit jamais basculer automatiquement vers un autre backend.
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
`http://127.0.0.1:8787/?backend=d1`. Le serveur écoute uniquement sur la machine locale.

Avant d'activer les écritures distantes, configurer ces secrets avec `wrangler secret put` :

- `ADMIN_TOKEN` : jeton réservé à l'interface d'administration D1 ;
- `DISCORD_PROXY_SECRET` : secret déjà attendu par `discord-proxy` ;
- `DISCORD_BOT_TOKEN` : token du bot déjà utilisé par GAS ;
- `DISCORD_GUILD_ID` : identifiant du serveur Discord.
- `SYNC_SHARED_SECRET` : secret commun au Worker et aux propriétés Apps Script.

Le token du bot et les autres secrets ne doivent jamais être ajoutés à `wrangler.jsonc` ni à Git.

Le binding local utilise `preview_database_id: "local"`; le binding distant pointe vers la base dédiée ci-dessus.
