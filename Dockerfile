# 泡泡看市 - Railway 部署 Dockerfile
# 基础镜像：Ubuntu 24.04（可自由安装 Node + Python）
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production
# ECS 访问官方 PyPI 大文件可能较慢；可通过构建参数覆盖，默认使用清华镜像。
ARG PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
ENV PIP_INDEX_URL=${PIP_INDEX_URL}

# ---------- 1. 系统依赖 + Node.js 20 + Python 3.12 ----------
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates gnupg git \
      python3 python3-venv python3-pip \
      build-essential && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# ---------- 2. 工作目录 ----------
WORKDIR /app

# ---------- 3. 先复制依赖清单（利用构建缓存） ----------
COPY package.json package-lock.json ./
RUN npm install --no-audit --no-fund

COPY requirements-stock-data.txt requirements-ocr.txt ./
RUN python3 -m venv .venv && \
    .venv/bin/pip install --upgrade pip && \
    .venv/bin/pip install -r requirements-stock-data.txt
# 可选：启用公告文档 OCR（paddlepaddle/paddleocr，体积较大）
# RUN .venv/bin/pip install -r requirements-ocr.txt

# ---------- 4. 复制源码并构建 ----------
COPY . .
# Rollup 并发已在 Vite 配置中限制，兼容低 nofile 的容器构建环境。
RUN npm run build

# ---------- 5. 启动 ----------
# 每次容器启动先执行幂等数据库迁移，避免新表在发布后缺失而服务静默降级。
# 迁移失败时容器不会启动，便于由健康检查和日志明确发现问题。
ENV PORT=8080
EXPOSE 8080
CMD ["sh", "-c", "npm run db:migrate && node dist/server.cjs"]
