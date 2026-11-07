import type { Student } from '../types';

const STUDENT_KEY = 'uspace.student';
const TEACHER_KEY = 'uspace.teacher';

export interface StudentSession {
  student: Student;
  classroom: { code: string; name: string; unlockedWeeks: number };
}
export interface TeacherSession {
  code: string;
  pin: string;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
export const SESSION_EVENT = 'uspace:session';

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode など */
  }
  // 同じルート上でログイン／ログアウトした時も App が再描画できるように通知
  window.dispatchEvent(new Event(SESSION_EVENT));
}

export const session = {
  getStudent: () => read<StudentSession>(STUDENT_KEY),
  setStudent: (s: StudentSession | null) => write(STUDENT_KEY, s),
  getTeacher: () => read<TeacherSession>(TEACHER_KEY),
  setTeacher: (t: TeacherSession | null) => write(TEACHER_KEY, t),
};
