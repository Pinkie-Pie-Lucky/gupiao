#!/usr/bin/env bash
set -euo pipefail

environment="${1:?用法：./backup-db.sh <prod|test>}"
case "$environment" in prod|test) ;; *) exit 1 ;; esac

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
env_file="$root_dir/deploy/env/.env.$environment"
backup_dir="$root_dir/backups/$environment"
mkdir -p "$backup_dir"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"

set -a
source "$env_file"
set +a
if command -v podman-compose >/dev/null 2>&1; then
  compose=(podman-compose)
else
  compose=(docker compose)
fi
"${compose[@]}" -p "paopao-$environment" --env-file "$env_file" -f "$root_dir/deploy/docker-compose.$environment.yml" exec -T db \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" | gzip > "$backup_dir/${POSTGRES_DB}-${timestamp}.sql.gz"
find "$backup_dir" -type f -name '*.sql.gz' -mtime +14 -delete
