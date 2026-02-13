FROM node:20-slim

# sqlite3 native module links against libsqlite3 — must be present at runtime
RUN apt-get update && apt-get install -y --no-install-recommends libsqlite3-0 && rm -rf /var/lib/apt/lists/*

EXPOSE 3000

WORKDIR /app

# Installer toutes les dépendances (y compris devDependencies) pour le build
COPY package.json package-lock.json* ./

RUN npm ci && npm cache clean --force

# Copier le code source
COPY . .

# Faire le build (nécessite les devDependencies)
RUN npm run build

# Supprimer les devDependencies après le build pour réduire la taille
RUN npm prune --omit=dev && npm cache clean --force

ENV NODE_ENV=production

CMD ["npm", "run", "docker-start"]
