# 泡泡看市 - Railway 部署 Dockerfile
# 基础镜像：Ubuntu 24.04（可自由安装 Node + Python）
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production

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

COPY requirements-stock-data.txt ./
RUN python3 -m venv .venv && \
    .venv/bin/pip install --upgrade pip && \
    .venv/bin/pip install -r requirements-stock-data.txt

# ---------- 4. 复制源码并构建 ----------
COPY . .
RUN npm run build

# ---------- 5. 启动 ----------
ENV PORT=8080
EXPOSE 8080
CMD ["node", "dist/server.cjs"]
