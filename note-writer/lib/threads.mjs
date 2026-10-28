// Threads に、記事の紹介を自動で投稿する（Threads API は無料）。
// 自分のアカウントだけに投稿するので、Meta のアプリは「開発中」のまま、自分をテスターにすれば審査なしで使える。
// - 記事を公開したら、その紹介を1回投稿
// - 1日1回、過去の記事（よく読まれた・売れたもの優先）をもう一度紹介
// アクセストークンは60日で切れるので、7日ごとに自動で延長する
import path from "path";
import { DATA_DIR } from "./config.mjs";
import { readJson, writeJson, getSettings } from "./store.mjs";
import { loadSecret, saveSecret } from "./credentials.mjs";
import { composePost } from "./x.mjs";

const LOG = path.join(DATA_DIR, "threads-log.json");
const API = process.env.THREADS_API_BASE || "https://graph.threads.net";

export const getThreadsLog = () => readJson(LOG, []);
export const hasThreadsToken = () => !!loadSecret("threads");

async function call(method, pathname, params) {
  const url = new URL(`${API}${pathname}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { method });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Threads API ${res.status}: ${json.error?.message || JSON.stringify(json).slice(0, 200)}`);
  return json;
}

// トークンを確かめてから保存する（自分の ID もここで控える）
export async function setThreadsToken(token) {
  token = String(token || "").trim();
  if (!token) throw new Error("アクセストークンを入れてください");
  const me = await call("GET", "/v1.0/me", { fields: "id,username", access_token: token });
  saveSecret("threads", { token, userId: me.id, username: me.username, refreshedAt: new Date().toISOString() });
  return { username: me.username };
}

export async function threadsWhoAmI() {
  const s = await session();
  const me = await call("GET", "/v1.0/me", { fields: "id,username", access_token: s.token });
  return { username: me.username };
}

// 7日たったトークンは延長しておく（60日使わないと切れるため）
async function session(now = new Date()) {
  const s = loadSecret("threads");
  if (!s) throw new Error("Threads のアクセストークンが未設定です。管理画面の「SNS・LINE」で入れてください");
  if (now - Date.parse(s.refreshedAt || 0) > 7 * 864e5) {
    try {
      const r = await call("GET", "/refresh_access_token", { grant_type: "th_refresh_token", access_token: s.token });
      Object.assign(s, { token: r.access_token, refreshedAt: now.toISOString() });
      saveSecret("threads", s);
    } catch (e) {
      console.error(`Threads のトークン延長に失敗：${e.message}`);
    }
  }
  return s;
}

// 投稿は「下書きを作る → 公開する」の2段階。下書きの準備に少し時間がかかることがある
export async function postToThreads(text) {
  const s = await session();
  const { id: creationId } = await call("POST", `/v1.0/${s.userId}/threads`, { media_type: "TEXT", text, access_token: s.token });
  let lastError;
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, i === 0 ? 3000 : 10000));
    try {
      const { id } = await call("POST", `/v1.0/${s.userId}/threads_publish`, { creation_id: creationId, access_token: s.token });
      return id;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

export async function postArticleToThreads(article, { again = false } = {}) {
  if (!article.url) throw new Error("記事の URL がありません");
  const text = `${await composePost(article, { again, platform: "threads" })}\n\n${article.url}`;
  const id = await postToThreads(text);
  const log = getThreadsLog();
  log.push({ name: article.name, id, text, again, at: new Date().toISOString() });
  writeJson(LOG, log.slice(-1000));
  return { id, text };
}

export function shouldPostThreadsDaily(now = new Date()) {
  const s = getSettings();
  if (!s.threadsDailyPromo || !hasThreadsToken()) return false;
  const jst = new Date(now.getTime() + 9 * 36e5);
  if (jst.getUTCHours() < s.threadsDailyHour) return false;
  const today = jst.toISOString().slice(0, 10);
  return !getThreadsLog().some((l) => l.again && new Date(Date.parse(l.at) + 9 * 36e5).toISOString().slice(0, 10) === today);
}
