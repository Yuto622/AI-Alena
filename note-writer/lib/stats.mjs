// note のダッシュボードから、記事ごとの閲覧数と販売数を取り込む（毎日1回）。
// 閲覧数：ダッシュボードが使っている /api/v1/stats/pv を、ログイン済みのブラウザから呼ぶ。
// 販売数：「販売履歴」を開いたときに届くデータから、記事ごとの今月の件数を数える。
// どちらも note の非公開の仕組みなので、形が変わったら取り込みに失敗し、届いたデータを out/ に残す
import fs from "fs";
import path from "path";
import { DATA_DIR } from "./config.mjs";
import { listArticles } from "./article.mjs";
import { getSales, upsertSales, readJson, writeJson } from "./store.mjs";
import { withNote } from "./publisher.mjs";
import { currentMonth } from "./insights.mjs";

const STATE = path.join(DATA_DIR, "stats-import.json");

export const lastImport = () => readJson(STATE, {});

const noteKey = (url) => (String(url || "").match(/\/n\/(n[0-9a-z]+)/) || [])[1];

// 閲覧数（今月分）。ページを順にたどる
async function fetchMonthlyViews(page) {
  const views = {};
  for (let p = 1; p <= 20; p++) {
    const json = await page.evaluate(async (p) => {
      const r = await fetch(`/api/v1/stats/pv?filter=monthly&page=${p}&sort=pv`, { credentials: "include" });
      return r.ok ? r.json() : { error: r.status };
    }, p);
    const list = json?.data?.note_stats;
    if (!Array.isArray(list)) throw new Error(`閲覧数のデータの形が想定と違います（${JSON.stringify(json).slice(0, 120)}）`);
    for (const n of list) if (n.key) views[n.key] = n.read_count ?? 0;
    if (json.data.last_page !== false || list.length === 0) break;
  }
  return views;
}

// 届いた JSON の中から、記事の key（n + 英数字）と日時を持つ要素を探して、今月の件数を数える
export function countSales(responses, month) {
  const counts = {};
  const seen = new Set();
  const KEY = /"(?:key|note_key|noteKey)":"(n[0-9a-z]{8,})"/;
  const AT = /"(?:created_at|createdAt|purchased_at|purchasedAt|sold_at)":"([^"]+)"/;
  const looksLikeSale = (text) => KEY.test(text) && AT.test(text);
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== "object") return;
    // 中にまだ「販売1件」に見える要素があれば、それは入れ物なので中をたどる
    const children = Object.values(v).filter((c) => c && typeof c === "object");
    if (children.some((c) => looksLikeSale(JSON.stringify(c)))) return children.forEach(walk);
    const text = JSON.stringify(v);
    const key = (text.match(KEY) || [])[1];
    const at = (text.match(AT) || [])[1];
    const id = (text.match(/"id":(\d+|"[^"]+")/) || [])[1];
    if (key && at) {
      const sig = `${id || ""}|${key}|${at}`;
      const jst = new Date(Date.parse(at) + 9 * 36e5).toISOString().slice(0, 7);
      if (!seen.has(sig) && jst === month) {
        seen.add(sig);
        counts[key] = (counts[key] || 0) + 1;
      }
      return;
    }
    Object.values(v).forEach(walk);
  };
  responses.forEach(walk);
  return { counts, found: seen.size };
}

async function fetchMonthlySales(page, run, month) {
  const responses = [];
  page.on("response", async (res) => {
    if (!res.url().includes("note.com/api/")) return;
    if (!(res.headers()["content-type"] || "").includes("json")) return;
    try {
      responses.push(await res.json());
    } catch {}
  });
  await page.goto("https://note.com/sitesettings/stats", { waitUntil: "domcontentloaded" });
  const link = page.locator('a:has-text("販売履歴")').first();
  await link.click({ timeout: 15000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(3000);
  await run.shot(page, "sales-history");
  // 形を確かめられるよう、届いたデータを残しておく
  fs.mkdirSync(run.dir, { recursive: true });
  fs.writeFileSync(path.join(run.dir, "sales-responses.json"), JSON.stringify(responses, null, 1).slice(0, 2_000_000));
  return countSales(responses, month);
}

export async function importStats({ account = "default", now = new Date() } = {}) {
  const month = currentMonth(now);
  const result = await withNote(account, "stats", async (page, run) => {
    const views = await fetchMonthlyViews(page).catch((e) => ({ error: e.message }));
    const sales = await fetchMonthlySales(page, run, month).catch((e) => ({ error: e.message }));
    const before = Object.fromEntries(getSales().filter((r) => r.month === month).map((r) => [r.file, r]));
    let updated = 0;
    for (const a of listArticles().filter((x) => x.status === "published" && (x.account || "default") === account)) {
      const key = noteKey(a.url);
      if (!key) continue;
      const prev = before[a.name] || {};
      const v = views.error ? prev.views : views[key] ?? prev.views ?? 0;
      // 販売の取り込みに失敗したとき・1件も見つからないときは、手で入れた数字を残す
      const s = sales.error || sales.found === 0 ? prev.sales ?? 0 : sales.counts[key] || 0;
      upsertSales({ file: a.name, month, sales: s, views: v });
      updated++;
    }
    run.info(`📊 ${updated} 本の記事の数字を更新（閲覧数：${views.error ? `失敗 ${views.error}` : "OK"}／販売数：${
      sales.error ? `失敗 ${sales.error}` : sales.found ? `${sales.found} 件` : "見つからず（手入力の数字を残しました）"}）`);
    return { updated, viewsError: views.error || null, salesError: sales.error || null, salesFound: sales.found ?? 0 };
  });
  writeJson(STATE, { at: now.toISOString(), ...result, log: undefined });
  return result;
}

// 1日1回だけ動かす（tick から呼ぶ）
export async function importStatsDaily(now = new Date()) {
  const last = lastImport().at;
  const today = new Date(now.getTime() + 9 * 36e5).toISOString().slice(0, 10);
  if (last && new Date(Date.parse(last) + 9 * 36e5).toISOString().slice(0, 10) === today) return { skipped: "今日は取り込み済み" };
  if (!listArticles().some((a) => a.status === "published")) return { skipped: "公開した記事がまだありません" };
  return importStats({ now });
}
