# 个股分析 Agent 方案说明

## 目标

建立基于可核验证据的个股分析体系：程序负责数据获取与数值计算，Agent 负责解释、质疑与综合，最终输出条件式行动方案，而非没有依据的结论。

## 总体架构

```text
统一数据与证据层
  ├─ 行情、财务、公告、行业、情绪、持仓
  └─ 每条数据带来源、时间、新鲜度、核验状态
        ↓
确定性计算层
  ├─ 财务同比/环比/质量指标
  ├─ DCF、可比估值、敏感性分析
  ├─ 趋势、量价、波动率、关键位
  └─ 持仓相关性、集中度、风险预算
        ↓
专业 Agent 层
  ├─ 基本面 / 估值 / 技术与市场 / 事件
  ├─ 风险与反方 / 组合风险
  └─ CIO / Manager
        ↓
条件式行动方案与综合理由
```

## Agent 职责与边界

| Agent | 主要职责 | 主要输入 | 核心输出 | 不应负责 |
| --- | --- | --- | --- | --- |
| 基本面 Agent | 商业模式、财务质量、竞争优势 | 财报、公告、行业数据 | 质量、增长持续性、恶化信号 | 自行计算财务指标、编造行业事实 |
| 行业与产业链 Agent | 行业景气、竞争位置、上下游与成本压力 | 行业成员、行业指数、行业分位、产业链价格、政策和行业事件 | 行业位置、景气方向、成本/需求压力、数据缺口 | 把板块涨跌等同于公司基本面改善 |
| 估值 Agent | 检查假设、解释估值结果 | 代码计算的 DCF、Comps、行业模型 | 合理区间、关键敏感变量 | 让模型心算估值 |
| 技术与市场 Agent | 解释趋势、量价和市场状态 | 程序计算指标、资金和行情 | 趋势、关键位、结构失效点 | 从文本猜测技术指标 |
| 事件 Agent | 研判公告、新闻、财报电话会、政策 | 检索结果和原文 | 催化剂、影响方向、影响期限 | 将讨论热度认定为新闻事实 |
| 风险/反方 Agent | 主动寻找结论漏洞 | 前四个 Agent 的结果及证据 | 反证、遗漏风险、否决项 | 凭空制造风险 |
| 组合风险 Agent | 将单股放入账户评估 | 持仓、相关性、风险预算 | 最大允许仓位、集中度警告 | 脱离账户数据给仓位建议 |
| CIO/Manager | 综合结论并给出条件式方案 | 全部结构化意见 | 行动条件、综合理由、放弃条件 | 搜索新事实或覆盖否决项 |

## 基本面 Agent 判断框架

基本面 Agent 不采用一组固定阈值直接给公司打总分，而采用“少量硬规则 + 动态趋势信号 + 多维评价 + Agent 解释”。硬规则只用于数据完整性和高确定性风险，不直接代表综合好坏；普通信号主要比较公司自身历史、上年同期和连续变化。行业可比数据接入后，再增加行业分位数。

```text
事实快照与证据 ID
  → 确定性财务指标
  → 数据完整性与少量硬性否决
  → 同比、同报告期历史趋势、指标间背离
  → 增长/盈利/现金/稳健性多维信号
  → Agent 解释支持证据、反证和不确定性
  → 风险 Agent 后续复核
```

硬规则仅覆盖：结构化财务数据缺失、归母权益为负、CNINFO 正式披露退市风险警示或终止上市，以及银行/普通企业模板误用。利润与现金流背离等指标先作为恶化信号，结合持续性判断，不因单期数据直接否决。

普通非金融企业重点解释营收、归母与扣非利润、现金转化、资产负债结构、近似 ROE 和自由现金流代理值；银行重点解释资产、贷款、存款、净利息收入、手续费收入、信用减值和权益变化，不使用经营现金流/利润或普通企业资产负债率评价经营质量。净息差、不良率、拨备覆盖率和资本充足率缺失时必须降低判断置信度。

当前实现接口：`GET /api/stock-agents/fundamental?symbol=600519`。返回确定性信号、Agent 结构化意见、硬性否决、数据缺口、引用证据和提示词版本；AI 不可用时保留确定性信号并自动降级为 `limited`，不会伪造完整结论。

当前同花顺结构化财务字段尚未与 CNINFO 原文逐项匹配，因此即使 AI 解释完整，基本面意见状态仍标记为 `limited`，置信度最高为 `medium/74`；完成官方原文核验后才允许提升为高置信度。

## 统一事实与证据契约

当前实现接口：`GET /api/stock-facts?symbol=600000`。它并行汇总个股行情、结构化财务摘要、CNINFO 公告、雪球 F10 与雪球热度，并返回证据列表、数据缺口和快照元数据；快照缓存 60 秒。

```ts
interface Evidence {
  evidenceId: string;
  type: 'market' | 'financial' | 'announcement' | 'news' | 'industry' | 'sentiment' | 'portfolio';
  title: string;
  value?: number | string;
  unit?: string;
  period?: string;
  source: string;
  sourceUrl?: string;
  publishedAt?: string;
  fetchedAt: string;
  freshness: 'realtime' | 'delayed' | 'stale';
  verification: 'official_verified' | 'official_document_only' | 'third_party' | 'unverified';
}
```

所有 Agent 的关键判断都必须引用 `evidenceIds`。没有证据 ID 的内容只能是“假设”或“待验证项”，不得作为最终结论的事实依据。

## 统一 Agent 输出契约

```ts
interface AgentOpinion {
  agent: string;
  status: 'completed' | 'limited' | 'blocked';
  conclusion: string;
  confidence: { score: number; level: 'high' | 'medium' | 'limited'; reason: string };
  positives: OpinionItem[];
  negatives: OpinionItem[];
  uncertainties: OpinionItem[];
  evidenceIds: string[];
  dataGaps: string[];
  vetoes: Array<{ code: string; description: string; triggered: boolean }>;
}
```

## 编排顺序

1. 数据准备与确定性计算：拉取行情、K 线、财务、CNINFO 公告、雪球 F10、热度、行业数据和持仓；再由代码计算指标。
2. 专业分析并行：基本面、估值、技术与市场、事件四个 Agent 并行运行。
3. 质疑与组合评估：风险/反方 Agent 审核前四项；组合风险 Agent 结合账户数据测算仓位和集中度。
4. CIO 综合：只消费已有结构化意见，输出条件式方案，不搜索新事实。

## 评分与否决规则

不采用简单平均分。使用“门槛 + 加权 + 否决”机制：

1. 检查数据完整度和核验状态。
2. 检查是否触发硬性否决项。
3. 检查基本面和估值是否达到最低门槛。
4. 使用技术与事件判断当前时机。
5. 使用组合风险确定最大允许仓位。

典型否决项包括：保留审计意见、关键财务数据无法核验、经营现金流持续显著弱于利润、重大诉讼或退市风险、估值依赖单一激进假设、技术结构已触发预设失效条件。

## 与现有数据源的衔接

| 数据类型 | 当前可用来源 | 使用原则 |
| --- | --- | --- |
| A 股行情 | 腾讯 → 新浪 → 雪球 → 缓存 | 用于市场表现事实，保留来源与新鲜度 |
| 官方披露 | CNINFO | 用于公告、报告期和原始证据核验 |
| 三大报表与主要指标 | 同花顺经 AKShare → 新浪财经摘要经 AKShare | 同花顺为优先结构化主源；金额统一为人民币元、比例统一为小数、报告期统一为 `YYYY-MM-DD`；均标记为 `official_document_only`，需与 CNINFO 核验 |
| 公司画像 | 雪球 F10 | 用于主营业务、管理层等低频资料 |
| 情绪热度 | 雪球讨论/关注榜 | 仅用于关注度解释，不作为基本面事实 |

## 已落地：个股 K 线与技术指标

`GET /api/stock-technical?symbol=600000` 通过 AKShare 获取前复权日线（最长保留 320 根），并写入 `GET /api/stock-facts`。当前代码确定性计算 5/20/60 日涨跌幅、MA20/50/200、RSI14、ATR14、20 日年化波动率、量比、MACD、20 日支撑位、60 日阻力位、52 周高低点及距高点幅度，并给出趋势状态。最新日线输入和每项计算都会生成稳定的 `evidenceId`。

技术计算已扩展为：MA20/50/200 的 5 日斜率、趋势状态持续天数、MA20/50 与 MA50/200 最近交叉、RSI 与 MACD 柱近 5 日变化、ATR 占股价比例、20 日波动率自身一年分位数、20/60 日最大回撤、上涨/下跌日成交量比、量价状态、当日与 20 日平均换手率、换手率自身一年分位数。上述均为代码计算值，并非模型推断。

