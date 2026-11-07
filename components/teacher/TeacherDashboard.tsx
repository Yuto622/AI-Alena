import React, { useEffect, useMemo, useState } from 'react';
import { MISSIONS } from '../../content/missions';
import { api } from '../../services/api';
import { session, type TeacherSession } from '../../services/session';
import { navigate } from '../../lib/router';
import type { AskQuestion, Classroom, MissionResult, Student } from '../../types';
import { LEVEL_LABEL } from '../../types';
import { Button, Card, Input, Pill, Spinner, Stat, Textarea } from '../ui';

// ---------------------------------------------------------------------------
// ログイン
// ---------------------------------------------------------------------------
export const TeacherLogin: React.FC = () => {
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.teacherLogin(code, pin);
      session.setTeacher({ code, pin });
      navigate('/teacher');
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-md mx-auto">
      <Card title="👩‍🏫 Teacher Console" subtitle="教室コードと先生用PINでログイン">
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="text-xs text-slate-400">教室コード</label>
            <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" placeholder="1234" className="font-display text-xl tracking-[.3em] text-center" />
          </div>
          <div>
            <label className="text-xs text-slate-400">先生用PIN</label>
            <Input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" type="password" placeholder="••••" className="font-display text-xl tracking-[.3em] text-center" />
          </div>
          {err && <p className="text-rose-300 text-sm">{err}</p>}
          <Button type="submit" className="w-full py-3" disabled={busy || code.length !== 4 || pin.length !== 4}>
            {busy ? <Spinner /> : 'ログイン'}
          </Button>
          <p className="text-[11px] text-slate-500 text-center">デモ：コード 1234 / PIN 0000</p>
        </form>
      </Card>
    </div>
  );
};

// ---------------------------------------------------------------------------
// ダッシュボード
// ---------------------------------------------------------------------------
type Tab = 'overview' | 'students' | 'lesson' | 'questions' | 'settings';

