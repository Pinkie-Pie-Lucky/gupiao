# 泡泡看市（Paopao Market）

面向个人研究者与开发者的 **A 股市场观察、企业信息阅读与条件筛选工具**。产品将可核验的行情、财报、公告、行业与舆情数据，与 AI 的可读解释分开处理：程序负责事实、指标和证据，AI 只负责组织已有信息，不以 AI 输出替代数据事实。

> 本项目用于市场观察与学习研究，不构成投资建议，也不提供买卖指令或收益承诺。

## 产品能力

### 可选界面

- **移动端**：窄屏或手机设备使用底部导航，适合快速查看市场与研究结果。
- **Web 端**：电脑端使用侧边栏、顶部操作区和更宽的研究工作区；中等宽度窗口会收缩为紧凑 Web 布局，而不会误切换成手机界面。
- 两端复用同一套后端接口、账号、关注列表与研究数据。界面是可选的演示层，开源使用可直接采用 CLI、MCP 或 HTTP API。

### 开源工具入口

| 方式 | 适合谁 | 命令 / 地址 |
| --- | --- | --- |
| 本地 stdio MCP | Codex、Claude Desktop、Cherry Studio 用户 | `npm run mcp:stdio` |
| Streamable HTTP MCP | 远程 Agent、团队服务 | `GET/POST /api/mcp` |
| CLI | 脚本、Cron、Notebook | `npm run cli -- market`、`quote 002230`、`snapshot 002230` |
| HTTP API | 二次开发与自建界面 | `/api/*` 与 `/health` |
| 离线 fixtures | 联调、演示、无网络开发 | `npm run cli -- market --offline` |

各入口输出都应保留 schema 版本、来源、时点、数据缺口和能力边界。具体配置见[开源运行与合规说明](docs/开源运行与合规说明.md)。

### 市场与内容

| 模块 | 能力 |
| --- | --- |
| 首页 | 三大指数、市场温度、热点板块、市场早报、AI 泡泡精选与学习内容 |
| 市场地图 | 板块涨跌、领涨/领跌、板块广度、代表个股与板块详情 |
| 条件选股 | 基于东方财富妙想的自然语言条件解析、候选股筛选、结果保存与每日更新 |
| 我的关注 | 登录用户的自选股持久化、实时行情展示、移除与进入个股分析 |
| AI 泡泡 | 市场/公司问题对话；模型不可用时会清晰提示，不把失败伪装成分析结论 |

### 个股分析：事实快照 + 多 Agent 解读

个股研究会先并行构建确定性事实快照，再生成各模块的解释和 CIO/Manager 汇总。慢数据源不会阻塞已完成模块；单个 Agent 或 AI 调用失败时，其余事实结果仍可展示。

| Agent / 模块 | 主要内容 |
| --- | --- |
| 基本面 | 三大报表、财务质量、年度与季度趋势、业务分部、财报原文及页码证据 |
| 技术与市场 | 日 K、均线、支撑/压力位、波动率、回撤、相对强弱与市场环境 |
| 估值 | PE/PB/PS 历史分位、同行比较、DCF / 剩余收益情景与关键假设 |
| 事件 | 巨潮公告、新闻与政策事件；重大性评分、例行公告降权、事件簇和时间线 |
| 行业与产业链 | 行业成员财务分位、上下游映射、景气指标、行业及政策事件 |
| 舆情 | 社区/媒体/跨平台热点的方向、热度、事件聚类与观点分歧；未经权威核验的内容不会作为事实事件 |
| 风险与反方 | 风险否决、结构失效条件、反方证据、下一步核验点 |
| CIO / Manager | 基于各模块已得证据形成条件式研究状态与短/中/长期结论，不额外检索或编造新事实 |

### 可信输出原则

- **事实计算与 AI 解读解耦**：方向、热度、事件聚类、估值和技术指标优先由程序计算。
- **字段级降级**：AI 结构化输出不完整时，仍保留可验证的已完成字段和证据。
- **可观测性**：记录模型、耗时、重试次数及失败阶段（超时、空输出、JSON 异常、证据校验失败等）。
- **来源与回退**：接口返回来源、时间、新鲜度和数据缺口；外部数据源异常时按链路回退或标识不可用。

### 内置 Skills

项目将高频、可复用的金融工作流封装为可随代码一起维护的 Skill，并通过 Streamable HTTP MCP 暴露对应工具。二者均只输出可核验事实，不替代投资判断。

