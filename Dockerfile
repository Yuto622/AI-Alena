FROM node:20 AS builder

WORKDIR /app

# 依存関係インストール
COPY package*.json ./
RUN npm ci

# ソースコピー
COPY . .

# Vite ビルド（dist/ を作る）
RUN npm run build

# ---- 本番ステージ ----
FROM node:20-slim

WORKDIR /app

# server.mjs と package.json だけコピー
COPY package*.json ./
COPY server.mjs ./server.mjs
# dist もコピー
COPY --from=builder /app/dist ./dist

# 本番用の依存関係だけ入れる
RUN npm install --only=production

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.mjs"]
