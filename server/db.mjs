// ============================================================================
// 超軽量 JSON ストア（MVP 用）。
// 本番は Cloud SQL / Firestore に差し替える前提で、インターフェースだけ揃えている。
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

const EMPTY = {
  classrooms: [],
  students: [],
  results: [],
  questions: [],
  leads: [],
};

function load() {
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    return { ...EMPTY, ...JSON.parse(raw) };
  } catch {
    return structuredClone(EMPTY);
  }
}

let state = load();
let writeTimer = null;

function persist() {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(state, null, 2));
  }, 50);
}

export function now() {
  return new Date().toISOString();
}

export function newId() {
  return randomUUID();
}

/** 4桁コードを未使用のものから生成（U-Speak Roblox の教室コードUXを踏襲）。 */
export function newClassroomCode() {
  for (let i = 0; i < 100; i++) {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    if (!state.classrooms.some((c) => c.code === code)) return code;
  }
  throw new Error('code space exhausted');
}

export const db = {
  get state() {
    return state;
  },
  reset() {
    state = structuredClone(EMPTY);
    persist();
  },
  // --- classrooms
  listClassrooms: () => state.classrooms,
  getClassroom: (code) => state.classrooms.find((c) => c.code === code) || null,
  createClassroom: ({ name, plan = 'standard', pin, unlockedWeeks = 1 }) => {
    const c = {
      code: newClassroomCode(),
      pin: pin || String(Math.floor(1000 + Math.random() * 9000)),
      name,
      plan,
      createdAt: now(),
      unlockedWeeks,
    };
    state.classrooms.push(c);
    persist();
    return c;
  },
  updateClassroom: (code, patch) => {
    const c = db.getClassroom(code);
    if (!c) return null;
    Object.assign(c, patch);
    persist();
    return c;
  },
  // --- students
  listStudents: (classroomCode) => state.students.filter((s) => s.classroomCode === classroomCode),
  getStudent: (id) => state.students.find((s) => s.id === id) || null,
  /** 同じ教室・同じニックネームなら既存を返す（子どもが毎回ログインする前提の簡易 ID）。 */
  upsertStudent: ({ classroomCode, nickname, level }) => {
    let s = state.students.find(
      (x) => x.classroomCode === classroomCode && x.nickname.toLowerCase() === nickname.toLowerCase(),
    );
    if (s) {
      if (level && s.level !== level) {
        s.level = level;
        persist();
      }
      return s;
    }
    s = { id: newId(), classroomCode, nickname, level: level || 1, createdAt: now() };
    state.students.push(s);
    persist();
    return s;
  },
  // --- results
  listResults: (classroomCode) => state.results.filter((r) => r.classroomCode === classroomCode),
  listStudentResults: (studentId) => state.results.filter((r) => r.studentId === studentId),
  addResult: (r) => {
    const rec = { id: newId(), completedAt: now(), ...r };
    state.results.push(rec);
    persist();
    return rec;
  },
  // --- questions (Ask UCLA)
  listQuestions: (classroomCode) => state.questions.filter((q) => q.classroomCode === classroomCode),
  addQuestion: (q) => {
    const rec = { id: newId(), createdAt: now(), ...q };
    state.questions.push(rec);
    persist();
    return rec;
  },
  answerQuestion: (id, answer) => {
    const q = state.questions.find((x) => x.id === id);
    if (!q) return null;
    q.answer = answer;
    persist();
    return q;
  },
  // --- leads
  listLeads: () => state.leads,
  addLead: (l) => {
    const rec = { id: newId(), createdAt: now(), ...l };
    state.leads.push(rec);
    persist();
    return rec;
  },
};

/** デモ教室を用意する（初回起動時）。営業デモ・開発用。 */
export function ensureDemo() {
  if (db.getClassroom('1234')) return;
  const c = {
    code: '1234',
    pin: '0000',
    name: 'デモ英語教室（U-Space 体験用）',
    plan: 'plus',
    createdAt: now(),
    unlockedWeeks: 8,
    // デモ教室の住所（U-Speak Lab 所在地）。住所を入れるだけで上空データが全ミッションに反映される
    location: { lat: 35.6619, lon: 139.7041, label: '東京都渋谷区神南1-11-4', address: '東京都渋谷区神南1-11-4', source: 'seed' },
  };
  state.classrooms.push(c);
  const demoStudents = [
    ['Haru', 1],
    ['Mio', 2],
    ['Kenta', 3],
  ];
  for (const [nickname, level] of demoStudents) {
    const s = { id: newId(), classroomCode: '1234', nickname, level, createdAt: now() };
    state.students.push(s);
  }
  const [haru, mio, kenta] = state.students.filter((s) => s.classroomCode === '1234');
  state.results.push(
    { id: newId(), studentId: haru.id, classroomCode: '1234', missionId: 'm01', quizScore: 4, quizTotal: 6, labResult: 'ISS orbits/day ≈ 15.7', speakingText: 'I see the Earth. It is blue. I want to float.', speakingScore: 3, speakingFeedback: 'Great start, Haru! You used "Earth" and "blue". Next time, try one more sentence about the sunrise.', completedAt: now() },
    { id: newId(), studentId: mio.id, classroomCode: '1234', missionId: 'm01', quizScore: 6, quizTotal: 6, labResult: 'ISS orbits/day ≈ 15.7', speakingText: 'I can see the blue Earth above me. The ISS is very fast. I want to see 16 sunrises!', speakingScore: 4, speakingFeedback: 'Excellent, Mio! Clear sentences and you used "sunrise" naturally.', completedAt: now() },
    { id: newId(), studentId: kenta.id, classroomCode: '1234', missionId: 'm07', quizScore: 5, quizTotal: 6, labResult: 'H₀ ≈ 70 km/s/Mpc → 宇宙の年齢 ≈ 14.0 Gyr', speakingText: 'Today I measured the age of the universe. I used data from seven galaxy clusters. Far galaxies move faster. The universe is about 14 billion years old.', speakingScore: 5, speakingFeedback: 'Outstanding, Kenta. You explained Hubble\'s law in your own words.', completedAt: now() },
  );
  persist();
}
