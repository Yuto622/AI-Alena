/**
 * 応募後のメッセージ対応〜契約承諾を、実ブラウザ＋偽 CrowdWorks で通し検証する。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.CW_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cw-inbox-"));
delete process.env.SLACK_WEBHOOK_URL;
const { launch } = await import("../src/crowdworks.js");
const { runInbox } = await import("../src/inbox-runner.js");
const { Store } = await import("../src/store.js");
const { halt, unhalt } = await import("../src/safety.js");

const config = JSON.parse(fs.readFileSync(new URL("../config.example.json", import.meta.url)));
config.inbox.listUrls = ["https://crowdworks.jp/proposals"];

const threads = {
  501: { job: 1001, title: "Pythonで価格監視ツール開発", msgs: ["クライアント: 対応可能な納期を教えてください"] },
  502: { job: 1004, title: "GASで日報集計の自動化", msgs: ["クライアント: ぜひお願いします。契約内容をご確認ください"], contract: 95000 },
  503: { job: 1005, title: "Next.jsでLP制作", msgs: ["クライアント: 詳細はLINEでやり取りしましょう"] },
  504: { job: 1006, title: "スクレイピングツール改修", msgs: ["クライアント: 予算が厳しく、この金額でお願いします。契約内容をご確認ください"], contract: 50000 },
  599: { job: 9999, title: "手動で応募した昔の案件", msgs: ["クライアント: お元気ですか"] },
};
const accepted = [];
const html = (b) => `<!doctype html><html><head><meta charset="utf-8"></head><body>${b}</body></html>`;

function renderThread(id) {
  const t = threads[id];
  return html(`<h1><a href="/public/jobs/${t.job}">${t.title}</a></h1>
    <a href="/public/jobs/7777">おすすめ案件</a>
    ${t.msgs.map((m) => `<div class="msg">${m}</div>`).join("")}
    ${t.contract && !t.contracted ? `<div>契約内容 契約金額 ${t.contract.toLocaleString()} 円</div><form method="post" action="/proposals/${id}/accept"><label><input type="checkbox" name="agree_terms">同意</label><button type="submit">契約する</button></form>` : ""}
    ${t.contracted ? "<p>契約が成立しました</p>" : ""}
    <form method="post" action="/proposals/${id}/messages"><textarea name="body" style="width:600px;height:200px"></textarea><button type="submit">送信</button></form>`);
}

function fake(route) {
  const req = route.request();
  const p = new URL(req.url()).pathname;
  const send = (body) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body });
  if (p === "/dashboard") return send(html("<h1>ダッシュボード</h1>"));
  if (p === "/proposals") return send(html(Object.keys(threads).map((id) => `<a href="/proposals/${id}">${id}</a>`).join("")));
  let m = p.match(/^\/proposals\/(\d+)$/);
  if (m) return send(renderThread(m[1]));
  m = p.match(/^\/proposals\/(\d+)\/messages$/);
  if (m && req.method() === "POST") {
    threads[m[1]].msgs.push(`山田: ${new URLSearchParams(req.postData()).get("body")}`);
    return send(renderThread(m[1]));
  }
  m = p.match(/^\/proposals\/(\d+)\/accept$/);
  if (m && req.method() === "POST") {
    assert.equal(new URLSearchParams(req.postData()).get("agree_terms"), "on");
    threads[m[1]].contracted = true;
    accepted.push(m[1]);
    return send(renderThread(m[1]));
  }
  return route.fulfill({ status: 404, body: "nf" });
}

const deps = {
  launch: async (bc) => { const c = await launch({ ...bc, headless: true, slowMoMs: 0 }); await c.context.route("https://crowdworks.jp/**", fake); return c; },
  randomDelay: async () => {},
};

const agent = {
  calls: 0,
  async decide({ threadText, contractOffer, parsedContractYen }) {
    this.calls++;
    const lastLine = threadText.trim().split("\n").filter((l) => /^(クライアント|山田):/.test(l)).at(-1) ?? "";
    if (contractOffer) return { action: "accept_contract", message: "ご契約ありがとうございます。まず要件のヒアリングから始めます。", reason: "条件一致", contractAmountYen: parsedContractYen ?? 0 };
    if (lastLine.startsWith("山田:")) return { action: "wait", message: "", reason: "返信済み", contractAmountYen: 0 };
    return { action: "reply", message: "ご質問ありがとうございます。2週間で納品可能です。山田", reason: "質問への回答", contractAmountYen: 0 };
  },
};

function seedStore() {
  const store = new Store();
  for (const t of Object.values(threads)) {
    if (t.job === 9999) continue;
    store.upsert(t.job, { status: "applied", title: t.title, url: `https://crowdworks.jp/public/jobs/${t.job}`, amountYen: 100000, contractType: "fixed_price", evaluation: { proposal: "提案文" } });
  }
  return store;
}

test("返信・契約承諾・エスカレーション・対象外の振り分け", async () => {
  unhalt();
  const store = seedStore();
  const logs = [];
  const s = await runInbox(config, { store, agent, dryRun: false, log: (...a) => logs.push(a.join(" ")), deps });

  // 501: 質問に自動返信
  assert.equal(s.replied, 1, logs.join("\n"));
  assert.match(threads[501].msgs.at(-1), /^山田: ご質問ありがとうございます/);
  // 502: 95,000円（提案10万円の90%以上）→ 自動承諾＋着手メッセージ
  assert.deepEqual(accepted, ["502"]);
  assert.equal(s.contracted, 1);
  assert.match(threads[502].msgs.at(-1), /ご契約ありがとうございます/);
  assert.equal(store.get(1004).status, "contracted");
  // 503: LINE 誘導 → 送信せず本人へ
  assert.equal(store.thread("https://crowdworks.jp/proposals/503").status, "needs_human");
  assert.equal(threads[503].msgs.length, 1);
  // 504: 5万円（値切られすぎ）→ 承諾せず本人へ
  assert.equal(store.thread("https://crowdworks.jp/proposals/504").status, "needs_human");
  assert.match(store.thread("https://crowdworks.jp/proposals/504").escalation, /下限/);
  // 599: 応募記録なし（おすすめ案件リンクに釣られない）→ 触らない
  assert.equal(store.thread("https://crowdworks.jp/proposals/599").status, "unmanaged");
  assert.equal(threads[599].msgs.length, 1);
  // 監査ログに残る
  const auditLog = fs.readFileSync(path.join(process.env.CW_DATA_DIR, "audit.jsonl"), "utf8");
  assert.match(auditLog, /contract\.accept\.result/);
  assert.match(auditLog, /message\.send/);

  // 2 巡目: 変化がないので AI も呼ばず、何も送らない
  const callsBefore = agent.calls;
  const s2 = await runInbox(config, { store, agent, dryRun: false, log: () => {}, deps });
  assert.equal(agent.calls, callsBefore);
  assert.equal(s2.replied + s2.contracted, 0);

  // クライアントが再度質問 → クールダウン中なので返信しない
  threads[501].msgs.push("クライアント: 追加で質問です");
  const s3 = await runInbox(config, { store, agent, dryRun: false, log: () => {}, deps });
  assert.equal(s3.replied, 0);
});

test("緊急停止中は一切送信しない", async () => {
  threads[501].msgs.push("クライアント: まだですか？");
  const store = new Store();
  store.upsertThread("https://crowdworks.jp/proposals/501", { lastRepliedAt: null });
  await halt("テスト停止");
  const before = threads[501].msgs.length;
  const s = await runInbox(config, { store, agent, dryRun: false, log: () => {}, deps });
  assert.equal(s.aborted, "stopped");
  assert.equal(threads[501].msgs.length, before);
  unhalt();
});
