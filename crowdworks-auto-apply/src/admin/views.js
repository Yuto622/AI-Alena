/** 管理画面の HTML。外部由来の文字列（案件名・メッセージ等）は必ず h() でエスケープする */

export function h(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** CrowdWorks の URL だけリンクにする（javascript: 等を防ぐ） */
export function cwLink(url, text) {
  const ok = /^https:\/\/crowdworks\.jp\//.test(String(url ?? ""));
  return ok ? `<a href="${h(url)}" target="_blank" rel="noopener noreferrer">${h(text ?? url)}</a>` : h(text ?? url ?? "");
}

export function jst(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const STATUS_LABEL = {
  applied: ["応募済み", "ok"], contracted: ["受注", "win"], drafted: ["下書き", "info"], dryrun: ["テスト済み", "info"],
  rejected: ["見送り(AI)", "muted"], filtered: ["除外(条件)", "muted"], blocked: ["ブロック", "warn"], failed: ["失敗", "bad"],
  active: ["自動対応中", "ok"], needs_human: ["要対応", "bad"], unmanaged: ["対象外", "muted"], closed: ["終了", "muted"],
};
export function badge(status) {
  const [label, cls] = STATUS_LABEL[status] ?? [status ?? "—", "muted"];
  return `<span class="badge ${cls}">${h(label)}</span>`;
}

const csrfInput = (csrf) => `<input type="hidden" name="csrf" value="${h(csrf)}">`;

export function postButton(action, label, csrf, { cls = "", fields = {}, confirm = "" } = {}) {
  const hidden = Object.entries(fields).map(([k, v]) => `<input type="hidden" name="${h(k)}" value="${h(v)}">`).join("");
  return `<form method="post" action="${h(action)}" class="inline"${confirm ? ` data-confirm="${h(confirm)}"` : ""}>${csrfInput(csrf)}${hidden}<button class="${h(cls)}">${h(label)}</button></form>`;
}

export function layout({ title, body, csrf, flash, nav = true, active = "" }) {
  const item = (href, label) => `<a href="${href}" class="${active === href ? "on" : ""}">${label}</a>`;
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${h(title)} | CW Bot 管理画面</title><link rel="stylesheet" href="/static/style.css"><script src="/static/app.js" defer></script></head>
<body><header><div class="brand"><span class="mark">U</span>CrowdWorks Bot <small>U-Speak Lab</small></div>
${nav ? `<nav>${item("/", "ダッシュボード")}${item("/threads", "メッセージ")}${item("/jobs", "案件")}${item("/audit", "送信履歴")}${item("/logs", "ログ")}${item("/settings", "設定")}${item("/session", "ログイン情報")}
<form method="post" action="/logout" class="inline">${csrfInput(csrf)}<button class="link">ログアウト</button></form></nav>` : ""}
</header><main>${flash ? `<div class="flash">${h(flash)}</div>` : ""}${body}</main></body></html>`;
}

export function loginPage({ error, locked }) {
  return layout({
    title: "ログイン", nav: false,
    body: `<section class="card narrow"><h1>管理画面ログイン</h1>
${locked ? `<p class="err">ログイン失敗が続いたため 15 分間ロックしています。</p>` : error ? `<p class="err">パスワードが違います。</p>` : ""}
<form method="post" action="/login"><label>パスワード<input type="password" name="password" autocomplete="current-password" required autofocus></label><button class="primary">ログイン</button></form></section>`,
  });
}

function tile(label, value, sub = "", cls = "") {
  return `<div class="tile ${cls}"><div class="tl">${h(label)}</div><div class="tv">${h(value)}</div><div class="ts">${h(sub)}</div></div>`;
}

function summaryText(r) {
  if (!r) return "まだ実行していません";
  if (r.error) return `${jst(r.at)} エラー: ${r.error}`;
  const s = r.summary ?? {};
  const parts = Object.entries(s).filter(([k, v]) => typeof v === "number" && v > 0).map(([k, v]) => `${k}:${v}`);
  return `${jst(r.at)}${r.manual ? "（手動）" : ""} ${s.aborted ? `中断: ${s.aborted}` : parts.join(" ") || "変化なし"}`;
}

export function dashboardPage({ status, stats, config, needsHuman, contracted, session, csrf, flash }) {
  const banner = status.stopped
    ? `<div class="banner bad"><b>停止中</b> — ${h(status.stopReason)}<div>${postButton("/actions/unhalt", "停止を解除して再開", csrf, { cls: "primary", confirm: "自動運用を再開しますか？" })}</div></div>`
    : status.configError
      ? `<div class="banner bad"><b>設定エラー</b> — ${h(status.configError)}</div>`
      : `<div class="banner ${status.busy ? "info" : "ok"}"><b>${status.busy ? `実行中: ${h(status.busy)}` : status.inActiveHours ? "稼働中（待機）" : "稼働時間外（待機）"}</b>
         — ${status.dryRun ? '<span class="badge info">テストモード（送信しない）</span>' : '<span class="badge win">本番送信</span>'}
         稼働 ${h(status.activeHours?.join("〜"))}時 / 次回 応募 ${jst(status.nextApply)}・メッセージ ${jst(status.nextInbox)}</div>`;

  const nh = needsHuman.length
    ? `<table><tr><th>案件</th><th>理由</th><th>返信案</th><th></th></tr>${needsHuman.map((t) => `<tr>
        <td>${cwLink(t.url, t.title ?? t.url)}<div class="sub">${jst(t.updatedAt)}</div></td><td>${h(t.escalation)}</td>
        <td>${t.suggestedReply ? `<details><summary>表示</summary><pre>${h(t.suggestedReply)}</pre></details>` : "—"}</td>
        <td>${postButton("/threads/resume", "自動対応に戻す", csrf, { fields: { url: t.url }, confirm: "本人対応は済みましたか？自動対応に戻します" })}</td></tr>`).join("")}</table>`
    : `<p class="muted">本人の対応が必要なスレッドはありません。</p>`;

  return layout({
    title: "ダッシュボード", csrf, flash, active: "/",
    body: `${banner}
<section class="tiles">
${tile("本日の応募", `${stats.appliedToday} / ${config?.limits.maxApplicationsPerDay ?? "-"}`, "件")}
${tile("本日の返信", `${stats.repliesToday} / ${config?.negotiation.maxRepliesPerDay ?? "-"}`, "通")}
${tile("受注", stats.byStatus.contracted ?? 0, "件（累計）", "win")}
${tile("要対応", needsHuman.length, "スレッド", needsHuman.length ? "bad" : "")}
</section>
<section class="card"><h2>操作</h2><div class="actions">
${postButton("/actions/run", "今すぐメッセージ確認", csrf, { fields: { kind: "inbox" } })}
${postButton("/actions/run", "今すぐ応募巡回", csrf, { fields: { kind: "apply" } })}
<form method="post" action="/actions/stop" class="inline stop" data-confirm="すべての自動送信を停止します。よろしいですか？">${csrfInput(csrf)}
<input name="reason" placeholder="停止理由（任意）"><button class="danger">緊急停止</button></form></div>
<p class="sub">直近: メッセージ対応 ${h(summaryText(status.lastResults.inbox))}<br>直近: 応募巡回 ${h(summaryText(status.lastResults.apply))}</p></section>
<section class="card"><h2>要対応スレッド</h2>${nh}</section>
<section class="card"><h2>最近の受注</h2>${contracted.length ? `<ul>${contracted.map((j) => `<li>${cwLink(j.url, j.title)} — ${h((j.contractAmountYen ?? j.amountYen ?? 0).toLocaleString())}円 <span class="sub">${jst(j.updatedAt)}</span></li>`).join("")}</ul>` : '<p class="muted">まだありません。</p>'}</section>
<section class="card"><h2>CrowdWorks ログイン</h2>${session.exists ? `保存済み（更新 ${jst(session.mtime)}）` : '<span class="err">未登録です。「ログイン情報」から登録してください。</span>'}</section>`,
  });
}

export function threadsPage({ threads, filter, csrf, flash }) {
  const filters = ["", "needs_human", "active", "contracted", "unmanaged", "closed"];
  return layout({
    title: "メッセージ", csrf, flash, active: "/threads",
    body: `<section class="card"><h1>メッセージスレッド</h1><div class="filters">${filters.map((f) => `<a href="/threads${f ? `?status=${f}` : ""}" class="${filter === f ? "on" : ""}">${f ? badge(f) : "すべて"}</a>`).join("")}</div>
<table><tr><th>状態</th><th>案件</th><th>詳細</th><th>送信数</th><th>操作</th></tr>
${threads.map((t) => `<tr><td>${badge(t.status)}</td><td>${cwLink(t.url, t.title ?? t.url)}<div class="sub">${jst(t.updatedAt)}</div></td>
<td>${t.escalation ? `<div>${h(t.escalation)}</div>` : ""}${t.suggestedReply ? `<details><summary>返信案</summary><pre>${h(t.suggestedReply)}</pre></details>` : ""}
${(t.sent ?? []).length ? `<details><summary>ボットの送信 (${t.sent.length})</summary>${t.sent.map((s) => `<div class="sub">${jst(s.at)}</div><pre>${h(s.text)}</pre>`).join("")}</details>` : ""}</td>
<td>${(t.sent ?? []).length}</td>
<td>${["needs_human", "unmanaged", "closed"].includes(t.status) ? postButton("/threads/resume", "自動対応に戻す", csrf, { fields: { url: t.url }, confirm: "このスレッドをボットの自動対応に戻しますか？" }) : ""}
${["active", "needs_human"].includes(t.status) ? postButton("/threads/close", "自動対応を止める", csrf, { fields: { url: t.url } }) : ""}</td></tr>`).join("") || '<tr><td colspan="5" class="muted">まだありません</td></tr>'}
</table></section>`,
  });
}

export function jobsPage({ jobs, filter, csrf, flash }) {
  const filters = ["", "applied", "contracted", "drafted", "dryrun", "rejected", "filtered", "blocked", "failed"];
  return layout({
    title: "案件", csrf, flash, active: "/jobs",
    body: `<section class="card"><h1>案件（新しい順・最大300件）</h1><div class="filters">${filters.map((f) => `<a href="/jobs${f ? `?status=${f}` : ""}" class="${filter === f ? "on" : ""}">${f ? badge(f) : "すべて"}</a>`).join("")}</div>
<table><tr><th>状態</th><th>案件</th><th>スコア</th><th>提示額</th><th>理由・提案文</th></tr>
${jobs.map((j) => `<tr><td>${badge(j.status)}</td><td>${cwLink(j.url, j.title ?? j.id)}<div class="sub">${jst(j.updatedAt)}</div></td>
<td>${h(j.score ?? "—")}</td><td>${j.amountYen ? `${h(j.amountYen.toLocaleString())}円` : "—"}</td>
<td>${h(j.reason ?? (j.reasons ?? []).join(", ") ?? "")}${j.error ? `<div class="err">${h(j.error)}</div>` : ""}
${j.evaluation?.proposal ? `<details><summary>提案文</summary><pre>${h(j.evaluation.proposal)}</pre></details>` : ""}
${(j.screenshots ?? []).map((s) => `<a href="/screenshots/${h(s.split("/").pop())}" target="_blank" class="sub">画面</a>`).join(" ")}</td></tr>`).join("") || '<tr><td colspan="5" class="muted">まだありません</td></tr>'}
</table></section>`,
  });
}

export function auditPage({ entries, csrf, flash }) {
  return layout({
    title: "送信履歴", csrf, flash, active: "/audit",
    body: `<section class="card"><h1>送信履歴（監査ログ・新しい順）</h1><table><tr><th>日時</th><th>種類</th><th>内容</th></tr>
${entries.map((e) => `<tr><td>${jst(e.at)}</td><td>${h(e.event)}${e.ok === false ? ' <span class="badge bad">失敗</span>' : ""}</td>
<td>${e.title ? h(e.title) + "<br>" : ""}${e.url ? cwLink(e.url, e.url) + "<br>" : ""}${h(e.why ?? e.reason ?? e.message ?? "")}${e.text ? `<details><summary>本文</summary><pre>${h(e.text)}</pre></details>` : ""}</td></tr>`).join("") || '<tr><td colspan="3" class="muted">まだありません</td></tr>'}
</table></section>`,
  });
}

export function logsPage({ lines, csrf, flash }) {
  return layout({ title: "ログ", csrf, flash, active: "/logs", body: `<section class="card"><h1>ログ（直近）</h1><pre class="log">${h(lines.slice(-500).reverse().join("\n"))}</pre></section>` });
}

const num = (name, value, label, attrs = "") => `<label>${label}<input type="number" name="${name}" value="${h(value)}" ${attrs}></label>`;
const lines = (name, arr, label, rows = 4) => `<label>${label}<textarea name="${name}" rows="${rows}">${h((arr ?? []).join("\n"))}</textarea></label>`;

export function settingsPage({ config, raw, path, csrf, flash }) {
  const c = config;
  return layout({
    title: "設定", csrf, flash, active: "/settings",
    body: `<form method="post" action="/settings" class="card settings">${csrfInput(csrf)}<h1>設定</h1><p class="sub">保存先: ${h(path)}（保存時に検証し、不正な値は保存されません。次回の実行から反映）</p>
<h2>運用</h2>
<label class="check"><input type="checkbox" name="dryRun" ${c.dryRun ? "checked" : ""}> テストモード（入力まで行い、送信しない）</label>
<label>モード<select name="mode"><option value="auto" ${c.mode === "auto" ? "selected" : ""}>auto（自動応募）</option><option value="draft" ${c.mode === "draft" ? "selected" : ""}>draft（下書きのみ）</option></select></label>
<div class="grid">${num("activeStart", c.schedule.activeHours[0], "稼働開始（時）", 'min="0" max="23"')}${num("activeEnd", c.schedule.activeHours[1], "稼働終了（時）", 'min="0" max="24"')}
${num("intervalMinutes", c.schedule.intervalMinutes, "応募巡回の間隔（分）", 'min="15"')}${num("inboxIntervalMinutes", c.schedule.inboxIntervalMinutes, "メッセージ確認の間隔（分）", 'min="5"')}</div>
<h2>応募</h2>
<div class="grid">${num("maxApplicationsPerDay", c.limits.maxApplicationsPerDay, "1日の応募上限", 'min="1" max="50"')}${num("maxApplicationsPerRun", c.limits.maxApplicationsPerRun, "1回の応募上限", 'min="1"')}
${num("minScore", c.ai.minScore, "応募する最低スコア(0-100)", 'min="0" max="100"')}${num("minBudgetYen", c.filters.minBudgetYen, "最低予算（円）", 'min="0"')}
${num("minHourlyYen", c.filters.minHourlyYen, "最低時給（円）", 'min="0"')}${num("maxApplicants", c.filters.maxApplicants, "応募者数の上限", 'min="0"')}</div>
${lines("keywords", c.search.keywords, "検索キーワード（1行に1つ）")}
${lines("searchUrls", c.search.searchUrls, "検索結果URL（1行に1つ・任意）", 3)}
${lines("excludeKeywords", c.filters.excludeKeywords, "除外キーワード（1行に1つ）")}
<h2>受注・メッセージ</h2>
<label class="check"><input type="checkbox" name="autoAcceptContract" ${c.negotiation.autoAcceptContract ? "checked" : ""}> 条件を満たす契約を自動承諾する</label>
<div class="grid">${num("minAcceptRatio", c.negotiation.minAcceptRatio, "提案額に対する承諾下限（0.9=90%）", 'step="0.05" min="0.5" max="1"')}
${num("minContractYen", c.negotiation.minContractYen, "自動承諾の最低額（円）", 'min="0"')}${num("maxContractYen", c.negotiation.maxContractYen, "自動承諾の上限額（円）", 'min="1"')}
${num("maxRepliesPerDay", c.negotiation.maxRepliesPerDay, "1日の返信上限", 'min="1" max="100"')}</div>
<h2>プロフィール（提案文の材料）</h2>
<label>稼働・連絡<input name="availability" value="${h(c.profile.availability)}"></label>
${num("hourlyRateYen", c.profile.hourlyRateYen, "希望時給（円）", 'min="0"')}
<label>自己紹介<textarea name="summary" rows="6">${h(c.profile.summary)}</textarea></label>
<button class="primary">保存</button></form>
<form method="post" action="/settings/raw" class="card">${csrfInput(csrf)}<h2>詳細設定（JSON）</h2><p class="sub">セレクタ・スキル・実績など全項目。保存時に検証されます。</p>
<textarea name="json" rows="24" class="mono">${h(raw)}</textarea><button>JSON を保存</button></form>`,
  });
}

export function sessionPage({ session, csrf, flash }) {
  return layout({
    title: "ログイン情報", csrf, flash, active: "/session",
    body: `<section class="card"><h1>CrowdWorks ログイン情報</h1>
<p>状態: ${session.exists ? `保存済み（更新 ${jst(session.mtime)}）` : '<span class="err">未登録</span>'}</p>
<p class="sub">サーバーには画面がないため、手元の PC で <code>npm run login</code> を実行し、作成された <code>data/storage-state.json</code> の中身をここに貼り付けてください。中身はログイン Cookie なので、他人に渡さないでください。</p>
<form method="post" action="/session/upload">${csrfInput(csrf)}<textarea name="json" rows="10" class="mono" placeholder='{"cookies":[...],"origins":[...]}' required></textarea><button class="primary">登録する</button></form>
${session.exists ? postButton("/session/check", "ログインできるか確認", csrf) : ""}</section>`,
  });
}
