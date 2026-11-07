// ============================================================================
// U-Space API + 静的配信（Cloud Run 1コンテナ構成）
// ============================================================================
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, ensureDemo } from './server/db.mjs';
import { aiEnabled, speakingFeedback, commanderChat, parentReport } from './server/ai.mjs';
import { loadMissions } from './server/missions-loader.mjs';

const app = express();
const port = Number(process.env.PORT || 8080);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(express.json({ limit: '200kb' }));

const MISSIONS = await loadMissions();
ensureDemo();

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const isCode = (s) => typeof s === 'string' && /^\d{4}$/.test(s);

function requireTeacher(req, res) {
  const code = req.header('x-classroom-code') || req.body?.code || req.query.code;
  const pin = req.header('x-classroom-pin') || req.body?.pin || req.query.pin;
  const c = isCode(code) ? db.getClassroom(code) : null;
  if (!c || c.pin !== String(pin)) {
    bad(res, '教室コードまたはPINが違います', 401);
    return null;
  }
  return c;
}

// ---------------------------------------------------------------------------
// health / meta
// ---------------------------------------------------------------------------
app.get('/api/health', (_req, res) => res.json({ status: 'ok', ai: aiEnabled() ? 'gemini' : 'rules', missions: MISSIONS.length }));

// ---------------------------------------------------------------------------
// ISS live position（wheretheiss.at を中継。失敗時は軌道モデルで近似）
// ---------------------------------------------------------------------------
let issCache = { at: 0, data: null };
app.get('/api/iss', async (_req, res) => {
  const nowMs = Date.now();
  if (issCache.data && nowMs - issCache.at < 5000) return res.json(issCache.data);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch('https://api.wheretheiss.at/v1/satellites/25544', { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error(`upstream ${r.status}`);
    const j = await r.json();
    const data = {
      latitude: j.latitude,
      longitude: j.longitude,
      altitude: j.altitude,
      velocity: j.velocity,
      visibility: j.visibility,
      timestamp: j.timestamp,
    };
    issCache = { at: nowMs, data };
    res.json(data);
  } catch (err) {
    // フォールバック：傾斜角51.6°・周期92.9分の円軌道で位置を近似（教室デモが止まらないように）
    const tSec = nowMs / 1000;
    const period = 92.9 * 60;
    const phase = ((tSec % period) / period) * 2 * Math.PI;
    const inc = (51.6 * Math.PI) / 180;
    const lat = (Math.asin(Math.sin(inc) * Math.sin(phase)) * 180) / Math.PI;
    const lonRaw = (Math.atan2(Math.cos(inc) * Math.sin(phase), Math.cos(phase)) * 180) / Math.PI - ((tSec % 86400) / 86400) * 360;
    const lon = ((lonRaw + 540) % 360) - 180;
    res.json({ latitude: lat, longitude: lon, altitude: 417, velocity: 27580, visibility: 'unknown', timestamp: Math.floor(tSec), fallback: true });
  }
});

// ---------------------------------------------------------------------------
// classrooms（生徒側：コードの存在確認／先生側：作成・取得）
// ---------------------------------------------------------------------------
app.get('/api/classrooms/:code/public', (req, res) => {
  const c = db.getClassroom(req.params.code);
  if (!c) return bad(res, '教室コードが見つかりません', 404);
  res.json({ code: c.code, name: c.name, unlockedWeeks: c.unlockedWeeks, plan: c.plan });
});

app.post('/api/classrooms', (req, res) => {
  const { name, plan } = req.body || {};
  if (!name || typeof name !== 'string') return bad(res, 'name is required');
  const c = db.createClassroom({ name: name.slice(0, 60), plan: ['standard', 'plus', 'premium'].includes(plan) ? plan : 'standard' });
  res.status(201).json(c);
});

app.post('/api/teacher/login', (req, res) => {
  const c = requireTeacher(req, res);
  if (!c) return;
  res.json(c);
});

app.get('/api/teacher/dashboard', (req, res) => {
  const c = requireTeacher(req, res);
  if (!c) return;
  res.json({
    classroom: c,
    students: db.listStudents(c.code),
    results: db.listResults(c.code),
    questions: db.listQuestions(c.code),
  });
});

app.patch('/api/teacher/classroom', (req, res) => {
  const c = requireTeacher(req, res);
  if (!c) return;
  const patch = {};
  if (Number.isInteger(req.body.unlockedWeeks)) patch.unlockedWeeks = Math.min(8, Math.max(1, req.body.unlockedWeeks));
  if (typeof req.body.name === 'string') patch.name = req.body.name.slice(0, 60);
  res.json(db.updateClassroom(c.code, patch));
});

app.post('/api/teacher/questions/:id/answer', (req, res) => {
  const c = requireTeacher(req, res);
  if (!c) return;
  const q = db.answerQuestion(req.params.id, String(req.body.answer || '').slice(0, 1000));
  if (!q || q.classroomCode !== c.code) return bad(res, 'not found', 404);
  res.json(q);
});

app.post('/api/teacher/report/:studentId', async (req, res) => {
  const c = requireTeacher(req, res);
  if (!c) return;
  const student = db.getStudent(req.params.studentId);
  if (!student || student.classroomCode !== c.code) return bad(res, 'student not found', 404);
  const results = db.listStudentResults(student.id);
  const out = await parentReport({ student, results, missions: MISSIONS, classroomName: c.name });
  res.json(out);
});

// ---------------------------------------------------------------------------
// students（コード＋ニックネームで参加。パスワード無し＝小学生向け）
// ---------------------------------------------------------------------------
app.post('/api/students/join', (req, res) => {
  const { code, nickname, level } = req.body || {};
  if (!isCode(code)) return bad(res, '4桁の教室コードを入力してください');
  const c = db.getClassroom(code);
  if (!c) return bad(res, '教室コードが見つかりません', 404);
  if (!nickname || typeof nickname !== 'string' || nickname.trim().length < 1) return bad(res, 'ニックネームを入力してください');
  const lv = [1, 2, 3].includes(Number(level)) ? Number(level) : 1;
  const s = db.upsertStudent({ classroomCode: code, nickname: nickname.trim().slice(0, 20), level: lv });
  res.json({ student: s, classroom: { code: c.code, name: c.name, unlockedWeeks: c.unlockedWeeks } });
});

app.get('/api/students/:id/results', (req, res) => {
  const s = db.getStudent(req.params.id);
  if (!s) return bad(res, 'not found', 404);
  res.json(db.listStudentResults(s.id));
});

app.post('/api/students/:id/results', (req, res) => {
  const s = db.getStudent(req.params.id);
  if (!s) return bad(res, 'not found', 404);
  const { missionId, quizScore, quizTotal, labResult, speakingText, speakingFeedback: fb, speakingScore } = req.body || {};
  if (!MISSIONS.some((m) => m.id === missionId)) return bad(res, 'unknown mission');
  const rec = db.addResult({
    studentId: s.id,
    classroomCode: s.classroomCode,
    missionId,
    quizScore: Number(quizScore) || 0,
    quizTotal: Number(quizTotal) || 0,
    labResult: typeof labResult === 'string' ? labResult.slice(0, 200) : undefined,
    speakingText: typeof speakingText === 'string' ? speakingText.slice(0, 1000) : undefined,
    speakingFeedback: typeof fb === 'string' ? fb.slice(0, 1000) : undefined,
    speakingScore: Number.isFinite(Number(speakingScore)) ? Number(speakingScore) : undefined,
  });
  res.status(201).json(rec);
});

app.post('/api/students/:id/questions', (req, res) => {
  const s = db.getStudent(req.params.id);
  if (!s) return bad(res, 'not found', 404);
  const q = String(req.body.question || '').trim();
  if (!q) return bad(res, 'question is required');
  res.status(201).json(db.addQuestion({ classroomCode: s.classroomCode, studentId: s.id, nickname: s.nickname, question: q.slice(0, 300) }));
});

app.get('/api/students/:id/questions', (req, res) => {
  const s = db.getStudent(req.params.id);
  if (!s) return bad(res, 'not found', 404);
  res.json(db.listQuestions(s.classroomCode));
});

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------
app.post('/api/ai/speaking', async (req, res) => {
  const { text, level, missionId } = req.body || {};
  const mission = MISSIONS.find((m) => m.id === missionId);
  if (!mission) return bad(res, 'unknown mission');
  if (!text || typeof text !== 'string') return bad(res, 'text is required');
  res.json(await speakingFeedback({ text: text.slice(0, 1500), level: Number(level) || 1, mission }));
});

app.post('/api/ai/commander', async (req, res) => {
  const { history, level, missionId, nickname } = req.body || {};
  const mission = MISSIONS.find((m) => m.id === missionId);
  if (!mission) return bad(res, 'unknown mission');
  if (!Array.isArray(history) || !history.length) return bad(res, 'history is required');
  const clean = history.slice(-12).map((h) => ({ role: h.role === 'user' ? 'user' : 'commander', text: String(h.text || '').slice(0, 500) }));
  res.json(await commanderChat({ history: clean, level: Number(level) || 1, mission, nickname: String(nickname || 'Cadet').slice(0, 20) }));
});

// ---------------------------------------------------------------------------
// leads（LPの資料請求フォーム → U-Speak の商談パイプへ）
// ---------------------------------------------------------------------------
app.post('/api/leads', (req, res) => {
  const { schoolName, contactName, email, students, type, message } = req.body || {};
  if (!schoolName || !contactName || !email) return bad(res, '教室名・お名前・メールは必須です');
  const lead = db.addLead({
    schoolName: String(schoolName).slice(0, 80),
    contactName: String(contactName).slice(0, 40),
    email: String(email).slice(0, 120),
    students: Number(students) || 0,
    type: ['英会話教室', '学習塾', '学童', 'その他'].includes(type) ? type : 'その他',
    message: message ? String(message).slice(0, 500) : undefined,
  });
  console.log('[lead]', lead.schoolName, lead.email);
  res.status(201).json({ ok: true, id: lead.id });
});

// ---------------------------------------------------------------------------
// static (dist) + SPA fallback
// ---------------------------------------------------------------------------
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));
app.get(/^(?!\/api\/).*/, (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'), (err) => {
    if (err) res.status(404).send('Build the frontend first: npm run build');
  });
});

app.listen(port, () => {
  console.log(`🚀 U-Space server on :${port}  (AI: ${aiEnabled() ? 'gemini' : 'rules-fallback'})`);
});
