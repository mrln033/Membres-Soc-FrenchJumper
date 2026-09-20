# Déploiement prudent : D1 par défaut et authentification Discord

Ce guide décrit l'ordre de mise en production. Le respecter évite qu'une version du frontend ne se retrouve
momentanément incompatible avec le Worker ou avec GAS.

## Résultat attendu

- Sans paramètre `backend`, le site utilise D1.
- `backend=gas` ou `backend=GAS` force GAS.
- Une panne détectée de D1 redirige la page courante vers `backend=gas` sans rejouer automatiquement une écriture.
- `admin=1` est ignoré puis retiré de l'URL ; l'affichage RH provient exclusivement de la session Discord vérifiée.
- Un utilisateur est autorisé s'il porte au moins un rôle listé dans `ADMIN_DISCORD_ROLE_IDS`.
- `AUTH_LOGIN_POLICY=guild_members` permet à tout membre du serveur de se connecter sans obtenir automatiquement de
  droit RH.
- Le rôle déclaré dans `FRJ_MEMBER_ROLE_ID` donne le niveau « Consultation FRJ » : lecture des responsabilités Discord,
  sans menu, bouton ni écriture RH.
- Le Worker et GAS relisent les rôles Discord à chaque écriture sensible.

## Évolution D-003 : état de l'implémentation

Le bouton Connexion/Déconnexion, le retour OAuth compatible iframe, l'état asynchrone et le contrat serveur sont
implémentés. Le Worker compatible, GAS v142 et le frontend sont déployés. La recette RH historique a d'abord été menée
avec `AUTH_LOGIN_POLICY=admin_only`. D-006 active ensuite `guild_members` et ajoute le niveau Consultation FRJ sans
élargir les droits d'écriture.

État validé le 16 septembre 2026 à 14:34 Europe/Paris :

- Worker : version `c475badb-3424-4b95-84d8-edafb36e6f2b`, `ADMIN_AUTH_MODE=discord`,
  `AUTH_LOGIN_POLICY=admin_only`, `ALLOW_LEGACY_ADMIN_TOKEN=true` ;
- GAS : déploiement existant `AKfycbzf40jOrUs79_O5PASuc7Y-OOZv_C2RZV1bY7r97WhF8iVVQ6f4nIpBCCRh_0IOIozSew`,
  version 142 ; retour arrière possible vers la version 141 ;
- recette publique : 1 324 membres lus sur GAS et D1, `/health` valide et `/auth/session` sans jeton refusé en 401 ;
- frontend GitHub Pages : PR #2 fusionnée et publiée le 16 septembre 2026 à 21:06 Europe/Paris, commit `fcb60d9` ;
  contrôle public du bouton, du callback et de l'absence de `admin=1` réussi ;
- recette Discord RH : le compte « Merlin » est connecté et affiché avec « accès RH » sur D1 le 16 septembre 2026 à
  21:15 Europe/Paris ; la page protégée « Synchronisation GAS / D1 » est également chargée correctement ;
- anomalie d'affichage relevée pendant la recette : l'ancien avis de déconnexion persistait après reconnexion. La
  correction et son test de non-régression sont poussés sur la branche de travail ; leur publication reste à effectuer
  avant la recette GAS ;
- D-004 mémorise la page interne affichée avant la connexion et la recharge une seule fois après succès. Les paramètres
  de fiche et de backend sont conservés, y compris lorsque la popup est remplacée par le repli OAuth pleine page. Une
  cible extérieure à la racine du site est refusée. Cette évolution est publiée par la PR #3 au commit de fusion
  `3bdd53e` ; la construction Pages et les contrôles publics automatisés ont réussi le 19 septembre 2026 à 12:26
  Europe/Paris. La recette visuelle a révélé que l'attribut `src` conservait la liste initiale malgré la navigation
  interne vers une fiche. La correction préparée lit l'URL active de `contentWindow`, avec le même contrôle d'origine ;
  elle ajoute aussi l'effacement automatique de l'avis de déconnexion. La correction est publiée par la PR #4 au
  commit `ed91e2e` ; la construction Pages, les contrôles publics et la seconde recette utilisateur sont réussis.
  L'ajustement final demandé réduit la temporisation de 30 à 15 secondes. Il est publié par la PR #5 au commit
  `a264239` et la valeur `15000` a été vérifiée dans le fichier servi par GitHub Pages.

Un compte absent du serveur ne reçoit aucune session : le frontend affiche un message explicite puis reste en
consultation publique. Les erreurs Discord 401, 403, 429 et 5xx sont traitées comme une indisponibilité temporaire,
jamais comme une fausse absence du serveur.

## Évolution D-006 : trois niveaux d'accès

