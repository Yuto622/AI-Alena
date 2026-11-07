import React, { useMemo, useState } from 'react';
import { MISSIONS } from '../../content/missions';
import { ADD_ONS, INTRO_PRICE, MIN_SEATS, PLANS, estimateRoi } from '../../content/pricing';
import { api } from '../../services/api';
import { navigate } from '../../lib/router';
import type { PlanId } from '../../types';
import { Button, Card, Input, Pill, Stat, Textarea } from '../ui';
import { SkyAboveSchool } from '../labs/SkyAboveSchool';
import { SchoolToSpace } from '../metaverse/SchoolToSpace';

const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`;

export const Landing: React.FC = () => {
  return (
    <div className="space-y-20">
      <Hero />
      <AddressDemo />
      <MetaverseDemo />
      <WhyNow />
      <Curriculum />
      <HowItWorks />
      <Pricing />
      <RoiCalc />
      <Founder />
      <LeadForm />
    </div>
  );
};

// ---------------------------------------------------------------------------
const Hero: React.FC = () => (
  <section className="relative pt-10 md:pt-16">
    <div className="grid md:grid-cols-2 gap-10 items-center">
      <div>
        <Pill tone="orange">英会話教室・学習塾・民間学童向け BtoB SaaS</Pill>
        <h1 className="font-display text-4xl md:text-6xl font-bold text-white leading-[1.05] mt-4">
          小学生が、英語で
          <br />
          <span className="text-brand-orange">宇宙の年齢を測る</span>
          <br />
          週1クラスを、御校に。
        </h1>
        <p className="text-slate-300 mt-6 text-lg leading-relaxed">
          U-Space は、<b className="text-white">UCLA 天文物理の研究者が監修</b>する「宇宙探究 × 英語」の8週カリキュラムを、
          教材・AI・先生用台本・保護者レポートまで一式でお届けするクラウドサービスです。
          先生に宇宙の知識は要りません。生徒1名あたりの月額で、明日から新コースが開講できます。
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button onClick={() => navigate('/join')} className="px-6 py-3 text-base">
            🚀 デモを体験（コード 1234）
          </Button>
          <Button variant="ghost" onClick={() => document.getElementById('lead')?.scrollIntoView({ behavior: 'smooth' })} className="px-6 py-3 text-base">
            資料請求・オンライン商談
          </Button>
        </div>
        <div className="mt-8 grid grid-cols-3 gap-3">
          <Stat label="教室側の準備" value="住所だけ" hint="上空データが自動で教材に" />
          <Stat label="本物のデータ" value="4 Labs" hint="ISS / 月 / 系外惑星 / ハッブル" />
          <Stat label="英検対応" value="5〜3級" hint="3レベル自動出し分け" />
        </div>
      </div>
      <div className="glass rounded-3xl p-6 md:p-8 floaty">
        <div className="font-display text-xs text-orange-300 tracking-widest">WEEK 7 · GAL-07</div>
        <div className="text-5xl mt-2">🌌</div>
        <div className="font-display text-2xl font-bold text-white mt-3">Galaxies and the expanding universe</div>
        <div className="text-slate-300">銀河と、ふくらむ宇宙</div>
        <div className="mt-5 rounded-xl bg-space-950/80 border border-white/10 p-4 text-sm">
          <div className="text-slate-400 text-xs">Student output（実際の生徒発話例）</div>
          <p className="text-white mt-1 leading-relaxed">“Today I measured the age of the universe. I used data from seven galaxy clusters. Far galaxies move faster. The universe is about 14 billion years old.”</p>
          <div className="mt-3 text-emerald-300 text-xs">📡 H₀ ≈ 70 km/s/Mpc → 宇宙の年齢 ≈ 14.0 Gyr（本人の測定値）</div>
        </div>
        <div className="mt-4 text-xs text-slate-400">↑ これが保護者レポートと修了証にそのまま載ります。</div>
      </div>
    </div>
  </section>
);

// ---------------------------------------------------------------------------
const AddressDemo: React.FC = () => (
  <section id="sky">
    <SectionTitle kicker="TRY IT NOW" title="御校の住所を入れるだけで、上空の衛星データが教材になる" sub="ISSが御校の真上を通る日時と方角、今この瞬間の距離、日の出入り、NASA/ESAの衛星写真。すべて鍵なしの公開データから自動計算。生徒は「この日の夜、南西の空を見上げる」宿題を持ち帰ります。" />
    <SkyAboveSchool allowInput />
  </section>
);

// ---------------------------------------------------------------------------
const MetaverseDemo: React.FC = () => (
  <section id="metaverse">
    <SectionTitle kicker="METAVERSE" title="住所が、メタバースの出発点になる" sub="衛星写真と標高データから御校の街を自動生成。生徒はそこに立ち、打ち上がり、黒くなる空を抜けて、今この瞬間の位置にいるISSまで飛びます。U-Speak Roblox の教室専用ワールドにも地形をそのまま書き出せます。" />
    <SchoolToSpace location={{ lat: 35.6619, lon: 139.7041, label: '東京都渋谷区神南（デモ）' }} allowInput />
  </section>
);

// ---------------------------------------------------------------------------
const WhyNow: React.FC = () => (
  <section>
    <SectionTitle kicker="WHY NOW" title="空白市場（ブルーオーシャン）の根拠" sub="需要は実証済み、供給はゼロ。" />
    <div className="grid md:grid-cols-3 gap-4">
      <Card title="① 親は STEM 習い事に払う" subtitle="子ども向け情報教育市場 352億円・前年比+38.7%（GMOメディア×船井総研 2025）">
        <p className="text-sm text-slate-300">プログラミング教室が証明したのは「学校で教えない理系体験にお金を払う親」が大量にいること。宇宙は子どもの興味ランキングで常に最上位なのに、プログラミングのような受け皿がありません。</p>
      </Card>
      <Card title="② 探究学習は制度で追い風" subtitle="探究学習支援サービス市場 前年比149.7%（矢野経済研究所 2023）">
        <p className="text-sm text-slate-300">高校の「総合的な探究の時間」必修化で市場が急成長。一方で小学生向けの供給は薄く、英語教室・塾は「探究っぽい何か」を探しています。</p>
      </Card>
      <Card title="③ 宇宙教育は供給が細い" subtitle="JAXA コズミックカレッジ：年155件・5,546人、主催は非営利団体限定">
        <p className="text-sm text-slate-300">公的プログラムは抽選・年数回。月謝制の「宇宙塾」は日本に実質存在せず、英会話教室向けの宇宙CLIL教材パッケージもありません。ここが空白です。</p>
      </Card>
    </div>
    <p className="text-xs text-slate-500 mt-3">出典：GMOメディア／船井総合研究所「2025年 子ども向け情報教育市場調査」、矢野経済研究所「探究学習支援サービス市場に関する調査（2024）」、JAXA宇宙教育センター 2024年度実績。</p>
  </section>
);

// ---------------------------------------------------------------------------
const Curriculum: React.FC = () => (
  <section>
    <SectionTitle kicker="CURRICULUM" title="8週で「宇宙を英語で説明できる子」に" sub="毎週：Briefing → Words → Data Lab → Quiz → Speaking（AI管制官）" />
    <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
      {MISSIONS.map((m) => (
        <div key={m.id} className="glass rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-3xl">{m.emoji}</span>
            <Pill tone="slate">Week {m.week}</Pill>
          </div>
          <div className="font-display text-white font-bold mt-2 leading-tight">{m.title}</div>
          <div className="text-xs text-slate-300">{m.titleJa}</div>
          <div className="text-[11px] text-slate-500 mt-2">{m.theme}</div>
        </div>
      ))}
    </div>
    <div className="grid md:grid-cols-4 gap-3 mt-6">
      {[
        ['🛰️ ISS Live', '今飛んでいる場所を5秒ごとに受信。1日何周？を自分で計算。'],
        ['🌙 Moon Tonight', '今夜の月齢を計算で出し、次の満月までの日数を予測。'],
        ['🪐 Transit Lab', '惑星サイズを変えて、星の減光1%／0.01%を作る。本物の発見法。'],
        ['🌌 Hubble Lab', '実在7銀河団のデータに直線を合わせ、宇宙の年齢を自分で求める。'],
      ].map(([t, d]) => (
        <div key={t} className="rounded-2xl border border-white/10 bg-space-900/50 p-4">
          <div className="font-display font-bold text-white">{t}</div>
          <div className="text-xs text-slate-300 mt-1">{d}</div>
        </div>
      ))}
    </div>
  </section>
);

// ---------------------------------------------------------------------------
const HowItWorks: React.FC = () => (
  <section>
    <SectionTitle kicker="FOR SCHOOL OWNERS" title="教室がやることは「コードを配る」だけ" sub="U-Speak Roblox と同じ、4桁教室コード運用。" />
    <div className="grid md:grid-cols-4 gap-3">
      {[
        ['1', '契約・教室コード発行', '最低10名から。初3ヶ月は¥800/名で立ち上げ。'],
        ['2', '週1・45分のクラス', '先生用台本どおりに進めるだけ。投影モードで大画面に。'],
        ['3', '生徒はタブレットで', '英語でミッション。AI管制官と音声で交信、発話が記録される。'],
        ['4', '保護者レポート自動生成', '「お子さんが測った宇宙の年齢」が載るレポートで月謝納得感UP。'],
      ].map(([n, t, d]) => (
        <div key={n} className="glass rounded-2xl p-5">
          <div className="font-display text-3xl font-bold text-brand-orange">{n}</div>
          <div className="font-bold text-white mt-2">{t}</div>
          <div className="text-sm text-slate-300 mt-1">{d}</div>
        </div>
      ))}
    </div>
    <div className="mt-6 grid md:grid-cols-3 gap-3">
      <Card title="英会話教室には" subtitle="CLIL（内容言語統合学習）の決定版">
        <p className="text-sm text-slate-300">「英語で何を話すか」が毎週用意される。英検語彙を宇宙の文脈で反復し、発話量がレポートに数字で残る。</p>
      </Card>
      <Card title="学習塾には" subtitle="理科×英語の探究コース新設">
        <p className="text-sm text-slate-300">受験一本の塾に「探究・理科好き」の入会導線を追加。計算を伴う Data Lab は算数の実用例としても機能。</p>
      </Card>
      <Card title="学童・アフタースクールには" subtitle="「ただ過ごす場所」からの脱却">
        <p className="text-sm text-slate-300">質の高い放課後プログラムを、専門講師を雇わずに提供。台本と投影モードで誰でも運営できる。</p>
      </Card>
    </div>
  </section>
);

// ---------------------------------------------------------------------------
const Pricing: React.FC = () => (
  <section id="pricing">
    <SectionTitle kicker="PRICING" title="生徒1名あたり月額（税別）・教室へ一括請求" sub={`初3ヶ月は全プラン ${yen(INTRO_PRICE)}/名の早期導入価格。最低${MIN_SEATS}名から。保護者への直販はしません。`} />
    <div className="grid md:grid-cols-3 gap-4">
      {PLANS.map((p) => (
        <div key={p.id} className={`rounded-3xl p-6 border ${p.recommended ? 'border-brand-orange bg-orange-500/10' : 'border-white/10 glass'}`}>
          <div className="flex items-center justify-between">
            <div className="font-display text-xl font-bold text-white">{p.name}</div>
            {p.recommended && <Pill tone="orange">おすすめ</Pill>}
          </div>
          <div className="text-sm text-slate-300 mt-1">{p.tagline}</div>
          <div className="mt-4">
            <span className="font-display text-4xl font-bold text-white">{yen(p.price)}</span>
            <span className="text-slate-400 text-sm"> /名・月</span>
          </div>
          <div className="text-xs text-slate-400">4ヶ月目以降。初3ヶ月は {yen(INTRO_PRICE)}</div>
          <ul className="mt-5 space-y-2 text-sm text-slate-200">
            {p.features.map((f) => (
              <li key={f} className="flex gap-2">
                <span className="text-brand-orange">✓</span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
    <div className="mt-4 grid md:grid-cols-2 gap-3">
      {ADD_ONS.map((a) => (
        <div key={a.name} className="rounded-xl border border-white/10 bg-space-900/50 p-4 flex items-center justify-between">
          <div>
            <div className="text-white font-medium">{a.name}</div>
            <div className="text-xs text-slate-400">{a.note}</div>
          </div>
          <div className="font-display text-white">
            {a.price < 0 ? `−${yen(-a.price)}` : yen(a.price)} <span className="text-xs text-slate-400">/{a.unit}</span>
          </div>
        </div>
      ))}
    </div>
  </section>
);

// ---------------------------------------------------------------------------
const RoiCalc: React.FC = () => {
  const [students, setStudents] = useState(30);
  const [fee, setFee] = useState(12000);
  const [plan, setPlan] = useState<PlanId>('plus');
  const r = useMemo(() => estimateRoi({ students, monthlyFee: fee, plan }), [students, fee, plan]);
  return (
    <section>
      <SectionTitle kicker="ROI" title="御校の数字で試算" sub="U-Speak Roblox 提案書と同じ計算式（退会率改善5%・紹介10%・オプション講座化 +¥1,000/月）。" />
      <div className="grid md:grid-cols-3 gap-4">
        <Card title="入力">
          <label className="text-xs text-slate-400">対象生徒数</label>
          <Input type="number" value={students} min={1} onChange={(e) => setStudents(Math.max(1, parseInt(e.target.value || '1', 10)))} />
          <label className="text-xs text-slate-400 mt-3 block">平均月謝（円）</label>
          <Input type="number" value={fee} min={1000} step={500} onChange={(e) => setFee(Math.max(1000, parseInt(e.target.value || '1000', 10)))} />
          <label className="text-xs text-slate-400 mt-3 block">プラン</label>
          <div className="flex gap-1 mt-1">
            {PLANS.map((p) => (
              <button key={p.id} onClick={() => setPlan(p.id)} className={`flex-1 rounded-lg border px-2 py-2 text-xs ${plan === p.id ? 'bg-brand-orange border-brand-orange text-white' : 'bg-white/5 border-white/10 text-slate-300'}`}>
                {p.name}
              </button>
            ))}
          </div>
        </Card>
        <Card title="年間の投資とリターン">
          <div className="space-y-2 text-sm">
            <Row k={`U-Space 年間費用（${r.seats}名・初3ヶ月 ${yen(INTRO_PRICE)}）`} v={yen(r.cost1y)} />
            <Row k="退会率 5% 改善" v={yen(r.breakdown.churnGain)} />
            <Row k="オプション講座化 +¥1,000/月" v={yen(r.breakdown.upsell)} />
            <Row k="紹介入会 10%" v={yen(r.breakdown.referral)} />
            <div className="border-t border-white/10 pt-2">
              <Row k="年間リターン合計" v={yen(r.return1y)} strong />
            </div>
          </div>
        </Card>
        <Card title="結果">
          <Stat label="単年 純ROI" value={<span className={r.net >= 0 ? 'text-emerald-300' : 'text-rose-300'}>{r.net >= 0 ? '+' : ''}{yen(r.net)}</span>} />
          <div className="mt-3">
            <Stat label="投資回収" value={r.paybackMonths ? `約 ${r.paybackMonths} ヶ月` : '—'} hint={r.net >= 0 ? '単年で黒字化' : '定性価値（差別化・探究）で提案'} />
          </div>
          <p className="text-xs text-slate-500 mt-3">※ 試算は仮定値です。商談では御校の実数で再計算します。</p>
        </Card>
      </div>
    </section>
  );
};

const Row: React.FC<{ k: string; v: string; strong?: boolean }> = ({ k, v, strong }) => (
  <div className="flex items-center justify-between gap-3">
    <span className={strong ? 'text-white font-bold' : 'text-slate-300'}>{k}</span>
    <span className={`font-display ${strong ? 'text-white font-bold' : 'text-slate-200'}`}>{v}</span>
  </div>
);

// ---------------------------------------------------------------------------
const Founder: React.FC = () => (
  <section>
    <SectionTitle kicker="WHY US" title="他社が真似できない3点" sub="教材会社でも、塾でも、ゲーム会社でもない組み合わせ。" />
    <div className="grid md:grid-cols-3 gap-4">
      <Card title="🎓 UCLA 天文物理 × 制御理論の現役研究者" subtitle="監修者が自分で測った宇宙を、子どもに測らせる">
        <p className="text-sm text-slate-300">代表 真田悠斗は UCLA で銀河・宇宙論（Astro 117）と制御理論（Iwasaki Lab）を研究。Hubble Lab は大学の演習をそのまま小学生用に設計し直したもの。月1の「UCLA研究者に聞く」ライブは本人が登壇。</p>
      </Card>
      <Card title="🏫 U-Speak Roblox で確立した BtoB の型" subtitle="英会話教室への導入実績・請求・運用マニュアルがそのまま使える">
        <p className="text-sm text-slate-300">DM → 架電 → 商談準備 → 提案書 → 契約 → 月次請求の営業パイプラインを、既存顧客と同じ買い手に流す。U-Speak 既存校へのクロスセルは即日。</p>
      </Card>
      <Card title="🤖 AI × 本物のデータ" subtitle="クイズ教材ではなく「探究の道具」">
        <p className="text-sm text-slate-300">ISS のライブ位置、本物の銀河団データ、トランジットの物理式。AI管制官は英語の発話量を増やし、保護者レポートに「本人の測定値」が載る。これは PDF 教材では再現できない。</p>
      </Card>
    </div>
  </section>
);

// ---------------------------------------------------------------------------
const LeadForm: React.FC = () => {
  const [f, setF] = useState({ schoolName: '', contactName: '', email: '', students: 30, type: '英会話教室' as '英会話教室' | '学習塾' | '学童' | 'その他', message: '' });
  const [state, setState] = useState<'idle' | 'busy' | 'ok' | 'err'>('idle');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState('busy');
    try {
      await api.lead(f);
      setState('ok');
    } catch {
      setState('err');
    }
  };
  return (
    <section id="lead" className="pb-10">
      <SectionTitle kicker="CONTACT" title="資料請求・オンライン商談（30分）" sub="2営業日以内に、御校向けの試算と提案書をお送りします。" />
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          {state === 'ok' ? (
            <div className="py-10 text-center">
              <div className="text-5xl">🛰️</div>
              <div className="font-display text-2xl text-white font-bold mt-3">Received. 送信ありがとうございます</div>
              <p className="text-slate-300 mt-2 text-sm">合同会社U-Speak Lab よりご連絡します。先にデモを触っていただくこともできます（コード 1234）。</p>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400">教室・法人名 *</label>
                  <Input required value={f.schoolName} onChange={(e) => setF({ ...f, schoolName: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs text-slate-400">ご担当者名 *</label>
                  <Input required value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400">メール *</label>
                  <Input required type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs text-slate-400">想定生徒数</label>
                  <Input type="number" value={f.students} onChange={(e) => setF({ ...f, students: parseInt(e.target.value || '0', 10) })} />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400">業態</label>
                <div className="flex gap-1 mt-1">
                  {(['英会話教室', '学習塾', '学童', 'その他'] as const).map((tp) => (
                    <button type="button" key={tp} onClick={() => setF({ ...f, type: tp })} className={`flex-1 rounded-lg border px-2 py-2 text-xs ${f.type === tp ? 'bg-brand-orange border-brand-orange text-white' : 'bg-white/5 border-white/10 text-slate-300'}`}>
                      {tp}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400">ご要望（任意）</label>
                <Textarea rows={3} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} placeholder="例：英検対策と並行できるか／学童の夕方枠で使いたい" />
              </div>
              {state === 'err' && <p className="text-rose-300 text-sm">送信に失敗しました。時間をおいて再度お試しください。</p>}
              <Button type="submit" className="w-full py-3" disabled={state === 'busy'}>
                送信して資料を受け取る
              </Button>
            </form>
          )}
        </Card>
        <div className="space-y-3">
          <Card title="合同会社 U-Speak Lab" subtitle="東京都渋谷区神南1-11-4 / info@uspeaklab.com">
            <ul className="text-sm text-slate-300 space-y-1">
              <li>・U-Speak Roblox（英会話教室向け Roblox 英語学習）</li>
              <li>・英検Web（単語・4択クイズ配信）</li>
              <li>・U-Space（宇宙探究×英語）← 本サービス</li>
            </ul>
          </Card>
          <Card title="よくある質問">
            <dl className="text-sm space-y-3">
              <div>
                <dt className="text-white font-medium">先生に理科の知識がなくても大丈夫？</dt>
                <dd className="text-slate-300">はい。45分の台本と投影モード、クイズ解説がすべて用意されています。難しい質問は「UCLAに聞く」に回せます。</dd>
              </div>
              <div>
                <dt className="text-white font-medium">英検対策と両立できる？</dt>
                <dd className="text-slate-300">語彙・クイズは英検5〜3級の語彙に合わせて3レベルで出し分け。英検Web との同時契約割引もあります。</dd>
              </div>
              <div>
                <dt className="text-white font-medium">保護者に直接販売しますか？</dt>
                <dd className="text-slate-300">しません。教室が自校コースとして提供し、教室の月謝・オプション料金として設計いただけます。</dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>
    </section>
  );
};

const SectionTitle: React.FC<{ kicker: string; title: string; sub?: string }> = ({ kicker, title, sub }) => (
  <div className="mb-6">
    <div className="font-display text-xs tracking-[.3em] text-orange-300">{kicker}</div>
    <h2 className="font-display text-3xl md:text-4xl font-bold text-white mt-1">{title}</h2>
    {sub && <p className="text-slate-400 mt-2">{sub}</p>}
  </div>
);
