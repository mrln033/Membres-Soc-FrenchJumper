# D-003 — Connexion Discord et remplacement de `?admin=1`

Statut : analyse de faisabilité terminée, développement non commencé

Date : 16 septembre 2026

Application : Membres Soc FrenchJumper

## 1. Conclusion

La demande est réalisable sans migration D1 et sans modifier les données métier. L'authentification OAuth Discord déjà présente fournit une base saine, mais elle confond actuellement deux notions qu'il faut séparer :

- **authentification** : connaître l'identité Discord de la personne connectée ;
- **autorisation RH** : vérifier que cette personne porte actuellement le rôle `Chef d'Expédition` ou `Conseiller d'Expédition`.

La cible recommandée permet à tout utilisateur de se connecter avec Discord. Un utilisateur sans rôle RH reste sur l'interface publique, voit son état de connexion et peut se déconnecter, mais ne voit aucun menu ni bouton d'administration. Les écritures continuent d'être refusées côté Worker et côté GAS si le rôle requis n'est pas porté.

La suppression de `?admin=1` est donc possible. Elle doit être faite par étapes afin de ne pas interrompre l'application en production et de conserver le backend GAS de secours.

## 2. Fonctionnement actuel constaté

### Frontend

- `js/config.js` transforme `?admin=1` en indicateur `sessionStorage.admin`.
- La constante `isAdmin` dépend uniquement de cet indicateur local pour afficher les éléments d'administration.
- `index.html` affiche `Nouveau Membre` et `Synchronisation GAS / D1` si le paramètre est présent.
- `fiche.html` et `js/client.js` utilisent le même indicateur pour afficher les données Discord et les boutons de modification.
- La première écriture déclenche OAuth si aucune session n'est encore présente.
- La session signée est conservée dans `sessionStorage`, tandis que l'ancien jeton reste disponible comme repli de migration.

Cette organisation protège déjà les écritures côté serveur, mais elle peut afficher des commandes d'administration à une personne qui possède seulement le paramètre d'URL. L'écriture sera refusée, mais l'interface n'est pas encore pilotée par l'autorisation réelle.

### Worker Cloudflare

- Le callback OAuth utilise le scope minimal Discord `identify`.
- Après lecture de `/users/@me`, le Worker exige immédiatement un rôle RH avec `requireAllowedDiscordRole`.
- Un utilisateur sans rôle RH ne reçoit donc aucune session et sa connexion est refusée.
- `/auth/session` appelle actuellement la même autorisation complète.
- Chaque requête sensible relit les rôles Discord avec le bot avant d'autoriser l'écriture.
- Les routes OAuth fonctionnent indépendamment de D1.

### Backend GAS

- GAS vérifie la signature HMAC, l'audience et l'expiration de la session reçue.
- GAS relit ensuite les rôles Discord avant chaque action sensible.
- Le backend de secours possède donc déjà la bonne protection serveur et devra la conserver.

## 3. Comportement cible

| Situation | Menu public | Identité connectée | Menus/actions RH | Écriture serveur |
|---|---:|---:|---:|---:|
| Visiteur non connecté | oui | non | non | refusée |
| Discord connecté sans rôle RH | oui | oui | non | refusée avec autorisation insuffisante |
| Discord connecté avec rôle RH | oui | oui | oui | autorisée après relecture des rôles |
| Rôle RH retiré pendant la session | oui | oui | masqués au prochain contrôle | immédiatement refusée côté serveur |
| Session expirée | oui | non après contrôle | non | refusée, nouvelle connexion nécessaire |

Le bouton placé en bas du menu doit toujours être visible :

- `Connexion Discord` lorsqu'aucune session valide n'existe ;
- le nom Discord et `Aucun droit RH` pour une session valide sans rôle autorisé ;
- le nom Discord et l'état `Accès RH` pour une session autorisée ;
- `Déconnexion` dès qu'une personne est connectée.

## 4. Architecture recommandée

### 4.1 Séparer session Discord et autorisation RH dans le Worker

