// node --test server/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMissions } from './missions-loader.mjs';

test('missions load and are internally consistent', async () => {
  const missions = await loadMissions();
  assert.equal(missions.length, 8);
  for (const m of missions) {
    assert.equal(m.quiz.length, 6, `${m.id} has 6 quiz questions`);
    for (const q of m.quiz) {
      assert.equal(q.choices.length, 4, `${m.id}/${q.id} 4 choices`);
      assert.ok(q.answerIndex >= 0 && q.answerIndex < 4, `${m.id}/${q.id} answerIndex`);
    }
    assert.equal(m.briefing.simple.length, m.briefing.ja.length, `${m.id} JP translation aligns with simple EN`);
    assert.ok(m.vocab.length >= 8);
    assert.ok(m.teacherScript.length >= 5);
  }
  const weeks = missions.map((m) => m.week).sort((a, b) => a - b);
  assert.deepEqual(weeks, [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('rules-based speaking feedback works without API key', async () => {
  delete process.env.GEMINI_API_KEY;
  const { speakingFeedback } = await import('./ai.mjs');
  const missions = await loadMissions();
  const out = await speakingFeedback({ text: 'I see the blue Earth. The ISS is fast. I want to float and see the sunrise.', level: 1, mission: missions[0] });
  assert.ok(out.score >= 3);
  assert.ok(out.feedback.length > 10);
  assert.ok(out.usedWords.includes('Earth'));
});
