// 実績（売上・閲覧数・アプリのクリック）から学んで、次の判断に使う仕組み。
// モデルそのものは学習し直せないので、(1) アプリ選びは実績の数字で決め、
// (2) 週に1回「何が効いたか」のメモを作って、記事・テーマ・アプリを選ぶときに毎回 AI に渡す
import fs from "fs";
import path from "path";
import { DATA_DIR } from "./config.mjs";
import { listArticles } from "./article.mjs";
import { getSales, getSettings, readJson, writeJson } from "./store.mjs";
import { getApps, clickStats } from "./apps.mjs";

const MEMO = path.join(DATA_DIR, "learnings.md");
const MEMO_STATE = path.join(DATA_DIR, "learnings.json");

export const getLearnings = () => (fs.existsSync(MEMO) ? fs.readFileSync(MEMO, "utf8") : "");

// アプリごとの実績：載せた記事の数と、記事1本あたりのクリック数
export function appPerformance() {
  const published = listArticles().filter((a) => a.status === "published" && a.app);
  const stats = clickStats();
  return getApps().map((app) => {
    const exposures = published.filter((a) => a.app === app.id).length;
    // 予約・ダウンロードへのクリックを成果として数える（ホームページへのクリックは別に見る）
    const clicks = stats[app.id]?.total || 0;
    const siteClicks = stats[`${app.id}:site`]?.total || 0;
    return { id: app.id, name: app.name, exposures, clicks, siteClicks, perArticle: exposures ? clicks / exposures : null };
  });
}

// 何割かは、候補（記事に合うもの）の中から載せた回数の少ないものを選んでデータを集める
export function exploreChoice(candidates, rng = Math.random) {
  const perf = appPerformance().filter((p) => candidates.includes(p.id));
  if (perf.length < 2 || rng() >= getSettings().exploreRate) return null;
  return perf.sort((a, b) => a.exposures - b.exposures)[0].id;
}

// AI に渡す実績の表（記事ごと）
function performanceTable() {
  const sales = getSales();
  const stats = clickStats();
  return listArticles().filter((a) => a.status === "published").map((a) => {
    const rows = sales.filter((s) => s.file === a.name);
    const sold = rows.reduce((n, r) => n + r.sales, 0);
    const views = rows.reduce((n, r) => n + r.views, 0);
    const clicks = a.app ? stats[a.app]?.byArticle[a.name] || 0 : 0;
    return `- 「${a.title}」 価格${a.price}円 タグ[${a.tags.join(", ")}] 閲覧${views} 販売${sold} アプリ${a.app || "なし"} クリック${clicks}`;
  }).join("\n");
}

// 週に1回、実績から「効いたこと・効かなかったこと」をまとめる。データが少ないうちは作らない
export async function updateLearnings(now = new Date(), { force = false } = {}) {
  const state = readJson(MEMO_STATE, {});
  if (!force && state.at && now - Date.parse(state.at) < 7 * 864e5) return { skipped: "1週間たっていません" };
  const table = performanceTable();
  const rows = table ? table.split("\n").length : 0;
  if (rows < 3) return { skipped: "公開した記事が3本未満です" };
  const { askJson } = await import("./generator.mjs");
  const { memo } = await askJson(`note の記事の実績です。次の記事づくりに使う「学び」を、箇条書き5〜8行でまとめてください。
- 数字から言えることだけを書く。データが少なくて言えないことは「まだ判断できない」と書く
- 「どんなタイトル・テーマ・価格・タグが読まれた／売れたか」「どの記事でどのアプリがクリックされたか」に分けて書く
- 最後に「次に試すこと」を2行

## 前回の学び
${getLearnings() || "（なし）"}

## アプリごと
${appPerformance().map((p) => `- ${p.name}：載せた記事${p.exposures}本、クリック${p.clicks}`).join("\n") || "（アプリ未登録）"}

## 記事ごと
${table}`, {
    type: "object",
    properties: { memo: { type: "string" } },
    required: ["memo"],
    additionalProperties: false,
  });
  fs.writeFileSync(MEMO, memo.trim() + "\n");
  writeJson(MEMO_STATE, { at: now.toISOString(), rows });
  return { updated: true };
}
