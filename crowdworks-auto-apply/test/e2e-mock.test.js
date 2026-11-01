/**
 * 実ブラウザ（Chromium）で、crowdworks.jp へのリクエストを偽サイトに差し替えて
 * 検索 → 詳細 → ルールフィルタ → (モック)AI審査 → 応募送信 の全工程を通しで検証する。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.CW_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cw-e2e-"));
const { launch } = await import("../src/crowdworks.js");
const { runOnce } = await import("../src/runner.js");
const { Store } = await import("../src/store.js");

const config = JSON.parse(fs.readFileSync(new URL("../config.example.json", import.meta.url)));
config.search = { keywords: ["Python"], searchUrls: [], pagesPerQuery: 1 };
config.limits.delayBetweenPagesSec = [0, 0];

const submissions = [];
const html = (body) => `<!doctype html><html><head><meta charset="utf-8"></head><body>${body}</body></html>`;

function fakeCrowdWorks(route) {
  const req = route.request();
  const url = new URL(req.url());
  const p = url.pathname;
  const send = (body) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html(body) });

  if (p === "/dashboard") return send("<h1>ダッシュボード</h1>");
  if (p === "/public/jobs/search")
    return send(`<a href="/public/jobs/1001">Python自動化</a><a href="/public/jobs/1002">激安案件</a><a href="/public/jobs/1003">AIが断る案件</a>`);
  if (p === "/public/jobs/1001")
    return send(`<h1>Pythonで価格監視ツール開発</h1><div class="job_offer_detail_table">固定報酬制<br>50,000円 〜 100,000円<br>応募した人<br>3 人<br>ECサイトの価格を毎日取得してスプレッドシートに出力するツールを作ってください。</div>`);
  if (p === "/public/jobs/1002")
    return send(`<h1>データ入力</h1><div class="job_offer_detail_table">固定報酬制<br>〜 1,000円<br>応募した人<br>2 人</div>`);
  if (p === "/public/jobs/1003")
    return send(`<h1>よく分からない案件</h1><div class="job_offer_detail_table">固定報酬制<br>40,000円 〜 60,000円<br>応募した人<br>1 人</div>`);
  if (p === "/proposals/new" && req.method() === "GET")
    return send(`<form method="post" action="/proposals/new?job_offer_id=${url.searchParams.get("job_offer_id")}">
      <input name="proposal[amount]" type="text"><input name="proposal[deliver_date]" type="date">
      <textarea name="proposal[message]" style="width:600px;height:300px"></textarea>
      <label><input type="checkbox" name="agree_terms"> 同意する</label>
      <button type="submit">応募する</button></form>`);
  if (p === "/proposals/new" && req.method() === "POST") {
    submissions.push({ jobId: url.searchParams.get("job_offer_id"), form: Object.fromEntries(new URLSearchParams(req.postData())) });
    return send("<p>応募が完了しました</p>");
  }
  return route.fulfill({ status: 404, body: "not found" });
}

async function mockLaunch(browserConfig) {
  const ctx = await launch({ ...browserConfig, headless: true, slowMoMs: 0 });
  await ctx.context.route("https://crowdworks.jp/**", fakeCrowdWorks);
  return ctx;
}

const evaluator = {
  calls: 0,
  async evaluate(job) {
    this.calls++;
    if (job.id === "1003") return { apply: false, score: 30, reason: "スキル不一致", risks: [], proposal: "", amountYen: 0, deliveryDays: 0 };
    return { apply: true, score: 88, reason: "経験と一致", risks: [], proposal: `はじめまして。${job.title}について提案します。`, amountYen: 120000, deliveryDays: 14 };
  },
};

test("dry-run → 本番の通し実行（モックCrowdWorks）", async () => {
  const store = new Store();
  const logs = [];
  const log = (...a) => logs.push(a.join(" "));
  const deps = { launch: mockLaunch, randomDelay: async () => {} };

  // 1) dry-run: 入力まで。送信しない
  const dry = await runOnce({ ...config, mode: "auto" }, { store, evaluator, dryRun: true, log, deps });
  assert.equal(dry.found, 3);
  assert.equal(dry.filtered, 1); // 1002: 予算不足
  assert.equal(dry.rejected, 1); // 1003: AI が却下
  assert.equal(submissions.length, 0);
  assert.equal(store.get("1001").status, "dryrun");

  // 2) 本番: dry-run の審査結果を再利用して送信
  const callsBefore = evaluator.calls;
  const live = await runOnce({ ...config, mode: "auto" }, { store, evaluator, dryRun: false, log, deps });
  assert.equal(live.applied, 1, logs.join("\n"));
  assert.equal(evaluator.calls, callsBefore, "審査結果が再利用されること");
  assert.equal(submissions.length, 1);
  const { form, jobId } = submissions[0];
  assert.equal(jobId, "1001");
  assert.equal(form["proposal[amount]"], "100000"); // 予算上限に丸められる
  assert.match(form["proposal[message]"], /価格監視ツール/);
  assert.equal(form["agree_terms"], "on");
  assert.match(form["proposal[deliver_date]"], /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(store.get("1001").status, "applied");
  assert.equal(store.appliedToday(), 1);

  // 3) 再実行しても二重応募しない
  const again = await runOnce({ ...config, mode: "auto" }, { store, evaluator, dryRun: false, log, deps });
  assert.equal(again.found, 0);
  assert.equal(submissions.length, 1);
});

test("日次上限に達していたら何もしない", async () => {
  const store = new Store(path.join(process.env.CW_DATA_DIR, "limit.json"));
  store.state.daily[Store.today()] = config.limits.maxApplicationsPerDay;
  store.save();
  let launched = false;
  const s = await runOnce(config, { store, evaluator, dryRun: false, log: () => {}, deps: { launch: async () => { launched = true; } } });
  assert.equal(launched, false);
  assert.equal(s.applied, 0);
});
