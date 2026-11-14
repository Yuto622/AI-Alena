// ハムハムトーク 🐹 ふたり専用メッセージアプリ（Cloudflare Workers + Durable Object）
import { DurableObject } from "cloudflare:workers";
import { generateVapidKeys, sendPush } from "./push.js";

const HISTORY_LIMIT = 300;
const MAX_TEXT = 2000;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
const randomHex = (bytes) =>
  [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");

export default {
  fetch(request, env) {
    if (new URL(request.url).pathname.startsWith("/api/")) {
      // 世界にひとつだけの「ふたりのおへや」
      return env.ROOM.get(env.ROOM.idFromName("room")).fetch(request);
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
    `);
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
    const me = token ? this.sql.exec("SELECT id, name FROM members WHERE token = ?", token).toArray()[0] : null;
    const members = this.members();

    if (path === "/api/state") {
      if (!me) return json({ me: null, members: members.length });
      return json({
        me,
        partner: members.find((m) => m.id !== me.id)?.name ?? null,
        invite: members.length < 2 ? this.get("invite") : null,
        vapidKey: (await this.vapid()).publicKey,
      });
    }

    if (path === "/api/join" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const name = String(body.name ?? "").trim().slice(0, 20);
      if (!name) return json({ error: "なまえを入れてほしいはむ" }, 400);
      if (members.length >= 2) return json({ error: "ここはふたりだけのおへやはむ🔒" }, 403);
      if (members.length === 1 && body.invite !== this.get("invite")) {
        return json({ error: "招待リンクから開いてほしいはむ" }, 403);
      }
      if (members.length === 0) this.set("invite", randomHex(16));
      const newToken = randomHex(24);
      this.sql.exec("INSERT INTO members (name, token) VALUES (?, ?)", name, newToken);
      this.broadcast({ t: "partner", name });
      return json({ token: newToken });
    }

    if (!me) return json({ error: "unauthorized" }, 401);

    if (path === "/api/ws") {
      if (request.headers.get("Upgrade") !== "websocket") return json({ error: "websocket only" }, 426);
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment({ id: me.id, visible: true });
      pair[1].send(JSON.stringify(this.initPayload(me.id)));
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    if (path === "/api/push" && request.method === "POST") {
      const { endpoint } = await request.json().catch(() => ({}));
      if (typeof endpoint !== "string" || !endpoint.startsWith("https://")) return json({ error: "bad endpoint" }, 400);
      this.sql.exec("INSERT OR REPLACE INTO subs (endpoint, member) VALUES (?, ?)", endpoint, me.id);
      this.set("origin", url.origin);
      return json({ ok: true });
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
      const kind = data.kind === "sticker" ? "sticker" : "text";
      const body = String(data.body ?? "").slice(0, MAX_TEXT);
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
      ws.serializeAttachment({ ...att, visible: !!data.v });
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
    const watching = this.ctx.getWebSockets().some((ws) => {
      const a = ws.deserializeAttachment();
      return a && a.id !== senderId && a.visible;
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
