FROM node:20-slim

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml* ./
RUN pnpm install

COPY tsconfig.json ./
COPY src ./src
RUN pnpm exec tsc

EXPOSE 1999

CMD ["node", "dist/ws-server.js"]
