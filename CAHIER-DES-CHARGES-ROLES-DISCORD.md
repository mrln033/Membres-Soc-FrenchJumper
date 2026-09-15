# Cahier des charges — Fonctions et activités Discord

Statut : projet à valider avant développement  
Application : Membres Soc FrenchJumper  
Date : 15 septembre 2026

## 1. Objet

Faire apparaître sur la fiche de chaque membre les rôles Discord utiles à la vie de la Soc et au jeu Entropia Universe, sans confondre ces rôles avec les grades de la Soc ni avec les droits d’administration du site.

La solution devra récupérer automatiquement les rôles depuis Discord, les mettre en cache dans D1, les rendre disponibles dans GAS en cas de repli, puis les afficher clairement sur les fiches.

Discord restera la source de vérité pour ces rôles.

## 2. Périmètre fonctionnel

### 2.1 Catégories à distinguer

| Catégorie | Exemples | Signification | Gestion prévue |
|---|---|---|---|
| Accès RH au site | Chef d’Expédition, Conseiller d’Expédition | Autorisation d’administrer l’application Membres | Contrôle déjà assuré par OAuth Discord |
| Équipe Discord | Administrateur, Modérateurs | Responsabilités et permissions sur le serveur Discord | Attribuées uniquement dans Discord |
| Grade de la Soc | Voyageur, Aventurier, etc. | Progression hiérarchique existante | Fonctionnement actuel inchangé |
| Fonction en jeu | Enzoboy, Pilote PF13 | Responsabilité ou service lié à Entropia Universe | Attribuée dans Discord ; modification depuis le site envisageable |
| Activité en jeu | Chasseur, Mineur, Crafteur, Tradeur, Healeur, Sweateur, Streameur | Activité déclarée par le membre | Auto-attribution Discord par le bot externe |

### 2.2 Règles impératives

- Le rôle Discord `Administrateur` ne donne pas accès à l’administration du site Membres.
- Le rôle Discord `Modérateurs` ne donne pas accès à l’administration du site Membres.
- Seuls `Chef d’Expédition` et `Conseiller d’Expédition` autorisent actuellement l’accès RH au site.
- Les rôles d’équipe Discord, les fonctions en jeu, les activités et les grades doivent rester quatre notions distinctes.
- Un rôle doit être identifié techniquement par son ID Discord stable, jamais uniquement par son nom.
- Un membre sans ID Discord conserve une fiche valide, mais aucun rôle Discord ne peut lui être associé automatiquement.

## 3. Résultat attendu sur une fiche

La fiche devra présenter les informations dans cet ordre logique :

1. nom du membre et grade actuel de la Soc ;
2. fonctions en jeu ;
3. activités en jeu ;
4. informations de présence et historique déjà existants ;
5. éventuellement, responsabilités dans l’équipe Discord.

Exemple indicatif :

```text
Merlin
Aventurier expérimenté

Fonctions en jeu
[Enzoboy] [Pilote PF13]

Activités
[Chasseur] [Mineur] [Crafteur]

Responsabilités Discord
[Modérateur]
```

### 3.1 Principes d’affichage

- Les fonctions en jeu utilisent des badges visuellement plus marqués.
- Les activités utilisent des pastilles compactes, éventuellement accompagnées d’une icône.
- Les responsabilités Discord sont affichées dans un bloc distinct et plus discret.
- Les badges doivent revenir correctement à la ligne sur mobile.
- Une catégorie vide affiche une mention sobre telle que `Aucune activité renseignée`, ou reste masquée selon le choix final.
- La date de dernière synchronisation est visible en mode Admin ; elle peut rester masquée en consultation publique.
- Un retard ou une panne Discord ne doit pas empêcher l’ouverture de la fiche : les dernières données connues sont affichées.

## 4. Source et synchronisation des données

### 4.1 Principe général

```text
Discord (source de vérité)
        |
        | synchronisation périodique ou manuelle
        v
Cloudflare D1 (cache principal du site)
        |
        | réplication existante
        v
Google Sheets / GAS (backend de repli)
```

### 4.2 Synchronisation périodique recommandée

- Une tâche Cloudflare est déclenchée toutes les 10 minutes.
- Elle programme les membres à contrôler dans une file, par petits lots.
- Le Worker interroge Discord sans exposer le token du bot au navigateur.
- Pour chaque membre, il conserve seulement les rôles présents dans le catalogue configuré.
- Seuls les changements réels entraînent une écriture dans D1.
- Toute modification D1 est ensuite répliquée vers GAS par la file de synchronisation.
- Les limites et consignes de ralentissement retournées par Discord doivent être respectées.
- Un échec ponctuel doit être retenté sans effacer les dernières informations connues.