## 技术与市场 Agent：第一步已实施的日线适配层

统一接口 `GET /api/market-daily-kline?kind=stock&symbol=600519`（或 `kind=index&symbol=000001`）按 AKShare → TickFlow 免费日线 → Baostock → Pytdx 的顺序回退。每次返回均标记来源、回退层级、复权方式、日线频率、最后交易日和抓取时间；Pytdx 仅能提供未复权日线，因此其返回会明确标记为 `adjust: none`，不得与前复权序列混用。

## 技术与市场 Agent：第三步市场环境快照

`GET /api/market-environment` 以上证指数日线为基准，复用统一日线适配层计算指数趋势、动量、波动和回撤；同时接入既有市场脉冲的板块上涨广度、两市成交额、涨停/跌停家数。状态仅在“指数趋势 + 20日表现 + MACD + 板块广度”同向时标记为 `risk_on` 或 `risk_off`，否则为 `neutral`。每个输入和计算结果均带市场证据 ID；广度、成交额或涨跌停脉冲缺失时必须记录数据缺口并降低置信度。

## 技术与市场 Agent：第四步行业归属与基准

`GET /api/stock-industry-benchmark?symbol=600519` 优先以同花顺行业详情页成分表定位股票所属行业，并直接拉取对应同花顺行业指数日线作为行业基准，不以不完整的同业股票清单拼接替代指数。接口返回行业名称、成分数量、行业指数技术快照、来源元数据和证据 ID，并缓存 24 小时；行业口径为“同花顺行业”，后续相对强弱计算必须与个股日线按同一交易日对齐。若同花顺成分或行业指数不可用，回退为 Baostock 的证监会行业归属，并明确返回无行业基准和“不得输出相对行业强弱”的数据缺口。

## 技术与市场 Agent：第五步相对强弱

`GET /api/stock-relative-strength?symbol=600519` 仅在个股、上证指数、行业指数的最后交易日一致时，计算 5/20/60 日相对收益：个股收益减去指数或行业收益。三个周期全部为正时标记 `strong`，全部为负时标记 `weak`，其余为 `mixed`；行业基准缺失、交易日不一致或来源失败时标记数据缺口，不输出“强于/弱于行业”。相对收益本身以及其所有输入都带证据 ID。

## 技术与市场 Agent：完整方案与第六步

### 角色边界

技术与市场 Agent 的工作不是预测股价，也不是重新计算指标；它只能读取已冻结的事实快照和确定性计算结果，解释“当前所处的趋势阶段、交易结构、市场配合度，以及什么条件会推翻该判断”。它不能把单日波动、讨论热度或未经对齐的数据说成趋势事实。

```text
日线与市场事实快照
  → 技术确定性计算（趋势、动量、波动、量价、关键位）
  → 市场环境与行业基准
  → 相对强弱
  → 技术与市场 Agent 的证据化解释
  → 风险/反方 Agent 复核
```

### 输入、来源与计算归属

| 输入类别 | 字段示例 | 获取或计算方式 | Agent 的使用方式 |
| --- | --- | --- | --- |
| 个股日线 | 开高低收、成交量、成交额、换手率、复权方式 | 统一日线适配层，AKShare → TickFlow → Baostock → Pytdx | 仅解释经过校验的日线序列；未复权序列不得与前复权序列比较 |
| 趋势与动量 | MA20/50/200、斜率、持续天数、MACD、RSI | 代码确定性计算 | 判断上行、下行或震荡，而非由模型目测 K 线 |
| 波动与回撤 | ATR、年化波动率分位数、20/60 日最大回撤 | 代码确定性计算 | 判断风险是否扩大及仓位/入场条件是否应收紧 |
| 量价与换手 | 量比、涨跌日成交量比、量价状态、换手率分位数 | 代码确定性计算 | 识别放量确认、缩量整理或量价背离，不能把单日放量直接称为资金持续流入 |
| 关键位 | 20 日支撑、60 日阻力、52 周高低点、距高点 | 代码确定性计算 | 输出观察位与结构失效位；不是精确买卖点承诺 |
| 市场环境 | 指数趋势/动量/波动、广度、成交额、涨跌停 | `GET /api/market-environment` | 判断个股趋势是否获得市场环境配合 |
| 行业与相对强弱 | 行业归属、行业指数、相对大盘/行业 5/20/60 日收益 | 行业基准与相对强弱接口 | 仅在交易日严格对齐时输出相对强弱结论 |

### 输出契约

Agent 使用统一 `AgentOpinion`，并增加以下技术字段；所有结论必须能回指 `evidenceIds`：

```ts
interface TechnicalMarketOpinion extends AgentOpinion {
  trend: {
    state: 'uptrend' | 'downtrend' | 'range' | 'unclear';
    durationTradingDays?: number;
    evidenceIds: string[];
  };
  marketRegime: 'risk_on' | 'neutral' | 'risk_off' | 'unknown';
  relativeStrength: {
    vsMarket: 'strong' | 'weak' | 'mixed' | 'unavailable';
    vsIndustry: 'strong' | 'weak' | 'mixed' | 'unavailable';
  };
  keyLevels: {
    support?: number;
    resistance?: number;
    structureInvalidation?: string;
    evidenceIds: string[];
  };
  execution: {
    stance: 'observe' | 'wait_for_confirmation' | 'trend_following_candidate' | 'avoid';
    entryConditions: string[];
    invalidationConditions: string[];
  };
}
```

输出只允许给出“观察、等待确认、趋势跟随候选、回避”四类状态，以及可被日线验证的条件。示例：`站回 MA20 且 MACD 柱连续改善，并且相对大盘 20 日收益为正`；不能输出“明日上涨概率”“必涨”或脱离风险预算的具体仓位。

### 信号生成与置信度规则

第六步先由代码生成技术与市场确定性信号，再由 Agent 对信号进行解释。信号不是简单总分，而采用“趋势、确认、风险、环境、相对强弱”五个维度并行判断：

第六步已落地接口：`GET /api/stock-technical-market-signals?symbol=600519`。接口不调用 AI，输出趋势、确认、风险、环境、相对强弱、数据质量六类确定性信号；每项均包含原始计算值、证据 ID、严重程度和状态。响应同时返回版本化 `ruleSet`（包括波动/回撤风险阈值与相对强弱判定规则），使后续 Agent、回测与风险/反方复核可以使用同一口径。

### 第七步已实施：关键位与结构失效条件

同一接口现在同时返回 `keyLevels`、`structureInvalidation` 和 `structureRuleSet`。关键位包括 MA20/MA50/MA200、20 日区间低点和 60 日区间高点；所有关键位使用 `0.5 * ATR14` 生成缓冲区，并返回对应的失效价位及证据 ID。程序按当前快照生成并标记结构失效条件：MA50 或 20 日区间低点连续两日有效跌破且放量、MA20 斜率与 MACD 柱同步走弱、波动/回撤触及已披露阈值，以及相对大盘 5/20/60 日超额收益同时转弱。每条规则带版本、计算值、触发状态和证据 ID，Agent 不得自行杜撰失效条件。

### 第八步已实施：技术与市场 Agent 接口

新增 `GET /api/stock-agents/technical-market?symbol=600519`。接口先读取同一份技术与市场确定性快照，再将信号、关键位、结构失效条件、市场环境、相对强弱和数据缺口交给 Agent 解释。Agent 输出趋势阶段、市场状态、相对强弱、观察/等待确认/趋势跟随候选/回避四类执行姿态，以及带证据 ID 的正面、负面和不确定性说明；关键位和失效规则始终以程序结果为准。AI 调用失败或数据质量不足时，接口返回 `limited` 状态和确定性信号回退，不预测股价、不提供买卖指令或具体仓位。支持 `refresh=1` 绕过 Agent 缓存。

### 第九步已实施：验收与降级测试

新增 `npm run test:technical-market`，使用 Node 内置测试运行器覆盖普通股票、银行股、低流动性股票、数据源回退、缓存、行业基准缺失、AI 失败回退以及单日变化不得被判为趋势等契约。测试同时检查关键位/结构规则版本、证据 ID、四类执行姿态和禁止输出（资金流、价格预测、买卖指令、具体仓位）。设置 `TECHNICAL_MARKET_BASE_URL` 后会额外执行真实接口烟测；未设置时测试不依赖外部行情或 AI 服务。

## 行业与产业链 Agent 方案细化

