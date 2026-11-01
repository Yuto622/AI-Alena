#!/usr/bin/env bash
# Google Cloud の VM（e2-small・東京リージョン）に 1 コマンドでデプロイ／更新する。
#   使い方: ./deploy/deploy-gce.sh            # 初回は VM 作成から、2 回目以降はコード更新のみ
#   前提  : gcloud auth login 済み、gcloud config set project <PROJECT_ID> 済み、.env を作成済み
set -euo pipefail
cd "$(dirname "$0")/.."

VM="${VM:-cw-bot}"
ZONE="${ZONE:-asia-northeast1-b}"
MACHINE="${MACHINE:-e2-small}"
PROFILE_ARG=""
[ -n "${DOMAIN:-}" ] && PROFILE_ARG="--profile https"

[ -f .env ] || { echo ".env がありません。cp .env.example .env して編集してください"; exit 1; }
grep -q '^ANTHROPIC_API_KEY=.\+' .env || { echo ".env に ANTHROPIC_API_KEY を設定してください"; exit 1; }
grep -Eq '^ADMIN_PASSWORD=.{12,}' .env || { echo ".env に ADMIN_PASSWORD（12文字以上）を設定してください"; exit 1; }

if ! gcloud compute instances describe "$VM" --zone "$ZONE" >/dev/null 2>&1; then
  echo "▶ VM を作成します ($VM / $ZONE / $MACHINE)"
  gcloud compute instances create "$VM" --zone "$ZONE" --machine-type "$MACHINE" \
    --image-family ubuntu-2404-lts-amd64 --image-project ubuntu-os-cloud --boot-disk-size 20GB \
    --tags cw-bot --metadata startup-script='#!/bin/bash
if ! command -v docker >/dev/null; then curl -fsSL https://get.docker.com | sh; fi'
  if [ -n "${DOMAIN:-}" ]; then
    gcloud compute firewall-rules describe cw-bot-https >/dev/null 2>&1 || \
      gcloud compute firewall-rules create cw-bot-https --allow tcp:80,tcp:443 --target-tags cw-bot
  fi
  echo "▶ Docker のインストールを待っています..."
  for i in $(seq 1 40); do
    gcloud compute ssh "$VM" --zone "$ZONE" --command 'command -v docker' >/dev/null 2>&1 && break
    sleep 15
  done
fi

echo "▶ コードと .env をアップロード"
tar --exclude=node_modules --exclude=data --exclude=config.json -czf - . \
  | gcloud compute ssh "$VM" --zone "$ZONE" --command 'mkdir -p ~/cw-bot && tar xzf - -C ~/cw-bot && chmod 600 ~/cw-bot/.env'

echo "▶ 起動"
gcloud compute ssh "$VM" --zone "$ZONE" --command "cd ~/cw-bot && sudo DOMAIN='${DOMAIN:-}' docker compose $PROFILE_ARG up -d --build && sudo docker compose ps"

cat <<MSG

✅ デプロイ完了
管理画面:
$( [ -n "${DOMAIN:-}" ] && echo "  https://${DOMAIN}" || echo "  gcloud compute ssh $VM --zone $ZONE -- -N -L 8080:localhost:8080   （このまま開いておき）
  → ブラウザで http://localhost:8080" )
ログ:     gcloud compute ssh $VM --zone $ZONE --command 'cd ~/cw-bot && sudo docker compose logs -f --tail 100 bot'
緊急停止: gcloud compute ssh $VM --zone $ZONE --command 'cd ~/cw-bot && sudo docker compose exec bot node src/cli.js stop 手動停止'
MSG
