import React, { useEffect, useState } from 'react';
import { api } from '../../services/api';
import type { StudentSession } from '../../services/session';
import type { AskQuestion } from '../../types';
import { Button, Card, Input } from '../ui';

/**
 * 「UCLAの研究者に聞く」——生徒の質問を集め、月1のライブ配信で代表（UCLA天文物理）が答える。
 * 他社が真似できない差別化の核。1対多でスケールする。
 */
export const AskUcla: React.FC<{ s: StudentSession }> = ({ s }) => {
  const [q, setQ] = useState('');
  const [list, setList] = useState<AskQuestion[]>([]);
  const [sent, setSent] = useState(false);

  const load = () => api.studentQuestions(s.student.id).then(setList).catch(() => {});
  useEffect(() => {
    load();
  }, [s.student.id]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    await api.askQuestion(s.student.id, q.trim());
    setQ('');
    setSent(true);
    load();
  };

  const answered = list.filter((x) => x.answer);

  return (
    <Card title="🎓 Ask a UCLA astrophysicist" subtitle="宇宙のこと、なんでも質問OK（日本語でも英語でも）。月1回のライブで、UCLAで宇宙を研究している先生が答えます。">
      <form onSubmit={send} className="flex gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Why is space dark? / ブラックホールの中はどうなってる？" maxLength={300} />
        <Button type="submit" disabled={!q.trim()}>
          Send
        </Button>
      </form>
      {sent && <p className="text-emerald-300 text-sm mt-2">送信しました！次のライブで取り上げられるかも。</p>}
      {answered.length > 0 && (
        <div className="mt-4 space-y-3">
          <div className="text-xs text-slate-400">Answered 回答済み</div>
          {answered.slice(-3).map((x) => (
            <div key={x.id} className="rounded-xl bg-space-900/60 border border-white/5 p-3 text-sm">
              <div className="text-slate-300">
                <span className="text-slate-500">{x.nickname}:</span> {x.question}
              </div>
              <div className="text-emerald-200 mt-1">🎓 {x.answer}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};
