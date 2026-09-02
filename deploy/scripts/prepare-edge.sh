#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
nginx_dir="$root_dir/deploy/nginx"
active_config="$nginx_dir/paopao.active.conf"

if [[ ! -f "$active_config" ]]; then
  cp "$nginx_dir/paopao.http.conf" "$active_config"
fi
docker network inspect paopao-edge >/dev/null 2>&1 || docker network create paopao-edge
docker compose --project-name paopao-edge -f "$root_dir/deploy/docker-compose.edge.yml" up -d
