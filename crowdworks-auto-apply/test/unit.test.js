import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clampAmount, parseYenRange, ruleFilter } from "../src/filter.js";
import { extractJobsFromSearchHtml, parseJobDetailText } from "../src/crowdworks.js";
import { Store } from "../src/store.js";
import { inActiveHours } from "../src/util.js";
import { validateConfig } from "../src/config.js";

const config = JSON.parse(fs.readFileSync(new URL("../config.example.json", import.meta.url)));

test("parseYenRange", () => {
  assert.deepEqual(parseYenRange("50,000円 〜 100,000円"), [50000, 100000]);
  assert.deepEqual(parseYenRange("〜 30,000 円"), [null, 30000]);
  assert.deepEqual(parseYenRange("5万円"), [50000, 50000]);
  assert.deepEqual(parseYenRange("相談"), [null, null]);
});

test("ruleFilter: 通過と除外", () => {
  const ok = { title: "Pythonでスクレイピング", description: "毎日価格取得", contractType: "fixed_price", budgetMin: 50000, budgetMax: 80000, applicants: 3 };
  assert.equal(ruleFilter(ok, config.filters).ok, true);

  const cheap = { ...ok, budgetMin: 1000, budgetMax: 5000 };
  assert.match(ruleFilter(cheap, config.filters).reasons.join(), /予算不足/);

  const spam = { ...ok, description: "詳細はLINE登録後にお伝えします" };
  assert.match(ruleFilter(spam, config.filters).reasons.join(), /除外キーワード/);

  const crowded = { ...ok, applicants: 99 };
  assert.match(ruleFilter(crowded, config.filters).reasons.join(), /応募者過多/);

  const task = { ...ok, contractType: "task" };
  assert.match(ruleFilter(task, config.filters).reasons.join(), /契約形式/);
});

test("clampAmount は予算レンジ内に丸める", () => {
  const job = { contractType: "fixed_price", budgetMin: 50000, budgetMax: 100000 };
  assert.equal(clampAmount(150000, job), 100000);
  assert.equal(clampAmount(10000, job), 50000);
  assert.equal(clampAmount(77777, job), 77800);
  assert.equal(clampAmount(0, job), 100000);
});

test("extractJobsFromSearchHtml: 埋め込みJSONとリンク", () => {
  const data = JSON.stringify({ searchResult: { job_offers: [{ job_offer: { id: 111, title: "案件A" } }] } }).replace(/"/g, "&quot;");
  const html = `<div id="vue-container" data="${data}"></div><a href="/public/jobs/222"><span>案件B</span></a><a href="/public/jobs/111">dup</a>`;
  const jobs = extractJobsFromSearchHtml(html);
  assert.deepEqual(jobs.map((j) => [j.id, j.title]), [["111", "案件A"], ["222", "案件B"]]);
  assert.equal(jobs[1].url, "https://crowdworks.jp/public/jobs/222");
});

test("parseJobDetailText", () => {
  const bodyText = `Python自動化ツール開発\n固定報酬制\n50,000円 〜 100,000円\n応募期限\n2026年11月20日\n応募した人\n4 人\n本人確認済み\n総合評価\n4.8`;
  const job = parseJobDetailText({ id: 1, url: "u", title: "t", bodyText });
  assert.equal(job.contractType, "fixed_price");
  assert.equal(job.budgetMin, 50000);
  assert.equal(job.budgetMax, 100000);
  assert.equal(job.applicants, 4);
  assert.equal(job.clientVerified, true);
  assert.equal(job.clientRating, 4.8);
  assert.equal(job.deadline, "2026年11月20日");
  assert.equal(job.expired, false);

  const hourly = parseJobDetailText({ id: 2, bodyText: "時間単価制\n1,500円 〜 2,500円 / 時間" });
  assert.equal(hourly.contractType, "hourly");
  assert.deepEqual([hourly.hourlyMin, hourly.hourlyMax], [1500, 2500]);
});

test("Store: 日次カウントと isDone", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cw-")), "s.json");
  const s = new Store(file);
  s.upsert(1, { status: "dryrun" });
  s.upsert(2, { status: "failed" });
  s.upsert(3, { status: "rejected" });
  assert.equal(s.isDone(1), false);
  assert.equal(s.isDone(2), false);
  assert.equal(s.isDone(3), true);
  s.recordApplication(1, {});
  assert.equal(s.appliedToday(), 1);
  assert.equal(new Store(file).appliedToday(), 1);
});

test("inActiveHours (JST)", () => {
  const at = (h) => new Date(Date.UTC(2026, 0, 1, (h - 9 + 24) % 24));
  assert.equal(inActiveHours([8, 23], at(10)), true);
  assert.equal(inActiveHours([8, 23], at(3)), false);
  assert.equal(inActiveHours([22, 6], at(2)), true);
});

test("validateConfig: 危険な設定を拒否", () => {
  assert.doesNotThrow(() => validateConfig(config));
  assert.throws(() => validateConfig({ ...config, limits: { ...config.limits, maxApplicationsPerDay: 500 } }), /maxApplicationsPerDay/);
  assert.throws(() => validateConfig({ ...config, limits: { ...config.limits, delayBetweenApplicationsSec: [1, 2] } }), /delay/);
});
