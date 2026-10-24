// note に記事を投稿する（Playwright でブラウザを操作）
//
//   node note-writer/publish.mjs --check                 ログインできるかだけ確認
//   node note-writer/publish.mjs articles/xxx.md --draft 下書き保存まで
//   node note-writer/publish.mjs articles/xxx.md         公開まで
//
// 必要な環境変数: NOTE_EMAIL, NOTE_PASSWORD
// 各ステップのスクリーンショットは note-writer/out/ に保存される。
// 途中で画面が想定と違ったら、公開せずに下書き保存して止まる。
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { loadArticle } from "./lib/article.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, "out");
const AUTH = path.join(ROOT, ".auth", "note.json");
const LOG = path.join(ROOT, "published.json");
// 連投でスパム扱いされないよう、公開と公開の間を空ける
const MIN_INTERVAL_HOURS = Number(process.env.NOTE_MIN_INTERVAL_HOURS || 3);

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const draftOnly = args.includes("--draft");
const force = args.includes("--force");
const file = args.find((a) => !a.startsWith("--"));

let step = 0;
async function shot(page, name) {
  fs.mkdirSync(OUT, { recursive: true });
  const p = path.join(OUT, `${String(++step).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: p, fullPage: true });
  console.log(`  📸 ${path.relative(process.cwd(), p)}`);
}

function readLog() {
  return fs.existsSync(LOG) ? JSON.parse(fs.readFileSync(LOG, "utf8")) : [];
}

// 候補のセレクタを順に試し、最初に見つかったものを返す
async function first(page, selectors, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const s of selectors) {
      const loc = page.locator(s).first();
      if (await loc.isVisible().catch(() => false)) return loc;
    }
    await page.waitForTimeout(300);
  }
  throw new Error(`見つかりません: ${selectors.join(" | ")}`);
}

async function login(context) {
  const page = await context.newPage();
  await page.goto("https://note.com/", { waitUntil: "domcontentloaded" });
  const loggedIn = await page.locator('a[href*="/notes/new"], a:has-text("投稿")').first()
    .isVisible({ timeout: 5000 }).catch(() => false);
  if (loggedIn) {
    console.log("✅ 保存済みのログイン状態を使用");
    return page;
  }
  const { NOTE_EMAIL, NOTE_PASSWORD } = process.env;
  if (!NOTE_EMAIL || !NOTE_PASSWORD) throw new Error("NOTE_EMAIL / NOTE_PASSWORD が設定されていません");
  await page.goto("https://note.com/login", { waitUntil: "domcontentloaded" });
  await (await first(page, ["#email", 'input[name="login"]', 'input[type="email"]', 'input[placeholder*="メール"]']))
    .fill(NOTE_EMAIL);
  await (await first(page, ["#password", 'input[type="password"]'])).fill(NOTE_PASSWORD);
  await (await first(page, ['button:has-text("ログイン")'])).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }).catch(() => {});
  await shot(page, "after-login");
  if (new URL(page.url()).pathname.startsWith("/login")) {
    throw new Error("ログインできませんでした（ロボット確認・追加認証の可能性。スクリーンショットを確認）");
  }
  fs.mkdirSync(path.dirname(AUTH), { recursive: true });
  await context.storageState({ path: AUTH });
  console.log("✅ ログイン成功");
  return page;
}

async function pasteHtml(page, editor, html) {
  await editor.click();
  await page.evaluate((html) => {
    const el = document.activeElement;
    const dt = new DataTransfer();
    dt.setData("text/html", html);
    dt.setData("text/plain", html.replace(/<[^>]+>/g, "\n"));
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, html);
}

async function saveDraft(page) {
  const btn = await first(page, ['button:has-text("下書き保存")'], 5000).catch(() => null);
  if (btn) {
    await btn.click();
    await page.waitForTimeout(2000);
    console.log("💾 下書き保存しました");
  }
}

async function publish(page, article) {
  await page.goto("https://note.com/notes/new", { waitUntil: "domcontentloaded" });
  const title = await first(page, ['textarea[placeholder*="タイトル"]', '[placeholder*="記事タイトル"]'], 20000);
  await title.fill(article.title);
  const editor = await first(page, [".ProseMirror", '[contenteditable="true"]']);
  await pasteHtml(page, editor, article.html);
  await page.waitForTimeout(1500);
  await shot(page, "editor-filled");

  const bodyLen = (await editor.innerText()).trim().length;
  if (bodyLen < 50) throw new Error("本文の貼り付けに失敗しました");

  if (draftOnly) {
    await saveDraft(page);
    return { url: page.url(), draft: true };
  }

  await (await first(page, ['button:has-text("公開に進む")'])).click();
  await page.waitForTimeout(2000);

  for (const tag of article.tags) {
    const input = await first(page, ['input[placeholder*="ハッシュタグ"]']);
    await input.fill(tag);
    await input.press("Enter");
  }

  if (article.price > 0) {
    await (await first(page, ['label:has-text("有料")', 'button:has-text("有料")'])).click();
    const priceInput = await first(page, ['input[name="price"]', 'input[type="number"]', 'input[placeholder*="価格"]']);
    await priceInput.fill(String(article.price));
    await shot(page, "price-set");

    // 有料エリア：無料ブロックの直後にラインを置く
    const area = await first(page, ['button:has-text("有料エリア設定")'], 5000).catch(() => null);
    if (area) await area.click();
    const lines = page.locator('button:has-text("ラインをこの場所に変更")');
    await lines.first().waitFor({ timeout: 10000 });
    const count = await lines.count();
    const index = article.freeBlockCount - 1;
    if (index < 0 || index >= count) {
      throw new Error(`有料ラインの位置が合いません（候補 ${count} 件 / 無料ブロック ${article.freeBlockCount}）`);
    }
    await lines.nth(index).click();
    await shot(page, "paid-line");
  }

  await shot(page, "before-publish");
  await (await first(page, ['button:has-text("投稿する")', 'button:has-text("更新する")'])).click();
  await page.waitForURL((u) => /\/n\/n[0-9a-z]+/.test(u.pathname), { timeout: 30000 });
  await shot(page, "published");
  return { url: page.url(), draft: false };
}

async function main() {
  if (!checkOnly && !file) {
    console.error("使い方: node note-writer/publish.mjs <記事.md> [--draft] | --check");
    process.exit(1);
  }
  const article = file ? loadArticle(file) : null;
  if (article && !draftOnly) {
    if (article.status !== "ready") throw new Error("status: ready の記事だけ公開できます");
    const log = readLog();
    if (log.some((e) => e.file === article.file && !e.draft)) throw new Error("この記事は公開済みです");
    const last = log.filter((e) => !e.draft).at(-1);
    const hours = last ? (Date.now() - Date.parse(last.at)) / 36e5 : Infinity;
    if (hours < MIN_INTERVAL_HOURS && !force) {
      throw new Error(`前回の公開から ${hours.toFixed(1)} 時間です（${MIN_INTERVAL_HOURS} 時間以上空けてください）`);
    }
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({
    locale: "ja-JP",
    viewport: { width: 1280, height: 900 },
    ...(fs.existsSync(AUTH) ? { storageState: AUTH } : {}),
  });
  let page;
  try {
    page = await login(context);
    if (checkOnly) return;
    const result = await publish(page, article);
    const log = readLog();
    log.push({ file: article.file, title: article.title, price: article.price, ...result, at: new Date().toISOString() });
    fs.writeFileSync(LOG, JSON.stringify(log, null, 2) + "\n");
    console.log(result.draft ? `💾 下書き: ${result.url}` : `🎉 公開しました: ${result.url}`);
  } catch (e) {
    if (page) {
      await shot(page, "error").catch(() => {});
      await saveDraft(page).catch(() => {});
    }
    throw e;
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(`❌ ${e.message}`);
  process.exit(1);
});
