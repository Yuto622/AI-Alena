import React, { useEffect, useMemo, useRef, useState } from 'react';
import { transitDepth, fmt } from '../../lib/astro';
import { Card, Stat } from '../ui';

/**
 * 系外惑星トランジットシミュレータ。
 * 惑星の大きさ（地球半径単位）を変えると、星の前を通過する時の減光（光度曲線）が変わる。
 */
export const TransitLab: React.FC<{ onResult?: (text: string) => void }> = ({ onResult }) => {
  const [radius, setRadius] = useState(11); // Jupiter ≈ 11 R_earth
  const [t, setT] = useState(0); // 0..1 アニメーション位相
  const raf = useRef<number | null>(null);
  const depth = useMemo(() => transitDepth(radius), [radius]);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let last = performance.now();
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setT((p) => (p + dt / 6) % 1);
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, []);

  // 幾何：星は半径 60、惑星は半径 60*(Rp/R*)（見やすさのため最低 2px）
  const W = 360;
  const H = 150;
  const starR = 50;
  const starX = W / 2;
  const starY = 70;
  const planetR = Math.max(2, starR * (radius / 109.1));
  const px = -40 + t * (W + 80);
  const py = starY + 6;

  // 光度曲線：惑星が星に重なっている区間だけ暗くなる（簡易：重なり面積を矩形近似せず、中心距離で判定）
  const curve = useMemo(() => {
    const pts: string[] = [];
    const N = 120;
    for (let i = 0; i <= N; i++) {
      const tt = i / N;
      const x = -40 + tt * (W + 80);
      const d = Math.abs(x - starX);
      let f = 1;
      if (d < starR + planetR) {
        // 重なり割合（線形近似）
        const overlap = Math.min(1, (starR + planetR - d) / (2 * planetR));
        f = 1 - depth * overlap;
      }
      // SVG は下向きが正。通過中は「下に」へこむ。深さは見やすいようスケール
      const yy = 8 + ((1 - f) / Math.max(depth, 0.0005)) * 32;
      pts.push(`${(i / N) * W},${Number.isFinite(yy) ? yy : 8}`);
    }
    return pts.join(' ');
  }, [depth, planetR]);

  const nowDim = (() => {
    const d = Math.abs(px - starX);
    if (d >= starR + planetR) return 0;
    return depth * Math.min(1, (starR + planetR - d) / (2 * planetR));
  })();

  const preset = (r: number) => setRadius(r);

  const submit = () => {
    const label = radius >= 9 ? 'Jupiter-size' : radius >= 3 ? 'Neptune-size' : radius >= 1.5 ? 'super-Earth' : 'Earth-size';
    const txt = `Transit depth ${fmt(depth * 100, 3)}% for a ${label} planet (${fmt(radius, 1)} R⊕)`;
    setDone(txt);
    onResult?.(txt);
  };

  return (
    <Card title="🪐 Transit Simulator" subtitle="惑星が星の前を通ると、星の光がどれだけ暗くなるか。本物の観測と同じ式 (Rp/R★)² を使っています。">
      <div className="rounded-xl overflow-hidden border border-white/10 bg-space-950">
        <svg viewBox={`0 0 ${W} ${H + 60}`} className="w-full block" role="img" aria-label="transit animation and light curve">
          <defs>
            <radialGradient id="starG" cx="50%" cy="50%">
              <stop offset="0%" stopColor="#FFF3C4" />
              <stop offset="70%" stopColor="#F5B544" />
              <stop offset="100%" stopColor="#E27A2D" />
            </radialGradient>
          </defs>
          <rect width={W} height={H + 60} fill="#070A1A" />
          <circle cx={starX} cy={starY} r={starR} fill="url(#starG)" opacity={1 - nowDim * 8} />
          <circle cx={px} cy={py} r={planetR} fill="#0B1026" stroke="rgba(255,255,255,.35)" strokeWidth="0.8" />
          {/* light curve */}
          <g transform={`translate(0, ${H + 10})`}>
            <rect width={W} height="50" fill="rgba(255,255,255,.03)" />
            <text x="6" y="12" fontSize="8" fill="#94a3b8" fontFamily="Space Grotesk">Brightness 明るさ</text>
            <polyline points={curve} fill="none" stroke="#7DD3FC" strokeWidth="1.5" />
            <line x1={t * W} y1="0" x2={t * W} y2="50" stroke="rgba(226,122,45,.8)" strokeDasharray="2 2" />
          </g>
        </svg>
      </div>

      <div className="mt-4">
        <label className="text-sm text-slate-300 font-medium">Planet size 惑星の大きさ：{fmt(radius, 1)} × Earth</label>
        <input type="range" min={0.5} max={15} step={0.1} value={radius} onChange={(e) => setRadius(parseFloat(e.target.value))} className="w-full accent-orange-500 mt-2" />
        <div className="flex flex-wrap gap-2 mt-2">
          <button onClick={() => preset(1)} className="rounded-lg bg-white/5 px-3 py-1 text-xs hover:bg-white/10">🌍 Earth (1.0)</button>
          <button onClick={() => preset(3.9)} className="rounded-lg bg-white/5 px-3 py-1 text-xs hover:bg-white/10">🔵 Neptune (3.9)</button>
          <button onClick={() => preset(11.2)} className="rounded-lg bg-white/5 px-3 py-1 text-xs hover:bg-white/10">🟠 Jupiter (11.2)</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mt-4">
        <Stat label="Transit depth 減光" value={`${fmt(depth * 100, depth < 0.001 ? 4 : 2)}%`} hint="= (Rp / R★)²" />
        <Stat label="Right now" value={nowDim > 0 ? 'Transit!' : 'Star is bright'} hint={nowDim > 0 ? `−${fmt(nowDim * 100, 3)}%` : 'waiting for the planet'} />
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button onClick={submit} className="rounded-xl bg-brand-orange px-4 py-2 text-sm font-bold text-white hover:bg-orange-500">Record my planet</button>
        {done && <span className="text-emerald-300 text-sm">✅ {done}</span>}
      </div>
      <p className="text-xs text-slate-500 mt-3">Kepler 宇宙望遠鏡は、この 0.01% 級の減光を数年間見続けて 2,700 個以上の惑星を見つけました。</p>
    </Card>
  );
};
