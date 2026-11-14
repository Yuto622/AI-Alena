import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { toHamu, daysTogether, commandReply } from "./hamham.mjs";
import { verifySignature, replyFor, server } from "./server.mjs";

const textEvent = (text, source = { type: "user", userId: "U1" }) => ({
  type: "message",
  replyToken: "r",
  source,
  message: { type: "text", text },
});

test("はむ語変換", () => {
  assert.equal(toHamu("今日は楽しかった。また行こうね！"), "今日は楽しかったはむ。また行こうねはむ！");
  assert.equal(toHamu("幸せはむ"), "幸せはむ");
  assert.equal(toHamu("ね☺️"), "ねはむ☺️");
  assert.equal(toHamu("おはよう\nおやすみ"), "おはようはむ\nおやすみはむ");
});

test("記念日カウント（日本時間）", () => {
  assert.equal(daysTogether("2026-01-01", new Date("2026-01-01T03:00:00Z")), 1);
  // UTC 15:00 = JST 翌日 0:00
  assert.equal(daysTogether("2026-01-01", new Date("2026-01-01T15:00:00Z")), 2);
  assert.equal(daysTogether("bad"), null);
});

test("コマンド", () => {
  assert.equal(commandReply("はむ語 会いたい"), "会いたいはむ");
  assert.match(commandReply("記念日", { anniversary: "2026-01-01", now: new Date("2026-04-10T03:00:00Z") }), /100日目/);
  assert.match(commandReply("おみくじ"), /おみくじ/);
  assert.match(commandReply("大好き"), /はむ/);
  assert.equal(commandReply("今日のごはん何にする？"), null);
});

test("ふたり専用・グループでの振る舞い", async () => {
  const cfg = { allowedUserIds: "U1,U2" };
  assert.match(await replyFor(textEvent("こんにちは", { type: "user", userId: "U9" }), cfg), /秘密/);
  assert.match(await replyFor(textEvent("ID", { type: "user", userId: "U9" }), cfg), /U9/);
  assert.match(await replyFor(textEvent("こんにちは"), cfg), /はむ/);
  const group = { type: "group", groupId: "G", userId: "U1" };
  assert.equal(await replyFor(textEvent("明日ひま？", group), cfg), null);
  assert.match(await replyFor(textEvent("ハムハムどう思う？", group), cfg), /はむ/);
  assert.match(await replyFor(textEvent("大好き", group), cfg), /はむ/);
});

test("署名検証と webhook", async () => {
  const secret = "s3cret";
  process.env.LINE_CHANNEL_SECRET = secret;
  const body = JSON.stringify({ events: [] });
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64");
  assert.equal(verifySignature(Buffer.from(body), sig, secret), true);
  assert.equal(verifySignature(Buffer.from(body), "xxxx", secret), false);

  await new Promise((r) => server.listen(0, r));
  const url = `http://127.0.0.1:${server.address().port}/webhook`;
  const ok = await fetch(url, { method: "POST", body, headers: { "x-line-signature": sig } });
  const ng = await fetch(url, { method: "POST", body, headers: { "x-line-signature": "bad" } });
  server.close();
  assert.equal(ok.status, 200);
  assert.equal(ng.status, 401);
});
