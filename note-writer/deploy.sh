#!/usr/bin/env bash
# note-writer を Google Cloud にデプロイする。固定費をほぼゼロにする構成：
#   - Cloud Run：最小0台（アクセスがない間は課金なし）、最大1台（二重投稿防止も兼ねる）
#     公開は IAM チェックを外す方式（allUsers を付けられないプロジェクトでも動く。管理画面は Basic 認証で守る）
#   - データ：Cloud Storage を /data にマウント（us-central1 は無料枠の対象リージョン）
#   - 予約実行：Cloud Scheduler 1ジョブ（請求先アカウントあたり3ジョブまで無料）
#   - 秘密情報：Secret Manager 3件（6件まで無料）。note のログイン情報は管理画面で入れ、暗号化してデータ置き場に保存
#   - イメージ：古いものを自動削除して保存容量を最小に
#
# 使い方：bash note-writer/deploy.sh <GCPプロジェクトID>
# 初回は Anthropic API キーを聞かれる（画面には表示されない）
set -euo pipefail

PROJECT="${1:?使い方: bash note-writer/deploy.sh <GCPプロジェクトID>}"
REGION="${REGION:-us-central1}"
SERVICE="note-writer"
BUCKET="${PROJECT}-note-writer-data"
DIR="$(cd "$(dirname "$0")" && pwd)"

# Windows（Git for Windows の bash）で動かすとき：
# gcloud は gcloud.cmd として入っている。また "/data" のような引数を Windows のパスに書き換えられないようにする
if command -v cygpath >/dev/null 2>&1; then
  export MSYS_NO_PATHCONV=1
  DIR="$(cygpath -w "$DIR")"
  if ! command -v gcloud >/dev/null 2>&1 || ! gcloud --version >/dev/null 2>&1; then
    # gcloud.cmd を経由すると、空白を含む引数（"5 * * * *" など）を cmd.exe が壊すので、
    # SDK 同梱の Python で gcloud.py を直接動かす。出力の行末の \r は取り除く
    SDK_ROOT="$(dirname "$(dirname "$(command -v gcloud.cmd)")")"
    GCLOUD_PY="$SDK_ROOT/platform/bundledpython/python.exe"
    [ -x "$GCLOUD_PY" ] || GCLOUD_PY="$(command -v python3 || command -v python || true)"
    if [ -n "$GCLOUD_PY" ]; then
      GCLOUD_MAIN="$(cygpath -w "$SDK_ROOT/lib/gcloud.py")"
      gcloud() { "$GCLOUD_PY" -S "$GCLOUD_MAIN" "$@" | tr -d '\r'; }
    else
      gcloud() { gcloud.cmd "$@" | tr -d '\r'; }
    fi
  fi
fi
winpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi; }

gcloud config set project "$PROJECT" >/dev/null
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  cloudscheduler.googleapis.com secretmanager.googleapis.com storage.googleapis.com

# データ置き場
if ! gcloud storage buckets describe "gs://$BUCKET" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://$BUCKET" --location="$REGION" --uniform-bucket-level-access
fi

# 秘密情報。中身（有効なバージョン）があれば触らない。入れ物だけで中身が空なら入れ直す
has_value() {
  [ -n "$(gcloud secrets versions list "$1" --filter='state:ENABLED' --limit=1 --format='value(name)' 2>/dev/null)" ]
}
put_secret() {
  local name="$1" value="$2"
  if gcloud secrets describe "$name" >/dev/null 2>&1; then
    printf '%s' "$value" | gcloud secrets versions add "$name" --data-file=-
  else
    printf '%s' "$value" | gcloud secrets create "$name" --replication-policy=automatic --data-file=-
  fi
}
# 空のまま Enter されたら聞き直す（空の秘密情報だとデプロイが失敗するため）
ask() {
  local v=""
  while [ -z "$v" ]; do read -r -s -p "$1: " v; echo >&2; done
  printf '%s' "$v"
}
# note のメールアドレスとパスワードは、デプロイ後に管理画面の「設定」で入れる
has_value ANTHROPIC_API_KEY || put_secret ANTHROPIC_API_KEY "$(ask 'Anthropic API キー')"
if ! has_value ADMIN_PASSWORD; then
  ADMIN_PASSWORD="$(openssl rand -hex 12)"
  put_secret ADMIN_PASSWORD "$ADMIN_PASSWORD"
  echo "管理画面のパスワード（ユーザー名は admin）: $ADMIN_PASSWORD  ← 控えておく"
