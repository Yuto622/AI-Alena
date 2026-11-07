import React, { useState } from 'react';
import { api } from '../../services/api';
import { session } from '../../services/session';
import { navigate } from '../../lib/router';
import { LEVEL_LABEL, type Level } from '../../types';
import { Button, Card, Input, Spinner } from '../ui';

export const StudentJoin: React.FC = () => {
  const [code, setCode] = useState('');
  const [nickname, setNickname] = useState('');
  const [level, setLevel] = useState<Level>(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await api.join(code, nickname, level);
      session.setStudent(res);
      navigate('/student');
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-md mx-auto">
      <Card title="🚀 Mission Login" subtitle="先生から教えてもらった4桁の教室コードを入れよう">
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="text-xs text-slate-400">Classroom code 教室コード</label>
            <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" placeholder="1234" className="font-display text-2xl tracking-[.4em] text-center" required />
          </div>
          <div>
            <label className="text-xs text-slate-400">Your name ニックネーム（英語でもOK）</label>
            <Input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Haru" maxLength={20} required />
          </div>
          <div>
            <label className="text-xs text-slate-400">Level レベル（あとで先生が変えられます）</label>
            <div className="grid grid-cols-3 gap-2 mt-1">
              {([1, 2, 3] as Level[]).map((lv) => (
                <button type="button" key={lv} onClick={() => setLevel(lv)} className={`rounded-xl border px-2 py-3 text-xs font-bold transition ${level === lv ? 'border-brand-orange bg-orange-500/15 text-orange-200' : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'}`}>
                  {LEVEL_LABEL[lv].split('（')[0]}
                  <div className="text-[10px] font-normal text-slate-400 mt-1">{LEVEL_LABEL[lv].match(/（(.*)）/)?.[1]}</div>
                </button>
              ))}
            </div>
          </div>
          {err && <p className="text-rose-300 text-sm">{err}</p>}
          <Button type="submit" disabled={busy || code.length !== 4 || !nickname.trim()} className="w-full py-3">
            {busy ? <Spinner /> : 'Launch 🚀'}
          </Button>
          <p className="text-[11px] text-slate-500 text-center">体験用コード：1234（デモ教室）</p>
        </form>
      </Card>
    </div>
  );
};
