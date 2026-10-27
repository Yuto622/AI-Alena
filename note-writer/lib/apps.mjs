// 記事の最後で紹介するスマホアプリ。管理画面で登録し、記事ごとに一番合うものを選ぶ
import path from "path";
import { DATA_DIR } from "./config.mjs";
import { readJson, writeJson } from "./store.mjs";

const APPS = path.join(DATA_DIR, "apps.json");
const CLICKS = path.join(DATA_DIR, "clicks.json");

export const getApps = () => readJson(APPS, []);
export function saveApps(apps) {
  for (const a of apps) {
    if (!a.id || !/^[\w-]+$/.test(a.id)) throw new Error("アプリの ID が不正です");
    if (!/^https:\/\//.test(a.url || "")) throw new Error(`「${a.name}」の URL は https:// から書いてください`);
  }
  writeJson(APPS, apps);
}

export function recordClick(appId, article) {
  const clicks = readJson(CLICKS, []);
  clicks.push({ app: appId, article: String(article || "").slice(0, 120), at: new Date().toISOString() });
  writeJson(CLICKS, clicks.slice(-5000));
}

// アプリごと・記事ごとのクリック数
export function clickStats() {
  const stats = {};
  for (const c of readJson(CLICKS, [])) {
    stats[c.app] ??= { total: 0, byArticle: {} };
    stats[c.app].total++;
    stats[c.app].byArticle[c.article] = (stats[c.app].byArticle[c.article] || 0) + 1;
  }
  return stats;
}

// 記事の内容に一番合うアプリを選ぶ。選べなければ一覧の先頭
export async function chooseApp({ title, tags, body }) {
  const apps = getApps();
  if (apps.length <= 1) return apps[0]?.id || null;
  try {
    // article.mjs → apps.mjs → generator.mjs → article.mjs の循環を避けるため、使うときに読み込む
    const { askJson } = await import("./generator.mjs");
    const { exploreChoice, appPerformance, getLearnings } = await import("./learning.mjs");
    // 一定の割合で、まだ載せた回数の少ないアプリを試してデータを集める
    const explore = exploreChoice();
    if (explore) return explore;
    const perf = Object.fromEntries(appPerformance().map((p) => [p.id, p]));
    const { appId } = await askJson(`note 記事の最後で紹介するスマホアプリを1つ選んでください。
記事を読み終えた人が「今すぐ入れたい」と思うもの、つまり記事の悩みや目的に一番近いアプリを選びます。
内容の合い方が同じくらいなら、「記事1本あたりのクリック数」が多いものを選びます。

## これまでの学び
${getLearnings() || "（まだデータがありません）"}

## 記事
タイトル：${title}
タグ：${(tags || []).join(", ")}
冒頭：${body.slice(0, 1500)}

## アプリ
${apps.map((a) => `- id: ${a.id}
  名前：${a.name}
  内容：${a.description || ""}
  向いている人：${a.audience || ""}
  載せた記事：${perf[a.id]?.exposures || 0}本、記事1本あたりのクリック：${perf[a.id]?.perArticle?.toFixed(2) ?? "まだなし"}`).join("\n")}`, {
      type: "object",
      properties: { appId: { type: "string", enum: apps.map((a) => a.id) } },
      required: ["appId"],
      additionalProperties: false,
    });
    return appId;
  } catch (e) {
    console.error(`アプリの自動選択に失敗：${e.message}`);
    return apps[0].id;
  }
}

// 記事の最後に付ける紹介文（Markdown）。PUBLIC_URL があれば、クリックを数えるために自分のサーバーを経由させる
export function appCtaMarkdown(appId, articleName) {
  const app = getApps().find((a) => a.id === appId);
  if (!app) return "";
  const base = process.env.PUBLIC_URL;
  const link = base ? `${base}/go/${app.id}?a=${encodeURIComponent(articleName)}` : app.url;
  return `---

## 英語学習アプリ「${app.name}」

${app.pitch || app.description || ""}

**▶ [「${app.name}」をスマホに入れる](${link})**
`;
}
