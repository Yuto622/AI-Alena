// 公開した note 記事を、Google 検索向けに書き直して /blog に載せる（このサーバーがそのまま配信するので費用0円）。
// - note と同じ文章を載せると検索で評価が下がるので、構成と言い回しを変えて書き直す
// - 有料記事は無料部分だけを元にし、続きは note へ案内する（有料部分は載せない）
// - 登録したアフィリエイトのうち、記事に合うものだけを AI が入れる。入れたら「PR」を表示する（ステマ規制）
import fs from "fs";
import path from "path";
import { DATA_DIR, paths } from "./config.mjs";
import { getSettings, readJson, writeJson } from "./store.mjs";
import { listArticles, readArticleSource, markdownToBlocks, PAID_MARKER } from "./article.mjs";
import { appCtaMarkdown } from "./apps.mjs";

const DIR = path.join(DATA_DIR, "blog");
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// 書き直しに失敗した記事は、1日あけてからやり直す（毎時 AI を呼び続けないため）
const FAILED = path.join(DATA_DIR, "blog-failed.json");

export function getBlogPosts() {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR).filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.at.localeCompare(a.at));
}

export function getBlogPost(slug) {
  if (!SLUG.test(slug)) return null;
  const file = path.join(DIR, `${slug}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}

// まだブログにしていない公開済みの記事（古いものから）
export function nextArticleForBlog() {
  if (!getSettings().blogEnabled) return null;
  const done = new Set(getBlogPosts().map((p) => p.source));
  const failed = readJson(FAILED, {});
  const recentlyFailed = (name) => failed[name] && Date.now() - Date.parse(failed[name]) < 864e5;
  return listArticles()
    .filter((a) => a.status === "published" && /^https:\/\//.test(a.url) && !done.has(a.name) && !recentlyFailed(a.name))
    .sort((a, b) => (a.publish_at || "").localeCompare(b.publish_at || ""))[0] || null;
}

const SCHEMA = {
  type: "object",
  properties: {
    slug: { type: "string", description: "URL に使う英小文字とハイフンだけの短い名前（例：professor-email-template）" },
    title: { type: "string" },
    description: { type: "string", description: "検索結果に出る説明。全角120文字以内" },
    body: { type: "string", description: "本文の Markdown" },
    affiliates: {
      type: "array",
      items: {
        type: "object",
        properties: { index: { type: "integer" }, note: { type: "string" } },
        required: ["index", "note"],
        additionalProperties: false,
      },
    },
  },
  required: ["slug", "title", "description", "body", "affiliates"],
  additionalProperties: false,
};

export async function writeBlogPost(name) {
  try {
    return await rewrite(name);
  } catch (e) {
    writeJson(FAILED, { ...readJson(FAILED, {}), [name]: new Date().toISOString() });
    throw e;
  }
}

async function rewrite(name) {
  const { askJson } = await import("./generator.mjs");
  const { meta, body } = readArticleSource(name);
  const [free, paid] = body.split(PAID_MARKER);
  const isPaid = Number(meta.price || 0) > 0 && paid !== undefined;
  const profile = fs.existsSync(paths.profile) ? fs.readFileSync(paths.profile, "utf8") : "";
  const affiliates = getSettings().affiliates || [];
  const r = await askJson(`note に公開した記事を元に、Google 検索から読まれるブログ記事を1本書いてください。

## 守ること
- note の記事と同じ文章を使わない。見出しの構成・順番・言い回しを変えて書き直す（同じ内容のコピーは検索で評価が下がる）
- タイトルは、検索する人が打ちそうな言葉を前半に入れる。note と同じタイトルにしない
- 本文は Markdown（## と ### の見出し、箇条書き、段落）。表は使わない。全角1500〜2500文字
- 元の記事と「筆者について」に書かれていない経験・数字・事実は書かない。作り話をしない
${isPaid ? "- 元の記事は有料記事。下に渡すのは無料部分だけなので、それより先の具体的な中身は書かない。最後の段落で「具体的な手順や例は note の記事で詳しく書いています」と自然につなぐ（リンクは別で付けるので書かない）\n" : "- 最後の段落で、元の note 記事も読めることに軽く触れる（リンクは別で付けるので書かない）\n"}- 下の「紹介できる商品」は、記事の内容に本当に合うものだけを 0〜2 個選ぶ（合わなければ空）。note には、その商品が読者の役に立つ理由を1文で。筆者が使ったとは書かない
- slug は英小文字・数字・ハイフンだけ

## 筆者について
${profile.slice(0, 3000)}

## 紹介できる商品（index：名前／合う記事）
${affiliates.map((a, i) => `${i}：${a.name}／${a.fit || ""}`).join("\n") || "（なし）"}

## 元の記事
タイトル：${meta.title}
タグ：${[].concat(meta.tags || []).join(", ")}

${free.slice(0, 12000)}`, SCHEMA);

  let slug = String(r.slug || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "post";
  if (!SLUG.test(slug)) slug = "post";
  for (let i = 2; getBlogPost(slug); i++) slug = `${slug.replace(/-\d+$/, "")}-${i}`;
  const picked = (r.affiliates || [])
    .filter((x) => affiliates[x.index] && /^https:\/\//.test(affiliates[x.index].url))
    .slice(0, 2)
    .map((x) => ({ name: affiliates[x.index].name, url: affiliates[x.index].url, note: x.note }));
  const post = {
    slug,
    source: name,
    title: r.title.trim(),
    description: r.description.trim().slice(0, 160),
    body: r.body,
    tags: [].concat(meta.tags || []),
    noteUrl: meta.url,
    paid: isPaid,
    app: meta.app && meta.app !== "none" ? meta.app : "",
    affiliates: picked,
    at: new Date().toISOString(),
  };
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, `${slug}.json`), JSON.stringify(post, null, 2) + "\n");
  return { slug, title: post.title, affiliates: picked.length };
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const base = () => (process.env.PUBLIC_URL || "").replace(/\/$/, "");
const dateJa = (iso) => new Date(iso).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric" });

function layout({ title, description, canonical, body }) {
  const s = getSettings();
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="article">
${s.googleVerification ? `<meta name="google-site-verification" content="${esc(s.googleVerification)}">` : ""}
<style>
  :root { --bg:#fbfaf7; --ink:#22252a; --muted:#6b7078; --line:#e6e3dc; --accent:#1f6f54; --box:#fff; }
  @media (prefers-color-scheme: dark) { :root { --bg:#17191c; --ink:#e9e7e2; --muted:#a0a5ad; --line:#30343a; --accent:#6fd0a8; --box:#1f2226; } }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:17px/1.9 system-ui, "Hiragino Sans", "Noto Sans JP", sans-serif; }
  .wrap { max-width:720px; margin:0 auto; padding:24px 16px 64px; }
  header a { color:var(--ink); text-decoration:none; font-weight:700; }
  h1 { font-size:26px; line-height:1.5; margin:24px 0 8px; }
  h2 { font-size:21px; margin-top:40px; padding-bottom:6px; border-bottom:2px solid var(--line); }
  h3 { font-size:18px; margin-top:28px; }
  a { color:var(--accent); }
  .meta, footer, .pr { color:var(--muted); font-size:14px; }
  .pr { border:1px solid var(--line); border-radius:6px; padding:4px 10px; display:inline-block; }
  .box { background:var(--box); border:1px solid var(--line); border-radius:10px; padding:16px 20px; margin:32px 0; }
  .box h2, .box h3 { margin-top:0; border:0; }
  blockquote { margin:16px 0; padding:4px 16px; border-left:4px solid var(--line); color:var(--muted); }
  pre { overflow-x:auto; background:var(--box); padding:12px; border-radius:8px; }
  ul.posts { list-style:none; padding:0; } ul.posts li { padding:16px 0; border-bottom:1px solid var(--line); }
  ul.posts a { font-weight:700; font-size:18px; text-decoration:none; }
</style>
</head>
<body><div class="wrap">
<header><a href="${esc(base())}/blog">${esc(s.blogTitle)}</a></header>
${body}
<footer><hr><p>${esc(s.blogTitle)} ／ 運営：合同会社 U-Speak Lab</p></footer>
</div></body></html>`;
}

export function renderPost(post) {
  const ctaFile = path.join(paths.cta, "default.md");
  const cta = fs.existsSync(ctaFile) ? fs.readFileSync(ctaFile, "utf8") : "";
  const app = post.app ? appCtaMarkdown(post.app, `blog:${post.slug}`) : "";
  const amazon = post.affiliates.some((a) => /amazon\.|amzn\./.test(a.url));
  const affiliates = post.affiliates.length ? `<div class="box"><h3>この記事で紹介したもの</h3><ul>${post.affiliates.map((a) =>
    `<li><a href="${esc(a.url)}" rel="sponsored noopener" target="_blank">${esc(a.name)}</a><br><small>${esc(a.note)}</small></li>`).join("")}</ul></div>` : "";
  const lineUrl = getSettings().lineAddUrl;
  return layout({
    title: post.title,
    description: post.description,
    canonical: `${base()}/blog/${post.slug}`,
    body: `<article>
${post.affiliates.length ? '<p class="pr">PR：この記事にはアフィリエイトリンクを含みます</p>' : ""}
<h1>${esc(post.title)}</h1>
<p class="meta">${dateJa(post.at)}</p>
${markdownToBlocks(post.body).join("\n")}
<div class="box"><h3>${post.paid ? "続きは note で" : "元の記事（note）"}</h3>
<p><a href="${esc(post.noteUrl)}" target="_blank" rel="noopener">▶ note で読む</a></p></div>
${affiliates}
${app ? `<div class="box">${markdownToBlocks(app.replace(/^---\s*/, "")).join("")}</div>` : ""}
${cta ? `<div class="box">${markdownToBlocks(cta).join("")}</div>` : ""}
${lineUrl ? `<p><a href="${esc(lineUrl)}" target="_blank" rel="noopener"><b>▶ 新しい記事のお知らせを LINE で受け取る（週1回）</b></a></p>` : ""}
${amazon ? '<p class="meta">Amazon のアソシエイトとして、当サイトは適格販売により収入を得ています。</p>' : ""}
</article>`,
  });
}

export function renderIndex() {
  const s = getSettings();
  const posts = getBlogPosts();
  return layout({
    title: s.blogTitle,
    description: `${s.blogTitle}。海外大学・英語学習・子どもの英語・AI と自動化について書いています。`,
    canonical: `${base()}/blog`,
    body: `<h1>${esc(s.blogTitle)}</h1>
<ul class="posts">${posts.map((p) => `<li><a href="${esc(base())}/blog/${esc(p.slug)}">${esc(p.title)}</a><br><small class="meta">${dateJa(p.at)}</small><br><small>${esc(p.description)}</small></li>`).join("") || "<li>準備中です。</li>"}</ul>`,
  });
}

export function sitemap() {
  const urls = [`${base()}/blog`, ...getBlogPosts().map((p) => `${base()}/blog/${p.slug}`)];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `<url><loc>${esc(u)}</loc></url>`).join("\n")}
</urlset>
`;
}

export const robots = () => `User-agent: *
Allow: /blog
Allow: /sitemap.xml
Disallow: /

Sitemap: ${base()}/sitemap.xml
`;
