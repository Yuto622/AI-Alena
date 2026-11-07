import React, { useEffect, useState } from 'react';
import { useHashRoute, navigate } from './lib/router';
import { session } from './services/session';
import { api } from './services/api';
import { MISSIONS } from './content/missions';
import { Landing } from './components/landing/Landing';
import { StudentJoin } from './components/student/StudentJoin';
import { MissionList } from './components/student/MissionList';
import { MissionPlayer } from './components/student/MissionPlayer';
import { Certificate } from './components/student/Certificate';
import { TeacherDashboard, TeacherLogin, PresentMode } from './components/teacher/TeacherDashboard';

export default function App() {
  const route = useHashRoute();
  const [ai, setAi] = useState<'gemini' | 'rules' | null>(null);
  useEffect(() => {
    api.health().then((h) => setAi(h.ai)).catch(() => setAi(null));
  }, []);

  // 投影モードは全画面（ヘッダー無し）
  if (route.startsWith('/present/')) return <PresentMode missionId={route.split('/')[2]} />;

  const student = session.getStudent();
  const teacher = session.getTeacher();

  let body: React.ReactNode;
  if (route === '/' || route === '') body = <Landing />;
  else if (route === '/join') body = <StudentJoin />;
  else if (route === '/student') body = student ? <MissionList s={student} /> : <StudentJoin />;
  else if (route === '/student/certificate') body = student ? <Certificate s={student} /> : <StudentJoin />;
  else if (route.startsWith('/student/')) {
    const id = route.split('/')[2];
    const m = MISSIONS.find((x) => x.id === id);
    body = !student ? <StudentJoin /> : m ? <MissionPlayer key={m.id} mission={m} s={student} /> : <MissionList s={student} />;
  } else if (route === '/teacher') body = teacher ? <TeacherDashboard t={teacher} /> : <TeacherLogin />;
  else body = <Landing />;

  const isStudent = route.startsWith('/student') || route === '/join';

  return (
    <div className="min-h-screen starfield text-slate-100 pt-safe flex flex-col">
      <header className="sticky top-0 z-20 bg-space-950/80 backdrop-blur border-b border-white/5 no-print">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <button onClick={() => navigate('/')} className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-full bg-gradient-to-tr from-brand-orange to-amber-300 flex items-center justify-center shadow-lg shadow-orange-900/40 text-space-950 font-display font-bold">U</span>
            <span className="font-display text-lg font-bold text-white">
              U-Space <span className="text-slate-500 font-normal text-xs ml-1">by U-Speak Lab</span>
            </span>
          </button>
          <nav className="flex items-center gap-1 text-sm">
            <NavBtn active={route === '/'} onClick={() => navigate('/')}>
              教室向け
            </NavBtn>
            <NavBtn active={isStudent} onClick={() => navigate(student ? '/student' : '/join')}>
              生徒ログイン
            </NavBtn>
            <NavBtn active={route === '/teacher'} onClick={() => navigate('/teacher')}>
              先生
            </NavBtn>
            {ai && (
              <span className={`hidden md:inline-flex items-center gap-1 ml-2 text-[10px] rounded-full border px-2 py-0.5 ${ai === 'gemini' ? 'border-emerald-500/30 text-emerald-300' : 'border-white/10 text-slate-400'}`} title={ai === 'gemini' ? 'Gemini 接続中' : 'GEMINI_API_KEY 未設定：ルールベースで動作'}>
                <span className={`w-1.5 h-1.5 rounded-full ${ai === 'gemini' ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                AI {ai === 'gemini' ? 'ON' : 'demo'}
              </span>
            )}
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-6 md:py-10">{body}</main>

      <footer className="border-t border-white/5 py-6 text-center text-xs text-slate-500 no-print">
        © {new Date().getFullYear()} 合同会社 U-Speak Lab · U-Space は英会話教室・学習塾・学童向けの BtoB サービスです · 数値の出典：NASA / JAXA / ESO / NASA Exoplanet Archive / EHT
      </footer>
    </div>
  );
}

const NavBtn: React.FC<React.PropsWithChildren<{ active?: boolean; onClick: () => void }>> = ({ active, onClick, children }) => (
  <button onClick={onClick} className={`rounded-full px-3 py-1.5 transition ${active ? 'bg-white/10 text-white' : 'text-slate-300 hover:text-white hover:bg-white/5'}`}>
    {children}
  </button>
);
