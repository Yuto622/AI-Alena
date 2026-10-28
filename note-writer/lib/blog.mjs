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
// manual: 管理画面のボタンから。失敗して1日お休み中の記事も対象にする
export function nextArticleForBlog({ manual = false } = {}) {
  if (!getSettings().blogEnabled) return null;
  const done = new Set(getBlogPosts().map((p) => p.source));
  const failed = readJson(FAILED, {});
  // 記録は { at, error }（前の形式は日時の文字列だけ）
  const failedAt = (name) => (typeof failed[name] === "string" ? failed[name] : failed[name]?.at);
  const recentlyFailed = (name) => !manual && failedAt(name) && Date.now() - Date.parse(failedAt(name)) < 864e5;
  return listArticles()
    .filter((a) => a.status === "published" && /^https:\/\//.test(a.url) && !done.has(a.name) && !recentlyFailed(a.name))
    .sort((a, b) => (a.publish_at || "").localeCompare(b.publish_at || ""))[0] || null;
}

// ブログにできる記事がないとき、その理由（管理画面に出す）
export function whyNoBlogCandidate() {
  if (!getSettings().blogEnabled) return "ブログが OFF です（「ブログを作る」にチェックを入れて保存）";
  const done = new Set(getBlogPosts().map((p) => p.source));
  const published = listArticles().filter((a) => a.status === "published");
  if (!published.length) return "公開済みの記事がまだありません";
  const noUrl = published.filter((a) => !/^https:\/\//.test(a.url));
  if (noUrl.length) return `公開済みなのに note の URL が入っていない記事があります：${noUrl.map((a) => a.title).join("、")}。「記事」で開いて、URL 欄に note の記事の URL を入れて保存してください`;
  if (published.every((a) => done.has(a.name))) return "公開済みの記事は、すべてブログにしてあります";
  return "ブログにできる記事が見つかりません";
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
    writeJson(FAILED, { ...readJson(FAILED, {}), [name]: { at: new Date().toISOString(), error: e.message.slice(0, 300) } });
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
// ブログのアドレス。会社のドメイン（例：blog.uspeaklab.org）を設定したらそちら
export const blogBase = () => {
  const domain = getSettings().blogDomain;
  return domain ? `https://${domain}` : (process.env.PUBLIC_URL || "").replace(/\/$/, "");
};
const base = blogBase;
const dateJa = (iso) => new Date(iso).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric" });
const minutes = (md) => Math.max(1, Math.round(md.replace(/\s/g, "").length / 600));

// 記事ごとの表紙の色（タイトルから決まるので、同じ記事はいつも同じ色）
const PALETTES = [
  ["#7cf7d4", "#3b82f6", "#a855f7"], ["#fbbf24", "#f43f5e", "#8b5cf6"], ["#34d399", "#06b6d4", "#6366f1"],
  ["#f472b6", "#a78bfa", "#38bdf8"], ["#a3e635", "#10b981", "#0ea5e9"], ["#fb923c", "#ec4899", "#6366f1"],
];
function palette(text) {
  let h = 0;
  for (const c of text) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return PALETTES[h % PALETTES.length];
}
const coverStyle = (title) => {
  const [a, b, c] = palette(title);
  return `--c1:${a};--c2:${b};--c3:${c}`;
};

// 見出し（##）に番号の id を付けて、目次を作る
function withToc(html) {
  const toc = [];
  const out = html.replace(/<h2>(.*?)<\/h2>/g, (_m, inner) => {
    toc.push(inner);
    return `<h2 id="s${toc.length}">${inner}</h2>`;
  });
  return { html: out, toc };
}

const CSS = `
:root{--bg:#06070c;--bg2:#0d0f18;--ink:#eef0f6;--muted:#9aa1b5;--line:rgba(255,255,255,.09);--glass:rgba(255,255,255,.045);--glass2:rgba(255,255,255,.08);
--g:linear-gradient(110deg,#7cf7d4 0%,#7aa2ff 45%,#c58cff 100%);--shadow:0 30px 80px -30px rgba(0,0,0,.7);--a1:rgba(124,247,212,.22);--a2:rgba(122,162,255,.22);--a3:rgba(197,140,255,.2)}
@media (prefers-color-scheme:light){:root{--bg:#f7f6f2;--bg2:#ffffff;--ink:#14161f;--muted:#5d6475;--line:rgba(20,22,31,.09);--glass:rgba(255,255,255,.65);--glass2:rgba(255,255,255,.9);
--g:linear-gradient(110deg,#0f9f7a 0%,#3b63e0 45%,#8b3fe0 100%);--shadow:0 30px 70px -35px rgba(40,40,80,.35);--a1:rgba(16,185,129,.16);--a2:rgba(59,130,246,.14);--a3:rgba(168,85,247,.14)}}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.95 "Zen Kaku Gothic New",system-ui,"Hiragino Sans","Noto Sans JP",sans-serif;-webkit-font-smoothing:antialiased;overflow-x:hidden}
.aurora{position:fixed;inset:-20vmax;z-index:-1;pointer-events:none;filter:blur(60px);
background:radial-gradient(40vmax 40vmax at 15% 20%,var(--a1),transparent 60%),radial-gradient(45vmax 45vmax at 85% 10%,var(--a2),transparent 60%),radial-gradient(50vmax 50vmax at 60% 90%,var(--a3),transparent 60%);
animation:drift 28s ease-in-out infinite alternate}
.grid-bg{position:fixed;inset:0;z-index:-1;pointer-events:none;opacity:.5;
background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px);background-size:56px 56px;
mask-image:radial-gradient(ellipse at 50% 0%,#000 0%,transparent 70%);-webkit-mask-image:radial-gradient(ellipse at 50% 0%,#000 0%,transparent 70%)}
@keyframes drift{to{transform:translate3d(4vmax,-3vmax,0) rotate(8deg) scale(1.08)}}
@media (prefers-reduced-motion:reduce){.aurora{animation:none}html{scroll-behavior:auto}}
a{color:inherit}
.wrap{max-width:1160px;margin:0 auto;padding:0 20px}
.top{position:sticky;top:0;z-index:10;backdrop-filter:blur(16px) saturate(1.4);-webkit-backdrop-filter:blur(16px) saturate(1.4);background:color-mix(in srgb,var(--bg) 70%,transparent);border-bottom:1px solid var(--line)}
.top .wrap{display:flex;align-items:center;gap:16px;height:60px}
.logo{display:flex;align-items:center;gap:10px;text-decoration:none;font-weight:900;letter-spacing:.02em;font-size:15px}
.logo i{width:22px;height:22px;border-radius:7px;background:var(--g);box-shadow:0 0 24px rgba(124,247,212,.45)}
.top nav{margin-left:auto;display:flex;gap:6px;overflow-x:auto;scrollbar-width:none}
.chip{display:inline-flex;align-items:center;white-space:nowrap;padding:5px 12px;border-radius:999px;border:1px solid var(--line);background:var(--glass);font-size:13px;text-decoration:none;color:var(--muted);transition:.2s}
.chip:hover,.chip.on{color:var(--ink);border-color:transparent;background:linear-gradient(var(--bg2),var(--bg2)) padding-box,var(--g) border-box}
.hero{padding:88px 0 48px}
.eyebrow{display:inline-flex;gap:8px;align-items:center;font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:6px 14px;background:var(--glass)}
.eyebrow b{width:7px;height:7px;border-radius:50%;background:#7cf7d4;box-shadow:0 0 12px #7cf7d4}
.hero h1{font-size:clamp(38px,7vw,84px);line-height:1.12;margin:22px 0 18px;font-weight:900;letter-spacing:-.02em}
.grad{background:var(--g);-webkit-background-clip:text;background-clip:text;color:transparent}
.hero p{color:var(--muted);font-size:clamp(15px,2vw,19px);max-width:620px;margin:0}
.stats{display:flex;gap:28px;margin-top:30px;color:var(--muted);font-size:13px}.stats b{display:block;color:var(--ink);font-size:26px;font-weight:900}
.cover{position:relative;overflow:hidden;background:
radial-gradient(120% 90% at 0% 0%,var(--c1),transparent 55%),radial-gradient(110% 100% at 100% 0%,var(--c2),transparent 55%),radial-gradient(120% 120% at 60% 120%,var(--c3),transparent 60%),#0b0d16}
.cover:after{content:"";position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.07) 1px,transparent 1px);background-size:28px 28px;mask-image:linear-gradient(180deg,#000,transparent);-webkit-mask-image:linear-gradient(180deg,#000,transparent)}
.cover .glyph{position:absolute;right:-.06em;bottom:-.2em;font-size:clamp(90px,14vw,190px);font-weight:900;color:rgba(255,255,255,.16);line-height:1;letter-spacing:-.04em;white-space:nowrap}
.card{display:block;text-decoration:none;border-radius:22px;border:1px solid var(--line);background:var(--glass);overflow:hidden;transition:transform .35s cubic-bezier(.2,.8,.2,1),box-shadow .35s,border-color .35s;box-shadow:var(--shadow)}
.card:hover{transform:translateY(-6px) rotateX(2deg);border-color:transparent;background:linear-gradient(var(--bg2),var(--bg2)) padding-box,var(--g) border-box}
.card .cover{aspect-ratio:16/9}
.card .body{padding:20px 22px 24px}
.card h2,.card h3{margin:8px 0 8px;line-height:1.5;font-weight:900}
.card h3{font-size:19px}.card p{margin:0;color:var(--muted);font-size:14px;line-height:1.8}
.meta{color:var(--muted);font-size:13px;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.feature{display:grid;grid-template-columns:1.3fr 1fr;margin-bottom:28px}
.feature .cover{aspect-ratio:auto;min-height:340px}
.feature .body{padding:40px;display:flex;flex-direction:column;justify-content:center}
.feature h2{font-size:clamp(24px,3vw,34px)}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:24px;padding-bottom:40px}
.empty{padding:60px 40px;text-align:center;border-radius:28px;border:1px dashed var(--line);background:var(--glass);margin-bottom:60px}
.empty h2{font-size:28px;margin:0 0 8px}
.btn{display:inline-flex;align-items:center;gap:10px;padding:14px 26px;border-radius:999px;font-weight:900;text-decoration:none;color:#06070c;background:var(--g);box-shadow:0 10px 40px -10px rgba(122,162,255,.7);transition:.25s}
.btn:hover{transform:translateY(-2px);box-shadow:0 18px 50px -10px rgba(197,140,255,.8)}
.btn.ghost{background:var(--glass2);color:var(--ink);border:1px solid var(--line);box-shadow:none}
.progress{position:fixed;top:0;left:0;height:3px;width:0;background:var(--g);z-index:20;box-shadow:0 0 12px rgba(122,162,255,.8)}
.post-hero{border-radius:0 0 36px 36px;min-height:56vh;display:flex;align-items:flex-end;margin-bottom:56px}
.post-hero .wrap{position:relative;z-index:1;padding-top:120px;padding-bottom:56px;width:100%}
.post-hero h1{font-size:clamp(30px,5.4vw,60px);line-height:1.25;margin:16px 0;font-weight:900;color:#fff;max-width:900px;text-shadow:0 4px 40px rgba(0,0,0,.35)}
.post-hero .meta{color:rgba(255,255,255,.85)}.post-hero .chip{color:#fff;border-color:rgba(255,255,255,.3);background:rgba(0,0,0,.22)}
.pr{display:inline-block;font-size:12px;padding:3px 10px;border-radius:6px;background:rgba(0,0,0,.3);color:#fff;border:1px solid rgba(255,255,255,.3)}
.layout{display:grid;grid-template-columns:minmax(0,720px) 260px;gap:64px;justify-content:center}
.toc{position:sticky;top:90px;align-self:start;font-size:13px;border-left:1px solid var(--line);padding-left:18px}
.toc b{display:block;letter-spacing:.2em;font-size:11px;color:var(--muted);margin-bottom:10px}
.toc a{display:block;text-decoration:none;color:var(--muted);padding:6px 0;line-height:1.6;transition:.2s}.toc a:hover,.toc a.on{color:var(--ink);transform:translateX(4px)}
article.prose h2{font-size:clamp(22px,2.6vw,28px);line-height:1.5;margin:64px 0 18px;font-weight:900;padding-left:18px;position:relative;scroll-margin-top:90px}
article.prose h2:before{content:"";position:absolute;left:0;top:.25em;bottom:.25em;width:5px;border-radius:5px;background:var(--g)}
article.prose h3{font-size:20px;margin:40px 0 12px}
article.prose p{margin:0 0 1.4em}
article.prose a{text-decoration:none;background:linear-gradient(var(--ink),var(--ink)) 0 100%/100% 1px no-repeat;padding-bottom:1px}
article.prose ul,article.prose ol{padding-left:1.3em;margin:0 0 1.6em}article.prose li{margin:.35em 0}
article.prose ul li::marker{color:#7aa2ff}
article.prose blockquote{margin:28px 0;padding:18px 24px;border-radius:16px;background:var(--glass);border:1px solid var(--line);color:var(--muted)}
article.prose blockquote p{margin:0}
article.prose pre{overflow-x:auto;background:var(--bg2);border:1px solid var(--line);padding:16px;border-radius:14px;font-size:14px;line-height:1.7}
article.prose code{font-family:ui-monospace,monospace;font-size:.9em}
article.prose strong{background:linear-gradient(transparent 62%,rgba(122,162,255,.35) 0)}
.panel{margin:44px 0;padding:28px 30px;border-radius:24px;border:1px solid var(--line);background:var(--glass);backdrop-filter:blur(10px)}
.panel h2,.panel h3{margin-top:0}
.panel.cta{background:linear-gradient(var(--bg2),var(--bg2)) padding-box,var(--g) border-box;border:1.5px solid transparent;text-align:center}
.panel.cta p{color:var(--muted)}
.panel ul{padding-left:1.2em}
.related{padding:20px 0 60px}.related h2{font-size:22px;margin-bottom:20px}
footer{border-top:1px solid var(--line);padding:40px 0 60px;color:var(--muted);font-size:13px}
footer .wrap{display:flex;gap:16px;flex-wrap:wrap;align-items:center;justify-content:space-between}
@media (max-width:1100px){.layout{grid-template-columns:minmax(0,720px)}.toc{display:none}}
@media (max-width:760px){.feature{grid-template-columns:1fr}.feature .cover{min-height:200px}.feature .body{padding:24px}.hero{padding:56px 0 32px}.post-hero{min-height:44vh;border-radius:0 0 24px 24px}.top nav{display:none}.stats{gap:20px}.panel{padding:22px}}
`;

const SCRIPT = `<script>
(()=>{const bar=document.querySelector(".progress");const links=[...document.querySelectorAll(".toc a")];
const heads=links.map(a=>document.getElementById(a.hash.slice(1))).filter(Boolean);
const on=()=>{const h=document.documentElement;if(bar)bar.style.width=(h.scrollTop/(h.scrollHeight-h.clientHeight)*100)+"%";
let cur=-1;heads.forEach((el,i)=>{if(el.getBoundingClientRect().top<140)cur=i});links.forEach((a,i)=>a.classList.toggle("on",i===cur))};
addEventListener("scroll",on,{passive:true});on();})();
</script>`;

function layout({ title, description, canonical, body, jsonLd, tags = [], activeTag = "", script = false }) {
  const s = getSettings();
  const lineUrl = s.lineAddUrl;
  const noteHome = s.noteUrlname ? `https://note.com/${s.noteUrlname}` : "";
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
<meta property="og:type" content="${jsonLd ? "article" : "website"}">
<meta property="og:url" content="${esc(canonical)}">
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="#06070c">
${s.googleVerification ? `<meta name="google-site-verification" content="${esc(s.googleVerification)}">` : ""}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@400;700;900&display=swap" rel="stylesheet">
<style>${CSS}</style>
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>` : ""}
</head>
<body>
<div class="aurora"></div><div class="grid-bg"></div>
${script ? '<div class="progress"></div>' : ""}
<header class="top"><div class="wrap">
<a class="logo" href="${esc(base())}/blog"><i></i>${esc(s.blogTitle)}</a>
<nav>${tags.map((t) => `<a class="chip${t === activeTag ? " on" : ""}" href="${esc(base())}/blog?tag=${encodeURIComponent(t)}">#${esc(t)}</a>`).join("")}</nav>
</div></header>
${body}
<footer><div class="wrap">
<span>© ${new Date().getFullYear()} 合同会社 U-Speak Lab ／ ${esc(s.blogTitle)}</span>
<span style="display:flex;gap:10px;flex-wrap:wrap">${noteHome ? `<a class="chip" href="${esc(noteHome)}" target="_blank" rel="noopener">note</a>` : ""}${lineUrl ? `<a class="chip" href="${esc(lineUrl)}" target="_blank" rel="noopener">LINE で受け取る</a>` : ""}</span>
</div></footer>
${script ? SCRIPT : ""}
</body></html>`;
}

// よく使われているタグ（上の帯に出す）
function topTags(posts, n = 6) {
  const count = new Map();
  for (const p of posts) for (const t of p.tags || []) count.set(t, (count.get(t) || 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([t]) => t);
}

function cardHtml(p, { feature = false } = {}) {
  const tag = (p.tags || [])[0] || "";
  return `<a class="card${feature ? " feature" : ""}" href="${esc(base())}/blog/${esc(p.slug)}">
<div class="cover" style="${coverStyle(p.title)}"><span class="glyph">${esc(tag.slice(0, 6))}</span></div>
<div class="body">
<div class="meta">${tag ? `<span class="chip">#${esc(tag)}</span>` : ""}<span>${dateJa(p.at)}</span><span>${minutes(p.body || "")} 分</span></div>
${feature ? `<h2>${esc(p.title)}</h2>` : `<h3>${esc(p.title)}</h3>`}
<p>${esc(p.description)}</p>
</div></a>`;
}

export function renderPost(post) {
  const s = getSettings();
  const ctaFile = path.join(paths.cta, "default.md");
  const cta = fs.existsSync(ctaFile) ? fs.readFileSync(ctaFile, "utf8") : "";
  const app = post.app ? appCtaMarkdown(post.app, `blog:${post.slug}`) : "";
  const amazon = post.affiliates.some((a) => /amazon\.|amzn\./.test(a.url));
  const { html, toc } = withToc(markdownToBlocks(post.body).join("\n"));
  const all = getBlogPosts();
  const mine = new Set(post.tags || []);
  const related = all.filter((p) => p.slug !== post.slug)
    .map((p) => ({ p, score: (p.tags || []).filter((t) => mine.has(t)).length }))
    .sort((a, b) => b.score - a.score || b.p.at.localeCompare(a.p.at)).slice(0, 3).map((x) => x.p);
  const url = `${base()}/blog/${post.slug}`;
  return layout({
    title: `${post.title}｜${s.blogTitle}`,
    description: post.description,
    canonical: url,
    tags: topTags(all),
    script: true,
    jsonLd: {
      "@context": "https://schema.org", "@type": "BlogPosting", headline: post.title, description: post.description,
      datePublished: post.at, mainEntityOfPage: url, author: { "@type": "Organization", name: "合同会社 U-Speak Lab" },
      publisher: { "@type": "Organization", name: "合同会社 U-Speak Lab" },
    },
    body: `<section class="post-hero cover" style="${coverStyle(post.title)}"><span class="glyph">${esc(((post.tags || [])[0] || "").slice(0, 6))}</span>
<div class="wrap">
<div class="meta">${(post.tags || []).slice(0, 4).map((t) => `<a class="chip" href="${esc(base())}/blog?tag=${encodeURIComponent(t)}">#${esc(t)}</a>`).join("")}${post.affiliates.length ? '<span class="pr">PR：アフィリエイトリンクを含みます</span>' : ""}</div>
<h1>${esc(post.title)}</h1>
<div class="meta"><span>${dateJa(post.at)}</span><span>・</span><span>${minutes(post.body)} 分で読めます</span></div>
</div></section>
<div class="wrap layout">
<main>
<article class="prose">${html}</article>
<div class="panel cta">
<h3>${post.paid ? "この続きは、note で詳しく" : "元の記事は note で読めます"}</h3>
<p>${post.paid ? "具体的な手順や例は、note の記事にまとめています。" : "note ではほかの記事もまとめて読めます。"}</p>
<a class="btn" href="${esc(post.noteUrl)}" target="_blank" rel="noopener">note で読む →</a>
</div>
${post.affiliates.length ? `<div class="panel"><h3>この記事で紹介したもの</h3><ul>${post.affiliates.map((a) =>
    `<li><a href="${esc(a.url)}" rel="sponsored noopener" target="_blank"><b>${esc(a.name)}</b></a><br><small>${esc(a.note)}</small></li>`).join("")}</ul></div>` : ""}
${app ? `<div class="panel">${markdownToBlocks(app.replace(/^---\s*/, "")).join("")}</div>` : ""}
${cta ? `<div class="panel">${markdownToBlocks(cta).join("")}</div>` : ""}
${s.lineAddUrl ? `<div class="panel cta"><h3>新しい記事を、週1回 LINE で</h3><p>その週の記事だけをまとめて届けます。</p><a class="btn ghost" href="${esc(s.lineAddUrl)}" target="_blank" rel="noopener">LINE で受け取る</a></div>` : ""}
${amazon ? '<p class="meta">Amazon のアソシエイトとして、当サイトは適格販売により収入を得ています。</p>' : ""}
</main>
${toc.length ? `<aside class="toc"><b>CONTENTS</b>${toc.map((t, i) => `<a href="#s${i + 1}">${t}</a>`).join("")}</aside>` : "<aside></aside>"}
</div>
${related.length ? `<section class="wrap related"><h2>あわせて読みたい</h2><div class="cards">${related.map((p) => cardHtml(p)).join("")}</div></section>` : ""}`,
  });
}

export function renderIndex({ tag = "" } = {}) {
  const s = getSettings();
  const all = getBlogPosts();
  const posts = tag ? all.filter((p) => (p.tags || []).includes(tag)) : all;
  const noteHome = s.noteUrlname ? `https://note.com/${s.noteUrlname}` : "";
  const [first, ...rest] = posts;
  return layout({
    title: tag ? `#${tag}｜${s.blogTitle}` : s.blogTitle,
    description: `${s.blogTitle}。海外大学・英語学習・子どもの英語・AI と自動化について、UCLA 在学生が書いています。`,
    canonical: `${base()}/blog${tag ? `?tag=${encodeURIComponent(tag)}` : ""}`,
    tags: topTags(all),
    activeTag: tag,
    body: `<section class="wrap hero">
<span class="eyebrow"><b></b>UCLA × ENGLISH × AI</span>
<h1>${tag ? `<span class="grad">#${esc(tag)}</span>` : `英語の、<span class="grad">その先へ。</span>`}</h1>
<p>海外大学のリアル、子どもの英語と英検、AI で仕事を軽くする方法。UCLA の在学生が、自分の経験から書いています。</p>
<div class="stats"><div><b>${all.length}</b>記事</div><div><b>${topTags(all, 99).length}</b>テーマ</div></div>
</section>
<section class="wrap">
${first ? cardHtml(first, { feature: true }) + `<div class="cards">${rest.map((p) => cardHtml(p)).join("")}</div>`
    : `<div class="empty"><h2><span class="grad">最初の記事を準備しています</span></h2><p class="meta" style="justify-content:center">まもなく公開します。${noteHome ? "先に note で読めます。" : ""}</p>${noteHome ? `<p><a class="btn" href="${esc(noteHome)}" target="_blank" rel="noopener">note を見る →</a></p>` : ""}</div>`}
</section>`,
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
