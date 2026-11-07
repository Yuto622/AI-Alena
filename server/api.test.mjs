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

test('sky: geocode fallback, passes and sun times are sane for Tokyo', async () => {
  const { geocode, issPasses, sunTimes } = await import('./sky.mjs');
  const g = await geocode('東京都渋谷区神南1-11-4');
  assert.ok(Math.abs(g.lat - 35.66) < 0.2 && Math.abs(g.lon - 139.7) < 0.2);
  const { passes } = await issPasses({ lat: g.lat, lon: g.lon, days: 3 });
  assert.ok(passes.length >= 1, 'at least one ISS pass in 3 days');
  for (const p of passes) {
    assert.ok(p.maxElevation >= 10 && p.maxElevation <= 90);
    assert.ok(p.durationMin >= 2 && p.durationMin <= 15);
  }
  const s = sunTimes({ lat: g.lat, lon: g.lon, date: new Date('2026-06-21T03:00:00Z') });
  assert.ok(s.dayLengthMin > 800 && s.dayLengthMin < 900, `summer solstice day length ${s.dayLengthMin}`);
  assert.ok(s.noonElevation > 75 && s.noonElevation < 80, `solstice noon elevation ${s.noonElevation}`);
});
