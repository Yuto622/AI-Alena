// ============================================================================
// U-Space ドメイン型
// ============================================================================

/** 英検級に対応した3段階レベル。U-Speak Roblox の級別出し分けと同じ思想。 */
export type Level = 1 | 2 | 3; // 1=英検5級相当(小3-4) 2=4級相当(小5-6) 3=3級相当(中1-)

export const LEVEL_LABEL: Record<Level, string> = {
  1: 'Cadet（英検5級レベル）',
  2: 'Pilot（英検4級レベル）',
  3: 'Commander（英検3級レベル）',
};

export interface VocabItem {
  en: string;
  ja: string;
  level: Level;
  example: string; // 例文（英語）
}

export interface QuizQuestion {
  id: string;
  level: Level;
  question: string; // 英語
  questionJa: string; // 日本語ヒント
  choices: string[]; // 4択（先頭が正解ではない。answerIndex で指定）
  answerIndex: number;
  explanation: string; // 日本語解説（本物の科学を一言で）
}

/** データ実験（Data Lab）。種類ごとに専用コンポーネントが描画する。 */
export type DataLab =
  | { kind: 'iss' } // ISS ライブ追跡＋周回回数の計算
  | { kind: 'moon' } // 今夜の月齢（計算）
  | { kind: 'orbits'; prompt: string; answer: number; tolerance: number; unit: string; hint: string }
  | { kind: 'transit' } // 系外惑星トランジットシミュレータ
  | { kind: 'hubble' } // ハッブル定数を実データから求める
  | { kind: 'scale'; prompt: string; answer: number; tolerance: number; unit: string; hint: string };

export interface Mission {
  id: string; // 'm01'
  week: number;
  code: string; // 'ISS-01'
  title: string; // 英語タイトル
  titleJa: string;
  emoji: string;
  theme: string; // 一言テーマ（営業資料にも使う）
  briefing: {
    simple: string[]; // Lv1-2 向け英文（1文ずつ）
    advanced: string[]; // Lv3 向け英文
    ja: string[]; // 日本語訳（simple に対応）
  };
  facts: { label: string; value: string; source: string }[]; // 本物の数字（出典つき）
  vocab: VocabItem[];
  quiz: QuizQuestion[];
  dataLab: DataLab;
  speaking: {
    prompt: string; // 英語の問い
    promptJa: string;
    starters: string[]; // 言い出しの型（レベル別に使い回す）
    targetWords: string[]; // 使ってほしい単語
  };
  teacherScript: string[]; // 45分の進行台本（日本語・宇宙知識ゼロで回せる）
}

// ---------------------------------------------------------------------------
// 永続化されるデータ（server/db.mjs と同じ形）
// ---------------------------------------------------------------------------

export type PlanId = 'standard' | 'plus' | 'premium';

export interface Classroom {
  code: string; // 4桁教室コード（U-Speak と同じUX）
  pin: string; // 先生用4桁PIN
  name: string;
  plan: PlanId;
  createdAt: string;
  unlockedWeeks: number; // 解放済み週数（週1ペースで増える）
}

export interface Student {
  id: string;
  classroomCode: string;
  nickname: string;
  level: Level;
  createdAt: string;
}

export interface MissionResult {
  id: string;
  studentId: string;
  classroomCode: string;
  missionId: string;
  quizScore: number;
  quizTotal: number;
  labResult?: string; // 例: "H0=70 km/s/Mpc → 宇宙の年齢 14.0 Gyr"
  speakingText?: string;
  speakingFeedback?: string; // AI からの英語フィードバック
  speakingScore?: number; // 1-5
  completedAt: string;
}

export interface AskQuestion {
  id: string;
  classroomCode: string;
  studentId: string;
  nickname: string;
  question: string;
  answer?: string;
  createdAt: string;
}

export interface Lead {
  id: string;
  schoolName: string;
  contactName: string;
  email: string;
  students: number;
  type: '英会話教室' | '学習塾' | '学童' | 'その他';
  message?: string;
  createdAt: string;
}

export interface IssPosition {
  latitude: number;
  longitude: number;
  altitude: number; // km
  velocity: number; // km/h
  visibility: string;
  timestamp: number;
  fallback?: boolean;
}

export interface ChatTurn {
  role: 'user' | 'commander';
  text: string;
}
