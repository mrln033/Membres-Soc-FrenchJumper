# Déploiement prudent : D1 par défaut et authentification Discord

Ce guide décrit l'ordre de mise en production. Le respecter évite qu'une version du frontend ne se retrouve
momentanément incompatible avec le Worker ou avec GAS.

## Résultat attendu

- Sans paramètre `backend`, le site utilise D1.
- `backend=gas` ou `backend=GAS` force GAS.
- Une panne détectée de D1 redirige la page courante vers `backend=gas` sans rejouer automatiquement une écriture.
- `admin=1` demande le mode d'affichage Admin, mais les droits proviennent exclusivement de Discord.
- Un utilisateur est autorisé s'il porte au moins un rôle listé dans `ADMIN_DISCORD_ROLE_IDS`.
- Le Worker et GAS relisent les rôles Discord à chaque écriture sensible.

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

Ajouter les nouveaux secrets un par un ; Wrangler demande la valeur sans l'écrire dans le dépôt :

```powershell
npx wrangler secret put DISCORD_OAUTH_CLIENT_ID
npx wrangler secret put DISCORD_OAUTH_CLIENT_SECRET
npx wrangler secret put ADMIN_SESSION_SECRET
npx wrangler secret put ADMIN_DISCORD_ROLE_IDS
```

## 5. Préparer GAS sans activer la protection

1. Copier la nouvelle version de `gas/Code.gs` dans le projet Apps Script.
2. Dans **Paramètres du projet > Propriétés du script**, ajouter :

```text
ADMIN_AUTH_MODE = legacy
ADMIN_SESSION_SECRET = même valeur que Cloudflare
ADMIN_DISCORD_ROLE_IDS = id_role_chef,id_role_conseiller
```

3. Vérifier que `BOT_TOKEN` et `GUILD_ID` existent déjà.
4. Créer une nouvelle version du déploiement Web en conservant l'URL `/exec` actuelle.
5. Tester une lecture et une écriture avec le site actuel. Le mode `legacy` conserve ici le comportement antérieur.

## 6. Déployer le Worker en mode compatible

Dans `wrangler.jsonc`, conserver à ce stade :

```jsonc
"ADMIN_AUTH_MODE": "legacy",
"ALLOW_LEGACY_ADMIN_TOKEN": "true"
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

Puis ouvrir `http://127.0.0.1:8787/?admin=1`. Vérifier successivement :

- connexion d'un compte portant un rôle autorisé ;
- refus d'un compte sans rôle autorisé ;
- ajout d'un membre de test raisonnablement identifiable ;
- modification puis consultation de sa fiche ;
- conservation de `backend=gas` dans les liens après un basculement manuel.

## 8. Publier le frontend puis fermer l'ancien accès

1. Publier les fichiers HTML/JS sur GitHub Pages.
2. Vérifier sans paramètre que D1 est utilisé.
3. Vérifier `?admin=1` et une action Admin via Discord.
4. Vérifier explicitement `?backend=gas&admin=1`.
5. Dans GAS, passer `ADMIN_AUTH_MODE` de `legacy` à `discord`.
6. Dans `wrangler.jsonc`, passer `ALLOW_LEGACY_ADMIN_TOKEN` à `false`, puis redéployer le Worker.
7. Après vérification, l'ancien secret `ADMIN_TOKEN` peut être supprimé avec `wrangler secret delete ADMIN_TOKEN`.

## Retour arrière

Le point Git antérieur à cette évolution est `da1060c`. La branche de travail est
`codex/d1-default-discord-role-auth`.

En cas d'incident :

1. Remettre `ADMIN_AUTH_MODE=legacy` dans les propriétés GAS.
2. Revenir au déploiement Apps Script précédent via **Gérer les déploiements**.
3. Dans `cloudflare/membres-soc-api`, exécuter `npx wrangler versions list`, puis
   `npx wrangler rollback <VERSION_ID>` vers la version connue comme stable.
4. Rétablir le frontend avec un `git revert` du commit de migration, puis republier GitHub Pages.
5. Utiliser temporairement `?backend=gas` si D1 est la seule partie indisponible.

Ne jamais utiliser `git reset --hard` pour ce retour arrière : un revert conserve un historique explicite et
réversible.
