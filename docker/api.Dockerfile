# syntax=docker/dockerfile:1

# Image de l'API.
#
# Construction en trois temps, et chaque coupure a une raison :
#
#  1. `deps` n'installe que d'après les manifestes. Tant qu'aucune dépendance ne
#     change, cette couche est réutilisée — c'est elle qui coûte le plus.
#  2. `build` compile le monorepo. Les paquets partagés sont bâtis avant l'API,
#     puisqu'elle les consomme sous leur forme distribuée.
#  3. `runtime` repart d'une image nue et ne reçoit que le nécessaire : ni
#     TypeScript, ni sources, ni outils de test.
#
# Les migrations ne sont **pas** jouées ici. Une image qui migre au démarrage
# migre autant de fois qu'on lance de conteneurs, et deux instances qui
# démarrent ensemble se marchent dessus. C'est le rôle du service `migrate` du
# compose, qui tourne une fois et rend la main.

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

# --- Dépendances -------------------------------------------------------------
FROM base AS deps

# Les manifestes seuls : copier les sources ici invaliderait l'installation à
# chaque retouche de code.
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
RUN pnpm --filter @tick/api... build

# `pnpm deploy` produit un dossier autonome : les dépendances d'espace de
# travail y sont recopiées plutôt que liées, ce qui rend l'arborescence
# transportable dans une image qui n'a plus le monorepo.
RUN pnpm --filter @tick/api --prod deploy --legacy /deploy

# `pnpm deploy` recopie tout le dossier du paquet, sources comprises. Une image
# de production n'a que faire des `.ts`, des tsconfig et de la configuration de
# test : ils ne servent à rien à l'exécution et donnent à lire ce qu'on n'a pas
# choisi de publier.
RUN rm -rf /deploy/src /deploy/tsconfig*.json /deploy/*.tsbuildinfo /deploy/vitest.*

# --- Exécution ---------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production

# L'utilisateur `node` existe déjà dans l'image officielle. Tourner en root
# donnerait au processus le droit d'écrire partout dans le conteneur, ce dont
# une API n'a aucun besoin.
COPY --from=build --chown=node:node /deploy /app

# Les pièces jointes vivent sur un volume : sans ce dossier créé au bon
# propriétaire, le premier téléversement échoue sur un refus d'écriture.
RUN mkdir -p /app/storage && chown node:node /app/storage

USER node
EXPOSE 3000

# La sonde interroge la route de santé, qui vérifie réellement PostgreSQL et
# Redis et répond 503 si l'une des deux manque. Un processus vivant mais sans
# base n'est pas un service en état de servir, et le conteneur doit le dire.
#
# C'est `r.ok` qui compte ici, donc le code HTTP : un 200 accompagné d'un
# « degraded » dans le corps laisserait le conteneur au vert.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--enable-source-maps", "dist/main.js"]
