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
    if (a.siteUrl && !/^https:\/\//.test(a.siteUrl)) throw new Error(`「${a.name}」のホームページの URL は https:// から書いてください`);
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

// 記事の内容に合うアプリを選ぶ。
// 返り値：アプリの id ／ null（合うものがない＝紹介しない）／ undefined（AI に聞けなかった＝あとでやり直す）
export async function chooseApp({ title, tags, body }) {
  const apps = getApps();
  if (apps.length === 0) return null;
  try {
    // article.mjs → apps.mjs → generator.mjs → article.mjs の循環を避けるため、使うときに読み込む
    const { askJson } = await import("./generator.mjs");
    const { exploreChoice, appPerformance, getLearnings } = await import("./learning.mjs");
    const perf = Object.fromEntries(appPerformance().map((p) => [p.id, p]));
    const { suitable, best } = await askJson(`note 記事の最後で紹介する商品を選んでください。
1. まず、記事の読者に「合う」ものをすべて挙げる（suitable）。読者の悩みや目的と関係が薄いものは入れない。合うものがなければ空にする
2. その中から一番合うものを1つ選ぶ（best）。内容の合い方が同じくらいなら「記事1本あたりのクリック数」が多いもの。合うものがなければ "none"
- 種類が「法人向け」の商品は、個人では申し込めない。記事の読者に、英語教室・学習塾の経営者や先生、または子どもの英語に関心のある保護者がいる場合だけ「合う」とする

## これまでの学び
${getLearnings() || "（まだデータがありません）"}

## 記事
タイトル：${title}
タグ：${(tags || []).join(", ")}
冒頭：${body.slice(0, 1500)}

## 商品
${apps.map((a) => `- id: ${a.id}
  名前：${a.name}
  種類：${a.kind === "business" ? "法人向け（教室が契約する）" : "個人向けアプリ"}
  内容：${a.description || ""}
  向いている人：${a.audience || ""}
  載せた記事：${perf[a.id]?.exposures || 0}本、記事1本あたりのクリック：${perf[a.id]?.perArticle?.toFixed(2) ?? "まだなし"}`).join("\n")}`, {
      type: "object",
      properties: {
        suitable: { type: "array", items: { type: "string", enum: apps.map((a) => a.id) } },
        best: { type: "string", enum: [...apps.map((a) => a.id), "none"] },
      },
      required: ["suitable", "best"],
      additionalProperties: false,
    });
    const ok = [...new Set(suitable)].filter((id) => apps.some((a) => a.id === id));
    if (best === "none" || ok.length === 0) return null;
    // 一定の割合で、合うものの中から、まだ載せた回数の少ないものを試してデータを集める
    return exploreChoice(ok) || (ok.includes(best) ? best : ok[0]);
  } catch (e) {
    console.error(`商品の自動選択に失敗：${e.message}`);
    return undefined;
  }
}

// 記事の最後に付ける紹介文（Markdown）。PUBLIC_URL があれば、クリックを数えるために自分のサーバーを経由させる
export function appCtaMarkdown(appId, articleName) {
  const app = getApps().find((a) => a.id === appId);
  if (!app) return "";
  const base = process.env.PUBLIC_URL;
  const track = (to) => `${base}/go/${app.id}?a=${encodeURIComponent(articleName)}${to ? `&to=${to}` : ""}`;
  const link = base ? track() : app.url;
  const site = app.siteUrl ? (base ? track("site") : app.siteUrl) : "";
  const siteLine = site ? `\n運営：${app.company || app.name}（[ホームページ](${site})）\n` : "";
  if (app.kind === "business") {
    // 法人向け：教室には説明の予約へ、保護者には「通っている教室に伝えてもらう」（教室を飛ばして売らない）
    return `---

## 「${app.name}」について

${app.pitch || app.description || ""}

- **英語教室・学習塾の方へ**：▶ [無料のオンライン説明を予約する](${link})
- **保護者の方へ**：教室単位で導入する教材です。気になったら、お子さんの通う英語教室の先生に伝えてみてください。
${siteLine}`;
  }
  return `---

## 英語学習アプリ「${app.name}」

${app.pitch || app.description || ""}

**▶ [「${app.name}」をスマホに入れる](${link})**
${siteLine}`;
}
