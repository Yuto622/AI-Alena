// ============================================================================
// ブラウザ音声（Web Speech API）。非対応環境ではテキスト入力にフォールバック。
// ============================================================================

type SR = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
};

declare global {
  interface Window {
    SpeechRecognition?: new () => SR;
    webkitSpeechRecognition?: new () => SR;
  }
}

export function speechSupported() {
  return typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function listenOnce(onText: (t: string, final: boolean) => void, onEnd: () => void, onError: (msg: string) => void) {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Ctor) {
    onError('このブラウザは音声入力に対応していません。文字で入力してください。');
    return () => {};
  }
  const rec = new Ctor();
  rec.lang = 'en-US';
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  rec.continuous = false;
  rec.onresult = (e) => {
    const r = e.results[e.results.length - 1];
    onText(r[0].transcript, (r as unknown as { isFinal?: boolean }).isFinal ?? false);
  };
  rec.onend = onEnd;
  rec.onerror = (e) => onError(e.error === 'not-allowed' ? 'マイクの使用が許可されていません。' : `音声エラー: ${e.error}`);
  rec.start();
  return () => rec.stop();
}

export function speak(text: string, lang = 'en-US') {
  if (typeof speechSynthesis === 'undefined') return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = 0.92;
  const voices = speechSynthesis.getVoices();
  const en = voices.find((v) => v.lang === lang && /Google|Samantha|Daniel|Karen|Aria|Jenny/i.test(v.name)) || voices.find((v) => v.lang.startsWith('en'));
  if (en) u.voice = en;
  speechSynthesis.speak(u);
}
