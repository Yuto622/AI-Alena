// YouTube ショートに、記事の要点を1分弱の縦長動画にして自動で投稿する（YouTube Data API は無料・1日10,000ユニット、1本1,600）。
// 1. AI がスライド（表紙・要点3つ・締め）と読み上げ原稿を作る
// 2. スライドを 1080×1920 で描き、ナレーションを付けて MP4 にする（video.mjs）
// 3. 管理画面で一度だけ Google にログインして受け取ったリフレッシュトークンで、アップロードする
// 注意：審査（YouTube API の監査）を通っていない Google Cloud プロジェクトからアップロードした動画は、
//       YouTube 側で「非公開」に固定される。監査を通ると公開できる
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { DATA_DIR } from "./config.mjs";
import { readJson, writeJson, getSettings } from "./store.mjs";
import { loadSecret, saveSecret } from "./credentials.mjs";
import { snsDestination } from "./destinations.mjs";
import { renderSlides, ENDINGS } from "./instagram.mjs";
import { makeVideo } from "./video.mjs";

const LOG = path.join(DATA_DIR, "youtube-log.json");
const YT_DIR = path.join(DATA_DIR, "yt");
const STATE = path.join(DATA_DIR, "youtube-oauth-state.json");
const OAUTH = process.env.GOOGLE_OAUTH_BASE || "https://oauth2.googleapis.com";
const YT = process.env.YOUTUBE_API_BASE || "https://www.googleapis.com";
const SCOPES = "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly";

export const getYoutubeLog = () => readJson(LOG, []);
export const hasYoutubeClient = () => !!loadSecret("youtube")?.clientId;
export const hasYoutubeToken = () => !!loadSecret("youtube")?.refreshToken;
export const youtubeEnabled = () => getSettings().youtubeOnPublish && hasYoutubeToken();
const redirectUri = () => `${(process.env.PUBLIC_URL || "").replace(/\/$/, "")}/oauth/youtube/callback`;

export function setYoutubeClient({ clientId, clientSecret }) {
  clientId = String(clientId || "").trim();
  clientSecret = String(clientSecret || "").trim();
  if (!/\.apps\.googleusercontent\.com$/.test(clientId) || !clientSecret) throw new Error("クライアント ID（…apps.googleusercontent.com）とクライアント シークレットを入れてください");
  // クライアントを変えたら、ログインはやり直し
  saveSecret("youtube", { clientId, clientSecret });
  return { redirectUri: redirectUri() };
}

// Google のログイン画面の URL（管理画面の「YouTube と連携」ボタンから開く）
export function authUrl() {
  const s = loadSecret("youtube");
  if (!s?.clientId) throw new Error("先にクライアント ID とシークレットを保存してください");
  const state = crypto.randomBytes(16).toString("hex");
  writeJson(STATE, { state, at: Date.now() });
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  for (const [k, v] of Object.entries({
    client_id: s.clientId, redirect_uri: redirectUri(), response_type: "code", scope: SCOPES,
    access_type: "offline", prompt: "consent", state,
  })) u.searchParams.set(k, v);
  return u.toString();
}

async function token(params) {
  const res = await fetch(`${OAUTH}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google のログイン ${res.status}: ${json.error_description || json.error || ""}`);
  return json;
}

// Google から戻ってきたときに、コードをリフレッシュトークンに換える
export async function finishAuth({ code, state }) {
  const saved = readJson(STATE, {});
  if (!state || state !== saved.state || Date.now() - saved.at > 15 * 60e3) throw new Error("ログインの確認に失敗しました。管理画面からやり直してください");
  fs.rmSync(STATE, { force: true });
  const s = loadSecret("youtube");
  const t = await token({ code, client_id: s.clientId, client_secret: s.clientSecret, redirect_uri: redirectUri(), grant_type: "authorization_code" });
  if (!t.refresh_token) throw new Error("リフレッシュトークンが届きませんでした。Google アカウントの「サードパーティのアクセス」からこのアプリを削除して、やり直してください");
  saveSecret("youtube", { ...s, refreshToken: t.refresh_token });
  return youtubeWhoAmI();
}

