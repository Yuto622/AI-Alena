import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../services/api';
import { listenOnce, speak, speechSupported } from '../../lib/speech';
import type { ChatTurn, Mission } from '../../types';
import type { StudentSession } from '../../services/session';
import { Button, Spinner } from '../ui';

/** AI管制官との英語音声会話。マイク→文字→AI→読み上げ。 */
export const CommanderChat: React.FC<{ mission: Mission; s: StudentSession; onTranscript?: (t: string) => void }> = ({ mission, s, onTranscript }) => {
  const [history, setHistory] = useState<ChatTurn[]>([{ role: 'commander', text: `Mission Control to ${s.student.nickname}. ${mission.speaking.prompt.split('.')[0]}. Over.` }]);
  const [draft, setDraft] = useState('');
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [voiceOn, setVoiceOn] = useState(true);
  const stopRef = useRef<() => void>(() => {});
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight });
  }, [history]);

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    setErr(null);
    const next = [...history, { role: 'user', text: t } as ChatTurn];
    setHistory(next);
    setDraft('');
    onTranscript?.(next.filter((h) => h.role === 'user').map((h) => h.text).join(' '));
    setBusy(true);
    try {
      const r = await api.commander(next, s.student.level, mission.id, s.student.nickname);
      setHistory((h) => [...h, { role: 'commander', text: r.text }]);
      if (voiceOn) speak(r.text);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const mic = () => {
    if (listening) {
      stopRef.current();
      return;
    }
    setErr(null);
    setListening(true);
    let finalText = '';
    stopRef.current = listenOnce(
      (t, isFinal) => {
        setDraft(t);
        if (isFinal) finalText = t;
      },
      () => {
        setListening(false);
        if (finalText.trim()) send(finalText);
      },
      (msg) => {
        setListening(false);
        setErr(msg);
      },
    );
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-space-950/70 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-space-900/60">
        <div className="flex items-center gap-2 text-sm">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-display text-white">COMMANDER · Mission Control</span>
        </div>
        <label className="text-xs text-slate-400 flex items-center gap-1 cursor-pointer">
          <input type="checkbox" checked={voiceOn} onChange={(e) => setVoiceOn(e.target.checked)} /> voice
        </label>
      </div>
      <div ref={boxRef} className="h-56 overflow-y-auto custom-scrollbar p-4 space-y-3">
        {history.map((h, i) => (
          <div key={i} className={`flex ${h.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${h.role === 'user' ? 'bg-brand-orange text-white' : 'bg-white/10 text-slate-100'}`}>
              {h.role === 'commander' && <span className="mr-1">🎧</span>}
              {h.text}
              {h.role === 'commander' && (
                <button onClick={() => speak(h.text)} className="ml-2 text-xs opacity-70 hover:opacity-100" title="もう一度聞く">
                  🔊
                </button>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-white/10 px-3.5 py-2 text-sm text-slate-300 flex items-center gap-2">
              <Spinner /> Commander is thinking…
            </div>
          </div>
        )}
      </div>
      <div className="p-3 border-t border-white/10 flex gap-2">
        <button onClick={mic} className={`rounded-xl px-3 py-2 text-sm font-bold border ${listening ? 'bg-rose-600 border-rose-400 text-white animate-pulse' : 'bg-white/5 border-white/10 text-slate-100 hover:bg-white/10'}`} title={speechSupported() ? '押して話す' : '音声非対応'}>
          {listening ? '■ Stop' : '🎤 Speak'}
        </button>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send(draft)}
          placeholder={listening ? 'Listening…' : 'Type in English…'}
          className="flex-1 rounded-xl bg-space-900 border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-orange/70"
        />
        <Button onClick={() => send(draft)} disabled={!draft.trim() || busy}>
          Send
        </Button>
      </div>
      {err && <div className="px-4 pb-3 text-xs text-rose-300">{err}</div>}
      {!speechSupported() && <div className="px-4 pb-3 text-[11px] text-slate-500">このブラウザは音声入力に対応していません（Chrome / Edge / Safari を推奨）。文字で話しかけられます。</div>}
    </div>
  );
};