Créer deux niveaux de contrôle dans `src/auth.js` :

1. `authenticateDiscordSession` vérifie uniquement la signature, l'audience, l'identité et l'expiration de la session ;
2. `authorizeAdminRequest` part de cette identité puis relit le membre et ses rôles Discord avant toute opération RH.

Le callback OAuth ne doit plus appeler une fonction qui lève une erreur lorsque le rôle RH manque. Il doit :

1. échanger le code OAuth ;
2. lire l'identité avec le scope `identify` ;
3. émettre une session courte pour tout utilisateur Discord authentifié ;
4. laisser `/auth/session` déterminer séparément si la personne possède un accès RH.

Réponse cible de `GET /auth/session` pour une session valide :

```json
{
  "authenticated": true,
  "authorized": false,
  "user": {
    "id": "123456789012345678",
    "name": "Nom Discord"
  },
  "reason": "Rôle Discord administrateur requis"
}
```

Une session absente, invalide ou expirée retourne `401`. Une session valide sans rôle RH ne doit pas être assimilée à une déconnexion : les routes de statut répondent `200` avec `authorized: false`, tandis qu'une tentative d'écriture retourne `403`. Cette distinction permet de masquer les droits sans déconnecter la personne.

Les rôles ne doivent pas être considérés comme fiables s'ils sont seulement présents dans le navigateur ou dans le contenu du jeton. La relecture Discord avant chaque écriture demeure obligatoire.

Pour éviter de casser les sessions déjà émises et la vérification GAS, l'audience actuelle `frj-membres-admin` peut
être conservée pendant la transition : son nom historique ne doit plus être interprété comme une preuve de droit.
Un éventuel renommage ultérieur en audience générique devra accepter temporairement les deux audiences dans le Worker
et dans GAS, puis attendre l'expiration des anciennes sessions avant de retirer la compatibilité.

### 4.2 Remplacer `isAdmin` par un état asynchrone

Dans `js/config.js`, remplacer l'indicateur dérivé de `sessionStorage.admin` par un état partagé initialisé depuis `/auth/session` :

```text
loading -> anonymous
        -> authenticated / unauthorized
        -> authenticated / authorized
```

Le rendu des menus et boutons RH doit attendre la résolution de cet état afin d'éviter un affichage furtif non autorisé. Les pages `nouveau.html` et `sync.html`, y compris lorsqu'elles sont ouvertes directement, doivent effectuer le même contrôle avant d'afficher leur contenu.

Les fonctions de navigation ne doivent plus ajouter `admin=1`. Si ce paramètre existe dans un ancien favori, il doit être ignoré puis retiré proprement de l'URL avec `history.replaceState`, sans erreur et sans donner de droit.

### 4.3 Bouton Connexion/Déconnexion

Dans `index.html` :

- transformer la barre latérale en conteneur vertical sur toute la hauteur ;
- conserver la liste principale en haut ;
- ajouter une zone de compte en bas avec `margin-top: auto` ;
- prévoir les états de chargement, connexion, connecté sans droit, connecté avec droit et erreur ;
- rendre le bouton utilisable au clavier et ajouter les libellés accessibles nécessaires ;
- conserver la zone visible sur les petits écrans et lorsque le contenu central défile.

La déconnexion supprime localement la session et l'ancien jeton éventuel, remet immédiatement l'interface en mode public et recharge une page publique si une page RH était ouverte. La session actuelle étant un jeton signé sans stockage serveur, cette déconnexion est locale ; sa durée maximale reste bornée à trente minutes et les rôles sont de toute façon relus avant chaque écriture.

### 4.4 Appel direct et intégration en iframe

L'affichage historique peut rester différent sans conserver `?admin=1` :

- l'ouverture de `index.html` montre la barre latérale complète et le bouton de connexion ;
- une page de contenu telle que `actifs.html` intégrée directement dans l'iframe du site historique garde son affichage sans barre latérale ;
- les pages publiques ne dépendent jamais d'une connexion pour être consultées.

