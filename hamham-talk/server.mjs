// ハムハムトーク 🐹 カップル専用 LINE Bot（Cloud Run 用 Webhook サーバー）
import http from "node:http";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { commandReply, aiReply, fallbackReply, HELP_TEXT } from "./hamham.mjs";

const env = process.env;
const HISTORY_TURNS = 12;
const histories = new Map(); // トークルームごとの直近の会話（メモリ上のみ）

export function verifySignature(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest();
  const given = Buffer.from(signature, "base64");
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

async function lineReply(replyToken, text) {
  const res = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ replyToken, messages: [{ type: "text", text: text.slice(0, 4900) }] }),
  });
  if (!res.ok) console.error("LINE reply error:", res.status, await res.text());
}

/** 1件のイベントに対する返信テキストを決める（返信しないときは null） */
export async function replyFor(event, config = {}) {
  const userId = event.source?.userId;
  const allowed = (config.allowedUserIds ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const isAllowed = allowed.length === 0 || allowed.includes(userId);

  if (event.type === "follow" || event.type === "join") {
    return isAllowed ? `ハムハムトークへようこそはむ！🐹💕\n\n${HELP_TEXT}` : null;
  }
  if (event.type !== "message") return null;

  if (event.message.type === "sticker") {
    return isAllowed && event.source.type === "user" ? "かわいいスタンプはむ〜！🐹💕" : null;
  }
  if (event.message.type !== "text") return null;

  const text = event.message.text;
  // ID だけは誰にでも答える（ふたりの userId を調べて ALLOWED_USER_IDS に入れるため）
  if (/^id$/i.test(text.trim())) return commandReply(text, { userId });
  if (!isAllowed) return event.source.type === "user" ? "ここはふたりだけの秘密のおへやはむ🐹🔒" : null;

  const command = commandReply(text, { userId, anniversary: config.anniversary });
  if (command) return command;

  // グループでは呼ばれたときだけ自由会話に入る（ふたりの会話をじゃましない）
  const isGroup = event.source.type !== "user";
  if (isGroup && !/ハムハム|はむはむ/.test(text)) return null;

  const key = event.source.groupId ?? event.source.roomId ?? userId;
  const history = histories.get(key) ?? [];
  history.push({ role: "user", text });
  const reply =
    (await aiReply(history, { apiKey: config.geminiApiKey, model: config.geminiModel })) ?? fallbackReply();
  history.push({ role: "model", text: reply });
  histories.set(key, history.slice(-HISTORY_TURNS));
  return reply;
}

function configFromEnv() {
  return {
    allowedUserIds: env.ALLOWED_USER_IDS,
    anniversary: env.ANNIVERSARY,
    geminiApiKey: env.GEMINI_API_KEY,
    geminiModel: env.GEMINI_MODEL || undefined,
  };
}

export const server = http.createServer((req, res) => {
  if (req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("ハムハムトーク、元気に動いてるはむ🐹");
  }
  if (req.method !== "POST" || req.url.split("?")[0] !== "/webhook") {
    res.writeHead(404);
    return res.end();
  }
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    const raw = Buffer.concat(chunks);
    if (!verifySignature(raw, req.headers["x-line-signature"], env.LINE_CHANNEL_SECRET)) {
      res.writeHead(401);
      return res.end("bad signature");
    }
    try {
      const { events = [] } = JSON.parse(raw.toString("utf8"));
      // Cloud Run はレスポンス後に CPU が止まるので、返信し終えてから 200 を返す
      await Promise.all(
        events.map(async (event) => {
          const text = await replyFor(event, configFromEnv());
          if (text && event.replyToken) await lineReply(event.replyToken, text);
        })
      );
    } catch (err) {
      console.error("webhook error:", err);
    }
    res.writeHead(200);
    res.end("ok");
  });
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const name of ["LINE_CHANNEL_SECRET", "LINE_CHANNEL_ACCESS_TOKEN"]) {
    if (!env[name]) console.error(`⚠️ ${name} が設定されていません`);
  }
  const port = env.PORT || 8080;
  server.listen(port, () => console.log(`🐹 ハムハムトーク listening on ${port}`));
}
