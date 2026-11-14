// Web Push（本文なし）を送るための VAPID 署名。WebCrypto だけで動く。

const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlText = (s) => b64url(new TextEncoder().encode(s));

const ALG = { name: "ECDSA", namedCurve: "P-256" };

/** 新しい VAPID 鍵を作る → { publicKey: base64url(65byte), privateJwk } */
export async function generateVapidKeys() {
  const pair = await crypto.subtle.generateKey(ALG, true, ["sign", "verify"]);
  return {
    publicKey: b64url(await crypto.subtle.exportKey("raw", pair.publicKey)),
    privateJwk: await crypto.subtle.exportKey("jwk", pair.privateKey),
  };
}

export async function vapidAuthHeader(endpoint, subject, keys, now = Date.now()) {
  const head = b64urlText(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const body = b64urlText(
    JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })
  );
  const key = await crypto.subtle.importKey("jwk", keys.privateJwk, ALG, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${head}.${body}`));
  return `vapid t=${head}.${body}.${b64url(sig)}, k=${keys.publicKey}`;
}

/** 本文なしの push を送る。購読が無効になっていたら "gone" を返す */
export async function sendPush(endpoint, subject, keys) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: await vapidAuthHeader(endpoint, subject, keys), TTL: "86400", Urgency: "high" },
  });
  if (res.status === 404 || res.status === 410) return "gone";
  return res.ok ? "ok" : `error ${res.status}`;
}
