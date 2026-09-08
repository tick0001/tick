# Architecture

## Organisation du dépôt

Monorepo **pnpm workspaces + Turborepo**. Le découpage n'est pas cosmétique : il matérialise la
frontière entre ce qui est public (le SDK de plugins, les contrats) et ce qui est interne, et
c'est cette frontière qui rendra les montées de version supportables.

```
apps/
  api/                  API NestJS
  web/                  Application React (Vite)
packages/
  contracts/            Types et schémas Zod partagés API ↔ web ↔ plugins
  db/                   Schéma Drizzle du cœur, migrations, helpers RLS
  plugin-sdk/           @tick/plugin-sdk — surface publique offerte aux plugins
  ui/                   @tick/ui — design system, exposé aux plugins
  i18n/                 Ressources de traduction et outillage
plugins/
  exemple-bonjour/      Plugin de référence, sert aussi de test d'intégration
docker/                 Compose, Dockerfiles, initialisation Postgres
docs/
```

### Numérotation des versions

Une seule version désigne le produit, et elle vit dans **`apps/api/package.json`**. Ce choix est
dicté par l'exécution : `pnpm deploy` produit une arborescence dont ce manifeste est la racine,
donc c'est le seul que l'API puisse lire à l'exécution — et `/api/health` le lit, pour qu'un
exploitant sache ce qui tourne chez lui.

Les workflows de publication refusent de s'exécuter si l'étiquette et ce manifeste divergent :
une image ou une archive qui annonce une version qui n'est pas la sienne est pire qu'une
publication qui échoue.

Les autres paquets internes restent en `0.0.0` : ils ne sont jamais publiés séparément, et leur
donner un numéro laisserait croire l'inverse. **`@tick/plugin-sdk` fait exception** et suit son
propre semver — c'est un contrat public, dont les ruptures ne suivent pas le rythme du produit.
Voir le [SDK de plugins](15-sdk-plugins.md).

## Backend — NestJS

### Découpage en modules

Un module NestJS par domaine fonctionnel : `auth`, `entities`, `users`, `groups`, `profiles`,
`itil` (ticket, problème, changement et leurs satellites), `slm`, `rules`, `templates`,
`notifications`, `mail`, `kb`, `forms`, `satisfaction`, `search`, `dashboard`, `plugins`, `cron`.

Pas de CQRS ni d'event sourcing : de la complexité sans contrepartie ici. Des services applicatifs
et des dépôts de données, plus **deux bus distincts** décrits ci-dessous.

### Hooks synchrones et événements asynchrones

C'est la distinction qui fait ou défait un système de plugins. Les deux mécanismes existent et ne
se remplacent pas :

|                          | Hooks                                                           | Événements                                                 |
| ------------------------ | --------------------------------------------------------------- | ---------------------------------------------------------- |
| Exécution                | Synchrone, dans la transaction                                  | Asynchrone, après commit                                   |
| Peut modifier la donnée  | Oui                                                             | Non                                                        |
| Peut annuler l'opération | Oui, en levant une exception                                    | Non                                                        |
| Exemples                 | `ticket.beforeCreate`, `ticket.beforeUpdate`, `ticket.validate` | `ticket.created`, `ticket.statusChanged`, `followup.added` |
| Usage type               | Règles métier, validation, valeurs calculées                    | Notifications, statistiques, webhooks, synchronisations    |

Un hook lent ou en erreur dégrade l'écriture, donc il est borné par un délai maximal et le plugin
fautif est désactivé après répétition. Un événement est publié dans BullMQ après le commit : il
peut être réessayé sans risque de double écriture métier.

### Contexte de requête

Chaque requête HTTP ouvre un contexte propagé par `AsyncLocalStorage` :
utilisateur, profil actif, **entité active**, indicateur « et ses sous-entités », langue,
identifiant de corrélation.

Ce contexte n'est pas une commodité de confort : il est injecté dans la transaction PostgreSQL
sous forme de paramètres de session, et c'est lui qui alimente les politiques RLS
(voir [Entités, droits et sécurité](03-entites-droits-securite.md)). Aucune requête métier ne
filtre l'entité à la main.

### Files d'attente et tâches planifiées

