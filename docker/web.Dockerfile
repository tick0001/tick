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

# Node 22, et le majeur ne se monte pas tout seul.
#
# Deux raisons, dans cet ordre. C'est la version que l'integration continue
# installe et sur laquelle la suite de tests s'execute : une image batie sur un
# autre majeur ferait tourner en production un moteur que rien n'a exerce. Et
# Node 22 est en support long jusqu'en avril 2027, quand 26 est encore la
# version courante — ce n'est pas ce qu'on demande a une installation chez
# autrui.
#
# Le piege, au passage : Node ne distribue plus corepack depuis la 25. Monter
# ce majeur exige donc d'installer pnpm autrement, et de monter aussi
# `node-version` dans les workflows et les prerequis annonces.
FROM node:22-alpine AS base
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
