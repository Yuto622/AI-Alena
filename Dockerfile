# ---- build stage ----
FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime stage (Cloud Run) ----
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.mjs ./server.mjs
COPY server ./server
COPY content ./content
COPY --from=builder /app/dist ./dist
# 永続データは Cloud Run では揮発するため、本番は DATA_DIR をマウント or DB へ差し替える
ENV DATA_DIR=/app/data
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.mjs"]
