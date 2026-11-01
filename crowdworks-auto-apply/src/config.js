import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = process.env.CW_DATA_DIR || path.join(ROOT, "data");
export const STORAGE_STATE_PATH = path.join(DATA_DIR, "storage-state.json");

/** .env を（dotenv なしで）読み込む。既に設定済みの環境変数は上書きしない。 */
export function loadDotEnv(file = path.join(ROOT, ".env")) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    const value = m[2].replace(/^["']|["']$/g, "");
    if (process.env[m[1]] === undefined && value !== "") process.env[m[1]] = value;
  }
}

function deepMerge(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) return override ?? base;
  if (typeof base !== "object" || base === null) return override ?? base;
  const out = { ...base };
  for (const [k, v] of Object.entries(override ?? {})) {
    out[k] = typeof v === "object" && v !== null && !Array.isArray(v) ? deepMerge(base[k] ?? {}, v) : v;
  }
  return out;
}

/**
 * 設定ファイルの場所: --config > CW_CONFIG > data/config.json（管理画面で編集） > ./config.json
 */
export function configPathFor(configPath) {
  if (configPath) return configPath;
  if (process.env.CW_CONFIG) return process.env.CW_CONFIG;
  const inData = path.join(DATA_DIR, "config.json");
  if (fs.existsSync(inData)) return inData;
  return path.join(ROOT, "config.json");
}

/** 管理画面から保存する先（書き込み可能な場所） */
export function writableConfigPath(configPath) {
  return configPath || process.env.CW_CONFIG || path.join(DATA_DIR, "config.json");
}

let warned = false;
export function loadConfig(configPath) {
  loadDotEnv();
  const defaults = JSON.parse(fs.readFileSync(path.join(ROOT, "config.example.json"), "utf8"));
  const file = configPathFor(configPath);
  let user = {};
  if (fs.existsSync(file)) {
    user = JSON.parse(fs.readFileSync(file, "utf8"));
  } else if (!warned) {
    warned = true;
    console.warn(`[config] ${file} が見つかりません。config.example.json の既定値で動作します。`);
  }
  const config = deepMerge(defaults, user);
  validateConfig(config);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  return config;
}

/** 検証してから原子的に保存（不正な設定は保存しない） */
export function saveConfig(config, configPath) {
  // 省略されたキーは既定値で補って検証する（実行時の読み込みと同じ）
  const defaults = JSON.parse(fs.readFileSync(path.join(ROOT, "config.example.json"), "utf8"));
  validateConfig(deepMerge(defaults, config));
  const file = writableConfigPath(configPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n");
  fs.renameSync(tmp, file);
  return file;
}

export function validateConfig(c) {
  const errors = [];
  if (!["auto", "draft"].includes(c.mode)) errors.push(`mode は "auto" か "draft": ${c.mode}`);
  if (!c.profile?.summary) errors.push("profile.summary が空です（提案文の材料になります）");
  if (!c.search?.keywords?.length && !c.search?.searchUrls?.length)
    errors.push("search.keywords か search.searchUrls のどちらかを指定してください");
  const [lo, hi] = c.limits?.delayBetweenApplicationsSec ?? [];
  if (!(lo >= 30 && hi >= lo)) errors.push("limits.delayBetweenApplicationsSec は [最小>=30, 最大>=最小] にしてください");
  if (!(c.limits?.maxApplicationsPerDay > 0 && c.limits.maxApplicationsPerDay <= 50))
    errors.push("limits.maxApplicationsPerDay は 1〜50 の範囲にしてください");
  const n = c.negotiation ?? {};
  if (n.autoAcceptContract && !(n.maxContractYen > 0)) errors.push("negotiation.autoAcceptContract を使うには maxContractYen（自動承諾の上限額）が必須です");
  if (!(n.minAcceptRatio > 0 && n.minAcceptRatio <= 1)) errors.push("negotiation.minAcceptRatio は 0〜1");
  if (!(n.maxRepliesPerDay > 0 && n.maxRepliesPerDay <= 100)) errors.push("negotiation.maxRepliesPerDay は 1〜100");
  if (!(n.minMinutesBetweenReplies >= 1)) errors.push("negotiation.minMinutesBetweenReplies は 1 以上");
  if (!(c.safety?.circuitBreakerThreshold >= 1)) errors.push("safety.circuitBreakerThreshold は 1 以上");
  if (!(c.schedule?.inboxIntervalMinutes >= 5)) errors.push("schedule.inboxIntervalMinutes は 5 以上");
  if (errors.length) throw new Error("設定エラー:\n - " + errors.join("\n - "));
}
