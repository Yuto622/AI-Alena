#!/usr/bin/env bash
# note-writer を Google Cloud にデプロイする。固定費をほぼゼロにする構成：
#   - Cloud Run：最小0台（アクセスがない間は課金なし）、最大1台（二重投稿防止も兼ねる）
#   - データ：Cloud Storage を /data にマウント（us-central1 は無料枠の対象リージョン）
#   - 予約実行：Cloud Scheduler 1ジョブ（請求先アカウントあたり3ジョブまで無料）
#   - 秘密情報：Secret Manager 5件（6件まで無料）
#   - イメージ：古いものを自動削除して保存容量を最小に
#
# 使い方：bash note-writer/deploy.sh <GCPプロジェクトID>
# 初回は note のメールアドレス・パスワード・Anthropic API キーを聞かれる（画面には表示されない）
set -euo pipefail

PROJECT="${1:?使い方: bash note-writer/deploy.sh <GCPプロジェクトID>}"
REGION="${REGION:-us-central1}"
SERVICE="note-writer"
BUCKET="${PROJECT}-note-writer-data"
DIR="$(cd "$(dirname "$0")" && pwd)"

gcloud config set project "$PROJECT" >/dev/null
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  cloudscheduler.googleapis.com secretmanager.googleapis.com storage.googleapis.com

# データ置き場
if ! gcloud storage buckets describe "gs://$BUCKET" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://$BUCKET" --location="$REGION" --uniform-bucket-level-access
fi

# 秘密情報（既にあれば作り直さない）
secret() {
  local name="$1" value="$2"
  if ! gcloud secrets describe "$name" >/dev/null 2>&1; then
    printf '%s' "$value" | gcloud secrets create "$name" --replication-policy=automatic --data-file=-
  fi
}
ask() { local v; read -r -s -p "$1: " v; echo >&2; printf '%s' "$v"; }
gcloud secrets describe NOTE_EMAIL >/dev/null 2>&1 || secret NOTE_EMAIL "$(ask 'note のメールアドレス')"
gcloud secrets describe NOTE_PASSWORD >/dev/null 2>&1 || secret NOTE_PASSWORD "$(ask 'note のパスワード')"
gcloud secrets describe ANTHROPIC_API_KEY >/dev/null 2>&1 || secret ANTHROPIC_API_KEY "$(ask 'Anthropic API キー')"
if ! gcloud secrets describe ADMIN_PASSWORD >/dev/null 2>&1; then
  ADMIN_PASSWORD="$(openssl rand -base64 18)"
  secret ADMIN_PASSWORD "$ADMIN_PASSWORD"
  echo "管理画面のパスワード（ユーザー名は admin）: $ADMIN_PASSWORD  ← 控えておく"
fi
secret CRON_TOKEN "$(openssl rand -hex 24)"

# Cloud Run の実行アカウントに、秘密情報とデータ置き場の権限を付ける
SA="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')-compute@developer.gserviceaccount.com"
for s in NOTE_EMAIL NOTE_PASSWORD ANTHROPIC_API_KEY ADMIN_PASSWORD CRON_TOKEN; do
  gcloud secrets add-iam-policy-binding "$s" --member="serviceAccount:$SA" \
    --role=roles/secretmanager.secretAccessor >/dev/null
done
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$SA" \
  --role=roles/storage.objectUser >/dev/null

# ビルドとデプロイ
gcloud run deploy "$SERVICE" \
  --source "$DIR" \
  --region "$REGION" \
  --execution-environment gen2 \
  --cpu 1 --memory 2Gi \
  --min-instances 0 --max-instances 1 --concurrency 4 \
  --timeout 900 \
  --allow-unauthenticated \
  --add-volume "name=data,type=cloud-storage,bucket=$BUCKET" \
  --add-volume-mount "volume=data,mount-path=/data" \
  --set-env-vars "DATA_DIR=/data" \
  --set-secrets "NOTE_EMAIL=NOTE_EMAIL:latest,NOTE_PASSWORD=NOTE_PASSWORD:latest,ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest,ADMIN_PASSWORD=ADMIN_PASSWORD:latest,CRON_TOKEN=CRON_TOKEN:latest"

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
CRON_TOKEN="$(gcloud secrets versions access latest --secret=CRON_TOKEN)"

# 予約実行（毎時5分。期限の来た記事の公開と、予約が足りないときの生成）
JOB_ARGS=(--location "$REGION" --schedule "5 * * * *" --time-zone "Asia/Tokyo"
  --uri "$URL/cron/tick" --http-method POST --headers "x-cron-token=$CRON_TOKEN" --attempt-deadline 900s)
if gcloud scheduler jobs describe note-writer-tick --location "$REGION" >/dev/null 2>&1; then
  gcloud scheduler jobs update http note-writer-tick "${JOB_ARGS[@]}"
else
  gcloud scheduler jobs create http note-writer-tick "${JOB_ARGS[@]}"
fi

# 古いイメージを自動で消す（最新1つだけ残す）
POLICY="$(mktemp)"
cat > "$POLICY" <<'EOF'
[
  { "name": "keep-latest", "action": { "type": "Keep" }, "mostRecentVersions": { "keepCount": 1 } },
  { "name": "delete-rest", "action": { "type": "Delete" }, "condition": { "tagState": "any" } }
]
EOF
gcloud artifacts repositories set-cleanup-policies cloud-run-source-deploy \
  --location "$REGION" --policy "$POLICY" --no-dry-run >/dev/null || echo "（イメージの自動削除の設定はスキップしました）"
rm -f "$POLICY"

echo
echo "✅ デプロイ完了"
echo "管理画面: $URL  （ユーザー名 admin）"