### 角色与边界

行业与产业链 Agent 负责回答“这家公司所处行业现在处在什么位置、公司相对同业强弱如何、上下游和政策是否正在改变经营假设”。它不直接替代基本面 Agent 判断公司质量，也不替代技术与市场 Agent 判断股价趋势；它提供行业背景、竞争位置、产业链压力和同业分位，供基本面、估值、事件、风险和 CIO/Manager 复用。

行业与产业链 Agent 的结论必须来自已冻结的数据快照和确定性计算，不能把板块短期涨跌、媒体叙事或单条政策新闻直接写成“行业景气改善”。当行业成员、产业链价格或行业财务样本不足时，应明确输出 `limited` 或 `unavailable`，并把缺口传给上层 Agent。

```text
行业归属与成员快照
  → 行业指数与行业行情
  → 成分股财务与估值分位
  → 上下游、原材料、价格与需求数据
  → 行业事件与政策分层
  → 行业与产业链 Agent 解释
  → 基本面 / 估值 / 事件 / 风险 / CIO 复用
```

### 输入、来源与可用性

| 输入类别 | 当前可用性 | 主要来源 | 使用原则 |
| --- | --- | --- | --- |
| 行业归属 | 已部分可用 | 同花顺行业详情、Baostock 证监会行业回退 | 优先使用同花顺行业口径；回退口径必须标明，不混用分位 |
| 行业成员 | 已有基础设施，仍受源稳定性限制 | 同花顺行业成分列表 | 需要缓存全量成员快照；不只取前 50 个；成员为空时不得计算行业分位 |
| 行业指数与相对强弱 | 已可用一部分 | 同花顺行业指数、A 股指数日线 | 只在交易日对齐时比较 5/20/60 日相对收益 |
| 同业财务分位 | 已有后端框架，依赖成员质量 | 成员三表与主要指标、同花顺经 AKShare、新浪摘要回退 | 同报告期对齐；剔除停牌、缺报、极端值和新上市异常样本 |
| 估值行业可比 | 已有部分估值分位框架 | 行业成员 PE/PB/PS、历史倍数 | 非正倍数、亏损期和样本不足时保持 `unavailable` |
| 分业务与产品结构 | 已有 CNINFO 解析基础 | 年报、半年报 PDF/HTML | 只使用可定位页码和原文证据的表格/章节；扫描件低置信结果不入结论 |
| 上游原材料价格 | 待接入 | AKShare 商品、期货、指数或公开价格数据 | 需建立“公司业务 → 关键原材料”映射；不能泛泛引用商品价格 |
| 下游需求与景气 | 待接入 | 行业产销、库存、价格指数、宏观与终端数据 | 需要行业特定指标字典；缺指标时只输出数据缺口 |
| 政策与行业事件 | 可与事件 Agent 共用基础设施 | CNINFO、新闻、政策公开源 | 必须区分公司事件、行业事件、政策事件；泛政策不得自动归因单股 |

### 确定性计算

行业与产业链 Agent 前必须先由代码完成以下计算，AI 只解释这些结果：

1. **行业财务分位**：营收增速、净利率、毛利率、ROE、负债率、经营现金流质量、资本开支强度、存货和应收周转等指标，按同一报告期对齐后计算中位数、分位数、样本数和剔除原因。
2. **行业估值分位**：PE、PB、PS、历史分位和同业分位；当盈利为负、倍数无意义或样本不足时，不输出高估/低估。
3. **行业市场强弱**：行业指数相对大盘 5/20/60 日收益、波动率、回撤和趋势状态；只解释市场表现，不等同于基本面。
4. **公司相对行业位置**：公司指标相对行业中位数、行业分位、最近两期分位变化，以及是否出现“公司变弱但行业变强”或“行业承压但公司韧性较强”的分化信号。
5. **产业链压力**：原材料价格、产品价格、库存、产销和下游需求等指标的方向、幅度、持续时间和来源质量；没有业务映射时不得使用通用大宗商品替代。
6. **行业事件影响**：将政策、监管、价格、供需、技术路线变化归入行业事件簇，并记录影响对象、影响路径、观察窗口和失效条件。

### 输出契约

```ts
interface IndustryChainOpinion extends AgentOpinion {
  industry: {
    name: string | null;
    taxonomy: 'ths' | 'csrc' | 'custom' | 'unavailable';
    memberCount?: number;
    evidenceIds: string[];
  };
  cycle: {
    state: 'improving' | 'stable' | 'weakening' | 'divergent' | 'unknown';
    reason: string;
    evidenceIds: string[];
  };
  relativePosition: Array<{
    metric: string;
    companyValue: number | null;
    industryMedian: number | null;
    percentile: number | null;
    period: string;
    status: 'leading' | 'middle' | 'lagging' | 'unavailable';
    evidenceIds: string[];
  }>;
  chainPressures: Array<{
    dimension: 'upstream_cost' | 'downstream_demand' | 'inventory' | 'price' | 'policy' | 'technology';
    direction: 'positive' | 'negative' | 'mixed' | 'unknown';
    description: string;
    evidenceIds: string[];
  }>;
  dataQuality: {
    memberSnapshot: 'complete' | 'partial' | 'unavailable';
    financialSample: 'sufficient' | 'thin' | 'unavailable';
    chainData: 'mapped' | 'partial' | 'unavailable';
  };
}
```

前端建议展示为“行业一句话结论 → 行业位置卡片 → 同业分位趋势 → 产业链压力 → 行业事件/政策时间线 → 数据缺口”。行业分位适合用小型条形图或分位刻度，产业链压力适合用上游/公司/下游三段式视图，行业事件适合用时间线。所有图表都必须显示报告期、样本数、来源质量和证据入口。

### 与其他 Agent 的协作

基本面 Agent 使用行业分位解释公司财务质量，不再只看公司自身同比；估值 Agent 使用同业倍数和行业景气约束估值解释；事件 Agent 使用行业事件判断公司事件是否具有行业共振；技术与市场 Agent 使用行业指数和相对强弱判断市场是否配合；风险/反方 Agent 检查行业样本不足、产业链映射缺失、政策影响过度外推等问题；CIO/Manager 只综合已结构化的行业意见，不重新寻找行业事实。

### 推荐实施顺序

1. 固化行业归属、全量成员快照、缓存和数据缺口展示；
2. 批量拉取成员财务并计算同报告期行业分位；
3. 将行业分位接入基本面与估值解释层；
4. 建立业务到上游原材料、下游需求、行业景气指标的映射表；
5. 接入可稳定获取的产业链价格、库存、产销或景气指标；
6. 将公司事件、行业事件、政策事件统一到事件簇，并增加跨 Agent 交接；
7. 最后开放行业与产业链 Agent 接口，并补前端可视化与回归测试。

### 当前数据缺口

当前最大缺口不是三表字段，而是“行业成员稳定性、行业样本对齐、产业链指标映射、分业务口径和一致预期”。行业成员为空或口径回退时，行业分位必须停用；没有公司业务与原材料/下游指标的映射时，不能把通用商品价格直接套到公司；一致预期通常需要券商研报、数据供应商或可授权的网页来源，暂不应作为已稳定可用输入。

## 事件 Agent 方案细化

### 角色与边界

事件 Agent 负责回答“发生了什么、是否已确认、可能影响什么、影响可能持续多久”。它只解释程序标准化后的公告、新闻、财报披露、政策和原文证据，不自行搜索新事实，不把舆情热度当作事件事实，也不预测股价或提供买卖指令。

事件 Agent 与基本面 Agent 的边界是：基本面 Agent 解释公司的经营质量和持续性，事件 Agent 解释特定事件的新增信息、影响方向和时效性。与舆情 Agent 的边界是：事件 Agent 判断事实及其潜在影响，舆情 Agent 判断市场如何讨论和反应该事件。

### 确定性事件快照

第一阶段新增不调用 AI 的接口：`GET /api/stock-events?symbol=600519&days=180`。它返回冻结的个股事件快照，至少包括：

