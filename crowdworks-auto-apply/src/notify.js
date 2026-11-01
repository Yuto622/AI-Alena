/**
 * Slack 通知（Incoming Webhook）。
 * - 送信結果を確認し、失敗したら少し待って再試行
 * - 重要な通知（受注など）が最終的に失敗したら data/notify-queue.jsonl に保存し、次回の巡回で再送
 */
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config.js";
import { sleep } from "./util.js";

const QUEUE_FILE = () => path.join(DATA_DIR, "notify-queue.jsonl");

export function slackConfigured() {
  return /^https:\/\/hooks\.slack\.com\//.test(process.env.SLACK_WEBHOOK_URL ?? "");
}

/** Slack へ直接送信（キューに入れない）。管理画面のテスト送信用 */
export async function sendSlack(payload, opts) {
  return post(payload, opts);
}

async function post(payload, { attempts = 3, fetchImpl = fetch } = {}) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return { ok: false, error: "SLACK_WEBHOOK_URL が未設定" };
  let error = "";
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return { ok: true };
      error = `HTTP ${res.status} ${await res.text().catch(() => "")}`.trim();
      if (res.status >= 400 && res.status < 500 && res.status !== 429) break; // URL 間違い等は再試行しても無駄
    } catch (e) {
      error = e.message;
    }
    if (i < attempts - 1) await sleep(1000 * 3 ** i);
  }
  return { ok: false, error };
}

/** 通常の通知（失敗してもログに残すだけ） */
export async function notify(text, opts) {
  if (!process.env.SLACK_WEBHOOK_URL) return { ok: false, error: "未設定" };
  const r = await post({ text }, opts);
  if (!r.ok) console.warn("[notify] Slack 通知に失敗:", r.error);
  return r;
}

/** 重要な通知: 失敗したらキューに保存して後で再送 */
export async function notifyImportant(payload, opts) {
  if (!process.env.SLACK_WEBHOOK_URL) return { ok: false, error: "未設定" };
  const r = await post(payload, opts);
  if (!r.ok) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(QUEUE_FILE(), JSON.stringify({ at: new Date().toISOString(), payload, error: r.error }) + "\n");
    console.warn("[notify] 重要通知の送信に失敗。キューに保存しました:", r.error);
  }
  return r;
}

/** キューに残った重要通知を再送（巡回の最初に呼ぶ） */
export async function flushNotifyQueue(opts) {
  const file = QUEUE_FILE();
  if (!fs.existsSync(file) || !process.env.SLACK_WEBHOOK_URL) return { sent: 0, remaining: 0 };
  const items = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const remaining = [];
  let sent = 0;
  for (const it of items) {
    const r = await post(it.payload, { attempts: 1, ...opts });
    if (r.ok) sent++;
    else remaining.push({ ...it, error: r.error });
  }
  if (remaining.length) fs.writeFileSync(file, remaining.map((x) => JSON.stringify(x)).join("\n") + "\n");
  else fs.unlinkSync(file);
  return { sent, remaining: remaining.length };
}

const yen = (n) => (n == null ? "不明" : `${Number(n).toLocaleString("ja-JP")}円`);

/** 受注通知（Slack の Block Kit で見やすく） */
export function contractMessage({ title, jobUrl, threadUrl, amountYen, proposedYen, contractType, source, kickoffSent }) {
  const how = source === "manual" ? "ご自身で承諾した契約を検知しました" : "ボットが条件を確認して自動承諾しました";
  const text = `🎉 受注しました: ${title ?? "（案件名不明）"} — ${yen(amountYen)}`;
  const fields = [
    `*契約金額*\n${yen(amountYen)}${contractType === "hourly" ? "（時給）" : ""}`,
    `*提案額*\n${yen(proposedYen)}`,
    `*承諾*\n${source === "manual" ? "手動" : "自動"}`,
    `*着手連絡*\n${source === "manual" ? "—" : kickoffSent ? "送信済み" : "未送信（要対応）"}`,
  ];
  const links = [jobUrl && `<${jobUrl}|案件ページ>`, threadUrl && `<${threadUrl}|メッセージ>`].filter(Boolean).join("　");
  return {
    text,
    blocks: [
      { type: "header", text: { type: "plain_text", text: "🎉 CrowdWorks 受注しました", emoji: true } },
      { type: "section", text: { type: "mrkdwn", text: `*${(title ?? "（案件名不明）").replace(/[<>&]/g, "")}*\n${how}` } },
      { type: "section", fields: fields.map((t) => ({ type: "mrkdwn", text: t })) },
      ...(links ? [{ type: "context", elements: [{ type: "mrkdwn", text: links }] }] : []),
    ],
  };
}
