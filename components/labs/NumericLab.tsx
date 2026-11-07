import React, { useState } from 'react';
import { Card } from '../ui';

export const NumericLab: React.FC<{
  title: string;
  prompt: string;
  answer: number;
  tolerance: number;
  unit: string;
  hint: string;
  onResult?: (text: string) => void;
}> = ({ title, prompt, answer, tolerance, unit, hint, onResult }) => {
  const [v, setV] = useState('');
  const [state, setState] = useState<null | 'ok' | 'no'>(null);
  const [tries, setTries] = useState(0);

  const check = () => {
    const n = parseFloat(v.replace(/,/g, ''));
    const ok = Number.isFinite(n) && Math.abs(n - answer) <= tolerance;
    setTries((t) => t + 1);
    setState(ok ? 'ok' : 'no');
    if (ok) onResult?.(`${title}: ${n} ${unit}`);
  };

  return (
    <Card title={`🧮 Data Lab: ${title}`} subtitle="電卓OK。本物の数字で、本物の計算をします。">
      <p className="text-slate-100 leading-relaxed">{prompt}</p>
      <div className="flex gap-2 mt-4 items-center">
        <input value={v} onChange={(e) => setV(e.target.value)} inputMode="decimal" placeholder={unit} className="w-44 rounded-xl bg-space-950 border border-white/10 px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-orange/70" />
        <span className="text-slate-400 text-sm">{unit}</span>
        <button onClick={check} className="rounded-xl bg-brand-orange px-4 py-2 text-sm font-bold text-white hover:bg-orange-500">Check</button>
      </div>
      {state === 'ok' && <p className="mt-3 text-emerald-300 text-sm">✅ Correct! {answer} {unit}. Mission data recorded.</p>}
      {state === 'no' && (
        <p className="mt-3 text-rose-300 text-sm">
          Not yet. {tries >= 2 ? <span className="text-slate-300">Hint: {hint}</span> : 'Try again!'}
        </p>
      )}
    </Card>
  );
};
