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
  fs.rmSync(sessionFile(account), { force: true });
}

// ブラウザの開発者ツールで写した Cookie ヘッダー（"a=1; b=2; ..."）から、ログイン済みの状態を作る。
// サーバーからパスワードでログインすると note に止められることがあるため、こちらが基本
export function setSessionCookies(account, cookieHeader) {
  if (!/^[a-z0-9_-]+$/.test(account)) throw new Error(`不正なアカウント名: ${account}`);
  const cookies = String(cookieHeader).replace(/^cookie:\s*/i, "").split(";")
    .map((pair) => pair.trim())
    .filter((pair) => pair.includes("="))
    .map((pair) => {
      const i = pair.indexOf("=");
      return {
        name: pair.slice(0, i).trim(),
        value: pair.slice(i + 1).trim(),
        domain: ".note.com",
        path: "/",
        expires: -1,
        httpOnly: false,
        secure: true,
        sameSite: "Lax",
      };
    });
  if (cookies.length < 2) throw new Error("Cookie が読み取れません。説明どおり cookie の値をまるごと貼ってください");
  saveSession(account, { cookies, origins: [] });
  return cookies.length;
}

// そのほかの秘密情報（X の API キーなど）も、同じ鍵で暗号化して保存する
const SECRETS = path.join(DATA_DIR, "secrets.enc.json");
export function saveSecret(name, value) {
  const all = readJson(SECRETS, {});
  all[name] = encrypt(JSON.stringify(value));
  writeJson(SECRETS, all);
}
export function loadSecret(name) {
  const blob = readJson(SECRETS, {})[name];
  return blob ? JSON.parse(decrypt(blob)) : null;
}

// ログイン状態（Playwright の storageState）はパスワードと同じ扱いで、暗号化して保存する
const sessionFile = (account) => path.join(paths.auth, `${account}.enc`);

export function saveSession(account, state) {
  fs.mkdirSync(paths.auth, { recursive: true });
  fs.writeFileSync(sessionFile(account), encrypt(JSON.stringify(state)));
}

export function loadSession(account) {
  if (!fs.existsSync(sessionFile(account))) return null;
  return JSON.parse(decrypt(fs.readFileSync(sessionFile(account), "utf8")));
}

export function hasSession(account) {
  return fs.existsSync(sessionFile(account));
}

export function listCredentials() {
  const saved = readJson(FILE, {});
  const names = new Set([...Object.keys(saved), ...(fs.existsSync(paths.auth)
    ? fs.readdirSync(paths.auth).filter((f) => f.endsWith(".enc")).map((f) => f.slice(0, -4)) : [])]);
  return [...names].map((account) => ({
    account,
    email: saved[account]?.email || "",
    hasPassword: !!saved[account],
    hasSession: hasSession(account),
  }));
}