| Skill | 适用场景 | 对应 MCP 工具 | 输出边界 |
| --- | --- | --- | --- |
| [市场观察 Skill](skills/market-observation/SKILL.md) | 首页、早晚报、市场日常观察 | `get_market_observation` | 三大指数、市场广度、市场温度、热点板块、时间/来源/缺口；不预测涨跌。 |
| [个股事实快照 Skill](skills/stock-fact-snapshot/SKILL.md) | 个股研究、条件筛选复核、多个 Agent 的共同输入 | `search_stock` → `get_stock_fact_snapshot` | 行情、财务、技术、公告、证据 ID 与数据缺口；不包含 AI 结论或交易建议。 |
| [条件筛选 Skill](skills/condition-screener/SKILL.md) | 自然语言选出研究候选池 | `screen_stocks` | 条件命中、字段、数据时点和来源；不把候选池写成买入推荐。 |
| [HTML 报告 Skill](skills/stock-analyze-reports/SKILL.md) | 生成可分享的个股研究或市场热点报告 | `generate_stock_analysis_html_report`、`generate_market_hotspots_html_report` | 独立 HTML 链接、生成时快照、来源与数据缺口；不输出交易指令。 |

MCP 地址为 `GET/POST /api/mcp`。在产品服务内调用时，两个工具复用页面同一套市场数据与个股事实快照；独立 MCP 部署未注入完整数据提供器时，个股工具会明确降级为行情快照并返回数据缺口。

## 数据源与回退

| 数据类别 | 主要来源与策略 |
| --- | --- |
| 指数与个股行情 | 腾讯财经 → 新浪财经 → 雪球 → 最近成功快照 |
| 板块与成分股 | 东方财富、同花顺行业数据及缓存快照 |
| 公告与财报 | 巨潮资讯（CNINFO）公告、PDF/HTML 文本解析；文字层不足时标记 OCR 路径与置信度 |
| 技术、行业与财务 | AKShare、Baostock、PyTDX、TickFlow、同花顺财报等多级回退 |
| 公司画像与社区信息 | 雪球 F10 / 热度、知乎、妙想金融搜索、公开热点榜单 |
| AI | 智谱 GLM（推荐 `glm-4.5-air`）或兼容 DeepSeek 的 OpenAI 风格接口 |
| 条件选股 | 东方财富妙想选股能力（服务端通过 `MX_APIKEY` 调用） |

## 技术架构

- **前端**：React 19、TypeScript、Vite 6、Tailwind CSS 4、Motion、Recharts、Three.js
- **后端**：Express 单体服务；开发环境内嵌 Vite，生产环境提供静态资源与 SPA 回退
- **数据处理**：Node.js 调度 + Python 数据脚本（AKShare 等）
- **数据库**：PostgreSQL；未配置或无法连接时仅用于本地开发的内存仓储会启用，重启后数据不会保留
- **认证与权限**：手机号/密码、JWT、自选股与反馈持久化、管理员访问统计和用户管理
- **MCP**：`/api/mcp` 提供 Streamable HTTP 服务，可用于行情、市场概览等受控工具调用

## 快速开始

### 1. 安装依赖

前置条件：Node.js 20+；启用完整数据链路时还需要 Python 3.10+。

```bash
npm ci
```

### 2. 配置环境变量

复制示例文件并填写实际值。不要把 `.env`、密钥或数据库密码提交到 Git。

```powershell
# Windows PowerShell
Copy-Item .env.example .env
```

```bash
# Linux / macOS
cp .env.example .env
```

最小配置示例：

```dotenv
AI_PROVIDER=glm
GLM_API_KEY=你的智谱密钥
GLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4
GLM_MODEL=glm-4.5-air
GLM_STOCK_RESEARCH_MODEL=glm-4.5-air

# 需要账号、自选股、内容持久化时配置 PostgreSQL
DATABASE_URL=postgres://用户名:密码@127.0.0.1:5432/gupiao

# 启用妙想条件选股/金融搜索时配置
MX_APIKEY=你的妙想密钥
```

可选能力：

- `ZHIHU_ACCESS_SECRET`：知乎搜索与热点数据。
- `AKSHARE_PYTHON`：指定 Python 解释器；默认使用项目根目录 `.venv`。
- `ADMIN_PHONES`：逗号分隔的管理员手机号白名单。
- `RESEARCH_WAIT_TIMEOUT_MS`、`RESEARCH_SOURCE_TIMEOUT_MS`、`AI_REQUEST_TIMEOUT_MS`：研究总任务、单数据源和单次 AI 调用的超时预算。

### 3. 安装 Python 数据能力（可选但推荐）

```bash
python -m venv .venv
# Windows
.venv\\Scripts\\pip install -r requirements-stock-data.txt
# Linux / macOS
.venv/bin/pip install -r requirements-stock-data.txt
```

### 4. 启动

```bash
npm run dev
```

默认访问 `http://localhost:8080`。端口可通过 `PORT` 环境变量覆盖，例如 `PORT=8111 npm run dev`。

### CLI 与本地 MCP

```bash
# 不启动 Web 服务也可用的命令行入口
npm run cli -- market
npm run cli -- quote 002230
npm run cli -- snapshot 002230 --offline

# 本地 MCP stdio（客户端配置示例见 examples/mcp/mcp.json）
npm run mcp:stdio
```

