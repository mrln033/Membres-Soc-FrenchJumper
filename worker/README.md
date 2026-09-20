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

La configuration versionnée est `worker/wrangler.jsonc`. Les variables ont historiquement été créées dans le tableau
de bord Cloudflare ; tout déploiement doit donc conserver `keep_vars=true`. Les valeurs de `BOT_TOKEN` et `SECRET`
sont sensibles : elles ne doivent jamais être écrites dans Git, un journal ou une documentation.

Commande depuis la racine du dépôt :

```powershell
cloudflare\membres-soc-api\node_modules\.bin\wrangler.CMD versions upload --config worker\wrangler.jsonc --keep-vars
```

La version D-009 active est `0f99dd88-a6a9-4ad0-b944-5d0c0250f933`. Le retour arrière immédiat est
`35944e35-d9d4-4c3e-aa59-46348f9701a1`.

