import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config.js";

/**
 * 既読・応募履歴を JSON ファイルで保持する簡易ストア。
 * status: seen | filtered | rejected | drafted | applied | failed
 */
export class Store {
  constructor(file = path.join(DATA_DIR, "state.json")) {
    this.file = file;
    this.reload();
  }

  /** 別プロセス（resume コマンド等）の変更を取り込む。各巡回の最初に呼ぶ */
  reload() {
    this.state = { jobs: {}, daily: {}, threads: {}, replies: {} };
    if (fs.existsSync(this.file)) {
      try {
        this.state = { ...this.state, ...JSON.parse(fs.readFileSync(this.file, "utf8")) };
      } catch {
        fs.copyFileSync(this.file, `${this.file}.broken-${Date.now()}`);
      }
    }
    return this;
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmp, this.file);
  }

  static today(now = new Date()) {
    // 日本時間の日付で日次上限を数える
    return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  }

  has(id) {
    return Boolean(this.state.jobs[String(id)]);
  }

  get(id) {
    return this.state.jobs[String(id)];
  }

  /** 失敗・dry-run の案件は本番で再処理できるよう「処理済み」とみなさない */
  isDone(id) {
    const j = this.get(id);
    return Boolean(j) && !["failed", "dryrun"].includes(j.status);
  }

  upsert(id, patch) {
    const key = String(id);
    this.state.jobs[key] = { ...(this.state.jobs[key] ?? { firstSeenAt: new Date().toISOString() }), ...patch, updatedAt: new Date().toISOString() };
    this.save();
    return this.state.jobs[key];
  }

  appliedToday(now = new Date()) {
    return this.state.daily[Store.today(now)] ?? 0;
  }

  recordApplication(id, patch, now = new Date()) {
    const day = Store.today(now);
    this.state.daily[day] = (this.state.daily[day] ?? 0) + 1;
    return this.upsert(id, { ...patch, status: "applied", appliedAt: now.toISOString() });
  }

  // ---- メッセージスレッド ----
  thread(url) {
    return this.state.threads[url];
  }

  upsertThread(url, patch) {
    this.state.threads[url] = { ...(this.state.threads[url] ?? { url, status: "active", sent: [], firstSeenAt: new Date().toISOString() }), ...patch, updatedAt: new Date().toISOString() };
    this.save();
    return this.state.threads[url];
  }

  recordReply(url, text, now = new Date()) {
    const day = Store.today(now);
    this.state.replies[day] = (this.state.replies[day] ?? 0) + 1;
    const t = this.thread(url) ?? this.upsertThread(url, {});
    t.sent = [...(t.sent ?? []), { at: now.toISOString(), day, text }];
    return this.upsertThread(url, { sent: t.sent, lastRepliedAt: now.toISOString() });
  }

  repliesToday(now = new Date()) {
    return this.state.replies[Store.today(now)] ?? 0;
  }

  threadRepliesToday(url, now = new Date()) {
    const day = Store.today(now);
    return (this.thread(url)?.sent ?? []).filter((s) => s.day === day).length;
  }

  stats() {
    const counts = {};
    for (const j of Object.values(this.state.jobs)) counts[j.status] = (counts[j.status] ?? 0) + 1;
    const threads = {};
    for (const t of Object.values(this.state.threads)) threads[t.status] = (threads[t.status] ?? 0) + 1;
    return { total: Object.keys(this.state.jobs).length, byStatus: counts, appliedToday: this.appliedToday(), daily: this.state.daily, threads, repliesToday: this.repliesToday() };
  }
}
