# note-writer

note の記事を「書く → 予約 → 公開 → 売上の記録 → 次のテーマ選び」まで回すシステム。管理画面つき。

## 全体の流れ

1. **ネタ帳**（`topics.json`）のテーマから、Claude が記事を書く（`lib/generator.mjs`）
2. 月・水・金 20:00（日本時間）の空いている枠に**予約**される
3. 管理画面で確認して「公開OK」にする（設定で確認なしにもできる）
4. 1時間ごとの**予約実行**（`/cron/tick`）が、期限の来た記事を Playwright で note に**公開**する
5. note の管理画面の販売数・閲覧数を、管理画面に月ごとに**入力**する
6. **売れたタグ**を多く含むテーマから先に書く。ダッシュボードに、価格・有料ライン・マガジン化などの**提案**が出る

公開に失敗した記事は「失敗（要確認）」になり、人が直すまで再実行しない（note に下書きが増え続けないため）。

## デプロイ（Google Cloud）

```bash
gcloud auth login
bash note-writer/deploy.sh <GCPプロジェクトID>
```

初回だけ note のメールアドレス・パスワード・Anthropic API キーを聞かれる（画面には表示されない）。
最後に管理画面の URL とパスワード（ユーザー名 `admin`）が表示される。2回目以降も同じコマンドで更新できる。

### 固定費をほぼゼロにする構成

| 部品 | 設定 | 費用の目安 |
|---|---|---|
| Cloud Run | 最小0台・最大1台、リクエスト中だけ課金 | 無料枠内 |
| Cloud Storage | データ置き場（数MB）、us-central1 | 無料枠内 |
| Cloud Scheduler | 1ジョブ（毎時5分） | 無料（3ジョブまで） |
| Secret Manager | 5件 | 無料（6件まで） |
| Artifact Registry | 最新のイメージ1つだけ残す | 数十円/月 |
| Claude API | Claude Haiku 5.5（一番安いモデル）。記事1本あたり1円前後 | 使った分だけ（固定費ではない） |

無料枠の条件は Google Cloud の料金ページで確認すること。

## ローカルで動かす

```bash
cd note-writer && npm install
ADMIN_PASSWORD=好きな文字 CRON_TOKEN=好きな文字 node server.mjs   # http://localhost:8080
node publish.mjs --check                                            # note のログイン確認
node publish.mjs articles/xxx.md --draft                             # 下書き保存まで
```

## 記事ファイル

`articles/*.md`。先頭のメタ情報：

```
---
title: タイトル
price: 500            # 0 なら無料
tags: [海外大学, 勉強法]
status: draft         # draft / ready / published / error
publish_at: 2026-11-04T11:00:00.000Z
account: default      # uspeak なら NOTE_USPEAK_EMAIL / NOTE_USPEAK_PASSWORD を使う
cta: uspeak           # cta/uspeak.md を記事の最後に付ける（任意）
---
```

`<!-- paid -->` の行より下が有料部分。表は note が対応していないので使わない。

## 先に設定すること

- 管理画面の「設定」→「筆者について」：記事に経験として書いてよいことだけを書く。生成された記事はここ以外の経験を書かない
- 自動生成は初期状態でオフ。設定でオンにする
- note の画面のボタン名・入力欄は推測で作っている。最初の公開は「note に下書き保存」で試し、「実行ログ」の画面で確認する
