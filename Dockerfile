FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

COPY server ./server
COPY public ./public

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server/index.js"]
