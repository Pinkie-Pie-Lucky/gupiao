#!/usr/bin/env bash
set -euo pipefail

environment="${1:?用法：./deploy.sh <prod|test> [版本号]}"
root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# ECS 部署目录可以是安全同步后的源码副本，不必强依赖 .git 元数据。
# 优先使用显式版本号，其次取 Git 短提交号，最后以 UTC 时间戳保证可追踪性。
if [[ $# -ge 2 && -n "${2:-}" ]]; then
  version="$2"
elif git -C "$root_dir" rev-parse --short HEAD >/dev/null 2>&1; then
  version="$(git -C "$root_dir" rev-parse --short HEAD)"
else
  version="$(date -u +%Y%m%dT%H%M%SZ)"
fi

case "$environment" in
  prod|test) ;;
  *) echo "环境仅支持 prod 或 test" >&2; exit 1 ;;
esac

env_file="$root_dir/deploy/env/.env.$environment"
compose_file="$root_dir/deploy/docker-compose.$environment.yml"
if [[ ! -f "$env_file" ]]; then
  echo "缺少 $env_file，请先从对应 .example 创建并填入独立密钥。" >&2
  exit 1
fi

export DEPLOY_VERSION="$version"
if command -v podman-compose >/dev/null 2>&1; then
  compose=(podman-compose)
else
  compose=(docker compose)
fi

"${compose[@]}" -p "paopao-$environment" --env-file "$env_file" -f "$compose_file" up -d --build
"${compose[@]}" -p "paopao-$environment" --env-file "$env_file" -f "$compose_file" ps
