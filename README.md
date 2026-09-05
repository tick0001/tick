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
pnpm services:up      # PostgreSQL, Redis, Mailpit
pnpm dev              # API sur :3000, interface sur :5173
```

Vérification : `curl http://localhost:3000/api/health`, ou ouvrir <http://localhost:5173>.

| Commande              | Effet                                      |
| --------------------- | ------------------------------------------ |
| `pnpm build`          | Construit tous les paquets                 |
| `pnpm test`           | Exécute les tests                          |
| `pnpm lint`           | ESLint avec règles typées                  |
| `pnpm typecheck`      | Vérification de types sans émission        |
| `pnpm format`         | Applique Prettier                          |
| `pnpm services:reset` | Réinitialise les services et leurs volumes |

## Documentation

| Document                                                          | Contenu                                                       |
| ----------------------------------------------------------------- | ------------------------------------------------------------- |
| [Périmètre fonctionnel](docs/01-perimetre-fonctionnel.md)         | Les 17 modules à couvrir, au détail près                      |
| [Architecture](docs/02-architecture.md)                           | Monorepo, backend, frontend, décisions techniques argumentées |
| [Entités, droits et sécurité](docs/03-entites-droits-securite.md) | Le modèle multi-organisation et son application par RLS       |
| [Système de plugins](docs/04-plugins.md)                          | Manifeste, SDK, hooks, cycle de vie, isolation                |
| [Modèle de données](docs/05-modele-de-donnees.md)                 | Tables du cœur et conventions                                 |
| [Feuille de route](docs/06-feuille-de-route.md)                   | Dix jalons, du socle à l'ouverture publique                   |

## Conventions

Commits en français, courts, préfixés d'un gitmoji. Exemple : `:sparkles: ajoute l'arbre des entités`.
