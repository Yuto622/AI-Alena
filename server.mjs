// server.mjs
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const port = process.env.PORT || 8080;

// __dirname 相当（ESM用）
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Vite が出力した dist を静的配信
const distPath = path.join(__dirname, "dist");
app.use(express.static(distPath));

// SPA 用にワイルドカードルートで index.html を返す
app.get("*", (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

app.listen(port, () => {
  console.log(`✅ Server listening on port ${port}`);
});
