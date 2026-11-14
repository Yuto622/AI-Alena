import test from "node:test";
import assert from "node:assert/strict";
import { toHamu, daysTogether } from "./public/hamu.js";
import { generateVapidKeys, vapidAuthHeader } from "./src/push.js";

test("はむ語変換", () => {
  assert.equal(toHamu("今日は楽しかった。また行こうね！"), "今日は楽しかったはむ。また行こうねはむ！");
  assert.equal(toHamu("幸せはむ"), "幸せはむ");
  assert.equal(toHamu("ね☺️"), "ねはむ☺️");
  assert.equal(toHamu("おはよう\nおやすみ"), "おはようはむ\nおやすみはむ");
});

test("記念日カウント", () => {
  assert.equal(daysTogether("2026-01-01", new Date(2026, 0, 1, 12)), 1);
  assert.equal(daysTogether("2026-01-01", new Date(2026, 3, 10, 12)), 100);
  assert.equal(daysTogether("bad"), null);
});

test("VAPID 署名が公開鍵で検証できる", async () => {
  const keys = await generateVapidKeys();
  const header = await vapidAuthHeader("https://push.example.com/send/abc", "https://app.example.com", keys);
  const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(header);
  assert.equal(k, keys.publicKey);
  const [h, b, s] = jwt.split(".");
  const dec = (x) => Buffer.from(x, "base64url");
  assert.equal(JSON.parse(dec(b)).aud, "https://push.example.com");
  const pub = await crypto.subtle.importKey("raw", dec(k), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  assert.ok(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, dec(s), Buffer.from(`${h}.${b}`)));
});
