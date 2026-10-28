// 予約公開と自動生成。Cloud Scheduler から /cron/tick が1時間ごとに呼ばれる想定
import path from "path";
import { paths } from "./config.mjs";
import { listArticles, loadArticle, updateArticleMeta, writeArticleSource, readArticleSource } from "./article.mjs";
import { getApps, chooseApp } from "./apps.mjs";
import { updateLearnings } from "./learning.mjs";
import { importStatsDaily } from "./stats.mjs";
import { shouldScoutTrends, scoutTrends } from "./trends.mjs";
import { hasXKeys, postArticle, pickArticleToPromote, shouldPostDaily } from "./x.mjs";
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
  // 予定より早く（手で）公開した記事は、その枠を使っていないので空きとして扱う
  const taken = new Set(articles.filter((a) => a.status !== "published").map((a) => a.publish_at).filter(Boolean).map((t) => Date.parse(t)));
  for (const slot of upcomingSlots(getSettings().schedule)) {
    if (!taken.has(slot.getTime())) return slot;
  }
  throw new Error("空いている公開枠がありません（設定の公開スケジュールを確認）");
}

// 記事に書き込む app の値：選んだ id ／ 合うものがなければ "none" ／ アプリ未登録・AI に聞けなかったら空（公開前に選び直す）
async function appForMeta(article) {
  if (getApps().length === 0) return "";
  const app = await chooseApp(article);
  return app === undefined ? "" : app || "none";
}

// アプリが登録されていて、記事にまだ選ばれていなければ選んでおく
async function ensureApp(name) {
  const { meta, body } = readArticleSource(name);
  if (meta.app || getApps().length === 0) return;
  const app = await chooseApp({ title: meta.title, tags: Array.isArray(meta.tags) ? meta.tags : [meta.tags], body });
  // 合うものがなければ "none" を記録して、毎回聞き直さない（AI に聞けなかったときは何もしない）
  if (app !== undefined) updateArticleMeta(name, { app: app || "none" });
}

export async function publishArticle(name, { mode = "publish", force = false } = {}) {
  await ensureApp(name);
  const article = loadArticle(path.join(paths.articles, name));
  const result = await runNote({ account: article.account, article, mode, force });
  if (mode === "publish") {
    updateArticleMeta(name, { status: "published", url: result.url });
    // 公開したら X で紹介する（失敗しても公開は成功のまま）
    if (getSettings().xOnPublish && hasXKeys()) {
      try {
        const { meta, body } = readArticleSource(name);
        result.x = await postArticle({ ...meta, name, body, url: result.url, tags: Array.isArray(meta.tags) ? meta.tags : [meta.tags] });
      } catch (e) {
        result.xError = e.message;
      }
    }
  }
  return result;
}

// ネタ帳に未着手のテーマがなければ、新しいテーマを足す
// 読者層ごとの割合と、最近書いた記事の割合を比べて、一番足りない読者層を選ぶ
function nextAudience(topics) {
  const audiences = getSettings().audiences;
  const recent = topics.filter((t) => t.writtenAt).sort((a, b) => b.writtenAt.localeCompare(a.writtenAt)).slice(0, 10);
  const share = (id) => recent.filter((t) => (t.audience || audiences[0].id) === id).length / Math.max(recent.length, 1);
  return [...audiences].sort((a, b) => (b.share - share(b.id)) - (a.share - share(a.id)))[0];
}

// その読者層の未着手のテーマがなければ、新しいテーマを足す
async function refillTopics(topics, audience) {
  const defaultId = getSettings().audiences[0].id;
  if (topics.some((t) => t.status === "todo" && (t.audience || defaultId) === audience.id)) return topics;
  const fresh = await suggestTopics({ existing: topics.map((t) => t.title), bestTags: bestTags(), audience: audience.name });
  const added = fresh.map((t, i) => ({
    id: `${Date.now().toString(36)}${i}`,
    title: t.title,
    price: [0, 500, 980].includes(t.price) ? t.price : 500,
    tags: t.tags,
    audience: audience.id,
    status: "todo",
    auto: true,
  }));
  const next = [...topics, ...added];
  saveTopics(next);
  return next;
}

// 次のテーマを1本書いて、空いている枠に予約する。自動チェックに通ったものだけ公開OKにする
export async function generateNext(topicId) {
  let topics = getTopics();
  let topic;
  if (topicId) {
    topic = topics.find((t) => t.id === topicId);
  } else {
    const audience = nextAudience(topics);
    topics = await refillTopics(topics, audience);
    const defaultId = getSettings().audiences[0].id;
    topic = rankTopics(topics.filter((t) => t.status === "todo" && (t.audience || defaultId) === audience.id))[0];
  }
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
    app: await appForMeta({ title: meta.title, tags: meta.tags || [], body }),
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
      if (e.code === "TOO_SOON") {
        // 前の公開から間がないだけ。次の実行でもう一度試す
        report.waiting = { name: due.name, reason: e.message };
      } else {
        // 失敗のたびに note 側へ下書きが増えないよう、人が確認するまで再実行しない
        const msg = e.message.replace(/\u001b\[\d+m/g, "").split("\n")[0];
        updateArticleMeta(due.name, { status: "error", error: msg });
        report.errors.push(`公開失敗 ${due.name}: ${msg}`);
      }
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
  // 話題枠：朝に1回、note の急上昇・注目キーワードから、英語・海外につなげられる話題を探して書く（週の上限あり）
  if (settings.trendEnabled && shouldScoutTrends(now)) {
    try {
      report.trend = await scoutTrends(now);
    } catch (e) {
      report.errors.push(`話題枠の失敗: ${e.message.split("\n")[0]}`);
    }
  }
  // 1日1回、note のダッシュボードから閲覧数・販売数を取り込む
  if (settings.statsImport) {
    try {
      report.stats = await importStatsDaily(now);
    } catch (e) {
      report.errors.push(`数字の取り込み失敗: ${e.message.split("\n")[0]}`);
    }
  }
  // 1日1回、過去の記事を X でもう一度紹介する
  if (shouldPostDaily(now)) {
    const a = pickArticleToPromote(now);
    if (a) {
      try {
        const { body } = readArticleSource(a.name);
        report.x = await postArticle({ ...a, body }, { again: true });
      } catch (e) {
        report.errors.push(`X への投稿失敗: ${e.message}`);
      }
    }
  }
  // 週に1回、実績から学びをまとめ直す（中で1週間たったかを見ている）
  try {
    report.learnings = await updateLearnings(now);
  } catch (e) {
    report.errors.push(`学びの更新失敗: ${e.message}`);
  }
  return report;
}
