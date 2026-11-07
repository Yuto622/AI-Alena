// ============================================================================
// AI 層：Gemini（GEMINI_API_KEY がある時）／ルールベース（無い時）。
// どちらでも同じ形の結果を返すので、デモ環境でも UI が落ちない。
// ============================================================================
import { GoogleGenAI } from '@google/genai';

const apiKey = process.env.GEMINI_API_KEY || '';
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const client = apiKey ? new GoogleGenAI({ apiKey }) : null;

export const aiEnabled = () => Boolean(client);

async function generate(system, prompt, { json = false } = {}) {
  const res = await client.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      systemInstruction: system,
      temperature: 0.6,
      ...(json ? { responseMimeType: 'application/json' } : {}),
    },
  });
  return res.text || '';
}

const LEVEL_DESC = {
  1: 'Eiken Grade 5 (about 9-10 years old, present tense, ~300 words known)',
  2: 'Eiken Grade 4 (about 11-12 years old, simple past, ~600 words)',
  3: 'Eiken Grade 3 (about 13 years old, comparatives, simple relative clauses)',
};

// ---------------------------------------------------------------------------
// 1) Speaking / writing feedback
// ---------------------------------------------------------------------------
export async function speakingFeedback({ text, level, mission }) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const used = mission.speaking.targetWords.filter((w) => new RegExp(`\\b${w}\\b`, 'i').test(text));

  if (!client) {
    // ルールベース：語数と目標語の使用で 1〜5 点
    let score = 1;
    if (words.length >= 5) score++;
    if (words.length >= 12) score++;
    if (used.length >= 2) score++;
    if (used.length >= 4 && words.length >= 20) score++;
    const missing = mission.speaking.targetWords.filter((w) => !used.includes(w)).slice(0, 2);
    const feedback = [
      `Nice work! You wrote ${words.length} words and used ${used.length} mission word${used.length === 1 ? '' : 's'}${used.length ? ` (${used.join(', ')})` : ''}.`,
      missing.length ? `Next time, try to use: ${missing.join(', ')}.` : 'You used all the mission words. Amazing!',
      'Keep talking about space in English!',
    ].join(' ');
    return { score, feedback, usedWords: used, source: 'rules' };
  }

  const system = `You are "Commander", a warm space-mission controller who is also a UCLA astrophysics researcher. You give feedback to Japanese children learning English. Level: ${LEVEL_DESC[level] || LEVEL_DESC[1]}. Rules: Reply in simple English a child at that level can read. Max 3 sentences. Praise one specific thing, correct at most ONE mistake gently by showing the better sentence, and suggest one mission word to use next time. Never mention grammar terms. Be accurate about space science.`;
  const prompt = `Mission: ${mission.title}\nQuestion asked to the child: ${mission.speaking.prompt}\nTarget words: ${mission.speaking.targetWords.join(', ')}\nChild's answer: """${text}"""\n\nReturn JSON: {"score": 1-5 integer (effort + clarity + target words, be generous), "feedback": string}`;
  try {
    const raw = await generate(system, prompt, { json: true });
    const parsed = JSON.parse(raw);
    return {
      score: Math.min(5, Math.max(1, Number(parsed.score) || 3)),
      feedback: String(parsed.feedback || '').slice(0, 600),
      usedWords: used,
      source: 'gemini',
    };
  } catch (err) {
    console.error('speakingFeedback gemini error', err?.message);
    return speakingFeedbackFallback(text, level, mission);
  }
}

function speakingFeedbackFallback(text, _level, mission) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const used = mission.speaking.targetWords.filter((w) => new RegExp(`\\b${w}\\b`, 'i').test(text));
  return {
    score: Math.min(5, 1 + Math.floor(words.length / 6) + (used.length >= 2 ? 1 : 0)),
    feedback: `Good job! You used ${used.length} mission words. Try one more sentence next time.`,
    usedWords: used,
    source: 'rules-after-error',
  };
}

