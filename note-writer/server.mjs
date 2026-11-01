// 管理画面と予約実行のサーバー（Cloud Run 用。アクセスがないときは0台まで縮んで課金されない）
import crypto from "crypto";
import fs from "fs";
import path from "path";
import express from "express";
import { APP_DIR, DATA_DIR, paths, seedDataDir } from "./lib/config.mjs";
import { listArticles, readArticleSource, writeArticleSource, articlePath } from "./lib/article.mjs";
import { runNote } from "./lib/publisher.mjs";
import { tick, publishArticle, generateNext, nextFreeSlot } from "./lib/scheduler.mjs";
import { dashboard } from "./lib/insights.mjs";
import { listCredentials, setCredentials, setSessionCookies } from "./lib/credentials.mjs";
import { getApps, saveApps, recordClick } from "./lib/apps.mjs";
import { appPerformance, getLearnings, updateLearnings } from "./lib/learning.mjs";
import { renderThumbnail } from "./lib/thumbnail.mjs";
import { importStats, lastImport } from "./lib/stats.mjs";
import { getTrendLog, scoutTrends } from "./lib/trends.mjs";
import { hasXKeys, setXKeys, getXLog, xWhoAmI, composePost, postArticle } from "./lib/x.mjs";
import { hasThreadsToken, setThreadsToken, threadsWhoAmI, getThreadsLog } from "./lib/threads.mjs";
import { hasLineToken, setLineToken, lineWhoAmI, getLineLog, sendDigest } from "./lib/line.mjs";
import { blogBase, getBlogPosts, getBlogPost, renderPost, renderIndex, renderAbout, renderLinks, sitemap, robots, nextArticleForBlog, writeBlogPost, whyNoBlogCandidate, nextPostForBooks, addBooksToPost } from "./lib/blog.mjs";
import { IG_DIR, hasInstagramToken, setInstagramToken, instagramWhoAmI, getInstagramLog, postArticleToInstagram, composeCarousel, renderSlides, instagramHandle } from "./lib/instagram.mjs";
import { hasRakuten, setRakutenKeys } from "./lib/books.mjs";
import * as tiktok from "./lib/tiktok.mjs";
import { buildShort } from "./lib/youtube.mjs";
import { YT_DIR, hasYoutubeClient, hasYoutubeToken, setYoutubeClient, authUrl, finishAuth, youtubeWhoAmI, getYoutubeLog, previewShort, postArticleToYoutube } from "./lib/youtube.mjs";
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
  const toSite = req.query.to === "site" && target.siteUrl;
  try {
    recordClick(toSite ? `${target.id}:site` : target.id, req.query.a);
  } catch (e) {
    console.error(`クリックの記録に失敗：${e.message}`);
  }
  res.redirect(302, toSite ? target.siteUrl : target.url);
});

// ブログを会社のドメインで出しているとき：
// - そのドメインでは、ブログとクリック計測のリンクだけを出す（管理画面は出さない）
// - それ以外のアドレスで開かれたブログは、会社のドメインへ移す（同じ記事が2か所にあると検索で不利なため）
app.use((req, res, next) => {
  const domain = getSettings().blogDomain;
  if (!domain) return next();
  const host = (req.get("host") || "").toLowerCase();
  const isBlogPath = req.path === "/blog" || req.path.startsWith("/blog/") || req.path === "/links" || req.path === "/sitemap.xml" || req.path === "/robots.txt";
  if (host === domain) {
    if (req.path === "/") return res.redirect(301, "/blog");
    if (isBlogPath || req.path.startsWith("/go/") || req.path === "/healthz") return next();
    return res.status(404).send("not found");
  }
  if (isBlogPath) return res.redirect(301, `https://${domain}${req.originalUrl}`);
  next();
});

// ブログ（誰でも読める。検索エンジン向けの sitemap.xml と robots.txt も）
app.get("/blog", (req, res) => res.type("html").send(renderIndex({ tag: String(req.query.tag || "").slice(0, 50) })));
app.get("/blog/about", (_req, res) => res.type("html").send(renderAbout()));
app.get("/links", (_req, res) => res.type("html").send(renderLinks()));
app.get("/blog/:slug", (req, res) => {
  const post = getBlogPost(req.params.slug);
  if (!post) return res.status(404).type("html").send(renderIndex());
  res.type("html").send(renderPost(post));
});
app.get("/sitemap.xml", (_req, res) => res.type("application/xml").send(sitemap()));
app.get("/robots.txt", (_req, res) => res.type("text/plain").send(robots()));

