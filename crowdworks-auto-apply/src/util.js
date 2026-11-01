export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

/** [minSec, maxSec] のランダム待機 */
export async function randomDelay([minSec, maxSec], log) {
  const sec = randInt(minSec, maxSec);
  log?.(`  ...${sec}秒待機`);
  await sleep(sec * 1000);
}

/** JST の現在時刻（時） */
export function jstHour(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600 * 1000).getUTCHours();
}

export function inActiveHours([start, end], now = new Date()) {
  const h = jstHour(now);
  return start <= end ? h >= start && h < end : h >= start || h < end;
}

export function addDaysYmd(days, sep = "-", now = new Date()) {
  const d = new Date(now.getTime() + 9 * 3600 * 1000 + days * 86400 * 1000);
  return [d.getUTCFullYear(), String(d.getUTCMonth() + 1).padStart(2, "0"), String(d.getUTCDate()).padStart(2, "0")].join(sep);
}

/** 管理画面で見られるよう、直近のログをメモリに保持する */
export const recentLogs = [];
const MAX_LOGS = 1000;

export const log = (...args) => {
  const ts = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  const line = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
  recentLogs.push(`[${ts}] ${line}`);
  if (recentLogs.length > MAX_LOGS) recentLogs.splice(0, recentLogs.length - MAX_LOGS);
  console.log(`[${ts}]`, ...args);
};