### 一键容器运行

```bash
# 先复制 .env.example 为 .env，并至少替换 POSTGRES_PASSWORD
docker compose -f docker-compose.open-source.yml up --build
```

启动后用 `GET /health` 检查进程与数据库；`GET /api/health/sources` 仅返回最近观测到的数据源状态，不会额外消耗第三方 API 配额。

## 常用命令

```bash
npm run lint
npm run build
npm run test:auth
npm run test:stock-research-frontend
npm run test:stock-sentiment
npm run test:stock-valuation
npm run test:cio-manager-scenarios
npm run test:public-hotlists
npm run test:mx-screener
npm run test:mcp-skills
npm run test:open-source-runtime
npm run test:ci
npm run db:migrate
```

## 主要接口

| 类别 | 接口示例 |
| --- | --- |
| 健康检查 | `GET /health` |
| 数据源健康 | `GET /api/health/sources`（不主动回源） |
| 登录与自选 | `/api/auth/*`、`/api/watchlist/*` |
| 市场数据 | `GET /api/market-overview`、`GET /api/sectors`、`GET /api/market-map/intelligence` |
| 个股数据 | `GET /api/stock-search`、`GET /api/stock-quote`、`GET /api/stock-facts`、`GET /api/stock-financials`、`GET /api/stock-technical`、`GET /api/stock-valuation` |
| 研究 Agent | `GET /api/stock-agents/fundamental`、`event`、`sentiment`、`valuation`、`technical-market`、`risk-counter`、`industry-chain`、`cio-manager` |
| 资讯与公告 | `GET /api/stock-events`、`GET /api/stock-event-chains`、`GET /api/cninfo/announcements`、`GET /api/cninfo/document` |
| 条件选股 | `/api/stock-screeners/*` |
| AI 与内容 | `POST /api/chat`、`POST /api/market-report`、`POST /api/market-refresh` |
| HTML 报告 | `POST /api/reports/stock`、`POST /api/reports/market`、`GET /reports/:reportId` |
| MCP | `GET/POST /api/mcp`；`get_stock_quote`、`search_stock`、`get_market_overview`、`get_market_observation`、`get_stock_fact_snapshot`、`screen_stocks` |

## 部署

完整能力推荐使用项目内的 Podman Compose / Docker Compose 双环境配置：

- `deploy/docker-compose.test.yml`：测试环境，应用端口映射至本机 `18081`。
- `deploy/docker-compose.prod.yml`：正式环境，应用端口映射至本机 `18080`。
- `deploy/nginx/`：HTTP/HTTPS 反向代理配置。
- `deploy/scripts/`：部署、数据库备份、边缘环境准备与 HTTPS 启用脚本。
- `deploy/env/.env.*.example`：不含密钥的环境变量模板。

详细步骤见：[测试与正式环境部署方案](docs/测试与正式环境部署方案.md)。

## 目录结构

```text
gupiao-main0805/
├── frontend/                    # React 前端与多端 UI 壳层
├── backend/                     # Express API、认证、数据源、调度和数据库仓储
│   ├── core/                     # 稳定输出契约与确定性事实快照组合
│   ├── dataSources/              # 行情/搜索等第三方协议适配器（不含 Agent 结论）
│   └── mcp/                      # Streamable HTTP 与 stdio MCP 入口
├── shared/                      # 前后端共享的确定性研究规则
├── scripts/python/              # 行情、财务、估值、行业等 Python 数据脚本
├── skills/                      # 可复用金融工作流 Skill（市场观察、个股事实快照等）
├── tests/                       # Agent、数据链路、前端和权限测试
├── deploy/                      # Podman/Docker Compose、Nginx、部署与备份脚本
├── docs/                        # 产品、Agent、数据链路和部署设计文档
├── requirements-stock-data.txt
├── Dockerfile
└── package.json
```

## 相关文档

- [个股分析 Agent 方案说明](docs/个股分析Agent方案说明.md)
- [数据源回退链路设计](docs/数据源回退链路设计.md)
- [条件选股功能说明](docs/条件选股功能说明.md)
- [待实施功能清单](docs/待实施功能清单.md)
- [测试与正式环境部署方案](docs/测试与正式环境部署方案.md)
- [开源运行与合规说明](docs/开源运行与合规说明.md)

## 授权与免责声明

代码以仓库内的 Apache-2.0 标识为准；第三方数据、模型、公开接口和商标不因本仓库开源而被再次授权。使用前请自行确认来源条款、使用频率、地域和商业限制。所有行情、研究、AI 生成内容均仅作信息展示和学习参考，不构成任何投资、交易或收益承诺。详见[开源运行与合规说明](docs/开源运行与合规说明.md)。
