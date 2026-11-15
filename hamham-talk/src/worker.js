// ハムハムトーク 🐹 ふたり専用メッセージアプリ（Cloudflare Workers + Durable Object）
import { DurableObject } from "cloudflare:workers";
import { generateVapidKeys, sendPush } from "./push.js";

const HISTORY_LIMIT = 1000;
const MAX_TEXT = 2000;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const randomHex = (bytes) => hex(crypto.getRandomValues(new Uint8Array(bytes)));
const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

const MAX_IMAGE = 1_500_000; // 端末側で縮小してから送るので、ふつうは 数百KB
const IMAGE_BODY = /^([0-9a-f]{32})\|(\d{1,5})\|(\d{1,5})$/;

const MIN_PASSWORD = 6;
const MAX_FAILS = 5; // これ以上まちがえると、しばらくログインできなくなる

/** パスワードは PBKDF2 でハッシュ化して保存する（"salt:hash"） */
async function hashPassword(password, saltHex = randomHex(16)) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const salt = Uint8Array.from(saltHex.match(/../g), (h) => parseInt(h, 16));
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256);
  return `${saltHex}:${hex(bits)}`;
}
async function checkPassword(password, stored) {
  if (!stored) return false;
  const again = await hashPassword(password, stored.split(":")[0]);
  let diff = again.length ^ stored.length;
  for (let i = 0; i < again.length; i++) diff |= again.charCodeAt(i) ^ stored.charCodeAt(i % stored.length);
  return diff === 0;
}
const validPassword = (p) => typeof p === "string" && p.length >= MIN_PASSWORD && p.length <= 100;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // 世界にひとつだけの「ふたりのおへや」
    const room = env.ROOM.get(env.ROOM.idFromName("room"));
    if (url.pathname.startsWith("/api/")) return room.fetch(request);

    if (url.pathname.startsWith("/stickers/")) {
      const token = url.searchParams.get("token") ?? "";
      const who = await room.fetch(new Request(`${url.origin}/api/state?token=${encodeURIComponent(token)}`)).then((r) => r.json());
      if (!who.me) return json({ error: "unauthorized" }, 401);
      const res = await env.ASSETS.fetch(new Request(`${url.origin}${url.pathname}`));
      const out = new Response(res.body, res);
      out.headers.set("Cache-Control", "private, max-age=31536000, immutable");
      return out;
    }
    return new Response("not found", { status: 404 });
  },
};

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS members (id INTEGER PRIMARY KEY, name TEXT NOT NULL, token TEXT NOT NULL UNIQUE, read_id INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, sender INTEGER NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, ts INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS subs (endpoint TEXT PRIMARY KEY, member INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY, data BLOB NOT NULL, ts INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, member INTEGER NOT NULL, ts INTEGER NOT NULL);
    `);
    // ログイン制にする前に作られたおへや用の列追加（すでにあれば何もしない）
    for (const col of ["pass TEXT", "fails INTEGER NOT NULL DEFAULT 0", "lock_until INTEGER NOT NULL DEFAULT 0"]) {
      try {
        this.sql.exec(`ALTER TABLE members ADD COLUMN ${col}`);
      } catch {}
    }
    // 生存確認の ping はおへやを起こさずに自動で返す（無料枠の節約）
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  get(key) {
    return this.sql.exec("SELECT value FROM kv WHERE key = ?", key).toArray()[0]?.value ?? null;
  }
  set(key, value) {
    this.sql.exec("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value);
  }
  members() {
    return this.sql.exec("SELECT id, name, read_id FROM members ORDER BY id").toArray();
  }
  /** この端末用のログイン状態（セッション）を作る */
  newSession(memberId) {
    const token = randomHex(24);
    this.sql.exec("INSERT INTO sessions (token, member, ts) VALUES (?, ?, ?)", token, memberId, Date.now());
    return token;
  }
  async vapid() {
    let keys = JSON.parse(this.get("vapid") ?? "null");
    if (!keys) {
      keys = await generateVapidKeys();
      this.set("vapid", JSON.stringify(keys));
    }
    return keys;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const token = url.searchParams.get("token") || (request.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
    const me = token
      ? this.sql
          .exec("SELECT id, name, pass FROM members WHERE token = ?1 OR id IN (SELECT member FROM sessions WHERE token = ?1)", token)
          .toArray()[0]
      : null;
    const members = this.members();

    if (path === "/api/state") {
      if (!me) return json({ me: null, members: members.length });
      return json({
        me: { id: me.id, name: me.name, needsPassword: !me.pass },
        partner: members.find((m) => m.id !== me.id)?.name ?? null,
        invite: members.length < 2 ? this.get("invite") : null,
        vapidKey: (await this.vapid()).publicKey,
      });
    }

    if (path === "/api/join" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const name = String(body.name ?? "").trim().slice(0, 20);
      if (!name) return json({ error: "なまえを入れてほしいはむ" }, 400);
      if (!validPassword(body.password)) return json({ error: `パスワードは${MIN_PASSWORD}文字以上にしてほしいはむ` }, 400);
      if (members.some((m) => sameName(m.name, name))) return json({ error: "そのなまえはもう使われてるはむ" }, 400);
      if (members.length >= 2) return json({ error: "ここはふたりだけのおへやはむ🔒" }, 403);
      if (members.length === 1 && body.invite !== this.get("invite")) {
        return json({ error: "招待リンクから開いてほしいはむ" }, 403);
      }
      if (members.length === 0) this.set("invite", randomHex(16));
      const pass = await hashPassword(body.password);
      // 待っているあいだに先を越されていないか、もう一度たしかめる
      if (this.members().length !== members.length) return json({ error: "もういちど試してほしいはむ" }, 409);
      const { id } = this.sql
        .exec("INSERT INTO members (name, token, pass) VALUES (?, ?, ?) RETURNING id", name, randomHex(24), pass)
        .one();
      this.broadcast({ t: "partner", name });
      return json({ token: this.newSession(id) });
    }

    if (path === "/api/login" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const wrong = json({ error: "なまえかパスワードがちがうはむ" }, 401);
      const row = this.sql
        .exec("SELECT id, name, pass, fails, lock_until FROM members")
        .toArray()
        .find((m) => sameName(m.name, String(body.name ?? "")));
      if (!row) return wrong;
      if (row.lock_until > Date.now()) return json({ error: "まちがいが多いはむ。少し待ってからためしてね" }, 429);
      if (!(await checkPassword(String(body.password ?? ""), row.pass))) {
        const fails = row.fails + 1;
        const lock = fails >= MAX_FAILS ? Date.now() + Math.min(2 ** (fails - MAX_FAILS), 15) * 60000 : 0;
        this.sql.exec("UPDATE members SET fails = ?, lock_until = ? WHERE id = ?", fails, lock, row.id);
        return wrong;
      }
      this.sql.exec("UPDATE members SET fails = 0, lock_until = 0 WHERE id = ?", row.id);
      return json({ token: this.newSession(row.id) });
    }

    if (!me) return json({ error: "unauthorized" }, 401);

    if (path === "/api/ws") {
      if (request.headers.get("Upgrade") !== "websocket") return json({ error: "websocket only" }, 426);
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment({ id: me.id, visible: true, seen: Date.now() });
      pair[1].send(JSON.stringify(this.initPayload(me.id)));
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    if (path === "/api/password" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      if (!validPassword(body.password)) return json({ error: `パスワードは${MIN_PASSWORD}文字以上にしてほしいはむ` }, 400);
      this.sql.exec("UPDATE members SET pass = ?, fails = 0, lock_until = 0 WHERE id = ?", await hashPassword(body.password), me.id);
      // ほかの端末は、新しいパスワードでログインしなおしてもらう
      this.sql.exec("DELETE FROM sessions WHERE member = ? AND token != ?", me.id, token);
      return json({ ok: true });
    }

    if (path === "/api/upload" && request.method === "POST") {
      const data = await request.arrayBuffer();
      if (data.byteLength > MAX_IMAGE) return json({ error: "画像が大きすぎるはむ" }, 413);
      const head = new Uint8Array(data.slice(0, 3));
      if (head[0] !== 0xff || head[1] !== 0xd8 || head[2] !== 0xff) return json({ error: "JPEG だけ送れるはむ" }, 415);
      const id = randomHex(16);
      this.sql.exec("INSERT INTO images (id, data, ts) VALUES (?, ?, ?)", id, data, Date.now());
      return json({ id });
    }

    const img = /^\/api\/img\/([0-9a-f]{32})$/.exec(path);
    if (img && request.method === "GET") {
      const row = this.sql.exec("SELECT data FROM images WHERE id = ?", img[1]).toArray()[0];
      if (!row) return json({ error: "not found" }, 404);
      return new Response(row.data, {
        headers: { "Content-Type": "image/jpeg", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=31536000, immutable" },
      });
    }

    if (path === "/api/logout" && request.method === "POST") {
      this.sql.exec("DELETE FROM sessions WHERE token = ?", token);
      return json({ ok: true });
    }

    if (path === "/api/push" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const { endpoint } = body;
      if (typeof endpoint !== "string" || !endpoint.startsWith("https://")) return json({ error: "bad endpoint" }, 400);
      this.sql.exec("INSERT OR REPLACE INTO subs (endpoint, member) VALUES (?, ?)", endpoint, me.id);
      this.set("origin", url.origin);
      // 登録できたかすぐ分かるように、この端末へお試し通知を 1 通送る
      const test = body.test ? await sendPush(endpoint, url.origin, await this.vapid()).catch((e) => `error ${e.message}`) : null;
      return json({ ok: true, test });
    }

    return json({ error: "not found" }, 404);
  }

  initPayload(meId) {
    const members = this.members();
    const partner = members.find((m) => m.id !== meId);
    const messages = this.sql
      .exec("SELECT id, sender, kind, body, ts FROM messages ORDER BY id DESC LIMIT ?", HISTORY_LIMIT)
      .toArray()
      .reverse();
    return {
      t: "init",
      me: meId,
      partner: partner?.name ?? null,
      partnerRead: partner?.read_id ?? 0,
      anniversary: this.get("anniversary"),
      messages,
    };
  }

  broadcast(data) {
    const text = JSON.stringify(data);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(text);
      } catch {}
    }
  }

  async webSocketMessage(ws, raw) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    const att = ws.deserializeAttachment();
    const meId = att.id;

    if (data.t === "msg") {
      const kind = ["sticker", "image"].includes(data.kind) ? data.kind : "text";
      const body = String(data.body ?? "").slice(0, MAX_TEXT);
      if (kind === "image") {
        const m = IMAGE_BODY.exec(body);
        if (!m || !this.sql.exec("SELECT 1 FROM images WHERE id = ?", m[1]).toArray().length) return;
      }
      if (!body.trim()) return;
      const ts = Date.now();
      const { id } = this.sql
        .exec("INSERT INTO messages (sender, kind, body, ts) VALUES (?, ?, ?, ?) RETURNING id", meId, kind, body, ts)
        .one();
      this.broadcast({ t: "msg", m: { id, sender: meId, kind, body, ts }, cid: data.cid });
      this.ctx.waitUntil(this.notifyPartner(meId));
    } else if (data.t === "read") {
      const id = Number(data.id) || 0;
      this.sql.exec("UPDATE members SET read_id = MAX(read_id, ?) WHERE id = ?", id, meId);
      this.broadcast({ t: "read", by: meId, id });
    } else if (data.t === "vis") {
      ws.serializeAttachment({ ...att, visible: !!data.v, seen: Date.now() });
    } else if (data.t === "anniv") {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(data.date) ? data.date : "";
      this.set("anniversary", date);
      this.broadcast({ t: "anniv", date });
    }
  }

  webSocketClose(ws) {
    try {
      ws.close(1000);
    } catch {}
  }

  /** 相手がアプリを開いていないときだけ通知を送る */
  async notifyPartner(senderId) {
    // 「いま画面を見ている」= 表示中で、直近 25 秒以内に生存確認(ping)が来ている端末がある。
    // スマホはアプリを閉じた瞬間に連絡が途切れることがあるので、ping が止まったら見ていない扱いにする。
    const now = Date.now();
    const watching = this.ctx.getWebSockets().some((ws) => {
      const a = ws.deserializeAttachment();
      if (!a || a.id === senderId || !a.visible) return false;
      const lastPing = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0;
      return now - Math.max(a.seen ?? 0, lastPing) < 25000;
    });
    if (watching) return;
    const subs = this.sql.exec("SELECT endpoint FROM subs WHERE member != ?", senderId).toArray();
    if (!subs.length) return;
    const keys = await this.vapid();
    const subject = this.get("origin") ?? "https://hamham-talk.invalid";
    await Promise.all(
      subs.map(async ({ endpoint }) => {
        const result = await sendPush(endpoint, subject, keys).catch((e) => `error ${e.message}`);
        if (result === "gone") this.sql.exec("DELETE FROM subs WHERE endpoint = ?", endpoint);
        else if (result !== "ok") console.error("push failed:", result);
      })
    );
  }
}
