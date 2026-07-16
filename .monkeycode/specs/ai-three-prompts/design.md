# AI 三 Prompt 架构 — 技术设计文档

## 设计目标

将泡泡看市首页的硬编码内容替换为三层 AI Prompt 流水线驱动的动态内容，配合 finnews skill 获取真实行情数据。

## 技术选型

| 层面 | 选择 | 原因 |
|------|------|------|
| AI 模型 | Google Gemini `gemini-3.5-flash` | 已集成，无需新增依赖 |
| 行情数据 | finnews skill | 东方财富 + Yahoo Finance + 华尔街见闻，免 Key |
| 后端 | Express (server.ts) | 现有架构，新增路由 |
| 前端 | React (现有 HomeTab) | 最小改动 |

## 三层 Prompt 设计

### Prompt 1：市场理解

**技术实现**：

```
输入 ← finnews skill 输出（行情数据 JSON）
  ↓
构造 User Message：当日指数 + 板块涨跌 + 成交额 + 涨幅 Top 股
  ↓
System Instruction：资深市场分析师，数据优先，新闻仅作证据
  ↓
强制输出 JSON（temperature: 0.3，降低创造性以保证结构稳定）
  ↓
解析 JSON → { marketSentiment, top3Themes, keyEvents, affectedSectors }
```

**为什么用 JSON 输出**：Prompt 1 是数据流水线的起点，下游 Prompt 2 需要结构化输入。使用 JSON 避免了解析自由文本的不确定性。

**temperature 参数**：`0.3`。市场理解需要事实准确性，低 temperature 减少随机性。

### Prompt 2：因果推理

**技术实现**：

```
输入 ← Prompt 1 输出 + 新闻原文（来自 finnews）
  ↓
System Instruction：财经逻辑分析师，必须提供证据，宁可"不确定"也不编造
  ↓
输出格式：事件 → 原因 → 板块 → 结果 因果链，附带确定性评级
  ↓
temperature: 0.1 ← 因果推理要求最高的事实准确性
```

**幻觉抑制机制**：
- `certainty: "不确定"` 是合法且推荐的输出
- System instruction 中强调"宁可证据不足，也不编造"
- 提供新闻原文作为交叉验证依据
- temperature 设为最低 0.1

### Prompt 3：老师表达

**技术实现**：

```
输入 ← Prompt 1 输出 + Prompt 2 输出
  ↓
System Instruction：财经老师，小白友好，一句话原则，术语附带解释
  ↓
输出：可读自然语言文本（非 JSON），直接渲染
  ↓
temperature: 0.7 ← 表达层可以更有创意，让语气更自然
```

相比 Prompt 1/2 的高约束，Prompt 3 给予更多自由度，让"泡泡老师"的人设更生动。

## 后端实现

### 新增 API 端点

#### `POST /api/morning-report`

**实现文件**：`server.ts`（新增路由）

**调用链路**：

```typescript
// 伪代码
async function handleMorningReport(req, res) {
  // 1. 获取行情数据
  const marketData = await fetchMarketData(); // 调用 finnews skill 对应的数据拉取

  // 2. Prompt 1: 市场理解
  const understanding = await ai.generateContent({
    model: 'gemini-3.5-flash',
    config: {
      systemInstruction: PROMPT_1_SYSTEM,
      temperature: 0.3,
      responseMimeType: 'application/json',
    },
    contents: JSON.stringify(marketData),
  });
  const p1Result = JSON.parse(understanding.text);

  // 3. Prompt 2: 因果推理
  const reasoning = await ai.generateContent({
    model: 'gemini-3.5-flash',
    config: {
      systemInstruction: PROMPT_2_SYSTEM,
      temperature: 0.1,
      responseMimeType: 'application/json',
    },
    contents: JSON.stringify({
      themes: p1Result.top3Themes,
      events: p1Result.keyEvents,
      newsText: marketData.newsText,
    }),
  });
  const p2Result = JSON.parse(reasoning.text);

  // 4. Prompt 3: 老师表达
  const narrative = await ai.generateContent({
    model: 'gemini-3.5-flash',
    config: {
      systemInstruction: PROMPT_3_SYSTEM,
      temperature: 0.7,
    },
    contents: JSON.stringify({
      sentiment: p1Result.marketSentiment,
      themes: p1Result.top3Themes,
      chains: p2Result.causalChains,
    }),
  });

  // 5. 组装响应
  res.json({
    sentiment: p1Result.marketSentiment,
    summaryText: narrative.text,
    themes: assembleThemes(p1Result, p2Result),
    timestamp: new Date().toISOString(),
  });
}
```

