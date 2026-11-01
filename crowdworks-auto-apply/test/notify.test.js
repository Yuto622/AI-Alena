import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.CW_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cw-notify-"));
process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/T/B/X";
const { contractMessage, flushNotifyQueue, notifyImportant, slackConfigured } = await import("../src/notify.js");

const fake = (statuses) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(JSON.parse(init.body));
    const status = statuses.shift() ?? 200;
    return { ok: status < 300, status, text: async () => "" };
  };
  return { calls, fetchImpl };
};

test("受注メッセージの内容", () => {
  const m = contractMessage({ title: "GAS<自動化>", amountYen: 95000, proposedYen: 100000, source: "auto", kickoffSent: true, jobUrl: "https://crowdworks.jp/public/jobs/1", threadUrl: "https://crowdworks.jp/proposals/2" });
  assert.match(m.text, /受注しました.*95,000円/);
  const s = JSON.stringify(m.blocks);
  assert.match(s, /100,000円/);
  assert.match(s, /自動/);
  assert.doesNotMatch(s, /GAS<自動化>/); // Slack の制御文字を除去
  assert.equal(slackConfigured(), true);
});

test("一時的な失敗は再試行、最終的な失敗はキューに保存して次回再送", async () => {
  const a = fake([500, 200]);
  assert.equal((await notifyImportant({ text: "x" }, { fetchImpl: a.fetchImpl })).ok, true);
  assert.equal(a.calls.length, 2);

  const b = fake([500, 500, 500]);
  const r = await notifyImportant({ text: "受注" }, { fetchImpl: b.fetchImpl });
  assert.equal(r.ok, false);
  const q = path.join(process.env.CW_DATA_DIR, "notify-queue.jsonl");
  assert.equal(fs.readFileSync(q, "utf8").trim().split("\n").length, 1);

  const c = fake([200]);
  const f = await flushNotifyQueue({ fetchImpl: c.fetchImpl });
  assert.deepEqual(f, { sent: 1, remaining: 0 });
  assert.equal(c.calls[0].text, "受注");
  assert.equal(fs.existsSync(q), false);
});

test("URL 間違い(404)は再試行しない", async () => {
  const d = fake([404, 200]);
  await notifyImportant({ text: "y" }, { fetchImpl: d.fetchImpl });
  assert.equal(d.calls.length, 1);
  fs.rmSync(path.join(process.env.CW_DATA_DIR, "notify-queue.jsonl"), { force: true });
});
