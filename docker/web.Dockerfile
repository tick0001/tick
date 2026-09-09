# syntax=docker/dockerfile:1

# Image de l'interface.
#
# Le résultat est un paquet de fichiers statiques : l'interface est une
# application de page unique, sans rendu serveur. Nginx la sert et relaie `/api`
# vers le conteneur de l'API.
#
# Ce relais n'est pas une commodité de déploiement mais une **condition de
# fonctionnement** : la session est un cookie `httpOnly` et `SameSite`, et il ne
# voyagerait pas si l'interface et l'API répondaient sur deux domaines
# différents. Le même chemin en développement — le proxy de Vite — et en
# production garantit qu'on ne découvre pas le problème à la mise en ligne.

FROM node:26-alpine AS base
RUN corepack enable
WORKDIR /app

# --- Dépendances -------------------------------------------------------------
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/i18n/package.json packages/i18n/
COPY packages/plugin-sdk/package.json packages/plugin-sdk/
COPY plugins/exemple-bonjour/package.json plugins/exemple-bonjour/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && pnpm install --frozen-lockfile

# --- Construction ------------------------------------------------------------
FROM deps AS build
COPY . .
RUN pnpm --filter @tick/web... build

# --- Exécution ---------------------------------------------------------------
FROM nginx:1.31-alpine AS runtime

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --spider -q http://127.0.0.1/ || exit 1
