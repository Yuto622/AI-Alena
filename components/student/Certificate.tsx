import React, { useEffect, useState } from 'react';
import { MISSIONS } from '../../content/missions';
import { api } from '../../services/api';
import type { StudentSession } from '../../services/session';
import type { MissionResult } from '../../types';
import { Button } from '../ui';
import { navigate } from '../../lib/router';

/** 修了証。印刷して渡す（A4 横想定）。生徒が自分で測った数字が入る。 */
export const Certificate: React.FC<{ s: StudentSession }> = ({ s }) => {
  const [results, setResults] = useState<MissionResult[]>([]);
  useEffect(() => {
    api.studentResults(s.student.id).then(setResults).catch(() => {});
  }, [s.student.id]);
  const hubble = results.find((r) => r.missionId === 'm07' && r.labResult)?.labResult;
  const done = new Set(results.map((r) => r.missionId)).size;
  const date = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div className="space-y-4">
      <div className="flex gap-2 no-print">
        <Button variant="ghost" onClick={() => navigate('/student')}>← Back</Button>
        <Button onClick={() => window.print()}>🖨️ Print</Button>
      </div>
      <div className="bg-brand-cream text-space-900 rounded-2xl p-8 md:p-12 border-[6px] border-brand-green shadow-2xl print:shadow-none print:border-4">
        <div className="text-center">
          <div className="font-display text-xs tracking-[.4em] text-brand-green">U-SPACE · JUNIOR ASTRONOMER PROGRAM</div>
          <h1 className="font-display text-4xl md:text-5xl font-bold mt-3">Certificate of Completion</h1>
          <div className="text-sm mt-1">修了証</div>
          <div className="mt-8 text-lg">This certifies that</div>
          <div className="font-display text-4xl md:text-5xl font-bold text-brand-orange mt-2">{s.student.nickname}</div>
          <div className="mt-4 text-base max-w-xl mx-auto leading-relaxed">
            has completed <b>{done} of 8</b> space missions in English, including live tracking of the ISS, a transit search for exoplanets, and a measurement of the expansion of the universe.
          </div>
          {hubble && (
            <div className="mt-6 inline-block rounded-xl border-2 border-brand-green/40 px-6 py-3 bg-white/60">
              <div className="text-xs text-brand-green">Personal measurement · 本人の測定値</div>
              <div className="font-display text-lg font-bold">{hubble}</div>
            </div>
          )}
          <div className="mt-8 grid grid-cols-4 md:grid-cols-8 gap-2 max-w-xl mx-auto">
            {MISSIONS.map((m) => (
              <div key={m.id} className={`text-2xl ${results.some((r) => r.missionId === m.id) ? '' : 'opacity-20 grayscale'}`} title={m.title}>
                {m.emoji}
              </div>
            ))}
          </div>
          <div className="mt-10 flex items-end justify-between text-sm">
            <div className="text-left">
              <div>{s.classroom.name}</div>
              <div className="text-xs text-slate-600">{date}</div>
            </div>
            <div className="text-right">
              <div className="font-display font-bold">Yuto Sanada</div>
              <div className="text-xs text-slate-600">Program Director · UCLA Astrophysics &amp; Control Theory</div>
              <div className="text-xs text-slate-600">合同会社 U-Speak Lab</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
