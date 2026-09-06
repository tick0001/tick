# Feuille de route

Stratégie retenue : **socle d'abord, puis une tranche verticale complète sur le ticket**, puis
élargissement. Chaque jalon est livrable, testé et utilisable — pas un chantier ouvert en
attendant le suivant.

Les identifiants `M01`…`M17` renvoient au [périmètre fonctionnel](01-perimetre-fonctionnel.md).

---

### J0 — Fondations · livré

Monorepo pnpm et Turborepo, `apps/api` et `apps/web` qui démarrent, Docker Compose (PostgreSQL,
Redis, Mailpit), TypeScript strict, ESLint et Prettier, Vitest, intégration continue, conventions
de commit, documentation initiale.

_Terminé quand_ : `docker compose up` puis un lancement suffisent à obtenir une API et une
interface fonctionnelles sur une machine vierge.

### J1 — Socle de sécurité · livré

Arbre des entités en `ltree`, utilisateurs, groupes, profils et droits, habilitations, contexte de
requête, **Row-Level Security**, authentification locale, LDAP et synchronisation, règles
d'affectation d'habilitations, internationalisation, configuration héritée par entité.

_Terminé quand_ : les neuf cas de [la section 9](03-entites-droits-securite.md) passent contre une
vraie base PostgreSQL, avec le rôle applicatif.

**Livré.** Le jalon inclut aussi le socle d'annuaire : authentification LDAP, synchronisation des
comptes, et réconciliation des habilitations dynamiques. La _décision_ d'affectation repose pour
l'instant sur une table de correspondance groupe → habilitation ; le moteur de règles générique du
jalon J4 remplacera cette source sans toucher au mécanisme de révocation.

