import React, { useMemo, useState } from 'react';
import { moonPhase, fmt } from '../../lib/astro';
import { Card, Stat } from '../ui';

/** 月のSVG：照らされている割合と満ち欠けの向きから描く */
const MoonDisk: React.FC<{ illumination: number; waxing: boolean; size?: number }> = ({ illumination, waxing, size = 160 }) => {
  const r = size / 2 - 4;
  const cx = size / 2;
  const cy = size / 2;
  // 影の境界（楕円）の横半径。illum=0.5 で 0（直線）、0 or 1 で r。
  const k = Math.abs(illumination - 0.5) * 2; // 0..1
  const rx = r * k;
  const litRight = waxing; // 北半球：満ちていく時は右側が明るい
  const gibbous = illumination > 0.5;
  // 明部パス：半円 + 楕円弧
  const dir = litRight ? 1 : -1;
  const path = [
    `M ${cx} ${cy - r}`,
    `A ${r} ${r} 0 0 ${litRight ? 1 : 0} ${cx} ${cy + r}`,
    `A ${rx} ${r} 0 0 ${gibbous ? (litRight ? 1 : 0) : litRight ? 0 : 1} ${cx} ${cy - r}`,
    'Z',
  ].join(' ');
  void dir;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Moon phase tonight">
      <defs>
        <radialGradient id="moonlit" cx="40%" cy="35%">
          <stop offset="0%" stopColor="#FFF8E7" />
          <stop offset="100%" stopColor="#D9CDB4" />
        </radialGradient>
      </defs>
      <circle cx={cx} cy={cy} r={r} fill="#1a1f33" stroke="rgba(255,255,255,.15)" />
      <path d={path} fill="url(#moonlit)" />
      <circle cx={cx - r * 0.3} cy={cy - r * 0.2} r={r * 0.09} fill="rgba(0,0,0,.08)" />
      <circle cx={cx + r * 0.25} cy={cy + r * 0.3} r={r * 0.12} fill="rgba(0,0,0,.08)" />
    </svg>
  );
};

export const MoonLab: React.FC<{ onResult?: (text: string) => void }> = ({ onResult }) => {
  const today = useMemo(() => moonPhase(new Date()), []);
  const [guess, setGuess] = useState<string>('');
  const [checked, setChecked] = useState<null | boolean>(null);
  const nextFull = useMemo(() => {
    // 次の満月までの日数
    const half = today.synodic / 2;
    const d = today.age <= half ? half - today.age : today.synodic - today.age + half;
    return d;
  }, [today]);

  const check = () => {
    const v = parseFloat(guess);
    const ok = Number.isFinite(v) && Math.abs(v - nextFull) <= 1.5;
    setChecked(ok);
    if (ok) onResult?.(`今夜の月齢 ${fmt(today.age, 1)}日（${today.nameJa}）・次の満月まで約${fmt(nextFull, 0)}日`);
  };

  return (
    <Card title="🌙 Tonight's Moon" subtitle="外部データ不要。基準の新月（2000年1月6日）からの経過日数で計算しています。">
      <div className="flex flex-col md:flex-row items-center gap-6">
        <div className="floaty">
          <MoonDisk illumination={today.illumination} waxing={today.waxing} />
        </div>
        <div className="grid grid-cols-2 gap-3 flex-1 w-full">
          <Stat label="Phase 月相" value={today.nameEn} hint={today.nameJa} />
          <Stat label="Age 月齢" value={`${fmt(today.age, 1)} days`} />
          <Stat label="Illuminated 照らされた割合" value={`${fmt(today.illumination * 100, 0)}%`} />
          <Stat label="Direction" value={today.waxing ? 'Waxing 満ちていく' : 'Waning 欠けていく'} />
        </div>
      </div>
      <div className="mt-5 rounded-xl bg-space-900/70 border border-white/5 p-4">
        <div className="font-bold text-white">Data Lab: How many days until the next FULL moon?</div>
        <div className="text-sm text-slate-400 mt-1">満月は月齢 約14.8日。今夜の月齢は {fmt(today.age, 1)}日。周期は 29.5日。</div>
        <div className="flex gap-2 mt-3">
          <input value={guess} onChange={(e) => setGuess(e.target.value)} inputMode="decimal" placeholder="days" className="w-40 rounded-xl bg-space-950 border border-white/10 px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-orange/70" />
          <button onClick={check} className="rounded-xl bg-brand-orange px-4 py-2 text-sm font-bold text-white hover:bg-orange-500">Check</button>
        </div>
        {checked === true && <p className="mt-2 text-emerald-300 text-sm">✅ Yes! About {fmt(nextFull, 0)} days. Look up at the sky that night.</p>}
        {checked === false && <p className="mt-2 text-rose-300 text-sm">Hint: {today.age <= 14.8 ? `14.8 − ${fmt(today.age, 1)}` : `29.5 − ${fmt(today.age, 1)} + 14.8`} ≈ ?</p>}
      </div>
    </Card>
  );
};
