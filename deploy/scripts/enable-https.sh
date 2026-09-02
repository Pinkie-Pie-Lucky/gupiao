#!/usr/bin/env bash
set -euo pipefail

email="${1:?用法：./enable-https.sh <证书通知邮箱>}"
root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
edge_compose="$root_dir/deploy/docker-compose.edge.yml"

docker compose --project-name paopao-edge -f "$edge_compose" --profile certbot run --rm certbot certonly \
  --webroot -w /var/www/certbot --email "$email" --agree-tos --no-eff-email \
  -d paopaoai.pixiepoppy.com -d test.paopaoai.pixiepoppy.com

cp "$root_dir/deploy/nginx/paopao.conf" "$root_dir/deploy/nginx/paopao.active.conf"
docker compose --project-name paopao-edge -f "$edge_compose" exec -T nginx nginx -s reload
