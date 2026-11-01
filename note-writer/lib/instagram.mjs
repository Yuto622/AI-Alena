// Instagram に、記事の要点を5枚のスライド（カルーセル）にして自動で投稿する（Instagram API は無料）。
// - 画像はサーバーのブラウザで描き（費用0円）、このサーバーの /ig/... から Instagram に取りに来てもらう
// - 自分のアカウントにだけ投稿するので、Meta のアプリは「開発中」のまま、自分をテスターにすれば審査なしで使える
// - アクセストークンは60日で切れるので、7日ごとに自動で延長する
// Instagram の投稿文のリンクは押せないので、誘導は「プロフィールのリンクから」にする
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { DATA_DIR } from "./config.mjs";
import { readJson, writeJson, getSettings } from "./store.mjs";
import { loadSecret, saveSecret } from "./credentials.mjs";
import { snsDestination } from "./destinations.mjs";

const require = createRequire(import.meta.url);
const LOG = path.join(DATA_DIR, "instagram-log.json");
export const IG_DIR = path.join(DATA_DIR, "ig");
const API = process.env.INSTAGRAM_API_BASE || "https://graph.instagram.com";
// Facebook ログイン（統合ログイン）で作ったトークン（EAA…）は、graph.facebook.com で使う
const FB_API = process.env.FACEBOOK_API_BASE || "https://graph.facebook.com";
const rootOf = (s) => (s?.api === "facebook" ? FB_API : API);

export const getInstagramLog = () => readJson(LOG, []);
export const hasInstagramToken = () => !!loadSecret("instagram");

async function call(method, pathname, params, root = API) {
  const url = new URL(`${root}${pathname}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { method });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Instagram API ${res.status}: ${json.error?.message || JSON.stringify(json).slice(0, 200)}`);
  return json;
}

// トークンを確かめてから保存する（自分の ID もここで控える）
// igUserId：システムユーザーのトークンなどでアカウントが自動で見つからないとき、トークン生成の画面に出る数字の ID を渡す
export async function setInstagramToken(token, igUserId = "") {
  token = String(token || "").trim();
  igUserId = String(igUserId || "").trim();
  if (!token) throw new Error("アクセストークンを入れてください");
  // まず Instagram ログインのトークンとして試し、だめなら Facebook ログイン（統合ログイン）のトークンとして試す
  try {
    const me = await call("GET", "/me", { fields: "user_id,username", access_token: token });
    saveSecret("instagram", { token, api: "instagram", userId: me.user_id || me.id, username: me.username, refreshedAt: new Date().toISOString() });
    return { username: me.username };
  } catch (first) {
    if (/^\d{10,}$/.test(igUserId)) {
      const me = await call("GET", `/${igUserId}`, { fields: "username", access_token: token }, FB_API);
      saveSecret("instagram", { token, api: "facebook", userId: igUserId, username: me.username, refreshedAt: new Date().toISOString() });
      return { username: me.username };
    }
    const { data = [] } = await call("GET", "/me/accounts", { fields: "instagram_business_account{id,username}", access_token: token }, FB_API)
      .catch(() => { throw first; });
    const ig = data.map((p) => p.instagram_business_account).find(Boolean);
    if (!ig) throw new Error("このトークンでは Instagram のアカウントが自動で見つかりません。「Instagram アカウント ID」の欄に、トークンを作った画面に出ていた数字（17841…）を入れて、もう一度保存してください");
    saveSecret("instagram", { token, api: "facebook", userId: ig.id, username: ig.username, refreshedAt: new Date().toISOString() });
    return { username: ig.username };
  }
}

export async function instagramWhoAmI() {
  const s = await session();
  if (s.api === "facebook") {
    const me = await call("GET", `/${s.userId}`, { fields: "username", access_token: s.token }, FB_API);
    return { username: me.username };
  }
  const me = await call("GET", "/me", { fields: "user_id,username", access_token: s.token });
  return { username: me.username };
}