```ts
interface StockEventSnapshot {
  symbol: string;
  period: { start: string; end: string };
  events: StockEvent[];
  dataGaps: string[];
  snapshotMeta: {
    generatedAt: string;
    source: string;
    freshness: 'realtime' | 'delayed' | 'stale';
    eventVersion: string;
  };
}

interface StockEvent {
  eventId: string;
  category:
    | 'earnings' | 'forecast' | 'contract' | 'm_and_a' | 'financing'
    | 'shareholder' | 'governance' | 'regulatory' | 'litigation'
    | 'production' | 'dividend' | 'clarification' | 'other';
  title: string;
  summary?: string;
  publishedAt?: string;
  effectiveAt?: string;
  source: string;
  sourceUrl?: string;
  verification: 'official_verified' | 'official_document_only' | 'third_party' | 'unverified';
  direction: 'positive' | 'negative' | 'mixed' | 'unknown';
  impactScope: 'company' | 'industry' | 'market' | 'unknown';
  impactHorizon: 'immediate' | 'short_term' | 'medium_term' | 'long_term' | 'unknown';
  status: 'new' | 'ongoing' | 'settled' | 'expired' | 'unconfirmed';
  evidenceIds: string[];
}
```

第一阶段已实施：`GET /api/stock-events` 已接入 CNINFO 公告和现有市场新闻。公告按官方已核验处理；新闻只有在标题明确包含股票代码或公司名称时才纳入，并标记为第三方证据。服务端已完成事件去重、类别/方向/影响期限确定性标记、事件生命周期初步判定、证据列表、数据缺口和 5 分钟缓存；当前版本为 `stock-event-v1`，尚未调用 AI。

### 第二步已实施：事件分类、去重与生命周期回归测试

事件规则已抽取到可独立测试的 `backend/event-rules.ts`，生产快照与测试共用同一套规则。新增 `npm run test:event-rules`，覆盖财报、业绩预告、合同、中标、并购、融资、股东、治理、监管、诉讼、产能、分红和澄清等类别；同时验证标题标点去重、日期区分、官方事件与传闻状态、即时/短期/中期/长期影响期限，以及 `new`、`ongoing`、`settled`、`expired`、`unconfirmed` 生命周期。设置 `STOCK_EVENTS_BASE_URL` 后会额外执行真实 `/api/stock-events` 烟测。

### 数据来源与确定性处理

来源优先级为 CNINFO 官方公告、公告原文链接、明确提及股票代码或名称的新闻、其他第三方转载。雪球热度、讨论量和板块涨跌只能作为关注度或市场反应输入，不能直接生成事件事实。

程序层负责标题和公告去重、同一事件的转载合并、事件分类、公告日期与生效日期提取、官方/第三方/未核验标记、事件是否过期以及证据 ID 绑定。首批事件类别覆盖财报、业绩预告、合同与中标、并购重组、融资回购分红、股东增减持、监管处罚、诉讼问询、产能与产品价格、澄清公告和风险提示。

### 事件生命周期

事件需要保留生命周期，而不是只标记“利好/利空”：

```text
new → ongoing → settled
              ↘ expired
unconfirmed → confirmed / rejected
```

例如，业绩预告在正式财报发布后进入 `settled`；尚未披露执行进度的合同保持 `ongoing`；未经官方确认的传闻保持 `unconfirmed`；已经过了有效窗口的政策或一次性事件标记为 `expired`。

### Agent 接口与输出

新增 `GET /api/stock-agents/event?symbol=600519&days=180`。Agent 只能解释冻结事件快照，建议扩展统一 `AgentOpinion`：

```ts
interface EventAgentOpinion extends AgentOpinion {
  eventSummary: string;
  activeEvents: Array<{
    eventId: string;
    conclusion: string;
    direction: 'positive' | 'negative' | 'mixed' | 'unknown';
    impactHorizon: string;
    catalysts: string[];
    risks: string[];
    watchConditions: string[];
    evidenceIds: string[];
  }>;
  catalysts: OpinionItem[];
  risks: OpinionItem[];
  uncertainties: OpinionItem[];
  eventGaps: string[];
}
```

所有事实判断必须引用事件证据 ID。没有证据的内容只能放在 `uncertainties`。Agent 可以解释“事件可能改善订单可见性”，不能输出“股价将上涨”；可以说明“影响期限暂无法确认”，不能补充公告中不存在的数字。

### 事件 Agent 降级规则

- `completed`：事件来源可用、证据完整且 AI 解释成功；
- `limited`：只有部分来源、事件未核验、时间窗口不足或 AI 不可用；
- `blocked`：所有事件来源均失败，无法形成任何事件事实。

在没有事件时返回“当前时间窗口内未发现可核验的个股事件”，不得编造“没有利好”或把无数据解释成利空。

### 第三步已实施：事件 Agent 接口

新增 `GET /api/stock-agents/event?symbol=600519&days=180`。接口先读取 `stock-event-v1` 冻结快照，再调用 AI 生成事件摘要、活动事件解释、催化剂、风险和观察条件；程序始终保留事件的 `eventId`、类别、方向、影响期限、生命周期和证据 ID，不允许 AI 改写这些确定性字段。AI 不可用时返回 `limited` 确定性回退；所有事件来源不可用且没有事件事实时返回 `blocked`。接口支持 `refresh=1` 绕过 Agent 缓存，提示词版本为 `event-v1`。

### 事件 Agent 升级路线：第一阶段与第二阶段

现有 `stock-event-v1` 和 `event-v1` 属于第一阶段的基础设施。升级的目标不是增加更多“利好/利空”标签，而是让每一条事件从原始证据到影响判断均可复核，并且明确哪些判断仍待后续财务或执行数据验证。

#### 第一阶段：事件筛选、分层与可信呈现

第一阶段解决“哪些事件应该进入研究视野”，输入以 CNINFO 正式公告、公告原文、明确匹配公司名称或代码的新闻为主，不把热度、转载量或板块涨跌当成事件事实。

1. **重大性评分与排序**：在时间倒序之外引入重大性评分；业绩、订单、中标、监管、诉讼、融资、并购和政策优先，会议通知、定期例行公告和重复转载降权。
2. **事件簇与同类聚合**：将公告、媒体首发、补充披露、澄清、执行进度和后续验证聚合到同一个 `eventClusterId`，保留首发与最新进展，避免同一事项重复计数。
3. **公司 / 行业 / 政策分层**：公司直接事项、行业景气事项、政策与监管事项分别记录影响范围；泛市场消息不能自动归因给单家公司。
4. **事件生命周期**：保持 `rumor → announced → executing → verified / weakened / invalidated` 的状态机；兼容现有 `new`、`ongoing`、`settled`、`expired`、`unconfirmed` 字段，并记录状态变更证据。
5. **可信呈现**：前端以时间线显示事件簇、来源等级、影响期限与证据链接；例行公告和低重大性事件默认折叠，不挤占关键催化剂。

第一阶段输出只说明“发生了什么、是否已核验、影响范围和可能期限”，不能把标题关键词直接写成经营改善或股价结论。

#### 第二阶段：事件影响推演与验证闭环

第二阶段解决“该事件是否实质改变公司经营、风险或估值假设”。它读取第一阶段的冻结事件簇，以及基本面、分业务、行业、技术与市场快照；Agent 只能解释这些已有事实，不重新搜索、不创造数字、不输出买卖指令。

```text
事件原文与事件簇
  → 事实字段抽取与核验等级
  → 影响路径（收入 / 利润 / 现金流 / 风险 / 估值）
  → 可验证指标、观察窗口与失效条件
  → 与财务、行业、市场反应的交叉核验
  → 条件式结论
```

第二阶段的核心能力如下：

1. **影响路径，而非单一方向标签**：订单、价格、销量、产能、客户影响收入；原材料、费用、产品结构影响利润；回款、资本开支、融资影响现金流；监管、诉讼、供应链与客户集中度影响风险；增长预期和风险溢价影响估值。路径中的每一步都必须绑定事件或事实快照的证据 ID。
2. **与事实快照交叉验证**：例如新增订单须同时检查金额相对营收、交付周期、历史兑现、应收与经营现金流，不能仅凭公告标题判定收入增长。分业务原文、三表计算和行业分位是优先验证输入。
3. **催化剂状态机**：`rumor`（传闻）、`announced`（已披露）、`executing`（执行中）、`verified`（被后续财报或官方进展验证）、`weakened`（效果弱于预期）、`invalidated`（澄清、取消或反转）。状态转换必须注明日期、来源与证据 ID。
4. **短中长期拆分**：短期关注披露、预期差与市场确认；中期关注订单、产能、价格和执行进度；长期只在有持续经营、资本开支、行业结构或政策依据时讨论。不同周期必须展示不同的证据与不确定性。
5. **反方与失效条件**：每个正向事件必须列出至少一种可证伪条件，例如金额不显著、客户/审批尚未完成、执行数据缺失、行业价格下行抵消、后续财报未体现；无证据的判断只能列为数据缺口。
6. **事件—市场反应校验**：在现有 `return3d` 基础上扩展当日、1/5/10 日收益、成交量、波动率及相对行业/大盘收益；多个重叠事件时明确“不可归因”，不得把收益归功于单一事件。
7. **跨 Agent 交接**：基本面 Agent 接收可验证的经营影响；技术与市场 Agent 接收事件窗口和异常收益；风险/反方 Agent 接收未确认、负面、失效或反转事项；CIO/Manager 只综合已结构化意见，不重新搜索事实。

