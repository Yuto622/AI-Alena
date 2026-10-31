// SNS の投稿から、読者をどこへ送るか。
// 記事に選ばれたアプリ（記事の内容に合わせて AI が選んだもの）で決める：
// - ここなら（ココナラ）などの個人向けサービス → そのサービスのページへ直接（クリック数も数える）
// - U-Speak Roblox などの法人向け → LINE があれば LINE の友だち追加、なければホームページ
// - それ以外（アプリなし・海外大学の記事など） → note の記事（有料記事・マガジン・相談で売る）
import { getApps } from "./apps.mjs";
import { getSettings } from "./store.mjs";

const DESCRIPTIONS = {
  service: "開発・自動化の相談ができる、ここなら（ココナラ）の出品ページ",
  business: "英語教室向けの教材「U-Speak Roblox」のページ（教室の先生と保護者向け）",
  line: "新しい記事が週1回届く LINE 公式アカウント（友だち追加のページ）",
  note: "note の記事",
};

export function snsDestination(article) {
  const s = getSettings();
  const base = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
  const app = article.app && article.app !== "none" ? getApps().find((a) => a.id === article.app) : null;
  const note = { kind: "note", url: article.url, label: "note の記事", description: DESCRIPTIONS.note };
  if (s.snsSmartLink === false || !base || !app) return note;
  const track = (to) => `${base}/go/${app.id}?a=${encodeURIComponent(`sns:${article.name}`)}${to ? `&to=${to}` : ""}`;
  if (app.kind === "service") return { kind: "service", url: track(), label: app.name, description: DESCRIPTIONS.service };
  if (app.kind === "business") {
    if (s.lineAddUrl) return { kind: "line", url: s.lineAddUrl, label: "LINE 公式アカウント", description: DESCRIPTIONS.line };
    return { kind: "business", url: app.siteUrl ? track("site") : track(), label: app.name, description: DESCRIPTIONS.business };
  }
  return note;
}

// プロフィールに置くリンク集（/links）に並べるもの
export function linkItems() {
  const s = getSettings();
  const base = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
  const track = (app, to) => (base ? `${base}/go/${app.id}?a=links${to ? `&to=${to}` : ""}` : to === "site" ? app.siteUrl : app.url);
  const apps = getApps();
  const items = [];
  for (const app of apps.filter((a) => a.kind === "business")) {
    items.push({ title: `英語教室の方へ：${app.name}`, sub: "無料のオンライン説明を予約する", url: track(app), primary: true });
    if (app.siteUrl) items.push({ title: `${app.company || app.name} のホームページ`, sub: "会社と教材の紹介", url: track(app, "site") });
  }
  const services = apps.filter((a) => a.kind === "service");
  const coconala = services.find((a) => /coconala/.test(a.url));
  if (coconala) {
    // プロフィール（出品の一覧）があればそこへ。なければ出品の1つへ
    items.push({ title: "AI・業務自動化・アプリ開発の相談", sub: "ここなら（ココナラ）で受けています", url: s.coconalaProfileUrl || track(coconala), primary: true });
  }
  for (const app of services.filter((a) => !/coconala/.test(a.url))) {
    items.push({ title: app.name, sub: app.ctaLabel || "申し込む", url: track(app) });
  }
  if (s.lineAddUrl) items.push({ title: "新しい記事を LINE で受け取る", sub: "週1回、その週の記事だけ届きます", url: s.lineAddUrl });
  if (s.noteUrlname) items.push({ title: "note", sub: "有料記事・マガジン", url: `https://note.com/${s.noteUrlname}` });
  for (const app of apps.filter((a) => !a.kind || a.kind === "app")) {
    items.push({ title: `英語学習アプリ「${app.name}」`, sub: "スマホに入れる", url: track(app) });
  }
  return items;
}