async function accessToken() {
  const s = loadSecret("youtube");
  if (!s?.refreshToken) throw new Error("YouTube と連携していません。管理画面の「SNS・LINE・ブログ」で連携してください");
  return (await token({ client_id: s.clientId, client_secret: s.clientSecret, refresh_token: s.refreshToken, grant_type: "refresh_token" })).access_token;
}

export async function youtubeWhoAmI() {
  const res = await fetch(`${YT}/youtube/v3/channels?part=snippet&mine=true`, {
    headers: { authorization: `Bearer ${await accessToken()}` },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`YouTube API ${res.status}: ${json.error?.message || ""}`);
  const ch = json.items?.[0];
  if (!ch) throw new Error("このアカウントには YouTube チャンネルがありません。YouTube でチャンネルを作ってから連携してください");
  return { channel: ch.snippet.title, id: ch.id };
}

// ---- 動画の中身（AI が記事から作る） ----

const SCHEMA = {
  type: "object",
  properties: {
    cover: { type: "string", description: "1枚目に大きく出す見出し。全角24文字以内" },
    points: {
      type: "array",
      items: {
        type: "object",
        properties: {
          heading: { type: "string", description: "全角16文字以内" },
          lines: { type: "array", items: { type: "string" }, description: "1行全角22文字以内を2〜3行" },
        },
        required: ["heading", "lines"],
        additionalProperties: false,
      },
    },
    narration: { type: "array", items: { type: "string" }, description: "スライド1〜4枚目の読み上げ文。各40〜80文字" },
    title: { type: "string", description: "動画のタイトル。全角40文字以内" },
    description: { type: "string", description: "動画の説明文。全角200文字以内。URL は書かない" },
    hashtags: { type: "array", items: { type: "string" }, description: "# を付けない言葉を3個" },
  },
  required: ["cover", "points", "narration", "title", "description", "hashtags"],
  additionalProperties: false,
};

const OUTRO = {
  service: "AI や自動化の相談は、概要欄のリンクから。",
  business: "英語教室の方は、概要欄のリンクから説明会へ。",
  line: "新しい記事は、概要欄のリンクから LINE で受け取れます。",
  note: "続きは、概要欄のリンクから note で読めます。",
};

export async function composeShort(article) {
  const { askJson } = await import("./generator.mjs");
  const free = String(article.body || "").split("<!-- paid -->")[0];
  const r = await askJson(`note の記事を、YouTube ショート（縦長・40〜60秒）にまとめてください。スライド5枚に、ナレーションを付けます。
- 1枚目（cover）：見た人が「自分のことだ」と思う見出し。全角24文字以内
- 2〜4枚目（points）：記事の要点を3つ。見出し（全角16文字以内）と短い文を2〜3行（1行全角22文字以内）
- 5枚目の締めは自動で付けるので書かない
- ナレーション（narration）：1〜4枚目それぞれの読み上げ文を4つ。話し言葉で、1つ40〜80文字。1つ目は最初の1秒で引き込む問いかけ
- タイトル：全角40文字以内。検索されやすい言葉を前半に（#Shorts は自動で付ける）
- 説明文：全角200文字以内。URL は書かない
- ハッシュタグ：# を付けない言葉を3個
- 記事にないこと・筆者の経験にないことは言わない
${article.price ? "- 有料記事なので、無料部分に書かれた範囲だけを使う\n" : ""}${article.topic === "trend" ? `- 話題枠の動画：いま話題の「${[].concat(article.tags || [])[0]}」で検索する人に見つけてもらうため、タイトルの先頭と、ハッシュタグの1つ目にこの言葉を入れる\n` : ""}
## 記事
タイトル：${article.title}
タグ：${[].concat(article.tags || []).join(", ")}

${free.slice(0, 8000)}`, SCHEMA);
  return r;
}

// 投稿：動画を作って YouTube にアップロードする
export async function postArticleToYoutube(article) {
  const destination = snsDestination(article);
  const short = await composeShort(article);
  const id = Date.now().toString(36);
  const ending = ENDINGS[destination.kind] || ENDINGS.note;
  const files = await renderSlides(id, { cover: short.cover, points: short.points.slice(0, 3), ending }, {
    title: article.title, tag: [].concat(article.tags || [])[0], handle: "uspeak_lab", height: 1920, video: true, baseDir: YT_DIR,
  });
  const narration = [...short.narration.slice(0, 4), OUTRO[destination.kind] || OUTRO.note];
  const video = await makeVideo(path.join(YT_DIR, id), files, narration);
  const tags = short.hashtags.map((t) => String(t).replace(/^#+/, "").replace(/\s+/g, "")).filter(Boolean).slice(0, 3);
  const links = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
  const blogLinks = getSettings().blogDomain ? `https://${getSettings().blogDomain}/links` : `${links}/links`;
  const description = [
    short.description.trim(),
    "",
    `▶ ${destination.kind === "note" ? "記事の続き（note）" : destination.label}：${destination.url}`,
    `▶ リンク集：${blogLinks}`,
    "",
    "※ナレーションは音声合成です。",
    "",
    `${tags.map((t) => `#${t}`).join(" ")} #Shorts`,
  ].join("\n").slice(0, 4900);
  const title = `${short.title.trim().slice(0, 85)} #Shorts`;
  const videoId = await upload(video.file, {
    snippet: { title, description, tags, categoryId: "27", defaultLanguage: "ja", defaultAudioLanguage: "ja" },
    status: { privacyStatus: "public", selfDeclaredMadeForKids: false, containsSyntheticMedia: true },
  });
  const log = getYoutubeLog();
  log.push({ name: article.name, id: videoId, title, seconds: Math.round(video.seconds), voiced: video.voiced, to: destination.kind, at: new Date().toISOString() });
  writeJson(LOG, log.slice(-500));
  cleanup();
  return { id: videoId, title, url: `https://youtube.com/shorts/${videoId}`, voiced: video.voiced };
}

// 動画を作るだけ（管理画面の見本用。アップロードしない）
export async function previewShort(article) {
  const destination = snsDestination(article);
  const short = await composeShort(article);
  const id = `p${Date.now().toString(36)}`;
  const files = await renderSlides(id, { cover: short.cover, points: short.points.slice(0, 3), ending: ENDINGS[destination.kind] || ENDINGS.note }, {
    title: article.title, tag: [].concat(article.tags || [])[0], handle: "uspeak_lab", height: 1920, video: true, baseDir: YT_DIR,
  });
  const video = await makeVideo(path.join(YT_DIR, id), files, [...short.narration.slice(0, 4), OUTRO[destination.kind] || OUTRO.note]);
  cleanup();
  return { title: short.title, video: `/yt/${id}/video.mp4`, seconds: Math.round(video.seconds), voiced: video.voiced, narration: short.narration };
}

// 再開可能アップロード：先に動画の情報を送り、返ってきた URL に動画のバイト列を送る
async function upload(file, metadata) {
  const token = await accessToken();
  const size = fs.statSync(file).size;
  const start = await fetch(`${YT}/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`, "content-type": "application/json; charset=UTF-8",
      "x-upload-content-length": String(size), "x-upload-content-type": "video/mp4",
    },
    body: JSON.stringify(metadata),
  });
  if (!start.ok) {
    const j = await start.json().catch(() => ({}));
    throw new Error(`YouTube のアップロード開始 ${start.status}: ${j.error?.message || ""}`);
  }
  const location = start.headers.get("location");
  const res = await fetch(location, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": "video/mp4", "content-length": String(size) },
    body: fs.readFileSync(file),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.id) throw new Error(`YouTube のアップロード ${res.status}: ${json.error?.message || ""}`);
  return json.id;
}

// 作った動画は2日で消す（データ置き場を小さく保つ）
function cleanup(now = Date.now()) {
  if (!fs.existsSync(YT_DIR)) return;
  for (const d of fs.readdirSync(YT_DIR)) {
    const full = path.join(YT_DIR, d);
    if (now - fs.statSync(full).mtimeMs > 2 * 864e5) fs.rmSync(full, { recursive: true, force: true });
  }
}

export { YT_DIR };
