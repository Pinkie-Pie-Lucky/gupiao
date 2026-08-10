# 泡泡看市 - Railway 部署指南（前后端一体）

> 适用：把整个项目（前端 + Node 后端 + Python 数据层）全部部署到 Railway
> 访问地址：Railway 提供的免费域名 `https://<服务名>.up.railway.app`
> **数据完整**：Railway 是完整 Docker 容器，Python 子进程（akshare）可以正常跑

---

## 一、为什么 Railway 可以？（和 Vercel 的区别）

| | Vercel Serverless | Railway |
|---|---|---|
| 运行环境 | 无状态 Serverless | **完整 Docker 容器** |
| Python 子进程 | ❌ 不可用 | ✅ 可以（在容器里装 Python） |
| 数据完整性 | 缺失 | **完整** |

---

## 二、前置准备

1. **代码已推送到 GitHub**（含 `Dockerfile`、`.dockerignore`、`package-lock.json`）
2. 注册 Railway 账号：<https://railway.app>（可以用 GitHub 登录）

---

## 三、部署步骤

### 1. 新建项目并关联仓库
1. 登录 Railway → 点 **New Project**
2. 选 **Deploy from GitHub repo** → 授权 GitHub
3. 选择您的仓库 `gupiao` → Railway 自动识别 `Dockerfile` 并开始构建

> 如果没自动识别 Dockerfile，在服务 **Settings → Build** 里选：
> - **Dockerfile Path**: `./Dockerfile`
> - **Root Directory**: `/`

### 2. 配置环境变量
进入服务 → **Variables** 标签，添加：

| 变量名 | 值 | 说明 |
|---|---|---|
| `DEEPSEEK_API_KEY` | 您的真实 Key | 必填，AI 调用 |
| `NODE_ENV` | `production` | 静态托管 + 生产模式 |
| `PORT` | `8080` | 服务监听端口 |

> `.env` 文件不会进 Docker（已在 .dockerignore 排除），密钥靠 Variables 注入。

### 3. 构建 & 部署
- 构建**需要较长时间**（pip 安装 paddleocr/akshare 等，约 10~20 分钟），属正常
- 部署完成后，服务自动获得域名：`https://<xxx>.up.railway.app`

### 4. 配置域名（可选但推荐）
1. 服务 → **Settings → Networking → Generate Domain**
2. 生成 `https://<服务名>.up.railway.app`，这就是您的访问网址
3. 也可以绑定自己的域名（**无需备案**，Railway 走海外节点）

---

## 四、验证 & 分享

用手机流量访问：`https://<服务名>.up.railway.app`

- 首页/行情能打开 → 成功
- 个股分析各模块有数据 → Python 层正常

分享给朋友直接发这个网址即可（**有 HTTPS，不会提示不安全**，这点比阿里云 IP:8080 好）。

---

## 五、运维命令（Railway Dashboard）

| 操作 | 位置 |
|---|---|
| 查看日志 | 服务 → **Deployments** → 点当前部署 → Logs |
| 重启 | Deployments → 点 **Redeploy** |
| 更新代码 | 推送到 GitHub 主分支，Railway 自动重新部署 |
| 查看资源/内存 | 服务 → Metrics |

---

## 六、费用说明 ⚠️（重要）

- Railway **没有永久免费**，新账号送约 **$5 试用额度**
- 本项目（容器 + 内存）每月大概消耗 **$5~10**，试用额度用完后需绑定信用卡按量计费
- 如果预算紧张，可考虑：试用期测试 → 稳定后回到阿里云 IP:8080（免费）方案

---

## 七、常见问题

### Q1：构建超时？
- pip 安装 paddleocr 很慢，属正常。Railway 构建超时默认较长
- 若反复失败：在 Deployments 看 Logs，把报错发给我

### Q2：服务起来了但页面打不开？
- 确认 Variables 里 `PORT=8080` 且启动命令是 `node dist/server.cjs`
- 确认生成了 Domain

### Q3：个股分析模块空？
- 首次访问实时抓数据，需等待几秒
- 数据源（同花顺等）偶发限流会自动降级，稍后刷新
- 持续异常看 Logs 里 `[financial-source]` 相关报错发我

### Q4：内存够吗？
- Railway 默认 ~1GB 内存。paddleocr 主要构建时吃资源，运行时足够
- 若内存不足（日志 Out of Memory），在服务 Settings → Deploy 里提升内存

---

## 八、本地先验证 Docker 可构建（可选）

如果本机装了 Docker，可先本地验证 Dockerfile 无误：
```bash
docker build -t gupiao .
docker run -p 8080:8080 -e DEEPSEEK_API_KEY=你的key -e NODE_ENV=production gupiao
```
浏览器访问 `http://localhost:8080` 确认后再推 Railway，更稳妥。
