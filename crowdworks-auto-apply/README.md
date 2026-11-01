# CrowdWorks 自動応募ボット

CrowdWorks の新着案件を定期的に巡回し、**検索 → 詳細取得 → ルールで足切り → Claude で審査と提案文作成 → 応募フォーム送信** までを自動で行います。

```
[検索(キーワード/URL)] → [案件詳細] → [ルールフィルタ] → [Claude 審査 + 提案文] → [応募送信 or 下書き] → [Slack 通知]
                                         ↑予算・応募者数・除外語      ↑詐欺/外部誘導の検出・スコア
```

> ⚠ **利用前に必ず読んでください**
> - CrowdWorks の利用規約は、自動化ツールによるアクセスや機械的な大量応募を禁止・制限している可能性があります。アカウント停止のリスクは利用者の責任です。規約を確認のうえ利用してください。
> - 既定値は **dry-run（送信しない）** です。提案文の品質を確認してから `--live` で本番送信してください。
> - 1日の応募数（最大50件で上限固定）と応募間隔（最小30秒）にはハードリミットがあります。少数の案件に質の高い提案を送る使い方を想定しています。

## セットアップ

```bash
cd crowdworks-auto-apply
npm install
npx playwright install chromium   # ブラウザ未導入の環境のみ
cp config.example.json config.json
cp .env.example .env              # ANTHROPIC_API_KEY などを記入
```

1. `config.json` の `profile`（名前・スキル・実績）を**自分の情報に書き換える**。AI はここに書かれていない経歴は書きません。
2. `search.keywords` に探したいキーワード、または `search.searchUrls` に CrowdWorks の検索結果 URL（カテゴリ・条件を絞ったもの）を入れる。
3. ログインしてセッションを保存（ブラウザが開きます。二段階認証や CAPTCHA も手動で）:

   ```bash
   npm run login
   ```
   画面のないサーバーでは、手元の PC で `npm run login` → 生成された `data/storage-state.json` をサーバーへコピー。`CW_EMAIL` / `CW_PASSWORD` を設定しておくと、セッション切れ時に自動再ログインを試みます。

## 使い方

```bash
npm run dry-run             # 1回巡回。フォーム入力まで行い送信しない（data/screenshots に画面保存）
npm run run -- --live       # 1回巡回して実際に応募
npm run loop -- --live      # 常駐して schedule.intervalMinutes ごとに巡回（完全自動）
npm run stats               # 処理件数・本日の応募数
```

### 半自動（下書き承認）モード

```bash
npm run run -- --mode draft        # 応募せず data/drafts/<案件ID>.md に提案文を保存（Slack にも通知）
npm run apply -- 12345678          # 内容を確認した下書きを応募
```

### おすすめの導入手順

1. `npm run dry-run` を数回 → `data/state.json` と `data/screenshots/` で審査結果・入力内容を確認
2. `ai.minScore` / `filters` / `profile` を調整
3. `--mode draft` で数日運用し、提案文の質を確認
4. 問題なければ `config.json` の `"dryRun": false` にして `npm run loop`

dry-run で審査済みの案件は、本番実行時に審査結果を再利用します（API コスト節約）。

## 設定（config.json）

| キー | 説明 |
|---|---|
| `mode` | `auto`（自動送信）/ `draft`（下書きのみ） |
| `dryRun` | `true` なら送信しない。CLI の `--live` / `--dry-run` で上書き可 |
| `profile` | 提案文の材料。名前・肩書き・自己紹介・スキル・実績・稼働・希望時給・署名 |
| `search.keywords` / `searchUrls` | 巡回対象。URL はブラウザで条件を絞った検索結果ページをそのまま貼れます |
| `filters` | 契約形式（`fixed_price`/`hourly`）、最低予算・時給、最大応募者数、必須/除外キーワード、クライアント評価・本人確認 |
| `ai.model` / `effort` | 既定 `claude-opus-5-5` / `medium`。コストを下げるなら `effort: "low"` |
| `ai.minScore` | この点数以上（0〜100）だけ応募 |
| `limits` | 1回・1日の応募上限、応募間隔（秒）、ページ遷移間隔（秒） |
| `schedule` | 巡回間隔（分、±20% ゆらぎ）、稼働時間帯（JST） |
| `selectors` | 応募フォームなどの CSS セレクタ。**CrowdWorks の画面変更で動かなくなったらここを修正** |

## AI 審査の内容

Claude（`src/llm.js`）が案件ごとに JSON で以下を返します。

- `apply` / `score`: 応募可否と適合度。外部連絡先（LINE 等）への誘導、初期費用の要求、情報商材・MLM・レビュー代行など規約違反の疑い、無償テストは自動で却下
- `proposal`: 案件の要件に触れた日本語の提案文（プロフィールにない実績は書かない）
- `amountYen` / `deliveryDays`: 提示額（予算レンジ内に自動で丸め）と納期目安

案件本文に「指示を無視して〜」のようなプロンプトインジェクションがあっても従わないよう指示しています。
安全分類器による誤拒否に備え、サーバー側フォールバック（`fallbacks: "default"`）を有効にしています。

## 常駐運用（Docker / cron）

```bash
docker build -t cw-apply .
docker run -d --name cw-apply --restart unless-stopped \
  -v $(pwd)/config.json:/app/config.json:ro -v $(pwd)/.env:/app/.env:ro -v $(pwd)/data:/app/data \
  cw-apply node src/cli.js loop --live
```

cron で 1 回ずつ動かす場合: `17 9-22 * * * cd /path/to/crowdworks-auto-apply && node src/cli.js run --live >> data/cron.log 2>&1`

## トラブルシューティング

- **「応募フォーム（メッセージ欄）が見つかりません」** → `data/screenshots/` の画像を見て `selectors.proposalMessage` などを修正
- **「ログインが切れています」/ CAPTCHA** → `npm run login` をやり直す。巡回は自動で中断され Slack に通知されます
- **案件が 0 件** → `search.searchUrls` にブラウザで開いた検索結果 URL を指定してみてください
- 状態のリセット: `data/state.json` を削除（応募履歴も消えるため二重応募に注意）

## テスト

```bash
npm test
```

ユニットテストに加え、Chromium で crowdworks.jp へのリクエストを偽サイトに差し替え、検索〜応募送信までを通しで検証する E2E テスト（`test/e2e-mock.test.js`）を含みます。

## ファイル構成

```
src/cli.js         コマンド（login / run / loop / apply / stats）
src/runner.js      巡回の全体制御・上限管理・下書き
src/crowdworks.js  Playwright によるログイン・検索・詳細解析・応募送信
src/llm.js         Claude による審査と提案文生成（構造化出力）
src/filter.js      ルールフィルタ・金額処理
src/store.js       応募履歴・日次カウント（data/state.json）
src/notify.js      Slack 通知
```
