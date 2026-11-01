/**
 * 管理画面（依存ライブラリなしの node:http）
 * - パスワード必須・ログイン試行制限・HttpOnly/SameSite=Strict Cookie・CSRF トークン・CSP
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_DIR, STORAGE_STATE_PATH, configPathFor, loadConfig, saveConfig, writableConfigPath } from "../config.js";
import { audit, halt, unhalt } from "../safety.js";
import { log, recentLogs } from "../util.js";
import { contractMessage, sendSlack, slackConfigured } from "../notify.js";
import { Auth, parseCookies } from "./auth.js";
import * as V from "./views.js";

const STATIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "static");
const SHOT_DIR = path.join(DATA_DIR, "screenshots");
const AUDIT_FILE = path.join(DATA_DIR, "audit.jsonl");
const MAX_BODY = 2 * 1024 * 1024;

const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error("too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString("utf8")))));
    req.on("error", reject);
  });
}

function sessionInfo() {
  if (!fs.existsSync(STORAGE_STATE_PATH)) return { exists: false };
  return { exists: true, mtime: fs.statSync(STORAGE_STATE_PATH).mtime.toISOString() };
}

function slackInfo() {
  const q = path.join(DATA_DIR, "notify-queue.jsonl");
  const queued = fs.existsSync(q) ? fs.readFileSync(q, "utf8").split("\n").filter(Boolean).length : 0;
  return { configured: slackConfigured(), queued };
}

function readAudit(limit = 300) {
  if (!fs.existsSync(AUDIT_FILE)) return [];
  const lines = fs.readFileSync(AUDIT_FILE, "utf8").trim().split("\n").filter(Boolean).slice(-limit);
  return lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse();
}

const toInt = (v, d) => (v === undefined || v === "" ? d : Math.round(Number(v)));
const toNum = (v, d) => (v === undefined || v === "" ? d : Number(v));
const toLines = (v) => String(v ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

/** フォームの値を設定に反映（未知のキーは触らない） */
export function applySettingsForm(config, f) {
  const c = structuredClone(config);
  c.dryRun = f.dryRun === "on";
  if (["auto", "draft"].includes(f.mode)) c.mode = f.mode;
  c.schedule.activeHours = [toInt(f.activeStart, c.schedule.activeHours[0]), toInt(f.activeEnd, c.schedule.activeHours[1])];
  c.schedule.intervalMinutes = toInt(f.intervalMinutes, c.schedule.intervalMinutes);
  c.schedule.inboxIntervalMinutes = toInt(f.inboxIntervalMinutes, c.schedule.inboxIntervalMinutes);
  c.limits.maxApplicationsPerDay = toInt(f.maxApplicationsPerDay, c.limits.maxApplicationsPerDay);
  c.limits.maxApplicationsPerRun = toInt(f.maxApplicationsPerRun, c.limits.maxApplicationsPerRun);
  c.ai.minScore = toInt(f.minScore, c.ai.minScore);
  c.filters.minBudgetYen = toInt(f.minBudgetYen, c.filters.minBudgetYen);
  c.filters.minHourlyYen = toInt(f.minHourlyYen, c.filters.minHourlyYen);
  c.filters.maxApplicants = toInt(f.maxApplicants, c.filters.maxApplicants);
  if (f.keywords !== undefined) c.search.keywords = toLines(f.keywords);
  if (f.searchUrls !== undefined) c.search.searchUrls = toLines(f.searchUrls).filter((u) => /^https:\/\/crowdworks\.jp\//.test(u));
  if (f.excludeKeywords !== undefined) c.filters.excludeKeywords = toLines(f.excludeKeywords);
  c.negotiation.autoAcceptContract = f.autoAcceptContract === "on";
  c.negotiation.minAcceptRatio = toNum(f.minAcceptRatio, c.negotiation.minAcceptRatio);
  c.negotiation.minContractYen = toInt(f.minContractYen, c.negotiation.minContractYen);
  c.negotiation.maxContractYen = toInt(f.maxContractYen, c.negotiation.maxContractYen);
  c.negotiation.maxRepliesPerDay = toInt(f.maxRepliesPerDay, c.negotiation.maxRepliesPerDay);
  if (f.availability !== undefined) c.profile.availability = f.availability;
  c.profile.hourlyRateYen = toInt(f.hourlyRateYen, c.profile.hourlyRateYen);
  if (f.summary !== undefined) c.profile.summary = f.summary;
  const [a, b] = c.schedule.activeHours;
  if (!(a >= 0 && a <= 23 && b >= 0 && b <= 24)) throw new Error("稼働時間は 0〜24 で指定してください");
  if (!(c.schedule.intervalMinutes >= 15)) throw new Error("応募巡回の間隔は 15 分以上にしてください");
  if (!(c.ai.minScore >= 0 && c.ai.minScore <= 100)) throw new Error("最低スコアは 0〜100");
  return c;
}

/** storage-state.json として妥当か（CrowdWorks の Cookie を含むか）検証 */
export function validateStorageState(text) {
  let s;
  try { s = JSON.parse(text); } catch { throw new Error("JSON として読めません"); }
  if (!Array.isArray(s.cookies)) throw new Error("cookies がありません（npm run login で作った storage-state.json を貼ってください）");
  if (!s.cookies.some((c) => String(c.domain).endsWith("crowdworks.jp"))) throw new Error("crowdworks.jp の Cookie が含まれていません");
  return s;
}

export function createAdminServer({ store, scheduler, password, configPath, checkLogin, trustProxy = false, secureCookie = false }) {
  const auth = new Auth(password);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const ip = (trustProxy && String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim()) || req.socket.remoteAddress;
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": "text/html; charset=utf-8", ...headers });
      res.end(body);
    };
    const redirect = (to, msg) => {
      res.writeHead(303, { ...SECURITY_HEADERS, Location: msg ? `${to}${to.includes("?") ? "&" : "?"}msg=${encodeURIComponent(msg)}` : to });
      res.end();
    };
    const cookieFlags = `HttpOnly; SameSite=Strict; Path=/${secureCookie ? "; Secure" : ""}`;

    try {
      // ---- 認証不要 ----
      if (url.pathname === "/healthz") return send(200, "ok", { "Content-Type": "text/plain" });
      if (url.pathname.startsWith("/static/")) {
        const name = path.basename(url.pathname);
        const file = path.join(STATIC_DIR, name);
        if (!/^[\w.-]+\.(css|js)$/.test(name) || !fs.existsSync(file)) return send(404, "not found");
        return send(200, fs.readFileSync(file), { "Content-Type": name.endsWith(".css") ? "text/css" : "text/javascript", "Cache-Control": "max-age=300" });
      }
      if (url.pathname === "/login") {
        if (req.method === "POST") {
          const body = await readBody(req);
          const locked = auth.locked(ip);
          const token = locked ? null : auth.login(ip, body.password);
          if (!token) {
            log(`管理画面: ログイン失敗 (${ip})`);
            return send(401, V.loginPage({ error: true, locked: auth.locked(ip) }));
          }
          log(`管理画面: ログイン (${ip})`);
          res.writeHead(303, { ...SECURITY_HEADERS, Location: "/", "Set-Cookie": `cwsid=${token}; ${cookieFlags}; Max-Age=${12 * 3600}` });
          return res.end();
        }
        return send(200, V.loginPage({ locked: auth.locked(ip) }));
      }

      // ---- ここから認証必須 ----
      const token = parseCookies(req.headers.cookie).cwsid;
      const session = auth.session(token);
      if (!session) return redirect("/login");
      const csrf = session.csrf;
      const flash = url.searchParams.get("msg");

      if (req.method === "POST") {
        // Origin が付いていれば同一ホストであること（SameSite に加えた二重の CSRF 対策）
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) return send(403, "forbidden");
        const body = await readBody(req);
        if (!auth.checkCsrf(session, body.csrf)) return send(403, "CSRF トークンが不正です。ページを再読み込みしてください。");
        if (url.pathname === "/logout") {
          auth.logout(token);
          res.writeHead(303, { ...SECURITY_HEADERS, Location: "/login", "Set-Cookie": `cwsid=; ${cookieFlags}; Max-Age=0` });
          return res.end();
        }
        return await handlePost(url.pathname, body, { redirect, send, token });
      }

      switch (url.pathname) {
        case "/": {
          store.reload();
          let config = null;
          try { config = loadConfig(configPath); } catch { /* status に出る */ }
          const threads = Object.values(store.state.threads);
          const withTitle = (t) => ({ ...t, title: t.jobId ? store.get(t.jobId)?.title : null });
          const needsHuman = threads.filter((t) => t.status === "needs_human").map(withTitle);
          const contracted = Object.values(store.state.jobs).filter((j) => j.status === "contracted").sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")).slice(0, 10);
          return send(200, V.dashboardPage({ status: scheduler.status(), stats: store.stats(), config, needsHuman, contracted, session: sessionInfo(), slack: slackInfo(), csrf, flash }));
        }
        case "/threads": {
          store.reload();
          const filter = url.searchParams.get("status") ?? "";
          const threads = Object.values(store.state.threads)
            .filter((t) => !filter || t.status === filter)
            .map((t) => ({ ...t, title: t.jobId ? store.get(t.jobId)?.title : null }))
            .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
            .slice(0, 300);
          return send(200, V.threadsPage({ threads, filter, csrf, flash }));
        }
        case "/jobs": {
          store.reload();
          const filter = url.searchParams.get("status") ?? "";
          const jobs = Object.entries(store.state.jobs).map(([id, j]) => ({ id, ...j }))
            .filter((j) => !filter || j.status === filter)
            .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
            .slice(0, 300);
          return send(200, V.jobsPage({ jobs, filter, csrf, flash }));
        }
        case "/audit":
          return send(200, V.auditPage({ entries: readAudit(), csrf, flash }));
        case "/logs":
          return send(200, V.logsPage({ lines: recentLogs, csrf, flash }));
        case "/settings": {
          let config;
          try { config = loadConfig(configPath); } catch (e) { return send(200, V.layout({ title: "設定", csrf, flash: e.message, body: "" })); }
          const file = configPathFor(configPath);
          const raw = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : JSON.stringify(config, null, 2);
          return send(200, V.settingsPage({ config, raw, path: writableConfigPath(configPath), csrf, flash }));
        }
        case "/session":
          return send(200, V.sessionPage({ session: sessionInfo(), slack: slackInfo(), csrf, flash }));
        default:
          if (url.pathname.startsWith("/screenshots/")) {
            const name = path.basename(url.pathname);
            const file = path.join(SHOT_DIR, name);
            if (!/^[\w.-]+\.png$/.test(name) || !fs.existsSync(file)) return send(404, "not found");
            return send(200, fs.readFileSync(file), { "Content-Type": "image/png" });
          }
          return send(404, V.layout({ title: "Not found", csrf, body: "<p>ページがありません</p>" }));
      }
    } catch (e) {
      log(`管理画面エラー: ${e.stack ?? e.message}`);
      if (!res.headersSent) send(500, "internal error");
    }
  });

  async function handlePost(pathname, body, { redirect, token }) {
    switch (pathname) {
      case "/actions/stop":
        await halt(`管理画面から停止${body.reason ? `: ${String(body.reason).slice(0, 200)}` : ""}`);
        audit("admin.stop", { reason: body.reason });
        return redirect("/", "緊急停止しました。すべての自動送信を止めています。");
      case "/actions/unhalt":
        unhalt();
        audit("admin.unhalt", {});
        return redirect("/", "停止を解除しました。");
      case "/actions/run": {
        const kind = body.kind === "apply" ? "apply" : "inbox";
        if (scheduler.busy) return redirect("/", `「${scheduler.busy}」を実行中です。終わってから再度お試しください。`);
        scheduler.run(kind, { manual: true }).catch(() => {});
        return redirect("/", `${kind === "apply" ? "応募巡回" : "メッセージ確認"}を開始しました。結果はこの画面とログに出ます。`);
      }
      case "/actions/slack-test": {
        const r = await sendSlack(contractMessage({ title: "【テスト】受注通知の表示確認", amountYen: 100000, proposedYen: 100000, source: "auto", kickoffSent: true, jobUrl: "https://crowdworks.jp/" }));
        return redirect("/", r.ok ? "Slack にテスト通知を送りました。" : `Slack 通知に失敗しました: ${r.error}`);
      }
      case "/threads/resume":
      case "/threads/close": {
        store.reload();
        if (!store.thread(body.url)) return redirect("/threads", "スレッドが見つかりません");
        const resume = pathname.endsWith("resume");
        store.upsertThread(body.url, resume ? { status: "active", lastHash: null, escalation: null } : { status: "closed" });
        audit(resume ? "admin.thread.resume" : "admin.thread.close", { url: body.url });
        return redirect("/threads", resume ? "自動対応に戻しました。" : "このスレッドの自動対応を止めました。");
      }
      case "/settings": {
        try {
          const next = applySettingsForm(loadConfig(configPath), body);
          const file = saveConfig(next, configPath);
          audit("admin.settings", { file, dryRun: next.dryRun, limits: next.limits, negotiation: next.negotiation });
          return redirect("/settings", "保存しました。次回の実行から反映されます。");
        } catch (e) {
          return redirect("/settings", `保存できませんでした: ${e.message}`);
        }
      }
      case "/settings/raw": {
        try {
          const next = JSON.parse(body.json);
          if (typeof next !== "object" || next === null || Array.isArray(next)) throw new Error("JSON オブジェクトではありません");
          saveConfig(next, configPath);
          audit("admin.settings.raw", {});
          return redirect("/settings", "保存しました。");
        } catch (e) {
          return redirect("/settings", `保存できませんでした: ${e.message}`);
        }
      }
      case "/session/upload": {
        try {
          const s = validateStorageState(body.json);
          fs.mkdirSync(path.dirname(STORAGE_STATE_PATH), { recursive: true });
          fs.writeFileSync(STORAGE_STATE_PATH, JSON.stringify(s), { mode: 0o600 });
          fs.chmodSync(STORAGE_STATE_PATH, 0o600);
          audit("admin.session.upload", { cookies: s.cookies.length });
          return redirect("/session", "ログイン情報を登録しました。「ログインできるか確認」で確認してください。");
        } catch (e) {
          return redirect("/session", `登録できませんでした: ${e.message}`);
        }
      }
      case "/session/check": {
        if (scheduler.busy) return redirect("/session", "ボットが実行中です。少し待ってから確認してください。");
        try {
          const r = await scheduler.exclusive("ログイン確認", checkLogin);
          if (!r.ok) return redirect("/session", r.message);
          const ok = r.value;
          return redirect("/session", ok ? "ログインできています。" : "ログインできませんでした。ログイン情報を登録し直してください。");
        } catch (e) {
          return redirect("/session", `確認できませんでした: ${e.message}`);
        }
      }
      default:
        return redirect("/", "不明な操作です");
    }
  }

  return server;
}
