// LINE 公式アカウントで、週1回「今週の記事」を友だち全員に送る（Messaging API の一斉配信）。
// 無料プランは月200通まで（1通 = 1人に1回）。足りないときは送らずに記録だけ残す
import path from "path";
import { DATA_DIR } from "./config.mjs";
import { readJson, writeJson, getSettings, getPublished } from "./store.mjs";
import { loadSecret, saveSecret } from "./credentials.mjs";
import { listArticles } from "./article.mjs";

const LOG = path.join(DATA_DIR, "line-log.json");
const API = process.env.LINE_API_BASE || "https://api.line.me";

export const getLineLog = () => readJson(LOG, []);
export const hasLineToken = () => !!loadSecret("line");

async function call(method, pathname, body) {
  const s = loadSecret("line");
  if (!s) throw new Error("LINE のチャネルアクセストークンが未設定です。管理画面の「SNS・LINE」で入れてください");
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: { authorization: `Bearer ${s.token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`LINE API ${res.status}: ${json.message || JSON.stringify(json).slice(0, 200)}`);
  return json;
}

export async function setLineToken(token) {
  token = String(token || "").trim();
  if (!token) throw new Error("チャネルアクセストークンを入れてください");
  // 試してみて、だめなら前のトークンに戻す
  const prev = loadSecret("line");
  saveSecret("line", { token });
  try {
    return await lineWhoAmI();
  } catch (e) {
    saveSecret("line", prev);
    throw e;
  }
}

export async function lineWhoAmI() {
  const bot = await call("GET", "/v2/bot/info");
  return { name: bot.displayName, basicId: bot.basicId, ...(await lineQuota()) };
}

// 今月あと何通送れるか（上限のないプランなら Infinity）
export async function lineQuota() {
  const quota = await call("GET", "/v2/bot/message/quota");
  const used = (await call("GET", "/v2/bot/message/quota/consumption")).totalUsage || 0;
  return { limit: quota.type === "limited" ? quota.value : null, used, left: quota.type === "limited" ? quota.value - used : Infinity };
}

// 一斉配信が何人に届くか（前日の集計。まだ出ていなければ null）
async function reach(now) {
  const day = new Date(now.getTime() + 9 * 36e5 - 864e5).toISOString().slice(0, 10).replace(/-/g, "");
  const r = await call("GET", `/v2/bot/insight/followers?date=${day}`).catch(() => null);
  return r?.status === "ready" ? r.targetedReaches : null;
}

export function digestText(articles) {
  const lines = articles.map((a) => `▶ ${a.title}${a.price ? `（${a.price}円）` : "（無料）"}\n${a.url}`);
  return `今週の記事です📮\n\n${lines.join("\n\n")}\n\n気になるものから読んでみてください。`.slice(0, 4900);
}

export function shouldSendDigest(now = new Date()) {
  const s = getSettings();
  if (!s.lineDigest || !hasLineToken()) return false;
  const jst = new Date(now.getTime() + 9 * 36e5);
  if (jst.getUTCDay() !== Number(s.lineDigestDow) || jst.getUTCHours() < s.lineDigestHour) return false;
  // 同じ週に2回送らない（成功・見送りのどちらでも）
  return !getLineLog().some((l) => now - Date.parse(l.at) < 6 * 864e5);
}

// 直近7日に公開した記事をまとめて送る。新しい記事がなければ送らない
export async function sendDigest(now = new Date(), { force = false } = {}) {
  // 実際に公開した日時は公開の記録で見る（予定より早く手で公開した記事もあるため）
  const articles = new Map(listArticles().map((a) => [a.name, a]));
  const seen = new Set();
  const week = getPublished()
    .filter((e) => !e.draft && now - Date.parse(e.at) < 7 * 864e5 && Date.parse(e.at) <= now.getTime())
    .map((e) => ({ ...e, ...(articles.get(e.name) || {}) }))
    .filter((a) => /^https:\/\//.test(a.url || "") && !seen.has(a.name) && seen.add(a.name));
  const log = getLineLog();
  const record = (entry) => {
    log.push({ ...entry, at: now.toISOString() });
    writeJson(LOG, log.slice(-200));
    return entry;
  };
  if (!week.length) return record({ sent: false, reason: "今週公開した記事がありません" });
  const { left } = await lineQuota();
  const people = await reach(now);
  if (!force && people !== null && people > left) {
    return record({ sent: false, reason: `今月の残り ${left} 通に対して、友だちが ${people} 人いるので見送りました` });
  }
  const text = digestText(week);
  await call("POST", "/v2/bot/message/broadcast", { messages: [{ type: "text", text }] });
  return record({ sent: true, count: week.length, people, text });
}
