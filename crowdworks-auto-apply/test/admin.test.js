import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.CW_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cw-admin-"));
delete process.env.CW_CONFIG;
delete process.env.SLACK_WEBHOOK_URL;
const { createAdminServer } = await import("../src/admin/server.js");
const { Store } = await import("../src/store.js");
const { isStopped, unhalt } = await import("../src/safety.js");

const PASSWORD = "correct horse battery";
const store = new Store();
store.upsert("1", { status: "applied", title: '<script>alert(1)</script>悪意ある案件', url: "javascript:alert(1)", amountYen: 50000 });
store.upsertThread("https://crowdworks.jp/proposals/9", { jobId: "1", status: "needs_human", escalation: "<img src=x onerror=alert(1)>", suggestedReply: "返信案です" });

const runs = [];
const scheduler = {
  busy: null,
  status: () => ({ busy: null, stopped: isStopped(), stopReason: null, dryRun: true, mode: "auto", activeHours: [9, 21], inActiveHours: true, lastResults: {} }),
  run: async (kind) => { runs.push(kind); return { ok: true }; },
  exclusive: async (name, fn) => ({ ok: true, value: await fn() }),
};

let server;
let base;
before(async () => {
  server = createAdminServer({ store, scheduler, password: PASSWORD, checkLogin: async () => true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const form = (o) => new URLSearchParams(o).toString();
async function login(password = PASSWORD) {
  const r = await fetch(`${base}/login`, { method: "POST", body: form({ password }), headers: { "content-type": "application/x-www-form-urlencoded" }, redirect: "manual" });
  const cookie = r.headers.get("set-cookie")?.split(";")[0];
  return { status: r.status, cookie };
}
async function csrfFrom(cookie, page = "/") {
  const html = await (await fetch(`${base}${page}`, { headers: { cookie } })).text();
  return html.match(/name="csrf" value="([^"]+)"/)[1];
}
const post = (cookie, p, body) => fetch(`${base}${p}`, { method: "POST", headers: { cookie, "content-type": "application/x-www-form-urlencoded" }, body: form(body), redirect: "manual" });

test("パスワード短すぎると起動しない", () => {
  assert.throws(() => createAdminServer({ store, scheduler, password: "short" }), /12 文字以上/);
});

test("未ログインはログイン画面へ、ヘルスチェックは公開", async () => {
  const r = await fetch(`${base}/`, { redirect: "manual" });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get("location"), "/login");
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
  const r2 = await fetch(`${base}/jobs`, { redirect: "manual" });
  assert.equal(r2.status, 303);
});

test("ログインとセキュリティヘッダ・XSS エスケープ", async () => {
  const { status, cookie } = await login();
  assert.equal(status, 303);
  const r = await fetch(`${base}/`, { headers: { cookie } });
  assert.match(r.headers.get("content-security-policy"), /script-src 'self'/);
  assert.equal(r.headers.get("x-frame-options"), "DENY");
  const html = await r.text();
  assert.match(html, /要対応スレッド/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x/);
  const jobs = await (await fetch(`${base}/jobs`, { headers: { cookie } })).text();
  assert.doesNotMatch(jobs, /<script>alert/);
  assert.doesNotMatch(jobs, /href="javascript:/);
});

test("CSRF トークンなしの操作は拒否", async () => {
  const { cookie } = await login();
  const r = await post(cookie, "/actions/stop", { reason: "x" });
  assert.equal(r.status, 403);
  assert.equal(isStopped(), false);
  const r2 = await fetch(`${base}/actions/stop`, { method: "POST", headers: { cookie, origin: "https://evil.example", "content-type": "application/x-www-form-urlencoded" }, body: form({ csrf: await csrfFrom(cookie) }), redirect: "manual" });
  assert.equal(r2.status, 403);
});

test("緊急停止・解除・手動実行・スレッド復帰", async () => {
  const { cookie } = await login();
  const csrf = await csrfFrom(cookie);
  assert.equal((await post(cookie, "/actions/stop", { csrf, reason: "テスト" })).status, 303);
  assert.equal(isStopped(), true);
  assert.match(await (await fetch(`${base}/`, { headers: { cookie } })).text(), /停止中/);
  await post(cookie, "/actions/unhalt", { csrf });
  assert.equal(isStopped(), false);

  await post(cookie, "/actions/run", { csrf, kind: "inbox" });
  assert.deepEqual(runs, ["inbox"]);

  await post(cookie, "/threads/resume", { csrf, url: "https://crowdworks.jp/proposals/9" });
  assert.equal(new Store().thread("https://crowdworks.jp/proposals/9").status, "active");
});

test("設定: 正しい値は保存、危険な値は拒否", async () => {
  const { cookie } = await login();
  const csrf = await csrfFrom(cookie, "/settings");
  const ok = await post(cookie, "/settings", { csrf, mode: "auto", dryRun: "on", activeStart: "10", activeEnd: "20", intervalMinutes: "60", inboxIntervalMinutes: "10",
    maxApplicationsPerDay: "5", maxApplicationsPerRun: "2", minScore: "75", minBudgetYen: "30000", minHourlyYen: "2000", maxApplicants: "20",
    keywords: "GAS\nRoblox", autoAcceptContract: "on", minAcceptRatio: "0.9", minContractYen: "10000", maxContractYen: "150000", maxRepliesPerDay: "20" });
  assert.match(decodeURIComponent(ok.headers.get("location")), /保存しました/);
  const saved = JSON.parse(fs.readFileSync(path.join(process.env.CW_DATA_DIR, "config.json"), "utf8"));
  assert.equal(saved.limits.maxApplicationsPerDay, 5);
  assert.deepEqual(saved.search.keywords, ["GAS", "Roblox"]);
  assert.equal(saved.dryRun, true);

  const bad = await post(cookie, "/settings", { csrf, maxApplicationsPerDay: "500", activeStart: "9", activeEnd: "21", intervalMinutes: "60", inboxIntervalMinutes: "10", minScore: "70" });
  assert.match(decodeURIComponent(bad.headers.get("location")), /保存できませんでした/);
  const bad2 = await post(cookie, "/settings", { csrf, autoAcceptContract: "on", maxContractYen: "0", activeStart: "9", activeEnd: "21", intervalMinutes: "60", inboxIntervalMinutes: "10", minScore: "70" });
  assert.match(decodeURIComponent(bad2.headers.get("location")), /保存できませんでした/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(process.env.CW_DATA_DIR, "config.json"), "utf8")).limits.maxApplicationsPerDay, 5);
});

test("ログイン情報のアップロードは検証してから保存（権限 600）", async () => {
  const { cookie } = await login();
  const csrf = await csrfFrom(cookie, "/session");
  const bad = await post(cookie, "/session/upload", { csrf, json: '{"cookies":[{"domain":".example.com"}]}' });
  assert.match(decodeURIComponent(bad.headers.get("location")), /登録できませんでした/);
  await post(cookie, "/session/upload", { csrf, json: JSON.stringify({ cookies: [{ name: "s", value: "v", domain: ".crowdworks.jp" }], origins: [] }) });
  const file = path.join(process.env.CW_DATA_DIR, "storage-state.json");
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test("ログイン失敗が続くとロック", async () => {
  for (let i = 0; i < 5; i++) assert.equal((await login("wrong-password-x")).status, 401);
  assert.equal((await login()).status, 401); // 正しいパスワードでもロック中
  unhalt();
});
