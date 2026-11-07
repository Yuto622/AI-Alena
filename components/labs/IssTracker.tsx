import React, { useEffect, useState } from 'react';
import { api } from '../../services/api';
import type { IssPosition } from '../../types';
import { Card, Pill, Stat } from '../ui';
import { fmt } from '../../lib/astro';

// 超簡略の大陸シルエット（等経緯度）。正確な地図ではなく「どのあたり」を掴むため。
const LAND: [number, number, number, number][] = [
  // [lonMin, lonMax, latMin, latMax]
  [-125, -70, 30, 50], // 北米
  [-105, -80, 15, 30],
  [-80, -35, -55, 10], // 南米
  [-10, 40, 35, 60], // ヨーロッパ
  [-15, 50, -35, 35], // アフリカ
  [40, 140, 45, 70], // ロシア
  [60, 120, 10, 45], // アジア中部
  [100, 145, 20, 45], // 中国・日本
  [95, 125, -10, 20], // 東南アジア
  [115, 150, -40, -12], // オーストラリア
];

export const IssTracker: React.FC<{ onResult?: (text: string) => void }> = ({ onResult }) => {
  const [pos, setPos] = useState<IssPosition | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [orbitsGuess, setOrbitsGuess] = useState('');
  const [checked, setChecked] = useState<null | boolean>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const p = await api.iss();
        if (alive) {
          setPos(p);
          setErr(null);
        }
      } catch (e) {
        if (alive) setErr((e as Error).message);
      }
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const x = pos ? ((pos.longitude + 180) / 360) * 360 : 0;
  const y = pos ? ((90 - pos.latitude) / 180) * 180 : 0;

  const check = () => {
    const v = parseFloat(orbitsGuess);
    const ok = Number.isFinite(v) && Math.abs(v - 15.7) <= 0.8;
    setChecked(ok);
    if (ok) onResult?.('ISS orbits/day ≈ 15.7（24h ÷ 92min）');
  };

  return (
    <Card title="🛰️ Live: Where is the ISS right now?" subtitle="5秒ごとに本物の位置データを受信しています（wheretheiss.at）">
      <div className="rounded-xl overflow-hidden border border-white/10 bg-space-950">
        <svg viewBox="0 0 360 180" className="w-full h-auto block" role="img" aria-label="ISS position on world map">
          <defs>
            <pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse">
              <path d="M30 0H0V30" fill="none" stroke="rgba(255,255,255,.06)" strokeWidth=".5" />
            </pattern>
          </defs>
          <rect width="360" height="180" fill="#0B1026" />
          <rect width="360" height="180" fill="url(#grid)" />
          {LAND.map(([a, b, c, d], i) => (
            <rect key={i} x={a + 180} y={90 - d} width={b - a} height={d - c} rx="6" fill="rgba(42,58,114,.75)" />
          ))}
          <line x1="0" y1="90" x2="360" y2="90" stroke="rgba(255,255,255,.15)" strokeDasharray="2 3" />
          {pos && (
            <g>
              <circle cx={x} cy={y} r="10" fill="rgba(226,122,45,.25)">
                <animate attributeName="r" values="6;14;6" dur="2s" repeatCount="indefinite" />
              </circle>
              <circle cx={x} cy={y} r="3.5" fill="#E27A2D" stroke="#fff" strokeWidth="1" />
              <text x={x + 8} y={y - 6} fontSize="8" fill="#fff" fontFamily="Space Grotesk, sans-serif">
                ISS
              </text>
            </g>
          )}
        </svg>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
        <Stat label="Latitude 緯度" value={pos ? `${fmt(pos.latitude, 2)}°` : '…'} />
        <Stat label="Longitude 経度" value={pos ? `${fmt(pos.longitude, 2)}°` : '…'} />
        <Stat label="Altitude 高度" value={pos ? `${fmt(pos.altitude, 0)} km` : '…'} />
        <Stat label="Speed 速さ" value={pos ? `${fmt(pos.velocity, 0)} km/h` : '…'} hint={pos ? `= ${fmt(pos.velocity / 3600, 2)} km every second` : undefined} />
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
        {pos?.fallback ? <Pill tone="slate">オフライン近似（軌道モデル）</Pill> : <Pill tone="green">LIVE</Pill>}
        {pos && <span>Day/Night: {pos.visibility}</span>}
        {err && <span className="text-rose-300">{err}</span>}
      </div>

      <div className="mt-5 rounded-xl bg-space-900/70 border border-white/5 p-4">
        <div className="font-bold text-white">Data Lab: How many times does the ISS go around the Earth in ONE day?</div>
        <div className="text-sm text-slate-400 mt-1">1日は 24 × 60 = 1,440 分。1周は約 92 分。1,440 ÷ 92 = ?（小数第1位まで）</div>
        <div className="flex gap-2 mt-3">
          <input
            value={orbitsGuess}
            onChange={(e) => setOrbitsGuess(e.target.value)}
            inputMode="decimal"
            placeholder="e.g. 15.7"
            className="w-40 rounded-xl bg-space-950 border border-white/10 px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-orange/70"
          />
          <button onClick={check} className="rounded-xl bg-brand-orange px-4 py-2 text-sm font-bold text-white hover:bg-orange-500">
            Check
          </button>
        </div>
        {checked === true && <p className="mt-2 text-emerald-300 text-sm">✅ Correct! About 15.7 orbits — that's why astronauts see about 16 sunrises a day.</p>}
        {checked === false && <p className="mt-2 text-rose-300 text-sm">Not yet. Hint: 1,440 ÷ 92 ≈ 15.65</p>}
      </div>
    </Card>
  );
};