// ---------------------------------------------------------------------------
// 2) Commander chat（音声会話用）
// ---------------------------------------------------------------------------
export async function commanderChat({ history, level, mission, nickname }) {
  const last = history[history.length - 1]?.text || '';
  if (!client) {
    const canned = [
      `Good question, ${nickname}! On this mission we learn about ${mission.title.toLowerCase()}. What do you see?`,
      `Roger that, ${nickname}. Tell me one more thing in English.`,
      `Great English! Remember: ${mission.facts[0].label.split(' ')[0]} is ${mission.facts[0].value}. Can you say it?`,
      `Mission Control copies. Try using the word "${mission.speaking.targetWords[0]}" in a sentence.`,
    ];
    const idx = history.filter((h) => h.role === 'user').length % canned.length;
    return { text: canned[idx], source: 'rules' };
  }
  const system = `You are "Commander", mission controller at U-Space and a UCLA astrophysics researcher. You talk by voice with a Japanese child named ${nickname}. English level: ${LEVEL_DESC[level] || LEVEL_DESC[1]}. Current mission: ${mission.title} — ${mission.briefing.advanced.join(' ')} Facts you may use: ${mission.facts.map((f) => `${f.label}: ${f.value}`).join('; ')}.
Rules: 1-2 short sentences per turn, simple words, always end with a question that invites the child to speak more. Stay scientifically accurate; if the child says something wrong about space, gently correct it in one simple sentence. Never switch to Japanese unless the child writes only Japanese; then answer in English and add a 5-word Japanese hint in parentheses.`;
  const transcript = history
    .slice(-8)
    .map((h) => `${h.role === 'user' ? nickname : 'Commander'}: ${h.text}`)
    .join('\n');
  try {
    const text = await generate(system, `${transcript}\nCommander:`);
    return { text: text.trim().slice(0, 400), source: 'gemini' };
  } catch (err) {
    console.error('commanderChat gemini error', err?.message);
    return { text: `Copy that, ${nickname}. Tell me more!`, source: 'rules-after-error' };
  }
}

// ---------------------------------------------------------------------------
// 3) 保護者向けレポート（U-Speak の個別AIレポートと同じ役割）
// ---------------------------------------------------------------------------
export async function parentReport({ student, results, missions, classroomName }) {
  const done = results.map((r) => {
    const m = missions.find((x) => x.id === r.missionId);
    return { ...r, title: m?.titleJa || r.missionId, titleEn: m?.title || r.missionId };
  });
  const quizPct = done.length
    ? Math.round((100 * done.reduce((a, r) => a + r.quizScore, 0)) / done.reduce((a, r) => a + r.quizTotal, 0))
    : 0;
  const spk = done.filter((r) => r.speakingScore);
  const spkAvg = spk.length ? (spk.reduce((a, r) => a + r.speakingScore, 0) / spk.length).toFixed(1) : '-';
  const highlights = done.filter((r) => r.labResult).map((r) => `・${r.title}：${r.labResult}`);
  const bestSpeaking = spk.sort((a, b) => b.speakingScore - a.speakingScore)[0];

  const header = `【U-Space 学習レポート】${classroomName}\nお名前：${student.nickname} さん（レベル：${['', 'Cadet', 'Pilot', 'Commander'][student.level]}）\n完了ミッション：${done.length} / 8　クイズ正答率：${quizPct}%　スピーキング平均：${spkAvg} / 5`;

  if (!client) {
    const body = [
      header,
      '',
      '■ 今月のハイライト',
      ...(highlights.length ? highlights : ['・初回ミッションに取り組みました。']),
      '',
      '■ 英語で話せたこと（実際の発話）',
      bestSpeaking ? `「${bestSpeaking.speakingText}」（${bestSpeaking.titleEn}）` : '（次回から記録されます）',
      '',
      '■ ご家庭でのひとこと',
      `「${done[done.length - 1]?.title || '宇宙'}のこと、英語で教えて？」と聞いてみてください。お子さんが自分の言葉で説明できることが、この講座のゴールです。`,
      '',
      '監修：合同会社U-Speak Lab（UCLA 天文物理・制御理論 研究）',
    ].join('\n');
    return { text: body, source: 'rules' };
  }

  const system = `あなたは U-Space（合同会社U-Speak Lab）の講師アシスタントです。英会話教室の保護者向け月次レポートを日本語で書きます。丁寧・温かい・具体的。400字以内。見出しは「■ 今月のハイライト」「■ 英語で話せたこと」「■ ご家庭でのひとこと」の3つ。数値や発話は与えられたデータから引用し、創作しない。宇宙の科学的事実は正確に。`;
  const prompt = `${header}\n\n完了ミッション一覧:\n${done.map((r) => `- ${r.title} (${r.titleEn}) クイズ ${r.quizScore}/${r.quizTotal}${r.labResult ? ` / Data Lab: ${r.labResult}` : ''}${r.speakingText ? ` / 発話: "${r.speakingText}" (AI評価 ${r.speakingScore}/5)` : ''}`).join('\n')}`;
  try {
    const text = await generate(system, prompt);
    return { text: `${header}\n\n${text.trim()}\n\n監修：合同会社U-Speak Lab（UCLA 天文物理・制御理論 研究）`, source: 'gemini' };
  } catch (err) {
    console.error('parentReport gemini error', err?.message);
    return { text: `${header}\n\n（AIコメントの生成に失敗しました。時間をおいて再試行してください）`, source: 'rules-after-error' };
  }
}
