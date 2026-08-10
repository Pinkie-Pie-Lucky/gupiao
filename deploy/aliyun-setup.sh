#!/usr/bin/env bash
# ============================================================
# 泡泡看市 - 阿里云 Ubuntu 一键部署脚本
# 适用：阿里云 ECS / 轻量应用服务器 (Ubuntu 22.04/24.04)
# 用法：sudo bash deploy/aliyun-setup.sh
# 说明：前后端同机部署，通过 http://IP:8080 访问（无需备案）
# ============================================================
set -euo pipefail

APP_USER="${SUDO_USER:-$(whoami)}"
APP_DIR="/opt/gupiao"
NODE_MAJOR=20
PORT=8080

echo "=============================================="
echo " 泡泡看市 阿里云部署脚本"
echo " 目标目录: ${APP_DIR}"
echo " 运行用户: ${APP_USER}"
echo "=============================================="

if [ "$(id -u)" -ne 0 ]; then
  echo "[错误] 请使用 sudo 运行: sudo bash deploy/aliyun-setup.sh"
  exit 1
fi

# ---------- 1. 基础依赖 ----------
echo "[1/8] 安装系统基础依赖..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
  curl wget git build-essential ca-certificates \
  python3 python3-venv python3-pip python3-dev \
  software-properties-common || true

# ---------- 2. Node.js 20 ----------
echo "[2/8] 安装 Node.js ${NODE_MAJOR}..."
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi
echo "   node: $(node -v 2>/dev/null || echo 未安装)"
echo "   npm:  $(npm -v 2>/dev/null || echo 未安装)"

# ---------- 3. 创建应用目录并部署 ----------
echo "[3/8] 准备应用目录 ${APP_DIR}..."
mkdir -p "${APP_DIR}"
chown -R "${APP_USER}":"${APP_USER}" "${APP_DIR}"

# ---------- 4. 防火墙放行 8080 ----------
echo "[4/8] 配置防火墙放行 ${PORT} 端口..."
# ufw 若启用则放行；未启用则跳过
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow "${PORT}/tcp" || true
  echo "   ufw 已放行 ${PORT}"
else
  echo "   ufw 未启用，跳过（请务必在阿里云安全组放行 ${PORT}）"
fi

echo ""
echo "=============================================="
echo " ✅ 系统环境准备完成！"
echo ""
echo " 接下来请执行："
echo " 1. 上传项目代码到 ${APP_DIR}:"
echo "      cd ${APP_DIR} && git clone https://github.com/Pinkie-Pie-Lucky/gupiao.git ."
echo "      或 scp/上传项目文件到 ${APP_DIR}"
echo ""
echo " 2. 执行安装与启动:"
echo "      sudo bash ${APP_DIR}/deploy/aliyun-install.sh"
echo ""
echo " 3. 阿里云控制台 → 安全组 → 入方向放行 TCP ${PORT}"
echo ""
echo " 4. 浏览器访问:  http://<服务器公网IP>:${PORT}"
echo "=============================================="
