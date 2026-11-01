// TikTok に、YouTube ショートと同じ動画を「下書き（受信トレイ）」として送る（TikTok の Content Posting API は無料）。
// TikTok は、人が確認せずに自動で公開する使い方を認めていない（審査前の自動公開は非公開に固定される）ので、
// ここでは下書きまで全自動にし、TikTok アプリの通知から「投稿」を押すだけにする。投稿文は管理画面と記録に残す
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { DATA_DIR } from "./config.mjs";
import { readJson, writeJson, getSettings } from "./store.mjs";
import { loadSecret, saveSecret } from "./credentials.mjs";

const LOG = path.join(DATA_DIR, "tiktok-log.json");
const STATE = path.join(DATA_DIR, "tiktok-oauth-state.json");
const API = process.env.TIKTOK_API_BASE || "https://open.tiktokapis.com";
const AUTH = "https://www.tiktok.com/v2/auth/authorize/";

export const getTiktokLog = () => readJson(LOG, []);
export const hasTiktokClient = () => !!loadSecret("tiktok")?.clientKey;
export const hasTiktokToken = () => !!loadSecret("tiktok")?.refreshToken;
export const tiktokEnabled = () => getSettings().tiktokOnPublish && hasTiktokToken();
const redirectUri = () => `${(process.env.PUBLIC_URL || "").replace(/\/$/, "")}/oauth/tiktok/callback`;

export function setTiktokClient({ clientKey, clientSecret }) {
  clientKey = String(clientKey || "").trim();
  clientSecret = String(clientSecret || "").trim();
  if (!clientKey || !clientSecret) throw new Error("Client key と Client secret を入れてください");
  saveSecret("tiktok", { clientKey, clientSecret });
  return { redirectUri: redirectUri() };
}

// TikTok のログイン画面の URL（PKCE を使う）
export function authUrl() {
  const s = loadSecret("tiktok");
  if (!s?.clientKey) throw new Error("先に Client key と Client secret を保存してください");
  const state = crypto.randomBytes(16).toString("hex");
  const verifier = crypto.randomBytes(48).toString("base64url");
  // TikTok の PKCE は、code_challenge を SHA256 の16進数で求める
  const challenge = crypto.createHash("sha256").update(verifier).digest("hex");
  writeJson(STATE, { state, verifier, at: Date.now() });
  const u = new URL(AUTH);
  for (const [k, v] of Object.entries({
    client_key: s.clientKey, scope: "user.info.basic,video.upload", response_type: "code",
    redirect_uri: redirectUri(), state, code_challenge: challenge, code_challenge_method: "S256",
  })) u.searchParams.set(k, v);
  return u.toString();
}

async function token(params) {
  const res = await fetch(`${API}/v2/oauth/token/`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(`TikTok のログイン ${res.status}: ${json.error_description || json.error || ""}`);
  return json;
}

export async function finishAuth({ code, state }) {
  const saved = readJson(STATE, {});
  if (!state || state !== saved.state || Date.now() - saved.at > 15 * 60e3) throw new Error("ログインの確認に失敗しました。管理画面からやり直してください");
  fs.rmSync(STATE, { force: true });
  const s = loadSecret("tiktok");
  const t = await token({
    client_key: s.clientKey, client_secret: s.clientSecret, code, grant_type: "authorization_code",
    redirect_uri: redirectUri(), code_verifier: saved.verifier,
  });
  saveSecret("tiktok", { ...s, refreshToken: t.refresh_token, openId: t.open_id });
  return tiktokWhoAmI();
}

// アクセストークンは1日で切れるので、毎回リフレッシュトークンから取り直す（リフレッシュトークンも更新されたら保存）
async function accessToken() {
  const s = loadSecret("tiktok");
  if (!s?.refreshToken) throw new Error("TikTok と連携していません。管理画面の「SNS・LINE・ブログ」で連携してください");
  const t = await token({ client_key: s.clientKey, client_secret: s.clientSecret, grant_type: "refresh_token", refresh_token: s.refreshToken });
  if (t.refresh_token && t.refresh_token !== s.refreshToken) saveSecret("tiktok", { ...s, refreshToken: t.refresh_token });
  return t.access_token;
}

async function call(method, pathname, body, at) {
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: { authorization: `Bearer ${at || (await accessToken())}`, "content-type": "application/json; charset=UTF-8" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || (json.error && json.error.code && json.error.code !== "ok")) {
    throw new Error(`TikTok API ${res.status}: ${json.error?.message || json.error?.code || ""}`);
  }
  return json.data || {};
}

export async function tiktokWhoAmI() {
  const d = await call("GET", "/v2/user/info/?fields=open_id,display_name");
  return { name: d.user?.display_name || "" };
}

// 動画ファイルを下書きとして送る。caption は記録に残し、アプリで投稿するときに貼る
export async function sendDraft(file, { name, caption }) {
  const size = fs.statSync(file).size;
  const at = await accessToken();
  const init = await call("POST", "/v2/post/publish/inbox/video/init/", {
    source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: size, total_chunk_count: 1 },
  }, at);
  const res = await fetch(init.upload_url, {
    method: "PUT",
    headers: { "content-type": "video/mp4", "content-length": String(size), "content-range": `bytes 0-${size - 1}/${size}` },
    body: fs.readFileSync(file),
  });
  if (!res.ok) throw new Error(`TikTok への動画の送信 ${res.status}`);
  const log = getTiktokLog();
  log.push({ name, publishId: init.publish_id, caption, at: new Date().toISOString() });
  writeJson(LOG, log.slice(-500));
  return { publishId: init.publish_id, caption };
}
