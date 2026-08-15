# 数据库迁移与验证（方案2：本地 Docker PG / 生产阿里云 PG）

> 适用阶段：本地 Docker 安装完成后，做一次**真实 `db:migrate` 验证**。

## 0. 背景

本项目数据库采用 PostgreSQL，schema 唯一来源是 `backend/db/schema.sql`，由 `backend/db/migrate.ts` 幂等执行（`CREATE TABLE IF NOT EXISTS`）。本地与生产共用同一份 schema 与迁移脚本。

已建表（共 18 张）：

| 分组 | 表 | 状态 |
|---|---|---|
| 认证/反馈 | `users`、`token_blacklist`、`feedback` | ✅ 已接入代码 |
| 自选股 | `watchlist` | ✅ 已接入代码 |
| 行情/快照 | `market_snapshots`、`kline_bars` | ⏳ 已建表，待接入 |
| 公司/官方 | `company_profiles`、`financial_reports`、`announcements`、`sentiment_heat`、`industry_benchmarks`、`valuation_history` | ⏳ 已建表，待接入 |
| AI/报告 | `market_temperature`、`morning_reports`、`ai_cache` | ⏳ 已建表，待接入 |
| 用户数据 | `chat_messages` | ⏳ 已建表，待接入 |

## 1. 本地起库（一次性）

```bash
# 在项目根目录
POSTGRES_PASSWORD="替换为至少 32 位随机密码" docker compose up -d
# 连接信息：host: 127.0.0.1  port: 5432  user: gupiao  db: gupiao
```

## 2. 配置环境变量

复制 `.env.example` 为 `.env`，确保包含：

```env
POSTGRES_PASSWORD="替换为至少 32 位随机密码"
DATABASE_URL="postgres://gupiao:<POSTGRES_PASSWORD>@127.0.0.1:5432/gupiao"
JWT_SECRET="（改为足够长的随机串，如 openssl rand -hex 32 的输出）"
```

> 不配置 `DATABASE_URL` 时，服务会回退到**内存仓储**（数据不持久化），仅供开发体验；生产环境必须配置。

## 3. 执行迁移

```bash
npm run db:migrate
# 输出 `[migrate] schema applied.` 即成功
```

重复执行是安全的（幂等）。

## 4. 验证清单

### 4.1 表结构

用 psql（或任意 PG 客户端）执行：

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' ORDER BY table_name;
```

应能看到全部 18 张表：`ai_cache, announcements, chat_messages, company_profiles, feedback, financial_reports, industry_benchmarks, kline_bars, market_snapshots, market_temperature, morning_reports, sentiment_heat, token_blacklist, users, valuation_history, watchlist`。

### 4.2 认证 + 自选股端到端（启动服务后）

```bash
npm run dev   # 默认 8080 端口
```

```bash
# 1) 注册
curl -s -X POST http://localhost:8080/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"phone":"13800000000","nickname":"验证用户","password":"test123456"}'

# 2) 用返回的 token 添加自选股
curl -s -X POST http://localhost:8080/api/watchlist \
  -H "Authorization: Bearer <token>" -H 'Content-Type: application/json' \
  -d '{"symbol":"600519","name":"贵州茅台"}'

# 3) 查看自选列表
curl -s http://localhost:8080/api/watchlist -H "Authorization: Bearer <token>"
```

检查 DB：

```sql
SELECT user_id, symbol, name FROM watchlist;
SELECT phone, nickname FROM users;
SELECT id, content_type, rating FROM feedback;
```

### 4.3 登出即时失效（黑名单）

```bash
curl -s -X POST http://localhost:8080/api/auth/logout -H "Authorization: Bearer <token>"
# 之后同一 token 访问 /api/auth/me 应返回 401
```

## 5. 生产（阿里云）迁移

```bash
DATABASE_URL="postgres://user:password@host:5432/gupiao" npm run db:migrate
```

与本地同一份 `schema.sql`，无需额外操作。建议：先在 RDS 白名单放行应用 ECS IP，再执行迁移。

## 6. 常见问题

| 现象 | 处理 |
|---|---|
| `ECONNREFUSED` | 本地 docker 未启动 / 端口冲突：`docker compose ps` |
| `password authentication failed` | 检查 `.env` 的 `DATABASE_URL` 与 docker-compose 的 `POSTGRES_PASSWORD` 是否一致 |
| 迁移后表不全 | 检查日志是否有语法错误；删除库重建 `docker compose down -v && docker compose up -d` 后重跑 |
| 生产 RDS 白名单 | 在阿里云控制台把应用 ECS 的私网/公网 IP 加入 RDS 白名单 |
