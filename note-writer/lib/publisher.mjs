// note に記事を投稿する（Playwright でブラウザを操作）
// 各ステップのスクリーンショットは out/<実行時刻>/ に保存される。
// 途中で画面が想定と違ったら、公開せずに下書き保存して止まる。
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { paths } from "./config.mjs";
import { getPublished, addPublished, getSettings } from "./store.mjs";
import { getCredentials, saveSession, loadSession, hasSession } from "./credentials.mjs";
import { renderThumbnail } from "./thumbnail.mjs";

const require = createRequire(import.meta.url);

// 同時に2つのブラウザ操作を走らせない（予約実行と手動実行が重なっても二重投稿しない）
let running = Promise.resolve();
function exclusive(fn) {
  const next = running.then(fn, fn);
  running = next.catch(() => {});
  return next;
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

class Run {
  constructor(label) {
    this.dir = path.join(paths.out, `${new Date().toISOString().replace(/[:.]/g, "-")}-${label}`);
    this.step = 0;
    this.log = [];
  }
  info(msg) {
    this.log.push(msg);
    console.log(msg);
  }
  async shot(page, name) {
    fs.mkdirSync(this.dir, { recursive: true });
    const p = path.join(this.dir, `${String(++this.step).padStart(2, "0")}-${name}.png`);
    await page.screenshot({ path: p, fullPage: true });
    this.info(`📸 ${path.relative(paths.out, p)}`);
  }
}

// ログイン済みなら、トップの右上に「ログイン」へのリンクが出ない
async function isLoggedIn(page) {
  await page.goto("https://note.com/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const loginLink = await page.locator('a[href*="/login"]:visible, button:has-text("ログイン"):visible').count();
  return loginLink === 0;
}

async function login(context, account, run) {
  const page = await context.newPage();
  const loggedIn = await isLoggedIn(page);
  await run.shot(page, "top");
  if (loggedIn) {
    run.info("✅ 保存済みのログイン状態を使用");
    // note が更新した Cookie を保存し直して、ログイン状態を長持ちさせる
    saveSession(account, await context.storageState());
    return page;
  }
  // 貼ったログイン状態が切れているときに、パスワードで何度も試すと note に止められるので、ここで止める
  if (hasSession(account)) {
    throw new Error("保存したログイン状態が切れています。管理画面の「設定」でログイン状態（cookie）を貼り直してください");
  }
  const { email, password } = getCredentials(account);
  if (!email || !password) {
    throw new Error(`note のログイン情報（アカウント: ${account}）が未設定です。管理画面の「設定」で入れてください`);
  }
  await page.goto("https://note.com/login", { waitUntil: "domcontentloaded" });
  await (await first(page, ["#email", 'input[name="login"]', 'input[type="email"]', 'input[placeholder*="メール"]']))
    .fill(email);
  await (await first(page, ["#password", 'input[type="password"]'])).fill(password);
  await (await first(page, ['button:has-text("ログイン")'])).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }).catch(() => {});
  await run.shot(page, "after-login");
  if (new URL(page.url()).pathname.startsWith("/login")) {
    throw new Error("サーバーからのログインを note に止められました。管理画面の「設定」で、ブラウザのログイン状態（cookie）を貼ってください");
  }
  saveSession(account, await context.storageState());
  run.info("✅ ログイン成功");
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

async function saveDraft(page, run) {
  const btn = await first(page, ['button:has-text("下書き保存")'], 5000).catch(() => null);
  if (btn) {
    await btn.click();
    await page.waitForTimeout(2000);
    run.info("💾 下書き保存しました");
  }
}

// 見出し画像を作って載せる。note の画面が想定と違っても、画像なしで投稿を続ける
async function uploadHeaderImage(page, article, run) {
  const settings = getSettings();
  if (!settings.headerImage) return;
  try {
    const png = await renderThumbnail(page.context().browser(), { ...article, footer: settings.thumbnailFooter });
    fs.mkdirSync(run.dir, { recursive: true });
    const file = path.join(run.dir, "header.png");
    fs.writeFileSync(file, png);
    const button = await first(page, [
      'button[aria-label*="画像"]', 'button:has-text("画像を追加")', '[class*="eyecatch"] button', '[class*="Eyecatch"] button',
    ], 8000);
    const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 8000 }), button.click()]);
    await chooser.setFiles(file);
    // 切り抜きの確認画面が出たら確定する
    const ok = await first(page, ['button:has-text("保存")', 'button:has-text("適用")', 'button:has-text("完了")'], 8000).catch(() => null);
    if (ok) await ok.click();
    await page.waitForTimeout(2000);
    await run.shot(page, "header-image");
    run.info("🖼️ 見出し画像を載せました");
  } catch (e) {
    run.info(`⚠️ 見出し画像は載せられませんでした（${e.message.split("\n")[0]}）。画像なしで続けます`);
    await page.keyboard.press("Escape").catch(() => {});
  }
}

