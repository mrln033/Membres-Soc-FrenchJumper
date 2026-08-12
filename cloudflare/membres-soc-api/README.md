# FRJ Membres Soc — API Cloudflare D1

Ce Worker est volontairement séparé de `../../worker/worker.js`, qui reste le proxy Discord partagé actuellement en production.

## État actuel

- Base D1 distante : `frj-membres-soc` (`09b3c024-99f9-4add-a12c-ed214a462df5`), région WEUR.
- Worker déployé : <https://frj-membres-soc-api.merlin-merzhin-lesage.workers.dev>.
- Le site publié reste sur GAS par défaut.
- Tant que `ADMIN_TOKEN` et les secrets Discord ne sont pas configurés, les écritures D1 restent volontairement indisponibles.
- La suppression du rôle Discord secondaire historique lors d'une sortie reste à valider avant d'activer ces écritures.

## Sécurité de la migration

- Le site publié continue d'appeler GAS par défaut.
- Le Worker D1 possède son propre nom, sa propre configuration et sa propre base.
- Les exports XLSX et les snapshots SQL/JSON sont ignorés par Git.
- Les lectures sont publiques pour conserver le contrat actuel.
- Toutes les écritures exigent `Authorization: Bearer <ADMIN_TOKEN>`.
- Une écriture ne doit jamais basculer automatiquement vers un autre backend.
- La synchronisation Discord passe par un Service Binding vers le Worker existant `discord-proxy` ; son code et son déploiement ne sont pas modifiés.

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

Avant d'activer les écritures distantes, configurer `ADMIN_TOKEN` et `DISCORD_PROXY_SECRET` avec
`wrangler secret put`. Le second doit correspondre au secret déjà attendu par `discord-proxy`.

Le binding local utilise `preview_database_id: "local"`; le binding distant pointe vers la base dédiée ci-dessus.
