import React, { useMemo, useState } from 'react';
import type { Mission, QuizQuestion } from '../../types';
import type { StudentSession } from '../../services/session';
import { api } from '../../services/api';
import { navigate } from '../../lib/router';
import { speak } from '../../lib/speech';
import { Button, Card, Pill, Spinner, Textarea } from '../ui';
import { DataLab } from '../labs/DataLab';
import { CommanderChat } from './CommanderChat';

type Step = 'briefing' | 'vocab' | 'lab' | 'quiz' | 'speaking' | 'done';
const STEPS: { id: Step; label: string; ja: string }[] = [
  { id: 'briefing', label: 'Briefing', ja: '任務説明' },
  { id: 'vocab', label: 'Words', ja: '単語' },
  { id: 'lab', label: 'Data Lab', ja: '実験' },
  { id: 'quiz', label: 'Quiz', ja: 'クイズ' },
  { id: 'speaking', label: 'Speak', ja: '発話' },
  { id: 'done', label: 'Complete', ja: '完了' },
];

export const MissionPlayer: React.FC<{ mission: Mission; s: StudentSession }> = ({ mission, s }) => {
  const level = s.student.level;
  const [step, setStep] = useState<Step>('briefing');
  const [showJa, setShowJa] = useState(false);
  const [labResult, setLabResult] = useState<string | undefined>();
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [speakText, setSpeakText] = useState('');
  const [chatTranscript, setChatTranscript] = useState('');
  const [fb, setFb] = useState<{ score: number; feedback: string; usedWords: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const lines = level === 3 ? mission.briefing.advanced : mission.briefing.simple;
  const vocab = useMemo(() => mission.vocab.filter((v) => v.level <= Math.max(level, 1) || level >= 2), [mission, level]);
  const quiz: QuizQuestion[] = mission.quiz; // 全レベル6問。低レベルの子にも挑戦させる（解説が学び）
  const score = quiz.reduce((a, q) => a + (answers[q.id] === q.answerIndex ? 1 : 0), 0);

  const stepIdx = STEPS.findIndex((x) => x.id === step);
  const go = (d: 1 | -1) => setStep(STEPS[Math.min(STEPS.length - 1, Math.max(0, stepIdx + d))].id);

  const getFeedback = async () => {
    const text = [speakText, chatTranscript].filter(Boolean).join(' ').trim();
    if (!text) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.speaking(text, level, mission.id);
      setFb(r);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.saveResult(s.student.id, {
        missionId: mission.id,
        quizScore: score,
        quizTotal: quiz.length,
        labResult,
        speakingText: [speakText, chatTranscript].filter(Boolean).join(' ').trim() || undefined,
        speakingFeedback: fb?.feedback,
        speakingScore: fb?.score,
      });
      setSaved(true);
      setStep('done');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <button onClick={() => navigate('/student')} className="text-xs text-slate-400 hover:text-white">
            ← Missions
          </button>
          <div className="font-display text-xs text-orange-300 mt-1">
            {mission.code} · WEEK {mission.week}
          </div>
          <h2 className="font-display text-2xl md:text-3xl font-bold text-white leading-tight">
            {mission.emoji} {mission.title}
          </h2>
          <div className="text-slate-300">{mission.titleJa}</div>
        </div>
        <Pill tone="blue">Lv {level}</Pill>
      </div>

      {/* stepper */}
      <ol className="flex items-center gap-1 text-[11px] md:text-xs overflow-x-auto no-print">
        {STEPS.map((st, i) => (
          <li key={st.id} className="flex items-center gap-1">
            <button onClick={() => i <= stepIdx && setStep(st.id)} className={`rounded-full px-3 py-1 border whitespace-nowrap ${i === stepIdx ? 'bg-brand-orange border-brand-orange text-white' : i < stepIdx ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-200' : 'bg-white/5 border-white/10 text-slate-400'}`}>
              {st.label} <span className="hidden md:inline text-[10px] opacity-70">{st.ja}</span>
            </button>
            {i < STEPS.length - 1 && <span className="text-slate-600">›</span>}
          </li>
        ))}
      </ol>

      {/* ------------------------------------------------------------ briefing */}
      {step === 'briefing' && (
        <Card title="📋 Mission Briefing" subtitle="クリックで読み上げ。日本語はボタンで表示。">
          <ol className="space-y-3">
            {lines.map((ln, i) => (
              <li key={i} className="group">
                <button onClick={() => speak(ln)} className="text-left text-lg md:text-xl text-white leading-relaxed hover:text-orange-200">
                  <span className="text-slate-500 font-display text-sm mr-2">{i + 1}</span>
                  {ln} <span className="opacity-0 group-hover:opacity-60 text-sm">🔊</span>
                </button>
                {showJa && level !== 3 && <div className="text-sm text-slate-400 ml-6">{mission.briefing.ja[i]}</div>}
                {showJa && level === 3 && i === 0 && <div className="text-sm text-slate-400 ml-6">（Lv3 は英語のみ。わからない単語は Words で確認）</div>}
              </li>
            ))}
          </ol>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => setShowJa((v) => !v)}>
              {showJa ? '日本語を隠す' : '日本語を見る'}
            </Button>
            <Button variant="ghost" onClick={() => speak(lines.join(' '))}>
              🔊 Read all
            </Button>
          </div>
          <div className="mt-6 grid gap-2 md:grid-cols-2">
            {mission.facts.map((f) => (
              <div key={f.label} className="rounded-xl bg-space-900/60 border border-white/5 p-3">
                <div className="text-[11px] text-slate-400">{f.label}</div>
                <div className="text-white font-medium">{f.value}</div>
                <div className="text-[10px] text-slate-500">source: {f.source}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ------------------------------------------------------------ vocab */}
      {step === 'vocab' && (
        <Card title="🔤 Mission Words" subtitle="タップで発音。例文も一緒に。">
          <div className="grid gap-3 md:grid-cols-2">
            {vocab.map((v) => (
              <button key={v.en} onClick={() => speak(`${v.en}. ${v.example}`)} className="text-left rounded-xl bg-space-900/60 border border-white/5 p-4 hover:border-brand-orange/50 transition">
                <div className="flex items-center justify-between">
                  <div className="font-display text-xl font-bold text-white">{v.en}</div>
                  <Pill tone={v.level === 1 ? 'green' : v.level === 2 ? 'blue' : 'violet'}>Lv{v.level}</Pill>
                </div>
                <div className="text-slate-300">{v.ja}</div>
                <div className="text-sm text-slate-400 mt-1 italic">“{v.example}”</div>
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* ------------------------------------------------------------ lab */}
      {step === 'lab' && (
        <div className="space-y-3">
          <DataLab mission={mission} onResult={setLabResult} location={s.classroom.location} />
          {labResult && <div className="text-sm text-emerald-300">📡 Recorded: {labResult}</div>}
        </div>
      )}

      {/* ------------------------------------------------------------ quiz */}
      {step === 'quiz' && (
        <Card title="🧠 Mission Quiz" subtitle="6問。わからなくても選んでOK。解説が学びです。">
          <ol className="space-y-5">
            {quiz.map((q, qi) => {
              const chosen = answers[q.id];
              return (
                <li key={q.id} className="rounded-xl bg-space-900/60 border border-white/5 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-white font-medium">
                        <span className="text-slate-500 font-display mr-2">Q{qi + 1}</span>
                        {q.question}
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">{q.questionJa}</div>
                    </div>
                    <Pill tone={q.level === 1 ? 'green' : q.level === 2 ? 'blue' : 'violet'}>Lv{q.level}</Pill>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2 mt-3">
                    {q.choices.map((c, ci) => {
                      const isChosen = chosen === ci;
                      const isAnswer = q.answerIndex === ci;
                      let cls = 'bg-white/5 border-white/10 text-slate-100 hover:bg-white/10';
                      if (quizSubmitted && isAnswer) cls = 'bg-emerald-500/20 border-emerald-400 text-emerald-100';
                      else if (quizSubmitted && isChosen && !isAnswer) cls = 'bg-rose-500/20 border-rose-400 text-rose-100';
                      else if (isChosen) cls = 'bg-orange-500/20 border-brand-orange text-orange-100';
                      return (
                        <button key={ci} disabled={quizSubmitted} onClick={() => setAnswers((a) => ({ ...a, [q.id]: ci }))} className={`text-left rounded-lg border px-3 py-2 text-sm transition ${cls}`}>
                          {c}
                        </button>
                      );
                    })}
                  </div>
                  {quizSubmitted && <div className="mt-3 text-sm text-slate-300 border-l-2 border-brand-orange pl-3">{q.explanation}</div>}
                </li>
              );
            })}
          </ol>
          <div className="mt-5 flex items-center gap-3">
            {!quizSubmitted ? (
              <Button onClick={() => setQuizSubmitted(true)} disabled={Object.keys(answers).length < quiz.length}>
                Submit answers
              </Button>
            ) : (
              <div className="font-display text-xl text-white">
                Score: <span className="text-brand-orange">{score}</span> / {quiz.length}
              </div>
            )}
          </div>
        </Card>
      )}

      {/* ------------------------------------------------------------ speaking */}
      {step === 'speaking' && (
        <div className="space-y-4">
          <Card title="🎙️ Speaking Mission" subtitle={mission.speaking.promptJa}>
            <p className="text-lg text-white leading-relaxed">{mission.speaking.prompt}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {mission.speaking.starters.map((st) => (
                <button key={st} onClick={() => setSpeakText((t) => (t ? `${t} ${st}` : st))} className="rounded-lg bg-white/5 border border-white/10 px-3 py-1 text-xs text-slate-200 hover:bg-white/10">
                  {st}
                </button>
              ))}
            </div>
            <div className="mt-2 text-xs text-slate-400">
              Mission words: {mission.speaking.targetWords.map((w) => <span key={w} className="mr-2 text-orange-200">{w}</span>)}
            </div>
            <Textarea value={speakText} onChange={(e) => setSpeakText(e.target.value)} rows={4} className="mt-3" placeholder="Write 3 sentences in English… (or talk to the Commander below)" />
            <div className="mt-3 flex items-center gap-3">
              <Button onClick={getFeedback} disabled={busy || !(speakText.trim() || chatTranscript.trim())}>
                {busy ? <Spinner /> : 'Get feedback from Commander'}
              </Button>
              {fb && (
                <div className="font-display text-lg text-white">
                  {'★'.repeat(fb.score)}
                  <span className="text-slate-600">{'★'.repeat(5 - fb.score)}</span>
                </div>
              )}
            </div>
            {fb && (
              <div className="mt-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-4 text-emerald-100 text-sm">
                🎧 {fb.feedback}
                <button onClick={() => speak(fb.feedback)} className="ml-2 text-xs opacity-70 hover:opacity-100">🔊</button>
              </div>
            )}
            {err && <p className="text-rose-300 text-sm mt-2">{err}</p>}
          </Card>
          <CommanderChat mission={mission} s={s} onTranscript={setChatTranscript} />
        </div>
      )}

      {/* ------------------------------------------------------------ done */}
      {step === 'done' && (
        <Card>
          <div className="text-center py-6">
            <div className="text-6xl floaty">{mission.emoji}</div>
            <h3 className="font-display text-3xl font-bold text-white mt-4">Mission Complete!</h3>
            <p className="text-slate-300 mt-2">
              {mission.code} — Quiz {score}/{quiz.length}
              {fb ? ` · Speaking ${fb.score}/5` : ''}
            </p>
            {labResult && <p className="text-emerald-300 text-sm mt-2">📡 {labResult}</p>}
            {saved && <p className="text-xs text-slate-500 mt-3">結果は先生の管理画面と保護者レポートに反映されました。</p>}
            <div className="mt-6 flex justify-center gap-2">
              <Button onClick={() => navigate('/student')}>Back to missions</Button>
            </div>
          </div>
        </Card>
      )}

      {/* nav */}
      {step !== 'done' && (
        <div className="flex items-center justify-between no-print">
          <Button variant="ghost" onClick={() => go(-1)} disabled={stepIdx === 0}>
            ← Back
          </Button>
          {step === 'speaking' ? (
            <Button onClick={finish} disabled={busy || !quizSubmitted}>
              {busy ? <Spinner /> : 'Finish mission ✓'}
            </Button>
          ) : (
            <Button onClick={() => go(1)} disabled={step === 'quiz' && !quizSubmitted}>
              Next →
            </Button>
          )}
        </div>
      )}
    </div>
  );
};