export const TeacherDashboard: React.FC<{ t: TeacherSession }> = ({ t }) => {
  const [data, setData] = useState<{ classroom: Classroom; students: Student[]; results: MissionResult[]; questions: AskQuestion[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [report, setReport] = useState<{ studentId: string; text: string; source: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [week, setWeek] = useState(1);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const load = () =>
    api
      .dashboard(t)
      .then((d) => {
        setData(d);
        setWeek(d.classroom.unlockedWeeks);
      })
      .catch((e) => setErr((e as Error).message));
  useEffect(() => {
    load();
  }, [t.code]);

  const stats = useMemo(() => {
    if (!data) return null;
    const { students, results } = data;
    const quizPct = results.length ? Math.round((100 * results.reduce((a, r) => a + r.quizScore, 0)) / Math.max(1, results.reduce((a, r) => a + r.quizTotal, 0))) : 0;
    const spk = results.filter((r) => r.speakingScore);
    const spkAvg = spk.length ? (spk.reduce((a, r) => a + (r.speakingScore || 0), 0) / spk.length).toFixed(1) : '-';
    const completion = students.length ? Math.round((100 * new Set(results.map((r) => `${r.studentId}:${r.missionId}`)).size) / (students.length * data.classroom.unlockedWeeks)) : 0;
    const words = results.reduce((a, r) => a + (r.speakingText?.split(/\s+/).filter(Boolean).length || 0), 0);
    return { quizPct, spkAvg, completion, words };
  }, [data]);

  if (err)
    return (
      <Card>
        <p className="text-rose-300">{err}</p>
        <Button
          className="mt-3"
          variant="ghost"
          onClick={() => {
            session.setTeacher(null);
            navigate('/teacher');
          }}
        >
          ログインへ戻る
        </Button>
      </Card>
    );
  if (!data || !stats)
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-8 w-8" />
      </div>
    );

  const { classroom, students, results, questions } = data;
  const currentMission = MISSIONS.find((m) => m.week === classroom.unlockedWeeks) || MISSIONS[0];

  const genReport = async (sid: string) => {
    setBusyId(sid);
    try {
      const r = await api.report(t, sid);
      setReport({ studentId: sid, ...r });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const exportCsv = () => {
    const header = ['nickname', 'level', 'mission', 'quizScore', 'quizTotal', 'speakingScore', 'labResult', 'speakingText', 'completedAt'];
    const rows = results.map((r) => {
      const s = students.find((x) => x.id === r.studentId);
      return [s?.nickname || '', s?.level || '', r.missionId, r.quizScore, r.quizTotal, r.speakingScore ?? '', r.labResult ?? '', (r.speakingText ?? '').replace(/"/g, '""'), r.completedAt];
    });
    const csv = '﻿' + [header, ...rows].map((row) => row.map((v) => `"${String(v)}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `uspace_${classroom.code}_results.csv`;
    a.click();
  };

  const saveWeek = async () => {
    const c = await api.updateClassroom(t, { unlockedWeeks: week });
    setData((d) => (d ? { ...d, classroom: c } : d));
  };

  const TABS: { id: Tab; label: string }[] = [
    { id: 'overview', label: '概要' },
    { id: 'students', label: `生徒 (${students.length})` },
    { id: 'lesson', label: '今週の授業' },
    { id: 'questions', label: `質問 (${questions.filter((q) => !q.answer).length})` },
    { id: 'settings', label: '設定' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <div className="text-xs text-slate-400 font-display">TEACHER CONSOLE · CODE {classroom.code}</div>
          <h2 className="font-display text-3xl font-bold text-white">{classroom.name}</h2>
          <div className="mt-2 flex gap-2">
            <Pill tone="orange">Plan: {classroom.plan}</Pill>
            <Pill tone="blue">Week {classroom.unlockedWeeks} / 8 解放中</Pill>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={exportCsv}>
            ⬇︎ CSV（スプレッドシート用）
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              session.setTeacher(null);
              navigate('/teacher');
            }}
          >
            ログアウト
          </Button>
        </div>
      </div>

      <nav className="flex gap-1 overflow-x-auto">
        {TABS.map((x) => (
          <button key={x.id} onClick={() => setTab(x.id)} className={`rounded-full px-4 py-1.5 text-sm border whitespace-nowrap ${tab === x.id ? 'bg-brand-orange border-brand-orange text-white' : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'}`}>
            {x.label}
          </button>
        ))}
      </nav>

      {tab === 'overview' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="完了率（解放週ベース）" value={`${stats.completion}%`} />
            <Stat label="クイズ正答率" value={`${stats.quizPct}%`} />
            <Stat label="スピーキング平均" value={`${stats.spkAvg} / 5`} />
            <Stat label="英語で話した総語数" value={stats.words.toLocaleString()} hint="保護者レポートに載る数字" />
          </div>
          <Card title="ミッション別の進捗" subtitle="各ミッションを完了した生徒数">
            <div className="space-y-2">
              {MISSIONS.map((m) => {
                const n = new Set(results.filter((r) => r.missionId === m.id).map((r) => r.studentId)).size;
                const pct = students.length ? (n / students.length) * 100 : 0;
                const locked = m.week > classroom.unlockedWeeks;
                return (
                  <div key={m.id} className={`flex items-center gap-3 ${locked ? 'opacity-40' : ''}`}>
                    <div className="w-8 text-xl">{m.emoji}</div>
                    <div className="w-40 md:w-64 text-sm text-slate-200 truncate">
                      <span className="font-display text-xs text-slate-500 mr-1">W{m.week}</span>
                      {m.titleJa}
                    </div>
                    <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
                      <div className="h-full bg-brand-orange" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="w-16 text-right text-xs text-slate-400">
                      {n}/{students.length}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </>
      )}

      {tab === 'students' && (
        <Card title="生徒一覧" subtitle="「レポート」を押すと保護者向けAIレポートを生成します（U-Speak の個別AIレポートと同じ流れ）">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-slate-400 text-left text-xs">
                <tr>
                  <th className="py-2">ニックネーム</th>
                  <th>レベル</th>
                  <th>完了</th>
                  <th>クイズ</th>
                  <th>発話</th>
                  <th>最新のData Lab</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => {
                  const rs = results.filter((r) => r.studentId === s.id);
                  const q = rs.reduce((a, r) => a + r.quizScore, 0);
                  const qt = rs.reduce((a, r) => a + r.quizTotal, 0);
                  const sp = rs.filter((r) => r.speakingScore);
                  const last = [...rs].reverse().find((r) => r.labResult);
                  return (
                    <tr key={s.id} className="border-t border-white/5">
                      <td className="py-2 font-medium text-white">{s.nickname}</td>
                      <td>
                        <Pill tone={s.level === 1 ? 'green' : s.level === 2 ? 'blue' : 'violet'}>{LEVEL_LABEL[s.level].split('（')[0]}</Pill>
                      </td>
                      <td>{new Set(rs.map((r) => r.missionId)).size}/8</td>
                      <td>{qt ? `${Math.round((100 * q) / qt)}%` : '-'}</td>
                      <td>{sp.length ? (sp.reduce((a, r) => a + (r.speakingScore || 0), 0) / sp.length).toFixed(1) : '-'}</td>
                      <td className="text-xs text-slate-400 max-w-[220px] truncate">{last?.labResult || '-'}</td>
                      <td className="text-right">
                        <Button variant="ghost" onClick={() => genReport(s.id)} disabled={busyId === s.id}>
                          {busyId === s.id ? <Spinner /> : '📄 レポート'}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {students.length === 0 && <p className="text-slate-400 text-sm">まだ生徒がいません。生徒に教室コード <b className="text-white">{classroom.code}</b> を伝えてください。</p>}
          {report && (
            <div className="mt-5 rounded-xl bg-brand-cream text-space-900 p-5 whitespace-pre-wrap text-sm leading-relaxed">
              <div className="flex items-center justify-between mb-2 no-print">
                <div className="text-xs text-slate-600">生成元：{report.source === 'gemini' ? 'Gemini AI' : 'テンプレート（APIキー未設定）'}</div>
                <div className="flex gap-2">
                  <button onClick={() => navigator.clipboard?.writeText(report.text)} className="text-xs underline">
                    コピー
                  </button>
                  <button onClick={() => window.print()} className="text-xs underline">
                    印刷
                  </button>
                </div>
              </div>
              {report.text}
            </div>
          )}
        </Card>
      )}

      {tab === 'lesson' && (
        <div className="space-y-4">
          <Card title={`${currentMission.emoji} Week ${currentMission.week}：${currentMission.titleJa}`} subtitle={currentMission.theme}>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-slate-400 mb-2">45分 進行台本（宇宙の知識ゼロでOK）</div>
                <ol className="space-y-2">
                  {currentMission.teacherScript.map((s, i) => (
                    <li key={i} className="rounded-lg bg-space-900/60 border border-white/5 p-3 text-sm text-slate-200">
                      {s}
                    </li>
                  ))}
                </ol>
              </div>
              <div>
                <div className="text-xs text-slate-400 mb-2">投影用：今日の数字（出典つき）</div>
                <div className="space-y-2">
                  {currentMission.facts.map((f) => (
                    <div key={f.label} className="rounded-lg bg-space-900/60 border border-white/5 p-3">
                      <div className="text-[11px] text-slate-400">{f.label}</div>
                      <div className="text-white font-medium">{f.value}</div>
                      <div className="text-[10px] text-slate-500">source: {f.source}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 text-xs text-slate-400 mb-2">今日の Mission Words</div>
                <div className="flex flex-wrap gap-1">
                  {currentMission.vocab.map((v) => (
                    <Pill key={v.en} tone={v.level === 1 ? 'green' : v.level === 2 ? 'blue' : 'violet'}>
                      {v.en} {v.ja}
                    </Pill>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <Button variant="cream" onClick={() => window.open(`#/present/${currentMission.id}`, '_blank')}>
                🖥️ 投影モードで開く
              </Button>
            </div>
          </Card>
        </div>
      )}

      {tab === 'questions' && (
        <Card title="🎓 Ask a UCLA astrophysicist — 生徒からの質問" subtitle="未回答の質問は月1ライブで U-Speak Lab が回答します。先生がその場で答えてもOK。">
          {questions.length === 0 && <p className="text-slate-400 text-sm">まだ質問はありません。</p>}
          <div className="space-y-3">
            {[...questions].reverse().map((q) => (
              <div key={q.id} className="rounded-xl bg-space-900/60 border border-white/5 p-4">
                <div className="text-sm text-white">
                  <span className="text-slate-500">{q.nickname}:</span> {q.question}
                </div>
                {q.answer ? (
                  <div className="mt-2 text-sm text-emerald-200">🎓 {q.answer}</div>
                ) : (
                  <div className="mt-2 flex gap-2">
                    <Input value={answers[q.id] || ''} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} placeholder="回答を入力（英語・日本語どちらでも）" />
                    <Button
                      onClick={async () => {
                        await api.answerQuestion(t, q.id, answers[q.id] || '');
                        load();
                      }}
                      disabled={!answers[q.id]?.trim()}
                    >
                      回答
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === 'settings' && (
        <Card title="設定" subtitle="週の解放は手動（通常は授業日に1つ進める）">
          <div className="grid md:grid-cols-2 gap-5">
            <div>
              <label className="text-xs text-slate-400">解放する週（1〜8）</label>
              <div className="flex gap-2 mt-1">
                <Input type="number" min={1} max={8} value={week} onChange={(e) => setWeek(Math.min(8, Math.max(1, parseInt(e.target.value || '1', 10))))} className="w-24" />
                <Button onClick={saveWeek}>保存</Button>
              </div>
            </div>
            <div className="rounded-xl bg-space-900/60 border border-white/5 p-4 text-sm">
              <div className="text-xs text-slate-400">生徒への案内文（コピーして配布）</div>
              <Textarea readOnly rows={4} className="mt-2 text-xs" value={`U-Space（宇宙×英語クラス）\n1. タブレット/PCで ${location.origin}/#/join を開く\n2. 教室コード「${classroom.code}」とニックネームを入力\n3. 今週のミッションをスタート！`} />
            </div>
          </div>
        </Card>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// 投影モード（教室の大画面用：Briefing を大きく、1文ずつ）
// ---------------------------------------------------------------------------
export const PresentMode: React.FC<{ missionId: string }> = ({ missionId }) => {
  const m = MISSIONS.find((x) => x.id === missionId) || MISSIONS[0];
  const [i, setI] = useState(0);
  const lines = m.briefing.simple;
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') setI((x) => Math.min(lines.length - 1, x + 1));
      if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [lines.length]);
  return (
    <div className="min-h-screen starfield flex flex-col items-center justify-center p-10 text-center cursor-pointer select-none" onClick={() => setI((x) => (x + 1) % lines.length)}>
      <div className="font-display text-orange-300 tracking-widest">
        {m.code} · WEEK {m.week}
      </div>
      <div className="text-7xl mt-4">{m.emoji}</div>
      <h1 className="font-display text-4xl md:text-6xl font-bold text-white mt-6 max-w-5xl leading-tight">{lines[i]}</h1>
      <p className="text-2xl text-slate-300 mt-6 max-w-4xl">{m.briefing.ja[i]}</p>
      <div className="mt-12 flex gap-2">
        {lines.map((_, k) => (
          <span key={k} className={`h-2 w-8 rounded-full ${k === i ? 'bg-brand-orange' : 'bg-white/20'}`} />
        ))}
      </div>
      <div className="mt-6 text-xs text-slate-500">クリック / → で次の文へ</div>
    </div>
  );
};
