#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { interactiveLogin } from "./crowdworks.js";
import { Evaluator } from "./llm.js";
import { applyDraft, runOnce } from "./runner.js";
import { ConversationAgent } from "./conversation.js";
import { runInbox } from "./inbox-runner.js";
import { STOP_FILE, acquireLock, halt, isStopped, stopReason, unhalt } from "./safety.js";
import { Store } from "./store.js";
import { inActiveHours, log, sleep } from "./util.js";

const HELP = `CrowdWorks 自動応募ボット

使い方: node src/cli.js <command> [options]

  login                 ブラウザを開いて手動ログインし、セッションを保存
  run                   1 回巡回（検索 → 審査 → 応募）
  inbox                 応募後のメッセージに 1 回対応（返信・契約承諾・エスカレーション）
  loop                  常駐: メッセージ対応(inboxIntervalMinutes) と 応募巡回(intervalMinutes)
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

    case "loop": {
      const release = acquireLock();
      const evaluator = new Evaluator(config.ai, config.profile);
      const agent = new ConversationAgent(config.ai, config.profile, config.negotiation);
      const { intervalMinutes, inboxIntervalMinutes, activeHours } = config.schedule;
      log(`常駐開始 (mode=${config.mode}, dryRun=${dryRun}, 応募 ${intervalMinutes}分 / メッセージ ${inboxIntervalMinutes}分間隔, 稼働 ${activeHours.join("〜")}時 JST)`);
      let stop = false;
      const onSig = () => { stop = true; log("停止要求を受け付けました"); };
      process.on("SIGINT", onSig);
      process.on("SIGTERM", onSig);
      const jitter = (min) => min * 60_000 * (0.8 + Math.random() * 0.4);
      let nextApply = 0;
      let nextInbox = 0;
      try {
        while (!stop) {
          const now = Date.now();
          if (isStopped()) {
            log(`停止中: ${stopReason()}（npm run unhalt で再開）`);
          } else if (!inActiveHours(activeHours)) {
            // 深夜の送信は不自然なので、稼働時間外はメッセージ対応も応募もしない
          } else {
            try {
              if (config.inbox.enabled && now >= nextInbox) {
                await runInbox(config, { store, agent, dryRun });
                nextInbox = Date.now() + jitter(inboxIntervalMinutes);
              }
              if (now >= nextApply && !isStopped()) {
                await runOnce(config, { store, evaluator, dryRun });
                nextApply = Date.now() + jitter(intervalMinutes);
              }
            } catch (e) {
              log(`エラー: ${e.stack ?? e.message}`);
              nextInbox = Math.max(nextInbox, Date.now() + 5 * 60_000);
              nextApply = Math.max(nextApply, Date.now() + 5 * 60_000);
            }
          }
          for (let t = 0; t < 60_000 && !stop; t += 5000) await sleep(5000);
        }
      } finally { release(); }
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
