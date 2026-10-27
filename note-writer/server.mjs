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
import { listCredentials, setCredentials, setSessionCookies } from "./lib/credentials.mjs";
import { getApps, saveApps, recordClick } from "./lib/apps.mjs";
import { appPerformance, getLearnings, updateLearnings } from "./lib/learning.mjs";
import { renderThumbnail } from "./lib/thumbnail.mjs";
import { createRequire } from "module";
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

// 記事の中のアプリのリンク。クリックを数えてからアプリのページへ送る（誰でも開ける）
app.get("/go/:app", (req, res) => {
  const target = getApps().find((a) => a.id === req.params.app);
  if (!target) return res.status(404).send("not found");
  try {
    recordClick(target.id, req.query.a);
  } catch (e) {
    console.error(`クリックの記録に失敗：${e.message}`);
  }
  res.redirect(302, target.url);
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

app.get("/api/accounts", wrap(() => listCredentials()));
app.put("/api/accounts/:account", wrap((req) => {
  const email = String(req.body.email || "").trim();
  if (!email) throw new Error("メールアドレスを入力してください");
  setCredentials(req.params.account, { email, password: req.body.password || "" });
  return { ok: true };
}));

app.put("/api/accounts/:account/cookies", wrap((req) => {
  const count = setSessionCookies(req.params.account, req.body.cookie || "");
  return { ok: true, count };
}));

app.get("/api/apps", wrap(() => ({ apps: getApps(), performance: appPerformance(), learnings: getLearnings() })));
app.post("/api/learnings", wrap(() => updateLearnings(new Date(), { force: true })));
app.put("/api/apps", wrap((req) => {
  saveApps(req.body);
  return { ok: true };
}));

// 見出し画像の見本（note には載せない）
app.get("/api/articles/:name/thumbnail.png", async (req, res) => {
  try {
    const { meta } = readArticleSource(req.params.name);
    const { chromium } = createRequire(import.meta.url)("playwright");
    const browser = await chromium.launch();
    try {
      const png = await renderThumbnail(browser, {
        title: meta.title, tags: Array.isArray(meta.tags) ? meta.tags : [meta.tags].filter(Boolean),
        price: Number(meta.price || 0), footer: getSettings().thumbnailFooter,
      });
      res.type("png").send(png);
    } finally {
      await browser.close();
    }
  } catch (e) {
    res.status(400).send(e.message);
  }
});

// 全記事の最後に付ける案内（アプリの URL など）。空で保存すると付けなくなる
const defaultCta = path.join(paths.cta, "default.md");
app.get("/api/cta", wrap(() => ({ text: fs.existsSync(defaultCta) ? fs.readFileSync(defaultCta, "utf8") : "" })));
app.put("/api/cta", wrap((req) => {
  const text = String(req.body.text || "").trim();
  if (!text) {
    fs.rmSync(defaultCta, { force: true });
    return { ok: true };
  }
  if (text.includes("{{")) throw new Error("{{ }} の部分を実際の内容に書き換えてください");
  fs.mkdirSync(paths.cta, { recursive: true });
  fs.writeFileSync(defaultCta, text + "\n");
  return { ok: true };
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
