FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /app
ENV TZ=Asia/Tokyo NODE_ENV=production CW_DATA_DIR=/app/data
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
# 非 root ユーザーで実行。data はボリュームで永続化
RUN mkdir -p /app/data && chown -R pwuser:pwuser /app/data
USER pwuser
ENV ADMIN_HOST=0.0.0.0 PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/cli.js", "serve"]