- Accès RH : session Discord portant Chef d'Expédition ou Conseiller d'Expédition ; responsabilités, fonctions et
  activités visibles, commandes et modifications RH autorisées.
- Consultation FRJ : session portant le rôle FRJ `464706220905857026` sans rôle RH ; responsabilités, fonctions et
  activités visibles, aucune modification autorisée.
- Consultation publique : session sans rôle FRJ ou visite anonyme ; fonctions et activités visibles, responsabilités
  masquées, aucune modification autorisée.

Le Worker revalide les rôles à chaque appel protégé. L'action de lecture `getDiscordRolesForMember` accepte RH ou FRJ ;
toutes les autres actions protégées continuent d'exiger RH. En mode GAS, l'enrichissement semi-privé passe également
par le Worker D1, sans exposer la session dans l'URL.

Mise en production du 20 septembre 2026 : Worker `cb729f06-1a5f-49ae-b823-ebd8fee39aa6`, frontend PR #13 au commit
de fusion `4bc3c447`, construction Pages réussie, 45 tests automatisés réussis. Le contrôle HTTP confirme 1 324 membres, 3 218 mouvements, la politique
`guild_members` et le refus `401` de l'action protégée sans session. Retour arrière Worker immédiat :
`8fcb2f52-a9a8-4448-9cd3-5dcd2bfb3686`.

## 1. Relever les deux IDs de rôles Discord

1. Dans Discord, ouvrir **Paramètres utilisateur > Avancés**.
2. Activer **Mode développeur**.
3. Dans **Paramètres du serveur > Rôles**, faire un clic droit sur `Chef d'Expédition`.
4. Choisir **Copier l'identifiant du rôle**.
5. Refaire l'opération pour `Conseiller d'Expédition`.

Préparer la valeur sur une seule ligne, séparée par une virgule :

```text
123456789012345678,987654321098765432
```

Les noms peuvent ensuite changer sans conséquence. Si un rôle est supprimé puis recréé, son nouvel ID devra être
reporté dans Cloudflare et dans les propriétés Apps Script.

## 2. Préparer OAuth dans le portail Discord

Utiliser l'application Discord à laquelle appartient le bot déjà configuré avec `DISCORD_BOT_TOKEN` / `BOT_TOKEN`.

1. Ouvrir <https://discord.com/developers/applications>.
2. Sélectionner l'application du bot.
3. Noter l'**Application ID / Client ID**.
4. Ouvrir **OAuth2** et ajouter exactement cette redirection :

```text
https://frj-membres-soc-api.merlin-merzhin-lesage.workers.dev/auth/discord/callback
```

5. Générer ou relever le **Client Secret**. Ne jamais le placer dans Git, dans un fichier HTML ou dans
   `wrangler.jsonc`.

Le parcours demande uniquement le scope OAuth `identify`. Le Worker utilise ensuite le bot côté serveur pour relire
les rôles du membre dans le serveur FRJ.

## 3. Préparer le secret de session

Depuis un terminal local disposant de Node.js :

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Copier la valeur dans un gestionnaire de mots de passe. La même valeur devra être installée dans Cloudflare et GAS.

## 4. Vérifier les secrets Cloudflare existants

Depuis `cloudflare/membres-soc-api` :

```powershell
npx wrangler secret list
```

La liste doit déjà contenir au minimum `ADMIN_TOKEN`, `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`,
`DISCORD_PROXY_SECRET` et `SYNC_SHARED_SECRET`. La commande ne révèle pas leurs valeurs.

Le Client ID public est déjà versionné dans `wrangler.jsonc`. Ajouter uniquement les secrets ; Wrangler demande
leur valeur sans l'écrire dans le dépôt :

```powershell
npx wrangler secret put DISCORD_OAUTH_CLIENT_SECRET
npx wrangler secret put ADMIN_SESSION_SECRET
npx wrangler secret put ADMIN_DISCORD_ROLE_IDS
```

## 5. Préparer GAS sans activer la protection

1. Vérifier `clasp show-authorized-user`, puis `clasp show-file-status`. Le projet est associé par `.clasp.json` au
   Script ID Membres Soc et `rootDir=gas` limite le push à `Code.gs`, `Sync.gs` et `appsscript.json`.
2. Exécuter `clasp push` seulement après avoir comparé le projet distant ; cette commande remplace tout le contenu du
   projet Apps Script et ne doit donc jamais être lancée depuis un dossier incomplet.
3. Dans **Paramètres du projet > Propriétés du script**, ajouter :

```text
ADMIN_AUTH_MODE = legacy
ADMIN_SESSION_SECRET = même valeur que Cloudflare
ADMIN_DISCORD_ROLE_IDS = id_role_chef,id_role_conseiller
```

4. Vérifier que `BOT_TOKEN` et `GUILD_ID` existent déjà.
5. Lister les déploiements avec `clasp list-deployments`, puis mettre à jour le déploiement Web existant afin de
   conserver l'URL `/exec` actuelle ; ne pas créer une seconde Web App par défaut.
6. Tester une lecture et une écriture avec le site actuel. Le mode `legacy` conserve ici le comportement antérieur.

## 6. Déployer le Worker en mode compatible

Dans `wrangler.jsonc`, conserver à ce stade :

```jsonc
"ADMIN_AUTH_MODE": "discord",
"AUTH_LOGIN_POLICY": "admin_only",
"ALLOW_LEGACY_ADMIN_TOKEN": "true"
```

Cette valeur correspond à la phase historique de migration. Après publication du frontend D-006, la configuration
active devient :

```jsonc
"AUTH_LOGIN_POLICY": "guild_members",
"FRJ_MEMBER_ROLE_ID": "464706220905857026"
```

Puis :

```powershell
npm test
npm run check
npm run deploy -- --dry-run
npm run deploy
```

Vérifier ensuite `/health`, les lectures publiques et une écriture avec l'ancien frontend.

## 7. Ouvrir la fenêtre de migration OAuth

1. Passer `ADMIN_AUTH_MODE` à `discord` dans `wrangler.jsonc`.
2. Laisser temporairement `ALLOW_LEGACY_ADMIN_TOKEN` à `true`.
3. Faire un dry-run puis déployer le Worker.

L'ancien frontend continue ainsi d'accepter son token pendant que le nouveau parcours OAuth peut être testé.

Tester le nouveau frontend localement :

```powershell
npm run dev:site
```

Puis ouvrir `http://127.0.0.1:8787/`. Vérifier successivement :

