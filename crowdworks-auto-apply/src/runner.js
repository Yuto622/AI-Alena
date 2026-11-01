import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config.js";
import {
  CaptchaError,
  LoginRequiredError,
  ensureLoggedIn,
  getJobDetail,
  launch,
  saveSession,
  searchJobs,
  submitProposal,
} from "./crowdworks.js";
import { clampAmount, ruleFilter } from "./filter.js";
import { notify } from "./notify.js";
import { log as defaultLog, randomDelay } from "./util.js";
import { checkOutgoing } from "./guards.js";
import { CircuitBreaker, HaltedError, assertCanAct, audit, isStopped, stopReason } from "./safety.js";

const DRAFT_DIR = path.join(DATA_DIR, "drafts");

function writeDraft(job, ev, amountYen) {
  fs.mkdirSync(DRAFT_DIR, { recursive: true });
  const file = path.join(DRAFT_DIR, `${job.id}.md`);
  fs.writeFileSync(
    file,
    `# ${job.title}\n\n- URL: ${job.url}\n- スコア: ${ev.score}\n- 理由: ${ev.reason}\n- 懸念: ${ev.risks.join(" / ") || "なし"}\n` +
      `- 提示額: ${amountYen}円 / 納期目安: ${ev.deliveryDays}日\n\n## 提案文\n\n${ev.proposal}\n`,
  );
  return file;
}

/**
 * 1 回分の巡回: 検索 → 詳細取得 → ルールフィルタ → Claude 審査 → 応募（or 下書き）
 * deps は テスト用に差し替え可能
 */
