# Proxy Discord FrenchJumper

Le Worker `discord-proxy` applique dans Discord le nom d'avatar et les rôles Soc transmis par les backends D1 ou GAS.
Il est distinct du Worker D1 `frj-membres-soc-api`.

## Synchronisation

La route protégée `POST /sync` traite les opérations dans cet ordre :

1. retirer les rôles de grade qui ne correspondent plus à la fiche ;
2. ajouter le rôle FRJ et le rôle du grade courant, ou tous les retirer pour un ancien membre ;
3. tenter de mettre le pseudonyme Discord au nom d'avatar.

Les rôles constituent la phase principale : son échec fait échouer la synchronisation. La mise à jour du pseudonyme
est secondaire. Si Discord la refuse à cause de sa hiérarchie, le proxy renvoie un succès partiel accompagné de
`NICKNAME_PERMISSION_REFUSED`. Le rôle du bot reste volontairement sous Administrateur.

## Déploiement

La configuration versionnée est `worker/wrangler.jsonc`. Toutes les variables non sensibles y sont déclarées et les
deux valeurs sensibles sont des secrets Cloudflare chiffrés obligatoires :

- `DISCORD_BOT_TOKEN` : jeton du bot Discord ;
- `SYNC_SHARED_SECRET` : secret partagé avec les backends D1 et GAS.

Les anciens bindings en clair `BOT_TOKEN`, `SECRET` et `BOT_KEY` ne doivent jamais être recréés. Un déploiement ne
doit pas utiliser `--keep-vars`, afin que la configuration versionnée reste la source de vérité et qu'une ancienne
variable distante ne puisse pas réapparaître silencieusement. La valeur des secrets ne doit jamais être écrite dans
Git, un journal, une commande ou une documentation.

Commande depuis la racine du dépôt :

```powershell
cloudflare\membres-soc-api\node_modules\.bin\wrangler.CMD versions upload --config worker\wrangler.jsonc
```

La version D-010 active est `e77228b5-ec13-4dfe-89fc-3a3293215089`. Le retour arrière technique immédiat est
`c0d20694-b993-4a70-b0c1-95e1fe094070`, mais il contient encore les anciens bindings en clair : il ne doit être
réactivé qu'en ultime recours et pour la durée strictement nécessaire.

La migration vers les secrets chiffrés protège la version active, mais n'efface pas les valeurs des versions
historiques Cloudflare. Après toute découverte d'une valeur sensible précédemment stockée en clair, régénérer le
jeton dans le portail Discord et faire une rotation coordonnée du secret partagé dans le proxy, D1 et GAS.

