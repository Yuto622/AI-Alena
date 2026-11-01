/**
 * 常駐スケジューラ。CLI の loop と管理画面サーバーの両方から使う。
 * - 毎ティック設定ファイルを読み直す（管理画面での設定変更が即反映される）
 * - 同時に 1 つのジョブしか走らせない（二重送信防止）
 */
import { loadConfig } from "./config.js";
import { Evaluator } from "./llm.js";
import { ConversationAgent } from "./conversation.js";
import { runOnce } from "./runner.js";
import { runInbox } from "./inbox-runner.js";
import { isStopped, stopReason } from "./safety.js";
import { inActiveHours, log, sleep } from "./util.js";

export class Scheduler {
  constructor({ store, configPath, dryRunOverride, deps = {} }) {
    this.store = store;
    this.configPath = configPath;
    this.dryRunOverride = dryRunOverride; // CLI の --live / --dry-run
    this.deps = { runOnce, runInbox, Evaluator, ConversationAgent, ...deps };
    this.busy = null; // 実行中のジョブ名
    this.nextApply = 0;
    this.nextInbox = 0;
    this.lastResults = {}; // { apply: {at, summary|error}, inbox: {...} }
    this.stopped = false;
    this.configError = null;
  }

  config() {
    try {
      const c = loadConfig(this.configPath);
      this.configError = null;
      return c;
    } catch (e) {
      this.configError = e.message;
      throw e;
    }
  }

  dryRun(config) {
    return this.dryRunOverride ?? config.dryRun;
  }

  /** ジョブを 1 つ実行（実行中なら何もしない） */
  async run(kind, { manual = false } = {}) {
    if (this.busy) return { ok: false, message: `「${this.busy}」を実行中です` };
    if (isStopped()) return { ok: false, message: `停止中です: ${stopReason()}` };
    let config;
    try { config = this.config(); } catch (e) { return { ok: false, message: e.message }; }
    this.busy = kind === "apply" ? "応募巡回" : "メッセージ対応";
    const dryRun = this.dryRun(config);
    try {
      let summary;
      if (kind === "apply") {
        const evaluator = new this.deps.Evaluator(config.ai, config.profile);
        summary = await this.deps.runOnce(config, { store: this.store, evaluator, dryRun });
      } else {
        const agent = new this.deps.ConversationAgent(config.ai, config.profile, config.negotiation);
        summary = await this.deps.runInbox(config, { store: this.store, agent, dryRun });
      }
      this.lastResults[kind] = { at: new Date().toISOString(), manual, summary };
      return { ok: true, summary };
    } catch (e) {
      log(`${this.busy} エラー: ${e.stack ?? e.message}`);
      this.lastResults[kind] = { at: new Date().toISOString(), manual, error: e.message };
      return { ok: false, message: e.message };
    } finally {
      this.busy = null;
    }
  }

  /** ボットの実行と重ならないように任意の処理を走らせる（ログイン確認など） */
  async exclusive(name, fn) {
    if (this.busy) return { ok: false, message: `「${this.busy}」を実行中です` };
    this.busy = name;
    try {
      return { ok: true, value: await fn() };
    } catch (e) {
      return { ok: false, message: e.message };
    } finally {
      this.busy = null;
    }
  }

  /** 定期実行ループ（stop() で終了） */
  async loop() {
    const jitter = (min) => min * 60_000 * (0.8 + Math.random() * 0.4);
    log("スケジューラ開始");
    while (!this.stopped) {
      try {
        const config = this.config();
        const { intervalMinutes, inboxIntervalMinutes, activeHours } = config.schedule;
        const now = Date.now();
        if (!isStopped() && inActiveHours(activeHours) && !this.busy) {
          if (config.inbox.enabled && now >= this.nextInbox) {
            const r = await this.run("inbox");
            this.nextInbox = Date.now() + (r.ok ? jitter(inboxIntervalMinutes) : 5 * 60_000);
          }
          if (Date.now() >= this.nextApply && !isStopped()) {
            const r = await this.run("apply");
            this.nextApply = Date.now() + (r.ok ? jitter(intervalMinutes) : 5 * 60_000);
          }
        }
      } catch (e) {
        log(`スケジューラ: ${e.message}`);
      }
      for (let t = 0; t < 30_000 && !this.stopped; t += 1000) await sleep(1000);
    }
    log("スケジューラ停止");
  }

  stop() {
    this.stopped = true;
  }

  status() {
    let config = null;
    try { config = this.config(); } catch { /* configError に入る */ }
    return {
      busy: this.busy,
      stopped: isStopped(),
      stopReason: stopReason(),
      dryRun: config ? this.dryRun(config) : null,
      mode: config?.mode ?? null,
      activeHours: config?.schedule.activeHours ?? null,
      inActiveHours: config ? inActiveHours(config.schedule.activeHours) : null,
      nextApply: this.nextApply ? new Date(this.nextApply).toISOString() : null,
      nextInbox: this.nextInbox ? new Date(this.nextInbox).toISOString() : null,
      lastResults: this.lastResults,
      configError: this.configError,
    };
  }
}