**注意**：三步 AI 调用必须串行执行（Prompt 2 依赖 Prompt 1 输出，Prompt 3 依赖前两者）。

#### `GET /api/market-overview`

**实现**：纯规则引擎，无 AI 调用。

```typescript
async function handleMarketOverview(req, res) {
  const marketData = await fetchMarketData();

  // 规则引擎计算
  const indices = marketData.indices.map(i => ({
    name: i.name,
    value: i.price,
    change: i.changePercent,
  }));

  // 按涨跌幅排序板块
  const sortedSectors = marketData.sectors.sort((a, b) => b.change - a.change);
  const topSectors = sortedSectors.slice(0, 5);
  const bottomSectors = sortedSectors.slice(-3);

  // 涨跌家数统计
  const marketBreath = calculateMarketBreath(marketData);

  res.json({ indices, topSectors, bottomSectors, marketBreath, totalVolume: marketData.volume });
}
```

### 数据获取层

**finnews skill 集成**：

finnews skill 已经在第一步中安装到了 `skills/capitalise-finnews/`。其 SKILL.md 中定义的端点：

- **东方财富**：A 股指数、板块、公告
- **Yahoo Finance**：美股指数、大宗商品（需海外网络）
- **华尔街见闻**：全球快讯

在 server.ts 中新增一个 `fetchMarketData()` 函数，按 finnews skill 的优先级规则调用上述 API：

```typescript
async function fetchMarketData(): Promise<MarketData> {
  // 按优先级依次调用（串行，避免并发猛拉）
  const aStock = await fetchEastMoney();
  const usStock = await fetchYahooFinance().catch(() => null);
  const globalNews = await fetchWallStreetCN().catch(() => []);

  return {
    indices: [...aStock.indices, ...(usStock?.indices ?? [])],
    sectors: aStock.sectors,
    announcements: aStock.announcements,
    newsText: globalNews.map(n => n.text).join('\n'),
    volume: aStock.totalVolume,
    timestamp: new Date(),
  };
}
```

## 前端改动

### HomeTab.tsx 改动清单

| 区域 | 改动 |
|------|------|
| 早报文本 (第 226 行) | 从硬编码改为 `fetch('/api/morning-report')` 获取 `summaryText` |
| 原因解读弹窗 (第 577 行) | 从硬编码三因素改为渲染 `themes[].reasonText` + `themes[].causalChain` |
| 三大热点卡片 (第 391 行) | 从硬编码改为渲染 `themes` 数组 |
| 市场概览指数 (第 289 行) | 从 `data.ts` + `Math.random()` 模拟改为 `fetch('/api/market-overview')` |
| 板块标签 (第 358 行) | 从硬编码改为渲染 `topSectors` / `bottomSectors` |

### 前端数据流

```
HomeTab mount
  ├── fetch('/api/market-overview')  // 立即渲染（不走 AI，速度快）
  └── fetch('/api/morning-report')   // 并行请求（AI 耗时较长，异步加载）

market-overview 返回（毫秒级）→ 指数、板块、情绪条立即渲染
morning-report 返回（秒级）→ 早报文本、热点卡片异步刷新
```

**加载状态**：早报区域在 AI 响应返回前显示骨架屏/加载动画。

### 缓存策略

- `market-overview`：前端缓存 60 秒（数据变化不快，减少 API 压力）
- `morning-report`：前端缓存到当天日期，同一天只请求一次

## 文件变更清单

| 文件 | 操作 | 内容 |
|------|------|------|
| `server.ts` | 修改 | 新增 `/api/morning-report`、`/api/market-overview` 路由；新增 `fetchMarketData()` 函数 |
| `src/components/HomeTab.tsx` | 修改 | 早报、原因解读、热点卡片改为 API 驱动；移除硬编码文本 |
| `.monkeycode/specs/ai-three-prompts/requirements.md` | 新增 | 需求文档（已完成） |
| `.monkeycode/specs/ai-three-prompts/design.md` | 新增 | 本设计文档 |

## 风险与注意事项

1. **API 调用次数**：每次早报生成需 4 次 Gemini 调用（P1 + P2 + P3 + finnews 数据获取中的非 AI 请求），按 Gemini 免费额度每日可使用
2. **响应延迟**：串行 3 次 AI 调用预计总耗时 3-8 秒，前端需处理加载状态
3. **finnews 网络依赖**：Yahoo Finance 在内网环境不可用，需降级方案（仅东方财富 + 华尔街见闻）
4. **幻觉风险**：Prompt 2 设计中已通过 `certainty: "不确定"` + `temperature: 0.1` 抑制，但无法完全消除
5. **成本**：按 Gemini Flash 定价，每次完整早报约 $0.0005，日成本可控
