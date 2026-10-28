// 記事ファイル（Markdown + 先頭のメタ情報）を読み込み、note に貼れる HTML に変換する
import fs from "fs";
import path from "path";
import { paths } from "./config.mjs";
import { appCtaMarkdown } from "./apps.mjs";
import { getSettings } from "./store.mjs";

export const PAID_MARKER = "<!-- paid -->";

// 先頭の --- で囲まれた key: value を読む（依存ライブラリなしの簡易版）
export function parseFrontmatter(src) {
  // Windows の Git で取ってきたファイルは改行が CRLF になっている
  src = src.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const m = src.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) throw new Error("記事の先頭に --- で囲んだメタ情報がありません");
  const meta = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      value = value.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean);
    }
    meta[key] = value;
  }
  return { meta, body: src.slice(m[0].length) };
}

function inline(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2">$1</a>');
}

// note のエディタが受け付ける範囲（見出し・段落・箇条書き・引用・コード）だけを変換する
export function markdownToBlocks(md) {
  const blocks = [];
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (line.trim() === "---") {
      blocks.push("<hr>");
    } else if (line.startsWith("```")) {
      const code = [];
      for (i++; i < lines.length && !lines[i].startsWith("```"); i++) code.push(lines[i]);
      blocks.push(`<pre><code>${inline(code.join("\n"))}</code></pre>`);
    } else if (/^#{2,3} /.test(line)) {
      const level = line.startsWith("### ") ? 3 : 2;
      blocks.push(`<h${level}>${inline(line.replace(/^#+ /, ""))}</h${level}>`);
    } else if (/^[-*] /.test(line) || /^\d+\. /.test(line)) {
      const ordered = /^\d+\. /.test(line);
      const items = [];
      for (; i < lines.length && (ordered ? /^\d+\. / : /^[-*] /).test(lines[i]); i++) {
        items.push(`<li>${inline(lines[i].replace(/^([-*]|\d+\.) /, ""))}</li>`);
      }
      i--;
      const tag = ordered ? "ol" : "ul";
      blocks.push(`<${tag}>${items.join("")}</${tag}>`);
    } else if (line.startsWith("> ")) {
      blocks.push(`<blockquote><p>${inline(line.slice(2))}</p></blockquote>`);
    } else {
      const para = [line];
      for (i++; i < lines.length && lines[i].trim() && !/^(#|[-*] |\d+\. |> |```)/.test(lines[i]); i++) {
        para.push(lines[i]);
      }
      i--;
      blocks.push(`<p>${para.map(inline).join("<br>")}</p>`);
    }
  }
  return blocks;
}

const FRONTMATTER_KEYS = ["title", "price", "tags", "status", "account", "cta", "app", "publish_at", "url", "topic", "error"];

export function serializeArticle(meta, body) {
  const lines = FRONTMATTER_KEYS.filter((k) => meta[k] !== undefined && meta[k] !== "").map((k) => {
    const v = meta[k];
    return `${k}: ${Array.isArray(v) ? `[${v.join(", ")}]` : String(v).replace(/\n/g, " ")}`;
  });
  return `---\n${lines.join("\n")}\n---\n\n${body.replace(/^\n+/, "")}`;
}

// 管理画面から触る記事はファイル名で指定する。パスの外に出られないよう名前を制限する
export function articlePath(name) {
  if (!/^[\w.-]+\.md$/.test(name) || name.startsWith("_")) throw new Error(`不正な記事名: ${name}`);
  return path.join(paths.articles, name);
}

export function readArticleSource(name) {
  return parseFrontmatter(fs.readFileSync(articlePath(name), "utf8"));
}

export function writeArticleSource(name, meta, body) {
  fs.mkdirSync(paths.articles, { recursive: true });
  fs.writeFileSync(articlePath(name), serializeArticle(meta, body));
}

export function updateArticleMeta(name, patch) {
  const { meta, body } = readArticleSource(name);
  writeArticleSource(name, { ...meta, ...patch }, body);
}

