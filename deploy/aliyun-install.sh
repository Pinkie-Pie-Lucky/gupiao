#!/usr/bin/env bash
# ============================================================
# 泡泡看市 - 项目安装与启动脚本
# 前提：系统环境已由 aliyun-setup.sh 准备好（Node/Python）
# 用法：sudo bash deploy/aliyun-install.sh
# 说明：安装 Node 依赖 + Python .venv + 构建 + pm2 启动
# ============================================================
set -euo pipefail

APP_USER="${SUDO_USER:-$(whoami)}"
APP_DIR="/opt/gupiao"
PORT="${PORT:-8080}"

if [ "$(id -u)" -ne 0 ]; then
  echo "[错误] 请使用 sudo 运行: sudo bash deploy/aliyun-install.sh"
  exit 1
fi

if [ ! -f "${APP_DIR}/package.json" ]; then
  echo "[错误] 未在 ${APP_DIR} 找到 package.json"
  echo "       请先把项目代码上传到 ${APP_DIR} 再运行本脚本"
  exit 1
fi

cd "${APP_DIR}"

# ---------- 1. 创建 .env ----------
echo "[1/6] 检查 .env 配置..."
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    echo "   已从 .env.example 创建 .env，请编辑填写 DEEPSEEK_API_KEY"
  else
    echo "   [警告] 缺少 .env.example，请手动创建 .env 并填写 DEEPSEEK_API_KEY"
  fi
fi

# ---------- 2. 安装 Node 依赖 ----------
echo "[2/6] 安装 Node 依赖 (npm install)..."
chown -R "${APP_USER}":"${APP_USER}" node_modules 2>/dev/null || true
su - "${APP_USER}" -c "cd ${APP_DIR} && npm install --no-audit --no-fund"

# ---------- 3. 创建 Python 虚拟环境 ----------
echo "[3/6] 创建 Python 虚拟环境 .venv ..."
if [ ! -d .venv ]; then
  python3 -m venv .venv
fi
chown -R "${APP_USER}":"${APP_USER}" .venv

echo "   安装 Python 数据依赖（akshare/pandas/paddleocr 等，耗时较长，请耐心等待）..."
su - "${APP_USER}" -c "cd ${APP_DIR} && .venv/bin/pip install --upgrade pip"
if [ -f requirements-stock-data.txt ]; then
  su - "${APP_USER}" -c "cd ${APP_DIR} && .venv/bin/pip install -r requirements-stock-data.txt"
fi

# ---------- 4. 构建前端 + 打包后端 ----------
echo "[4/6] 构建项目 (npm run build)..."
su - "${APP_USER}" -c "cd ${APP_DIR} && npm run build"

# ---------- 5. 安装并配置 pm2 ----------
echo "[5/6] 安装 pm2 并配置守护进程..."
if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi

# 设置 pm2 开机自启
su - "${APP_USER}" -c "cd ${APP_DIR} && pm2 delete gupiao 2>/dev/null || true"
su - "${APP_USER}" -c "cd ${APP_DIR} && NODE_ENV=production PORT=${PORT} pm2 start dist/server.cjs --name gupiao --time"
su - "${APP_USER}" -c "pm2 save"
env PATH="$PATH:/usr/bin" su - "${APP_USER}" -c "pm2 startup systemd" || true

# ---------- 6. 自检 ----------
echo "[6/6] 运行发布自检 (release:check)..."
su - "${APP_USER}" -c "cd ${APP_DIR} && NODE_ENV=production npm run release:check" || echo "   [提示] 自检有告警，请查看上方输出（DeepSeek/数据源相关）"

echo ""
echo "=============================================="
echo " ✅ 部署完成！"
echo ""
echo " 访问地址:  http://<服务器公网IP>:${PORT}"
echo ""
echo " 常用命令:"
echo "   pm2 status            # 查看进程状态"
echo "   pm2 logs gupiao       # 查看日志"
echo "   pm2 restart gupiao    # 重启服务"
echo ""
echo " 阿里云控制台 → 安全组 → 入方向放行 TCP ${PORT}（务必检查）"
echo "=============================================="
