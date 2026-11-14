# ハムハムトーク 🐹💕

ふたり専用の LINE Bot（試作品）。ハムスターの「ハムハム」が、はむ語でお返事します。

## できること

| 送る言葉 | ハムハムの反応 |
| --- | --- |
| `はむ語 今日は楽しかった！` | `今日は楽しかったはむ！` に変換 |
| `記念日` | 付き合って何日目か／次のキリ番まであと何日か |
| `おみくじ` | 今日のラブラブおみくじ |
| `デート案` | デートのアイデア |
| `大好き` | 照れる |
| `ヘルプ` | 使い方 |
| `ID` | 自分の userId を表示（ふたり専用設定に使う） |
| それ以外 | はむ語で自由におしゃべり（`GEMINI_API_KEY` があれば AI、無ければ定型文） |

- 1対1トーク: 何でもお返事します。
- ふたり＋ハムハムのグループ: 上の合言葉と、「ハムハム」と呼ばれたときだけお返事します。

## 準備（LINE 側・初回だけ）

1. [LINE Developers Console](https://developers.line.biz/console/) で Messaging API チャネルを作成（名前: ハムハムトーク）
2. 「チャネル基本設定」の **チャネルシークレット**、「Messaging API設定」の **チャネルアクセストークン（長期）** を控える
3. [LINE Official Account Manager](https://manager.line.biz/) の応答設定で **Webhook: オン／応答メッセージ: オフ**、グループで使うなら **グループ参加を許可**

## デプロイ（Google Cloud Run）

```bash
cd hamham-talk
export LINE_CHANNEL_SECRET=（チャネルシークレット）
export LINE_CHANNEL_ACCESS_TOKEN=（チャネルアクセストークン）
export ANNIVERSARY=2025-01-01      # 任意: 付き合った日
export GEMINI_API_KEY=（キー）      # 任意: AI おしゃべり用
./deploy.sh
```

`deploy.sh` は Cloud Run へのデプロイ → LINE の Webhook URL 登録 → 疎通テストまで行います。
手動でやる場合は次のコマンドと同じです。

```bash
gcloud run deploy hamham-talk --source . --region asia-northeast1 --allow-unauthenticated \
  --set-env-vars "LINE_CHANNEL_SECRET=xxx,LINE_CHANNEL_ACCESS_TOKEN=xxx,ANNIVERSARY=2025-01-01"
# 表示された URL の末尾に /webhook を付けて、LINE Developers Console の Webhook URL に設定
```

### ふたり専用にする

1. デプロイ後、ふたりそれぞれがハムハムに `ID` と送る
2. 返ってきた 2 つの ID を入れて再デプロイ

```bash
export ALLOWED_USER_IDS=Uxxxxxxxx,Uyyyyyyyy
./deploy.sh
```

これ以降、ふたり以外には「ここはふたりだけの秘密のおへやはむ🐹🔒」としか答えません。

## 環境変数

| 名前 | 必須 | 内容 |
| --- | --- | --- |
| `LINE_CHANNEL_SECRET` | ✅ | Webhook の署名検証用 |
| `LINE_CHANNEL_ACCESS_TOKEN` | ✅ | 返信用 |
| `ANNIVERSARY` | | 付き合った日 `YYYY-MM-DD` |
| `ALLOWED_USER_IDS` | | ふたりの userId（カンマ区切り）。空なら誰でも使える |
| `GEMINI_API_KEY` | | 自由会話を AI にする |
| `GEMINI_MODEL` | | 既定 `gemini-2.5-flash` |

## ローカルで確認

```bash
npm test     # 依存パッケージなし（Node 20 以上）
```
