/**
 * 応募後のメッセージスレッド・契約申し込みを扱うブラウザ操作。
 * CrowdWorks の DOM を前提にしすぎないよう、スレッドは「画面のテキスト全体」を LLM に渡す方式。
 */
import { BASE_URL, CaptchaError, LoginRequiredError, screenshot } from "./crowdworks.js";
import { sleep } from "./util.js";

const isLoginUrl = (url) => /\/login(\?|$|\/)/.test(new URL(url).pathname + "?");

/** 一覧ページの HTML からスレッド URL を取り出す */
export function extractThreadLinks(html, patterns) {
  const urls = new Set();
  for (const p of patterns) {
    for (const m of html.matchAll(new RegExp(`href="(${p})(?:[?#][^"]*)?"`, "g"))) {
      urls.add(new URL(m[1].replace(/&amp;/g, "&"), BASE_URL).toString());
    }
  }
  return [...urls];
}

export async function listThreads(page, inbox) {
  const all = new Set();
  for (const url of inbox.listUrls) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    if (isLoginUrl(page.url())) throw new LoginRequiredError("メッセージ一覧でログインを要求されました。");
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    for (const u of extractThreadLinks(await page.content(), inbox.threadLinkPatterns)) all.add(u);
  }
  return [...all].slice(0, inbox.maxThreadsPerPass);
}

async function firstVisible(page, selector) {
  const loc = page.locator(selector);
  for (let i = 0; i < (await loc.count()); i++) if (await loc.nth(i).isVisible().catch(() => false)) return loc.nth(i);
  return null;
}

/** スレッドを開いて、テキスト・案件ID・契約申し込みの有無を返す */
export async function readThread(page, url, selectors) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  if (isLoginUrl(page.url())) throw new LoginRequiredError("スレッドでログインを要求されました。");
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  let text = "";
  for (const sel of selectors.threadContainer.split(",").map((s) => s.trim())) {
    const loc = page.locator(sel).first();
    if (await loc.count()) {
      text = await loc.innerText().catch(() => "");
      if (text.length > 50) break;
    }
  }
  const html = await page.content();
  const jobIds = [...new Set([...html.matchAll(/\/public\/jobs\/(\d+)/g)].map((m) => m[1]))];
  const acceptBtn = await firstVisible(page, selectors.contractAcceptButton);
  const contractOffer = Boolean(acceptBtn) && new RegExp(selectors.contractOfferText).test(text);
  // 長いスレッドは末尾（最新）を優先して渡す
  return { url: page.url(), jobIds, text: text.length > 15000 ? text.slice(-15000) : text, contractOffer };
}

/** スレッドにメッセージを送信し、画面に反映されたことを確認する */
export async function sendMessage(page, text, selectors) {
  const loc = page.locator(selectors.threadMessageInput);
  let box = null;
  let area = 0;
  for (let i = 0; i < (await loc.count()); i++) {
    const el = loc.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    const b = await el.boundingBox();
    if (b && b.width * b.height > area) [box, area] = [el, b.width * b.height];
  }
  if (!box) return { ok: false, message: "メッセージ入力欄が見つかりません（selectors.threadMessageInput を調整）" };
  await box.fill(text);
  const send = await firstVisible(page, selectors.threadSendButton);
  if (!send) return { ok: false, message: "送信ボタンが見つかりません（selectors.threadSendButton を調整）" };
  await Promise.all([page.waitForLoadState("domcontentloaded").catch(() => {}), send.click()]);
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  if (await page.locator("iframe[src*='recaptcha']").first().isVisible().catch(() => false)) throw new CaptchaError("CAPTCHA が表示されました");
  const probe = text.replace(/\s+/g, " ").slice(0, 30);
  const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  if (!body.includes(probe)) {
    const shot = await screenshot(page, "message-unconfirmed");
    return { ok: false, message: "送信後に本文が画面で確認できません", screenshot: shot };
  }
  return { ok: true, message: "送信完了" };
}

/** 契約申し込みを承諾する（同意チェック → 承諾ボタン → 確認ダイアログ/確認画面） */
export async function acceptContract(page, selectors) {
  const onDialog = (d) => d.accept().catch(() => {});
  page.on("dialog", onDialog);
  try {
    const boxes = page.locator(selectors.contractAgreeCheckbox);
    for (let i = 0; i < (await boxes.count()); i++) {
      const b = boxes.nth(i);
      if ((await b.isVisible().catch(() => false)) && !(await b.isChecked())) await b.check();
    }
    const doneRe = new RegExp(selectors.contractDoneText);
    for (let step = 0; step < 3; step++) {
      const btn = await firstVisible(page, selectors.contractAcceptButton);
      if (!btn) break;
      await Promise.all([page.waitForLoadState("domcontentloaded").catch(() => {}), btn.click()]);
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      await sleep(1000);
      if (doneRe.test(await page.locator("body").innerText())) {
        return { ok: true, message: "契約成立", screenshot: await screenshot(page, "contract-accepted") };
      }
    }
    return { ok: false, message: "契約承諾の完了を確認できませんでした", screenshot: await screenshot(page, "contract-unconfirmed") };
  } finally {
    page.off("dialog", onDialog);
  }
}
