// ネタ帳のテーマから、Claude で note 記事（Markdown）を書く
import fs from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { paths } from "./config.mjs";
import { parseFrontmatter, PAID_MARKER, markdownToBlocks } from "./article.mjs";

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

function readIfExists(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

// 書き方の手本として、公開済み・公開予定の記事を1本だけ渡す
function styleExample() {
  if (!fs.existsSync(paths.articles)) return "";
  const file = fs.readdirSync(paths.articles).filter((f) => f.endsWith(".md") && !f.startsWith("_")).sort()[0];
  return file ? readIfExists(path.join(paths.articles, file)) : "";
}

function systemPrompt() {
  const profile = readIfExists(paths.profile) || "（筆者の経歴は未入力）";
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
  const client = new Anthropic();
  const kind = topic.price > 0 ? `有料記事（${topic.price}円）` : "無料記事";
  const userMessage = `次のテーマで${kind}を1本書いてください。

テーマ：${topic.title}
${topic.notes ? `メモ：${topic.notes}\n` : ""}${topic.tags?.length ? `入れたいタグ：${topic.tags.join(", ")}\n` : ""}`;

  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "high" },
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