Le délai cible de propagation d’une modification réalisée directement dans Discord est donc de 0 à 10 minutes.

### 4.3 Rafraîchissement ponctuel

Le mode Admin disposera d’un bouton `Actualiser les rôles Discord` sur la fiche.

Cette action devra :

1. relire immédiatement les rôles du membre dans Discord ;
2. actualiser D1 si nécessaire ;
3. programmer la réplication vers GAS ;
4. afficher un résultat compréhensible sans recharger toute l’application.

La consultation publique utilisera les données en cache et ne sollicitera pas Discord à chaque affichage.

### 4.4 Temps réel Discord

La connexion permanente au Gateway Discord n’est pas retenue pour la première version. Elle imposerait la gestion d’une connexion persistante, des heartbeats, des reconnexions et des événements `GUILD_MEMBER_UPDATE`.

Elle pourra être étudiée ultérieurement si un délai maximal de 10 minutes devient insuffisant.

## 5. Modification des rôles

### 5.1 Équipe Discord

Les rôles `Administrateur` et `Modérateurs` restent gérés exclusivement depuis Discord. Le site ne doit jamais les ajouter ni les retirer.

### 5.2 Fonctions en jeu

Deux modes sont envisageables :

- mode initial prudent : lecture seule sur le site, attribution dans Discord par les administrateurs et modérateurs ;
- évolution : bouton `Gérer les fonctions` accessible aux administrateurs RH du site.

Si la modification depuis le site est activée :

1. le Worker vérifie la session Discord de l’administrateur RH ;
2. il contrôle que le rôle demandé appartient bien à la catégorie `Fonction en jeu` et qu’il est déclaré modifiable ;
3. il ajoute ou retire le rôle via l’API Discord ;
4. il actualise D1 uniquement après confirmation de Discord ;
5. il réplique ensuite la nouvelle situation vers GAS ;
6. il journalise l’auteur, le membre, le rôle, l’action et la date.

Le bot devra posséder la permission Discord nécessaire et être placé au-dessus des rôles qu’il doit gérer.

### 5.3 Activités en jeu

Les activités restent en lecture seule sur le site dans la première version.

Le post à réactions et le bot externe restent le seul mécanisme d’auto-attribution. Cette règle évite qu’une modification faite sur le site rende la réaction Discord incohérente avec le rôle réellement porté.

Un libre-service depuis le site pourra être envisagé ultérieurement, mais il nécessitera une étude spécifique de compatibilité avec le bot externe.

## 6. Modèle de données proposé

### 6.1 Catalogue des rôles suivis

Nouvelle table D1 indicative : `discord_role_catalog`.

Champs principaux :

- `discord_role_id` : ID stable du rôle ;
- `label` : libellé affiché ;
- `category` : `SITE_ACCESS`, `DISCORD_STAFF`, `GAME_FUNCTION` ou `GAME_ACTIVITY` ;
- `display_order` : ordre d’affichage ;
- `site_editable` : rôle modifiable ou non depuis le site ;
- `active` : permet de retirer un rôle du périmètre sans perdre immédiatement son historique.

### 6.2 Rôles détenus par les membres

Nouvelle table D1 indicative : `member_discord_roles`.

Champs principaux :

- identifiant du membre ;
- ID du rôle Discord ;
- date de première observation ;
- date de dernière observation ;
- date de dernière synchronisation.

Une contrainte d’unicité empêchera qu’un même rôle soit enregistré deux fois pour un membre.

### 6.3 Données de suivi

Le membre devra également disposer d’un état de synchronisation permettant de connaître :

- la dernière tentative ;
- la dernière réussite ;
- l’éventuelle dernière erreur ;
- la présence ou non du membre sur le serveur Discord.

### 6.4 Repli GAS

La feuille des membres recevra des colonnes dédiées, par exemple :

- `FonctionsDiscord` ;
- `ActivitesDiscord` ;
- `EquipeDiscord` ;
- `RolesDiscordMajLe`.

Le format exact devra être stable et lisible par GAS. Ces champs sont des copies de Discord et ne devront pas être modifiés manuellement dans la feuille.

## 7. Sécurité et permissions

