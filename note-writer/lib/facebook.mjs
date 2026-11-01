// Facebook ページに、記事の紹介を自動で投稿する（Graph API は無料）。
// 英語教室の経営者がいちばん使っている SNS なので、U-Speak の記事は「説明会の予約」へ直接送る。
// 期限のないページ用トークンは、短いユーザートークンから、このサーバーで作る（アプリ ID とシークレットはそのときだけ使い、保存しない）
import path from "path";
import { DATA_DIR } from "./config.mjs";
import { readJson, writeJson, getSettings } from "./store.mjs";
import { loadSecret, saveSecret } from "./credentials.mjs";
import { composePost } from "./x.mjs";
import { snsDestination } from "./destinations.mjs";
import { getApps } from "./apps.mjs";

const LOG = path.join(DATA_DIR, "facebook-log.json");
const API = process.env.FACEBOOK_API_BASE || "https://graph.facebook.com";

export const getFacebookLog = () => readJson(LOG, []);
export const hasFacebookPage = () => !!loadSecret("facebook")?.pageToken;
export const facebookEnabled = () => getSettings().facebookOnPublish && hasFacebookPage();

async function call(method, pathname, params) {
  const url = new URL(`${API}${pathname}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { method });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(`Facebook API ${res.status}: ${json.error?.message || ""}`);
  return json;
}

// 短いユーザートークン → 長いユーザートークン → 期限のないページのトークン
export async function setFacebookPage({ appId, appSecret, userToken, pageName }) {
  if (!appId || !appSecret || !userToken) throw new Error("アプリ ID・アプリシークレット・ユーザートークンを入れてください");
  const long = await call("GET", "/oauth/access_token", {
    grant_type: "fb_exchange_token", client_id: String(appId).trim(), client_secret: String(appSecret).trim(), fb_exchange_token: String(userToken).trim(),
  });
  const { data = [] } = await call("GET", "/me/accounts", { fields: "id,name,access_token", access_token: long.access_token });
  if (!data.length) throw new Error("管理しているページが見つかりません。トークンを作るときに、ページを選んで許可してください");
  const page = (pageName && data.find((p) => p.name === String(pageName).trim())) || data[0];
  saveSecret("facebook", { pageId: page.id, pageName: page.name, pageToken: page.access_token });
  return { page: page.name, pages: data.map((p) => p.name) };
}

export async function facebookWhoAmI() {
  const s = loadSecret("facebook");
  if (!s?.pageToken) throw new Error("Facebook ページが未設定です");
  const me = await call("GET", "/me", { fields: "id,name", access_token: s.pageToken });
  return { page: me.name };
}

// Facebook の読者（教室の経営者が多い）向けの送り先：U-Speak の記事は説明会の予約へ
function destinationFor(article) {
  const d = snsDestination(article);
  if (d.kind !== "line" && d.kind !== "business") return d;
  const app = getApps().find((a) => a.id === article.app);
  const base = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
  if (!app || !base) return d;
  return { kind: "business", url: `${base}/go/${app.id}?a=${encodeURIComponent(`fb:${article.name}`)}`, label: app.name, description: "英語教室向けの教材「U-Speak Roblox」の無料説明の予約ページ（教室の経営者・先生向け）" };
}

export async function postArticleToFacebook(article) {
  const s = loadSecret("facebook");
  if (!s?.pageToken) throw new Error("Facebook ページが未設定です");
  if (!article.url) throw new Error("記事の URL がありません");
  const destination = destinationFor(article);
  const text = await composePost(article, { platform: "facebook", destination });
  const { id } = await call("POST", `/${s.pageId}/feed`, { message: text, link: destination.url, access_token: s.pageToken });
  const log = getFacebookLog();
  log.push({ name: article.name, id, text, to: destination.kind, at: new Date().toISOString() });
  writeJson(LOG, log.slice(-500));
  return { id, text };
}
