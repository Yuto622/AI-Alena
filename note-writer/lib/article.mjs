// 記事ファイル（Markdown + 先頭のメタ情報）を読み込み、note に貼れる HTML に変換する
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const PAID_MARKER = "<!-- paid -->";

// 先頭の --- で囲まれた key: value を読む（依存ライブラリなしの簡易版）
function parseFrontmatter(src) {
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
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2">$1</a>');
}

// note のエディタが受け付ける範囲（見出し・段落・箇条書き・引用・コード）だけを変換する
export function markdownToBlocks(md) {
  const blocks = [];
  const lines = md.split("\n");
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
  // cta: uspeak のように指定すると、cta/uspeak.md を記事の最後に付ける
  if (meta.cta) {
    const ctaFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "cta", `${meta.cta}.md`);
    const cta = fs.readFileSync(ctaFile, "utf8");
    if (cta.includes("{{")) throw new Error(`${ctaFile}: 未設定の {{...}} が残っています`);
    (paid === undefined ? freeBlocks : paidBlocks).push(...markdownToBlocks(cta));
  }
  return {
    file,
    title: meta.title,
    price,
    tags: Array.isArray(meta.tags) ? meta.tags : meta.tags ? [meta.tags] : [],
    status: meta.status || "draft",
    html: [...freeBlocks, ...paidBlocks].join(""),
    // 有料ラインは「無料ブロックの直後」に置く
    freeBlockCount: freeBlocks.length,
  };
}
