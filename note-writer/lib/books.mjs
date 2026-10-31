// ブログ記事に合う本を、全自動で選んで紹介する（アフィリエイト）。
// AI に本の名前を考えさせると、ない本や間違ったリンクを作ってしまうので、
// 1. AI が記事から検索の言葉を考える
// 2. 楽天ブックスの公式 API（無料）で、実在する本を売れている順に探す
// 3. その候補の中から、AI が記事に本当に合うものを 0〜2 冊選ぶ（合わなければ紹介しない）
// リンクは楽天のアフィリエイトリンク。Amazon のトラッキング ID があれば、ISBN で探す Amazon のリンクも付ける
import { getSettings } from "./store.mjs";
import { loadSecret, saveSecret } from "./credentials.mjs";

const API = process.env.RAKUTEN_API_BASE || "https://openapi.rakuten.co.jp";
const PATH = "/services/api/BooksTotal/Search/20170404";

export const hasRakuten = () => {
  const k = loadSecret("rakuten");
  return !!(k && k.applicationId && k.accessKey);
};

export async function setRakutenKeys({ applicationId, accessKey, affiliateId }) {
  const keys = { applicationId: String(applicationId || "").trim(), accessKey: String(accessKey || "").trim(), affiliateId: String(affiliateId || "").trim() };
  if (!keys.applicationId || !keys.accessKey) throw new Error("アプリケーション ID とアクセスキーを入れてください");
  const prev = loadSecret("rakuten");
  saveSecret("rakuten", keys);
  try {
    const books = await searchBooks("英検");
    return { ok: true, sample: books.slice(0, 3).map((b) => b.title), affiliate: !!keys.affiliateId };
  } catch (e) {
    saveSecret("rakuten", prev);
    throw e;
  }
}

// 楽天ブックスで本を探す（売れている順）
export async function searchBooks(keyword, { hits = 8 } = {}) {
  const k = loadSecret("rakuten");
  if (!k) throw new Error("楽天のアプリケーション ID が未設定です");
  const url = new URL(`${API}${PATH}`);
  const params = {
    applicationId: k.applicationId, accessKey: k.accessKey, keyword, booksGenreId: "001",
    sort: "sales", hits: String(hits), availability: "1", formatVersion: "2", format: "json",
    ...(k.affiliateId ? { affiliateId: k.affiliateId } : {}),
  };
  for (const [key, v] of Object.entries(params)) url.searchParams.set(key, v);
  const site = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
  const res = await fetch(url, { headers: { accessKey: k.accessKey, ...(site ? { Referer: `${site}/`, Origin: site } : {}) } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`楽天 API ${res.status}: ${json.error_description || json.errors?.errorMessage || json.error || JSON.stringify(json).slice(0, 200)}`);
  // formatVersion=2 なら Items は商品の配列、1 なら { Item } の配列
  return (json.Items || []).map((x) => x.Item || x)
    .filter((b) => b.title && /^https:\/\//.test(b.affiliateUrl || b.itemUrl || ""))
    .map((b) => ({
      title: b.title, author: b.author || "", publisher: b.publisherName || "", isbn: b.isbn || b.jan || "",
      caption: String(b.itemCaption || "").slice(0, 300), price: b.itemPrice, salesDate: b.salesDate || "",
      review: Number(b.reviewAverage || 0), reviews: Number(b.reviewCount || 0),
      url: b.affiliateUrl || b.itemUrl, image: (b.largeImageUrl || b.mediumImageUrl || "").replace(/^http:/, "https:"),
    }));
}

const KEYWORDS = {
  type: "object",
  properties: {
    keywords: { type: "array", items: { type: "string" }, description: "楽天ブックスで探す言葉。0〜3個" },
  },
  required: ["keywords"],
  additionalProperties: false,
};

const PICK = {
  type: "object",
  properties: {
    picks: {
      type: "array",
      items: {
        type: "object",
        properties: { index: { type: "integer" }, note: { type: "string", description: "この記事の読者に役立つ理由。全角60文字以内" } },
        required: ["index", "note"],
        additionalProperties: false,
      },
    },
  },
  required: ["picks"],
  additionalProperties: false,
};

// 記事に合う本を 0〜2 冊選ぶ。楽天の設定がなければ空
export async function pickBooks({ title, tags = [], text }) {
  if (!hasRakuten()) return [];
  const { askJson } = await import("./generator.mjs");
  const { keywords } = await askJson(`次のブログ記事の読者が、記事を読んだあとに役立つ「本」を楽天ブックスで探します。検索する言葉を0〜3個考えてください。
- 具体的な言葉にする（例：「英検5級 単語」「TOEFL 公式問題集」「英文メール 書き方」「ChatGPT 仕事 効率化」）
- 本が役に立たない記事なら、空の配列にする
- オンライン英会話・英語学習アプリの宣伝になる本は探さない（運営者の商品と競合するため）

## 記事
タイトル：${title}
タグ：${[].concat(tags).join(", ")}

${String(text).slice(0, 4000)}`, KEYWORDS);
  const seen = new Set();
  const candidates = [];
  for (const kw of (keywords || []).slice(0, 3)) {
    try {
      for (const b of await searchBooks(kw)) {
        const key = b.isbn || b.title;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push(b);
      }
    } catch (e) {
      console.error(`本の検索に失敗（${kw}）：${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 1100)); // 楽天 API は1秒に1回まで
  }
  if (!candidates.length) return [];
  const { picks } = await askJson(`次のブログ記事の最後で紹介する本を、候補の中から 0〜2 冊選んでください。
- 記事の内容と読者に本当に合うものだけ。合うものがなければ空の配列
- 理由（note）は、候補の説明に書かれていることを元に書く。筆者が読んだ・使ったとは書かない。誇張しない
- 発売日が古すぎるもの・レビューが極端に低いものは避ける

## 記事
タイトル：${title}
${String(text).slice(0, 2000)}

## 候補（index：書名／著者／出版社／発売日／レビュー平均（件数）／説明）
${candidates.map((b, i) => `${i}：${b.title}／${b.author}／${b.publisher}／${b.salesDate}／${b.review}（${b.reviews}件）／${b.caption}`).join("\n")}`, PICK);
  const tag = getSettings().amazonTag;
  return (picks || []).filter((p) => candidates[p.index]).slice(0, 2).map((p) => {
    const b = candidates[p.index];
    return {
      name: b.title, author: b.author, image: b.image, url: b.url, note: p.note.slice(0, 80), source: "rakuten",
      ...(tag ? { amazonUrl: `https://www.amazon.co.jp/s?k=${encodeURIComponent(b.isbn || b.title)}&tag=${encodeURIComponent(tag)}` } : {}),
    };
  });
}
