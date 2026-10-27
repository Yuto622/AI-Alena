# 画像を小さく保つため、Playwright 公式イメージではなく slim に headless shell だけ入れる
FROM node:22-bookworm-slim

WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    NODE_ENV=production \
    PORT=8080

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
 && npx playwright install --with-deps --only-shell chromium \
 && rm -rf /var/lib/apt/lists/* /root/.npm

COPY . .
EXPOSE 8080
CMD ["node", "server.mjs"]
