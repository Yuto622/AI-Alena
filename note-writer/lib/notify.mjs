// 止まったときの通知と、週1回の成果レポート（Slack / Discord / Google Chat の Webhook。どれも無料）。
// - 予約実行で失敗があったら、何が止まったか・どう直すかを送る（同じ失敗は24時間に1回まで）
// - 毎週月曜の朝、先週の公開本数・どこが何回押されたか・売上を送る
import path from "path";
import { DATA_DIR } from "./config.mjs";
import { readJson, writeJson, getSettings, getPublished, getSales } from "./store.mjs";
import { loadSecret, saveSecret } from "./credentials.mjs";
import { getApps } from "./apps.mjs";

const STATE = path.join(DATA_DIR, "notify-state.json");
const CLICKS = path.join(DATA_DIR, "clicks.json");

export const hasWebhook = () => !!loadSecret("webhook")?.url;

export function setWebhook(url) {
  url = String(url || "").trim();
  if (!/^https:\/\/(hooks\.slack\.com|discord(app)?\.com\/api\/webhooks|chat\.googleapis\.com)\//.test(url)) {
    throw new Error("Slack・Discord・Google Chat の Webhook URL（https://hooks.slack.com/… など）を入れてください");
  }
  saveSecret("webhook", { url });
}

// 送り先の種類に合わせて本文の形を変える
export async function notify(text) {
  const url = loadSecret("webhook")?.url;
  if (!url) return false;
  const body = /discord/.test(url) ? { content: text.slice(0, 1900) } : { text: text.slice(0, 3900) };
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`通知の送信 ${res.status}`);
  return true;
}

// よくある失敗に、直し方を添える
function hint(error) {
  // SNS の失敗は、SNS ごとの直し方を先に見る（「401」などで別の原因と取り違えないため）
  if (/^(Threads|Instagram)/.test(error)) return "→ 管理画面の「SNS・LINE・ブログ」で、その SNS のトークンを入れ直して接続確認をしてください";
  if (/^(YouTube|TikTok)/.test(error)) return "→ 管理画面の「SNS・LINE・ブログ」で、もう一度「連携」を押してください";
  if (/^動画づくり/.test(error)) return "→ 音声合成か動画の作成で失敗しました。次の公開でも続くなら「実行ログ」を確認してください";
  if (/ログイン|cookie|login/i.test(error)) return "→ 管理画面の「設定」で、note のログイン状態（cookie）を貼り直してください";
  if (/bearer|api key|authentication|401/i.test(error)) return "→ Anthropic の API キーが切れています。キーを作り直して入れ直してください";
  if (/credit|balance|billing|402/i.test(error)) return "→ Anthropic のクレジット（残高）を確認してください";
  return "→ 管理画面の「実行ログ」で、そのときの画面を確認してください";
}

// 予約実行の結果から、失敗だけを送る
export async function notifyErrors(report, now = new Date()) {
  if (!hasWebhook()) return;
  const errors = [...(report.errors || [])];
  const LABELS = { threadsError: "Threads", instagramError: "Instagram", youtubeError: "YouTube", tiktokError: "TikTok", videoError: "動画づくり", xError: "X" };
  for (const [k, v] of Object.entries(report.published?.sideErrors || {})) errors.push(`${LABELS[k] || k} への投稿失敗: ${v}`);
  if (!errors.length) return;
  const state = readJson(STATE, { sent: {} });
  const fresh = errors.filter((e) => now - Date.parse(state.sent[e] || 0) > 864e5);
  if (!fresh.length) return;
  await notify(`⚠️ note 自動化で止まっているところがあります\n\n${fresh.map((e) => `・${e}\n  ${hint(e)}`).join("\n")}`);
  for (const e of fresh) state.sent[e] = now.toISOString();
  // 古い記録は消す
  state.sent = Object.fromEntries(Object.entries(state.sent).filter(([, at]) => now - Date.parse(at) < 7 * 864e5));
  writeJson(STATE, state);
}

export function shouldSendWeekly(now = new Date()) {
  if (!hasWebhook()) return false;
  const jst = new Date(now.getTime() + 9 * 36e5);
  if (jst.getUTCDay() !== 1 || jst.getUTCHours() < 9) return false;
  const state = readJson(STATE, { sent: {} });
  return !state.weeklyAt || now - Date.parse(state.weeklyAt) > 6 * 864e5;
}

// 先週1週間の成果
export function weeklyText(now = new Date()) {
  const since = now.getTime() - 7 * 864e5;
  const published = getPublished().filter((p) => !p.draft && Date.parse(p.at) >= since);
  const clicks = readJson(CLICKS, []).filter((c) => Date.parse(c.at) >= since);
  const names = Object.fromEntries(getApps().map((a) => [a.id, a.name]));
  const byApp = {};
  for (const c of clicks) {
    const [id, site] = c.app.split(":");
    const label = `${names[id] || id}${site ? "（ホームページ）" : ""}`;
    byApp[label] = (byApp[label] || 0) + 1;
  }
  const bySource = { 記事: 0, SNS: 0, ブログ: 0, リンク集: 0 };
  for (const c of clicks) {
    const a = String(c.article || "");
    bySource[a.startsWith("sns:") ? "SNS" : a.startsWith("blog:") ? "ブログ" : a === "links" ? "リンク集" : "記事"]++;
  }
  const month = new Date(now.getTime() + 9 * 36e5).toISOString().slice(0, 7);
  const prices = Object.fromEntries(getPublished().map((p) => [p.name, p.price || 0]));
  const monthSales = getSales().filter((s) => s.month === month);
  const gross = monthSales.reduce((n, s) => n + s.sales * (prices[s.file] || 0), 0);
  const sold = monthSales.reduce((n, s) => n + s.sales, 0);
  const net = Math.round(gross * (1 - getSettings().feeRate));
  const top = Object.entries(byApp).sort((a, b) => b[1] - a[1]);
  return [
    "📊 先週の成果（note 自動化）",
    "",
    `公開：${published.length} 本`,
    `申し込みページへのクリック：${clicks.length} 回`,
    ...top.map(([k, v]) => `  ・${k}：${v} 回`),
    `どこから：${Object.entries(bySource).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join("／") || "まだありません"}`,
    "",
    `今月の note 有料記事：${sold} 本・手取り約 ${net.toLocaleString()} 円`,
    "",
    clicks.length ? "クリックの多い送り先の記事を増やすと、売上が伸びやすくなります。" : "まだクリックがありません。記事が増えると数字が出てきます。",
  ].join("\n");
}

export async function sendWeekly(now = new Date()) {
  await notify(weeklyText(now));
  const state = readJson(STATE, { sent: {} });
  writeJson(STATE, { ...state, weeklyAt: now.toISOString() });
  return true;
}
