#!/usr/bin/env bash
# ハムハムトークを Cloud Run にデプロイして、LINE の Webhook URL まで設定する
#
# 使い方:
#   export LINE_CHANNEL_SECRET=xxxx
#   export LINE_CHANNEL_ACCESS_TOKEN=xxxx
#   export ANNIVERSARY=2025-01-01        # 任意: 付き合った日
#   export GEMINI_API_KEY=xxxx           # 任意: 無いと定型文で返信
#   export ALLOWED_USER_IDS=Uaaa,Ubbb    # 任意: ふたりの userId（「ID」と送ると分かる）
#   ./deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

: "${LINE_CHANNEL_SECRET:?LINE_CHANNEL_SECRET を設定してください}"
: "${LINE_CHANNEL_ACCESS_TOKEN:?LINE_CHANNEL_ACCESS_TOKEN を設定してください}"
SERVICE="${SERVICE:-hamham-talk}"
REGION="${REGION:-asia-northeast1}"

# 値にカンマが入っても良いように区切り文字を @ に変更
VARS="^@^LINE_CHANNEL_SECRET=${LINE_CHANNEL_SECRET}@LINE_CHANNEL_ACCESS_TOKEN=${LINE_CHANNEL_ACCESS_TOKEN}"
for name in ANNIVERSARY GEMINI_API_KEY GEMINI_MODEL ALLOWED_USER_IDS; do
  if [ -n "${!name:-}" ]; then VARS+="@${name}=${!name}"; fi
done

gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --memory 256Mi \
  --max-instances 1 \
  --set-env-vars "$VARS"

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format 'value(status.url)')"
echo "🐹 デプロイ完了: $URL"

# LINE 側の Webhook URL を登録して疎通確認
curl -fsS -X PUT https://api.line.me/v2/bot/channel/webhook/endpoint \
  -H "Authorization: Bearer ${LINE_CHANNEL_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"endpoint\":\"${URL}/webhook\"}" >/dev/null
echo "Webhook URL を ${URL}/webhook に設定しました"
curl -fsS -X POST https://api.line.me/v2/bot/channel/webhook/test \
  -H "Authorization: Bearer ${LINE_CHANNEL_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" -d '{}'
echo
