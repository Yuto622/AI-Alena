/**
 * 全自動運用のための安全機構。
 * - キルスイッチ: data/STOP ファイル（または CW_STOP=1）があると一切の送信をしない
 * - 多重起動防止ロック: 同時に 2 プロセスが動いて二重送信するのを防ぐ
 * - 監査ログ: すべての外部送信（応募・返信・契約）を data/audit.jsonl に追記
 * - サーキットブレーカー: 連続失敗が続いたら自動停止し、人が解除するまで再開しない
 */
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config.js";
import { notify } from "./notify.js";

export const STOP_FILE = path.join(DATA_DIR, "STOP");
const LOCK_FILE = path.join(DATA_DIR, "run.lock");
const AUDIT_FILE = path.join(DATA_DIR, "audit.jsonl");

export class HaltedError extends Error {}

export function isStopped() {
  return process.env.CW_STOP === "1" || fs.existsSync(STOP_FILE);
}

export function stopReason() {
  if (process.env.CW_STOP === "1") return "環境変数 CW_STOP=1";
  return fs.existsSync(STOP_FILE) ? fs.readFileSync(STOP_FILE, "utf8").trim() || "STOP ファイル" : null;
}

export async function halt(reason) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STOP_FILE, `${new Date().toISOString()} ${reason}\n`);
  await notify(`🛑 CrowdWorks ボットを自動停止しました: ${reason}\n確認後 \`npm run unhalt\` で再開してください。`);
}

export function unhalt() {
  if (fs.existsSync(STOP_FILE)) fs.unlinkSync(STOP_FILE);
}

/** 外部へ送信する直前に必ず呼ぶ */
export function assertCanAct() {
  if (isStopped()) throw new HaltedError(`停止中: ${stopReason()}`);
}

/** 多重起動防止。古い（プロセスが死んだ）ロックは奪う */
export function acquireLock(staleMs = 2 * 3600 * 1000) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(LOCK_FILE)) {
    const { pid, at } = JSON.parse(fs.readFileSync(LOCK_FILE, "utf8") || "{}");
    let alive = false;
    try { process.kill(pid, 0); alive = true; } catch { /* dead */ }
    if (alive && pid !== process.pid && Date.now() - Date.parse(at) < staleMs) {
      throw new Error(`別のプロセス (pid ${pid}) が実行中です`);
    }
  }
  fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
  return () => { try { if (JSON.parse(fs.readFileSync(LOCK_FILE, "utf8")).pid === process.pid) fs.unlinkSync(LOCK_FILE); } catch { /* ignore */ } };
}

export function audit(event, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.appendFileSync(AUDIT_FILE, JSON.stringify({ at: new Date().toISOString(), event, ...data }) + "\n");
}

/** 連続失敗を数え、閾値に達したら halt する */
export class CircuitBreaker {
  constructor(threshold = 3) {
    this.threshold = threshold;
    this.failures = 0;
  }
  success() { this.failures = 0; }
  async failure(reason) {
    this.failures++;
    if (this.failures >= this.threshold) {
      await halt(`送信系の失敗が ${this.failures} 回連続: ${reason}（画面構成の変更・アカウント制限の可能性）`);
      throw new HaltedError("サーキットブレーカー作動");
    }
  }
}
