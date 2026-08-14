源代码仅供学习、个人非商用参考，未经作者书面许可，禁止任何形式商用。

# 泡泡看市（Paopao）

一款面向投资小白的 **AI 陪伴式 A 股市场观察与个股研究工具**。围绕"泡泡老师"这一 AI 助手人设，提供每日早报、市场地图、个股多智能体（Agent）投研分析与行情解读，所有数据均带来源、抓取时间与回退层级，并明确区分"程序确定的事实"与"AI 推断的解释"。

## 功能总览

应用为移动端风格（固定手机框架 + 底部 5 个 Tab）：

| Tab | 功能 |
| --- | --- |
| 首页 | 市场状态 Banner、泡泡老师 AI 早报卡片、三大指数与市场温度、强势吸金板块、AI 故事流（含影响路径可视化与反馈）、今日一句话成长、今日学习卡片 |
| 市场地图 | 三大指数 + 市场温度概览、泡泡精选（AI 信号评分）、板块网格（领涨/领跌/全部）、板块详情弹窗 |
| 我的关注 | 自选股列表、向泡泡提问该股、查看个股研究报告 |
| 个股分析 | 六大投研模块 + CIO 经理快照 + 三周期结论（详见下文） |
| AI泡泡 | 与"泡泡老师"自由对话，支持股票/板块预填提问、建议追问、语音播报 |

### 个股分析六大模块

个股分析页并行加载 `cio-manager` 与 `industry-chain` 两个 Agent 快照，通过确定性打分引擎（`src/lib/managerStance.ts`）输出**持有评估**（继续持有/条件持有/观察后再决定/不建议持有）与**三周期结论**（短期 1-4 周 / 中期 1-3 月 / 长期 6-12 月），并统一汇总数据缺口：

| 模块 | 内容 |
| --- | --- |
| 基本面 | 财务历史趋势、财务质量指标（普通/银行双模板）、分业务经营与官方原文链接 |
| 技术与市场 | 近 30 日 K 线（含支撑/压力/均线参考位）、ATR/波动率/回撤风险判定 |
| 事件 | 公告与事件簇时间线、官方核验统计、传导路径 |
| 行业与产业链 | 行业财务分位、产业链上下游映射、行业与政策事件簇 |
| 估值 | PE/PS/PB 历史分位、同行对比、盈利变化/DCF/剩余收益情景模型 |
| 风险与反方 | 触发否决条件、风险等级与决策状态、观察与解除条件 |

### AI 早报三段式流水线

1. **P1 选题**：AI 按板块故事 prompt 选取当日热点板块与市场情绪
2. **证据包**：服务端补齐可复核的证据目录（程序确定事实）
3. **P2 因果推理**：按证据推演 2-6 步因果链，生成影响路径（`ImpactAnalysisModal` 可视化），分小白/专业两种表达

AI 失败时返回明确 `aiFailed` 标记并走规则兜底，**不会伪造假故事**。

## 技术栈与架构

- **前端**：React 19 + TypeScript + Vite 6 + Tailwind CSS 4 + motion + recharts
- **后端**：Express 单体（`server.ts`，约 7800 行），dev 模式内嵌 Vite middleware，生产模式静态托管 + SPA fallback
- **AI 服务**：Node 端通过 OpenAI SDK 兼容方式直连 DeepSeek（默认 `deepseek-v4-flash`）
- **Python 数据源**：`scripts/*.py` 脚本（依赖 akshare / baostock / pandas / pytdx / tickflow 等），由 Node `child_process` 调用
- **MCP 服务**：`/api/mcp`（StreamableHTTP），提供 `search_stock`、`get_stock_quote`、`get_market_overview` 三个工具（纯 Node，无 Python 依赖）

## 快速启动

**前置条件**：Node.js（推荐 20+）、Python 3.10+（如需启用全部数据源）

```bash
# 1. 安装 Node 依赖
npm install

# 2. 配置环境变量（复制 .env.example 为 .env）
#    DEEPSEEK_API_KEY 必填：DeepSeek AI 对话与所有 AI 生成功能
#    AI_BASE_URL / AI_MODEL 可选，默认指向 DeepSeek 官方接口与 deepseek-v4-flash
cp .env.example .env

# 3.（可选）安装 Python 数据源依赖，启用日 K / 行业基准 / 估值 / 财务等深度接口
python3 -m venv .venv
.venv/bin/pip install -r requirements-stock-data.txt

# 4. 启动开发服务器（默认端口 8080）
npm run dev
```

访问 `http://localhost:8080`。

> 环境变量说明（`.env.example`）：
> - `DEEPSEEK_API_KEY`：必填，DeepSeek API Key
> - `AI_BASE_URL`：可选，默认 `https://api.deepseek.com`
> - `AI_MODEL`：可选，默认 `deepseek-v4-flash`
> - `AKSHARE_PYTHON`：可选，指定 Python 解释器路径（默认使用项目根 `.venv`）

## 数据源与回退链路

所有接口返回均带 `sourceMeta`（来源、抓取时间、新鲜度、回退层级）。核心原则：**行情 HTTP 多源回退，深度数据依赖 Python**。

### 纯 HTTP（无 Python 依赖，开箱即用）