**BullMQ sur Redis** pour : envoi des notifications, collecteur de courriel, escalades SLA,
génération des tickets récurrents, enquêtes de satisfaction, synchronisation LDAP, et toute tâche
déclarée par un plugin.

Le collecteur de courriel relève toutes les deux minutes, les enquêtes de satisfaction partent par
un balayage au quart d'heure : dans les deux cas la file ne fait que cadencer, l'état vit en base.

L'escalade illustre le principe retenu pour toutes les tâches périodiques : **l'état est en base,
la file ne fait que cadencer**. Le balayage lit `tickets.escalation_at` sur un index dédié, et la
trace des niveaux déjà joués vit dans `ticket_escalations`. Un vidage de Redis ne perd donc aucune
escalade, et plusieurs instances de l'API peuvent tourner sans se marcher dessus. Une interface d'administration expose l'état des
files, les échecs et le rejeu — l'équivalent lisible des tâches automatiques de GLPI.

### Recherche

Moteur de critères traduit en SQL via Drizzle : la définition de chaque champ interrogeable
(table, colonne, type, opérateurs autorisés, jointure nécessaire) vit dans un registre, que les
plugins alimentent pour rendre leurs propres champs cherchables. Recherche plein texte par
`tsvector` généré et index GIN, configuration `french` et `english` selon la langue du contenu.

Point d'extension identifié mais non implémenté : un index externe (Meilisearch ou OpenSearch)
derrière la même interface, si le volume l'impose un jour.

### Fichiers

Abstraction de stockage avec implémentation disque local par défaut, et interface compatible S3
pour plus tard. Contrôle d'accès systématique à la lecture : un document est servi par l'API,
jamais par un chemin statique devinable.

### Authentification

Session par cookie `httpOnly` contenant un jeton court, et jeton de rafraîchissement en base pour
permettre la révocation. **LDAP / Active Directory** avec import et synchronisation des
utilisateurs, plus règles d'affectation d'habilitations (groupe annuaire → profil + entité). Le
fournisseur d'identité est une abstraction : ajouter OIDC ou SAML plus tard n'imposera pas de
refonte.

## Frontend — React

Vite, React Router, TanStack Query pour l'état serveur, TanStack Table pour les listes denses,
react-hook-form et Zod pour les formulaires, Tailwind et shadcn/ui pour le rendu, i18next.

Deux interfaces distinctes partageant le même socle : **standard** (techniciens, dense,
orientée productivité clavier) et **self-service** (demandeurs, épurée).

### Points d'extension côté interface

Le front expose des **emplacements** nommés que les plugins remplissent : onglets d'un objet ITIL,
entrées de menu, colonnes de liste, widgets de tableau de bord, actions massives, blocs de
formulaire, actions de barre d'outils.

Les plugins livrent un module ESM pré-construit, chargé à l'exécution depuis l'API par un
`import()` ordinaire. Installer un plugin ne nécessite donc pas de reconstruire l'application.

**Le contrat d'affichage est un `render` sur un élément du DOM, pas un composant React.** C'est le
choix qui rend le reste simple. Rendre des composants React exigerait que l'hôte et le plugin
partagent la même instance de React, ce qui impose une carte d'import ou des variables globales,
se règle différemment en développement et en production, et casse silencieusement dès qu'une
version diverge. Un `render` sur un élément supprime le problème : le bundle du plugin est un
module autonome, sans aucune dépendance partagée. Le coût est réel — un plugin qui veut React doit
l'embarquer — et sera réévalué quand on saura ce que les extensions d'interface demandent vraiment.

## Décisions techniques argumentées

