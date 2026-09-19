# Déploiement prudent D-002 — fonctions et activités Discord

Ce guide couvre le lot 1 en lecture seule. Discord reste l'unique source de vérité. Aucune étape ne doit ajouter ou
retirer un rôle Discord.

## Gardes de production

Les deux variables suivantes restent désactivées tant que GAS, D1 et le Worker ne sont pas prêts ensemble. Elles ont
été activées le 19 septembre 2026 après remplissage et comparaison du cache :

```jsonc
"DISCORD_ROLE_SYNC_MODE": "active",
"DISCORD_ROLE_DISPLAY_ENABLED": "true"
```

La première coupe le cron et le rafraîchissement manuel. La seconde force un contrat vide et masque les blocs de la
fiche. Elles permettent de déployer le code sans modifier le site visible.

## Ordre de publication

1. Exécuter `npm test`, `npm run check` et un `wrangler deploy --dry-run`.
2. Sauvegarder D1 et relever les versions Worker, GAS et GitHub Pages servant de retour arrière.
3. Créer `frj-discord-role-sync` et `frj-discord-role-sync-dlq`, puis vérifier que la file métier
   `frj-membres-sync` n'est pas modifiée.
4. Pousser les fichiers GAS avec clasp après `clasp show-file-status`, créer une nouvelle version du déploiement
   `/exec` existant et conserver son URL.
5. Appliquer la migration D1 `0003_discord_role_cache.sql`. Elle est additive et ne modifie ni membre, ni grade, ni
   mouvement.
6. Déployer le Worker avec les deux gardes encore désactivées. Contrôler `/health`, les lectures publiques, une action
   RH existante et le repli `?backend=gas`.
7. Passer seulement `DISCORD_ROLE_SYNC_MODE` à `active`, redéployer puis surveiller la file, sa DLQ, les erreurs 429 et
   la progression de `member_discord_role_sync`. Les réponses 429 sont rejouées après le délai demandé par Discord.
8. Comparer plusieurs fiches dans Discord, D1 et GAS, dont une sans rôle suivi, une avec plusieurs activités et une
   responsabilité Discord. Une erreur Discord doit laisser la dernière copie consultable.
9. Passer `DISCORD_ROLE_DISPLAY_ENABLED` à `true`, publier ensuite le frontend et tester ordinateur/mobile, public/RH,
   D1/GAS et le bouton `Actualiser les rôles Discord`.

Les changements de configuration Cron peuvent demander jusqu'à quinze minutes pour se propager. Le premier remplissage
du cache peut donc dépasser ponctuellement la cible de dix minutes ; cette cible s'applique au fonctionnement stabilisé.

## Publication du 19 septembre 2026

- Sauvegarde D1 préalable : export SQL local ignoré par Git `seed/d1-pre-d002-20260919.sql`.
- Files créées : `frj-discord-role-sync` et `frj-discord-role-sync-dlq` ; `frj-membres-sync` est restée inchangée.
- GAS publié en version 144 sur l'URL `/exec` existante ; version antérieure à D-002 : 142.
- Migration distante `0003_discord_role_cache.sql` appliquée : 2 responsabilités, 2 fonctions et 7 activités,
  toutes avec `site_editable=0`.
- Remplissage initial : 125/125 membres en 8 min 13 s, 118 `OK`, 7 `ABSENT`, 0 `ERROR`, aucune réplication GAS en attente.
- Worker actif : `8968e108-2274-49ac-9b97-50aff3b81c73`. Retour arrière antérieur à D-002 :
  `c475badb-3424-4b95-84d8-edafb36e6f2b`.
- Contrôles publics D1 réussis : `/health` retourne 1 324 membres et 3 218 mouvements ; une fiche de contrôle retourne
  `Pilote PF13` et quatre activités, tandis qu'une responsabilité suivie reste absente de la réponse publique.
- Le frontend a été publié par la PR #7 au commit `e8c8209adc221ea63a887213358730d9a1877ff9`. La construction GitHub Pages
  a réussi ; `index.html`, `fiche.html`, `js/client.js` et `css/style.css` répondent en HTTP 200, avec le bouton RH,
  le rendu des badges et le masquage public des responsabilités présents dans les ressources servies.
- Après la première recette, le chargement de fiche a été rendu indépendant de l'enrichissement RH : la réponse
  publique est affichée avant la lecture protégée des responsabilités. Une erreur GAS/Discord sur cette seconde lecture
  conserve donc la fiche publique. Les fonctions et activités utilisent deux cartes responsives côte à côte, empilées
  automatiquement lorsque la largeur disponible est insuffisante. Ce correctif est publié par la PR #10 au commit
  `2d6977abdecb9bc942001179ce5cf48452265ce6` ; les fichiers JavaScript/CSS et la fiche GAS servis ont été contrôlés en HTTP 200.

## Contrôles fonctionnels

- Les fonctions et activités apparaissent en consultation publique et les catégories vides restent masquées.
- Les responsabilités Administrateur/Modérateur n'apparaissent qu'en accès RH.
- Administrateur/Modérateur ne donnent aucun droit RH.
- Le bouton RH relit Discord, actualise D1, puis réplique vers GAS sans modifier de rôle.
- Une panne Discord ou de la lecture RH GAS ne bloque pas l'ouverture de la fiche publique.
- Les fonctions restent modifiables uniquement dans Discord.

## Retour arrière

1. Remettre immédiatement `DISCORD_ROLE_DISPLAY_ENABLED=false` pour masquer les blocs.
2. Remettre `DISCORD_ROLE_SYNC_MODE=off` pour arrêter les nouvelles lectures planifiées.
3. Revenir si nécessaire aux versions Worker, GAS et frontend relevées avant publication.
4. Conserver les tables D1 et les colonnes GAS : leur suppression n'est ni nécessaire ni souhaitée pendant un
   incident.
5. Ne jamais supprimer ou réattribuer massivement des rôles Discord lors d'un retour arrière du site.