Si le site historique intègre `index.html` lui-même dans une iframe, un flux OAuth plein écran risque de remplacer la page parente ou d'être bloqué dans l'iframe. La solution robuste consiste à ouvrir OAuth depuis le clic utilisateur dans une petite fenêtre dédiée :

1. l'application crée un `state` aléatoire avec Web Crypto ;
2. une page de callback statique du même domaine reçoit la session dans le fragment ;
3. cette page transmet le résultat à la fenêtre d'origine avec `postMessage` ;
4. la fenêtre d'origine vérifie strictement l'origine et le `state`, stocke la session puis ferme la fenêtre OAuth ;
5. si l'ouverture de fenêtre est impossible, un parcours pleine page contrôlé reste disponible.

Cette variante évite de lire `window.top.location` lorsque le parent est d'une autre origine et préserve l'intégration historique. Elle doit être testée sur le domaine réel du site historique avant publication.

### 4.5 Compatibilité GAS

Le login reste fourni par le Worker Cloudflare, même si `backend=gas` est sélectionné. Une session déjà obtenue peut être vérifiée par GAS grâce au secret HMAC partagé. GAS continue de relire les rôles avant chaque écriture.

Conséquence connue : si le Worker OAuth est indisponible, les lectures publiques GAS restent utilisables, mais une nouvelle connexion Discord ne peut pas être initiée. Une session encore valide peut continuer à servir GAS. Ce comportement doit être affiché clairement et testé.

## 5. Déploiement sans rupture

### Étape 0 — état de référence

- noter les versions Worker, GAS et frontend actuellement publiées ;
- conserver le commit de retour arrière ;
- exécuter les tests existants et vérifier D1, GAS, OAuth Admin et le mode iframe ;
- confirmer les IDs des rôles RH dans Cloudflare et Apps Script.

### Étape 1 — Worker rétrocompatible

- ajouter la distinction authentification/autorisation ;
- enrichir `/auth/session` ;
- différencier `401` et `403` ;
- conserver provisoirement le callback actuel derrière une variable non secrète telle que `AUTH_LOGIN_POLICY=admin_only` ;
- ajouter tous les tests sans encore permettre la connexion des utilisateurs non RH ;
- déployer et valider sans changer le frontend.

### Étape 2 — GAS et frontend

- aligner GAS sur la distinction session invalide/rôle insuffisant si nécessaire ;
- ajouter la zone Connexion/Déconnexion ;
- ajouter l'état asynchrone et le rendu conditionnel ;
- supprimer la propagation de `admin=1` et ignorer les anciens liens ;
- protéger les accès directs à `nouveau.html` et `sync.html` ;
- ajouter le callback compatible iframe et ses contrôles `postMessage` ;
- publier GAS en conservant l'URL `/exec`, puis publier le frontend.

### Étape 3 — ouvrir la connexion à tous

- passer la politique à `AUTH_LOGIN_POLICY=all` ;
- contrôler un compte RH, un membre sans rôle RH, un compte absent du serveur, une session expirée et un retrait de rôle en cours de session ;
- vérifier l'appel direct, l'iframe historique, le mobile, D1 et `backend=gas`.

### Étape 4 — clôturer D-001

- passer `ALLOW_LEGACY_ADMIN_TOKEN=false` ;
- valider à nouveau toutes les écritures D1 et GAS ;
- supprimer ensuite le secret `ADMIN_TOKEN` et la clé navigateur `FRJ_MEMBRES_D1_ADMIN_TOKEN` ;
- conserver une procédure de rollback explicite sans supprimer les secrets de session partagés nécessaires à GAS.

## 6. Tests obligatoires

### Worker

- connexion OAuth réussie avec et sans rôle RH ;
- compte Discord absent du serveur ;
- `/auth/session` anonyme, expiré, non autorisé et autorisé ;
- changement ou retrait de rôle après émission de la session ;
- refus `403` d'une écriture avec session valide mais rôle insuffisant ;
- validation du `state`, de l'origine de retour, de la taille des réponses Discord et des erreurs `429`/`5xx` ;
- maintien du repli legacy uniquement pendant la fenêtre prévue.

