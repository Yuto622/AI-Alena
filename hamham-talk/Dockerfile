FROM node:20-slim
WORKDIR /app
COPY package.json hamham.mjs server.mjs ./
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.mjs"]