// 一覧（_template.md などの下線始まりは除く）
export function listArticles() {
  if (!fs.existsSync(paths.articles)) return [];
  return fs.readdirSync(paths.articles)
    .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
    .map((name) => {
      let meta, body;
      try {
        ({ meta, body } = readArticleSource(name));
      } catch (e) {
        // 読めないファイルが1つあっても、一覧全体は出す
        return { name, title: name, price: 0, tags: [], status: "error", account: "default",
          publish_at: "", url: "", topic: "", error: `読み込めません：${e.message}`, chars: 0 };
      }
      return {
        name,
        title: meta.title || "",
        price: Number(meta.price || 0),
        tags: Array.isArray(meta.tags) ? meta.tags : meta.tags ? [meta.tags] : [],
        status: meta.status || "draft",
        account: meta.account || "default",
        publish_at: meta.publish_at || "",
        url: meta.url || "",
        topic: meta.topic || "",
        app: meta.app || "",
        error: meta.error || "",
        chars: body.length,
      };
    })
    .sort((a, b) => (a.publish_at || "9999").localeCompare(b.publish_at || "9999"));
}

// 同じタグの、公開済みの過去の記事（共通のタグが多い順に3本）を「あわせて読みたい」にする
export function relatedMarkdown(name, tags, { limit = 3 } = {}) {
  if (!getSettings().relatedLinks) return "";
  const mine = new Set(Array.isArray(tags) ? tags : tags ? [tags] : []);
  const picks = listArticles()
    .filter((a) => a.name !== name && a.status === "published" && /^https:\/\//.test(a.url))
    .map((a) => ({ a, score: a.tags.filter((t) => mine.has(t)).length }))
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score || (y.a.publish_at || "").localeCompare(x.a.publish_at || ""))
    .slice(0, limit);
  if (!picks.length) return "";
  return `### あわせて読みたい\n\n${picks.map(({ a }) => `- [${a.title.replace(/[[\]]/g, "")}](${a.url})`).join("\n")}\n`;
}

export function loadArticle(file) {
  const { meta, body } = parseFrontmatter(fs.readFileSync(file, "utf8"));
  if (!meta.title) throw new Error(`${file}: title がありません`);
  const price = Number(meta.price || 0);
  const [free, paid] = body.split(PAID_MARKER);
  if (price > 0 && paid === undefined) {
    throw new Error(`${file}: 有料記事なのに ${PAID_MARKER} の区切りがありません`);
  }
  if (price > 0 && (price < 100 || price > 50000)) {
    throw new Error(`${file}: 価格は 100〜50000 円で指定してください`);
  }
  const freeBlocks = markdownToBlocks(free);
  const paidBlocks = paid === undefined ? [] : markdownToBlocks(paid);
  // cta: uspeak のように指定すると、cta/uspeak.md を記事の最後に付ける。
  // 指定がなければ、管理画面で書いた全記事共通の案内（cta/default.md）を付ける。cta: none で付けない
  // app: で選ばれたアプリの紹介を先に付ける
  if (meta.app && meta.app !== "none") {
    (paid === undefined ? freeBlocks : paidBlocks).push(...markdownToBlocks(appCtaMarkdown(meta.app, path.basename(file))));
  }
  const related = relatedMarkdown(path.basename(file), meta.tags);
  if (related) (paid === undefined ? freeBlocks : paidBlocks).push(...markdownToBlocks(related));
  const ctaName = meta.cta || (fs.existsSync(path.join(paths.cta, "default.md")) ? "default" : "");
  if (ctaName && ctaName !== "none") {
    const ctaFile = path.join(paths.cta, `${ctaName}.md`);
    const cta = fs.readFileSync(ctaFile, "utf8");
    if (cta.includes("{{")) throw new Error(`${ctaFile}: 未設定の {{...}} が残っています`);
    (paid === undefined ? freeBlocks : paidBlocks).push(...markdownToBlocks(cta));
  }
  const lineUrl = getSettings().lineAddUrl;
  if (lineUrl && meta.cta !== "none") {
    (paid === undefined ? freeBlocks : paidBlocks).push(...markdownToBlocks(`**▶ [新しい記事のお知らせを LINE で受け取る（週1回）](${lineUrl})**`));
  }
  return {
    file,
    title: meta.title,
    price,
    tags: Array.isArray(meta.tags) ? meta.tags : meta.tags ? [meta.tags] : [],
    status: meta.status || "draft",
    account: meta.account || "default",
    html: [...freeBlocks, ...paidBlocks].join(""),
    // 有料ラインは「無料ブロックの直後」に置く
    freeBlockCount: freeBlocks.length,
  };
}