async function post(page, article, draftOnly, run) {
  await page.goto("https://note.com/notes/new", { waitUntil: "domcontentloaded" });
  const title = await first(page, ['textarea[placeholder*="タイトル"]', '[placeholder*="記事タイトル"]'], 20000);
  await uploadHeaderImage(page, article, run);
  await title.fill(article.title);
  const editor = await first(page, [".ProseMirror", '[contenteditable="true"]']);
  await pasteHtml(page, editor, article.html);
  await page.waitForTimeout(1500);
  await run.shot(page, "editor-filled");

  const bodyLen = (await editor.innerText()).trim().length;
  if (bodyLen < 50) throw new Error("本文の貼り付けに失敗しました");

  if (draftOnly) {
    await saveDraft(page, run);
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
    // 有料記事を初めて売るときは、note から本人情報（法人名・住所など）の登録を求められる。人が一度だけ入れる必要がある
    await page.waitForTimeout(1500);
    if (await page.locator('text=本人情報').first().isVisible().catch(() => false)) {
      await run.shot(page, "identity-required");
      throw new Error("note で有料記事を売るための「本人情報の登録」が済んでいません。note の画面で一度登録してから、記事を「公開OK」に戻してください");
    }
    const priceInput = await first(page, ['input[name="price"]', 'input[type="number"]', 'input[placeholder*="価格"]']);
    await priceInput.fill(String(article.price));
    await run.shot(page, "price-set");

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
    await run.shot(page, "paid-line");
  }

  await run.shot(page, "before-publish");
  await (await first(page, ['button:has-text("投稿する")', 'button:has-text("更新する")'])).click();
  await page.waitForURL((u) => /\/n\/n[0-9a-z]+/.test(u.pathname), { timeout: 30000 });
  await run.shot(page, "published");
  return { url: page.url(), draft: false };
}

// 公開してよいかの確認。だめなら理由を投げる
export function assertPublishable(article, { force = false } = {}) {
  if (article.status !== "ready") throw new Error("status: ready の記事だけ公開できます");
  const log = getPublished();
  const name = path.basename(article.file);
  if (log.some((e) => e.name === name && !e.draft)) throw new Error("この記事は公開済みです");
  const minHours = getSettings().minIntervalHours;
  const last = log.filter((e) => !e.draft && (e.account || "default") === article.account).at(-1);
  const hours = last ? (Date.now() - Date.parse(last.at)) / 36e5 : Infinity;
  if (hours < minHours && !force) {
    // 間隔が足りないだけなら失敗ではないので、呼び出し側で「あとで公開」として扱えるよう印を付ける
    throw Object.assign(new Error(`前回の公開から ${hours.toFixed(1)} 時間です（${minHours} 時間以上空けてください）`), { code: "TOO_SOON" });
  }
}

// ログイン済みのブラウザで fn(page, run) を動かす。同時に2つは動かさない
export function withNote(account, label, fn, { onError } = {}) {
  return exclusive(async () => {
    const { chromium } = require("playwright");
    const run = new Run(label);
    const session = loadSession(account);
    const { email, password } = getCredentials(account);
    if (!session && (!email || !password)) {
      throw new Error(`note のログイン情報（アカウント: ${account}）が未設定です。管理画面の「設定」で入れてください`);
    }
    const browser = await chromium.launch();
    const context = await browser.newContext({
      // 既定の User-Agent は "HeadlessChrome" を名乗り、自動操作として止められやすい
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
      timezoneId: "Asia/Tokyo",
      locale: "ja-JP",
      viewport: { width: 1280, height: 900 },
      ...(session ? { storageState: session } : {}),
    });
    let page;
    try {
      page = await login(context, account, run);
      const result = await fn(page, run);
      return { ok: true, ...result, log: run.log, shots: run.dir };
    } catch (e) {
      if (page) {
        await run.shot(page, "error").catch(() => {});
        if (onError) await onError(page, run).catch(() => {});
      }
      e.log = run.log;
      e.shots = run.dir;
      throw e;
    } finally {
      await browser.close();
    }
  });
}

// mode: "check"（ログイン確認のみ）/ "draft"（下書き保存まで）/ "publish"（公開）
export function runNote({ account = "default", article = null, mode = "publish", force = false }) {
  if (mode === "publish") assertPublishable(article, { force });
  if (mode === "check") return withNote(account, "check", async () => ({}));
  return withNote(account, mode, async (page, run) => {
    // 予約実行と手動実行が重なっても二重投稿しないよう、順番待ちのあとでもう一度確かめる
    if (mode === "publish") assertPublishable(article, { force });
    const result = await post(page, article, mode === "draft", run);
    addPublished({
      name: path.basename(article.file),
      title: article.title,
      price: article.price,
      account,
      ...result,
    });
    run.info(result.draft ? `💾 下書き: ${result.url}` : `🎉 公開しました: ${result.url}`);
    return result;
  }, { onError: saveDraft });
}
