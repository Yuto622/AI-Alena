/**
 * 自動コミュニケーションの安全装置（純粋関数）。
 * LLM の判断をそのまま信用せず、送信・契約の前に必ずコード側でチェックする。
 */

/** 送信メッセージの禁止パターン（契約前の直接連絡先交換は CrowdWorks の規約で禁止） */
const OUTGOING_BLOCK = [
  [/https?:\/\/\S+/i, "URL"],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/, "メールアドレス"],
  [/(?<![\d,])0\d{1,4}[-ー(（]\d{1,4}[-ー)）]\d{3,4}(?!\d)|(?<![\d,])0\d{9,10}(?![\d,])/, "電話番号"],
  [/LINE\s*(ID|id|@)|line\.me|@[a-z0-9_]{4,}/i, "LINE などの外部ID"],
  [/chatwork|slack|discord|skype|telegram|whatsapp|zoom\.us/i, "外部ツールのアカウント"],
  [/振込先|口座番号|銀行口座/, "口座情報"],
  [/【要確認】|要確認/, "未記入のプロフィール項目（【要確認】）"],
];

/** 本人の同意なしに約束してはいけない表現 */
const OUTGOING_COMMITMENT = [
  [/無料|無償|タダで|(?<![\d,，])0円/, "無償対応の約束"],
  [/(返金|全額返金)いたします|返金します/, "返金の約束"],
  [/(本日|今日|明日)中に(納品|完成|仕上げ)/, "極端な短納期の約束"],
  [/(お電話|通話|Zoom|ズーム|Meet|対面|お会い)/i, "通話・対面の約束"],
  [/(NDA|秘密保持契約).{0,10}(締結|署名|サイン)いたします/, "契約書類への同意"],
];

/**
 * 送信メッセージの安全チェック
 * @param {object} opts allowPatterns: 許可する文字列の正規表現（ポートフォリオURL等）, floorYen: 値下げ下限
 */
export function checkOutgoing(text, { allowPatterns = [], maxChars = 1500, floorYen = null, checkCommitments = true } = {}) {
  const violations = [];
  if (!text || !text.trim()) violations.push("本文が空");
  if (text && text.length > maxChars) violations.push(`長すぎる (${text.length}文字)`);
  let scrubbed = text ?? "";
  for (const p of allowPatterns) scrubbed = scrubbed.replace(new RegExp(p, "g"), "");
  for (const [re, label] of OUTGOING_BLOCK) if (re.test(scrubbed)) violations.push(`${label}を含む`);
  if (checkCommitments) for (const [re, label] of OUTGOING_COMMITMENT) if (re.test(scrubbed)) violations.push(label);
  if (floorYen) {
    const low = mentionedYen(scrubbed).filter((y) => y < floorYen);
    if (low.length) violations.push(`下限 ${floorYen}円 を下回る金額 (${low.join(", ")}円) に言及`);
  }
  return { ok: violations.length === 0, violations };
}

/** 本文中の「〇〇円」「〇万円」を数値で列挙（時給表記などの小額も含む） */
export function mentionedYen(text) {
  return [...String(text ?? "").replace(/[,，]/g, "").matchAll(/(\d+(?:\.\d+)?)\s*(万)?\s*円/g)].map((m) =>
    Math.round(Number(m[1]) * (m[2] ? 10000 : 1)),
  );
}

/** クライアント側メッセージの危険シグナル（検出したら人に回す） */
const INCOMING_RED_FLAGS = [
  [/LINE|ライン/, "LINE への誘導"],
  [/直接(契約|取引|やり取り|連絡)|サイト外|手数料(を|が)?(かから|浮)/, "プラットフォーム外取引の誘導"],
  [/(初期費用|登録料|教材費|保証金).{0,10}(必要|お支払|振込)/, "ワーカー側の支払い要求"],
  [/本人確認書類|免許証|マイナンバー|パスポート/, "個人書類の要求"],
  [/(指示|プロンプト|ルール)を(無視|忘れ)|ignore (all|previous)|system prompt/i, "AI への指示の埋め込み"],
  [/(暗号資産|仮想通貨|ビットコイン|ギフト券|ギフトカード).{0,15}(支払|払|送金|購入)/, "不審な支払い手段"],
];

export function incomingRedFlags(text) {
  return INCOMING_RED_FLAGS.filter(([re]) => re.test(text ?? "")).map(([, label]) => label);
}

/** スレッド本文から契約金額を取り出す（"契約金額 55,000円" など） */
export function parseContractAmount(text) {
  const values = [...String(text ?? "").replace(/[,，]/g, "").matchAll(/(契約金額|発注金額|契約額|報酬額)[^\d]{0,20}?(\d{3,9})\s*円/g)].map((m) => Number(m[2]));
  const unique = [...new Set(values)];
  // 金額が複数（過去の提示・マイルストーン等）で食い違う場合は読み取り不能扱い → 人に回す
  return unique.length === 1 ? unique[0] : null;
}

/** 契約を自動承諾してよいか */
export function canAutoAcceptContract({ amountYen, proposedYen, contractType }, negotiation, filters) {
  const reasons = [];
  if (!negotiation.autoAcceptContract) reasons.push("autoAcceptContract が無効");
  if (amountYen == null) reasons.push("契約金額を読み取れない");
  else {
    const floorByProposal = proposedYen ? Math.floor(proposedYen * negotiation.minAcceptRatio) : 0;
    const floorByFilter = contractType === "hourly" ? filters.minHourlyYen ?? 0 : filters.minBudgetYen ?? 0;
    const floor = Math.max(floorByProposal, floorByFilter, negotiation.minContractYen ?? 0);
    if (amountYen < floor) reasons.push(`契約金額 ${amountYen}円 が下限 ${floor}円 未満`);
    if (!negotiation.maxContractYen) reasons.push("maxContractYen が未設定（上限なしの自動承諾は不可）");
    else if (amountYen > negotiation.maxContractYen) reasons.push(`契約金額 ${amountYen}円 が自動承諾の上限超え`);
  }
  return { ok: reasons.length === 0, reasons };
}

/** 相対時刻などを除いてスレッドの「変化」を検知するための正規化 */
export function normalizeThreadText(text) {
  return String(text ?? "")
    .replace(/\d+\s*(秒|分|時間|日|週間|か月|ヶ月)前/g, "")
    .replace(/\d{1,2}:\d{2}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function hashText(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16);
}