建议的第二阶段数据结构为：

```ts
interface EventImpactAssessment {
  eventClusterId: string;
  currentState: 'rumor' | 'announced' | 'executing' | 'verified' | 'weakened' | 'invalidated';
  materiality: { score: number | null; level: 'high' | 'medium' | 'low' | 'unavailable'; evidenceIds: string[] };
  pathways: Array<{
    dimension: 'revenue' | 'profit' | 'cash_flow' | 'risk' | 'valuation';
    direction: 'positive' | 'negative' | 'mixed' | 'unknown';
    mechanism: string;
    evidenceIds: string[];
  }>;
  horizons: Record<'short_term' | 'medium_term' | 'long_term', {
    conclusion: string;
    evidenceIds: string[];
    dataGaps: string[];
  }>;
  verificationPlan: Array<{ metric: string; expectedWindow: string; evidenceIds: string[] }>;
  counterEvidence: Array<{ text: string; evidenceIds: string[] }>;
  invalidationConditions: Array<{ text: string; evidenceIds: string[] }>;
  marketReaction: { status: 'confirmed' | 'weak' | 'divergent' | 'not_evaluable'; evidenceIds: string[] };
}
```

第二阶段前端应展示“事件簇时间线 → 影响路径 → 已验证 / 待验证指标 → 支持与反方证据 → 失效条件”，并始终提供原文链接、页码或公告日期。AI 摘要只能作为解释层，不能替代结构化证据。

#### 推荐实施顺序

1. 事件簇、重大性评分、例行公告降权和公司/行业/政策分层；
2. 事件状态机及状态变更证据；
3. 影响路径、可验证指标和失效条件；
4. 接入财务、分业务与行业事实快照，形成交叉验证；
5. 扩展事件窗口市场反应，并加入重叠事件不可归因规则；
6. 最后让 AI 在证据约束下生成条件式解释，补齐回归测试和人工复核入口。

## 舆情与市场反应 Agent 方案细化

### 确定性舆情快照已实施

新增 `GET /api/stock-sentiment?symbol=600519&days=30`，当前复用 `stock-event-v1` 中已明确匹配个股的官方公告/第三方新闻，并接入雪球热度榜。程序输出事件数量、来源质量、正负方向数量、情绪方向、分歧程度、关注度历史和事件后的市场反应，版本为 `stock-sentiment-v2`，不调用 AI。

### 历史热度与行情窗口已实施

服务会在雪球热度源返回新的实时结果时，为每只股票保留最近 24 小时、最多 120 个关注度观测点；缓存命中不会被伪装成新观测。相邻两个有效采样点的关注度变化超过 `+10%` 时为 `rising`，低于 `-10%` 时为 `falling`，其余为 `stable`；不足两个点或前值为零时为 `unavailable`，并保留数据缺口，不将单点热度写成趋势。

对未过期且方向明确的关联事件，快照额外读取个股日线，以事件日前一交易日收盘价为起点、事件后第 3 个交易日收盘价为终点计算 `return3d`。绝对收益小于 `1%` 为 `weak_reaction`；正面事件上涨至少 `1%` 或负面事件下跌至少 `1%` 为 `confirmed_reaction`；方向相反且幅度达到阈值为 `divergent_reaction`；缺少日线、事件日期或完整窗口时为 `not_evaluable`。每项结果返回 `eventReactions`、价格日期、收盘价、收益率和事件/日线证据 ID；整体反应采用保守汇总，存在背离时优先标记 `divergent_reaction`。

### 观点分歧与传播质量已实施

快照升级为 `stock-sentiment-v3`。`evidenceDirectionDisagreement` 复用已明确匹配个股的事件方向，描述正面与负面事件证据是否冲突；其 `viewpointScope` 明确为 `event_direction_evidence`，不能被解释为社区用户观点统计。当前没有接入帖子正文、评论立场、转发链或多社媒来源，因此 `communityViewpointDisagreement` 固定为 `unavailable`，Agent 必须将这一限制列为不确定性。

`propagationQuality` 根据可追溯来源结构返回 `official_primary`、`official_and_media`、`media_only`、`community_heat_only` 或 `insufficient`；同时输出来源数量、候选事件中的去重数与去重率。事件快照会记录归一化标题和日期相同的重复候选事件，但这只能识别当前输入中的重复，不能推断全网转载规模。所有传播结构计算附带独立的计算证据 ID。

### 舆情 Agent 未完成工作

1. **社区内容证据快照**：待接入后续提供的社交平台数据源，冻结帖子正文、评论、发布时间、原文链接、互动量、作者标识和转发/引用关系。
2. **多平台与多媒体交叉验证**：扩展当前单一财经新闻输入，识别独立报道与同源转载，避免将多次转载误计为多个独立催化剂。
3. **观点抽取与证据化**：为每条社区内容抽取立场、论点、对象和置信度，并保留可追溯证据，不以汇总热度代替观点事实。
4. **社区观点分歧计算**：在具备帖子立场后计算多空占比、分歧变化和观点集中度；当前 `communityViewpointDisagreement` 必须保持 `unavailable`。
5. **传播链与异常传播识别**：识别同源转载、短时集中扩散、低质量重复内容、疑似营销和谣言扩散；当前仅能对现有事件标题做有限去重。
6. **传闻、澄清与官方回应生命周期**：将传闻、媒体报道、公司澄清和监管回应关联为同一链路，并评估澄清前后的热度与市场反应。
7. **热度历史持久化**：当前关注度历史仅在服务内存中保留 24 小时、最多 120 个点；后续需要落库、固定频率采样和支持更长观察周期。
8. **热度指标扩展**：增加发帖量、评论量、互动量、独立作者数、增长速度和异常值；单一关注度不能代表完整舆情热度。
9. **事件影响窗口增强**：在当前 `return3d` 之外，补充当日、1/5/10 日收益、成交量、波动率及相对行业/大盘表现，并处理多个重叠事件的归因限制。
10. **舆情质量与时效评分**：细化来源可信度、证据完整度、发布时间衰减、转载比例、事实/观点区分，并以此约束 Agent 置信度。
11. **历史回测与阈值校准**：检验关注度 `±10%` 和事件反应 `±1%` 阈值在不同股票及市场环境中的稳定性。
12. **前端展示与人工复核**：建设事件—传播—观点—行情时间线、证据跳转、数据缺口提示和人工确认/纠错入口。

建议顺序：在社交平台数据源具备后，依次开发“社区内容证据快照 → 观点抽取与分歧 → 传播链与质量评分”。

## 风险/反方 Agent 方案细化

### 角色与边界

风险/反方 Agent 专门复核“当前结论为何可能错误、何时失效、是否存在不应行动的否决理由”。它不负责寻找利好，不预测股价，不输出买卖、仓位或收益建议，也不自行搜索或补充事实。

输入必须来自已冻结的基本面、技术与市场、事件和舆情快照。程序先计算风险、否决和数据缺口；AI 仅在证据约束下解释已计算结果。热度变化、媒体数量或单一观点均不能直接被写成资金流、真实度或交易结论。

### 风险维度

| 维度 | 首期可复用输入 | 首期判断 |
| --- | --- | --- |
| 技术结构 | `technical-market-v1` 的结构失效规则与风险信号 | 关键均线/支撑位的量能确认跌破、动量恶化、风险阈值触发 |
| 市场环境 | 技术与市场快照中的环境和相对强弱信号 | `risk_off`、相对大盘多周期弱势 |
| 事件与合规 | `stock-event-v1` 的活动事件 | 官方核验的负面监管或诉讼、其他负面事件、未确认事项 |
| 舆情与认知 | `stock-sentiment-v3` | 事件方向冲突、市场反应背离、传播质量不足；不把热度当作资金流 |
| 基本面 | 后续接入基本面确定性信号 | 增长、利润质量、现金流、负债和资产质量风险 |
| 估值 | 后续接入估值快照 | 估值口径、盈利支撑和情景敏感性风险 |

### 状态机与否决规则

