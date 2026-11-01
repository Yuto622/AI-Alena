import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { DATA_DIR, STORAGE_STATE_PATH } from "./config.js";
import { parseYenRange } from "./filter.js";
import { addDaysYmd, sleep } from "./util.js";

export const BASE_URL = "https://crowdworks.jp";
const SHOT_DIR = path.join(DATA_DIR, "screenshots");

export class LoginRequiredError extends Error {}
export class CaptchaError extends Error {}

export async function launch(browserConfig, { headless } = {}) {
  const browser = await chromium.launch({
    headless: headless ?? browserConfig.headless,
    slowMo: browserConfig.slowMoMs,
  });
  const context = await browser.newContext({
    storageState: fs.existsSync(STORAGE_STATE_PATH) ? STORAGE_STATE_PATH : undefined,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  return { browser, context, page };
}

export async function saveSession(context) {
  fs.mkdirSync(path.dirname(STORAGE_STATE_PATH), { recursive: true });
  await context.storageState({ path: STORAGE_STATE_PATH });
}

export async function screenshot(page, name) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const file = path.join(SHOT_DIR, `${Date.now()}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true }).catch(() => {});
  return file;
}

const isLoginUrl = (url) => /\/login(\?|$|\/)/.test(new URL(url).pathname + "?");

async function assertNoCaptcha(page) {
  const captcha = page.locator("iframe[src*='recaptcha'], iframe[src*='hcaptcha'], .g-recaptcha");
  if (await captcha.first().isVisible().catch(() => false)) {
    throw new CaptchaError("CAPTCHA が表示されました。`npm run login` で手動ログインしてください。");
  }
}

/** ログイン状態を確認し、切れていれば環境変数の認証情報で再ログインを試みる */
export async function ensureLoggedIn(page, selectors) {
  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "domcontentloaded" });
  if (!isLoginUrl(page.url())) return true;

  const email = process.env.CW_EMAIL;
  const password = process.env.CW_PASSWORD;
  if (!email || !password) {
    throw new LoginRequiredError("ログインが切れています。`npm run login` を実行するか CW_EMAIL / CW_PASSWORD を設定してください。");
  }
  await assertNoCaptcha(page);
  await page.locator(selectors.loginEmail).first().fill(email);
  await page.locator(selectors.loginPassword).first().fill(password);
  await Promise.all([
    page.waitForLoadState("domcontentloaded"),
    page.locator(selectors.loginSubmit).first().click(),
  ]);
  await sleep(2000);
  await assertNoCaptcha(page);
  if (isLoginUrl(page.url())) {
    await screenshot(page, "login-failed");
    throw new LoginRequiredError("自動ログインに失敗しました（認証情報・二段階認証を確認してください）。");
  }
  await saveSession(page.context());
  return true;
}

/** 手動ログイン: ブラウザを表示して、ユーザーがログインし終えるのを待ってセッションを保存 */
export async function interactiveLogin(browserConfig) {
  const { browser, context, page } = await launch(browserConfig, { headless: false });
  await page.goto(`${BASE_URL}/login`);
  console.log("ブラウザでログインしてください（二段階認証・CAPTCHA も手動で）。ダッシュボードが表示されたら自動で保存します。最大10分待機します。");
  await page.waitForURL((url) => !isLoginUrl(url.toString()) && url.hostname.endsWith("crowdworks.jp"), { timeout: 600_000 });
  await sleep(3000);
  await saveSession(context);
  await browser.close();
  console.log(`セッションを保存しました: ${STORAGE_STATE_PATH}`);
}

export function buildSearchUrl(keyword, pageNo = 1) {
  const u = new URL(`${BASE_URL}/public/jobs/search`);
  u.searchParams.set("search[keywords]", keyword);
  u.searchParams.set("keep_search_criteria", "true");
  u.searchParams.set("order", "new");
  u.searchParams.set("hide_expired", "true");
  if (pageNo > 1) u.searchParams.set("page", String(pageNo));
  return u.toString();
}

/** 検索結果ページの HTML から案件 ID とタイトルを取り出す（埋め込み JSON → リンクの順で試す） */
export function extractJobsFromSearchHtml(html) {
  const found = new Map();

  // 1) Vue 用に埋め込まれた JSON（data="{...}"）
  const m = html.match(/id="vue-container"[^>]*data="([^"]+)"/);
  if (m) {
    try {
      const json = JSON.parse(
        m[1].replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&amp;/g, "&"),
      );
      const offers = json?.searchResult?.job_offers ?? json?.job_offers ?? [];
      for (const o of offers) {
        const jo = o.job_offer ?? o;
        if (jo?.id) found.set(String(jo.id), { id: String(jo.id), title: jo.title ?? "" });
      }
    } catch {
      /* フォールバックへ */
    }
  }

  // 2) 案件詳細へのリンク
  for (const a of html.matchAll(/href="\/public\/jobs\/(\d+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const id = a[1];
    const title = a[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (!found.has(id)) found.set(id, { id, title });
    else if (!found.get(id).title && title) found.get(id).title = title;
  }

  return [...found.values()].map((j) => ({ ...j, url: `${BASE_URL}/public/jobs/${j.id}` }));
}

export async function searchJobs(page, urlOrKeyword, pages = 1) {
  const results = [];
  for (let p = 1; p <= pages; p++) {
    const url = /^https?:/.test(urlOrKeyword)
      ? (() => { const u = new URL(urlOrKeyword); if (p > 1) u.searchParams.set("page", String(p)); return u.toString(); })()
      : buildSearchUrl(urlOrKeyword, p);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    const jobs = extractJobsFromSearchHtml(await page.content());
    results.push(...jobs);
    if (!jobs.length) break;
  }
  return results;
}

/** 案件詳細ページのテキストから必要な情報を取り出す（純粋関数・テスト可能） */
export function parseJobDetailText({ id, url, title, bodyText, descriptionText }) {
  const t = bodyText ?? "";
  let contractType = null;
  if (/時間単価制/.test(t)) contractType = "hourly";
  else if (/固定報酬制/.test(t)) contractType = "fixed_price";
  else if (/タスク形式|タスク作業/.test(t)) contractType = "task";
  else if (/コンペ形式|コンペ/.test(t)) contractType = "competition";

  const job = { id: String(id), url, title, contractType, description: (descriptionText || t).slice(0, 8000) };

  if (contractType === "fixed_price") {
    const seg = t.match(/固定報酬制[^\n]*\n?[^\n]*円[^\n]*/)?.[0] ?? t.match(/(予算|報酬)[^\n]*\n?[^\n]*円[^\n]*/)?.[0];
    [job.budgetMin, job.budgetMax] = parseYenRange(seg?.replace(/^[^0-9〜~]*/, ""));
  } else if (contractType === "hourly") {
    const seg = t.match(/時間単価制[^\n]*\n?[^\n]*円[^\n]*/)?.[0];
    [job.hourlyMin, job.hourlyMax] = parseYenRange(seg?.replace(/^[^0-9〜~]*/, ""));
  }

  const applicants = t.match(/応募した人\s*\n?\s*(\d+)\s*人/);
  job.applicants = applicants ? Number(applicants[1]) : null;
  job.deadline = t.match(/応募期限\s*\n?\s*([^\n]+)/)?.[1]?.trim() ?? null;
  const rating = t.match(/(?:総合評価|評価)\s*\n?\s*(\d(?:\.\d+)?)/);
  job.clientRating = rating ? Number(rating[1]) : null;
  job.clientVerified = /本人確認済み/.test(t) ? true : /本人確認(未提出|なし|していません)/.test(t) ? false : null;
  job.expired = /(この仕事の)?募集は終了|募集終了/.test(t);
  job.alreadyApplied = /応募済み/.test(t);
  return job;
}

export async function getJobDetail(page, { id, url, title }) {
  await page.goto(url ?? `${BASE_URL}/public/jobs/${id}`, { waitUntil: "domcontentloaded" });
  const bodyText = await page.locator("body").innerText();
  const h1 = await page.locator("h1").first().innerText().catch(() => "");
  let descriptionText = "";
  for (const sel of [".job_offer_detail_table", "#job_offer_detail", "[class*='JobOfferDetail']", "[class*='description']", "main"]) {
    const loc = page.locator(sel).first();
    if (await loc.count()) {
      descriptionText = await loc.innerText().catch(() => "");
      if (descriptionText.length > 200) break;
    }
  }
  return parseJobDetailText({ id, url: page.url(), title: (h1 || title || "").trim(), bodyText, descriptionText });
}

async function firstVisible(page, selector) {
  const loc = page.locator(selector);
  const n = await loc.count();
  for (let i = 0; i < n; i++) {
    if (await loc.nth(i).isVisible().catch(() => false)) return loc.nth(i);
  }
  return null;
}

/** 表示されている textarea のうち最も大きいもの（＝メッセージ欄）を選ぶ */
async function largestVisibleTextarea(page, selector) {
  const loc = page.locator(selector);
  let best = null;
  let bestArea = 0;
  for (let i = 0; i < (await loc.count()); i++) {
    const el = loc.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    const box = await el.boundingBox();
    const area = box ? box.width * box.height : 0;
    if (area > bestArea) [best, bestArea] = [el, area];
  }
  return best;
}

/**
 * 応募フォームに入力して送信する。
 * @returns {{ok:boolean, dryRun?:boolean, message:string, screenshots:string[]}}
 */
export async function submitProposal(page, job, evaluation, selectors, { dryRun, amountYen }) {
  const shots = [];
  await page.goto(`${BASE_URL}/proposals/new?job_offer_id=${job.id}`, { waitUntil: "domcontentloaded" });
  if (isLoginUrl(page.url())) throw new LoginRequiredError("応募ページでログインを要求されました。");
  await assertNoCaptcha(page);

  const body = await page.locator("body").innerText();
  if (/応募済み|既に応募/.test(body)) return { ok: false, message: "既に応募済み", screenshots: shots };
  if (/募集は終了|募集終了/.test(body)) return { ok: false, message: "募集終了", screenshots: shots };

  const message = await largestVisibleTextarea(page, selectors.proposalMessage);
  if (!message) {
    shots.push(await screenshot(page, `form-not-found-${job.id}`));
    return { ok: false, message: "応募フォーム（メッセージ欄）が見つかりません。selectors を調整してください", screenshots: shots };
  }
  await message.fill(evaluation.proposal);

  if (amountYen > 0) {
    const amount = await firstVisible(page, selectors.proposalAmount);
    if (amount) {
      await amount.fill(String(amountYen));
      await amount.dispatchEvent("change");
    }
  }

  const delivery = await firstVisible(page, selectors.proposalDeliveryDate);
  if (delivery && evaluation.deliveryDays > 0) {
    const type = await delivery.getAttribute("type");
    const current = await delivery.inputValue().catch(() => "");
    if (!current) await delivery.fill(addDaysYmd(evaluation.deliveryDays, type === "date" ? "-" : "/"));
  }

  const boxes = page.locator(selectors.proposalAgreeCheckbox);
  for (let i = 0; i < (await boxes.count()); i++) {
    const b = boxes.nth(i);
    if ((await b.isVisible().catch(() => false)) && !(await b.isChecked())) await b.check();
  }

  shots.push(await screenshot(page, `filled-${job.id}`));
  if (dryRun) return { ok: true, dryRun: true, message: "dry-run: 入力のみで送信していません", screenshots: shots };

  const successRe = new RegExp(selectors.proposalSuccessText);
  // 「確認する」→「応募する」の 2 段階、または直接「応募する」の 1 段階に対応
  for (let step = 0; step < 3; step++) {
    const submit = await firstVisible(page, selectors.proposalSubmitButton);
    const confirm = submit ? null : await firstVisible(page, selectors.proposalConfirmButton);
    const btn = submit ?? confirm;
    if (!btn) break;
    await Promise.all([page.waitForLoadState("domcontentloaded").catch(() => {}), btn.click()]);
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await assertNoCaptcha(page);
    const text = await page.locator("body").innerText();
    const leftForm = !/\/proposals\/(new|confirm)/.test(new URL(page.url()).pathname);
    if (successRe.test(text) || (submit && leftForm)) {
      shots.push(await screenshot(page, `submitted-${job.id}`));
      return { ok: true, message: "応募完了", screenshots: shots };
    }
    // バリデーションエラーが出ていれば中断
    const err = text.match(/(入力してください|正しくありません|エラーが発生)[^\n]*/);
    if (err) {
      shots.push(await screenshot(page, `validation-${job.id}`));
      return { ok: false, message: `入力エラー: ${err[0]}`, screenshots: shots };
    }
  }
  shots.push(await screenshot(page, `unknown-${job.id}`));
  return { ok: false, message: "送信後の完了を確認できませんでした", screenshots: shots };
}
