# 保護者向けAI分析レポート生成ツール

U-Speak Roblox の生徒学習データ（CSV）から、保護者向けのPDFレポートを自動生成するWebアプリです。

## 特徴

- CSVアップロード（ドラッグ＆ドロップ対応、UTF-8 BOMあり可）
- 生徒選択・期間絞り込み
- Anthropic Claude による保護者向け温かみのあるコメント自動生成
- matplotlib による日別プレイ時間・正答率推移グラフ
- ReportLab による日本語PDF（1生徒1ページ）

## セットアップ

```bash
cd parent_report
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# AIコメント生成を有効にする場合のみ:
export ANTHROPIC_API_KEY=sk-ant-...
# 任意: モデル指定（デフォルト claude-sonnet-4-6）
# export ANTHROPIC_MODEL=claude-sonnet-4-6
```

APIキーが未設定の場合は、決まった雛形でコメントを生成するフォールバックが動作します。

## 起動

```bash
uvicorn parent_report.main:app --reload --port 8000
# または parent_report ディレクトリ内で:
# uvicorn main:app --reload --port 8000
```

ブラウザで <http://localhost:8000> を開いてください。

## サンプルデータ

`samples/sample.csv` に3名分のサンプルデータを同梱しています。

## CSVカラム仕様

| カラム名 | 内容 |
|----------|------|
| student_name | 生徒名 |
| parent_name | 保護者名 |
| grade | 学年（例: 小3） |
| eiken_level | 英検目標級（例: 5級） |
| play_date | プレイ日（YYYY-MM-DD） |
| play_minutes | プレイ時間（分） |
| words_attempted | 挑戦した単語数 |
| words_correct | 正解した単語数 |
| sentences_spoken | 発話した文数 |
| missions_completed | クリアしたミッション数 |
| weak_words | 苦手単語（カンマ区切り） |

同一 `student_name` が複数行に現れる場合は集計されます。

## 日本語フォントについて

- **PDF (ReportLab)**: `HeiseiKakuGo-W5` という ReportLab 同梱の CID フォントを使用するため、追加ファイル不要です。
- **グラフ (matplotlib)**: システムに日本語フォント（Noto Sans CJK JP / IPAexGothic など）が入っていればそれを使用します。無い場合、グラフのラベルが豆腐表示になる可能性があります。