async function session(now = new Date()) {
  const s = loadSecret("instagram");
  if (!s) throw new Error("Instagram のアクセストークンが未設定です。管理画面の「SNS・LINE・ブログ」で入れてください");
  // Instagram ログインのトークンだけ、ここで延長できる（Facebook ログインのトークンは期限が長いのでそのまま使う）
  if (s.api !== "facebook" && now - Date.parse(s.refreshedAt || 0) > 7 * 864e5) {
    try {
      const r = await call("GET", "/refresh_access_token", { grant_type: "ig_refresh_token", access_token: s.token });
      Object.assign(s, { token: r.access_token, refreshedAt: now.toISOString() });
      saveSecret("instagram", s);
    } catch (e) {
      console.error(`Instagram のトークン延長に失敗：${e.message}`);
    }
  }
  return s;
}

// ---- スライドの中身（AI が記事から作る） ----

const SCHEMA = {
  type: "object",
  properties: {
    cover: { type: "string", description: "1枚目に大きく出す見出し。全角24文字以内" },
    points: {
      type: "array",
      description: "2〜4枚目。記事の要点を3つ",
      items: {
        type: "object",
        properties: {
          heading: { type: "string", description: "全角16文字以内" },
          lines: { type: "array", items: { type: "string" }, description: "1行全角22文字以内を2〜3行" },
        },
        required: ["heading", "lines"],
        additionalProperties: false,
      },
    },
    caption: { type: "string", description: "投稿文。ハッシュタグは含めない" },
    hashtags: { type: "array", items: { type: "string" }, description: "# を付けない言葉を3〜5個" },
  },
  required: ["cover", "points", "caption", "hashtags"],
  additionalProperties: false,
};

// 最後のスライドと投稿文の締め（プロフィールのリンク集で、どのボタンを押してほしいか）
export const ENDINGS = {
  service: { eyebrow: "WORK WITH US", head: "AI・自動化の<br><span class=\"g\">ご相談</span>はこちら", text: "仕組みづくりの相談は、<br>プロフィールのリンクから。", caption: "AI や自動化の相談は、プロフィールのリンクから受け付けています。" },
  business: { eyebrow: "FOR ENGLISH SCHOOLS", head: "教室で使える<br><span class=\"g\">U-Speak</span>", text: "英語教室の方は、<br>プロフィールのリンクから説明会へ。", caption: "英語教室の方は、プロフィールのリンクから無料の説明を予約できます。" },
  line: { eyebrow: "FOLLOW ON LINE", head: "新しい記事を<br><span class=\"g\">LINE</span> で", text: "週1回、その週の記事が届きます。<br>プロフィールのリンクから。", caption: "新しい記事は LINE で週1回届きます。プロフィールのリンクから友だち追加できます。" },
  note: { eyebrow: "MORE ON NOTE", head: "続きは<br><span class=\"g\">note</span> で", text: "具体的な手順や例は、<br>プロフィールのリンクから読めます。", caption: "詳しくはプロフィールのリンク（note）から。" },
};

