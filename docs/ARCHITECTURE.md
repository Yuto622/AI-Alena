# U-Space 技術構成

```
Browser (React 19 + Vite + Tailwind CDN)
 ├─ #/            Landing（BtoB LP・料金・ROI・リード送信）
 ├─ #/join        生徒参加（教室コード＋ニックネーム、localStorage セッション）
 ├─ #/student/*   MissionList / MissionPlayer / Certificate
 │     └─ labs/   IssTracker・MoonLab・TransitLab・HubbleLab・NumericLab・SkyAboveSchool（住所→上空データ＋NASA GIBS/Sentinel-2タイル）
 │     └─ CommanderChat（Web Speech API：認識 + 合成）
 ├─ #/teacher     TeacherLogin / TeacherDashboard（進捗・レポート・CSV・台本・質問・設定）
 └─ #/present/:m  投影モード（全画面）
        │  fetch /api/*
        ▼
Express (server.mjs, Node 22)
 ├─ /api/iss                 wheretheiss.at 中継（5秒キャッシュ、失敗時は円軌道モデル）
 ├─ /api/geo?q=住所          国土地理院 → Nominatim → 内蔵都市表 の順で解決
 ├─ /api/sky?lat&lon         ISS通過予報7日分（Celestrak TLE + satellite.js SGP4、影・薄明判定で肉眼可視）、今の距離、日の出入り
 ├─ /api/students/*          参加・結果保存・質問
 ├─ /api/teacher/*           x-classroom-code / x-classroom-pin ヘッダ認証
 ├─ /api/ai/speaking|commander   Gemini 2.5 Flash（@google/genai）／無鍵時はルールベース
 ├─ /api/teacher/report/:id  保護者レポート生成
 ├─ /api/leads               LP フォーム
 └─ static dist + SPA fallback
        │
        ▼
server/db.mjs  JSON ファイル（data/db.json）。Firestore / Cloud SQL に差し替え可能な薄いインターフェース
content/missions.ts  正典（数値・出典・台本）。サーバーは missions-loader.mjs で同じファイルを読む
```

## 設計上の判断
- **事実は AI に任せない**：天文の数値・解説はすべて `content/missions.ts` に固定し、出典を UI に出す。AI は「英語のフィードバック」「会話」「レポートの文章化」のみ。
- **鍵が無くても動く**：Gemini 未設定でもルールベースで同じ形の応答を返す。商談デモや教室の Wi-Fi 不調時に止まらない。
- **教室コード運用**：U-Speak Roblox と同じ4桁コード＋ニックネーム。小学生にパスワードを持たせない。先生は別途4桁PIN。
- **1コンテナ**：Cloud Run に Dockerfile をそのままデプロイ。フロントは静的配信。

## 本番化の TODO
1. `server/db.mjs` を Firestore に（インターフェースは維持）
2. 先生認証を Firebase Auth / マジックリンクに
3. LINE Messaging API 連携（Plus）、レポート PDF 化（既存の LaTeX 請求書パイプを流用）
4. 発話音声の保存（同意のうえ）と発音評価
5. 本部ダッシュボード（Premium）：classroom に `orgId` を追加するだけで横断集計可能
