FROM node:22-slim AS builder

# Le builder ne fait que compiler le TypeScript : pas de Chromium ici, donc aucune
# lib système à installer (elles vivent dans le stage runtime).
WORKDIR /app
COPY package.json package-lock.json ./
# `npm ci` : versions figées par package-lock.json. Échoue si le lockfile ne
# correspond plus à package.json → le régénérer depuis apps/pdf-renderer/ avec le
# npm de l'image : docker run --rm -v "$PWD":/w -w /w node:22-slim \
#   npm install --package-lock-only --ignore-scripts
# La CI (job `pdf-renderer-lockfile`) rejoue cette commande et échoue sur le moindre diff.
# Toutes les dépendances, devDependencies incluses : `tsc` (typescript) vit là et
# `npm run build` en a besoin. Un `--omit=dev` ici casse le build ("tsc: not found").
# `--ignore-scripts` : aucun script d'installation n'est exécuté. Seules des
# devDependencies en déclarent (esbuild via tsx, fsevents), inutiles au build.
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Le stage runtime copie ce node_modules tel quel : on retire les devDependencies
# APRÈS le build pour garder l'image finale légère.
RUN npm prune --omit=dev

FROM node:22-slim AS runtime

# fonts-dejavu-core : Liberation seule ne couvre pas U+2082 (indice ₂) — sans elle,
# « CO₂ » sort en tofu (□) dans l'attestation de don, le rapport de recyclage
# et la synthèse dashboard.
RUN apt-get update && apt-get install -y --no-install-recommends \
    fonts-liberation \
    fonts-dejavu-core \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
ENV PORT=3001

# Utilisateur non privilégié fourni par l'image node (uid 1000). /app reste à
# root, en lecture seule pour lui. @sparticuz/chromium décompresse son binaire
# dans /tmp (écriture autorisée à tous) ; --no-sandbox est déjà dans chromium.args.
USER node

EXPOSE 3001
CMD ["node", "dist/server.js"]
