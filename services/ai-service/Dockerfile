FROM node:20-alpine

RUN addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

USER appuser
EXPOSE 5050

CMD ["node", "server.js"]
