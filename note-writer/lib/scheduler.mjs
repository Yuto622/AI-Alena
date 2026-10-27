// 予約公開と自動生成。Cloud Scheduler から /cron/tick が1時間ごとに呼ばれる想定
import path from "path";
import { paths } from "./config.mjs";
import { listArticles, loadArticle, updateArticleMeta, writeArticleSource } from "./article.mjs";
import { runNote } from "./publisher.mjs";
import { generateArticle } from "./generator.mjs";
import { getSettings, getTopics, saveTopics } from "./store.mjs";
import { rankTopics } from "./insights.mjs";

const JST_OFFSET_MS = 9 * 36e5;

// 予定表の枠（日本時間の曜日・時刻）を、now 以降の UTC の Date として順に返す
export function* upcomingSlots(schedule, now = new Date()) {
  const jstNow = new Date(now.getTime() + JST_OFFSET_MS);
  for (let d = 0; d < 120; d++) {
    const day = new Date(Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate() + d));
    for (const { dow, time } of [...schedule].sort((a, b) => a.time.localeCompare(b.time))) {
      if (day.getUTCDay() !== dow) continue;
      const [h, m] = time.split(":").map(Number);
      const slot = new Date(day.getTime() + (h * 60 + m) * 6e4 - JST_OFFSET_MS);
      if (slot > now) yield slot;
    }
  }
}

export function nextFreeSlot(articles = listArticles()) {
  const taken = new Set(articles.map((a) => a.publish_at).filter(Boolean).map((t) => Date.parse(t)));
  for (const slot of upcomingSlots(getSettings().schedule)) {
    if (!taken.has(slot.getTime())) return slot;
  }
  throw new Error("空いている公開枠がありません（設定の公開スケジュールを確認）");
}

export async function publishArticle(name, { mode = "publish", force = false } = {}) {
  const article = loadArticle(path.join(paths.articles, name));
  const result = await runNote({ account: article.account, article, mode, force });
  if (mode === "publish") updateArticleMeta(name, { status: "published", url: result.url });
  return result;
}

// 次のテーマを1本書いて、空いている枠に予約する
export async function generateNext(topicId) {
  const topics = getTopics();
  const topic = topicId
    ? topics.find((t) => t.id === topicId)
    : rankTopics(topics.filter((t) => t.status === "todo"))[0];
  if (!topic) throw new Error("書けるテーマがありません（ネタ帳に追加してください）");
  const { meta, body } = await generateArticle(topic);
  const slot = nextFreeSlot();
  const name = `${slot.toISOString().slice(0, 10)}-${topic.id}.md`;
  writeArticleSource(name, {
    ...meta,
    status: getSettings().autoApprove ? "ready" : "draft",
    account: topic.account || "default",
    cta: topic.cta || "",
    publish_at: slot.toISOString(),
    topic: topic.id,
  }, body);
  saveTopics(topics.map((t) => (t.id === topic.id ? { ...t, status: "written", article: name } : t)));
  return { name, publish_at: slot.toISOString() };
}

// 1回の呼び出しで「期限の来た記事を1本公開」「予約が足りなければ1本生成」まで
export async function tick(now = new Date()) {
  const report = { published: null, generated: null, errors: [] };
  const due = listArticles().find((a) => a.status === "ready" && a.publish_at && Date.parse(a.publish_at) <= now);
  if (due) {
    try {
      const r = await publishArticle(due.name);
      report.published = { name: due.name, url: r.url };
    } catch (e) {
      // 失敗のたびに note 側へ下書きが増えないよう、人が確認するまで再実行しない
      const msg = e.message.replace(/\u001b\[\d+m/g, "").split("\n")[0];
      updateArticleMeta(due.name, { status: "error", error: msg });
      report.errors.push(`公開失敗 ${due.name}: ${msg}`);
    }
  }
  const settings = getSettings();
  if (settings.autoGenerate) {
    const queued = listArticles().filter((a) => ["draft", "ready"].includes(a.status) && Date.parse(a.publish_at) > now);
    if (queued.length < settings.bufferSize) {
      try {
        report.generated = await generateNext();
      } catch (e) {
        report.errors.push(`生成失敗: ${e.message}`);
      }
    }
  }
  return report;
}
