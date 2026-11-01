import { LoginRequiredError, CaptchaError, ensureLoggedIn, launch, saveSession } from "./crowdworks.js";
import { acceptContract, listThreads, readThread, sendMessage } from "./inbox.js";
import {
  canAutoAcceptContract,
  checkOutgoing,
  hashText,
  incomingRedFlags,
  normalizeThreadText,
  parseContractAmount,
} from "./guards.js";
import { contractMessage, flushNotifyQueue, notify, notifyImportant } from "./notify.js";
import { log as defaultLog, randomDelay } from "./util.js";
import { CircuitBreaker, HaltedError, assertCanAct, audit, isStopped, stopReason } from "./safety.js";

/**
 * 応募後のコミュニケーションを 1 巡処理する:
 * 一覧からスレッドを集める → 変化があったスレッドだけ Claude に判断させる →
 * 安全チェックを通ったものだけ返信 / 契約承諾 → それ以外は本人へエスカレーション
 */
export async function runInbox(config, { store, agent, dryRun = config.dryRun, log = defaultLog, deps = {} } = {}) {
  const cw = { launch, ensureLoggedIn, saveSession, listThreads, readThread, sendMessage, acceptContract, randomDelay, ...deps };
  const { negotiation, inbox, selectors, limits } = config;
  const summary = { threads: 0, changed: 0, replied: 0, contracted: 0, escalated: 0, waited: 0, dryRun };
  store.reload();
  // 前回送れなかった受注通知などを再送（停止中でも通知は送る）
  const flushed = await (deps.flushNotifyQueue ?? flushNotifyQueue)().catch(() => ({ sent: 0 }));
  if (flushed.sent) log(`未送信だった通知を ${flushed.sent} 件再送しました`);
  if (isStopped()) { log(`停止中のためメッセージ対応をスキップ: ${stopReason()}`); return { ...summary, aborted: "stopped" }; }
  const breaker = deps.breaker ?? new CircuitBreaker(config.safety.circuitBreakerThreshold);
  const outgoingOpts = (floorYen) => ({ allowPatterns: config.safety.allowPatterns, maxChars: negotiation.maxMessageChars, floorYen });

  const { browser, context, page } = await cw.launch(config.browser);
  try {
    await cw.ensureLoggedIn(page, selectors);

    const unmanaged = [];
    const urls = new Set(await cw.listThreads(page, inbox));
    for (const t of Object.values(store.state.threads)) if (["active", "needs_human"].includes(t.status)) urls.add(t.url);
    summary.threads = urls.size;
    const confirmedRe = new RegExp(selectors.contractConfirmedText);

    /** 受注を記録して Slack に通知（自動承諾・手動承諾の両方） */
    const markContracted = async ({ url, jobId, job, amountYen, source, kickoffSent = false }) => {
      summary.contracted++;
      store.upsertThread(url, { jobId, status: "contracted", contractedAt: new Date().toISOString(), contractAmountYen: amountYen, contractSource: source });
      if (jobId) store.upsert(jobId, { status: "contracted", contractAmountYen: amountYen, contractSource: source });
      log(`🎉 受注 (${source === "manual" ? "手動承諾" : "自動承諾"}) ${amountYen ?? "?"}円 ${job?.title ?? url}`);
      const n = await notifyImportant(contractMessage({
        title: job?.title, jobUrl: job?.url, threadUrl: url, amountYen, proposedYen: job?.amountYen, contractType: job?.contractType, source, kickoffSent,
      }));
      audit("notify.contract", { url, jobId, ok: n.ok, error: n.ok ? undefined : n.error });
    };

    for (const url of urls) {
      const rec = store.thread(url);
      if (rec && ["contracted", "closed", "unmanaged"].includes(rec.status)) continue;

      // 本人対応中のスレッドは読むだけ: 本人が契約を承諾していたら受注として通知する（送信はしない）
      if (rec?.status === "needs_human") {
        try {
          const th = await cw.readThread(page, url, selectors);
          if (confirmedRe.test(th.text) && !th.contractOffer) {
            await markContracted({ url, jobId: rec.jobId, job: rec.jobId ? store.get(rec.jobId) : null, amountYen: parseContractAmount(th.text), source: "manual" });
          }
        } catch (e) {
          if (e instanceof LoginRequiredError || e instanceof CaptchaError) throw e;
        }
        continue;
      }

      let th;
      try {
        th = await cw.readThread(page, url, selectors);
      } catch (e) {
        if (e instanceof LoginRequiredError || e instanceof CaptchaError) throw e;
        log(`スレッド取得失敗 ${url}: ${e.message}`);
        continue;
      }
      const hash = hashText(normalizeThreadText(th.text));
      if (rec?.lastHash === hash && !th.contractOffer) continue;
      summary.changed++;

      // スレッドと応募記録の対応付け: 応募時に記録した URL か、ページ内リンク＋タイトル一致で確定させる
      const jobId = rec?.jobId ?? th.jobIds.find((id) => {
        const j = store.get(id);
        return j && ["applied", "contracted"].includes(j.status) && j.title && th.text.includes(j.title.slice(0, 20));
      }) ?? null;
      const job = jobId ? store.get(jobId) : null;
      // 自分の応募と紐づかないスレッド（スカウト等）は本人に回す
      if (!job && !inbox.handleUnknownThreads) {
        // 手動で応募した過去案件やスカウトには触らない（まとめて 1 通だけ通知）
        store.upsertThread(url, { jobId, lastHash: hash, status: "unmanaged" });
        unmanaged.push(url);
        continue;
      }

      // 本人が CrowdWorks 上で直接承諾した契約を検知
      if (confirmedRe.test(th.text) && !th.contractOffer) {
        store.upsertThread(url, { jobId, lastHash: hash });
        await markContracted({ url, jobId, job, amountYen: parseContractAmount(th.text), source: "manual" });
        continue;
      }

      const proposedYen = job?.amountYen ?? null;
      const floorYen = proposedYen ? Math.floor(proposedYen * negotiation.minAcceptRatio) : null;
      const parsedContractYen = parseContractAmount(th.text);
      const redFlags = incomingRedFlags(th.text);

      let d;
      try {
        d = await agent.decide({
          job, proposal: job?.evaluation?.proposal, proposedYen, floorYen,
          threadText: th.text, contractOffer: th.contractOffer, parsedContractYen, sentHistory: rec?.sent,
        });
      } catch (e) {
        log(`! AI判断エラー ${url}: ${e.message}`);
        continue; // ハッシュを更新しないので次回再試行
      }

      const escalate = async (why) => {
        summary.escalated++;
        audit("thread.escalate", { url, jobId, why });
        store.upsertThread(url, { jobId, lastHash: hash, status: "needs_human", escalation: why, suggestedReply: d.message });
        log(`🙋 要対応 ${job?.title ?? url}: ${why}`);
        await notify(`🙋 CrowdWorks: 本人の対応が必要です\n${job?.title ?? ""}\n${url}\n理由: ${why}` +
          (d.message ? `\n--- 返信案 ---\n${d.message}` : "") + `\n対応後: npm run resume -- "${url}"`);
      };

      // クライアント側の危険シグナルは LLM の判断に関わらず人へ
      if (redFlags.length && d.action !== "wait") { await escalate(`危険シグナル: ${redFlags.join(", ")}`); continue; }

      if (d.action === "wait") {
        summary.waited++;
        store.upsertThread(url, { jobId, lastHash: hash });
        continue;
      }
      if (d.action === "escalate") { await escalate(d.reason); continue; }

      if (d.action === "accept_contract") {
        if (!th.contractOffer) { await escalate(`AI は契約承諾と判断したが承諾ボタンが見つからない: ${d.reason}`); continue; }
        // 金額は LLM の読み取りではなく、画面からコードで読んだ値だけを信用する
        const amountYen = parsedContractYen;
        if (d.contractAmountYen && amountYen && d.contractAmountYen !== amountYen) {
          await escalate(`契約金額の読み取りが不一致 (画面 ${amountYen}円 / AI ${d.contractAmountYen}円)`); continue;
        }
        const can = canAutoAcceptContract({ amountYen, proposedYen, contractType: job?.contractType }, negotiation, config.filters);
        if (!can.ok) { await escalate(`契約の自動承諾条件を満たさない: ${can.reasons.join(", ")}`); continue; }
        if (dryRun) {
          log(`[dry-run] 契約承諾予定 ${amountYen}円 ${job?.title ?? url}`);
          store.upsertThread(url, { jobId, lastHash: hash, dryRunDecision: d });
          continue;
        }
        assertCanAct();
        audit("contract.accept.attempt", { url, jobId, amountYen, reason: d.reason });
        const r = await cw.acceptContract(page, selectors);
        audit("contract.accept.result", { url, jobId, ok: r.ok, message: r.message });
        if (!r.ok) { await escalate(r.message); await breaker.failure(r.message); continue; }
        breaker.success();
        // 契約は成立したので、通知より先に状態を保存（以降の処理で落ちても二重承諾しない）
        store.upsertThread(url, { jobId, status: "contracted", contractedAt: new Date().toISOString(), contractAmountYen: amountYen });
        // 着手の挨拶（失敗しても契約自体は成立しているので通知だけ）
        let kickoffSent = false;
        if (d.message && checkOutgoing(d.message, outgoingOpts(amountYen)).ok) {
          await cw.readThread(page, url, selectors).catch(() => {});
          assertCanAct();
          const s = await cw.sendMessage(page, d.message, selectors).catch((e) => ({ ok: false, message: e.message }));
          audit("message.send", { url, jobId, ok: s.ok, kind: "kickoff", text: d.message });
          if (s.ok) { store.recordReply(url, d.message); kickoffSent = true; }
          else await notify(`⚠ 受注後の挨拶メッセージ送信に失敗: ${s.message}\n${url}`);
        }
        await markContracted({ url, jobId, job, amountYen, source: "auto", kickoffSent });
        await cw.saveSession(context);
        continue;
      }

      // reply
      const check = checkOutgoing(d.message, outgoingOpts(floorYen));
      if (!check.ok) { await escalate(`返信案が安全チェックに不合格: ${check.violations.join(", ")}`); continue; }
      if (store.threadRepliesToday(url) >= negotiation.maxRepliesPerThreadPerDay) { await escalate("このスレッドの本日の自動返信上限に到達"); continue; }
      if ((rec?.sent?.length ?? 0) >= negotiation.maxAutoMessagesPerThread) { await escalate(`自動返信の総数上限 (${negotiation.maxAutoMessagesPerThread}通) に到達。交渉が長引いているため本人確認`); continue; }
      const last = rec?.lastRepliedAt ? Date.parse(rec.lastRepliedAt) : 0;
      if (Date.now() - last < negotiation.minMinutesBetweenReplies * 60_000) { log(`クールダウン中 ${url}`); continue; }
      if (store.repliesToday() >= negotiation.maxRepliesPerDay) { log("本日の自動返信上限に到達"); break; }
      if (dryRun) {
        log(`[dry-run] 返信予定 ${job?.title ?? url}:\n${d.message}`);
        store.upsertThread(url, { jobId, lastHash: hash, dryRunDecision: d });
        continue;
      }
      assertCanAct();
      const s = await cw.sendMessage(page, d.message, selectors);
      audit("message.send", { url, jobId, ok: s.ok, kind: "reply", reason: d.reason, text: d.message, error: s.ok ? undefined : s.message });
      if (!s.ok) { await escalate(`送信失敗: ${s.message}`); await breaker.failure(s.message); continue; }
      breaker.success();
      summary.replied++;
      store.recordReply(url, d.message);
      // 自分の返信で変わった後の状態を記録し、次回の無駄な判断を避ける
      const after = await cw.readThread(page, url, selectors).catch(() => null);
      store.upsertThread(url, { jobId, lastHash: after ? hashText(normalizeThreadText(after.text)) : hash });
      log(`✉ 返信 ${job?.title ?? url}`);
      await notify(`✉ CrowdWorks 自動返信\n${job?.title ?? ""}\n${url}\n---\n${d.message}`);
      await cw.randomDelay(limits.delayBetweenPagesSec);
    }
    if (unmanaged.length) await notify(`ℹ CrowdWorks: ボットの応募記録にないスレッド ${unmanaged.length} 件は自動対応の対象外です（手動応募・スカウト等）\n${unmanaged.slice(0, 10).join("\n")}`);
  } catch (e) {
    if (e instanceof HaltedError) {
      log(`停止: ${e.message}`);
      summary.aborted = e.message;
    } else if (e instanceof LoginRequiredError || e instanceof CaptchaError) {
      log(`中断: ${e.message}`);
      await notify(`⚠ CrowdWorks メッセージ対応を中断: ${e.message}`);
      summary.aborted = e.message;
    } else throw e;
  } finally {
    await browser.close().catch(() => {});
  }
  log(`メッセージ対応結果: ${JSON.stringify(summary)}`);
  return summary;
}
