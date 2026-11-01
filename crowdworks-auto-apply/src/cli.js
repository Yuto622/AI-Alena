#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { ensureLoggedIn, interactiveLogin, launch } from "./crowdworks.js";
import { Scheduler } from "./scheduler.js";
import { createAdminServer } from "./admin/server.js";
import { Evaluator } from "./llm.js";
import { applyDraft, runOnce } from "./runner.js";
import { ConversationAgent } from "./conversation.js";
import { runInbox } from "./inbox-runner.js";
import { STOP_FILE, acquireLock, halt, unhalt } from "./safety.js";
import { Store } from "./store.js";
import { log } from "./util.js";

const HELP = `CrowdWorks 自動応募ボット

使い方: node src/cli.js <command> [options]

  login                 ブラウザを開いて手動ログインし、セッションを保存
  run                   1 回巡回（検索 → 審査 → 応募）
  inbox                 応募後のメッセージに 1 回対応（返信・契約承諾・エスカレーション）
  loop                  常駐: メッセージ対応(inboxIntervalMinutes) と 応募巡回(intervalMinutes)
  serve                 常駐 + 管理画面（PORT, ADMIN_PASSWORD 必須）
  resume <threadURL>    本人対応が済んだスレッドを自動対応に戻す
  stop [理由]           緊急停止（全送信を止める。loop 中のプロセスにも即時反映）
  unhalt                停止を解除
  apply <jobId...>      draft モードの下書きを承認して応募
  stats                 処理件数・本日の応募数を表示

options:
  --config <path>       設定ファイル（既定: ./config.json）
  --dry-run             フォーム入力まで行い、送信しない
  --live                config の dryRun=true を無視して実際に送信
  --mode <auto|draft>   config.mode を上書き
`;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--live") args.live = true;
    else if (a === "--config") args.config = argv[++i];
    else if (a === "--mode") args.mode = argv[++i];
    else if (a === "-h" || a === "--help") args.help = true;
    else args._.push(a);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [cmd, ...rest] = args._;
  if (args.help || !cmd) return console.log(HELP);

  const config = loadConfig(args.config);
  if (args.mode) config.mode = args.mode;
  const dryRun = args.live ? false : args.dryRun ? true : config.dryRun;
  const store = new Store();

  switch (cmd) {
    case "login":
      return interactiveLogin(config.browser);

    case "stop":
      await halt(rest.join(" ") || "手動停止");
      return console.log(`停止しました (${STOP_FILE})`);

    case "unhalt":
      unhalt();
      return console.log("停止を解除しました");

    case "resume": {
      if (!rest.length) throw new Error("スレッド URL を指定してください");
      for (const url of rest) {
        if (!store.thread(url)) throw new Error(`未登録のスレッド: ${url}`);
        store.upsertThread(url, { status: "active", lastHash: null, escalation: null });
        console.log(`自動対応に戻しました: ${url}`);
      }
      return;
    }

    case "inbox": {
      const release = acquireLock();
      try {
        const agent = new ConversationAgent(config.ai, config.profile, config.negotiation);
        await runInbox(config, { store, agent, dryRun });
      } finally { release(); }
      return;
    }

    case "run": {
      const evaluator = new Evaluator(config.ai, config.profile);
      log(`巡回開始 (mode=${config.mode}, dryRun=${dryRun})`);
      const release = acquireLock();
      try {
        const s = await runOnce(config, { store, evaluator, dryRun });
        process.exitCode = s.aborted ? 2 : 0;
      } finally { release(); }
      return;
    }

    case "loop":
    case "serve": {
      const release = acquireLock();
      const scheduler = new Scheduler({ store, configPath: args.config, dryRunOverride: args.live ? false : args.dryRun ? true : undefined });
      log(`常駐開始 (mode=${config.mode}, dryRun=${dryRun}, 応募 ${config.schedule.intervalMinutes}分 / メッセージ ${config.schedule.inboxIntervalMinutes}分間隔, 稼働 ${config.schedule.activeHours.join("〜")}時 JST)`);
      let server = null;
      if (cmd === "serve") {
        const port = Number(process.env.PORT ?? 8080);
        const host = process.env.ADMIN_HOST ?? "127.0.0.1";
        server = createAdminServer({
          store, scheduler, configPath: args.config,
          password: process.env.ADMIN_PASSWORD,
          trustProxy: process.env.TRUST_PROXY === "1",
          secureCookie: process.env.COOKIE_SECURE === "1",
          checkLogin: async () => {
            const { browser, page } = await launch(loadConfig(args.config).browser);
            try { await ensureLoggedIn(page, loadConfig(args.config).selectors); return true; }
            catch { return false; }
            finally { await browser.close().catch(() => {}); }
          },
        });
        server.listen(port, host, () => log(`管理画面: http://${host}:${port}`));
      }
      const shutdown = () => { log("停止要求を受け付けました"); scheduler.stop(); server?.close(); };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
      try { await scheduler.loop(); } finally { release(); }
      return;
    }

    case "apply": {
      if (!rest.length) throw new Error("jobId を指定してください");
      for (const id of rest) await applyDraft(config, id, { store, dryRun: args.dryRun ?? false });
      return;
    }

    case "stats":
      return console.log(JSON.stringify(store.stats(), null, 2));

    default:
      console.log(HELP);
      process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e.stack ?? e.message);
  process.exit(1);
});
