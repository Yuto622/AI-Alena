# CrowdWorks 自動受注ボット

CrowdWorks で **案件探し → 応募 → クライアントとのメッセージ対応 → 契約承諾（受注）** までを全自動で行います。
「全自動だが、危ないことは絶対にしない」を設計方針にしており、AI の判断をそのまま実行せず、送信・契約の直前に必ずコード側の安全チェックを通します。

```
[応募巡回 60分ごと]  検索 → 詳細 → ルールで足切り → Claude 審査・提案文 → 安全チェック → 応募送信
[メッセージ 10分ごと] スレッド一覧 → 変化のあるものだけ Claude が判断 → 安全チェック → 返信 / 契約承諾 / 本人へエスカレーション
                                                         ↓
                                              Slack 通知・監査ログ（data/audit.jsonl）
```

> ⚠ **利用前に必ず読んでください**
> - CrowdWorks の利用規約は、自動化ツールによるアクセスや機械的な大量応募を禁止・制限している可能性があります。アカウント停止のリスクは利用者の責任です。規約を確認のうえ利用してください。
> - 契約の承諾は法的な約束です。`negotiation` の金額条件を必ず自分で決めてください。
> - 初回は `--dry-run` で入力内容と判断を確認してから本番運用してください。

## 安全装置（全部オン・無効化不可のものを含む）

| 種類 | 内容 |
|---|---|
| **緊急停止** | `npm run stop` または `data/STOP` ファイル作成で、常駐中のプロセスも含め全送信が即停止。`npm run unhalt` で再開 |
| **自動停止** | 応募・返信・契約の失敗が 3 回連続（画面変更やアカウント制限の兆候）で自動停止し Slack 通知 |
| **送信前チェック（コード）** | URL・メール・電話番号・LINE/Chatwork 等の外部連絡先、口座情報、「無料」「返金します」「本日中に納品」、電話・Zoom・対面の約束、値下げ下限を下回る金額 → 送らずに本人へ |
| **受信の危険シグナル** | LINE 誘導、サイト外取引、ワーカー側の支払い要求、個人書類の要求、AI への指示の埋め込み、ギフト券・暗号資産払い → AI の判断に関係なく本人へ |
| **契約の自動承諾条件** | 画面から**コードで**読んだ契約金額が、提案額×90% 以上・最低額以上・**上限額以下**（上限未設定では起動不可）。金額が読めない／複数の金額が食い違う／AI の読み取りと不一致 → 承諾せず本人へ |
| **AI が判断を本人に回すケース** | ビデオ通話・打ち合わせ、NDA・本人確認、プロフィールにない実績の確認、大幅な値下げ・範囲追加、「AI ですか」と聞かれた等 |
| **回数制限** | 応募 1日10件・1回3件、返信 1日20通・1スレッド1日3通・1スレッド通算6通（超えたら本人へ）、同一スレッドへの返信間隔 10分以上 |
| **対象の限定** | ボット自身が応募した案件のスレッドだけ対応。手動で応募した案件やスカウトには触らない |
| **稼働時間** | 9〜21時（JST）以外は応募もメッセージもしない |
| **二重送信防止** | 多重起動ロック、応募履歴による重複応募防止、送信後に画面上で本文の反映を確認 |
| **記録** | すべての送信・契約・エスカレーションを `data/audit.jsonl` に追記、画面は `data/screenshots/` |
| **プロンプトインジェクション対策** | 案件本文・メッセージは「外部データ」として扱うよう指示。加えてコード側チェックが最終防衛線 |
| **認証情報** | ログインセッションは `data/storage-state.json`（権限 600）。リポジトリには入らない（.gitignore 済） |

## セットアップ

```bash
cd crowdworks-auto-apply
npm install
npx playwright install chromium   # ブラウザ未導入の環境のみ
cp config.example.json config.json
cp .env.example .env              # ANTHROPIC_API_KEY・SLACK_WEBHOOK_URL を記入（Slack は強く推奨）
npm run login                      # ブラウザでログイン（二段階認証・CAPTCHA は手動）
```

1. `config.json` の `profile` を**自分の情報に書き換える**。AI はここに書かれていない経歴は書きません。
2. `search.keywords` か `search.searchUrls`（条件で絞った検索結果 URL）を設定。
3. `negotiation` の金額条件（`minAcceptRatio` / `minContractYen` / `maxContractYen`）を決める。

画面のないサーバーでは、手元の PC で `npm run login` → `data/storage-state.json` をサーバーへコピー。

## 使い方

```bash
npm run dry-run              # 応募巡回を 1 回（入力まで・送信しない）
npm run inbox -- --dry-run   # メッセージ対応を 1 回（判断と返信案をログに出すだけ）
npm run loop                 # 全自動で常駐（応募 + メッセージ対応 + 契約承諾）
npm run stats                # 応募数・スレッド状態など
npm run serve                # 常駐 + 管理画面（ADMIN_PASSWORD 必須、http://127.0.0.1:8080）

npm run stop -- "理由"       # 緊急停止
npm run unhalt               # 再開
npm run resume -- <スレッドURL>  # 本人が対応し終えたスレッドを自動対応に戻す
```

### おすすめの導入手順

1. `npm run dry-run` と `npm run inbox -- --dry-run` を数回 → `data/state.json`・`data/screenshots/`・ログで確認
2. 画面のセレクタがずれていれば `config.json` の `selectors` を修正
3. `npm run loop` で常駐（Slack 通知を見ながら最初の数日は様子を見る）

本人対応が必要になったスレッドは Slack に「理由」と「返信案」が届き、自動対応は止まります。対応後に `npm run resume -- <URL>` で戻します。

### 半自動（下書き承認）モード

