// 見出し画像を、サーバーに入っているブラウザで作る（画像生成 AI を使わないので費用0円）
// note の見出し画像の推奨サイズ 1280×670
const PALETTES = [
  ["#1B3A2F", "#2B7A5B", "#F4C95D"],
  ["#14213D", "#2E5AAC", "#FCA311"],
  ["#3A1C32", "#8E3B6B", "#F7C59F"],
  ["#102A43", "#16697A", "#82C0CC"],
  ["#2D2A32", "#5C4D7D", "#F2B5D4"],
];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// 同じ記事はいつも同じ色になるよう、タイトルから色を決める
function paletteFor(title) {
  let h = 0;
  for (const ch of title) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return PALETTES[h % PALETTES.length];
}

export function thumbnailHtml({ title, tags = [], price = 0, footer = "" }) {
  const [bg, mid, accent] = paletteFor(title);
  const size = title.length > 34 ? 56 : title.length > 24 ? 64 : 74;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin:0; box-sizing:border-box; }
  body { width:1280px; height:670px; font-family:"Noto Sans CJK JP","Hiragino Sans","IPAGothic","WenQuanYi Zen Hei",sans-serif;
    background:linear-gradient(135deg, ${bg} 0%, ${mid} 100%); color:#fff; padding:72px 88px; display:flex; flex-direction:column; justify-content:space-between; }
  .tags { display:flex; gap:14px; flex-wrap:wrap; }
  .tag { border:2px solid ${accent}; color:${accent}; border-radius:999px; padding:6px 20px; font-size:26px; font-weight:700; }
  h1 { font-size:${size}px; line-height:1.35; font-weight:800; letter-spacing:.01em; }
  .foot { display:flex; justify-content:space-between; align-items:center; font-size:28px; opacity:.9; }
  .bar { width:120px; height:10px; background:${accent}; border-radius:5px; margin-bottom:28px; }
  .badge { background:${accent}; color:${bg}; font-weight:800; border-radius:10px; padding:8px 18px; }
  </style></head><body>
  <div class="tags">${tags.slice(0, 3).map((t) => `<span class="tag">#${esc(t)}</span>`).join("")}</div>
  <div><div class="bar"></div><h1>${esc(title)}</h1></div>
  <div class="foot"><span>${esc(footer)}</span>${price > 0 ? '<span class="badge">保存版</span>' : ""}</div>
  </body></html>`;
}

// browser は Playwright のブラウザ。PNG のバイト列を返す
export async function renderThumbnail(browser, article) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 670 } });
  try {
    await page.setContent(thumbnailHtml(article), { waitUntil: "load" });
    return await page.screenshot({ type: "png" });
  } finally {
    await page.close();
  }
}
