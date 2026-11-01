import crypto from "node:crypto";

const SESSION_TTL_MS = 12 * 3600 * 1000;
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest();

export class Auth {
  constructor(password) {
    if (!password || password.length < 12) {
      throw new Error("ADMIN_PASSWORD を 12 文字以上で設定してください（管理画面はパスワード必須です）");
    }
    this.pwHash = sha(password);
    this.sessions = new Map(); // token -> { exp, csrf }
    this.fails = new Map(); // ip -> { count, until }
  }

  locked(ip) {
    const f = this.fails.get(ip);
    return Boolean(f && f.until > Date.now());
  }

  /** @returns {string|null} セッショントークン */
  login(ip, password) {
    if (this.locked(ip)) return null;
    const ok = crypto.timingSafeEqual(sha(password ?? ""), this.pwHash);
    if (!ok) {
      const f = this.fails.get(ip) ?? { count: 0, until: 0 };
      f.count++;
      if (f.count >= MAX_FAILS) { f.until = Date.now() + LOCK_MS; f.count = 0; }
      this.fails.set(ip, f);
      return null;
    }
    this.fails.delete(ip);
    const token = crypto.randomBytes(32).toString("hex");
    this.sessions.set(token, { exp: Date.now() + SESSION_TTL_MS, csrf: crypto.randomBytes(24).toString("hex") });
    return token;
  }

  session(token) {
    if (!token) return null;
    const s = this.sessions.get(token);
    if (!s) return null;
    if (s.exp < Date.now()) { this.sessions.delete(token); return null; }
    return s;
  }

  logout(token) {
    this.sessions.delete(token);
  }

  checkCsrf(session, value) {
    if (!session || typeof value !== "string" || value.length !== session.csrf.length) return false;
    return crypto.timingSafeEqual(Buffer.from(value), Buffer.from(session.csrf));
  }
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