### Frontend

- absence totale de droit produit par `?admin=1` ;
- cinq états du bouton de compte ;
- menus RH invisibles tant que l'autorisation n'est pas confirmée ;
- déconnexion immédiate et retour à une page publique ;
- accès direct refusé à `nouveau.html` et `sync.html` sans droit ;
- navigation interne sans paramètre Admin ;
- OAuth direct et OAuth depuis l'iframe historique ;
- origine et `state` invalides refusés dans le callback de fenêtre ;
- affichage mobile avec bouton toujours visible.

### GAS et recette croisée

- session valide avec rôle RH acceptée ;
- session valide sans rôle RH refusée sans être traitée comme expirée ;
- session expirée refusée ;
- résultat identique des quatre actions protégées sur D1 et GAS ;
- lectures publiques disponibles sans connexion ;
- aucune écriture rejouée automatiquement lors d'un basculement de backend.

## 7. Sécurité et limites

- Conserver le scope OAuth `identify` : le bot serveur suffit pour relire l'appartenance et les rôles, le scope `guilds` n'est pas nécessaire.
- Conserver `DISCORD_OAUTH_CLIENT_SECRET`, `ADMIN_SESSION_SECRET`, les tokens de bot et les webhooks exclusivement dans les secrets Cloudflare ou les propriétés Apps Script.
- Générer le `state` avec `crypto.getRandomValues` et comparer les valeurs retournées avant d'accepter la session.
- Ne jamais faire confiance à un booléen d'administration stocké par le navigateur.
- Ne jamais afficher un bouton RH avant que le serveur ait confirmé `authorized: true`.
- Ne pas supprimer la relecture des rôles à chaque écriture, même si `/auth/session` vient d'être appelé.
- Filtrer les erreurs Discord avant affichage et respecter les réponses de limitation de débit.
- Une déconnexion locale ne révoque pas matériellement un jeton stateless déjà copié ; la durée courte et la relecture des rôles limitent ce risque. Une révocation immédiate nécessiterait un stockage serveur de sessions, non requis pour D-003.

## 8. Retour arrière

Chaque étape doit former un commit distinct et rester activable par configuration :

1. remettre `AUTH_LOGIN_POLICY=admin_only` pour refuser les connexions non RH sans revenir sur tout le Worker ;
2. restaurer temporairement l'ancien frontend si le nouveau menu pose problème ;
3. conserver `ALLOW_LEGACY_ADMIN_TOKEN=true` uniquement pendant la fenêtre de retour arrière ;
4. revenir à la version Worker précédente avec la procédure documentée ;
5. restaurer la version GAS précédente sans changer l'URL `/exec` ;
6. ne supprimer aucune donnée métier, car D-003 ne demande aucune migration D1 ni modification de feuille.

## 9. Fichiers qui seront concernés par l'implémentation

- `cloudflare/membres-soc-api/src/auth.js`
- `cloudflare/membres-soc-api/src/index.js`
- `cloudflare/membres-soc-api/test/auth.test.js`
- `cloudflare/membres-soc-api/test/frontend-config.test.js`
- `cloudflare/membres-soc-api/wrangler.jsonc`
- `gas/Code.gs`
- `index.html`
- nouvelle page de callback OAuth statique si la fenêtre dédiée est retenue
- `js/config.js`
- `js/client.js`
- `css/style.css`
- toutes les documentations décrivant l'accès Admin, OAuth, GAS, le déploiement, la sécurité et le point de reprise

## 10. Références officielles

- [OAuth2 et permissions Discord](https://docs.discord.com/developers/platform/oauth2-and-permissions)
- [Ressource membre d'un serveur Discord](https://docs.discord.com/developers/resources/guild#get-guild-member)
- [Bonnes pratiques Cloudflare Workers](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)
- [Secrets Cloudflare Workers](https://developers.cloudflare.com/workers/configuration/secrets/)
