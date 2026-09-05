# Feuille de route

Stratégie retenue : **socle d'abord, puis une tranche verticale complète sur le ticket**, puis
élargissement. Chaque jalon est livrable, testé et utilisable — pas un chantier ouvert en
attendant le suivant.

Les identifiants `M01`…`M17` renvoient au [périmètre fonctionnel](01-perimetre-fonctionnel.md).

---

### J0 — Fondations

Monorepo pnpm et Turborepo, `apps/api` et `apps/web` qui démarrent, Docker Compose (PostgreSQL,
Redis, Mailpit), TypeScript strict, ESLint et Prettier, Vitest, intégration continue, conventions
de commit, documentation initiale.

_Terminé quand_ : `docker compose up` puis un lancement suffisent à obtenir une API et une
interface fonctionnelles sur une machine vierge.

### J1 — Socle de sécurité `M16`

Arbre des entités en `ltree`, utilisateurs, groupes, profils et droits, habilitations, contexte de
requête, **Row-Level Security**, authentification locale, LDAP et synchronisation, règles
d'affectation d'habilitations, internationalisation, configuration héritée par entité.

_Terminé quand_ : les six tests d'isolation de [la section 9](03-entites-droits-securite.md) passent
sur une vraie base PostgreSQL.

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

### J3 — Le ticket, de bout en bout `M01` `M02` `M05`

Ticket avec tous ses champs et statuts, acteurs, suivis, tâches, solution, validations, documents,
coûts, historique, gabarits, corbeille. Interface technicien : liste dense, formulaire, chronologie.
Notifications élémentaires. Recherche multi-critères et recherches sauvegardées `M13`.

C'est ici que se dessine la **surface publique de `@tick/plugin-sdk`** : chaque hook, chaque
emplacement d'interface et chaque extension de champ est extrait d'un besoin constaté sur le
ticket, jamais imaginé. Le plugin de référence `exemple-bonjour` naît avec elle et sert de test
d'intégration permanent du contrat.

_Terminé quand_ : une équipe peut réellement traiter des tickets, et un plugin peut ajouter un
onglet, un champ et une règle sans toucher au cœur.

### J4 — Niveaux de service et règles `M03` `M04`

Calendriers ouvrés et jours fériés, SLA et OLA, calcul et recalcul des échéances, suspension,
niveaux d'escalade. Moteur de règles générique, règles à la création et à la mise à jour,
dictionnaires, simulateur. Matrice urgence × impact par entité.

### J5 — Communication `M07` `M08` `M11`

Notifications complètes : événements, modèles multilingues, destinataires calculés, file d'attente
avec rejeu, préférences utilisateur. Collecteur de courriel entrant et réponse par courriel.
Enquêtes de satisfaction.

### J6 — Self-service `M09` `M10` `M12`

Interface simplifiée, base de connaissances et FAQ publique, constructeur de formulaires avec
logique conditionnelle et destinations, catalogue de services.

### J7 — Problèmes et changements `M01`

Les deux objets restants sur le socle ITIL commun, liens entre objets, promotion d'un ticket vers
un problème puis un changement.

### J8 — Pilotage `M06` `M14` `M15`

Planning et calendrier des tâches, statistiques et tableaux de bord composables, exports CSV et
PDF, actions massives, tickets récurrents.

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
