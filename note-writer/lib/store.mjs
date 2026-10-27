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
  autoGenerate: true,
  // true なら、自動チェックに通った記事を人の確認なしで公開予約する（通らなければ下書きで止まる）
  autoApprove: true,
  // 公開予約が何本を下回ったら次の記事を生成するか
  bufferSize: 3,
  dailyGenerateLimit: 2,
  minIntervalHours: 3,
  // 見出し画像を自動で作って載せる（ブラウザで描くので費用0円）
  headerImage: true,
  // 1日1回、note のダッシュボードから閲覧数・販売数を取り込む
  statsImport: true,
  // X：公開したら紹介する／1日1回、過去の記事をもう一度紹介する（日本時間の何時以降か）
  xOnPublish: true,
  xDailyPromo: true,
  xDailyHour: 12,
  // アプリ選びで、まだ試していないアプリを選ぶ割合（データ集め）
  exploreRate: 0.2,
  thumbnailFooter: "UCLA 在学生が書く 英語と海外大学のはなし",
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
// 空欄で渡された項目は、前の値を残す（販売数だけ・閲覧数だけを直せるように）
export function upsertSales({ file, month, sales, views }) {
  const all = getSales();
  const prev = all.find((r) => r.file === file && r.month === month) || {};
  const pick = (v, old) => (v === undefined || v === null || v === "" ? old ?? 0 : Number(v) || 0);
  const rows = all.filter((r) => !(r.file === file && r.month === month));
  rows.push({ file, month, sales: pick(sales, prev.sales), views: pick(views, prev.views) });
  writeJson(paths.sales, rows);
}

export const getTopics = () => readJson(paths.topics, []);
export const saveTopics = (topics) => writeJson(paths.topics, topics);