> **Correction de comptabilité.** Ce jalon était marqué `M16` — Administration. C'était faux : il a
> livré le **substrat** de sécurité — tables, RLS, résolution des droits, habilitations, annuaire —
> mais aucun écran d'administration, et aucune route hors `entities`. Un administrateur ne pouvait
> ni créer un compte, ni composer un profil, ni accorder une habilitation. Le module est livré au
> jalon [J8+](#j8--pilotage--livré-m06-m14-m15), avec les écrans qui manquaient.

### J2 — Substrat d'extension

Bus de hooks et bus d'événements, contexte d'exécution des plugins, cycle de vie complet
(découverte, validation du manifeste, résolution des dépendances, installation, activation, mise à
jour, désinstallation), schéma PostgreSQL par plugin et migrations, chargement ESM dynamique côté
interface avec dépendances partagées.

_Terminé quand_ : un plugin minimal s'installe, s'active, intercepte un hook, se met à jour et se
désinstalle sans laisser de trace.

> **Le substrat vient avant le métier, la surface publique vient après.** L'infrastructure
> d'extension dicte la façon dont les services sont écrits : la greffer après coup imposerait de
> tout réécrire. Mais concevoir le catalogue de hooks et l'API de champs additionnels _avant_ de
> connaître le domaine réel produit une surface élégante et inadaptée. On construit donc la
> mécanique maintenant, et on dessine ce qu'elle expose au jalon suivant.

### J3 — Le ticket, de bout en bout · livré `M01` `M02` `M05`

Ticket avec tous ses champs et statuts, acteurs, suivis, tâches, solution, validations, documents,
coûts, historique, gabarits, corbeille. Interface technicien : liste dense, formulaire, chronologie.
Notifications élémentaires. Recherche multi-critères et recherches sauvegardées `M13`.

C'est ici que se dessine la **surface publique de `@tick/plugin-sdk`** : chaque hook, chaque
emplacement d'interface et chaque extension de champ est extrait d'un besoin constaté sur le
ticket, jamais imaginé. Le plugin de référence `exemple-bonjour` naît avec elle et sert de test
d'intégration permanent du contrat.

_Terminé quand_ : une équipe peut réellement traiter des tickets, et un plugin peut ajouter un
onglet, un champ et une règle sans toucher au cœur.

**Livré à ce stade** — modèle ITIL complet (tickets, acteurs polymorphes, suivis, tâches,
solutions, validations, coûts, liens, historique universel), référentiels arborescents, cycle de
vie avec transitions contrôlées et suspension des délais en attente, priorité dérivée d'une matrice
héritée par entité, les cinq portées de droits traduites en conditions SQL, pagination par curseur,
et l'interface technicien : liste dense filtrable et fiche avec chronologie unifiée. SDK 0.2 avec
les hooks et événements du ticket, exercés par le plugin de référence.

**Complété ensuite** — gabarits de ticket `M05` avec les trois natures de champ (prérempli,
obligatoire, masqué) et formulaire de création piloté par le gabarit ; recherche multi-critères
`M13` sur un registre de champs déclarés, avec recherches sauvegardées personnelles ou partagées ;
notifications élémentaires avec modèles multilingues, destinataires par rôle et file d'envoi
persistante ; pièces jointes adressées par empreinte, servies après vérification du périmètre.

Le SDK est passé en `0.3` : les plugins peuvent désormais rendre leurs propres champs
interrogeables depuis la recherche.

### J4 — Niveaux de service et règles · livré `M03` `M04`

Calendriers ouvrés et jours fériés, SLA et OLA, calcul et recalcul des échéances, suspension,
niveaux d'escalade. Moteur de règles générique, règles à la création et à la mise à jour,
dictionnaires, simulateur. Matrice urgence × impact par entité.

_Terminé quand_ : une organisation peut promettre un délai, le tenir en heures ouvrées, être
alertée avant de le manquer, et expliquer pourquoi un ticket a été aiguillé là où il l'a été.

**Livré** — arithmétique du temps ouvré sur calendriers à fuseau explicite, avec jours fériés
perpétuels ou ponctuels ; engagements SLA et OLA sur deux axes, quatre échéances par ticket,
recalculées depuis la date d'ouverture et repoussées du temps d'attente cumulé ; niveaux d'escalade
à décalage relatif à l'échéance, exécutés par un balayage piloté par la base et protégés du rejeu ;
moteur de règles sur cinq collections, avec catalogue de champs, opérateurs de chemin, captures
d'expression régulière réutilisables, chaînage réglable et ordre éditable ; simulateur qui rejoue
le moteur de production sans rien écrire ; interface de configuration pour les trois objets et
badges d'engagement sur la fiche de ticket.

La table `ldap_group_mappings` disparaît : la collection `authorization.assign` la remplace, à
mécanisme de révocation inchangé. Le SDK passe en `0.4` avec l'événement `ticket.escalated`.

Un défaut de visibilité présent depuis J3 est corrigé au passage : joindre `entities` dans une
requête soumise au Row-Level Security faisait disparaître tout objet de configuration hérité d'un
ancêtre. Voir [07](07-niveaux-de-service-et-regles.md).

### J5 — Communication · livré `M07` `M08` `M11`

Notifications complètes : événements, modèles multilingues, destinataires calculés, file d'attente
avec rejeu, préférences utilisateur. Collecteur de courriel entrant et réponse par courriel.
Enquêtes de satisfaction.

_Terminé quand_ : un demandeur peut ouvrir un ticket par courriel, y répondre par courriel, et
donner son avis sans jamais ouvrir l'interface.

**Livré** — quatorze événements notifiables, modèles multilingues avec destinataires calculés parmi
dix rôles dont les groupes et leurs responsables, traduction choisie **par destinataire**, variables
de l'événement exposées telles quelles, restriction automatique des rôles pour un objet privé,
préférences par utilisateur et par événement, file consultable avec rejeu et purge ; collecteur IMAP
qui rattache une réponse par les en-têtes puis par le marqueur du sujet, coupe les boucles et les
réponses automatiques, extrait les pièces jointes et journalise chaque décision ; adresses
d'expédition et de réponse héritées par entité ; enquêtes de satisfaction programmées à la clôture
selon un taux, avec relance unique, formulaire public par jeton et exploitation statistique.

Le SDK passe en `0.5` : `authorId` rejoint la charge utile des suivis, tâches et solutions —
sans quoi personne ne peut notifier « l'auteur du suivi » — et les événements
`satisfaction.requested` et `satisfaction.answered` apparaissent.

Le compose gagne **GreenMail** : Mailpit montre ce qui sort, GreenMail fournit la boîte IMAP que le
collecteur relève. Deux serveurs, deux rôles.

### J6 — Self-service · livré `M09` `M10` `M12`

Interface simplifiée, base de connaissances et FAQ publique, constructeur de formulaires avec
logique conditionnelle et destinations, catalogue de services.

_Terminé quand_ : un demandeur trouve sa réponse seul, ou ouvre sa demande en répondant à des
questions plutôt qu'en remplissant des champs ITIL qu'il ne comprend pas.

**Livré** — base de connaissances avec catégories arborescentes, révisions conservant l'état
précédent, ciblage de visibilité par profil, groupe ou utilisateur, brouillons réservés à leur
auteur, favoris, compteur de consultations et recherche plein texte sur colonne générée ; FAQ
publique servie sans authentification par le même service que l'interface authentifiée ;
constructeur de formulaires avec sections, questions typées, affichage conditionnel, politique
d'accès et correspondances explicites vers les champs du ticket ; catalogue de services et
interface simplifiée portée par le profil actif.

Un formulaire soumis passe par `TicketsService` : le ticket qu'il produit reçoit ses règles, ses
engagements et son historique comme n'importe quel autre. La comparaison d'opérateurs est extraite
du moteur de règles et partagée avec l'interface, pour qu'une question cachée d'un côté ne soit pas
exigée de l'autre.

Voir [09](09-self-service.md).

### J7 — Problèmes et changements · livré `M01`

Les deux objets restants sur le socle ITIL commun, liens entre objets, promotion d'un ticket vers
un problème puis un changement.

_Terminé quand_ : un incident révèle un problème, qui appelle un changement, sans que le demandeur
de l'incident perde son ticket de vue.

**Livré** — `problems` et `changes` en tables distinctes partageant le cycle de vie du ticket, avec
leurs colonnes propres : symptômes, causes et impacts d'un côté ; plans de déploiement, de retour
arrière et de validation, plus liste de contrôle, de l'autre. La chronologie, les acteurs,
l'historique, les pièces jointes et la portée des droits sont ceux du ticket, généralisés par un
descripteur unique plutôt que dupliqués. Liens entre objets quelconques, lus symétriquement et
filtrés bout par bout selon le périmètre de chacun. Promotion qui **crée et rattache** au lieu de
déplacer, reportant demandeurs, urgence, impact, catégorie et entité d'origine, mais ni le statut,
ni les affectés, ni la priorité — recalculée.

Le SDK passe en `0.6` : les six événements des deux objets, plus `itil.linked`, `itil.unlinked` et
`itil.promoted`. Ils restent hors du catalogue des notifications, dont les modèles résolvent leurs
destinataires dans `tickets`.

Voir [10](10-problemes-et-changements.md).

### J8 — Pilotage · livré `M06` `M14` `M15`

Planning et calendrier des tâches, statistiques et tableaux de bord composables, exports CSV et
PDF, actions massives, tickets récurrents.

_Terminé quand_ : un responsable de service voit ce qui est prévu, ce qui s'est passé, et peut agir
sur une sélection sans ouvrir les tickets un par un.

**Livré** — planning superposant tâches planifiées et indisponibilités dans une seule liste, avec
détection des chevauchements par technicien et export iCal ; tickets récurrents pilotés par la base,
tenant l'heure murale à travers les changements d'heure et le quantième à travers les mois courts,
avec avance de création et trace anti-rejeu ; statistiques globales et ventilées selon huit
dimensions fermées, courbe d'activité sans trou de série ; tableaux de bord composables dont chaque
widget porte sa propre configuration, avec un registre alimentable par les plugins ; exports CSV et
PDF écrits sans dépendance ; actions massives passant par le service ordinaire, ticket par ticket,
et rendant chaque échec nommément.

Toutes les agrégations passent par la portée du droit de lecture, via un alias de table demandé à
`TicketScopeService` : un agrégat est une lecture, et compter « tous les tickets » aurait divulgué
exactement ce que la liste refuse de montrer.

Le SDK passe en `0.7` : `recurrence.generated`, et `dashboards.registerWidget` sur le modèle de
`search.registerField`.

Voir [11](11-pilotage.md).

### J8+ — Administration et refonte de l'interface · livré `M16`

Deux manques constatés à l'usage, corrigés avant l'ouverture publique.

**Administration** — l'écran des entités passe en écriture, et trois écrans manquants apparaissent :
comptes avec leurs habilitations, groupes avec leurs membres, profils avec leur **matrice de
droits**. Le catalogue des droits est servi par le serveur, groupé par domaine, et les portées y
sont restreintes objet par objet — proposer « les miens » sur un modèle de notification n'aurait eu
aucun sens. Les plugins peuvent y déclarer leurs propres objets, sans quoi leurs droits seraient
inconfigurables et leurs écrans inatteignables.

Trois garde-fous, appris de ce qui se répare sinon en base : on ne se désactive pas soi-même, on ne
retire pas son habilitation active, et on ne supprime pas un profil sur lequel des habilitations
s'appuient. La matrice invalide le cache de `RightsService` — sans quoi un droit retiré continuerait
de s'appliquer jusqu'au redémarrage.

Au passage, les droits `planning`, `recurrence` et `stats` que la graine distribuait n'étaient
vérifiés par personne : les contrôleurs se contentaient du droit sur les tickets. Ils sont
désormais exigés.

S'y ajoutent les deux écrans qui n'avaient qu'une API : la configuration des **annuaires LDAP**,
avec essai de connexion, et les **réglages par entité**, où chaque valeur affiche son origine —
posée ici, ou héritée, et de quel ancêtre. Voir [13](13-administration.md).

**Interface** — jetons de couleur sémantiques, navigation groupée en cinq sections, briques
communes. Voir [12](12-interface.md).

### J9 — Ouverture

API REST publique documentée en OpenAPI, documentation du SDK de plugins avec exemples, guide
d'installation et d'exploitation, packaging des images Docker, choix et application de la licence,
préparation de la publication.

**Gel du SDK en `1.0`.** Jusqu'ici il évolue en `0.x` et peut rompre sans cérémonie. Il ne se fige
qu'à cette condition : chaque point d'extension est exercé par au moins un usage réel — le plugin
de référence ne suffit pas à lui seul à prouver qu'une API est bonne.

---

## Ce qui est délibérément écarté

Gestion de parc et inventaire, gestion financière et contrats au-delà du lien avec les SLA,
projets, réservations, flux RSS, et compatibilité avec les plugins ou l'API de GLPI — le projet est
neuf, sans contrainte de reprise.
