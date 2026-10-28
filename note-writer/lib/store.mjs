// JSON ファイルの読み書き（published / sales / settings / topics）
import fs from "fs";
import path from "path";
import { paths } from "./config.mjs";

export const DEFAULT_SETTINGS = {
  // 毎日 20:00（日本時間）。dow は 0=日曜
  schedule: [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, time: "20:00" })),
  goalMonthly: 10000,
  // note の手数料率の概算（実際の率は note の規約で確認して設定）
  feeRate: 0.15,
  autoGenerate: true,
  // 読者層と、記事に占める割合。足りない読者層のテーマから先に書く（1つ目は、読者層の指定がないテーマの行き先）
  audiences: [
    { id: "abroad", name: "海外大学・留学・英語学習に関心のある大学生・社会人と、その保護者", share: 0.5 },
    { id: "kids", name: "子どもに英語を習わせている・英検を受けさせたい小学生の保護者と、英語教室の先生", share: 0.3 },
    { id: "automation", name: "AI や仕組みで仕事を自動化したい個人事業主・小さな会社・教室経営者", share: 0.2 },
  ],
  // true なら、自動チェックに通った記事を人の確認なしで公開予約する（通らなければ下書きで止まる）
  autoApprove: true,
  // 公開予約が何本を下回ったら次の記事を生成するか
  bufferSize: 3,
  dailyGenerateLimit: 2,
  minIntervalHours: 3,
  // note の ID（note.com/<ID>）。公開した記事の URL を作るときの予備
  noteUrlname: "",
  // 見出し画像を自動で作って載せる（ブラウザで描くので費用0円）
  headerImage: true,
  // 1日1回、note のダッシュボードから閲覧数・販売数を取り込む
  statsImport: true,
  // 話題枠：週に何本まで／日本時間の何時以降に探すか／何時に公開するか（通常枠の20時と3時間以上あける）
  trendEnabled: true,
  trendPerWeek: 1,
  trendScoutHour: 8,
  trendPublishHour: 12,
  // X：公開したら紹介する／1日1回、過去の記事をもう一度紹介する（日本時間の何時以降か）
  xOnPublish: true,
  xDailyPromo: true,
  xDailyHour: 12,
  // アプリ選びで、まだ試していないアプリを選ぶ割合（データ集め）
  exploreRate: 0.2,
  thumbnailFooter: "UCLA 在学生が書く 英語のはなし",
  // 公開するとき note のマガジン・メンバーシップに入れる（{ name, when: "paid" | "free" | "all" }。名前は note で作ったものと同じに）
  collections: [],
  // 記事の最後に、同じタグの過去の記事を「あわせて読みたい」として付ける
  relatedLinks: true,
  // Threads：公開したら紹介する／1日1回、過去の記事をもう一度紹介する（日本時間の何時以降か）
  threadsOnPublish: true,
  threadsDailyPromo: true,
  threadsDailyHour: 19,
  // LINE：友だち追加の URL（記事の最後に案内を付ける）と、週1回の「今週の記事」配信（曜日 0=日曜、日本時間の何時以降か）
  lineAddUrl: "",
  lineDigest: true,
  lineDigestDow: 0,
  lineDigestHour: 10,
  // ブログ：公開した note 記事を検索向けに書き直して、このサーバーの /blog に載せる
  blogEnabled: true,
  blogTitle: "UCLA 在学生が書く 英語のはなし",
  // アフィリエイト：{ name, url, fit }（fit は「どんな記事に合うか」）。合う記事にだけ AI が入れる
  affiliates: [],
  // ブログを会社のドメインで出すとき（例：blog.uspeaklab.org）。DNS と Cloud Run のドメイン設定が済んでから入れる
  blogDomain: "",
  // Google Search Console の「HTML タグ」の content の値
  googleVerification: "",
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