```bash
npm run run -- --mode draft        # 応募せず data/drafts/<案件ID>.md に提案文を保存
npm run apply -- 12345678          # 確認した下書きを応募
```

## 設定（config.json）

| キー | 説明 |
|---|---|
| `mode` / `dryRun` | `auto` / `draft`。`dryRun: true` で送信しない（CLI の `--live` / `--dry-run` で上書き可） |
| `profile` | 提案文・返信の材料 |
| `search` / `filters` | 巡回対象と足切り条件（予算・時給・応募者数・除外キーワード等） |
| `ai` | モデル（既定 `claude-opus-5-5`）、effort、応募する最低スコア |
| `limits` | 応募の 1回/1日 上限、間隔 |
| `schedule` | 応募巡回の間隔、メッセージ確認の間隔、稼働時間帯（JST） |
| `inbox` | メッセージ一覧の URL とスレッドリンクのパターン |
| `negotiation` | 契約自動承諾の可否と金額条件、返信の回数制限・間隔・最大文字数 |
| `safety` | 自動停止までの連続失敗回数、送信チェックで許可する文字列（自分のポートフォリオ URL 等の正規表現） |
| `selectors` | 各画面の CSS セレクタ。**CrowdWorks の画面変更で動かなくなったらここを修正** |

## 管理画面

`npm run serve`（Docker では既定）で、常駐ボットと管理画面が同じプロセスで動きます。スマホからも操作できます。

| 画面 | できること |
|---|---|
| ダッシュボード | 稼働状態・本番/テストモード、本日の応募数・返信数、受注数、**要対応スレッド**（理由と返信案）、**緊急停止 / 再開**、今すぐ実行 |
| メッセージ | スレッドの状態別一覧、ボットが送った文面、要対応 → 自動対応に戻す / 自動対応を止める |
| 案件 | 審査結果・スコア・提示額・提案文・スクリーンショット |
| 送信履歴 | 監査ログ（応募・返信・契約・管理操作） |
| ログ | 直近の動作ログ |
| 設定 | テストモード、上限、稼働時間、キーワード、契約自動承諾の金額条件、プロフィール。JSON で全項目も編集可（保存時に検証） |
| ログイン情報 | 手元で `npm run login` して作った `data/storage-state.json` を貼り付けて登録、ログイン確認 |

セキュリティ: パスワード必須（12文字以上・`ADMIN_PASSWORD`）、5回失敗で15分ロック、HttpOnly / SameSite=Strict Cookie、CSRF トークン、CSP、表示する外部データはすべてエスケープ。
Docker では管理画面を `127.0.0.1` にだけ公開し、SSH トンネルで見るのが既定です。ドメインを使う場合は Caddy が HTTPS を自動設定します。

## デプロイ（Google Cloud VM・1 コマンド）

手元の PC で（gcloud CLI が必要）:

```bash
cd crowdworks-auto-apply
cp .env.example .env            # ANTHROPIC_API_KEY・ADMIN_PASSWORD・SLACK_WEBHOOK_URL を記入
gcloud auth login
gcloud config set project <PROJECT_ID>
./deploy/deploy-gce.sh           # VM 作成 → Docker 導入 → アップロード → 起動（2回目以降は更新のみ）
```

HTTPS で公開する場合は、ドメインの A レコードを VM の外部 IP に向けてから
`.env` に `COOKIE_SECURE=1` と `TRUST_PROXY=1` を設定し、`DOMAIN=bot.example.com ./deploy/deploy-gce.sh`。

起動後の初期設定（管理画面で）:
1. 「ログイン情報」に、手元で `npm run login` して作った `data/storage-state.json` の中身を貼り付け → 「ログインできるか確認」
2. 「設定」でテストモードをオンにして数回動かし、「案件」「送信履歴」で内容を確認
3. 問題なければテストモードをオフ

自前のサーバーで動かす場合は `docker compose up -d --build`（HTTPS は `DOMAIN=... docker compose --profile https up -d --build`）。

## トラブルシューティング

- **自動停止した** → Slack の理由と `data/screenshots/` を確認し、原因（画面変更・ログイン切れ等）を直してから `npm run unhalt`
- **フォーム・入力欄・ボタンが見つからない** → スクリーンショットを見て `selectors` を修正
- **ログイン切れ / CAPTCHA** → `npm run login` をやり直す
- **メッセージに反応しない** → `inbox.listUrls` をブラウザで開いて、スレッドへのリンクが `inbox.threadLinkPatterns` に合うか確認

## テスト

```bash
npm test
```

ユニットテストに加え、Chromium で crowdworks.jp へのリクエストを偽サイトに差し替えた E2E テストで、応募送信、返信、契約承諾、危険なスレッドのエスカレーション、値切り契約の拒否、緊急停止を検証しています。
**実際の CrowdWorks の画面では未検証**のため、初回は必ず dry-run で確認してください。

## ファイル構成

```
src/cli.js           コマンド
src/scheduler.js     常駐スケジューラ（設定のホットリロード・同時実行防止）
src/admin/           管理画面（認証・画面・静的ファイル）
deploy/deploy-gce.sh Google Cloud VM へのデプロイ
src/runner.js        応募巡回
src/inbox-runner.js  メッセージ対応・契約承諾
src/crowdworks.js    ログイン・検索・詳細解析・応募送信（Playwright）
src/inbox.js         スレッド取得・返信送信・契約承諾（Playwright）
src/llm.js           Claude: 案件審査と提案文
src/conversation.js  Claude: メッセージ対応の判断と返信文
src/guards.js        送信前/受信時の安全チェック・契約承諾条件
src/safety.js        緊急停止・自動停止・ロック・監査ログ
src/filter.js        ルールフィルタ・金額処理
src/store.js         応募・スレッド履歴（data/state.json）
```
