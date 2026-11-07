import React, { useMemo, useState } from 'react';
import { HUBBLE_DATA } from '../../content/missions';
import { fitHubble, hubbleAgeGyr, fmt } from '../../lib/astro';
import { Card, Stat } from '../ui';

/**
 * ハッブルの法則ラボ：実在銀河団の（距離, 速度）に直線を合わせて H₀ を求め、宇宙の年齢を出す。
 * UCLA Astro 117 の演習そのまま。小学生は「傾きを合わせる」だけでいい。
 */
export const HubbleLab: React.FC<{ onResult?: (text: string) => void }> = ({ onResult }) => {
  const [h0, setH0] = useState(55);
  const [locked, setLocked] = useState<string | null>(null);
  const best = useMemo(() => fitHubble(), []);
  const age = hubbleAgeGyr(h0);

  const W = 360;
  const H = 220;
  const pad = { l: 44, r: 12, t: 12, b: 30 };
  const maxD = 340;
  const maxV = 26000;
  const sx = (d: number) => pad.l + (d / maxD) * (W - pad.l - pad.r);
  const sy = (v: number) => H - pad.b - (v / maxV) * (H - pad.t - pad.b);

  // 残差（点と直線の距離の合計）を見やすい「Fit score」に
  const residual = useMemo(() => HUBBLE_DATA.reduce((a, g) => a + Math.abs(g.velocityKms - h0 * g.distanceMpc) / g.velocityKms, 0) / HUBBLE_DATA.length, [h0]);
  const fitScore = Math.max(0, Math.round(100 - residual * 400));
  const good = Math.abs(h0 - best) <= 4;

  const record = () => {
    const txt = `H₀ ≈ ${fmt(h0, 0)} km/s/Mpc → 宇宙の年齢 ≈ ${fmt(age, 1)} Gyr（実データ7銀河団にフィット）`;
    setLocked(txt);
    onResult?.(txt);
  };

  return (
    <Card title="🌌 Hubble Lab: Measure the age of the universe" subtitle="横軸：銀河団までの距離（Mpc）／縦軸：遠ざかる速さ（km/s）。点は実在の7つの銀河団。直線の傾きを合わせよう。">
      <div className="rounded-xl overflow-hidden border border-white/10 bg-space-950">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full block" role="img" aria-label="Hubble diagram">
          <rect width={W} height={H} fill="#070A1A" />
          {/* axes */}
          <line x1={pad.l} y1={H - pad.b} x2={W - pad.r} y2={H - pad.b} stroke="#475569" />
          <line x1={pad.l} y1={pad.t} x2={pad.l} y2={H - pad.b} stroke="#475569" />
          {[0, 100, 200, 300].map((d) => (
            <g key={d}>
              <line x1={sx(d)} y1={H - pad.b} x2={sx(d)} y2={H - pad.b + 4} stroke="#475569" />
              <text x={sx(d)} y={H - pad.b + 14} fontSize="8" fill="#94a3b8" textAnchor="middle">{d}</text>
            </g>
          ))}
          {[0, 10000, 20000].map((v) => (
            <g key={v}>
              <line x1={pad.l - 4} y1={sy(v)} x2={pad.l} y2={sy(v)} stroke="#475569" />
              <text x={pad.l - 6} y={sy(v) + 3} fontSize="8" fill="#94a3b8" textAnchor="end">{v / 1000}k</text>
            </g>
          ))}
          <text x={W / 2} y={H - 4} fontSize="8" fill="#94a3b8" textAnchor="middle">Distance 距離 (Mpc)</text>
          <text x={10} y={H / 2} fontSize="8" fill="#94a3b8" textAnchor="middle" transform={`rotate(-90 10 ${H / 2})`}>Velocity 速さ (km/s)</text>
          {/* student line */}
          <line x1={sx(0)} y1={sy(0)} x2={sx(maxD)} y2={sy(Math.min(maxV, h0 * maxD))} stroke={good ? '#34d399' : '#E27A2D'} strokeWidth="2" />
          {/* data */}
          {HUBBLE_DATA.map((g) => (
            <g key={g.name}>
              <circle cx={sx(g.distanceMpc)} cy={sy(g.velocityKms)} r="4" fill="#7DD3FC" stroke="#fff" strokeWidth=".8" />
              <text x={sx(g.distanceMpc) + 6} y={sy(g.velocityKms) - 5} fontSize="7" fill="#cbd5e1">{g.name.replace(' Cluster', '')}</text>
            </g>
          ))}
        </svg>
      </div>

      <div className="mt-4">
        <label className="text-sm text-slate-300 font-medium">Slope 傾き = H₀ : <span className="font-display text-white">{fmt(h0, 0)} km/s/Mpc</span></label>
        <input type="range" min={30} max={110} step={1} value={h0} onChange={(e) => setH0(parseInt(e.target.value, 10))} className="w-full accent-orange-500 mt-2" />
      </div>

      <div className="grid grid-cols-3 gap-3 mt-4">
        <Stat label="Fit score 当てはまり" value={`${fitScore}`} hint={good ? 'Great fit!' : 'Move the slider'} />
        <Stat label="1 / H₀ = Hubble time" value={`${fmt(age, 1)} Gyr`} hint="= 977.8 ÷ H₀" />
        <Stat label="Age of the universe" value={`${fmt(age, 1)} billion yrs`} hint="(simple expansion model)" />
      </div>

      <div className="mt-4 text-xs text-slate-400 space-y-1">
        <p>・プロの最新値は H₀ ≈ 67〜73。あなたの値がこの範囲なら、本物の天文学者と同じ答えです。</p>
        <p>・本当の宇宙は途中で膨張の速さが変わったので、精密な年齢は 137.9 億年（Planck 2018）。単純モデルでもほぼ一致するのは偶然ではなく、加速と減速が打ち消し合っているため。</p>
      </div>

      <div className="mt-4 flex items-center gap-3 flex-wrap">
        <button onClick={record} className="rounded-xl bg-brand-orange px-4 py-2 text-sm font-bold text-white hover:bg-orange-500">Record my measurement</button>
        {locked && <span className="text-emerald-300 text-sm">✅ {locked}</span>}
      </div>

      <details className="mt-4 text-xs text-slate-400">
        <summary className="cursor-pointer text-slate-300">Data table データ表（出典：NASA/IPAC NED 等の公開値を教育用に丸め）</summary>
        <table className="mt-2 w-full text-left">
          <thead><tr className="text-slate-500"><th className="py-1">Cluster</th><th>Distance (Mpc)</th><th>Velocity (km/s)</th></tr></thead>
          <tbody>
            {HUBBLE_DATA.map((g) => (
              <tr key={g.name} className="border-t border-white/5"><td className="py-1">{g.name} <span className="text-slate-500">{g.nameJa}</span></td><td>{g.distanceMpc}</td><td>{g.velocityKms.toLocaleString()}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </Card>
  );
};