// Instagram に渡すスライド画像（Instagram のサーバーが取りに来るので誰でも開ける）
app.get("/ig/:id/:file", (req, res) => {
  if (!/^[a-z0-9]+$/.test(req.params.id) || !/^\d\.jpg$/.test(req.params.file)) return res.status(404).end();
  const file = path.join(IG_DIR, req.params.id, req.params.file);
  if (!fs.existsSync(file)) return res.status(404).end();
  res.type("jpeg").sendFile(file);
});

// ここから下は管理画面（Basic 認証）
app.use((req, res, next) => {
  const [user, pass] = Buffer.from((req.get("authorization") || "").replace(/^Basic /, ""), "base64")
    .toString().split(":");
  if (process.env.ADMIN_PASSWORD && user === "admin" && safeEqual(pass, process.env.ADMIN_PASSWORD)) return next();
  res.set("WWW-Authenticate", 'Basic realm="note-writer"').status(401).send("認証が必要です");
});

app.use(express.static(path.join(APP_DIR, "admin")));
app.use("/yt", express.static(YT_DIR));

// YouTube と連携（Google のログイン画面へ → 戻ってきたらトークンを保存）
app.get("/oauth/youtube/start", (_req, res) => {
  try {
    res.redirect(302, authUrl());
  } catch (e) {
    res.status(400).send(e.message);
  }
});
app.get("/oauth/tiktok/start", (_req, res) => {
  try {
    res.redirect(302, tiktok.authUrl());
  } catch (e) {
    res.status(400).send(e.message);
  }
});
app.get("/oauth/tiktok/callback", async (req, res) => {
  try {
    if (req.query.error) throw new Error(`TikTok のログインが取り消されました（${req.query.error}）`);
    const me = await tiktok.finishAuth({ code: String(req.query.code || ""), state: String(req.query.state || "") });
    res.type("html").send(`<meta charset="utf-8"><p>TikTok「${String(me.name).replace(/[<>&]/g, "")}」と連携しました。このタブを閉じて、管理画面を再読み込みしてください。</p>`);
  } catch (e) {
    res.status(400).type("html").send(`<meta charset="utf-8"><p>連携できませんでした：${String(e.message).replace(/[<>&]/g, "")}</p>`);
  }
});
app.get("/oauth/youtube/callback", async (req, res) => {
  try {
    if (req.query.error) throw new Error(`Google のログインが取り消されました（${req.query.error}）`);
    const me = await finishAuth({ code: String(req.query.code || ""), state: String(req.query.state || "") });
    res.type("html").send(`<meta charset="utf-8"><p>YouTube チャンネル「${String(me.channel).replace(/[<>&]/g, "")}」と連携しました。このタブを閉じて、管理画面を再読み込みしてください。</p>`);
  } catch (e) {
    res.status(400).type("html").send(`<meta charset="utf-8"><p>連携できませんでした：${String(e.message).replace(/[<>&]/g, "")}</p>`);
  }
});
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
app.post("/api/import-stats", wrap(async () => {
  const r = await importStats();
  return { ...r, shots: r.shots && path.relative(paths.out, r.shots) };
}));
app.get("/api/import-stats", wrap(() => lastImport()));

app.get("/api/trends", wrap(() => getTrendLog().slice(-20).reverse()));
// 管理画面から：週の上限や時刻に関係なく、今すぐ話題を探す
app.post("/api/trends/scout", wrap(async () => {
  const r = await scoutTrends(new Date());
  return r;
}));

