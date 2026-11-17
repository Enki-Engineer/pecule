# Pécule — image de production (Node 24), publiée à chaque version (.github/workflows/publication.yml) pour amd64 et
# arm64. Trois étapes : le build complet, sur l'architecture de la machine qui construit (le résultat est du
# JavaScript, le même partout) ; les dépendances d'exécution, sur l'architecture visée ; l'image, qui ne garde que
# le serveur bundlé (dist/) et ces dépendances.
FROM --platform=$BUILDPLATFORM node:24-slim AS build
WORKDIR /app
RUN npm install -g pnpm@12
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24-slim AS deps
WORKDIR /app
RUN npm install -g pnpm@12
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile --prod

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=build /app/package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Sauvegardes écrites par le serveur avant une migration (volume « pecule-sauvegardes » de compose.yaml).
RUN mkdir -p data/sauvegardes && chown -R node:node data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/server.mjs"]
