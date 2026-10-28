// X（旧 Twitter）に、記事の紹介を自動で投稿する。
// X API v2 の POST /2/tweets を、利用者のアクセストークン（OAuth 1.0a）で呼ぶ。依存ライブラリなし。
// - 記事を公開したら、その紹介を1回投稿
// - 1日1回、過去の記事（よく読まれた・売れたもの優先）をもう一度紹介
import crypto from "crypto";
import path from "path";
import { DATA_DIR } from "./config.mjs";
import { readJson, writeJson, getSettings, getSales } from "./store.mjs";
import { loadSecret, saveSecret } from "./credentials.mjs";
import { listArticles } from "./article.mjs";

const LOG = path.join(DATA_DIR, "x-log.json");
const API = process.env.X_API_BASE || "https://api.x.com/2";

export const getXLog = () => readJson(LOG, []);
export const hasXKeys = () => !!loadSecret("x");

export function setXKeys({ apiKey, apiSecret, accessToken, accessSecret }) {
  if (![apiKey, apiSecret, accessToken, accessSecret].every((v) => v && String(v).trim())) {
    throw new Error("4つのキーをすべて入れてください");
  }
  saveSecret("x", { apiKey: apiKey.trim(), apiSecret: apiSecret.trim(), accessToken: accessToken.trim(), accessSecret: accessSecret.trim() });
}

const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// OAuth 1.0a の署名（JSON の本文は署名に含めない）
export function authHeader(method, url, keys, fixed = {}) {
  const u = new URL(url);
  const oauth = {
    oauth_consumer_key: keys.apiKey,
    oauth_nonce: fixed.nonce || crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: fixed.timestamp || String(Math.floor(Date.now() / 1000)),
    oauth_token: keys.accessToken,
    oauth_version: "1.0",
  };
  const params = [...Object.entries(oauth), ...u.searchParams.entries()]
    .map(([k, v]) => [enc(k), enc(v)])
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const base = [method.toUpperCase(), enc(`${u.origin}${u.pathname}`), enc(params)].join("&");
  const signature = crypto.createHmac("sha1", `${enc(keys.apiSecret)}&${enc(keys.accessSecret)}`).update(base).digest("base64");
  return "OAuth " + Object.entries({ ...oauth, oauth_signature: signature })
    .map(([k, v]) => `${enc(k)}="${enc(v)}"`).join(", ");
}

async function xFetch(method, url, body) {
  const keys = loadSecret("x");
  if (!keys) throw new Error("X のキーが未設定です。管理画面の「X」で入れてください");
  const res = await fetch(url, {
    method,
    headers: { authorization: authHeader(method, url, keys), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`X API ${res.status}: ${json.detail || json.title || JSON.stringify(json).slice(0, 200)}`);
  return json;
}

// 接続の確認（投稿はしない）
export async function xWhoAmI() {
  const { data } = await xFetch("GET", `${API}/users/me`);
  return { username: data.username, name: data.name };
}

// 記事の紹介文を、一番安いモデルで作る（URL は後ろに付ける）
// platform: "threads" なら Threads 向けに少し長め（500文字まで投稿できる）
export async function composePost(article, { again = false, platform = "x" } = {}) {
  const { askJson } = await import("./generator.mjs");
  const threads = platform === "threads";
  const limit = threads ? 200 : 90;
  const { text } = await askJson(`${threads ? "Threads" : "X（旧 Twitter）"}に、note 記事の紹介を1つ書いてください。
- 日本語で全角${limit}文字以内（URL は別で付けるので書かない）${threads ? "\n- 2〜4行に改行して読みやすく。最後の行で、記事を読むと何が手に入るかを書く" : ""}
- 1行目で「誰の、どんな悩みが解決するか」をはっきり書く。煽りすぎない
- 記事にないこと・筆者の経験にないことは書かない
- ハッシュタグは最後に1〜2個まで
${again ? "- 以前にも紹介した記事なので、前回とは違う切り口で\n" : ""}
## 記事
タイトル：${article.title}
価格：${article.price ? `${article.price}円（有料）` : "無料"}
タグ：${(article.tags || []).join(", ")}
冒頭：${(article.body || "").slice(0, 1200)}`, {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
    additionalProperties: false,
  });
  return text.trim().slice(0, limit + 20);
}

export async function postArticle(article, { again = false } = {}) {
  if (!article.url) throw new Error("記事の URL がありません");
  const text = `${await composePost(article, { again })}\n${article.url}`;
  const { data } = await xFetch("POST", `${API}/tweets`, { text });
  const log = getXLog();
  log.push({ name: article.name, id: data.id, text, again, at: new Date().toISOString() });
  writeJson(LOG, log.slice(-1000));
  return { id: data.id, text };
}

// 1日1回の再紹介：14日以内に紹介していない（log はどの SNS の記録で見るか）公開済みの記事から、売上→閲覧数の多い順に選ぶ
export function pickArticleToPromote(now = new Date(), log = getXLog()) {
  const recent = new Set(log.filter((l) => now - Date.parse(l.at) < 14 * 864e5).map((l) => l.name));
  const sales = getSales();
  const score = (name) => sales.filter((s) => s.file === name).reduce((n, s) => n + s.sales * 1000 + s.views, 0);
  return listArticles()
    .filter((a) => a.status === "published" && a.url && !recent.has(a.name))
    .sort((a, b) => score(b.name) - score(a.name))[0] || null;
}

export function shouldPostDaily(now = new Date()) {
  const s = getSettings();
  if (!s.xDailyPromo || !hasXKeys()) return false;
  const jst = new Date(now.getTime() + 9 * 36e5);
  if (jst.getUTCHours() < s.xDailyHour) return false;
  const today = jst.toISOString().slice(0, 10);
  return !getXLog().some((l) => l.again && new Date(Date.parse(l.at) + 9 * 36e5).toISOString().slice(0, 10) === today);
}
