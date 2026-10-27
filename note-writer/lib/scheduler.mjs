// 予約公開と自動生成。Cloud Scheduler から /cron/tick が1時間ごとに呼ばれる想定
import path from "path";
import { paths } from "./config.mjs";
import { listArticles, loadArticle, updateArticleMeta, writeArticleSource } from "./article.mjs";
import { runNote } from "./publisher.mjs";
import { generateArticle, reviewArticle, suggestTopics } from "./generator.mjs";
import { getSettings, getTopics, saveTopics } from "./store.mjs";
import { rankTopics, bestTags } from "./insights.mjs";

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

// ネタ帳に未着手のテーマがなければ、新しいテーマを足す
async function refillTopics(topics) {
  if (topics.some((t) => t.status === "todo")) return topics;
  const fresh = await suggestTopics({ existing: topics.map((t) => t.title), bestTags: bestTags() });
  const added = fresh.map((t, i) => ({
    id: `${Date.now().toString(36)}${i}`,
    title: t.title,
    price: [0, 500, 980].includes(t.price) ? t.price : 500,
    tags: t.tags,
    status: "todo",
    auto: true,
  }));
  const next = [...topics, ...added];
  saveTopics(next);
  return next;
}

// 次のテーマを1本書いて、空いている枠に予約する。自動チェックに通ったものだけ公開OKにする
export async function generateNext(topicId) {
  const topics = topicId ? getTopics() : await refillTopics(getTopics());
  const topic = topicId
    ? topics.find((t) => t.id === topicId)
    : rankTopics(topics.filter((t) => t.status === "todo"))[0];
  if (!topic) throw new Error("書けるテーマがありません（ネタ帳に追加してください）");
  const { meta, body } = await generateArticle(topic);
  const review = await reviewArticle(meta, body);
  const approved = getSettings().autoApprove && review.ok;
  const slot = nextFreeSlot();
  const name = `${slot.toISOString().slice(0, 10)}-${topic.id}.md`;
  writeArticleSource(name, {
    ...meta,
    status: approved ? "ready" : "draft",
    account: topic.account || "default",
    cta: topic.cta || "",
    // 自動チェックで止めた記事は枠を空けておく（次の記事がその枠に入れるように）
    publish_at: review.ok ? slot.toISOString() : "",
    topic: topic.id,
    error: review.ok ? "" : `自動チェックで止めました：${review.problems.join(" / ")}`,
  }, body);
  const writtenAt = new Date().toISOString();
  saveTopics(topics.map((t) => (t.id === topic.id ? { ...t, status: "written", article: name, writtenAt } : t)));
  return { name, publish_at: review.ok ? slot.toISOString() : null, approved, problems: review.problems };
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
    // 自動チェックで止まり続けても、1日に生成する本数には上限をかける（費用とテーマの使いすぎを防ぐ）
    const today = new Date(now.getTime() + 9 * 36e5).toISOString().slice(0, 10);
    const writtenToday = getTopics().filter((t) =>
      t.writtenAt && new Date(Date.parse(t.writtenAt) + 9 * 36e5).toISOString().slice(0, 10) === today).length;
    if (queued.length < settings.bufferSize && writtenToday < settings.dailyGenerateLimit) {
      try {
        report.generated = await generateNext();
      } catch (e) {
        report.errors.push(`生成失敗: ${e.message}`);
      }
    }
  }
  return report;
}