export async function composeCarousel(article) {
  const { askJson } = await import("./generator.mjs");
  const free = String(article.body || "").split("<!-- paid -->")[0];
  const r = await askJson(`note の記事を、Instagram のスライド投稿（5枚）にまとめてください。
- 1枚目（cover）：読者が「自分のことだ」と思う見出し。全角24文字以内
- 2〜4枚目（points）：記事の要点を3つ。各スライドは見出し（全角16文字以内）と、短い文を2〜3行（1行全角22文字以内）
- 5枚目は「続きは note で」の案内を自動で付けるので、書かない
- 投稿文（caption）：全角300文字以内。1行目で誰の悩みが解決するかを書き、要点を軽く紹介する。最後の案内文は自動で付けるので書かない。URL は書かない
- ハッシュタグ：# を付けない言葉で3〜5個（例：英検、海外大学、留学準備、AI活用）
- 記事にないこと・筆者の経験にないことは書かない
${article.price ? "- 有料記事なので、無料部分に書かれた範囲だけを使い、有料部分の中身は書かない\n" : ""}${article.topic === "trend" ? `- 話題枠の投稿：いま話題の「${[].concat(article.tags || [])[0]}」を表紙の見出しとハッシュタグの1つ目に入れる\n` : ""}
## 記事
タイトル：${article.title}
タグ：${[].concat(article.tags || []).join(", ")}

${free.slice(0, 8000)}`, SCHEMA);
  const ending = ENDINGS[snsDestination(article).kind] || ENDINGS.note;
  const tags = (r.hashtags || []).map((t) => String(t).replace(/^#+/, "").replace(/\s+/g, "")).filter(Boolean).slice(0, 5);
  return {
    cover: r.cover,
    points: (r.points || []).slice(0, 3),
    caption: `${r.caption.trim()}\n\n${ending.caption}\n\n${tags.map((t) => `#${t}`).join(" ")}`.slice(0, 2100),
    ending,
  };
}

// ---- スライドの画像（1080×1350、ブログと同じ見た目） ----

const PALETTES = [
  ["#7cf7d4", "#3b82f6", "#a855f7"], ["#fbbf24", "#f43f5e", "#8b5cf6"], ["#34d399", "#06b6d4", "#6366f1"],
  ["#f472b6", "#a78bfa", "#38bdf8"], ["#a3e635", "#10b981", "#0ea5e9"], ["#fb923c", "#ec4899", "#6366f1"],
];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function palette(text) {
  let h = 0;
  for (const c of text) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return PALETTES[h % PALETTES.length];
}

// height：Instagram は 1350（4:5）、YouTube ショートは 1920（9:16）。video なら表紙の一言を動画向けにする
export function slideHtml(slide, { title, tag, handle, index, total, height = 1350, video = false }) {
  const [a, b, c] = palette(title);
  const page = `<div class="page">${index} / ${total}</div>`;
  let inner;
  if (slide.kind === "cover") {
    const size = slide.text.length > 18 ? 92 : 108;
    inner = `<span class="eyebrow"><b></b>${esc(tag ? `#${tag}` : "UCLA × ENGLISH")}</span>
<h1 style="font-size:${size}px">${esc(slide.text)}</h1>
<p class="swipe">${video ? "1分で要点をまとめます" : "保存して、あとで見返してください →"}</p>`;
  } else if (slide.kind === "point") {
    inner = `<div class="num">0${slide.n}</div>
<h2>${esc(slide.heading)}</h2>
<ul>${slide.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`;
  } else {
    const e = slide.ending || ENDINGS.note;
    inner = `<span class="eyebrow"><b></b>${e.eyebrow}</span>
<h1 style="font-size:88px">${e.head}</h1>
<p class="big">${e.text}</p>
<p class="handle">@${esc(handle)}</p>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@500;700;900&display=block" rel="stylesheet">
<style>
*{margin:0;box-sizing:border-box}
body{width:1080px;height:${height}px;overflow:hidden;font-family:"Zen Kaku Gothic New","Noto Sans CJK JP","IPAGothic",sans-serif;color:#fff;background:#06070c;position:relative}
.aur{position:absolute;inset:-80px;filter:blur(60px);background:radial-gradient(520px 520px at 10% 8%,${a}cc,transparent 60%),radial-gradient(560px 560px at 95% 20%,${b}bb,transparent 60%),radial-gradient(640px 640px at 70% 105%,${c}cc,transparent 60%)}
.grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.07) 1px,transparent 1px);background-size:54px 54px;-webkit-mask-image:radial-gradient(ellipse at 40% 40%,#000,transparent 80%)}
.in{position:absolute;inset:0;padding:110px 96px;display:flex;flex-direction:column;justify-content:center}
.eyebrow{align-self:flex-start;display:inline-flex;align-items:center;gap:12px;font-size:28px;font-weight:700;letter-spacing:.08em;padding:10px 24px;border-radius:999px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.08)}
.eyebrow b{width:12px;height:12px;border-radius:50%;background:${a};box-shadow:0 0 16px ${a}}
h1{font-weight:900;line-height:1.25;margin-top:40px;letter-spacing:-.01em}
.g{background:linear-gradient(110deg,${a},${b},${c});-webkit-background-clip:text;color:transparent}
.swipe{margin-top:56px;font-size:32px;font-weight:700;color:rgba(255,255,255,.8)}
.num{font-size:150px;font-weight:900;line-height:1;background:linear-gradient(110deg,${a},${b},${c});-webkit-background-clip:text;color:transparent}
h2{font-size:72px;font-weight:900;line-height:1.3;margin:28px 0 44px}
ul{list-style:none;display:flex;flex-direction:column;gap:26px}
li{font-size:42px;font-weight:700;line-height:1.55;padding:22px 30px;border-radius:24px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14)}
.big{margin-top:40px;font-size:44px;font-weight:700;line-height:1.6;color:rgba(255,255,255,.9)}
.handle{margin-top:48px;font-size:36px;font-weight:700;color:${a}}
.page{position:absolute;right:56px;top:52px;font-size:26px;font-weight:700;color:rgba(255,255,255,.6)}
.foot{position:absolute;left:96px;bottom:56px;font-size:26px;color:rgba(255,255,255,.55);letter-spacing:.06em}
</style></head><body><div class="aur"></div><div class="grid"></div>${page}<div class="in">${inner}</div>
<div class="foot">UCLA 在学生が書く 英語のはなし</div></body></html>`;
}

// 5枚の JPEG を作って IG_DIR/<id>/ に保存し、そのファイル名を返す（YouTube 用は dir と height を変える）
export async function renderSlides(id, carousel, { title, tag, handle, height = 1350, video = false, baseDir = IG_DIR }) {
  const slides = [
    { kind: "cover", text: carousel.cover },
    ...carousel.points.map((p, i) => ({ kind: "point", n: i + 1, heading: p.heading, lines: p.lines.slice(0, 3) })),
    { kind: "cta", ending: carousel.ending },
  ];
  const dir = path.join(baseDir, id);
  fs.mkdirSync(dir, { recursive: true });
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const files = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height } });
    for (const [i, slide] of slides.entries()) {
      await page.setContent(slideHtml(slide, { title, tag, handle, index: i + 1, total: slides.length, height, video }), { waitUntil: "networkidle", timeout: 20000 })
        .catch(() => {});
      await page.evaluate(() => document.fonts.ready).catch(() => {});
      const name = `${i + 1}.jpg`;
      fs.writeFileSync(path.join(dir, name), await page.screenshot({ type: "jpeg", quality: 90 }));
      files.push(name);
    }
  } finally {
    await browser.close();
  }
  return files;
}

// 古いスライド画像を消す（Instagram が取りに来たあとは要らない。3日分だけ残す）
function cleanupSlides(now = Date.now()) {
  if (!fs.existsSync(IG_DIR)) return;
  for (const d of fs.readdirSync(IG_DIR)) {
    const full = path.join(IG_DIR, d);
    if (now - fs.statSync(full).mtimeMs > 3 * 864e5) fs.rmSync(full, { recursive: true, force: true });
  }
}

// ---- 投稿 ----

// コンテナ（下書き）の準備ができるまで待つ
async function waitReady(id, token, root = API) {
  for (let i = 0; i < 20; i++) {
    const { status_code: status } = await call("GET", `/${id}`, { fields: "status_code", access_token: token }, root);
    if (status === "FINISHED") return;
    if (status === "ERROR" || status === "EXPIRED") throw new Error(`Instagram が画像を受け付けませんでした（${status}）`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("Instagram の画像の準備が終わりませんでした");
}

export async function postArticleToInstagram(article) {
  const base = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
  if (!base) throw new Error("PUBLIC_URL がないので、画像の場所を Instagram に渡せません");
  const s = await session();
  const carousel = await composeCarousel(article);
  const id = `${Date.now().toString(36)}`;
  const files = await renderSlides(id, carousel, {
    title: article.title, tag: [].concat(article.tags || [])[0], handle: s.username,
  });
  const children = [];
  for (const f of files) {
    const { id: child } = await call("POST", `/${s.userId}/media`, { image_url: `${base}/ig/${id}/${f}`, is_carousel_item: "true", access_token: s.token }, rootOf(s));
    children.push(child);
  }
  for (const child of children) await waitReady(child, s.token, rootOf(s));
  const { id: container } = await call("POST", `/${s.userId}/media`, {
    media_type: "CAROUSEL", children: children.join(","), caption: carousel.caption, access_token: s.token,
  }, rootOf(s));
  await waitReady(container, s.token, rootOf(s));
  const { id: mediaId } = await call("POST", `/${s.userId}/media_publish`, { creation_id: container, access_token: s.token }, rootOf(s));
  const log = getInstagramLog();
  log.push({ name: article.name, id: mediaId, cover: carousel.cover, caption: carousel.caption, slides: id, at: new Date().toISOString() });
  writeJson(LOG, log.slice(-500));
  cleanupSlides();
  return { id: mediaId, cover: carousel.cover };
}

export const instagramHandle = () => loadSecret("instagram")?.username || "uspeak_lab";
export const instagramEnabled = () => getSettings().instagramOnPublish && hasInstagramToken();