- `veto`：官方核验的负面监管/诉讼事件，或已触发的量能确认 MA50/20 日支撑结构失效。
- `downgrade`：技术风险阈值、市场 `risk_off`、相对大盘弱势、普通负面事件或关键数据质量不足。
- `watch`：未确认事件、事件方向与价格反应背离、传播结构不足等需等待验证的条件。
- `clear`：当前没有程序可验证的否决或降级条件；不等于安全、看多或可交易。
- `blocked`：所有必要输入均不可用，无法形成风险判断。

每条风险返回类别、严重度、状态、触发条件、解除/证伪条件、证据 ID 和数据缺口。首期 `riskLevel` 为 `high | medium | low | unavailable`，由程序计算；出现 `veto` 时必须为 `high`。

### 接口与 AI 契约

首期先提供不调用 AI 的 `GET /api/stock-risk-snapshot?symbol=600519`，随后提供 `GET /api/stock-agents/risk-counter?symbol=600519&refresh=1`。

风险/反方 Prompt 版本为 `risk-counter-v1`，要求 AI 只解释冻结快照，且不得改写 `riskLevel`、`decision`、`vetoes` 或确定性风险字段。每一项事实判断必须引用 `evidenceCatalog` 中存在的 `evidenceId`；无证据只能进入 `uncertainties`。AI 不可用时返回确定性 `limited` 回退。

### 实施顺序

1. 风险确定性快照、跨 Agent 输入校验与状态机。
2. 技术结构、市场环境、负面事件三类风险规则。
3. 基本面与估值风险规则。
4. 风险/反方 Agent 接口、Prompt、证据过滤与降级。
5. 上涨、下跌、震荡、监管事件、数据缺失等情景回归测试。

### 基本面与估值风险规则已实施

`stock-risk-v2` 已复用基本面事实快照和既有确定性信号。归母权益为负、CNINFO 正式披露退市风险警示/终止上市等基本面硬否决进入 `veto`；营收与扣非利润同步恶化、扣非利润质量风险、利润为正但经营现金流持续为负等信号进入 `downgrade`，并附财务报告或计算证据 ID。银行仍使用贷款/存款增速、净利息收入和信用减值等银行专用信号，不使用普通企业现金流规则。

当前尚未接入可复现的市值、PE/PB/PS、行业可比估值和估值情景快照。因此风险快照返回 `valuation.status = unavailable` 及明确数据缺口，不会把缺少估值数据伪装为“高估”或“低估”。后续估值引擎完成后，再将估值倍数、历史分位、行业比较和盈利情景敏感性接入风险规则。

### 风险/反方 Agent 接口已实施

新增 `GET /api/stock-agents/risk-counter?symbol=600519&refresh=1`。接口先读取 `stock-risk-v2` 冻结快照，再调用 AI 生成反方论点、风险触发条件和解除/证伪条件；`riskLevel`、`decision`、`vetoes`、`risks`、`watchConditions` 和 `valuation` 始终以程序结果为准。Prompt 版本为 `risk-counter-v1`，禁止 AI 搜索新事实、修改确定性状态、把 `clear` 写成安全或看多、把估值不可用写成风险解除，以及输出股价预测、买卖或仓位建议。

反方论点和不确定性中的证据 ID 会被过滤为冻结快照已有的 `evidenceIds`。AI 不可用时返回 `limited` 确定性回退；风险输入全部不可用或没有可引用风险证据时不调用 AI，并返回 `blocked` 或 `not_requested` 的确定性结果。

### 风险/反方 Agent 多情景验收与降级测试已实施

已覆盖以下情景：无触发项时返回 `clear/low`；量能确认的关键支撑失效、官方监管/诉讼和基本面硬否决返回 `veto/high`；市场 `risk_off`、相对弱势和高严重度基本面恶化返回 `downgrade`；未确认事件及事件—行情背离仅返回 `watch`；估值数据缺失必须标记 `unavailable`，不得虚构高估/低估结论。

Agent 契约还验证：部分来源可用时维持 `limited` 且不改写确定性决定；AI 回退保留冻结风险字段；全输入不可用时 `blocked` 且无不支持证据；无可引用风险证据时不调用 AI；任何不属于冻结快照的证据 ID 均被拒绝。实时烟测可通过 `RISK_COUNTER_BASE_URL` 启用。

## CIO/Manager Agent 方案细化

### 角色与边界

CIO/Manager Agent 是单只股票研究链路的汇总与治理层，读取基本面、技术与市场、事件、舆情、风险/反方 Agent 的冻结输出，判断当前研究是否具备继续推进条件、核心结论是否冲突、还缺少什么证据。它不重新搜索或创造事实，不得改写下游确定性字段，且不能覆盖风险/反方 Agent 的 `veto`，不输出自动交易、仓位或收益承诺。

### 综合状态机

`researchStatus` 固定优先级为 `blocked > rejected > deferred > watch > research_ready`：

- `blocked`：风险快照为 `blocked` 或核心输入大面积不可用。
- `rejected`：风险/反方 Agent 为 `veto`。
- `deferred`：存在 `downgrade`、重大数据缺口或核心 Agent 高严重度冲突。
- `watch`：无否决但存在待验证事件、结构、舆情或估值条件。
- `research_ready`：无否决、无降级、核心输入完整且无重大冲突；仅表示材料可继续用于研究，不等于买入建议。

一致性/冲突由程序计算。例如基本面正向但技术结构失效属于核心冲突；正面事件但 `eventReaction = divergent_reaction` 属于事件—市场反应冲突；热度变化但传播质量不足属于信息质量限制。每项冲突都需要维度、严重度、解除条件和证据 ID。

### 接口、Prompt 与降级约束

已实现两个层次的接口：

- `GET /api/stock-manager-snapshot?symbol=600519`：只返回程序生成的 `stock-manager-v1` 确定性汇总快照，不调用 AI。
- `GET /api/stock-agents/cio-manager?symbol=600519&refresh=1`：读取冻结汇总快照并请求 `cio-manager-v1` 解释；省略 `refresh=1` 时可复用短期缓存。

`cio-manager-v1` 的输入仅包括股票代码、`deterministicManager`、数据缺口和快照证据目录。Prompt 明确要求：不搜索外部事实、不重新计算下游指标、不修改 `researchStatus`、`riskDecision`、`riskLevel`、`conflicts`、`requiredConditions` 或 `researchPriorities`；`riskDecision = veto` 时必须保留 `researchStatus = rejected`，`blocked` 必须保持 `blocked`；`research_ready` 只表示研究材料完整，不是买入、卖出、仓位、收益或价格预测信号。

AI 只输出解释性字段：`summary`、`confidence`、`supportingCase`、`counterCase`、`requiredConditions`、`researchPriorities` 和 `uncertainties`。服务端对每个条目执行证据白名单过滤：文本长度受限，`evidenceIds` 去重并截断，且只能保留当前快照 `evidenceIds` 中存在的 ID；没有合法证据的事实条目直接丢弃，不能借 AI 文本进入确定性结论。证据目录同时保留标题、数值、期间、来源、来源 URL、发布时间和核验状态，便于前端展示与复核。

当核心汇总状态为 `blocked` 或没有可引用证据时，不调用 AI，直接返回确定性回退，`opinion.status = blocked`；AI 请求失败、JSON 不可解析或输出经过过滤后无法形成有效证据链时，返回确定性字段和 `opinion.status = limited`，并在置信度原因中记录回退原因。任何降级都不得改变风险否决、研究状态、冲突、必备条件或研究优先级。接口响应中的 `agentMeta` 固定记录 `promptVersion = cio-manager-v1`、`managerVersion = stock-manager-v1`、快照时间和 `aiStatus`（`completed`、`fallback` 或 `not_requested`）。

建议在估值 Agent 完成后再实施 CIO/Manager；否则估值持续不可用会使综合结论长期受限。

### CIO/Manager 确定性汇总快照已实施

新增 `GET /api/stock-manager-snapshot?symbol=600519`，版本为 `stock-manager-v1`，不调用 AI。接口并行读取基本面、技术与市场、事件、舆情、估值和风险快照，统一证据目录与输入可用性，并按 `blocked > rejected > deferred > watch > research_ready` 计算研究状态。

风险/反方 `veto` 具有最高优先级，任何正向 Agent 输出都不能覆盖；程序同时识别基本面—技术、事件—行情反应、基本面—风险等跨 Agent 冲突，输出支持项、反方项、冲突解除条件、研究优先级和数据缺口。`research_ready` 仅表示研究材料完整且可继续使用，不代表买入、看多或可交易。

### CIO/Manager Agent 多情景验收与降级测试已实施

