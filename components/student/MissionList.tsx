import React, { useEffect, useState } from 'react';
import { MISSIONS } from '../../content/missions';
import { api } from '../../services/api';
import { session, type StudentSession } from '../../services/session';
import { navigate } from '../../lib/router';
import type { MissionResult } from '../../types';
import { LEVEL_LABEL } from '../../types';
import { Button, Card, Pill } from '../ui';
import { AskUcla } from './AskUcla';

export const MissionList: React.FC<{ s: StudentSession }> = ({ s }) => {
  const [results, setResults] = useState<MissionResult[]>([]);
  const [unlocked, setUnlocked] = useState(s.classroom.unlockedWeeks);

  useEffect(() => {
    api.studentResults(s.student.id).then(setResults).catch(() => {});
    api.classroomPublic(s.classroom.code).then((c) => setUnlocked(c.unlockedWeeks)).catch(() => {});
  }, [s.student.id, s.classroom.code]);

  const doneIds = new Set(results.map((r) => r.missionId));
  const completed = doneIds.size;
  const labHighlights = results.filter((r) => r.labResult).slice(-2);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <div className="text-sm text-slate-400">{s.classroom.name}</div>
          <h2 className="font-display text-3xl font-bold text-white">Welcome back, {s.student.nickname} 👩‍🚀</h2>
          <div className="mt-2 flex items-center gap-2">
            <Pill tone="orange">{LEVEL_LABEL[s.student.level]}</Pill>
            <Pill tone="blue">{completed} / 8 missions</Pill>
          </div>
        </div>
        <div className="flex gap-2">
          {completed >= 8 && (
            <Button variant="cream" onClick={() => navigate('/student/certificate')}>
              🏅 修了証を見る
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => {
              session.setStudent(null);
              navigate('/join');
            }}
          >
            Log out
          </Button>
        </div>
      </div>

      {/* progress */}
      <div className="h-2 rounded-full bg-white/10 overflow-hidden">
        <div className="h-full bg-gradient-to-r from-brand-orange to-amber-300 transition-all" style={{ width: `${(completed / 8) * 100}%` }} />
      </div>

      {labHighlights.length > 0 && (
        <Card title="📡 Your mission data" subtitle="あなたが実際に測った・計算した数字">
          <ul className="text-sm text-slate-200 space-y-1">
            {labHighlights.map((r) => (
              <li key={r.id}>
                <span className="text-slate-400">{MISSIONS.find((m) => m.id === r.missionId)?.code}</span> — {r.labResult}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {MISSIONS.map((m) => {
          const locked = m.week > unlocked;
          const done = doneIds.has(m.id);
          const res = results.filter((r) => r.missionId === m.id).sort((a, b) => b.completedAt.localeCompare(a.completedAt))[0];
          return (
            <button
              key={m.id}
              disabled={locked}
              onClick={() => navigate(`/student/${m.id}`)}
              className={`text-left glass rounded-2xl p-5 transition hover:border-brand-orange/50 ${locked ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className="flex items-start justify-between">
                <div className="text-4xl">{m.emoji}</div>
                <div className="flex gap-1">
                  {done && <Pill tone="green">Complete</Pill>}
                  {locked && <Pill tone="slate">🔒 Week {m.week}</Pill>}
                  {!locked && !done && <Pill tone="orange">Week {m.week}</Pill>}
                </div>
              </div>
              <div className="mt-3 font-display text-xs text-slate-400">{m.code}</div>
              <div className="font-display text-lg font-bold text-white leading-tight">{m.title}</div>
              <div className="text-sm text-slate-300">{m.titleJa}</div>
              <div className="text-xs text-slate-500 mt-2">{m.theme}</div>
              {res && (
                <div className="mt-3 text-xs text-slate-400">
                  Quiz {res.quizScore}/{res.quizTotal}
                  {res.speakingScore ? ` · Speaking ${'★'.repeat(res.speakingScore)}` : ''}
                </div>
              )}
            </button>
          );
        })}
      </div>

      <AskUcla s={s} />
    </div>
  );
};
