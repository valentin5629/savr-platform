FROM node:22-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    fonts-liberation \
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
COPY package.json ./
# Toutes les dépendances, devDependencies incluses : `tsc` (typescript) vit là et
# `npm run build` en a besoin. Un `--omit=dev` ici casse le build ("tsc: not found").
RUN npm install

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

EXPOSE 3001
CMD ["node", "dist/server.js"]
