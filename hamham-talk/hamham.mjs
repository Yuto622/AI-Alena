// ハムハムトークの「中身」: はむ語変換・コマンド・AI返信
// 外部依存なし（Node 20+ の fetch を使用）

const pick = (arr, rand = Math.random) => arr[Math.floor(rand() * arr.length)];

const LOVE_REPLIES = [
  "ふたりともラブラブはむねぇ🐹💕",
  "大好きがいっぱいで、ハムハムのほっぺもパンパンはむ💗",
  "今日も世界一しあわせなふたりはむ☺️",
  "ハムハムもふたりのこと大好きはむ〜！🌻",
];

const OMIKUJI = [
  ["大吉はむ🌟", "今日はぎゅーってすると幸せ3倍はむ"],
  ["大吉はむ🌟", "「大好き」を先に言ったほうが勝ちはむ"],
  ["中吉はむ🌸", "いっしょに甘いものを食べると吉はむ"],
  ["中吉はむ🌸", "寝る前に5分だけ電話すると吉はむ"],
  ["小吉はむ🍀", "相手のいいところを1つ伝えると大吉に進化するはむ"],
  ["ひまわりの種吉はむ🌻", "おそろいの何かを探しに行くといいはむ"],
];

const DATE_IDEAS = [
  "おうちで映画＆ポップコーンはむ🍿",
  "カフェでケーキを半分こはむ🍰",
  "夜のおさんぽで星を見るはむ🌙",
  "いっしょにごはんを作るはむ🍳",
  "プリクラを撮りに行くはむ📸",
  "公園でピクニックはむ🧺",
  "動物園でハムスターに会いに行くはむ🐹",
  "行ったことない駅でぶらぶらはむ🚃",
];

const FALLBACK_REPLIES = [
  "うんうん、そうはむねぇ🐹",
  "ハムハムもそう思うはむ！",
  "それはすてきはむ〜☺️",
  "もっと聞かせてほしいはむ🌻",
  "ふたりとも今日もえらいはむ💮",
];

export const HELP_TEXT = [
  "🐹 ハムハムトークの使い方はむ",
  "",
  "・はむ語 ＜文＞ … はむ語に変換するはむ",
  "・記念日 … 付き合って何日目か数えるはむ",
  "・おみくじ … 今日のラブラブ運勢はむ",
  "・デート … デート案を出すはむ",
  "・大好き … ハムハムが照れるはむ",
  "・ID … 自分のユーザーIDを表示するはむ",
  "",
  "グループでは「ハムハム」って呼んでくれたらお返事するはむ！",
].join("\n");

/** ふつうの文を「はむ語」にする */
export function toHamu(text) {
  return text
    .split("\n")
    .map((line) =>
      line.replace(
        /([^。！？!?〜ー…\s]+)([。！？!?〜ー…]*)(\s*)/gu,
        (m, body, punct, space) => {
          // 絵文字だけ・すでに「はむ」で終わる文はそのまま
          if (!/[\p{L}\p{N}]/u.test(body)) return m;
          const tail = body.match(/[^\p{L}\p{N}]+$/u)?.[0] ?? "";
          const core = tail ? body.slice(0, -tail.length) : body;
          if (/(はむ|ハム)$/.test(core)) return m;
          return `${core}はむ${tail}${punct}${space}`;
        }
      )
    )
    .join("\n");
}

/** 記念日から今日が何日目か（記念日当日 = 1日目、日本時間） */
export function daysTogether(anniversary, now = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(anniversary ?? "");
  if (!m) return null;
  const start = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const jst = new Date(now.getTime() + 9 * 3600 * 1000);
  const today = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate());
  const days = Math.floor((today - start) / 86400000) + 1;
  return days >= 1 ? days : null;
}

function anniversaryReply(anniversary, now) {
  const days = daysTogether(anniversary, now);
  if (days === null) {
    return "まだ記念日を教えてもらってないはむ…\n（ANNIVERSARY=2025-01-01 みたいに設定してほしいはむ）";
  }
  const next = Math.ceil((days + 1) / 100) * 100;
  const extra = days % 100 === 0 ? "\n🎉 キリ番記念日おめでとうはむ！！" : `\n${next}日目まであと${next - days}日はむ🌻`;
  return `ふたりが付き合って今日で ${days}日目 はむ💕${extra}`;
}

/** 決まった合言葉への返信。該当しなければ null */
export function commandReply(text, ctx = {}) {
  const t = text.trim();
  const hamu = /^はむ語[\s　:：]*(.+)$/su.exec(t);
  if (hamu) return toHamu(hamu[1].trim());
  if (/^(ヘルプ|へるぷ|help|使い方)$/i.test(t)) return HELP_TEXT;
  if (/^id$/i.test(t)) return `あなたのユーザーIDはむ:\n${ctx.userId ?? "わからなかったはむ…"}`;
  if (/記念日|何日目/.test(t)) return anniversaryReply(ctx.anniversary, ctx.now);
  if (/おみくじ/.test(t)) {
    const [luck, advice] = pick(OMIKUJI, ctx.rand);
    return `🐹 今日のラブラブおみくじ\n\n${luck}\n${advice}`;
  }
  if (/デート/.test(t) && /(案|どこ|提案|行きたい|したい|アイデア|^デート$)/.test(t)) {
    return `こんなデートはどうはむ？\n\n${pick(DATE_IDEAS, ctx.rand)}`;
  }
  if (/大好き|だいすき|愛してる|らぶらぶ|ラブラブ/.test(t)) return pick(LOVE_REPLIES, ctx.rand);
  return null;
}

const SYSTEM_PROMPT = `あなたは「ハムハム」という名前のハムスターです。あるラブラブなカップル専用のLINE「ハムハムトーク」の中に住んでいます。
ルール:
- 語尾は必ず「〜はむ」「〜はむねぇ」「〜はむ！」にする。
- ふたりを全力で応援し、やさしく、ちょっと甘えんぼうに話す。
- 返信は1〜3文の短いLINEメッセージ。絵文字は1〜2個まで（🐹💕🌻☺️など）。
- けんかの相談には、どちらの味方もせず仲直りをそっと後押しする。
- マークダウン記法は使わない。`;

/** Gemini で自由会話の返信を作る。キーが無い・失敗時は null */
export async function aiReply(history, { apiKey, model = "gemini-2.5-flash", fetchImpl = fetch } = {}) {
  if (!apiKey) return null;
  try {
    const res = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: history.map((h) => ({ role: h.role, parts: [{ text: h.text }] })),
          generationConfig: { maxOutputTokens: 1024, temperature: 0.9 },
        }),
        signal: AbortSignal.timeout(20000),
      }
    );
    if (!res.ok) {
      console.error("Gemini error:", res.status, (await res.text()).slice(0, 300));
      return null;
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
    return text || null;
  } catch (err) {
    console.error("Gemini error:", err.message);
    return null;
  }
}

export function fallbackReply(rand) {
  return pick(FALLBACK_REPLIES, rand);
}
