# Pécule — image de production (Node 24), publiée à chaque version (.github/workflows/publication.yml) pour amd64 et
# arm64. Trois étapes : le build complet, sur l'architecture de la machine qui construit (le résultat est du
# JavaScript, le même partout) ; les dépendances d'exécution, sur l'architecture visée ; l'image, qui ne garde que
# le serveur bundlé (dist/), ces dépendances et les commandes de l'installation.
FROM --platform=$BUILDPLATFORM node:24-slim AS build
WORKDIR /app
RUN npm install -g pnpm@12
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# Seulement ce que le serveur charge en service (`dependencies`) : ce qui ne sert qu'à construire l'écran — React,
# les icônes, les graphiques — est dans `devDependencies` et reste hors de l'image.
FROM node:24-slim AS deps
WORKDIR /app
RUN npm install -g pnpm@12
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile --prod \
  # Jamais chargés par le serveur : les déclarations de types et les cartes des sources des paquets (la moitié de leur poids).
  && find node_modules \( -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' -o -name '*.map' \) -type f -delete

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=build /app/package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Commandes de l'installation, à lancer par `docker compose exec pecule node scripts/…` : le lien du premier
# démarrage, le diagnostic, l'import d'un dossier de documents, et les réglages que l'installation garde elle-même
# (service « reglages » de compose.yaml).
COPY --from=build /app/scripts/setup.mjs /app/scripts/doctor.mjs /app/scripts/lien.mjs /app/scripts/importer.mjs ./scripts/
COPY --from=build /app/scripts/lib ./scripts/lib
COPY --from=build /app/src/lib/settings-file.ts ./src/lib/
# Sauvegardes écrites par le serveur (avant une migration, automatiques) : dans ce dossier, sur lequel compose.yaml
# monte le volume « pecule-sauvegardes » — jamais ailleurs dans le conteneur, qui disparaît à chaque mise à jour.
# Réglages gardés par l'installation (secrets tirés au premier démarrage) : volume « pecule-reglages ».
ENV BACKUP_DIR=/app/data/sauvegardes SETTINGS_DIR=/app/data/reglages
# Créés ici pour qu'un volume neuf monté dessus appartienne au compte du serveur.
RUN mkdir -p data/sauvegardes data/reglages data/base-init && chown -R node:node data
USER node
EXPOSE 3000
# Pendant le démarrage, la santé est relue toutes les trois secondes : « docker compose up -d --wait » rend la main
# dès que Pécule est prêt.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --start-interval=3s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/server.mjs"]
