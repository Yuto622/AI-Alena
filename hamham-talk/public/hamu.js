/** ふつうの文を「はむ語」にする（文末に「はむ」をつける） */
export function toHamu(text) {
  return text
    .split("\n")
    .map((line) =>
      line.replace(/([^。！？!?〜ー…\s]+)([。！？!?〜ー…]*)(\s*)/gu, (m, body, punct, space) => {
        // 絵文字だけ・すでに「はむ」で終わる文はそのまま
        if (!/[\p{L}\p{N}]/u.test(body)) return m;
        const tail = body.match(/[^\p{L}\p{N}]+$/u)?.[0] ?? "";
        const core = tail ? body.slice(0, -tail.length) : body;
        if (/(はむ|ハム)$/.test(core)) return m;
        return `${core}はむ${tail}${punct}${space}`;
      })
    )
    .join("\n");
}

/** 記念日から今日が何日目か（当日 = 1日目、端末のローカル日付） */
export function daysTogether(anniversary, now = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(anniversary ?? "");
  if (!m) return null;
  const start = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.floor((today - start) / 86400000) + 1;
  return days >= 1 ? days : null;
}