新增 `npm run test:cio-manager-scenarios`，覆盖完整且一致、观察条件、估值数据缺口、基本面—技术高严重度冲突、风险降级、风险否决和核心输入阻断七类状态。测试验证状态优先级保持 `blocked > rejected > deferred > watch > research_ready`，AI 解释不能削弱 `veto` 或 `blocked`，也不能把 `deferred` 改写为可继续行动的结论。

降级场景覆盖 AI 请求失败、AI 未调用、证据目录为空、AI 输出包含快照外证据 ID、空事实条目及交易化措辞。预期结果分别为确定性 `limited` 或 `blocked`，所有确定性风险字段、冲突、必备条件和研究优先级保持不变；无合法证据的解释条目被过滤。设置 `CIO_MANAGER_BASE_URL` 后可额外执行实时接口烟测。

### 个股研究报告页第一版已实施

前端新增 `StockResearchTab`，从“我的关注”中的个股卡片进入，复用现有移动端容器、字体、蓝色主色和底部导航。页面首屏展示实时行情、CIO/Manager 研究状态、风险级别、证据数量、AI/确定性回退状态和汇总解释；支持刷新快照及返回自选列表。

内容按研究任务分为“支持与反方”“基本面与估值”“技术与市场”“事件与舆情”“风险与反方”“证据与数据缺口”折叠区块。证据条目展示来源、日期、核验状态和原始链接；数据缺口与阻断/受限提示保持显著。页面只提供“带着这份研究去问 AI 泡泡”的解释入口，不提供买卖、仓位、目标价等交易操作。

## 组合风险 Agent 方案细化

### 可选输入与隐私边界

组合风险 Agent 是 CIO/Manager 之后的可选模块，不依赖也不假设产品持有用户真实持仓。前端提供“我的组合（可选）”或“模拟组合”入口：未填写时 Agent 不运行并返回 `not_requested`，不影响单股研究；填写手工组合或模拟组合后才计算。

首期用户可填写股票代码、持仓数量或持仓市值、可选成本价、可选现金余额及可选风险预算（例如单股最大占比或最大可承受亏损）。默认只保留当前浏览器会话；用户明确选择后才保存到本机。不得接入券商账户或自动同步真实持仓；发送给后端或 AI 前仅传输计算所必需的最小字段并向用户提示。

### 输出与实施顺序

组合风险输出只分析单股/行业集中度、市场与行业暴露、波动和回撤压力、事件风险叠加、风险预算偏离与数据缺口，不输出买卖或调仓指令。后续接口建议为 `POST /api/portfolio-risk-snapshot` 和 `POST /api/stock-agents/portfolio-risk`，由确定性快照优先计算，再交由 Agent 解释。

开发顺序建议为：估值 Agent → CIO/Manager Agent → 可选组合输入界面与组合风险快照 → 组合风险 Agent。社交平台舆情增强可在取得数据源后并行补强，不阻塞该主链路。

## 估值 Agent 方案细化

### 职责与边界

估值 Agent 先回答当前市场价格对应哪些可复现的估值口径、这些口径是否有意义及其数据限制；只有取得历史分位、行业可比或盈利情景后，才能讨论相对高低。它不预测股价、不提供目标价、买卖或仓位建议，也不把净利润为负的 PE 写成“高估”。

普通非金融企业首期使用 PE、PB、后续可扩展 PS；银行优先使用 PB 和 ROE，PE 仅作辅助，不能以普通企业自由现金流或 EV/EBITDA 直接评估。市场估值倍数和财务分母必须分开标记来源与核验状态。

### 状态与数据规则

`valuationStatus` 为 `limited | unavailable`，倍数状态为 `meaningful | not_meaningful | unavailable`。PE/PB 为非正时标记 `not_meaningful`；缺少市场市值、倍数或财务报告期时标记 `unavailable`。没有历史分位和行业可比时，只能陈述当前数值与数据缺口，禁止输出“高估/低估”。

### 第一步已实施：市场估值数据适配与估值事实快照

新增 `GET /api/stock-valuation?symbol=600519`，首期版本为 `stock-valuation-v1`，不调用 AI。接口通过东方财富 A 股实时行情适配市场价格、总市值、流通市值、动态/静态 PE 和 PB，并复用财务事实快照中的营收、归母净利润、扣非净利润、权益及报告期作为分母证据。每个市场字段和财务字段均有独立 `evidenceId` 与来源元数据。

首期返回当前倍数、倍数可用性、市场规模、财务分母、比较基准状态和数据缺口。PS、历史估值分位和行业可比暂为 `unavailable`；因此快照不会给出高估/低估判断。风险快照升级为 `stock-risk-v3` 并透传估值状态，供后续估值 Agent 与 CIO/Manager 使用。

### 第二步已实施：普通企业与银行的估值口径规则

估值快照会根据财务模板返回 `valuationFramework`。普通非金融企业优先使用 `peDynamic`、`pb`，并保留营收、利润、扣非利润和经营现金流作为解释输入；银行优先使用 `pb`、`peDynamic`，同时要求 ROE 近似值、信用减值和净利息收入等银行指标作为解释基础，排除普通企业的 PS、EV/EBITDA 和自由现金流收益率框架。PE 只有在利润为正时才标记为 `meaningful`，PB 只有在权益为正时才标记为 `meaningful`；市场接口返回的非正倍数统一为 `not_meaningful`。

当前仍不产生高估/低估结论，因为历史分位与行业可比尚未接入。后续实施顺序：估值 Agent 接口和 `valuation-v1` Prompt → 历史分位与行业可比 → 盈利情景与 DCF/剩余收益模型。

### 估值 Agent 接口已实施

新增 `GET /api/stock-agents/valuation?symbol=600519&refresh=1`，Prompt 版本为 `valuation-v1`。接口只解释当前 `stock-valuation-v3` 冻结快照，`valuationStatus`、`valuationFramework`、各倍数及其 `meaningful/not_meaningful/unavailable` 状态、财务分母、情景模型和比较基准状态均由程序确定，AI 不得改写。

当比较基准不可用时，AI 只能说明当前估值数值、企业类型口径和数据缺口，不得输出高估、低估、合理估值、目标价或买卖/仓位建议。AI 输出的估值解释和不确定性会过滤为快照已有的 `evidenceIds`；估值来源不可用或没有可引用证据时不调用 AI，返回 `blocked` 或确定性 `limited` 回退。

### 第三步已实施：历史估值分位与行业可比数据

估值快照升级为 `stock-valuation-v2`。系统复用个股行业映射，读取个股历史 PE/PB/PS 序列计算有效样本数、最新日期和历史分位；同时读取同一行业成分股当前 PE/PB/PS，返回同行样本数、中位数和目标股票在同行样本中的分位。非正倍数、亏损期和空值不进入有效分位样本，行业样本不足时比较状态保持 `unavailable`。

历史和同行分位均以独立计算证据 ID 返回。分位数只表示样本中的相对位置，不自动等同于高估或低估；仍需结合企业类型、盈利质量和口径一致性解释。后续实施顺序：盈利情景与 DCF/剩余收益模型。

### 第四步已实施：盈利情景与 DCF/剩余收益模型

估值快照升级为 `stock-valuation-v3`，新增 `scenarioModel`。盈利情景从最新扣除异常值后的净利润同比增速派生保守、基准、乐观三档，并使用上下 10 个百分点敏感性；该增长率是程序假设，不是事实预测。

普通非金融企业仅在正的自由现金流代理值和净债务均可用时计算 DCF；当前财务输入尚未稳定提供这两个字段时，`dcf.status` 保持 `unavailable`。银行在权益和 ROE 近似值可用时计算三年剩余收益情景，使用明确的资本成本与终值增长假设；结果标记为 `limited` 模型情景，不是目标价或确定内在价值。所有情景保留输入证据 ID、假设版本、折现率/资本成本和终值增长率，AI 不得修改模型结果或假设。

### 盈利情景与估值模型多情景验收已实施

已覆盖保守/基准/乐观增长边界、DCF 完整输入、缺少 FCF/净债务、折现率不大于终值增长率、银行 ROE 低于/等于/高于资本成本、盈利输入全部缺失等情景。测试要求模型结果保持 `limited` 或 `unavailable`，禁止将企业价值、每股模型值或剩余收益结果写成目标价、确定内在价值或交易建议。

### 舆情 Agent 接口已实施

