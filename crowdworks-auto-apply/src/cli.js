#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { interactiveLogin } from "./crowdworks.js";
import { Evaluator } from "./llm.js";
import { applyDraft, runOnce } from "./runner.js";
import { Store } from "./store.js";
import { inActiveHours, log, sleep } from "./util.js";

const HELP = `CrowdWorks 自動応募ボット

使い方: node src/cli.js <command> [options]

  login                 ブラウザを開いて手動ログインし、セッションを保存
  run                   1 回巡回（検索 → 審査 → 応募）
  loop                  schedule.intervalMinutes ごとに巡回し続ける（activeHours 外は休止）
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

    case "run": {
      const evaluator = new Evaluator(config.ai, config.profile);
      log(`巡回開始 (mode=${config.mode}, dryRun=${dryRun})`);
      const s = await runOnce(config, { store, evaluator, dryRun });
      process.exitCode = s.aborted ? 2 : 0;
      return;
    }

    case "loop": {
      const evaluator = new Evaluator(config.ai, config.profile);
      log(`常駐開始 (mode=${config.mode}, dryRun=${dryRun}, ${config.schedule.intervalMinutes}分間隔, 稼働 ${config.schedule.activeHours.join("〜")}時 JST)`);
      let stop = false;
      process.on("SIGINT", () => { stop = true; log("停止要求を受け付けました"); });
      process.on("SIGTERM", () => { stop = true; });
      while (!stop) {
        if (inActiveHours(config.schedule.activeHours)) {
          try {
            const s = await runOnce(config, { store, evaluator, dryRun });
            if (s.aborted) log("ログイン/CAPTCHA の問題で中断。次回まで待機します");
          } catch (e) {
            log(`巡回エラー: ${e.stack ?? e.message}`);
          }
        } else {
          log("稼働時間外のため待機");
        }
        // 毎回少しずらして機械的な間隔にならないようにする
        const jitter = 0.8 + Math.random() * 0.4;
        const waitMs = config.schedule.intervalMinutes * 60_000 * jitter;
        for (let t = 0; t < waitMs && !stop; t += 5000) await sleep(5000);
      }
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