- Le token du bot Discord reste exclusivement dans les secrets Cloudflare et GAS concernés.
- Aucun ID de rôle sensible ni secret n’est fourni directement par le navigateur pour décider d’une autorisation.
- Toute modification déclenchée depuis le site exige une session OAuth valide.
- Les droits RH du site continuent d’être vérifiés à partir des rôles `Chef d’Expédition` et `Conseiller d’Expédition`.
- Le rôle demandé doit appartenir à une liste blanche de rôles gérables.
- Les rôles `Administrateur`, `Modérateurs`, les grades et les rôles techniques sont explicitement exclus de toute modification par cette nouvelle interface.
- Les opérations d’ajout et de retrait doivent être idempotentes et journalisées.
- Les réponses d’erreur Discord doivent être filtrées avant d’être affichées à l’utilisateur.

## 8. Gestion des erreurs

- Discord indisponible : conserver et afficher la dernière copie connue.
- Membre absent du serveur : retirer de la copie locale les rôles suivis et actualiser son état de présence.
- ID Discord absent ou invalide : ne pas appeler Discord et signaler le problème en mode Admin.
- Rôle supprimé ou remplacé dans Discord : le marquer inactif dans le catalogue avant nettoyage.
- Permission insuffisante du bot : ne pas modifier D1 comme si l’opération avait réussi.
- Échec de réplication GAS : conserver la mutation et la rejouer par la file existante.
- Échec partiel d’un lot : les autres membres continuent d’être traités.

## 9. Déploiement par étapes

### Lot 1 — Observation et affichage

- créer les tables D1 et les colonnes GAS ;
- configurer le catalogue des rôles ;
- récupérer les rôles Discord ;
- mettre en place la synchronisation périodique et manuelle ;
- afficher les catégories sur les fiches ;
- conserver toutes les catégories en lecture seule.

### Lot 2 — Gestion des fonctions en jeu

- ajouter l’interface Admin de sélection des fonctions ;
- autoriser uniquement les rôles explicitement déclarés modifiables ;
- appliquer les changements immédiatement dans Discord ;
- ajouter le journal d’audit et les tests de permissions.

### Lot 3 — Améliorations facultatives

- filtres de la liste des membres par fonction ou activité ;
- affichage synthétique dans la liste générale ;
- libre-service des activités si compatible avec le bot externe ;
- synchronisation temps réel par Gateway Discord si nécessaire.

## 10. Tests et critères de validation

La première version sera considérée comme validée lorsque :

- un membre lié à Discord affiche les bons rôles dans chaque catégorie ;
- les grades existants restent strictement inchangés ;
- `Administrateur` et `Modérateurs` ne donnent aucun droit sur le site ;
- un changement Discord apparaît automatiquement dans le délai prévu ;
- le bouton de rafraîchissement actualise une fiche sans écriture parasite ;
- une panne Discord laisse les fiches consultables ;
- D1 et GAS présentent les mêmes fonctions et activités ;
- aucun rôle hors catalogue ne peut être modifié depuis le site ;
- le bot ne peut pas modifier les rôles d’équipe Discord ou les grades par cette fonctionnalité ;
- les affichages ordinateur et mobile restent lisibles ;
- les tests automatisés existants continuent de réussir ;
- une procédure documentée permet de désactiver la fonctionnalité ou de revenir à la version précédente.

## 11. Retour arrière

Chaque lot devra posséder son propre commit et être activé par un indicateur de configuration.

Le retour arrière devra permettre :

- de masquer immédiatement les nouveaux blocs sur les fiches ;
- d’arrêter la synchronisation planifiée ;
- de conserver les tables et colonnes sans supprimer de données ;
- de revenir au Worker et au frontend précédents ;
- de ne jamais retirer massivement des rôles Discord lors d’un rollback.

## 12. Informations nécessaires avant développement

Les éléments suivants devront être fournis ou décidés :

1. ID Discord du rôle `Administrateur` ;
2. ID Discord du rôle `Modérateurs` ;
3. liste complète et IDs des fonctions en jeu ;
4. liste complète et IDs des activités en jeu ;
5. visibilité publique ou Admin uniquement des responsabilités Discord ;
6. validation ou non de la modification des fonctions depuis le site dans le lot 2 ;
7. confirmation des rôles autorisés à gérer ces fonctions depuis le site ;
8. vérification de la permission et de la position hiérarchique du rôle du bot ;
9. validation du délai de synchronisation cible de 10 minutes.

## 13. Recommandation de départ

Commencer par le lot 1 en lecture seule. Cette étape apporte immédiatement l’information demandée tout en limitant fortement les risques pour l’application en production et pour les rôles Discord.

Après une période d’observation, le lot 2 pourra ouvrir la modification des seules fonctions en jeu depuis le site. Les activités et les rôles de l’équipe Discord resteront gérés dans Discord.