**PostgreSQL et rien d'autre pour les données.** `ltree` pour l'arbre des entités et des
catégories (un opérateur indexé remplace les caches d'ancêtres et de descendants de GLPI),
`tsvector` pour le plein texte, `jsonb` pour les champs additionnels de plugins, et surtout
**Row-Level Security** comme filet de sécurité de l'isolation entre entités.

**Drizzle plutôt que Prisma.** Trois raisons, toutes liées au projet : le schéma se déclare par
module, donc un plugin embarque ses tables sans toucher au cœur ; le contrôle explicite des
transactions rend trivial le `SET LOCAL` qui alimente le RLS ; et le SQL généré reste lisible,
ce qui compte pour un moteur de recherche dynamique.

**Redis obligatoire.** Files d'attente fiables, verrous distribués et cache de résolution des
droits. Un `setTimeout` en mémoire ne survit pas à un redémarrage, or une escalade SLA manquée
est un incident métier.

**Pagination par curseur** sur toutes les listes ITIL dès le départ. Le `OFFSET` s'effondre au-delà
de quelques centaines de milliers de lignes, et c'est précisément la volumétrie visée.

**TypeScript 6, pas 7.** Le compilateur natif TypeScript 7 fonctionne, mais `typescript-eslint`
ne le prend pas encore en charge : l'adopter reviendrait à renoncer aux règles typées
(`no-floating-promises` en tête), qui attrapent de vrais bugs. Le gain de vitesse de compilation
est sans objet à cette taille de code. À rebasculer dès que le support arrive.

**Pas de CLI NestJS.** `nest build` n'est qu'une enveloppe autour de `tsc`, et il traîne toute la
chaîne `@angular-devkit`, actuellement cassée sous Node 22. La construction se fait donc par `tsc`
et le rechargement à chaud par `node --watch`, ce qui retire une couche d'outillage opaque.

**Pas de lanceur fondé sur esbuild pour le code NestJS.** `tsx`, `esbuild-register` et leurs
équivalents n'émettent pas `emitDecoratorMetadata`. NestJS n'y voit alors aucune dépendance à
injecter, construit les services avec des arguments manquants, et échoue bien plus loin sur un
`undefined` sans rapport apparent avec la cause. Tout script applicatif s'exécute donc compilé.
Les tests, eux, assemblent les services à la main et n'ont pas ce besoin.

**Seule l API consomme la file d événements.** Tout processus qui démarre le conteneur applicatif
démarrerait sinon un consommateur : un script en ligne de commande dépilerait des événements
destinés à l API et les acquitterait sans les traiter, sans laisser de trace puisque le travail
est bien consommé. La consommation est donc déclarée explicitement, et refusée par défaut aux
outils.

**Le nom d'une entité ne se joint pas sous Row-Level Security.** Un objet de configuration
hérité vit sur un ancêtre, hors du périmètre descendant : joindre `entities` fait disparaître la
ligne entière, sans erreur ni trace. Le nom est donc résolu à part, avec le rôle propriétaire, une
fois la visibilité de l'objet déjà tranchée par sa propre politique. Même forme que la résolution
de configuration héritée décrite dans [03](03-entites-droits-securite.md).

**Un contexte reconstitué plutôt qu'une écriture directe.** Le collecteur de courriel crée ses
tickets en passant par les services applicatifs, sous un contexte composé de l'expéditeur, du profil
déclaré par la boîte et de l'entité de celle-ci. Écrire directement avec le rôle propriétaire aurait
été plus court, et aurait privé les tickets nés d'un courriel de leurs règles, de leurs engagements
et de leur historique.

**La même comparaison des deux côtés.** Les conditions d'affichage d'un formulaire sont évaluées
par l'interface pour montrer un champ, et par le serveur pour exiger une réponse. Les deux appellent
la même fonction `matchesOperator`, extraite du moteur de règles : deux implémentations finiraient
par ne plus répondre pareil au même opérateur, et une question cachée d'un côté mais exigée de
l'autre produirait un refus impossible à comprendre.

**Tests dès le socle.** Le moteur de règles, le calcul SLA sur calendrier ouvré et la résolution
des droits sont trois domaines où un bug est silencieux et coûteux. Vitest pour l'unitaire,
Testcontainers pour l'intégration sur une vraie base PostgreSQL (le RLS ne se teste pas en SQLite),
Playwright pour les parcours critiques.

## Environnement de développement

`docker compose up` fournit PostgreSQL, Redis et Mailpit. L'API et le front tournent en local avec
rechargement à chaud. Un jeu de données de démonstration (arbre d'entités, profils, techniciens,
catégories, SLA, tickets) est généré par une commande dédiée — indispensable pour éprouver le
modèle d'entités autrement qu'en théorie.
