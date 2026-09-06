# Tick&

Outil de ticketing ITSM open source, couvrant l'intégralité du périmètre **Assistance** de GLPI 11
(tickets, problèmes, changements, SLM, règles, notifications, base de connaissances, formulaires,
satisfaction, self-service), sans la gestion de parc.

> Nom commercial : **Tick&** — identifiant technique partout ailleurs : `tick`
> (paquets `@tick/*`, images Docker, schémas SQL, préfixes d'API).

## Choix structurants

| Sujet              | Décision                                                                 |
| ------------------ | ------------------------------------------------------------------------ |
| Backend            | NestJS (TypeScript)                                                      |
| Base de données    | PostgreSQL — `ltree`, `tsvector`, Row-Level Security                     |
| Accès données      | Drizzle ORM, schéma découpé par module                                   |
| Frontend           | React + Vite, Tailwind, shadcn/ui, TanStack Query & Table                |
| Files d'attente    | BullMQ + Redis                                                           |
| Plugins            | In-process, manifeste versionné, SDK semver, schéma SQL dédié par plugin |
| Multi-organisation | Entités hiérarchiques façon GLPI + RLS PostgreSQL                        |
| Déploiement        | Self-hosted mono-instance, Docker Compose                                |
| Authentification   | Locale + LDAP / Active Directory                                         |
| Langues            | Français et anglais dès le départ                                        |
| Échelle cible      | Quelques centaines de techniciens, 100 à 500 k tickets/an                |

## Démarrage

Prérequis : Node 22 ou plus, pnpm 11, Docker.

```bash
pnpm install
cp .env.example .env
pnpm services:up      # PostgreSQL, Redis, Mailpit, OpenLDAP
pnpm db:migrate       # schéma, déclencheurs, politiques RLS
pnpm db:seed          # jeu de démonstration
pnpm dev              # API sur :3000, interface sur :5173
```

Vérification : `curl http://localhost:3000/api/health`, ou ouvrir <http://localhost:5173>.

### Comptes de démonstration

Mot de passe commun : `tick`. Ils existent pour rendre le modèle d'entités tangible — chacun
illustre un cas que le modèle doit savoir traiter.

| Compte      | Habilitations                                       | Ce qu'il démontre                                             |
| ----------- | --------------------------------------------------- | ------------------------------------------------------------- |
| `admin`     | Administrateur sur Racine, récursif                 | Accès complet à l'arborescence                                |
| `sophie`    | Superviseur sur Filiale Nord, récursif              | Une branche entière, sans voir le Siège                       |
| `thomas`    | Technicien sur Site A, non récursif                 | Une seule entité, sans sa descendance                         |
| `lea`       | Technicien sur Site B **et** Self-service sur Siège | Le cumul : les droits suivent le profil actif, jamais l'union |
| `demandeur` | Self-service sur DSI                                | L'interface simplifiée                                        |

| Commande              | Effet                                       |
| --------------------- | ------------------------------------------- |
| `pnpm build`          | Construit tous les paquets                  |
| `pnpm test`           | Exécute les tests                           |
| `pnpm lint`           | ESLint avec règles typées                   |
| `pnpm typecheck`      | Vérification de types sans émission         |
| `pnpm format`         | Applique Prettier                           |
| `pnpm db:reset`       | Repart d'une base vierge, migrée et amorcée |
| `pnpm services:reset` | Réinitialise les services et leurs volumes  |

### Ce que l'application sait faire aujourd'hui

Jalons J0 à J3 livrés : entités hiérarchiques et Row-Level Security, authentification locale et
LDAP, substrat de plugins, et le **ticket de bout en bout** — cycle de vie complet, acteurs,
chronologie unifiée, gabarits, recherche multi-critères avec recherches sauvegardées, notifications
par courriel et pièces jointes.

Après `pnpm dev`, ouvrir <http://localhost:5173> et se connecter avec `sophie` / `tick` : c'est le
compte qui voit le plus de choses sans être administrateur. Les courriels partent vers Mailpit,
consultable sur <http://localhost:8025>.

### Plugins

Le plugin de référence `plugins/exemple-bonjour` exerce chaque point d'extension et sert de test
d'intégration permanent. Après `pnpm build`, il apparaît dans l'administration ; on peut l'installer
et l'activer par l'API :

```bash
curl -X POST http://localhost:3000/api/plugins/exemple-bonjour/install
curl -X POST http://localhost:3000/api/plugins/exemple-bonjour/activate
```

Il normalise alors les noms d'entités à la création, refuse le nom « interdit », journalise les
créations dans son propre schéma PostgreSQL, et ajoute deux éléments à l'interface. Le désinstaller
ne laisse rien derrière lui.

## Documentation

| Document                                                                | Contenu                                                       |
| ----------------------------------------------------------------------- | ------------------------------------------------------------- |
| [Périmètre fonctionnel](docs/01-perimetre-fonctionnel.md)               | Les 17 modules à couvrir, au détail près                      |
| [Architecture](docs/02-architecture.md)                                 | Monorepo, backend, frontend, décisions techniques argumentées |
| [Entités, droits et sécurité](docs/03-entites-droits-securite.md)       | Le modèle multi-organisation et son application par RLS       |
| [Système de plugins](docs/04-plugins.md)                                | Manifeste, SDK, hooks, cycle de vie, isolation                |
| [Modèle de données](docs/05-modele-de-donnees.md)                       | Tables du cœur et conventions                                 |
| [Niveaux de service et règles](docs/07-niveaux-de-service-et-regles.md) | Temps ouvré, engagements, escalade, moteur de règles          |
| [Communication](docs/08-communication.md)                               | Notifications, courriel entrant, enquêtes de satisfaction     |
| [Self-service](docs/09-self-service.md)                                 | Base de connaissances, formulaires, interface demandeur       |
| [Feuille de route](docs/06-feuille-de-route.md)                         | Dix jalons, du socle à l'ouverture publique                   |

## Conventions

Commits en français, courts, préfixés d'un gitmoji. Exemple : `:sparkles: ajoute l'arbre des entités`.