export async function runOnce(config, { store, evaluator, dryRun = config.dryRun, log = defaultLog, deps = {} } = {}) {
  const cw = { launch, ensureLoggedIn, searchJobs, getJobDetail, submitProposal, saveSession, randomDelay, ...deps };
  const summary = { found: 0, filtered: 0, rejected: 0, drafted: 0, applied: 0, failed: 0, dryRun };
  const { limits, mode } = config;

  store.reload();
  if (isStopped()) { log(`停止中のため巡回をスキップ: ${stopReason()}`); return { ...summary, aborted: "stopped" }; }
  const breaker = deps.breaker ?? new CircuitBreaker(config.safety.circuitBreakerThreshold);

  const remainingToday = () => limits.maxApplicationsPerDay - store.appliedToday();
  if (mode === "auto" && !dryRun && remainingToday() <= 0) {
    log(`本日の応募上限 (${limits.maxApplicationsPerDay}) に達しているためスキップ`);
    return summary;
  }

  const { browser, context, page } = await cw.launch(config.browser);
  try {
    await cw.ensureLoggedIn(page, config.selectors);

    // 1) 候補収集
    const sources = [...(config.search.searchUrls ?? []), ...(config.search.keywords ?? [])];
    const candidates = new Map();
    for (const src of sources) {
      const jobs = await cw.searchJobs(page, src, config.search.pagesPerQuery ?? 1);
      log(`検索「${src}」: ${jobs.length}件`);
      for (const j of jobs) if (!store.isDone(j.id) && !candidates.has(j.id)) candidates.set(j.id, j);
      await cw.randomDelay(limits.delayBetweenPagesSec);
    }
    summary.found = candidates.size;
    log(`未処理の候補: ${candidates.size}件`);

    // 2) 審査 → 応募
    let appliedThisRun = 0;
    for (const cand of candidates.values()) {
      if (mode === "auto" && !dryRun) {
        if (appliedThisRun >= limits.maxApplicationsPerRun) { log("今回の応募上限に到達"); break; }
        if (remainingToday() <= 0) { log("本日の応募上限に到達"); break; }
      }

      let job;
      try {
        job = await cw.getJobDetail(page, cand);
      } catch (e) {
        log(`詳細取得失敗 ${cand.id}: ${e.message}`);
        continue;
      }
      await cw.randomDelay(limits.delayBetweenPagesSec);

      const rule = ruleFilter(job, config.filters);
      if (!rule.ok) {
        summary.filtered++;
        store.upsert(job.id, { status: "filtered", title: job.title, url: job.url, reasons: rule.reasons });
        log(`× ${job.title} — ${rule.reasons.join(", ")}`);
        continue;
      }

      // dry-run 時に保存した審査結果があれば再利用して API コストを節約
      let ev = store.get(job.id)?.evaluation;
      if (!ev) {
        try {
          ev = await evaluator.evaluate(job);
        } catch (e) {
          summary.failed++;
          store.upsert(job.id, { status: "failed", title: job.title, url: job.url, error: `AI審査: ${e.message}` });
          log(`! AI審査エラー ${job.title}: ${e.message}`);
          continue;
        }
      }

      if (!ev.apply || ev.score < config.ai.minScore) {
        summary.rejected++;
        store.upsert(job.id, { status: "rejected", title: job.title, url: job.url, score: ev.score, reason: ev.reason, risks: ev.risks });
        log(`△ ${job.title} — score ${ev.score}: ${ev.reason}`);
        continue;
      }

      const amountYen = clampAmount(ev.amountYen, job);
      // 提案文も送信前にコードで安全チェック（連絡先・無償の約束などを含むものは送らない）
      const pc = checkOutgoing(ev.proposal, { allowPatterns: config.safety.allowPatterns, maxChars: config.ai.maxProposalChars * 1.2 });
      if (!pc.ok) {
        summary.rejected++;
        store.upsert(job.id, { status: "blocked", title: job.title, url: job.url, score: ev.score, reason: `提案文が安全チェック不合格: ${pc.violations.join(", ")}`, evaluation: ev });
        log(`⛔ ${job.title} — 提案文が安全チェック不合格: ${pc.violations.join(", ")}`);
        continue;
      }
      const base = { title: job.title, url: job.url, contractType: job.contractType, score: ev.score, reason: ev.reason, evaluation: ev, amountYen };

      if (mode === "draft") {
        const file = writeDraft(job, ev, amountYen);
        summary.drafted++;
        store.upsert(job.id, { ...base, status: "drafted", draftFile: file });
        log(`✎ 下書き保存 (score ${ev.score}) ${job.title} → ${file}`);
        await notify(`✎ 応募下書き (score ${ev.score}) ${job.title}\n${job.url}\n承認: npm run apply -- ${job.id}`);
        continue;
      }

      if (!dryRun) assertCanAct();
      const result = await cw.submitProposal(page, job, ev, config.selectors, { dryRun, amountYen });
      if (!dryRun) audit("proposal.submit", { jobId: job.id, title: job.title, amountYen, score: ev.score, ok: result.ok, message: result.message, text: ev.proposal });
      if (result.ok && result.dryRun) {
        store.upsert(job.id, { ...base, status: "dryrun", screenshots: result.screenshots });
        log(`◎ [dry-run] score ${ev.score} ${amountYen}円 ${job.title}`);
        continue;
      }
      if (result.ok) {
        appliedThisRun++;
        summary.applied++;
        breaker.success();
        store.recordApplication(job.id, { ...base, screenshots: result.screenshots, threadUrl: result.threadUrl });
        if (result.threadUrl) store.upsertThread(result.threadUrl, { jobId: job.id });
        log(`✔ 応募完了 (score ${ev.score}, ${amountYen}円) ${job.title}`);
        await notify(`✔ CrowdWorks 自動応募 (score ${ev.score}, ${amountYen}円)\n${job.title}\n${job.url}`);
        await cw.saveSession(context);
        await cw.randomDelay(limits.delayBetweenApplicationsSec, log);
      } else {
        summary.failed++;
        store.upsert(job.id, { ...base, status: "failed", error: result.message, screenshots: result.screenshots });
        log(`! 応募失敗 ${job.title}: ${result.message}`);
        if (!/既に応募済み|募集終了/.test(result.message)) await breaker.failure(result.message);
      }
    }
  } catch (e) {
    if (e instanceof HaltedError) {
      log(`停止: ${e.message}`);
      summary.aborted = e.message;
    } else if (e instanceof LoginRequiredError || e instanceof CaptchaError) {
      log(`中断: ${e.message}`);
      await notify(`⚠ CrowdWorks 自動応募を中断: ${e.message}`);
      summary.aborted = e.message;
    } else {
      throw e;
    }
  } finally {
    await browser.close().catch(() => {});
  }

  log(`結果: ${JSON.stringify(summary)}`);
  return summary;
}

/** draft モードで保存した下書きを指定して応募する */
export async function applyDraft(config, jobId, { store, dryRun = false, log = defaultLog } = {}) {
  const rec = store.get(jobId);
  if (!rec?.evaluation) throw new Error(`案件 ${jobId} の下書きがありません`);
  if (rec.status === "applied") throw new Error(`案件 ${jobId} は応募済みです`);
  if (!dryRun && store.appliedToday() >= config.limits.maxApplicationsPerDay) throw new Error("本日の応募上限に達しています");

  const { browser, context, page } = await launch(config.browser);
  try {
    await ensureLoggedIn(page, config.selectors);
    const job = await getJobDetail(page, { id: jobId, url: rec.url, title: rec.title });
    if (!dryRun) assertCanAct();
    const result = await submitProposal(page, job, rec.evaluation, config.selectors, { dryRun, amountYen: rec.amountYen });
    if (!dryRun) audit("proposal.submit", { jobId, title: rec.title, amountYen: rec.amountYen, ok: result.ok, message: result.message, approved: true });
    if (result.ok && !result.dryRun) {
      store.recordApplication(jobId, { screenshots: result.screenshots });
      await saveSession(context);
      await notify(`✔ CrowdWorks 応募 (承認済み下書き)\n${rec.title}\n${rec.url}`);
    } else if (!result.ok) {
      store.upsert(jobId, { error: result.message, screenshots: result.screenshots });
    }
    log(`${rec.title}: ${result.message}`);
    return result;
  } finally {
    await browser.close().catch(() => {});
  }
}
