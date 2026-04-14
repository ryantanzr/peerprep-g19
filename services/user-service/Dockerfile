FROM node:20-alpine AS deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-alpine AS runtime

RUN addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server.js index.js ./
COPY config ./config
COPY controller ./controller
COPY helper ./helper
COPY middleware ./middleware
COPY model ./model
COPY routes ./routes
COPY constants/ ./constants

USER appuser
EXPOSE 3001

CMD ["node", "server.js"]
