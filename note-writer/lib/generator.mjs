// ネタ帳のテーマから、Claude で note 記事（Markdown）を書く
import fs from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { paths, DATA_DIR } from "./config.mjs";
import { parseFrontmatter, PAID_MARKER, markdownToBlocks } from "./article.mjs";

// 一番安いモデル。品質を上げたいときは CLAUDE_MODEL=claude-sonnet-5-5 などに変える
const MODEL = process.env.CLAUDE_MODEL || "claude-haiku-5-5";

// API キーの前後の空白・改行は取り除く（Secret Manager に改行付きで入っていると「Invalid bearer token」になる）
function anthropic() {
  const apiKey = (process.env.ANTHROPIC_API_KEY || "").trim();
  if (!apiKey) throw new Error("Anthropic の API キーが設定されていません");
  return new Anthropic({ apiKey });
}

function readIfExists(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

// 書き方の手本として、公開済み・公開予定の記事を1本だけ渡す
function styleExample() {
  if (!fs.existsSync(paths.articles)) return "";
  const file = fs.readdirSync(paths.articles).filter((f) => f.endsWith(".md") && !f.startsWith("_")).sort()[0];
  return file ? readIfExists(path.join(paths.articles, file)) : "";
}

// 週1回まとめる「これまでの学び」（learning.mjs が書く）
const learnings = () => readIfExists(path.join(DATA_DIR, "learnings.md"));

function systemPrompt() {
  const profile = readIfExists(paths.profile) || "（筆者の経歴は未入力）";
  const learned = learnings();
  return `あなたは note（日本のブログサービス）に載せる記事の書き手です。筆者本人の名前で公開される記事を書きます。

## 筆者について（ここに書かれていることだけが筆者の経験です）
${profile}

## 守ること
- 筆者の経験として書いてよいのは、上の「筆者について」にあることだけ。それ以外の体験談・数字・実績を作らない。経験していないことは一般的な情報・方法として書く
- 大学の制度や数字（GPA の計算、学費など）は、確かな一般知識の範囲で書き、断定できないものは「大学によって違う」と書く
- 課題の答えをそのまま写せる内容や、大学の不正行為の規則に触れる内容は書かない
- 日本語は、中学生でも読めるやさしい言葉で。1文を短く
- note は表に対応していないので、表は使わず箇条書きにする。見出しは ## と ### だけ使う
- 有料記事では、無料部分（全体の3割ほど）で「誰向けか」「読むと何ができるようになるか」「よくある失敗」を書き、${PAID_MARKER} の行で区切ってから、有料部分に「そのまま使える手順・テンプレート・チェックリスト」を書く
- 無料記事では ${PAID_MARKER} を入れない。最後に、関連する有料記事やフォローへの一言を入れる

## 出力の形
次の形の Markdown だけを出力する。前置きや説明は書かない。

---
title: （32文字前後のタイトル）
price: （有料なら価格、無料なら 0）
tags: [タグ1, タグ2, タグ3, タグ4]
---

本文

${learned ? `## これまでの実績からの学び（タイトルのつけ方・構成の参考にする）\n${learned}\n` : ""}
## 書き方の手本（構成と文体の参考。内容はまねしない）
${styleExample()}`;
}

function validate(text, topic) {
  const { meta, body } = parseFrontmatter(text.trim() + "\n");
  if (!meta.title) throw new Error("生成結果に title がありません");
  const price = Number(meta.price || 0);
  if (topic.price > 0 && !body.includes(PAID_MARKER)) throw new Error(`有料記事なのに ${PAID_MARKER} がありません`);
  if (/^\|.*\|$/m.test(body)) throw new Error("表（|）が含まれています");
  if (markdownToBlocks(body).length < 8) throw new Error("本文が短すぎます");
  return { meta: { ...meta, price: topic.price ?? price }, body };
}

// topic: { title, price, tags?, notes? }
export async function generateArticle(topic) {
  const client = anthropic();
  const kind = topic.price > 0 ? `有料記事（${topic.price}円）` : "無料記事";
  const userMessage = `次のテーマで${kind}を1本書いてください。

テーマ：${topic.title}
${topic.notes ? `メモ：${topic.notes}\n` : ""}${topic.tags?.length ? `入れたいタグ：${topic.tags.join(", ")}\n` : ""}`;

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    output_config: { effort: "medium" },
    system: [{ type: "text", text: systemPrompt(), cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userMessage }],
  });
  const message = await stream.finalMessage();

  if (message.stop_reason === "refusal") {
    throw new Error(`生成を断られました（${message.stop_details?.category ?? "理由不明"}）`);
  }
  if (message.stop_reason === "max_tokens") throw new Error("出力が長すぎて途中で切れました");
  const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return validate(text, topic);
}

// JSON の形を指定して答えさせる（短い判定・一覧づくり用）
export async function askJson(prompt, schema) {
  const client = anthropic();
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium", format: { type: "json_schema", schema } },
    messages: [{ role: "user", content: prompt }],
  });
  if (message.stop_reason === "refusal") throw new Error("判定を断られました");
  if (message.stop_reason === "max_tokens") throw new Error("判定の出力が途中で切れました");
  return JSON.parse(message.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
}

// 人の確認の代わりに、公開前に別の目で読ませる。問題があれば公開しない
export async function reviewArticle(meta, body, { extra = "" } = {}) {
  const profile = readIfExists(paths.profile) || "（未入力。筆者の経験として書いてよいことはない）";
  return askJson(`次の note 記事を、公開してよいか判定してください。

## 筆者について（筆者の経験として書いてよいのはここにあることだけ）
${profile}

## 公開してはいけない条件
- 筆者の経験・実績・数字として、上の「筆者について」にないことを書いている（一般論としての説明は問題ない）
- 事実として明らかに間違っていることを断定している
- 大学の課題の答えをそのまま写せる内容、不正行為をすすめる内容
- 他の人や学校をおとしめる内容、個人を特定できる情報
- 有料部分に、価格に見合う具体的な中身（手順・テンプレート・チェックリスト）がない
${extra}
## 記事
タイトル：${meta.title}
価格：${meta.price}円

${body}`, {
    type: "object",
    properties: {
      ok: { type: "boolean" },
      problems: { type: "array", items: { type: "string" } },
    },
    required: ["ok", "problems"],
    additionalProperties: false,
  });
}

// ネタ帳が空になったら、売れたテーマに近い新しいテーマを考えさせる
export async function suggestTopics({ existing, bestTags, audience, count = 6 }) {
  const profile = readIfExists(paths.profile) || "（未入力）";
  const { topics } = await askJson(`note に載せる記事のテーマを ${count} 個考えてください。

## 筆者について
${profile}

## 条件
- 読者は「${audience}」。この読者が検索しそうな悩み・疑問をテーマにする
- 子どもの発達や健康・医療についての断定、特定の教室や他社の批判はしない
- 有料（500円か980円）と無料（0円）を 2:1 くらいで混ぜる。有料は「そのまま使える手順やテンプレート」が書けるテーマにする
- 筆者の経験がなくても、一般的な方法として正確に書けるテーマにする
- 次のテーマと重ならないこと：${existing.join(" / ")}
${bestTags.length ? `- よく売れているタグ：${bestTags.join("、")}。このタグに近いテーマを多めに\n` : ""}${learnings() ? `\n## これまでの実績からの学び\n${learnings()}\n` : ""}`, {
    type: "object",
    properties: {
      topics: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            price: { type: "integer" },
            tags: { type: "array", items: { type: "string" } },
          },
          required: ["title", "price", "tags"],
          additionalProperties: false,
        },
      },
    },
    required: ["topics"],
    additionalProperties: false,
  });
  return topics;
}
