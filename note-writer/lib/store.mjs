// JSON ファイルの読み書き（published / sales / settings / topics）
import fs from "fs";
import path from "path";
import { paths } from "./config.mjs";

export const DEFAULT_SETTINGS = {
  // 月・水・金 20:00（日本時間）。dow は 0=日曜
  schedule: [
    { dow: 1, time: "20:00" },
    { dow: 3, time: "20:00" },
    { dow: 5, time: "20:00" },
  ],
  goalMonthly: 10000,
  // note の手数料率の概算（実際の率は note の規約で確認して設定）
  feeRate: 0.15,
  autoGenerate: false,
  // true にすると生成した記事を確認なしで公開予約する
  autoApprove: false,
  // 公開予約が何本を下回ったら次の記事を生成するか
  bufferSize: 3,
  minIntervalHours: 3,
};

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

export const getSettings = () => ({ ...DEFAULT_SETTINGS, ...readJson(paths.settings, {}) });
export const saveSettings = (patch) => writeJson(paths.settings, { ...getSettings(), ...patch });

export const getPublished = () => readJson(paths.published, []);
export function addPublished(entry) {
  const log = getPublished();
  log.push({ ...entry, at: new Date().toISOString() });
  writeJson(paths.published, log);
}

// 売上は note の管理画面の数字を月ごとに入力する（note に売上を取る API はない）
export const getSales = () => readJson(paths.sales, []);
export function upsertSales({ file, month, sales, views }) {
  const rows = getSales().filter((r) => !(r.file === file && r.month === month));
  rows.push({ file, month, sales: Number(sales) || 0, views: Number(views) || 0 });
  writeJson(paths.sales, rows);
}

export const getTopics = () => readJson(paths.topics, []);
export const saveTopics = (topics) => writeJson(paths.topics, topics);
