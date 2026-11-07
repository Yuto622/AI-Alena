# U-Space — 宇宙探究 × 英語 SaaS（英会話教室・学習塾・学童向け BtoB）

> 小学生が、英語で、宇宙の年齢を測る週1クラスを「教材・AI・先生用台本・保護者レポート」一式で教室に提供する。
> 合同会社 U-Speak Lab の第2プロダクト。U-Speak Roblox と同じ買い手・同じ営業パイプ・同じ料金構造で売る。

- 事業計画：[docs/BUSINESS_PLAN.md](docs/BUSINESS_PLAN.md)
- U-Speak 営業の型への写像：[docs/SALES_PLAYBOOK.md](docs/SALES_PLAYBOOK.md)
- 技術構成：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## 何ができるか（MVP）

| 画面 | 中身 |
|---|---|
| `#/`（LP） | 教室経営者向け。ブルーオーシャンの根拠・8週カリキュラム・料金・ROI試算・資料請求フォーム |
| `#/join` → `#/student` | 生徒：4桁教室コード＋ニックネームで参加。8ミッション（Briefing→Words→Data Lab→Quiz→Speaking） |
| Data Lab | 🛰️ ISSライブ位置（5秒更新）／🌙 今夜の月齢／🪐 系外惑星トランジットシミュレータ／🌌 実在銀河団でハッブル定数→宇宙の年齢 |
| **御校の上空** | **住所を入れるだけ**で、ISSが御校の真上を通る日時・方角・肉眼可視時間（TLE＋SGP4）、今この瞬間の距離、日の出入り・南中、NASA GIBS／Sentinel-2 の衛星写真が LP・先生設定・ミッション1に反映 |
| AI管制官 | ブラウザ音声認識＋読み上げで英語の音声会話。発話に 1〜5 点のフィードバック |
| `#/teacher` | 先生：生徒進捗・クイズ・発話語数、保護者向けAIレポート生成、CSV出力、45分台本、投影モード、生徒質問の管理 |
| `#/student/certificate` | 修了証（本人が測った宇宙の年齢が載る。印刷可） |

AI は `GEMINI_API_KEY` があれば Gemini、無ければルールベースで動く（デモが止まらない）。

## 起動

```bash
npm install
npm run dev          # API :8080 + Vite :3000（/api はプロキシ）
# → http://localhost:3000  デモ教室：コード 1234 / 先生PIN 0000
```

本番相当：

```bash
GEMINI_API_KEY=... npm run build && npm start   # :8080 で dist 配信 + API
```

テスト・型チェック：

```bash
npm test          # サーバー側（ミッション整合性・AIフォールバック）
npm run typecheck # フロント
```

Cloud Run：`Dockerfile` をそのままデプロイ。`GEMINI_API_KEY` を環境変数で渡す。データは `data/db.json`（MVP）。本番は `server/db.mjs` のインターフェースを Firestore / Cloud SQL に差し替える。

## ディレクトリ

```
content/missions.ts   8ミッション正典（数値は NASA/JAXA/EHT 等の公開値・出典つき）
content/pricing.ts    料金・ROI 試算（U-Speak と同構造）
server/sky.mjs        住所→緯度経度（国土地理院）、ISS通過予報（satellite.js/SGP4）、日の出入り。全部オフライン代替あり
components/           landing / student / teacher / labs
lib/astro.ts          月齢・ハッブル定数フィット・トランジット深さ
server.mjs, server/   Express API・JSON ストア・Gemini/ルールベース AI・ISS 中継
docs/                 事業計画・営業の型・技術構成
```