app.get("/api/x", wrap(() => ({ hasKeys: hasXKeys(), log: getXLog().slice(-30).reverse() })));
app.put("/api/x/keys", wrap((req) => {
  setXKeys(req.body);
  return { ok: true };
}));
app.post("/api/x/check", wrap(() => xWhoAmI()));
// 投稿文の見本だけ作る（投稿しない）
app.post("/api/x/preview", wrap(async (req) => {
  const { meta, body } = readArticleSource(req.body.name);
  return { text: await composePost({ ...meta, body, tags: Array.isArray(meta.tags) ? meta.tags : [meta.tags] }) };
}));
app.post("/api/x/post", wrap(async (req) => {
  const { meta, body } = readArticleSource(req.body.name);
  if (!meta.url) throw new Error("まだ note に公開していない記事です");
  return postArticle({ ...meta, name: req.body.name, body, tags: Array.isArray(meta.tags) ? meta.tags : [meta.tags] }, { again: true });
}));
// Threads・LINE・ブログ
app.get("/api/social", wrap(() => ({
  threads: { hasToken: hasThreadsToken(), log: getThreadsLog().slice(-20).reverse() },
  line: { hasToken: hasLineToken(), log: getLineLog().slice(-10).reverse() },
  instagram: { hasToken: hasInstagramToken(), log: getInstagramLog().slice(-20).reverse() },
  tiktok: { hasClient: tiktok.hasTiktokClient(), hasToken: tiktok.hasTiktokToken(), log: tiktok.getTiktokLog().slice(-20).reverse(), redirectUri: `${(process.env.PUBLIC_URL || "").replace(/\/$/, "")}/oauth/tiktok/callback` },
  youtube: { hasClient: hasYoutubeClient(), hasToken: hasYoutubeToken(), log: getYoutubeLog().slice(-20).reverse(), redirectUri: `${(process.env.PUBLIC_URL || "").replace(/\/$/, "")}/oauth/youtube/callback` },
  blog: { posts: getBlogPosts().map(({ body, ...p }) => p), base: blogBase(), rakuten: hasRakuten() },
})));
app.put("/api/threads/token", wrap((req) => setThreadsToken(req.body.token)));
app.post("/api/threads/check", wrap(() => threadsWhoAmI()));
app.put("/api/instagram/token", wrap((req) => setInstagramToken(req.body.token)));
app.post("/api/instagram/check", wrap(() => instagramWhoAmI()));
// 一番新しい公開済みの記事（または指定の記事）で、スライドの見本だけ作る（投稿しない）
const igArticle = (name) => {
  const a = name ? listArticles().find((x) => x.name === name) : listArticles().filter((x) => x.status === "published").at(-1);
  if (!a) throw new Error("公開済みの記事がありません");
  const { meta, body } = readArticleSource(a.name);
  return { ...meta, name: a.name, body, price: Number(meta.price || 0), tags: Array.isArray(meta.tags) ? meta.tags : [meta.tags].filter(Boolean) };
};
app.post("/api/instagram/preview", wrap(async (req) => {
  const article = igArticle(req.body.name);
  const carousel = await composeCarousel(article);
  const id = `p${Date.now().toString(36)}`;
  const files = await renderSlides(id, carousel, { title: article.title, tag: article.tags[0], handle: instagramHandle() });
  return { title: article.title, caption: carousel.caption, images: files.map((f) => `/ig/${id}/${f}`) };
}));
app.post("/api/instagram/post", wrap((req) => postArticleToInstagram(igArticle(req.body.name))));
app.put("/api/youtube/client", wrap((req) => setYoutubeClient(req.body)));
app.post("/api/youtube/check", wrap(() => youtubeWhoAmI()));
app.post("/api/youtube/preview", wrap((req) => previewShort(igArticle(req.body.name))));
app.post("/api/youtube/post", wrap((req) => postArticleToYoutube(igArticle(req.body.name))));
app.put("/api/tiktok/client", wrap((req) => tiktok.setTiktokClient(req.body)));
app.post("/api/tiktok/check", wrap(() => tiktok.tiktokWhoAmI()));
app.post("/api/tiktok/post", wrap(async (req) => {
  const article = igArticle(req.body.name);
  const built = await buildShort(article);
  return tiktok.sendDraft(built.video.file, { name: article.name, caption: built.caption });
}));
app.put("/api/line/token", wrap((req) => setLineToken(req.body.token)));
app.post("/api/line/check", wrap(() => lineWhoAmI()));
app.post("/api/line/digest", wrap(() => sendDigest(new Date(), { force: true })));
app.post("/api/blog/write", wrap(async () => {
  const next = nextArticleForBlog({ manual: true });
  if (!next) throw new Error(whyNoBlogCandidate());
  return writeBlogPost(next.name);
}));
app.put("/api/rakuten/keys", wrap((req) => setRakutenKeys(req.body)));
app.post("/api/books/next", wrap(async () => {
  const post = nextPostForBooks();
  if (!post) throw new Error(hasRakuten() ? "本を選んでいないブログ記事はありません" : "楽天のアプリケーション ID とアクセスキーを先に保存してください");
  return addBooksToPost(post.slug);
}));
app.delete("/api/blog/:slug", wrap((req) => {
  if (!getBlogPost(req.params.slug)) throw new Error("見つかりません");
  fs.rmSync(path.join(DATA_DIR, "blog", `${req.params.slug}.json`));
  return { ok: true };
}));
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