新增 `GET /api/stock-agents/sentiment?symbol=600519&days=30`。接口先读取 `stock-sentiment-v3` 冻结快照，再调用 AI 解释情绪方向、分歧、来源质量、传播结构、关联事件和已计算的行情反应；`attention`、`tone`、`disagreement`、`evidenceDirectionDisagreement`、`communityViewpointDisagreement`、`sourceQuality`、`propagationQuality`、`eventReaction` 始终以程序结果为准。AI 输出的催化剂、风险和不确定性会过滤为快照中存在的 `evidenceIds`；AI 不可用时返回 `limited` 确定性回退，所有来源失败且无证据时返回 `blocked`。提示词版本为 `sentiment-v2`，支持 `refresh=1` 绕过缓存。

### 角色与边界

舆情 Agent 负责回答“市场如何讨论和反应这个事件”。它分析关注度变化、观点方向、分歧程度、来源结构和事件后的市场反应，但不证明事件真实性，不把讨论热度等同于资金流入，也不预测股价。

事件 Agent 判断事实及其潜在影响；舆情 Agent 判断市场认知和反应。两者使用不同的证据、置信度和降级状态，最后由风险/反方 Agent 和 CIO/Manager 综合使用。

### 输入与确定性计算

舆情快照建议包含新闻数量及发布时间分布、来源数量、官方公告与媒体报道比例、标题方向、讨论热度变化、观点集中度、重复转载比例、传闻/澄清比例，以及事件前后的成交量和波动率变化。

当前雪球热度只能作为关注度输入，WallStreetCN 新闻只有在明确关联个股时才能进入个股舆情；泛市场新闻不得自动归属到单只股票。

建议新增不调用 AI 的接口：`GET /api/stock-sentiment?symbol=600519&days=30`。程序先生成关注度、来源质量、情绪方向和市场反应的确定性字段，再交给 Agent 解释。

### 舆情 Agent 输出

建议新增 `GET /api/stock-agents/sentiment?symbol=600519&days=30`：

```ts
interface SentimentOpinion extends AgentOpinion {
  attention: 'rising' | 'stable' | 'falling' | 'unavailable';
  tone: 'positive' | 'negative' | 'mixed' | 'neutral' | 'unavailable';
  disagreement: 'low' | 'medium' | 'high' | 'unavailable';
  sourceQuality: 'official_led' | 'media_led' | 'community_led' | 'mixed' | 'insufficient';
  eventReaction: 'confirmed_reaction' | 'weak_reaction' | 'divergent_reaction' | 'not_evaluable';
  catalysts: OpinionItem[];
  risks: OpinionItem[];
  uncertainties: OpinionItem[];
  evidenceIds: string[];
}
```

允许的表达包括“讨论热度较过去窗口明显上升，但来源主要为社区讨论，事件真实性仍需公告确认”“官方公告已发布，但市场讨论方向分歧较大”“新闻数量增加主要来自同一事件的转载，不能视为多个独立催化剂”。禁止输出“舆情很好所以必涨”“热度上升等于资金流入”或“主力正在进场”。

### 两个 Agent 的编排关系

```text
事件确定性快照
        ↓
事件 Agent：事实、方向、影响期限
        ↓
舆情确定性快照
        ↓
舆情 Agent：关注度、情绪、分歧、市场反应
        ↓
风险/反方 Agent
        ↓
CIO/Manager
```

第一阶段建议先实现“CNINFO 公告 + 明确股票匹配的新闻”，暂不把泛市场新闻自动归属到个股。事件 Agent 和舆情 Agent 稳定后，CIO 才可以把舆情作为短期时机和风险背景，而不能把它作为基本面事实或独立交易信号。

### 验收与降级测试

事件 Agent 至少验证财报、合同、监管、回购、诉讼和澄清公告；同一事件多来源去重；官方公告与媒体转载的证据等级差异；未核验传闻不得进入确定性催化剂；过期事件不得作为当前催化剂；无事件、部分来源失败、全部来源失败和 AI 不可用时均能正确降级。舆情 Agent 还需验证关注度上升不等于资金流入、转载不重复计数、热度不被写成事实，以及两个 Agent 的所有结论都引用合法证据 ID。

1. **趋势**：均线排列、均线斜率和持续天数共同判断；均线交叉单独出现不足以确认趋势。
2. **确认**：MACD/RSI 变化与量价状态共同判断动量是否配合；指标冲突时只标记为分歧。
3. **风险**：ATR 比例、波动率分位数、最大回撤和距 52 周高点共同约束结论；风险升高可覆盖趋势乐观判断。
4. **环境**：`risk_on`、`neutral`、`risk_off` 只作为背景条件，不把大盘上涨自动等同于个股机会。
5. **相对强弱**：优先使用相对大盘；仅在行业指数存在且日期一致时加入相对行业。缺失时必须显示 `unavailable`，不可补猜。

置信度由数据完整度、最后交易日一致性、复权一致性、信号一致性和市场/行业可用性共同决定。出现日线源降级、未复权日线、停牌造成序列不连续、行业基准缺失或指标互相矛盾时，状态应降为 `limited` 或 `blocked`，而不是给出高置信度方向。

### 结构失效条件

结构失效条件由程序按当前快照生成，Agent 只能引用或组合，不能杜撰。例如：跌破 20 日支撑后未在后续交易日收复、MA20 斜率转负且 MACD 柱持续走弱、相对大盘 5/20/60 日同时转弱，或波动率/回撤超过预先披露的风险阈值。阈值必须在接口响应中返回版本和计算依据，便于回测与复现。

### 后续实施顺序

1. 将现有个股技术、市场环境、行业基准、相对强弱合并为同一份 `technicalMarket` 事实快照，并复用已有证据 ID。
2. 由代码生成趋势、确认、风险、环境、相对强弱及数据质量六类确定性信号，并保存信号版本。
3. 新增 `GET /api/stock-agents/technical-market?symbol=...`：先读取冻结快照，再调用 AI 生成受证据约束的结构化解释；AI 不可用时返回确定性信号与 `limited` 状态。
4. 为接口补齐缓存、来源标记、最后交易日检查、复权一致性检查和可复现运行记录。
5. 用上涨、下跌、震荡、停牌/缺行业基准四类样本做回归测试，再交给风险/反方 Agent 复核。

## 当前数据缺口

- 个股日线的第二、第三数据源回退链，以及除权除息和停牌等异常交易日的专门标记；
- 财报报告期与 CNINFO 原始公告自动匹配；
- CNINFO 原始定期报告中银行净息差、不良率、拨备覆盖率和资本充足率的自动解析；
- 行业可比公司与估值倍数；
- DCF 情景计算引擎；
- 用户真实持仓、风险预算与相关性矩阵；
- Agent 运行记录、版本与可复现事实快照。

## 已落地：财报标准化与模板化计算

`GET /api/stock-financials?symbol=600000` 与事实快照均优先调用同花顺经 AKShare 提供的利润表、资产负债表、现金流量表和主要指标。金额统一换算为人民币元（前端可按万、亿或万亿展示），比例统一为小数，报告期统一为 `YYYY-MM-DD`；同花顺失败时自动回退至新浪财务摘要。

| 模板 | 自动识别 | 当前确定性计算 |
| --- | --- | --- |
| 普通非金融 | 无利息净收入，且不同时具备贷款与存款字段 | 收入/净利润/扣非净利润/权益同比、净利率、扣非净利率、经营现金流/净利润、资产负债率、近似 ROE、自由现金流代理值 |
| 银行 | 存在利息净收入，或同时具备贷款与存款字段 | 营收/净利润/扣非净利润/权益/资产/贷款/存款/利息净收入/手续费净收入同比、近似 ROE、信用减值占营收比 |

银行的经营现金流和“资产负债率”不作为经营质量评分项；净息差、不良率、拨备覆盖率和资本充足率仍需后续从 CNINFO 定期报告原文结构化解析。每个原始字段与代码计算值都会在事实快照中生成稳定的 `evidenceId`。

## 推荐实施顺序

1. 建立个股事实快照和证据 ID。
2. 完成财务指标与技术指标计算。
3. 开发基本面、技术与市场、事件三个 Agent。
4. 开发风险/反方 Agent。
5. 开发 CIO/Manager。
6. 补充确定性估值引擎和估值 Agent。
7. 最后接入组合风险 Agent。

## CIO 输出要求

最终输出必须为条件式方案，例如：

```text
当前判断：观察 / 可研究 / 条件满足后行动 / 暂不参与

成立条件：
1. 最新财报确认收入增速没有继续恶化；
2. 股价重新站上关键位且成交量配合；
3. 估值回到基准情景合理区间。

失效条件：
1. 经营现金流继续恶化；
2. 核心业务增速低于阈值；
3. 风险 Agent 的否决项被触发。
```
