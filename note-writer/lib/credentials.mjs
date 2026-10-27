// note のログイン情報。管理画面から入れ、データ置き場に暗号化して保存する
// 鍵は Secret Manager の CRON_TOKEN（データ置き場とは別の場所）から作る
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { paths, DATA_DIR } from "./config.mjs";
import { readJson, writeJson } from "./store.mjs";

const FILE = path.join(DATA_DIR, "credentials.enc.json");

function key() {
  const secret = process.env.CREDENTIALS_KEY || process.env.CRON_TOKEN;
  if (!secret) throw new Error("暗号化の鍵（CRON_TOKEN）が設定されていません");
  return crypto.createHash("sha256").update(`note-credentials:${secret}`).digest();
}

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

function decrypt(blob) {
  const [iv, tag, data] = blob.split(".").map((s) => Buffer.from(s, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

const envPrefix = (account) => (account === "default" ? "NOTE" : `NOTE_${account.toUpperCase()}`);

// 管理画面で入れたものを優先し、なければ環境変数（ローカル実行用）
export function getCredentials(account) {
  const saved = readJson(FILE, {})[account];
  if (saved) return { email: saved.email, password: decrypt(saved.password) };
  const prefix = envPrefix(account);
  return { email: process.env[`${prefix}_EMAIL`], password: process.env[`${prefix}_PASSWORD`] };
}

// パスワードは空なら変えない（管理画面にはパスワードを表示しないため）
export function setCredentials(account, { email, password }) {
  if (!/^[a-z0-9_-]+$/.test(account)) throw new Error(`不正なアカウント名: ${account}`);
  const all = readJson(FILE, {});
  const prev = all[account];
  if (!password && !prev) throw new Error("パスワードを入力してください");
  all[account] = { email, password: password ? encrypt(password) : prev.password };
  writeJson(FILE, all);
  // 別のアカウントのログイン状態が残っていると、そちらで投稿してしまうので消す
  fs.rmSync(path.join(paths.auth, `${account}.json`), { force: true });
}

export function listCredentials() {
  return Object.entries(readJson(FILE, {})).map(([account, v]) => ({ account, email: v.email, hasPassword: true }));
}