fi
has_value CRON_TOKEN || put_secret CRON_TOKEN "$(openssl rand -hex 24)"

# Cloud Run の実行アカウントに、秘密情報とデータ置き場の権限を付ける
PNUM="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
SA="${PNUM}-compute@developer.gserviceaccount.com"
# 記事の中のアプリのリンク（クリックを数える）に使う、このサービスの URL
PUBLIC_URL="https://${SERVICE}-${PNUM}.${REGION}.run.app"
for s in ANTHROPIC_API_KEY ADMIN_PASSWORD CRON_TOKEN; do
  gcloud secrets add-iam-policy-binding "$s" --member="serviceAccount:$SA" \
    --role=roles/secretmanager.secretAccessor >/dev/null
done
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$SA" \
  --role=roles/storage.objectUser >/dev/null
# 新しいプロジェクトでは、ソースからのビルドに使うこのアカウントにビルド権限が付いていない
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" \
  --role=roles/cloudbuild.builds.builder --condition=None >/dev/null

# ビルドとデプロイ（付けたばかりの権限が効くまで少しかかるので、失敗したら待ってやり直す）
deploy() {
gcloud run deploy "$SERVICE" --quiet \
  --source "$DIR" \
  --region "$REGION" \
  --execution-environment gen2 \
  --cpu 1 --memory 2Gi \
  --min-instances 0 --max-instances 1 --concurrency 4 \
  --timeout 900 \
  --no-invoker-iam-check \
  --add-volume "name=data,type=cloud-storage,bucket=$BUCKET" \
  --add-volume-mount "volume=data,mount-path=/data" \
  --set-env-vars "DATA_DIR=/data,PUBLIC_URL=$PUBLIC_URL" \
  --set-secrets "ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest,ADMIN_PASSWORD=ADMIN_PASSWORD:latest,CRON_TOKEN=CRON_TOKEN:latest"
}
for attempt in 1 2 3; do
  if deploy; then break; fi
  [ "$attempt" = 3 ] && { echo "デプロイに3回失敗しました。上のエラーを確認してください。"; exit 1; }
  echo "権限の反映を待って、60秒後にやり直します（${attempt}/3）..."
  sleep 60
done

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
CRON_TOKEN="$(gcloud secrets versions access latest --secret=CRON_TOKEN)"

# 予約実行（毎時5分。期限の来た記事の公開と、予約が足りないときの生成）
JOB_ARGS=(--location "$REGION" --schedule "5 * * * *" --time-zone "Asia/Tokyo"
  --uri "$URL/cron/tick" --http-method POST --headers "x-cron-token=$CRON_TOKEN" --attempt-deadline 900s)
if gcloud scheduler jobs describe note-writer-tick --location "$REGION" >/dev/null 2>&1; then
  gcloud scheduler jobs update http note-writer-tick "${JOB_ARGS[@]}" >/dev/null
else
  gcloud scheduler jobs create http note-writer-tick "${JOB_ARGS[@]}" >/dev/null
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
  --location "$REGION" --policy "$(winpath "$POLICY")" --no-dry-run >/dev/null || echo "（イメージの自動削除の設定はスキップしました）"
rm -f "$POLICY"

echo
echo "✅ デプロイ完了"
echo "管理画面: $URL  （ユーザー名 admin）"
echo "最初に管理画面の「設定」で、note のログイン状態（cookie）を貼ってください。"
