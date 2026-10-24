# note-writer

note の有料記事を書いて、ログイン〜公開まで自動で行うツール。

## 準備（クラウド環境の設定）

1. Network access の Allowed domains に `note.com` `*.note.com` `assets.st-note.com` を追加
2. 環境変数に `NOTE_EMAIL` と `NOTE_PASSWORD` を登録（チャットには貼らない）

## 使い方

```bash
node note-writer/publish.mjs --check                          # ログイン確認
node note-writer/publish.mjs note-writer/articles/xxx.md --draft  # 下書き保存まで
node note-writer/publish.mjs note-writer/articles/xxx.md          # 公開
```

- 記事は `articles/_template.md` をコピーして書く。`<!-- paid -->` より下が有料部分。
- `status: ready` の記事だけ公開される。
- 公開と公開の間は 3 時間以上空ける（`NOTE_MIN_INTERVAL_HOURS` で変更可。`--force` で無視）。
- 公開履歴は `published.json`、各ステップの画面は `out/` に残る。
- 画面が想定と違ったときは、公開せずに下書き保存して止まる。
