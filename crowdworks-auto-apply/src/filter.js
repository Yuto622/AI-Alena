/**
 * ルールベースの一次フィルタ。LLM に送る前に明らかに対象外の案件を落とし、API コストを抑える。
 * job: {id, title, description, contractType, budgetMin, budgetMax, hourlyMin, hourlyMax,
 *       applicants, clientRating, clientVerified, expired, alreadyApplied}
 * 戻り値: { ok: boolean, reasons: string[] }
 */
export function ruleFilter(job, filters) {
  const reasons = [];
  const text = `${job.title ?? ""}\n${job.description ?? ""}`;
  const lower = text.toLowerCase();

  if (job.expired) reasons.push("募集終了");
  if (job.alreadyApplied) reasons.push("応募済み");

  if (filters.contractTypes?.length && job.contractType && !filters.contractTypes.includes(job.contractType)) {
    reasons.push(`契約形式が対象外 (${job.contractType})`);
  }

  const hit = (filters.excludeKeywords ?? []).find((k) => lower.includes(k.toLowerCase()));
  if (hit) reasons.push(`除外キーワード「${hit}」`);

  if (filters.includeKeywords?.length && !filters.includeKeywords.some((k) => lower.includes(k.toLowerCase()))) {
    reasons.push("必須キーワードを含まない");
  }

  if (job.contractType === "fixed_price") {
    const top = job.budgetMax ?? job.budgetMin;
    if (top == null) {
      if (filters.skipIfNoBudget) reasons.push("予算未記載");
    } else if (filters.minBudgetYen && top < filters.minBudgetYen) {
      reasons.push(`予算不足 (${top}円 < ${filters.minBudgetYen}円)`);
    }
  }

  if (job.contractType === "hourly") {
    const top = job.hourlyMax ?? job.hourlyMin;
    if (top != null && filters.minHourlyYen && top < filters.minHourlyYen) {
      reasons.push(`時給不足 (${top}円 < ${filters.minHourlyYen}円)`);
    }
  }

  if (filters.maxApplicants != null && job.applicants != null && job.applicants > filters.maxApplicants) {
    reasons.push(`応募者過多 (${job.applicants}人)`);
  }

  if (filters.minClientRating && job.clientRating != null && job.clientRating < filters.minClientRating) {
    reasons.push(`クライアント評価が低い (${job.clientRating})`);
  }

  if (filters.requireIdentityVerifiedClient && job.clientVerified === false) {
    reasons.push("クライアント本人確認なし");
  }

  return { ok: reasons.length === 0, reasons };
}

/** "5,000円 〜 10,000円" や "〜 50,000 円" から [min, max] を取り出す */
export function parseYenRange(text) {
  if (!text) return [null, null];
  const nums = [...String(text).replace(/[,，]/g, "").matchAll(/(\d+(?:\.\d+)?)\s*(万)?\s*円?/g)]
    .map((m) => Math.round(Number(m[1]) * (m[2] ? 10000 : 1)))
    .filter((n) => n >= 100);
  if (!nums.length) return [null, null];
  if (nums.length === 1) return /^\s*[〜~]/.test(text) ? [null, nums[0]] : [nums[0], nums[0]];
  return [Math.min(...nums), Math.max(...nums)];
}

/** 提示金額を決める: LLM の提案額を予算レンジ内に丸める */
export function clampAmount(amount, job) {
  const [lo, hi] =
    job.contractType === "hourly" ? [job.hourlyMin, job.hourlyMax] : [job.budgetMin, job.budgetMax];
  let a = Math.round(Number(amount) || 0);
  if (!a) a = hi ?? lo ?? 0;
  if (hi != null && a > hi) a = hi;
  if (lo != null && a < lo) a = lo;
  return Math.max(0, Math.round(a / 100) * 100);
}