| 数据 | 回退链路 |
| --- | --- |
| 指数/个股行情 | 腾讯财经 → 新浪财经 → 雪球 → 最近成功快照 |
| 板块行情 | 东方财富 push2 全量分页 |
| 官方公告检索 | 巨潮资讯 CNINFO HTTP 接口 |
| 公司画像/舆情热度 | 雪球 F10（7 天缓存）/ 雪球热度（15 分钟缓存） |
| 股票搜索 | 东方财富 / 新浪 |
| 新闻 | 华尔街见闻 + 东方财富板块新闻 |

### 依赖 Python（需先安装 `requirements-stock-data.txt`）

| 数据 | 脚本 | 说明 |
| --- | --- | --- |
| 日 K 线 | `market_daily_kline.py` | akshare → tickflow → baostock → pytdx 四级回退，约 560 天前复权 |
| 行业基准 | `industry_benchmark.py` | 同花顺行业指数 + baostock 兜底 |
| 估值 | `stock_valuation.py` / `valuation_comparison.py` | 东方财富估值 + 历史分位对比 |
| 财务摘要 | `financial_summary.py` / `ths_financial_statements.py` | 同花顺财报为主、新浪摘要 HTTP 兜底 |
| 产业链指标 | `industry_chain_indicators.py` | 期货价格/库存、乘用车批售等 |
| 个股画像 | `xueqiu_insights.py` | 雪球热度与 F10 画像 |

**未安装 Python 依赖时的行为**：依赖 Python 的接口返回明确 `dataUnavailable`/`dataGaps`（如"行业基准数据暂不可用"），个股分析的行业/财务/技术面模块降级为"不可用"，CIO 决策相应标记为 `rejected` 或"输入阻断"；纯 HTTP 的行情、搜索、公告、AI 对话等功能不受影响。

## API 目录

| 类别 | 接口 |
| --- | --- |
| 行情与市场 | `GET /api/stock-quote`、`GET /api/market-overview`、`GET /api/sectors`、`GET /api/sector-detail`、`GET /api/market-daily-kline` |
| 市场地图 | `GET /api/market-map/intelligence`、`GET /api/bubble-selection` |
| 个股研究 | `GET /api/stock-agents/cio-manager`、`GET /api/stock-agents/industry-chain`、`GET /api/stock-agents/fundamental\|event\|sentiment\|risk-counter\|valuation\|technical-market`、`GET /api/stock-financials\|stock-technical\|stock-valuation\|stock-sentiment\|stock-risk-snapshot\|stock-facts\|stock-relative-strength` |
| 资讯与事件 | `GET /api/stock-search`、`GET /api/stock-events`、`GET /api/cninfo/announcements`、`GET /api/cninfo/document`、`GET /api/xueqiu/profile`、`GET /api/xueqiu/heat` |
| 报告与交互 | `GET /api/morning-report`、`POST /api/market-report`、`POST /api/chat`、`POST /api/feedback`、`GET /api/feedback-stats` |
| 行业链 | `GET /api/stock-industry-benchmark`、`GET /api/stock-industry-financial-percentiles`、`GET /api/stock-industry-chain-mapping`、`GET /api/industry-chain-indicators` |
| 其他 | `GET/POST /api/mcp`（MCP 服务）、`GET /api/market-environment` |

## 确定性组件

- **`src/lib/managerStance.ts`**：CIO 决策立场打分引擎（bullish/lean_bullish/neutral/lean_bearish/bearish + hold/conditional_hold/observe/avoid），对基本面/技术/事件/舆情/估值加权计分，叠加风险否决惩罚
- **`event-rules.ts`**：事件分类/方向/日期/状态规则
- **`src/lib/impactAnalysis.ts`**：影响路径树兜底构建

## 部署

- **Vercel 无 Python 环境**：行情、公告、雪球、MCP、AI 对话等 HTTP 能力可用；日 K、行业基准、估值等 Python 深度接口不可用
- **自托管（推荐完整功能）**：使用项目根 `Dockerfile`（Ubuntu 24.04 + Node 20 + Python 3.12 + `.venv`），构建后 `node dist/server.cjs`，默认端口 8080

```bash
npm run build
node dist/server.cjs
```

## 目录结构

```
gupiao/
├── frontend/                 # React 前端
│   ├── index.html            # SPA 入口
│   ├── vite.config.ts        # Vite 构建配置
│   └── src/                  # 前端源码（App.tsx + components/）
├── backend/                  # Express 后端
│   ├── server.ts             # 全部 API 与数据源调度
│   ├── event-rules.ts        # 事件规则
│   └── mcp/                  # MCP StreamableHTTP 服务
├── shared/                   # 前后端共享模块
│   └── managerStance.ts      # CIO 立场打分引擎
├── scripts/python/           # Python 数据源脚本
├── tests/                    # Node / Python 测试
├── api/                      # Vercel 无服务器函数入口
├── docs/                     # 设计文档
├── dev-tools/                # 开发辅助脚本
├── requirements-stock-data.txt
├── Dockerfile
└── package.json
```

## 免责声明

本项目仅用于市场观察与投研学习，所有 AI 输出均附带"不构成投资建议"提示，行情数据仅供参考，不构成任何实盘交易依据。