- connexion d'un compte portant un rôle autorisé ;
- connexion sans droit RH d'un membre du serveur ne portant aucun rôle autorisé ;
- refus non bloquant d'un compte absent du serveur, avec message puis consultation publique ;
- erreur temporaire distincte lorsque Discord renvoie 401, 403, 429 ou 5xx ;
- fonctionnement du bouton depuis `index.html` intégré dans une iframe d'une autre origine ;
- ajout d'un membre de test raisonnablement identifiable ;
- modification puis consultation de sa fiche ;
- conservation de `backend=gas` dans les liens après un basculement manuel.

## 8. Publier le frontend puis fermer l'ancien accès

1. Publier la nouvelle version de `gas/Code.gs` en conservant `ADMIN_AUTH_MODE=legacy` et la même URL `/exec`.
2. Déployer le Worker avec `AUTH_LOGIN_POLICY=admin_only` et `ALLOW_LEGACY_ADMIN_TOKEN=true`.
3. Publier les fichiers HTML/JS sur GitHub Pages.
4. Vérifier sans paramètre que D1 est utilisé, qu'un ancien favori `?admin=1` est nettoyé et qu'il n'accorde aucun droit.
5. Vérifier une connexion et une action RH sur D1, puis explicitement avec `?backend=gas`.
6. Passer `AUTH_LOGIN_POLICY` à `guild_members`, renseigner `FRJ_MEMBER_ROLE_ID`, redéployer le Worker et tester les
   quatre profils : RH, membre FRJ, membre sans rôle FRJ, compte absent du serveur.
7. Dans GAS, passer `ADMIN_AUTH_MODE` de `legacy` à `discord`, republier puis refaire une écriture de recette.
8. Passer `ALLOW_LEGACY_ADMIN_TOKEN` à `false`, redéployer le Worker et contrôler qu'un ancien token est refusé.
9. Après vérification, supprimer l'ancien secret avec `wrangler secret delete ADMIN_TOKEN`.

## Retour arrière

Le point Git antérieur à la première migration OAuth est `da1060c`. L'implémentation D-003 est préparée sur la branche
`codex/cahier-des-charges-roles-discord` ; relever son commit exact avant la mise en production.

En cas d'incident :

1. Remettre `ADMIN_AUTH_MODE=legacy` dans les propriétés GAS.
2. Remettre `AUTH_LOGIN_POLICY=admin_only` et conserver temporairement `ALLOW_LEGACY_ADMIN_TOKEN=true`.
3. Revenir au déploiement Apps Script précédent via **Gérer les déploiements**.
4. Dans `cloudflare/membres-soc-api`, exécuter `npx wrangler versions list`, puis
   `npx wrangler rollback <VERSION_ID>` vers la version connue comme stable.
5. Rétablir le frontend avec un `git revert` du commit de migration, puis republier GitHub Pages.
6. Utiliser temporairement `?backend=gas` si D1 est la seule partie indisponible.

Ne jamais utiliser `git reset --hard` pour ce retour arrière : un revert conserve un historique explicite et
réversible.
