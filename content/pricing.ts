import type { PlanId } from '../types';

/**
 * 料金（税別・生徒1名あたり月額・教室へ請求）。
 * U-Speak Roblox の価格体系（初3ヶ月キャンペーン→標準）と同じ構造にして、
 * 既存の提案書・請求書スキルがそのまま使えるようにしている。
 */
export const INTRO_PRICE = 800; // 初3ヶ月 早期導入キャンペーン（U-Speak と同額）
export const MIN_SEATS = 10; // 最低課金人数

export const PLANS: { id: PlanId; name: string; price: number; tagline: string; features: string[]; recommended?: boolean }[] = [
  {
    id: 'standard',
    name: 'Standard',
    price: 1500,
    tagline: '週1「宇宙×英語」クラスをすぐ開講',
    features: [
      '8週ミッション教材（英検5〜3級の3レベル出し分け）',
      'ISSライブ追跡・月齢・トランジット・ハッブル定数の4つのData Lab',
      'AI管制官との英語音声会話＋発話フィードバック',
      '先生用45分進行台本（宇宙知識ゼロで運営可）',
      '生徒別の進捗・スコア管理（4桁教室コード）',
      '月次 保護者向けAIレポート（PDF/テキスト）',
    ],
  },
  {
    id: 'plus',
    name: 'Plus',
    price: 2500,
    tagline: '教室ブランドで保護者に届ける',
    recommended: true,
    features: [
      'Standard の全機能',
      '教室ロゴ・カラー入り保護者レポート（ブランド版）',
      'LINE公式アカウント連携（レポート・宿題リマインド配信）',
      '「UCLA研究者に聞く」月1ライブ参加権（全校合同・質問優先回答）',
      '修了証（教室名・代表者名入り）',
      '新規入会チラシ・体験会テンプレート（宇宙体験会キット）',
    ],
  },
  {
    id: 'premium',
    name: 'Premium',
    price: 3500,
    tagline: '探究発表会まで伴走・本部一括管理',
    features: [
      'Plus の全機能',
      '複数拠点（本部）ダッシュボード',
      '学期末「My Space Mission」発表会キット＋UCLA研究者の講評動画',
      '教室オリジナルの単語・問題データ投入（既存教材の宇宙版化）',
      '専任CS・導入初月の講師オンライン研修',
    ],
  },
];

export const ADD_ONS = [
  { name: '出張 宇宙体験会（都内・1回）', price: 50000, unit: '回', note: '新規入会フック。UCLA研究者が登壇。' },
  { name: '英検Web（U-Speak）同時契約割引', price: -200, unit: '名/月', note: '既存U-Speak顧客はクロスセル価格。' },
];

/** 教室の ROI 試算（U-Speak の3モード判定と同じ思想：ROIマイナスの提案を出さない） */
export function estimateRoi({ students, monthlyFee, plan }: { students: number; monthlyFee: number; plan: PlanId }) {
  const p = PLANS.find((x) => x.id === plan)!;
  const seats = Math.max(MIN_SEATS, students);
  // 投資：初3ヶ月 ¥800 → 以降 標準
  const cost1y = INTRO_PRICE * seats * 3 + p.price * seats * 9;
  // リターン（U-Speak 提案書の式を流用）
  const churnGain = students * 0.05 * monthlyFee * 12; // 退会率5%改善
  const upsell = 1000 * students * 12; // 宇宙クラス付加で月謝+¥1,000（オプション講座化）
  const referral = students * 0.1 * monthlyFee * 6; // 紹介10%・年平均6ヶ月
  const return1y = churnGain + upsell + referral;
  const net = return1y - cost1y;
  const paybackMonths = net > 0 ? Math.max(1, Math.round((cost1y / return1y) * 12)) : null;
  return { seats, cost1y, return1y, net, paybackMonths, breakdown: { churnGain, upsell, referral } };
}
