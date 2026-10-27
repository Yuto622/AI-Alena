// 管理画面と予約実行のサーバー（Cloud Run 用。アクセスがないときは0台まで縮んで課金されない）
import crypto from "crypto";
import fs from "fs";
import path from "path";
import express from "express";
import { APP_DIR, paths, seedDataDir } from "./lib/config.mjs";
import { listArticles, readArticleSource, writeArticleSource, articlePath } from "./lib/article.mjs";
import { runNote } from "./lib/publisher.mjs";
import { tick, publishArticle, generateNext, nextFreeSlot } from "./lib/scheduler.mjs";
import { dashboard } from "./lib/insights.mjs";
import {
  getSettings, saveSettings, getPublished, getSales, upsertSales, getTopics, saveTopics,
} from "./lib/store.mjs";

seedDataDir();
const app = express();
app.use(express.json({ limit: "2mb" }));

const safeEqual = (a, b) => {
  const x = Buffer.from(a || ""), y = Buffer.from(b || "");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

app.get("/healthz", (_req, res) => res.send("ok"));

// Cloud Scheduler からの呼び出し（ヘッダーの合言葉で確認）
app.post("/cron/tick", async (req, res) => {
  if (!process.env.CRON_TOKEN || !safeEqual(req.get("x-cron-token"), process.env.CRON_TOKEN)) {
    return res.status(401).end();
  }
  res.json(await tick());
});

// ここから下は管理画面（Basic 認証）
app.use((req, res, next) => {
  const [user, pass] = Buffer.from((req.get("authorization") || "").replace(/^Basic /, ""), "base64")
    .toString().split(":");
  if (process.env.ADMIN_PASSWORD && user === "admin" && safeEqual(pass, process.env.ADMIN_PASSWORD)) return next();
  res.set("WWW-Authenticate", 'Basic realm="note-writer"').status(401).send("認証が必要です");
});

app.use(express.static(path.join(APP_DIR, "admin")));
app.use("/shots", express.static(paths.out));

const wrap = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (e) {
    res.status(400).json({ error: e.message, log: e.log, shots: e.shots && path.relative(paths.out, e.shots) });
  }
};

app.get("/api/dashboard", wrap(() => dashboard()));

app.get("/api/articles", wrap(() => listArticles()));
app.get("/api/articles/:name", wrap((req) => readArticleSource(req.params.name)));
app.put("/api/articles/:name", wrap((req) => {
  const { meta, body } = req.body;
  writeArticleSource(req.params.name, meta, body);
  return { ok: true };
}));
app.post("/api/articles", wrap((req) => {
  const slot = nextFreeSlot();
  const name = `${slot.toISOString().slice(0, 10)}-${Date.now().toString(36)}.md`;
  writeArticleSource(name, { title: req.body.title || "新しい記事", price: 500, status: "draft", publish_at: slot.toISOString() }, "本文\n");
  return { name };
}));
app.delete("/api/articles/:name", wrap((req) => {
  fs.unlinkSync(articlePath(req.params.name));
  return { ok: true };
}));
app.post("/api/articles/:name/run", wrap(async (req) => {
  const r = await publishArticle(req.params.name, { mode: req.body.mode || "publish", force: !!req.body.force });
  return { ...r, shots: path.relative(paths.out, r.shots) };
}));

app.post("/api/check-login", wrap(async (req) => {
  const r = await runNote({ account: req.body.account || "default", mode: "check" });
  return { ...r, shots: path.relative(paths.out, r.shots) };
}));
app.post("/api/tick", wrap(() => tick()));
app.post("/api/generate", wrap((req) => generateNext(req.body.topicId)));

app.get("/api/topics", wrap(() => getTopics()));
app.put("/api/topics", wrap((req) => {
  saveTopics(req.body);
  return { ok: true };
}));

app.get("/api/sales", wrap(() => getSales()));
app.post("/api/sales", wrap((req) => {
  upsertSales(req.body);
  return { ok: true };
}));

app.get("/api/published", wrap(() => getPublished().slice().reverse()));
app.get("/api/runs", wrap(() => {
  if (!fs.existsSync(paths.out)) return [];
  return fs.readdirSync(paths.out).sort().reverse().slice(0, 20).map((dir) => ({
    dir,
    shots: fs.readdirSync(path.join(paths.out, dir)).sort(),
  }));
}));

app.get("/api/settings", wrap(() => ({
  ...getSettings(),
  profile: fs.existsSync(paths.profile) ? fs.readFileSync(paths.profile, "utf8") : "",
})));
app.put("/api/settings", wrap((req) => {
  const { profile, ...settings } = req.body;
  if (typeof profile === "string") fs.writeFileSync(paths.profile, profile);
  saveSettings(settings);
  return { ok: true };
}));

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`✅ note-writer listening on ${port}`));
