FROM node:20

WORKDIR /app

# 依存関係インストール
COPY package*.json ./
RUN npm install --only=production

# ソースコピー
COPY . .

ENV PORT=8080
CMD ["npm", "start"]
