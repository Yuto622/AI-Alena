import type { AskQuestion, ChatTurn, Classroom, IssPosition, Lead, MissionResult, Student } from '../types';

async function http<T>(url: string, init?: RequestInit & { teacher?: { code: string; pin: string } }): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init?.headers as Record<string, string>) };
  if (init?.teacher) {
    headers['x-classroom-code'] = init.teacher.code;
    headers['x-classroom-pin'] = init.teacher.pin;
  }
  const res = await fetch(url, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  health: () => http<{ status: string; ai: 'gemini' | 'rules'; missions: number }>('/api/health'),
  iss: () => http<IssPosition>('/api/iss'),

  // students
  join: (code: string, nickname: string, level: number) =>
    http<{ student: Student; classroom: Pick<Classroom, 'code' | 'name' | 'unlockedWeeks'> }>('/api/students/join', {
      method: 'POST',
      body: JSON.stringify({ code, nickname, level }),
    }),
  classroomPublic: (code: string) => http<Pick<Classroom, 'code' | 'name' | 'unlockedWeeks' | 'plan'>>(`/api/classrooms/${code}/public`),
  studentResults: (studentId: string) => http<MissionResult[]>(`/api/students/${studentId}/results`),
  saveResult: (studentId: string, body: Partial<MissionResult>) =>
    http<MissionResult>(`/api/students/${studentId}/results`, { method: 'POST', body: JSON.stringify(body) }),
  askQuestion: (studentId: string, question: string) =>
    http<AskQuestion>(`/api/students/${studentId}/questions`, { method: 'POST', body: JSON.stringify({ question }) }),
  studentQuestions: (studentId: string) => http<AskQuestion[]>(`/api/students/${studentId}/questions`),

  // ai
  speaking: (text: string, level: number, missionId: string) =>
    http<{ score: number; feedback: string; usedWords: string[]; source: string }>('/api/ai/speaking', {
      method: 'POST',
      body: JSON.stringify({ text, level, missionId }),
    }),
  commander: (history: ChatTurn[], level: number, missionId: string, nickname: string) =>
    http<{ text: string; source: string }>('/api/ai/commander', {
      method: 'POST',
      body: JSON.stringify({ history, level, missionId, nickname }),
    }),

  // teacher
  teacherLogin: (code: string, pin: string) => http<Classroom>('/api/teacher/login', { method: 'POST', body: JSON.stringify({ code, pin }) }),
  dashboard: (t: { code: string; pin: string }) =>
    http<{ classroom: Classroom; students: Student[]; results: MissionResult[]; questions: AskQuestion[] }>('/api/teacher/dashboard', { teacher: t }),
  updateClassroom: (t: { code: string; pin: string }, patch: Partial<Classroom>) =>
    http<Classroom>('/api/teacher/classroom', { method: 'PATCH', body: JSON.stringify(patch), teacher: t }),
  report: (t: { code: string; pin: string }, studentId: string) =>
    http<{ text: string; source: string }>(`/api/teacher/report/${studentId}`, { method: 'POST', body: '{}', teacher: t }),
  answerQuestion: (t: { code: string; pin: string }, id: string, answer: string) =>
    http<AskQuestion>(`/api/teacher/questions/${id}/answer`, { method: 'POST', body: JSON.stringify({ answer }), teacher: t }),
  createClassroom: (name: string, plan: string) => http<Classroom>('/api/classrooms', { method: 'POST', body: JSON.stringify({ name, plan }) }),

  // leads
  lead: (lead: Omit<Lead, 'id' | 'createdAt'>) => http<{ ok: true }>('/api/leads', { method: 'POST', body: JSON.stringify(lead) }),
};
