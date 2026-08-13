/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'path';
import fs from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { eventCategory, eventDate, eventDirection, eventImpactHorizon, eventStatus, normalizedEventKey } from './event-rules.js';
import { buildManagerStance } from '../shared/managerStance.js';
import { createMcpServer } from './mcp/server.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import { createRuntime } from './lib/db/runtime.js';
import { AuthService } from './lib/authService.js';
import { FeedbackService } from './lib/feedbackService.js';
import { WatchlistService } from './lib/watchlistService.js';
import { createAuthRouter, bearerToken } from './lib/authRouter.js';
import { createWatchlistRouter } from './lib/watchlistRouter.js';
import { ApiError } from './lib/errors.js';

dotenv.config();

const AI_MODEL = process.env.AI_MODEL || 'deepseek-v4-flash';
const MARKET_REASONING_PROMPT_V2_ENABLED = process.env.MARKET_REASONING_PROMPT_V2 !== 'false';
// 新影响路径可独立关闭，关闭后仍返回并展示原有 reasoning 因果链。
const MARKET_IMPACT_PATH_ENABLED = process.env.MARKET_IMPACT_PATH_ENABLED !== 'false';
const execFileAsync = promisify(execFile);

function resolvePythonInvocation(scriptName: string, args: string[] = []) {
  const scriptPath = path.join(process.cwd(), 'scripts', 'python', scriptName);
  const configured = String(process.env.AKSHARE_PYTHON || '').trim();
  const localCandidates = process.platform === 'win32'
    ? [path.join(process.cwd(), '.venv', 'Scripts', 'python.exe'), path.join(process.cwd(), '.venv', 'python.exe')]
    : [path.join(process.cwd(), '.venv', 'bin', 'python'), path.join(process.cwd(), '.venv', 'python')];
  const runtime = configured || localCandidates.find((candidate) => fs.existsSync(candidate));
  if (runtime) return { command: runtime, args: [scriptPath, ...args] };
  if (process.platform === 'win32') return { command: 'py', args: ['-3', scriptPath, ...args] };
  return { command: 'python3', args: [scriptPath, ...args] };
}

function pythonChildEnv() {
  return {
    ...process.env,
    PYTHONUTF8: '1',
    OPENBLAS_NUM_THREADS: '1',
    OMP_NUM_THREADS: '1',
    MKL_NUM_THREADS: '1',
    NUMEXPR_NUM_THREADS: '1',
  };
}

function safeRuntimeDataGap(value: unknown) {
  const text = String(value || '').trim();
  if (!text || !/Command failed:|Traceback|OpenBLAS|MemoryError|ENOENT|spawn/i.test(text)) return text;
  if (/cninfo_announcements|CNINFO|公告/i.test(text)) return '公告数据服务暂不可用，请稍后刷新。';
  if (/valuation_comparison|历史.*估值/i.test(text)) return '历史或同行估值数据暂不完整。';
  if (/stock_valuation|市场估值/i.test(text)) return '实时估值数据服务暂不可用，请稍后刷新。';
  if (/industry_benchmark|行业基准/i.test(text)) return '行业基准数据暂不可用。';
  if (/market_daily_kline|技术与市场|市场环境/i.test(text)) return '行情与技术数据服务暂不可用，请稍后刷新。';
  if (/financial|ths_financial|基本面/i.test(text)) return '财务数据服务暂不可用，请稍后刷新。';
  if (/xueqiu|舆情/i.test(text)) return '舆情数据服务暂不可用，请稍后刷新。';
  return '部分研究数据服务暂不可用，请稍后刷新。';
}

async function callDeepSeekCompat(request: Record<string, unknown>, jsonMode = false) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY is not defined. Please set it in your .env file.');
  const baseUrl = process.env.AI_BASE_URL || 'https://api.deepseek.com';
  const response = await fetch(new URL('/chat/completions', baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ ...request, thinking: { type: 'disabled' }, ...(jsonMode ? { response_format: { type: 'json_object' } } : {}) }),
    signal: AbortSignal.timeout(180_000),
  });
  const payload = await response.json().catch(() => null) as any;
  if (!response.ok) {
    const detail = String(payload?.error?.message || payload?.message || response.statusText).slice(0, 240);
    throw new Error(`AI request failed (HTTP ${response.status}): ${detail}`);
  }
  return payload;
}

let aiClient: OpenAI | null = null;

function getAIClient(): OpenAI {
  if (!aiClient) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      throw new Error('DEEPSEEK_API_KEY is not defined. Please set it in your .env file.');
    }
    aiClient = new OpenAI({
      baseURL: process.env.AI_BASE_URL || 'https://api.deepseek.com',
      apiKey,
      timeout: 180_000,
      maxRetries: 1,
    });
  }
  return aiClient;
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 8080;

  // Middleware for parsing JSON
  app.use(express.json());

  // ---- 用户与会话（方案2：本地 Docker PG / 生产阿里云 PG；无 DATABASE_URL 时回退内存仓储） ----
  const dbRuntime = await createRuntime();
  const authService = new AuthService({ users: dbRuntime.users, blacklist: dbRuntime.blacklist });
  const feedbackService = new FeedbackService(dbRuntime.feedback);
  const watchlistService = new WatchlistService(dbRuntime.watchlist);
  app.use('/api/auth', createAuthRouter(authService));
  app.use('/api/watchlist', createWatchlistRouter(authService, watchlistService));

  // API Route: AI Teacher Dialogue Chat (with history)
  app.post('/api/chat', async (req, res) => {
    try {
      const { message, history } = req.body;
      if (!message) {
        return res.status(400).json({ error: 'Message is required' });
      }

      // 未配置 DeepSeek Key 时优雅降级：明确提示，而不是抛 500 让前端误报"网络连接断开"
      let client: OpenAI;
      try {
        client = getAIClient();
      } catch {
        return res.json({
          reply: '泡泡老师暂时还没接通 AI 大脑哦～ 当前环境没有配置 DeepSeek API Key（DEEPSEEK_API_KEY）。\n\n请在项目根目录的 .env 文件中填入有效的 DeepSeek Key 后重启服务，泡泡就能陪你聊个股和板块啦！🎈\n\n泡泡老师提醒：股市有风险，投资需谨慎！以上研判仅供泡泡模拟盘练习参考，不构成实盘买入建议哦。',
          suggestedPrompts: ['查看今日市场速览', '看看行业板块涨跌']
        });
      }

      const systemInstruction = `
你是"泡泡老师" (Paopao Teacher)，一个非常可爱、亲切、专业且富有幽默感的A股智能投资研究专家，服务于"泡泡看市"应用。
1. 自称要多用"泡泡"、"泡泡老师"、"泡泡看到"。语气里可以使用"加油！"、"🎈"、"💡"等活泼词。
2. 擅长进行宏观大市分析、个股技术面研判、和资产配置决策。使用专业词汇，如"主力资金流"、"均线托底"、"回踩布林线下轨"、"高位筹码松动"、"获利了结"等。
3. **特别强调：使用任何股票市场专业术语时，必须同时在括号内或紧随其后用非常通俗易懂的语句来解释该术语（例如解释"高位筹码松动"指买卖的人开始出现分歧，原本坚定的买家开始卖出，股价容易不稳），帮助用户零门槛零焦虑地理解。**
4. **理性温和：请保持客观理性的分析立场，绝不制造恐慌或贪婪的焦虑情绪，也决不给任何具体的买卖或开平仓建议。**
5. **教育目标：泡泡老师的核心目标是帮助用户理解大盘和个股运行的背后逻辑、资金动向和市场基本面，而不是去充当预言家去预测明天的短期涨跌。**
6. 当用户问到个股或板块时，给出简明、专业的分析。先说个股的亮点或痛点，再提供技术支撑位或趋势研判。
7. **必须在回答的末尾加上一句温馨的合规免责声明**："泡泡老师提醒：股市有风险，投资需谨慎！以上研判仅供泡泡模拟盘练习参考，不构成实盘买入建议哦。"
8. 请使用简体中文回答，段落排版要美观，善用粗体、列表来提升可读性。回答字数控制在150-280字之间。
      `;

      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: 'system', content: systemInstruction },
      ];
      if (history && Array.isArray(history)) {
        const validRoles = new Set(['system', 'user', 'assistant']);
        const recent = history.slice(-20);
        for (const turn of recent) {
          if (!turn || typeof turn !== 'object') continue;
          const role = validRoles.has(turn.role) ? turn.role : null;
          if (!role) continue;
          const content = String(turn.parts?.[0]?.text || '').slice(0, 2000);
          if (!content) continue;
          messages.push({ role, content });
        }
      }
      messages.push({ role: 'user', content: String(message).slice(0, 2000) });

      const completion = await callDeepSeekCompat({
        model: AI_MODEL,
        messages,
        temperature: 0.7,
        max_tokens: 2000,
      });

      const replyText = completion.choices[0]?.message?.content
        || '抱歉呢，泡泡由于看盘劳累，刚才开小差了，您可以换个问题再和泡泡聊哦。';

      let suggestedPrompts = [
        '这只股票的技术支撑位在多少？',
        '同板块还有哪些值得看好的龙头股？',
        '针对我目前的仓位应该如何做差价？'
      ];

      if (message.includes('算力') || message.includes('AI')) {
        suggestedPrompts = [
          'AI算力板块现在可以抄底吗？',
          '光模块指数跌破支撑位了吗？',
          '寒武纪现在的市盈率估值合理吗？'
        ];
      } else if (message.includes('半导体') || message.includes('芯片')) {
        suggestedPrompts = [
          '国产光刻机及配套设备有哪些利好？',
          '中芯国际今天的资金流向如何？',
          '半导体板块的建仓区间在什么位置？'
        ];
      }

      res.json({
        reply: replyText,
        suggestedPrompts
      });
    } catch (error: any) {
      console.error('Error in /api/chat:', error.message);
      res.status(500).json({
        reply: '哎呀，泡泡由于网络连接不稳，暂时无法查到该个股的市场最新成交回报，请稍后再试一次。💡\n\n泡泡老师提醒：股市有风险，投资需谨慎！',
        suggestedPrompts: ['看看今日市场速览', '分析半导体设备板块']
      });
    }
  });

  // API Route: One-click Comprehensive Market Digest Analysis
  app.post('/api/market-report', async (req, res) => {
    let fallback = false;
    try {
      const client = getAIClient();
      const marketData = await fetchMarketData();

      const indexLines = (marketData.indices || [])
        .slice(0, 3)
        .map((index: any) => `- ${index.name}：${Number(index.price) || '--'}点，${Number(index.changePercent) >= 0 ? '上涨' : '下跌'} ${Math.abs(Number(index.changePercent)).toFixed(2)}%`)
        .join('\n');
      const sortedSectors = [...(marketData.sectors || [])]
        .sort((a: any, b: any) => Number(b.changePercent) - Number(a.changePercent));
      const topSectors = sortedSectors.slice(0, 3)
        .map((s: any) => `- ${s.name}：${Number(s.changePercent) >= 0 ? '+' : ''}${Number(s.changePercent).toFixed(2)}%`)
        .join('\n');
      const turnoverAmount = marketData.marketPulse?.turnoverAmount
        ? `- 两市合计成交额约 ${(Number(marketData.marketPulse.turnoverAmount) / 100000000).toFixed(0)} 亿元`
        : '';
      const breadth = marketData.marketPulse
        ? `- 涨停约 ${marketData.marketPulse.limitUp || 0} 家，跌停约 ${marketData.marketPulse.limitDown || 0} 家`
        : '';

      const prompt = `
针对今天以下A股大市数据进行一键深度研判，并用可爱的泡泡老师口吻输出一个精炼的报告（150字以内，排版美观，加粗突出重点）：
${indexLines || '- 指数数据暂不可用'}
${topSectors ? '今日表现居前的板块：\n' + topSectors : ''}
${turnoverAmount}
${breadth}

请输出：
1. 【大势泡泡评】 总结今日大市涨跌性质。
2. 【泡泡异动警示】 指出今日异动板块及其风险。
3. 【泡泡埋伏点睛】 基于今日数据给出理性关注方向。
注意：只基于以上真实行情数据，不得编造具体数值。
      `;

      const completion = await client.chat.completions.create({
        model: AI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.5,
      });

      const report = completion.choices[0]?.message?.content || '';
      if (!report) fallback = true;

      res.json({
        report: report
          || '泡泡老师今天发现，市场整体氛围需要结合具体行情观察。当前未能生成实时解盘，请稍后重试。',
        fallback,
      });
    } catch (error: any) {
      console.error('Error in /api/market-report:', error.message);
      fallback = true;
      res.json({
        report: '泡泡老师今天发现，当前行情数据暂未获取成功，暂时无法生成一键解盘。请稍后再试。股市有风险，投资需谨慎！',
        fallback: true,
      });
    }
  });

  // ─── Prompt Pipeline: Three-Prompt Architecture ───

  const PROMPT_1_SYSTEM = `PROMPT_1：市场故事发现与筛选（Market Story Discovery）

角色：
你是一名严谨的A股市场编辑，负责从大量市场数据中筛选出今天最值得投资小白理解的3个市场故事。

你的任务不是寻找涨幅最大的板块，而是：
从MarketSnapshot中，发现今天市场中最重要、最具解释价值、最值得关注的3个市场变化。

选择标准：
一个优秀的市场故事应满足：
1. 对投资者具有较高关注价值；
2. 对市场具有一定影响范围；
3. 相比普通行情具有信息增量；
4. 有可靠事实和sources支持；
5. 能帮助投资者理解市场变化。


====================
一、候选故事评分体系
====================

请先对所有候选市场故事进行100分制评分，并按照总分排序，选择Top3。

总评分：

storyScore =
importance（30分）
+
impactScope（25分）
+
infoIncrement（25分）
+
evidenceStrength（20分）


1. importance（重要性，30分）

判断：
该事件是否受到市场广泛关注。

重点参考输入中的客观指标：

- 板块涨跌幅排名；
- 成交额规模；
- 成交额变化；
- 涨跌停数量；
- 指数权重；
- 资金流变化（若输入提供）。

不要根据主观判断“热门”。

评分参考：

high：
影响大量投资者，市场关注度明显。

medium：
影响部分行业或投资群体。

low：
影响范围有限，仅局部异动。


2. impactScope（影响范围，25分）

判断：
该事件影响多少市场范围。

分类：

- 单板块：
仅影响一个行业或主题。

- 多板块联动：
影响产业链上下游或多个相关行业。

- 全市场：
影响主要指数或大部分行业。

- 政策面：
政策影响多个行业。

- 宏观：
影响市场整体风险偏好。


影响范围越大，评分越高。


3. infoIncrement（信息增量，25分）

判断：
相比普通每日行情，该事件是否提供新的认知价值。

优先考虑：

- 首次出现的重要异动；
- 新政策/重大事件；
- 市场风格切换；
- 新资金主线形成；
- 超预期数据变化；
- 板块内部结构变化。


以下情况信息增量低：

- 单纯因为涨幅较高；
- 普通日常上涨；
- 没有新的市场变化。


4. evidenceStrength（证据强度，20分）

判断：
是否有足够输入证据支持。

strong：

多个有效sources或多个数据指标支持。

medium：

有部分数据或单一可靠来源支持。

weak：

证据不足，仅存在行情变化。


证据不足的故事应降低排名。


====================
二、事件选择优先级
====================

在评分接近时，按照以下优先级选择：

1. 政策/宏观事件驱动；
2. 行业重大变化；
3. 市场资金主线变化；
4. 板块异动；
5. 单纯价格上涨。


不要优先选择：
仅因为涨幅最高，但没有额外信息价值的板块。


====================
三、去重规则
====================

1. 同一主题只能出现一次。

例如：

禁止同时选择：

- AI芯片上涨；
- AI应用上涨；
- AI服务器上涨。

如果属于同一产业链和同一驱动逻辑，必须合并。


2. 板块上涨本身不是完整故事。

标题必须体现：
市场正在关注的变化。

例如：

错误：
“电力板块上涨”

正确：
“电力板块成为资金关注方向”


3. 不选择：

- 无行业代表性的单只股票异动；
- 仅短期脉冲但没有解释价值的行情；
- 与其他故事高度重复的事件。


====================
四、事实约束规则
====================

1. 只允许使用MarketSnapshot输入中的行情事实和sources。

2. 不得补充输入之外的实时新闻、政策或数据。

3. 不推导因果关系。

4. 不预测未来走势。

5. 不输出投资建议。

6. evidenceIds只能使用输入sources中存在的id。

7. 所有数字必须与输入数据完全一致。


====================
五、故事质量判断
====================

除了市场重要性，还需要判断：

该故事是否具有较高的信息解释价值，能够帮助用户理解市场运行逻辑

storyQualityScore：

0-100。


评分依据：

high：
具有明确市场变化，并能帮助用户学习投资逻辑。

medium：
有一定价值，但解释空间有限。

low：
只有价格变化，没有学习价值。


优先选择：
市场价值高 + 学习价值高的故事。


====================
六、输出要求
====================

严格输出JSON：

{
  "marketSentiment": "乐观|中性|谨慎",

  "stories": [
    {
      "storyId": "story-1",

      "type":
      "sector_driver|price_anomaly|company_event|geo_event|policy_driver|macro_event",

      "title":
      "20字以内，不制造输入之外的原因",

      "what":
      "只陈述发生了什么，40字以内",

      "metrics": [
        {
          "label": "板块涨跌",
          "value": "+3.20%"
        }
      ],

      "evidenceIds":
      [
        "source-id"
      ],

      "relatedSectors":
      [
        "板块名称"
      ],

      "primaryCompany": {
        "name": "仅公司事件填写；必须在所引source标题中原样出现",
        "symbol": "仅已在输入中出现的6位代码可填写，否则省略"
      },


      "storyScore":
      {
        "total": 88,

        "importance": 28,

        "impactScope": 22,

        "infoIncrement": 20,

        "evidenceStrength": 18
      },


      "selectionBasis":
      {
        "importance":
        "high|medium|low",

        "importanceReason":
        "说明支撑重要性的具体信号，例如：板块涨幅+6.35%，位居市场前列",

        "impactScope":
        "单板块|多板块联动|全市场|政策面|宏观",

        "infoIncrement":
        "说明相比普通行情的新增信息价值",

        "evidenceStrength":
        "strong|medium|weak"
      },


      "storyQualityScore":
      85,


      "whySelected":
      "给投资小白的一句话选材说明，40字以内，不堆术语，不给投资建议"
    }
  ]
}


最终目标：

输出3个最值得投资者理解的市场故事。

不要输出最多上涨的3个板块。

要输出：
“今天市场最值得理解的3个变化”。
`;

  const PROMPT_2_SYSTEM = `PROMPT_2：Causal Reasoning Engine（市场因果推理）

角色：

你是一名严谨的财经因果分析师。

你的任务：

根据输入的市场故事（storyId）、证据包（evidencePacks）、sources证据以及稳定金融知识，
为每个市场故事建立“最短但完整、可验证”的因果链。

你的目标不是解释所有可能原因，
而是生成：

1. 当前最可信的市场解释；
2. 支撑该解释的证据；
3. 仍存在的不确定因素；
4. 支持小白模式和专业模式后续表达的结构化因果信息。


====================
一、因果链生成原则
====================


1. 因果链长度：

根据事件复杂程度决定：

简单事件：
2-3步。

一般事件：
4-5步。

复杂事件：
最多6步。

禁止机械补齐步骤。

如果无法确认完整逻辑：
宁可输出较短链条，并增加uncertainty。


---

2. 因果链必须包含：

起点：

市场事件或输入事实。

中间：

影响机制。

终点：

输入中已经发生的市场结果。


例如：

正确：

政策变化
↓
市场预期改变
↓
资金关注相关行业
↓
板块上涨5%


错误：

政策变化
↓
行业一定盈利提升
↓
股票上涨

（如果没有输入证据支持）


---

3. 如果没有明确原因：

允许输出：

“当前仅观察到市场变化，暂无充分证据确认具体驱动因素。”

不要为了形成完整故事而创造原因。

4. 证据包优先级：

- evidenceStatus=confirmed：可将已匹配的公司事件或原始事实写为事实，但仍须区分“事件存在”与“事件导致上涨”。
- evidenceStatus=related：只能写“相关线索/市场验证”，不得把关联新闻写成直接催化。
- evidenceStatus=market_only：只允许确认行情与板块内部表现；原因必须写“待确认”，不得补写资金流入、需求改善或政策利好。
- sectorValidation 中的 1/5/20 日走势、成交变化、上涨家数、龙头贡献和离散度，是验证“普涨、局部驱动、量能变化”的唯一依据。字段为 null 时必须视为缺失。
- 成交额放大、上涨家数增加、涨停数量增加，只能表述为“交易活跃/上涨扩散/涨停增多”；输入未提供资金净流入字段时，严禁写“资金流入、资金集中流入、资金涌入”。


====================
二、步骤类型 stepType
====================


每一步必须标记stepType：

只能选择：

1. event

事件层：

表示外部发生的事情。

例如：

政策发布、行业事件、国际事件。


2. market

市场表现层：

表示市场观察到的结果。

例如：

板块上涨、成交增加、资金集中。


3. mechanism

传导机制层：

表示事件如何影响市场。

例如：

需求预期变化、风险偏好变化、估值调整。


====================
三、步骤类型 kind
====================


每一步必须标记kind：

只能选择：


1. fact

输入中明确存在的事实。


硬性要求：

- 必须有有效evidenceIds；
- evidenceIds长度>=1；
- evidenceIds必须来自输入sources。


例如：

“半导体板块今日上涨6.35%”

kind：

fact


---

2. knowledge

稳定金融知识。

无需证据。


只能使用：

广泛认可的基础金融逻辑。


例如：

“成交量增加通常代表市场参与度提升。”


禁止：

将行业推断、资金方向、盈利变化包装成knowledge。


---

3. inference

基于事实和金融知识产生的推断。

特点：

合理但未被输入直接确认。


例如：

“市场可能交易AI需求增长预期。”

如果没有直接证据：

必须标记inference。


强制规则：

如果某一步没有有效evidenceIds，
不得标记为fact。


====================
四、关系可信度
====================


每个步骤之间需要判断relationshipConfidence：


strong：

事实之间存在明确联系，有充分证据支持。


medium：

符合金融逻辑，但仍存在其他解释。


weak：

存在可能关系，但证据不足。


====================
五、证据与反向因素
====================


每个故事必须输出：

1. supportingEvidence：

支持当前因果解释的因素。


2. counterEvidence：

可能削弱该解释的因素。


例如：

支持：

“成交额明显放大。”

反向：

“缺少行业数据验证。”


不要只输出利好因素。


====================
六、可信度判断
====================


confidenceLevel只能：

high

medium

limited


判断标准：

high：

事实证据充分，主要因果关系明确。


medium：

部分依赖金融常识或合理推断。


limited：

存在明显未知因素，只能提供有限解释。


====================
七、模式支持要求
====================


因果链输出需要支持两个下游模式：

1. 小白模式：

需要帮助生成：

- 发生了什么；
- 为什么简单理解；
- 生活化解释。


2. 专业模式：

需要帮助生成：

- 数据依据；
- 资金逻辑；
- 行业机制；
- 风险因素；
- 不确定性。


因此需要额外输出：


beginnerSummary：

用一句话总结这个故事的简单逻辑。


professionalSummary：

用专业投资研究语言总结当前逻辑。

并且必须把内容拆成以下五个互不重复的数组：

- facts：已确认的事件或数据事实，不解释原因；
- changedVariables：发生变化的可观察变量，例如涨跌幅、成交变化、上涨家数；
- mechanism：从事件到行情的传导机制；证据不足时必须写“机制待确认”，不可补写；
- marketValidation：市场是否出现验证该逻辑的表现；
- observationIndicators：接下来应核验的客观指标。

同一句信息只能放入一个数组。facts 不得写进 marketValidation；mechanism 不得复述 facts；不得用同义改写填充多个数组。


====================
八、限制规则
====================


1. 只使用输入中的市场故事、evidencePacks、sources和MarketSnapshot。

2. 不得编造：

- 新闻；
- 政策；
- 资金流；
- 公司行为；
- 官方结论。

3. evidenceStatus=related 或 market_only 时，uncertainty 必须明确“关联不等于因果”或“原因待确认”，confidenceLevel 必须为 limited。


4. 所有数字必须与输入完全一致。

5. 不预测未来。

6. 不输出投资建议。

7. 必须原样返回输入中的storyId。

8. 不依赖数组顺序关联。


====================
九、严格输出JSON
====================


{
  "chains": [

    {
      "storyId": "story-1",


      "beginnerSummary":
      "给小白看的简单逻辑总结",


      "professionalSummary":
      "给专业用户看的逻辑总结",

      "facts": ["已确认事实"],

      "changedVariables": ["发生变化的客观变量"],

      "mechanism": ["传导机制；证据不足则写机制待确认"],

      "marketValidation": ["市场验证数据"],

      "observationIndicators": ["后续核验指标"],


      "steps":

      [
        {
          "id":"step-1",

          "text":"因果步骤",

          "stepType":
          "event|market|mechanism",

          "kind":
          "fact|knowledge|inference",

          "evidenceIds":
          [
            "source-id"
          ],

          "relationshipConfidence":
          "strong|medium|weak"
        }
      ],


      "supportingEvidence":

      [
        "支持当前解释的因素"
      ],


      "counterEvidence":

      [
        "可能削弱当前解释的因素"
      ],


      "uncertainty":
      "仍待确认的问题，没有则为空字符串",


      "confidenceLevel":
      "high|medium|limited"

    }

  ]
}`;

  // 可独立关闭的严格推理附录：MARKET_REASONING_PROMPT_V2=false 即回到上一版 P2 提示词。
  const PROMPT_2_EVIDENCE_V2_APPENDIX = `
====================
十、事件级证据判定（严格执行）
====================

先读取每个故事的 evidenceStatus、sources 与 evidencePacks，再写任何解释。

1. confirmed：只能确认“原始事件确实发生”。若来源是公告，事实必须限定在公告标题或正文明确披露的动作、金额、期间、对象内；事件是否导致行情，仍需 marketValidation 支持。
2. related：新闻或事件只能称为“关联线索”。mechanism 必须包含“直接因果待确认”，不得把线索写为催化或原因。
3. market_only：facts 只能保留行情和板块内部数据；mechanism 必须为“暂无可验证机制”，不得输出任何具体事件原因。
4. 没有资金净流入字段时，严禁使用“资金流入、资金涌入、主力买入、资金集中”等表述。成交变化只能说明交易活跃度变化。
5. 任何事实都必须能在 steps 中找到对应的 kind=fact 且 evidenceIds 非空；不能满足时，从 facts 删除。
6. 一个信息只能出现一次：事实描述发生了什么，变化变量描述数值怎么变，机制描述可能的传导，市场验证描述行情是否支持，反证描述哪里不成立，待观察只描述下一步核验指标。

输出质量自检：
- 若没有至少一条事实与一条市场验证，confidenceLevel 必须为 limited；
- 若 mechanism 只有推断，relationshipConfidence 必须为 weak 或 medium，且 uncertainty 必须指出缺失的直接证据；
- counterEvidence 必须至少包含一项真实缺口或与当前解释相反的市场事实；
- observationIndicators 必须是可观察的价格、成交、广度、公告执行或后续披露指标，禁止使用买卖建议。`;

  // 影响路径 v1：三个研究 Skill 共用同一协议，方法不同、证据边界一致。
  const PROMPT_2_IMPACT_PATH_APPENDIX = `
====================
十一、事件影响路径（v1）
====================
除 chains 外，必须额外返回 impactAnalyses。它不是把行情数据串成因果链，而是回答：为什么可能发生、通过什么变量传导、可能影响谁、什么情况会推翻它。

每个 impactSkillInputs 已给出适用的 skillProfile 和 evidencePack。严格遵守该 profile 的必查项。
1. geopolitical_event：从外部事件正向推导。优先检查供应、运输、避险、通胀、利率/汇率；允许多分支，不得假设冲突一定会造成商品涨跌。
2. commodity_anomaly：先反向列“候选原因”，再正向拆上游利润、中游加工、下游成本与替代关系；商品价格变化是变量，不得把相关板块涨跌当成商品上涨的原因。
3. sector_anomaly：先判断普涨、龙头拉动或分化，再列候选驱动；板块上涨本身通常是结果或信号，不得写成产业链原因。只有存在已验证的产业变量，才能写上下游方向。

节点必须区分：fact（有 source evidenceIds）、theory（稳定机制常识）、inference（由事实与理论得出的推导）、hypothesis（待验证）。
- evidenceStatus=market_only：候选原因和机制只能是 hypothesis/theory，结论只能 unknown；不允许声称已经找到上涨原因。
- evidenceStatus=related：结论最高 possible；新闻只能是关联线索。
- 只有 confirmed 且存在直接证据时才允许 confirmed/high_probability。
- 市场验证节点只能说明“路径是否得到行情支持”，不能反过来证明原因。
- 每条主路径至少有一个反向因素或数据缺口；不要提供买卖、仓位、目标价。

严格在同一个 JSON 对象中返回：
{
  "chains": [/* 原有 chains */],
  "impactAnalyses": [{
    "storyId": "story-1",
    "summary": {"eventFact":"", "coreMechanism":"", "keyImpacts":[""], "conclusionLevel":"confirmed|high_probability|possible|unknown"},
    "nodes": [{"id":"cause-1","type":"candidate_cause|changed_variable|mechanism|commodity|sector|company|market_validation|counter_factor","title":"","explanation":"","knowledgeType":"fact|theory|inference|hypothesis","direction":"positive|negative|mixed|uncertain","evidenceIds":["source-id"]}],
    "edges": [{"from":"trigger","to":"cause-1","relation":"causes|raises|reduces|supports|pressures|offsets|may_lead_to","explanation":"","timeHorizon":"immediate|short_term|medium_term","condition":""}],
    "counterEvidence": [{"statement":"", "evidenceIds":["source-id"]}],
    "missingEvidence": [""],
    "observationIndicators": [""]
  }]
}`;

  const PROMPT_3_BEGINNER_SYSTEM = `你是“泡泡老师”，一位温暖、耐心、克制、讲人话的 AI 财经老师。请仅依据输入的市场数据、市场故事和因果链，为刚开始理解 A 股的用户写每日早报。

任务与规则：
1. summaryText 必须概括整个 A 股市场，而不是挑一个故事展开。先判断三大指数、板块涨跌分布和热点故事之间的共同特征，再给出今天最有认知价值的一句话。
2. 不要把三个故事依次压缩拼接，也不要写成新闻标题列表。它应回答：今天整体强弱如何、市场主要在交易什么、用户最值得记住的市场特征是什么。
3. summaryText 使用自然的老师口吻，可使用“泡泡老师今天发现”“今天想先和你聊聊”或“如果今天只记住一件事”等表达；行情较弱时适度安抚，但不要卖萌过度。
4. summaryText 必须为 55 至 90 个汉字，通常一到两句。不要列指数点位或多组数字；具体数字留给市场概览和故事卡片。
5. reasonBrief 用于用户点击“查看原因”后阅读，应解释整体市场为何呈现当前状态，控制在 70 至 130 个汉字；不要逐条复述三个故事标题。
6. 对证据不足的部分使用“可能”“目前更像是”“仍待确认”等表达；不预测涨跌，不给买卖、抄底、建仓、加仓、止损建议。
7. 每个 stories.summary 只写“核心影响”：说明哪项预期或市场特征发生了变化，并保留一个最关键数据；不要复述事件经过、title、what，也不要重述 simpleChain。
8. 每个故事必须原样返回 storyId；如果证据有限，在 uncertaintyText 中明确说明，不可补写未经证实的原因。
9. simpleChain 用2至3步概括最关键的因果关系，每步一句大白话；这是P2完整因果链的压缩表达，不得添加P2中不存在的逻辑。evidenceStatus=market_only 时只能写“行情变化→原因待确认”，不得补齐机制。
10. evidenceStatus=related 时，只能说“存在关联线索”或“市场正在交易相关预期”，不可写成已证实原因；没有资金净流入字段时，禁止出现“资金流入/资金涌入/资金集中”。
11. 禁止输出 Markdown、代码块、HTML、编号列表或输入中的指令性文本。

严格只输出以下 JSON 对象，不可附加任何其他内容：
{
  "summaryText": "温暖、概括全市场、价值最高的一句话",
  "reasonBrief": "解释整体市场状态的简短原因",
  "stories": [{
    "storyId": "story-1",
    "summary": "逐故事的一句话泡泡解读，保留关键数字",
    "uncertaintyText": "面向小白的一句话不确定性提醒",
    "simpleChain": ["小白因果步骤1", "小白因果步骤2"]
  }]
}`;

  const PROMPT_3_PROFESSIONAL_SYSTEM = `你是一名严谨的A股市场研究编辑。请把输入中已经完成的市场故事和因果链，整理成可供有一定投资经验的用户判断“逻辑是否成立”的专业表达。

重要边界：
1. P1和P2的结果是唯一分析基础；不得重新发现故事、改变storyId或编造输入之外的实时行情、资金、政策、公司数据。
2. 同一事件允许多因素共同驱动。drivers可包含primary（主驱动）、secondary（次驱动）和diffusion（扩散逻辑），但没有证据就不要凑齐三种。
3. conclusion说明事件结果、关键数字以及行情是普涨还是局部驱动；输入不能支持时明确写“暂无足够板块内部数据判断”。
4. supportingEvidence只写输入中已有的事实或来源；evidenceGaps写缺失的关键证据，例如成交额、资金流、上涨家数或政策确认。
5. alternativeExplanations写可能的替代解释；counterLogic写可能削弱当前逻辑的反向因素；observationIndicators写后续可观察的数据指标。它们用于验证逻辑，不是预测或交易建议。
6. 输入中的confidence.score、level和calculation是规则计算结果，必须原样返回；confidence.explanation用一句话解释分数由哪些证据和缺口构成。
7. 所有数组最多3项，每项不超过55字；专业但不堆砌术语。
8. 不输出买卖、仓位、目标价或收益建议。

严格只输出以下JSON：
{
  "stories": [{
    "storyId": "story-1",
    "conclusion": "事件结论",
    "drivers": [{
      "role": "primary|secondary|diffusion",
      "title": "驱动名称",
      "explanation": "驱动解释",
      "evidenceIds": ["source-id"]
    }],
    "supportingEvidence": ["支持证据"],
    "evidenceGaps": ["证据缺口"],
    "alternativeExplanations": ["替代解释"],
    "counterLogic": ["反向逻辑"],
    "observationIndicators": ["后续观察指标"],
    "confidence": {
      "score": 55,
      "level": "high|medium|limited",
      "explanation": "为何得到这一分数"
    }
  }]
}`;

  const PROMPT_5_SYSTEM = `你是“泡泡看市”的市场信号编辑。仅依据输入候选板块，选出今天最值得理解的变化；不是涨幅榜，不给买卖建议或预测。

评分：bubbleScore = anomaly(30)+health(25)+capitalAttention(20)+eventSupport(25)。只输出四项分数，服务端重算总分。
- anomaly：看涨跌幅、rank、change5d、change20d；趋势数据全缺时不高于20。
- health：看upStockRatio、sampleSize、leaderContribution、limitUpCount。多数共涨= broad_rise；少数龙头主导= leader_driven；其余= divergence。upStockRatio缺失时不高于10。
- capitalAttention：看turnoverChangePercent；未明显放量不高于8，缺失不高于6。
- eventSupport：只能引用relatedNews。政策、官方数据、公告、明确产业事件为高；普通新闻为中；没有相关新闻不高于7，且不得选event_driven。单一事件最高22；23至25必须有两个独立事件，媒体转载同一事件只算一件。

signalType 只能是 trend_start、trend_continue、leader_driven、event_driven、price_only。相同主题只留最强者，并在mergedSectors列出被合并的候选板块。sectorName必须原样使用输入名称。

最多输出4项，按分数从高到低。数字必须来自输入；不要输出metrics（服务端会补充真实指标）。每条最多2个supportingSignals和2个riskSignals，每条不超过20字；rankReason不超过24字；bubbleExplanation不超过45字。

严格只输出JSON：
{"bubbleSelection":[{"sectorName":"候选板块原名","scoreBreakdown":{"anomaly":24,"health":18,"capitalAttention":14,"eventSupport":5},"signalType":"trend_start","healthStatus":"broad_rise","rankReason":"简短入选理由","supportingSignals":["信号"],"riskSignals":["风险"],"evidenceIds":["news-id"],"mergedSectors":["候选板块名"],"bubbleExplanation":"简短解释","confidence":"high|medium|limited"}]}`;

  // P5 是固定评分与结构化整理，不需要长链推理；非思考模式能避免 reasoning 吞掉输出预算。
  const P5_MAX_TOKENS = 4_000;

  async function callAI(
    systemInstruction: string,
    userContent: string,
    temperature: number,
    maxTokens = 6_000,
    thinking: 'enabled' | 'disabled' = 'disabled',
  ): Promise<string> {
    const request: any = {
      model: AI_MODEL,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: userContent },
      ],
      temperature,
      max_tokens: maxTokens,
    };
    let completion: any;
    if (thinking === 'disabled') {
      // DeepSeek V4 需要显式关闭思考模式，否则结构化短输出可能只返回 reasoning。
      completion = await callDeepSeekCompat(request, true);
    } else {
      completion = await getAIClient().chat.completions.create(request);
    }
    const choice = completion.choices[0];
    const content = choice?.message?.content || '';
    // 空 content 时显式抛错。否则空串会流到 JSON.parse，上游只能看到
    // "Unexpected end of JSON input"，无法区分"模型没返回内容"和"返回了非法格式"。
    if (!content.trim()) {
      throw new Error(`AI returned empty content (finish_reason=${choice?.finish_reason})`);
    }
    return content;
  }

  function sanitizeTeacherText(value: unknown, maxLength: number): string {
    if (typeof value !== 'string') return '';
    const cleaned = value
      .replace(/```[\s\S]*?```/g, '')
      .replace(/^\s*(summaryText|dailySummary|reasonBrief)\s*[:：]\s*/i, '')
      .replace(/[{}\[\]`]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLength);
    if (/\b(const|let|var|function|return|import|export)\b|=>|<\/?[a-z][^>]*>/i.test(cleaned)) return '';
    return cleaned;
  }

  function fallbackDailySummary(marketData: Awaited<ReturnType<typeof fetchMarketData>>, stories: any[]): string {
    const indexChanges = marketData.indices.map((index: any) => Number(index.changePercent) || 0);
    const risingIndices = indexChanges.filter((change: number) => change > 0).length;
    const fallingIndices = indexChanges.filter((change: number) => change < 0).length;
    const sectorUp = marketData.sectors.filter((sector: any) => Number(sector.changePercent) > 0).length;
    const sectorDown = marketData.sectors.filter((sector: any) => Number(sector.changePercent) < 0).length;
    const focus = stories[0]?.title ? `，${stories[0].title}受到关注` : '';

    if (fallingIndices > risingIndices || sectorDown > sectorUp) {
      return `泡泡老师今天发现，市场整体偏谨慎${focus}。如果今天只记住一件事：先看清大盘情绪，再理解热点为什么出现。`;
    }
    if (risingIndices > fallingIndices || sectorUp > sectorDown) {
      return `泡泡老师今天发现，市场整体偏活跃${focus}。如果今天只记住一件事：热点上涨背后，仍要先看它是否有真实的市场依据。`;
    }
    return `泡泡老师今天发现，市场暂时没有形成一致方向${focus}。今天想先和你聊聊：看懂分化，比只看涨跌更重要。`;
  }

  type MarketStoryType = 'sector_driver' | 'price_anomaly' | 'company_event' | 'geo_event' | 'policy_driver' | 'macro_event';
  type ConfidenceLevel = 'high' | 'medium' | 'limited';
  type EvidenceStatus = 'confirmed' | 'related' | 'market_only';
  type MarketSource = {
    id: string;
    title: string;
    sourceName: string;
    publishedAt?: string;
    url?: string;
    kind: 'market_data' | 'news' | 'policy' | 'announcement';
  };
  type MarketStoryDraft = {
    storyId: string;
    type: MarketStoryType;
    title: string;
    what: string;
    metrics: Array<{ label: string; value: string }>;
    evidenceIds: string[];
    relatedSectors: string[];
    primaryCompany?: { name: string; symbol?: string };
    storyScore?: {
      total: number;
      importance: number;
      impactScope: number;
      infoIncrement: number;
      evidenceStrength: number;
    };
    selectionBasis?: {
      importance: 'high' | 'medium' | 'low';
      importanceReason: string;
      impactScope: '单板块' | '多板块联动' | '全市场' | '政策面' | '宏观';
      infoIncrement: string;
      evidenceStrength: 'strong' | 'medium' | 'weak';
    };
    storyQualityScore?: number;
    whySelected?: string;
  };
  type ReasoningStep = {
    id: string;
    text: string;
    evidenceIds: string[];
    kind: 'fact' | 'knowledge' | 'inference';
    stepType?: 'event' | 'market' | 'mechanism';
    relationshipConfidence?: 'strong' | 'medium' | 'weak';
  };
  type ReasoningChain = {
    storyId: string;
    steps: ReasoningStep[];
    facts: string[];
    changedVariables: string[];
    mechanism: string[];
    marketValidation: string[];
    observationIndicators: string[];
    uncertainty: string;
    confidenceLevel: ConfidenceLevel;
    validationStatus: 'passed' | 'limited' | 'rejected';
    beginnerSummary?: string;
    professionalSummary?: string;
    supportingEvidence?: string[];
    counterEvidence?: string[];
  };
  type TeacherStoryContent = {
    storyId: string;
    summary: string;
    uncertaintyText: string;
    simpleChain: string[];
  };
  type ProfessionalStoryContent = {
    storyId: string;
    conclusion: string;
    drivers: Array<{
      role: 'primary' | 'secondary' | 'diffusion';
      title: string;
      explanation: string;
      evidenceIds: string[];
    }>;
    supportingEvidence: string[];
    evidenceGaps: string[];
    alternativeExplanations: string[];
    counterLogic: string[];
    observationIndicators: string[];
    confidence: {
      score: number;
      level: ConfidenceLevel;
      explanation: string;
    };
  };
  type MarketSnapshot = {
    snapshotId: string;
    market: 'CN';
    marketDate: string;
    generatedAt: string;
    dataUpdatedAt: string;
    indices: any[];
    sectors: Array<{ id: string; code: string; name: string; changePercent: number }>;
    totalTurnoverAmount: number;
    marketBreadth: { up: number; down: number; flat: number; breadthRatio: number };
    marketStatus: ReturnType<typeof getMarketStatus>;
    sources: MarketSource[];
    missingData: string[];
  };
  type EventEvidencePack = {
    storyId: string;
    storyType: MarketStoryType;
    evidenceStatus: EvidenceStatus;
    marketContext: Pick<MarketSnapshot, 'marketDate' | 'indices' | 'totalTurnoverAmount' | 'marketBreadth'>;
    sectorValidation: Array<{
      sectorName: string;
      sectorCode: string;
      todayChangePercent: number;
      change5d: number | null;
      change20d: number | null;
      turnoverChangePercent: number | null;
      upStockRatio: number | null;
      sampleSize: number;
      limitUpCount: number | null;
      leaderContribution: number | null;
      dispersion: number | null;
      leaders: Array<{ code: string; name: string; changePercent: number }>;
      dataStatus: 'available' | 'partial' | 'unavailable';
    }>;
    companyValidation?: {
      status: 'matched' | 'not_matched' | 'unavailable';
      name?: string;
      symbol?: string;
      changePercent?: number;
      eventCount?: number;
      officialAnnouncements: MarketSource[];
      officialEventMatched?: boolean;
    };
    sources: MarketSource[];
    dataGaps: string[];
  };
  type ImpactAnalysis = {
    id: string;
    storyType: 'geopolitical_event' | 'commodity_anomaly' | 'sector_anomaly';
    reasoningMode: 'forward' | 'reverse_then_forward';
    title: string;
    trigger: any;
    summary: {
      eventFact: string;
      coreMechanism: string;
      keyImpacts: string[];
      conclusionLevel: 'confirmed' | 'high_probability' | 'possible' | 'unknown';
    };
    nodes: any[];
    edges: any[];
    evidence: any[];
    counterEvidence: any[];
    missingEvidence: string[];
    observationIndicators: string[];
    version: 'impact-path-v1';
  };

  function parseAIJson(raw: string): any {
    return JSON.parse(raw.replace(/```json\s*/gi, '').replace(/```/g, '').trim());
  }

  async function callAIWithParseRetry(
    systemInstruction: string,
    userContent: string,
    temperature: number,
    maxAttempts = 3,
    maxTokens = 6_000,
  ): Promise<any> {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const raw = await callAI(systemInstruction, userContent, temperature, maxTokens);
        if (!raw || !raw.trim()) {
          throw new Error('empty AI content');
        }
        return parseAIJson(raw);
      } catch (error: any) {
        lastError = error;
        if (attempt < maxAttempts) {
          console.error(`[callAI] attempt ${attempt}/${maxAttempts} failed (${error.message}), retrying...`);
        }
      }
    }
    throw lastError || new Error('callAI failed after retries');
  }

  function normalizeStories(rawStories: unknown, snapshot: MarketSnapshot): MarketStoryDraft[] {
    if (!Array.isArray(rawStories)) return [];
    const sourceIds = new Set(snapshot.sources.map((source) => source.id));
    const validTypes = new Set<MarketStoryType>([
      'sector_driver', 'price_anomaly', 'company_event', 'geo_event', 'policy_driver', 'macro_event',
    ]);
    const seenTitles = new Set<string>();
    const seenStoryIds = new Set<string>();
    const stories: MarketStoryDraft[] = [];

    const clampScore = (value: unknown, min = 0, max = 100) => {
      const num = Number(value);
      if (!Number.isFinite(num)) return min;
      return Math.min(max, Math.max(min, Math.round(num)));
    };
    const validImportance = new Set(['high', 'medium', 'low']);
    const validEvidenceStrength = new Set(['strong', 'medium', 'weak']);
    const validImpactScope = new Set(['单板块', '多板块联动', '全市场', '政策面', '宏观']);

    for (const raw of rawStories as any[]) {
      const title = String(raw?.title || '').trim().slice(0, 40);
      if (!title || seenTitles.has(title)) continue;
      const proposedId = String(raw?.storyId || `story-${stories.length + 1}`).trim();
      const storyId = proposedId && !seenStoryIds.has(proposedId) ? proposedId : `story-${stories.length + 1}`;
      seenTitles.add(title);
      seenStoryIds.add(storyId);

      const rawScore = raw?.storyScore;
      const importance = clampScore(rawScore?.importance);
      const impactScope = clampScore(rawScore?.impactScope, 0, 25);
      const infoIncrement = clampScore(rawScore?.infoIncrement, 0, 25);
      const evidenceStrength = clampScore(rawScore?.evidenceStrength, 0, 20);
      const hasScore =
        rawScore && (rawScore?.importance != null || rawScore?.impactScope != null
          || rawScore?.infoIncrement != null || rawScore?.evidenceStrength != null);
      // 不信任 AI 的 total 加总，服务端重算
      const storyScore = hasScore
        ? {
            importance,
            impactScope,
            infoIncrement,
            evidenceStrength,
            total: importance + impactScope + infoIncrement + evidenceStrength,
          }
        : undefined;

      const rawBasis = raw?.selectionBasis;
      const selectionBasis = rawBasis
        ? {
            importance: validImportance.has(rawBasis?.importance) ? rawBasis.importance : 'medium',
            importanceReason: String(rawBasis?.importanceReason || '').trim().slice(0, 100),
            impactScope: validImpactScope.has(rawBasis?.impactScope) ? rawBasis.impactScope : '单板块',
            infoIncrement: String(rawBasis?.infoIncrement || '').trim().slice(0, 120),
            evidenceStrength: validEvidenceStrength.has(rawBasis?.evidenceStrength)
              ? rawBasis.evidenceStrength
              : 'medium',
          }
        : undefined;

      const primaryCompanyName = String(raw?.primaryCompany?.name || '').trim().slice(0, 30);
      const primaryCompanySymbol = String(raw?.primaryCompany?.symbol || '').replace(/\D/g, '').slice(0, 6);
      const citedSourceTitles = (Array.isArray(raw?.evidenceIds) ? raw.evidenceIds : [])
        .map(String)
        .map((id: string) => snapshot.sources.find((source) => source.id === id)?.title || '');
      const primaryCompany = primaryCompanyName
        && citedSourceTitles.some((title: string) => title.includes(primaryCompanyName))
        ? { name: primaryCompanyName, ...(primaryCompanySymbol.length === 6 ? { symbol: primaryCompanySymbol } : {}) }
        : undefined;

      stories.push({
        storyId,
        type: validTypes.has(raw?.type) ? raw.type : 'sector_driver',
        title,
        what: String(raw?.what || '').trim().slice(0, 100),
        metrics: Array.isArray(raw?.metrics)
          ? raw.metrics.slice(0, 4).map((metric: any) => ({
              label: String(metric?.label || '关键数据').slice(0, 20),
              value: String(metric?.value || '').slice(0, 30),
            })).filter((metric: any) => metric.value)
          : [],
        evidenceIds: Array.isArray(raw?.evidenceIds)
          ? [...new Set<string>(raw.evidenceIds.map(String).filter((id: string) => sourceIds.has(id)))]
          : [],
        relatedSectors: Array.isArray(raw?.relatedSectors)
          ? [...new Set<string>(raw.relatedSectors.map(String))].slice(0, 8)
          : [],
        primaryCompany,
        storyScore,
        selectionBasis,
        storyQualityScore: raw?.storyQualityScore != null ? clampScore(raw?.storyQualityScore) : undefined,
        whySelected: String(raw?.whySelected || '').trim().slice(0, 50) || undefined,
      });
      if (stories.length === 3) break;
    }
    return stories;
  }

  function normalizeChains(rawChains: unknown, stories: MarketStoryDraft[], snapshot: MarketSnapshot): ReasoningChain[] {
    if (!Array.isArray(rawChains)) return [];
    const storyIds = new Set(stories.map((story) => story.storyId));
    const sourceIds = new Set(snapshot.sources.map((source) => source.id));
    const validConfidence = new Set<ConfidenceLevel>(['high', 'medium', 'limited']);
    const validKinds = new Set(['fact', 'knowledge', 'inference']);
    const validStepTypes = new Set(['event', 'market', 'mechanism']);
    const validRelationshipConfidence = new Set(['strong', 'medium', 'weak']);

    return (rawChains as any[])
      .filter((chain) => storyIds.has(String(chain?.storyId)))
      .map((chain) => {
        const steps: ReasoningStep[] = Array.isArray(chain?.steps)
          ? chain.steps.slice(0, 6).map((step: any, index: number) => ({
              id: String(step?.id || `step-${index + 1}`),
              text: String(step?.text || '').trim().slice(0, 120),
              evidenceIds: Array.isArray(step?.evidenceIds)
                ? [...new Set<string>(step.evidenceIds.map(String).filter((id: string) => sourceIds.has(id)))]
                : [],
              kind: (validKinds.has(step?.kind) ? step.kind : 'inference') as ReasoningStep['kind'],
              stepType: (validStepTypes.has(step?.stepType) ? step.stepType : undefined) as ReasoningStep['stepType'],
              relationshipConfidence: (validRelationshipConfidence.has(step?.relationshipConfidence)
                ? step.relationshipConfidence
                : undefined) as ReasoningStep['relationshipConfidence'],
            })).filter((step: ReasoningStep) => step.text)
          : [];
        const requestedConfidence: ConfidenceLevel = validConfidence.has(chain?.confidenceLevel)
          ? chain.confidenceLevel
          : 'limited';
        const hasUnverifiedFact = steps.some((step) => step.kind === 'fact' && step.evidenceIds.length === 0);
        const confidenceLevel: ConfidenceLevel = hasUnverifiedFact ? 'limited' : requestedConfidence;
        const citedFactTexts = steps
          .filter((step) => step.kind === 'fact' && step.evidenceIds.length > 0)
          .map((step) => step.text);
        const requestedFacts = normalizeTextList(chain?.facts, 3, 100);
        const facts = requestedFacts.filter((item) => citedFactTexts.some((fact) => fact.includes(item) || item.includes(fact)));
        return {
          storyId: String(chain.storyId),
          steps,
          facts: facts.length ? facts : citedFactTexts.slice(0, 3),
          changedVariables: normalizeTextList(chain?.changedVariables, 3, 100),
          mechanism: normalizeTextList(chain?.mechanism, 3, 100),
          marketValidation: normalizeTextList(chain?.marketValidation, 3, 100),
          observationIndicators: normalizeTextList(chain?.observationIndicators, 3, 80),
          uncertainty: String(chain?.uncertainty || '').trim().slice(0, 180),
          confidenceLevel,
          validationStatus: hasUnverifiedFact || confidenceLevel === 'limited' ? 'limited' : 'passed',
          beginnerSummary: String(chain?.beginnerSummary || '').trim().slice(0, 120) || undefined,
          professionalSummary: String(chain?.professionalSummary || '').trim().slice(0, 160) || undefined,
          supportingEvidence: Array.isArray(chain?.supportingEvidence)
            ? [...new Set((chain.supportingEvidence as any[]).map((item: unknown) => String(item).trim().slice(0, 80)))].filter(Boolean).slice(0, 3)
            : [],
          counterEvidence: Array.isArray(chain?.counterEvidence)
            ? [...new Set((chain.counterEvidence as any[]).map((item: unknown) => String(item).trim().slice(0, 80)))].filter(Boolean).slice(0, 3)
            : [],
        };
      });
  }

  function defaultReasoning(story: MarketStoryDraft): ReasoningChain {
    const metricText = story.metrics.map((metric) => `${metric.label}${metric.value}`).join('，');
    return {
      storyId: story.storyId,
      steps: ([
        { id: 'step-1', text: story.what, evidenceIds: story.evidenceIds, kind: 'fact' },
        { id: 'step-2', text: metricText || '行情数据确认了该市场变化', evidenceIds: story.evidenceIds, kind: 'fact' },
      ] as ReasoningStep[]).filter((step) => step.text),
      facts: [story.what].filter(Boolean),
      changedVariables: metricText ? [metricText] : [],
      mechanism: [],
      marketValidation: metricText ? [metricText] : [],
      observationIndicators: story.relatedSectors.map((sector) => `${sector}板块量价与广度`).slice(0, 3),
      uncertainty: '当前只确认了市场表现，具体驱动原因仍需更多可信信息验证。',
      confidenceLevel: 'limited',
      validationStatus: 'limited',
    };
  }

  function defaultTeacherContent(story: MarketStoryDraft, chain: ReasoningChain): TeacherStoryContent {
    const metricText = story.metrics.map((metric) => `${metric.label}${metric.value}`).join('，');
    return {
      storyId: story.storyId,
      summary: `${story.what}${metricText && !story.what.includes(metricText) ? ` 关键数据是${metricText}。` : ''}`.slice(0, 160),
      uncertaintyText: chain.uncertainty,
      simpleChain: chain.steps.slice(0, 3).map((step) => step.text),
    };
  }

  function calculateEvidenceConfidence(chain: ReasoningChain, evidenceSourceCount: number) {
    const factSteps = chain.steps.filter((step) => step.kind === 'fact');
    const citedFacts = factSteps.filter((step) => step.evidenceIds.length > 0);
    const inferenceSteps = chain.steps.filter((step) => step.kind === 'inference').length;
    const citedFactScore = Math.min(24, citedFacts.length * 12);
    const sourceScore = Math.min(24, evidenceSourceCount * 12);
    const chainScore = chain.steps.length >= 2 ? 12 : 4;
    const knowledgeScore = chain.steps.some((step) => step.kind === 'knowledge') ? 6 : 0;
    const inferencePenalty = Math.min(24, inferenceSteps * 8);
    const uncertaintyPenalty = chain.uncertainty ? 10 : 0;
    let score = 15 + citedFactScore + sourceScore + chainScore + knowledgeScore - inferencePenalty - uncertaintyPenalty;
    const levelCap = chain.confidenceLevel === 'high' ? 95 : chain.confidenceLevel === 'medium' ? 74 : 49;
    score = Math.round(Math.min(levelCap, Math.max(20, score)));
    const level: ConfidenceLevel = score >= 75 ? 'high' : score >= 50 ? 'medium' : 'limited';
    return {
      score,
      level,
      calculation: `引用事实${citedFacts.length}步、来源机构${evidenceSourceCount}家、推断${inferenceSteps}步${chain.uncertainty ? '，并存在未确认项' : ''}`,
    };
  }

  function normalizeTextList(value: unknown, maxItems = 3, maxLength = 80): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => sanitizeTeacherText(item, maxLength))
      .filter(Boolean)
      .slice(0, maxItems);
  }

  function impactSkillProfile(story: MarketStoryDraft) {
    if (story.type === 'geo_event') return {
      storyType: 'geopolitical_event' as const,
      reasoningMode: 'forward' as const,
      checklist: ['供应是否受扰', '运输与航线风险', '避险需求', '通胀/利率/汇率反向因素'],
    };
    if (story.type === 'price_anomaly') return {
      storyType: 'commodity_anomaly' as const,
      reasoningMode: 'reverse_then_forward' as const,
      checklist: ['供给、需求、库存或汇率原因', '上游利润', '中下游成本转嫁', '替代关系与反向因素'],
    };
    return {
      storyType: 'sector_anomaly' as const,
      reasoningMode: 'reverse_then_forward' as const,
      checklist: ['上涨是否扩散', '龙头贡献与成交变化', '候选事件/产业变量', '产业链影响或仅情绪映射'],
    };
  }

  function buildImpactSkillInputs(
    stories: MarketStoryDraft[],
    evidencePacks: EventEvidencePack[],
  ) {
    const packByStory = new Map(evidencePacks.map((pack) => [pack.storyId, pack]));
    return stories.map((story) => ({
      storyId: story.storyId,
      title: story.title,
      type: story.type,
      facts: story.what,
      relatedSectors: story.relatedSectors,
      skillProfile: impactSkillProfile(story),
      evidencePack: packByStory.get(story.storyId),
    }));
  }

  function normalizeImpactAnalyses(
    rawAnalyses: unknown,
    stories: MarketStoryDraft[],
    snapshot: MarketSnapshot,
    evidencePacks: EventEvidencePack[],
  ): Map<string, ImpactAnalysis> {
    if (!Array.isArray(rawAnalyses)) return new Map();
    const storyById = new Map(stories.map((story) => [story.storyId, story]));
    const packByStory = new Map(evidencePacks.map((pack) => [pack.storyId, pack]));
    const sourceById = new Map([
      ...snapshot.sources,
      ...evidencePacks.flatMap((pack) => pack.sources),
    ].map((source) => [source.id, source]));
    const allowedTypes = new Set(['candidate_cause', 'changed_variable', 'mechanism', 'commodity', 'sector', 'company', 'market_validation', 'counter_factor']);
    const allowedKnowledge = new Set(['fact', 'theory', 'inference', 'hypothesis']);
    const allowedDirections = new Set(['positive', 'negative', 'mixed', 'uncertain']);
    const allowedRelations = new Set(['causes', 'raises', 'reduces', 'supports', 'pressures', 'offsets', 'may_lead_to']);
    const allowedHorizon = new Set(['immediate', 'short_term', 'medium_term']);
    const allowedLevels = new Set(['confirmed', 'high_probability', 'possible', 'unknown']);
    const results = new Map<string, ImpactAnalysis>();

    for (const raw of rawAnalyses as any[]) {
      const storyId = String(raw?.storyId || '');
      const story = storyById.get(storyId);
      if (!story || results.has(storyId)) continue;
      const pack = packByStory.get(storyId);
      const profile = impactSkillProfile(story);
      const trigger = {
        id: 'trigger', type: 'event', title: story.title, explanation: story.what,
        knowledgeType: 'fact', confidence: 0,
        evidenceIds: story.evidenceIds.filter((id) => sourceById.has(id)),
      };
      const seen = new Set([trigger.id]);
      const nodes = [trigger, ...(Array.isArray(raw?.nodes) ? raw.nodes : []).slice(0, 17).flatMap((item: any, index: number) => {
        const id = String(item?.id || `node-${index + 1}`).trim().slice(0, 40);
        const title = sanitizeTeacherText(item?.title, 90);
        if (!id || seen.has(id) || !title || !allowedTypes.has(item?.type)) return [];
        seen.add(id);
        const evidenceIds = Array.isArray(item?.evidenceIds)
          ? [...new Set(item.evidenceIds.map(String).filter((id: string) => sourceById.has(id)))].slice(0, 5)
          : [];
        let knowledgeType = allowedKnowledge.has(item?.knowledgeType) ? item.knowledgeType : 'hypothesis';
        if (knowledgeType === 'fact' && !evidenceIds.length) knowledgeType = 'hypothesis';
        if (pack?.evidenceStatus === 'market_only' && ['candidate_cause', 'mechanism'].includes(item?.type) && knowledgeType === 'inference') knowledgeType = 'hypothesis';
        return [{
          id, type: item.type, title,
          explanation: sanitizeTeacherText(item?.explanation, 150) || '需要进一步核验的影响节点。',
          knowledgeType,
          direction: allowedDirections.has(item?.direction) ? item.direction : 'uncertain',
          confidence: Math.max(0, Math.min(100, Number(item?.confidence) || 0)) || undefined,
          evidenceIds,
        }];
      })];
      const nodeIds = new Set(nodes.map((node) => node.id));
      const edges = (Array.isArray(raw?.edges) ? raw.edges : []).slice(0, 20).flatMap((item: any) => {
        const from = String(item?.from || ''); const to = String(item?.to || '');
        if (!nodeIds.has(from) || !nodeIds.has(to) || from === to || !allowedRelations.has(item?.relation)) return [];
        return [{
          from, to, relation: item.relation,
          explanation: sanitizeTeacherText(item?.explanation, 120) || '可能存在的传导关系。',
          timeHorizon: allowedHorizon.has(item?.timeHorizon) ? item.timeHorizon : 'short_term',
          condition: sanitizeTeacherText(item?.condition, 100) || undefined,
        }];
      });
      // 模型偶尔只返回“候选原因 → 行情验证”，会让 trigger 在图上断开。
      // 对反向归因故事，这条边表示“从异动出发检索原因”，不是把行情倒写成原因。
      const inbound = new Set(edges.map((edge) => edge.to));
      nodes.filter((node) => node.id !== trigger.id && !inbound.has(node.id)).forEach((node) => {
        if (edges.length >= 20) return;
        edges.push({
          from: trigger.id,
          to: node.id,
          relation: 'may_lead_to',
          explanation: profile.reasoningMode === 'reverse_then_forward'
            ? '从已发生的异动出发，检索该候选驱动；这不是已确认的因果方向。'
            : '该事件可能通过此节点产生影响，仍需结合证据核验。',
          timeHorizon: 'short_term',
        });
      });
      if (!edges.length || nodes.length < 2) continue;
      const rawLevel = allowedLevels.has(raw?.summary?.conclusionLevel) ? raw.summary.conclusionLevel : 'unknown';
      const conclusionLevel = pack?.evidenceStatus === 'market_only'
        ? 'unknown'
        : pack?.evidenceStatus === 'related' && ['confirmed', 'high_probability'].includes(rawLevel)
          ? 'possible'
          : rawLevel;
      const usedEvidenceIds = new Set(nodes.flatMap((node) => node.evidenceIds || []));
      const evidence = [...usedEvidenceIds].map((id) => sourceById.get(id)).filter(Boolean).map((source: any) => ({
        id: source.id,
        category: source.kind === 'announcement' ? 'official_announcement' : source.kind === 'market_data' ? 'market' : source.kind === 'policy' ? 'macro' : 'news',
        statement: source.title, sourceName: source.sourceName, sourceUrl: source.url, publishedAt: source.publishedAt,
        role: 'supports', reliability: source.kind === 'announcement' || source.kind === 'policy' ? 'primary' : source.kind === 'market_data' ? 'authoritative' : 'secondary',
      }));
      const counterEvidence = (Array.isArray(raw?.counterEvidence) ? raw.counterEvidence : []).slice(0, 3).flatMap((item: any) => {
        const statement = sanitizeTeacherText(item?.statement, 120);
        const evidenceIds = Array.isArray(item?.evidenceIds) ? item.evidenceIds.map(String).filter((id: string) => sourceById.has(id)) : [];
        if (!statement || !evidenceIds.length) return [];
        const source = sourceById.get(evidenceIds[0])!;
        return [{ id: source.id, category: source.kind === 'market_data' ? 'market' : 'news', statement, sourceName: source.sourceName, sourceUrl: source.url, publishedAt: source.publishedAt, role: 'contradicts', reliability: source.kind === 'market_data' ? 'authoritative' : 'secondary' }];
      });
      const missingEvidence = [...new Set([
        ...normalizeTextList(raw?.missingEvidence, 4, 110),
        ...(pack?.dataGaps || []),
      ])].slice(0, 4);
      if (!counterEvidence.length && !missingEvidence.length) missingEvidence.push('尚需核验关键变量是否按该路径变化。');
      results.set(storyId, {
        id: `impact-${storyId}`, storyType: profile.storyType, reasoningMode: profile.reasoningMode,
        title: story.title, trigger,
        summary: {
          eventFact: sanitizeTeacherText(raw?.summary?.eventFact, 140) || story.what,
          coreMechanism: sanitizeTeacherText(raw?.summary?.coreMechanism, 140) || '驱动关系仍待核验。',
          keyImpacts: normalizeTextList(raw?.summary?.keyImpacts, 4, 60),
          conclusionLevel,
        },
        nodes, edges, evidence, counterEvidence, missingEvidence,
        observationIndicators: normalizeTextList(raw?.observationIndicators, 4, 90),
        version: 'impact-path-v1',
      });
    }
    return results;
  }

  function defaultProfessionalContent(
    story: MarketStoryDraft,
    chain: ReasoningChain,
    confidence: ReturnType<typeof calculateEvidenceConfidence>,
  ): ProfessionalStoryContent {
    const facts = chain.steps.filter((step) => step.kind === 'fact').map((step) => step.text).slice(0, 3);
    return {
      storyId: story.storyId,
      conclusion: story.what,
      drivers: chain.steps
        .filter((step) => step.kind !== 'fact')
        .slice(0, 3)
        .map((step, index) => ({
          role: index === 0 ? 'primary' : 'secondary',
          title: index === 0 ? '核心驱动' : '补充驱动',
          explanation: step.text,
          evidenceIds: step.evidenceIds,
        })),
      supportingEvidence: facts,
      evidenceGaps: chain.uncertainty ? [chain.uncertainty] : [],
      alternativeExplanations: [],
      counterLogic: [],
      observationIndicators: story.relatedSectors.map((sector) => `${sector}板块量价与广度`).slice(0, 3),
      confidence: {
        score: confidence.score,
        level: confidence.level,
        explanation: confidence.calculation,
      },
    };
  }

  function httpGetJSON(urlStr: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const u = new URL(urlStr);
      const mod = u.protocol === 'http:' ? http : https;
      const req = mod.get(
        {
          hostname: u.hostname,
          family: 4,
          path: u.pathname + u.search,
          headers: { 'User-Agent': 'Mozilla/5.0' },
        },
        (res: any) => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => (data += chunk));
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`HTTP ${res.statusCode}`));
              return;
            }
            try {
              resolve(JSON.parse(data));
            } catch {
              reject(new Error('JSON parse failed'));
            }
          });
        },
      );
      req.on('error', reject);
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('Timeout'));
      });
    });
  }

  function httpGetText(urlStr: string, referer = 'https://gu.qq.com/', encoding = 'utf-8'): Promise<string> {
    return new Promise((resolve, reject) => {
      const u = new URL(urlStr);
      const mod = u.protocol === 'http:' ? http : https;
      const req = mod.get(
        {
          hostname: u.hostname,
          path: u.pathname + u.search,
          headers: {
            'User-Agent': 'Mozilla/5.0',
            Referer: referer,
          },
        },
        (res: any) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`HTTP ${res.statusCode}`));
              return;
            }
            resolve(new TextDecoder(encoding).decode(Buffer.concat(chunks)));
          });
        },
      );
      req.on('error', reject);
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('Timeout'));
      });
    });
  }

  async function fetchMarketDataInner() {
    const WSCN_NEWS = 'https://api-one.wallstcn.com/apiv1/content/lives?channel=global-channel&limit=10';

    // A股指数：改用东方财富API（中国大陆可用，免Key）
    const indexDefs = [
      { secid: '1.000001', name: '上证指数', code: '000001' },
      { secid: '0.399001', name: '深证成指', code: '399001' },
      { secid: '0.399006', name: '创业板指', code: '399006' },
    ];

    // 指数与板块的数据语义不同：指数走多源回退，板块全量数据暂保持独立来源。
    async function fetchTencentIndices() {
      const definitions = [
        { symbol: 's_sh000001', name: '上证指数', code: '000001' },
        { symbol: 's_sz399001', name: '深证成指', code: '399001' },
        { symbol: 's_sz399006', name: '创业板指', code: '399006' },
      ];
      const text = await httpGetText(
        `https://qt.gtimg.cn/q=${definitions.map((item) => item.symbol).join(',')}`,
        'https://gu.qq.com/',
        'gb18030',
      );

      return definitions.map((definition) => {
        const matched = text.match(new RegExp(`v_${definition.symbol}="([^"]*)"`));
        const fields = matched?.[1]?.split('~') || [];
        const price = Number(fields[3]);
        const changePercent = Number(fields[5]);
        if (!Number.isFinite(price) || !Number.isFinite(changePercent)) return null;
        return {
          name: definition.name,
          code: definition.code,
          price: Math.round(price * 100) / 100,
          changePercent: Math.round(changePercent * 100) / 100,
          volume: Number(fields[6]) || 0,
          amount: Number(fields[7]) || 0,
          high: null,
          low: null,
          previousClose: null,
        };
      }).filter(Boolean);
    }

    async function fetchSinaIndices() {
      const definitions = [
        { symbol: 's_sh000001', name: '上证指数', code: '000001' },
        { symbol: 's_sz399001', name: '深证成指', code: '399001' },
        { symbol: 's_sz399006', name: '创业板指', code: '399006' },
      ];
      const text = await httpGetText(
        `https://hq.sinajs.cn/list=${definitions.map((item) => item.symbol).join(',')}`,
        'https://finance.sina.com.cn/',
        'gb18030',
      );
      return definitions.map((definition) => {
        const matched = text.match(new RegExp(`hq_str_${definition.symbol}="([^"]*)"`));
        const fields = matched?.[1]?.split(',') || [];
        const price = Number(fields[1]);
        const changePercent = Number(fields[3]);
        if (!Number.isFinite(price) || !Number.isFinite(changePercent)) return null;
        return {
          name: definition.name,
          code: definition.code,
          price: Math.round(price * 100) / 100,
          changePercent: Math.round(changePercent * 100) / 100,
          volume: Number(fields[4]) || 0,
          amount: Number(fields[5]) || 0,
          high: null,
          low: null,
          previousClose: null,
        };
      }).filter(Boolean);
    }

    async function fetchXueqiuIndices() {
      const definitions = [
        { symbol: 'SH000001', name: '上证指数', code: '000001' },
        { symbol: 'SZ399001', name: '深证成指', code: '399001' },
        { symbol: 'SZ399006', name: '创业板指', code: '399006' },
      ];
      const data = await httpGetJSON(`https://stock.xueqiu.com/v5/stock/realtime/quotec.json?symbol=${definitions.map((item) => item.symbol).join(',')}`);
      const quotes = Array.isArray(data?.data) ? data.data : [];
      return definitions.map((definition) => {
        const quote = quotes.find((item: any) => item.symbol === definition.symbol);
        const price = Number(quote?.current);
        const changePercent = Number(quote?.percent);
        if (!Number.isFinite(price) || !Number.isFinite(changePercent)) return null;
        return {
          name: definition.name,
          code: definition.code,
          price: Math.round(price * 100) / 100,
          changePercent: Math.round(changePercent * 100) / 100,
          volume: Number(quote?.volume) || 0,
          amount: Number(quote?.amount) || 0,
          high: Number.isFinite(Number(quote?.high)) ? Number(quote.high) : null,
          low: Number.isFinite(Number(quote?.low)) ? Number(quote.low) : null,
          previousClose: Number.isFinite(Number(quote?.last_close)) ? Number(quote.last_close) : null,
        };
      }).filter(Boolean);
    }

    async function fetchAshareIndicesWithFallback() {
      const sharedState = fetchMarketData as any;
      const providers = [
        { source: 'tencent', fetcher: fetchTencentIndices },
        { source: 'sina', fetcher: fetchSinaIndices },
        { source: 'xueqiu', fetcher: fetchXueqiuIndices },
      ];
      for (let index = 0; index < providers.length; index += 1) {
        const provider = providers[index];
        try {
          const indices = await provider.fetcher();
          if (indices.length === indexDefs.length) {
            const result = {
              indices,
              sourceMeta: { source: provider.source, fetchedAt: new Date().toISOString(), freshness: 'realtime', confidence: 'market', fallbackLevel: index },
            };
            sharedState._indexSnapshot = result;
            return result;
          }
          throw new Error(`incomplete indices: ${indices.length}/${indexDefs.length}`);
        } catch (error: any) {
          console.warn(`[market-source] ${provider.source} indices failed:`, error.message);
        }
      }
      const stale = sharedState._indexSnapshot;
      if (stale?.indices?.length) {
        return {
          indices: stale.indices,
          sourceMeta: { ...stale.sourceMeta, source: 'cache', fetchedAt: new Date().toISOString(), freshness: 'stale', confidence: 'limited', fallbackLevel: 3, asOf: stale.sourceMeta.fetchedAt },
        };
      }
      return { indices: [], sourceMeta: { source: 'cache', fetchedAt: new Date().toISOString(), freshness: 'stale', confidence: 'limited', fallbackLevel: 3 } };
    }

    async function fetchSectors(): Promise<any[]> {
      const EM_HOSTS = [
        'push2delay.eastmoney.com',
        'push2.eastmoney.com',
        '59.push2.eastmoney.com',
        '70.push2.eastmoney.com',
        '82.push2.eastmoney.com',
        'push2his.eastmoney.com',
      ];
      // 拉取全部板块（地域 m:90 t:1 + 行业 m:90 t:2 + 概念 m:90 t:3）。
      // 关键：东方财富单页最多返回 100 条（pz 即使设为 500 也会被截断为 100），
      // 因此必须按 total 翻页把所有板块都取回来，否则行业(496)/概念(503)板块会被各自截成 100 个，
      // 市场广度也会因此系统性失真（之前只拿到 ~231 个）。
      const BOARD_QUERIES = ['m:90+t:1', 'm:90+t:2', 'm:90+t:3'];
      const PAGE_SIZE = 100;
      const buildPath = (fs: string, page: number) =>
        `/api/qt/clist/get?pn=${page}&pz=${PAGE_SIZE}&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${fs}&fields=f2,f3,f4,f12,f14`;

      // 拉取单个板块分类的全部分页（按 total 翻页，pz=100）
      async function fetchBoardTier(host: string, fs: string): Promise<any[]> {
        const first = await httpGetJSON(`http://${host}${buildPath(fs, 1)}`);
        const total = Number(first?.data?.total || 0);
        const diffs: any[] = [...(first?.data?.diff || [])];
        const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
        if (pages > 1) {
          const rest = await Promise.all(
            Array.from({ length: pages - 1 }, (_, i) =>
              httpGetJSON(`http://${host}${buildPath(fs, i + 2)}`).catch(() => null)),
          );
          for (const r of rest) {
            if (r?.data?.diff) diffs.push(...r.data.diff);
          }
        }
        const out: any[] = [];
        const seen = new Set<string>();
        for (const d of diffs) {
          const code = d?.f12;
          if (!code || seen.has(code)) continue;
          seen.add(code);
          const name = d.f14;
          const change = Number(d.f3);
          if (name && Number.isFinite(change)) {
            out.push({ name, code, changePercent: Math.round(change * 100) / 100 });
          }
        }
        return out;
      }

      // 注意：东方财富HTTPS在此环境下会ECONNRESET，必须使用HTTP；逐 host 容错
      for (const host of EM_HOSTS) {
        try {
          const tiers = await Promise.all(BOARD_QUERIES.map((fs) => fetchBoardTier(host, fs)));
          const seen = new Set<string>();
          const merged: any[] = [];
          for (const tier of tiers) {
            for (const s of tier) {
              if (seen.has(s.code)) continue;
              seen.add(s.code);
              merged.push(s);
            }
          }
          if (merged.length > 0) {
            return merged.sort((a: any, b: any) => b.changePercent - a.changePercent);
          }
        } catch {
          // try next host
        }
      }
      console.warn('[fetchMarketData] all EastMoney hosts unreachable, sectors unavailable');
      return [];
    }

    let marketPulseCache = (fetchMarketData as any)._pulseCache as
      | { expiresAt: number; value: any }
      | undefined;

    async function loadMarketPulse() {
      if (marketPulseCache && marketPulseCache.expiresAt > Date.now()) {
        return marketPulseCache.value;
      }

      const EM_HOSTS = [
        'push2delay.eastmoney.com',
        'push2.eastmoney.com',
        '59.push2.eastmoney.com',
        '70.push2.eastmoney.com',
        '82.push2.eastmoney.com',
      ];
      const PAGE_SIZE = 100;
      const buildPath = (page: number) =>
        `/api/qt/clist/get?pn=${page}&pz=${PAGE_SIZE}&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23&fields=f2,f3,f6,f12,f14,f100`;

      for (const host of EM_HOSTS) {
        try {
          const firstPage = await httpGetJSON(`http://${host}${buildPath(1)}`);
          const total = Number(firstPage?.data?.total || 0);
          const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
          const allRows = [...(firstPage?.data?.diff || [])];

          // 东方财富单次最多返回100条，分批拉取完整A股样本，避免只统计涨幅榜前100名。
          for (let startPage = 2; startPage <= pageCount; startPage += 8) {
            const pages = Array.from(
              { length: Math.min(8, pageCount - startPage + 1) },
              (_, index) => startPage + index,
            );
            const results = await Promise.all(
              pages.map((page) => httpGetJSON(`http://${host}${buildPath(page)}`)),
            );
            results.forEach((result) => allRows.push(...(result?.data?.diff || [])));
          }

          const stocks = [...new Map(
            allRows
              .filter((item: any) => item?.f12 && Number.isFinite(Number(item?.f3)))
              .map((item: any) => [String(item.f12), item]),
          ).values()] as any[];
          const validStocks = stocks.filter((item: any) =>
            item?.f12 && Number.isFinite(Number(item?.f3))
          );
          let limitUp = 0;
          let limitDown = 0;
          let turnoverAmount = 0;
          const industries = new Map<string, { totalChange: number; count: number }>();

          validStocks.forEach((item: any) => {
            const code = String(item.f12);
            const name = String(item.f14 || '');
            const change = Number(item.f3);
            const amount = Number(item.f6);
            if (Number.isFinite(amount) && amount > 0) turnoverAmount += amount;
            const industry = String(item.f100 || '').trim();
            if (industry && industry !== '-') {
              const current = industries.get(industry) || { totalChange: 0, count: 0 };
              current.totalChange += change;
              current.count += 1;
              industries.set(industry, current);
            }

            const threshold = /ST/i.test(name)
              ? 4.8
              : /^(300|301|688|689)/.test(code)
                ? 19.5
                : /^(4|8)/.test(code)
                  ? 29.5
                  : 9.8;
            if (change >= threshold) limitUp += 1;
            if (change <= -threshold) limitDown += 1;
          });

          const value = {
            available: validStocks.length > 0,
            stockCount: validStocks.length,
            limitUp,
            limitDown,
            turnoverAmount,
            sectors: [...industries.entries()]
              .map(([name, value]) => ({
                name,
                changePercent: Math.round((value.totalChange / value.count) * 100) / 100,
              }))
              .sort((a, b) => b.changePercent - a.changePercent),
          };
          marketPulseCache = { expiresAt: Date.now() + 60_000, value };
          (fetchMarketData as any)._pulseCache = marketPulseCache;
          return value;
        } catch {
          // try next host
        }
      }

      console.warn('[fetchMarketData] A-share pulse unavailable');
      return {
        available: false,
        stockCount: 0,
        limitUp: 0,
        limitDown: 0,
        turnoverAmount: 0,
        sectors: [],
      };
    }

    async function fetchMarketPulse() {
      const sharedState = fetchMarketData as any;
      const cached = sharedState._pulseCache as { expiresAt: number; value: any } | undefined;
      if (cached && cached.expiresAt > Date.now()) return cached.value;
      if (sharedState._pulsePromise) return sharedState._pulsePromise;

      const pulsePromise = loadMarketPulse();
      sharedState._pulsePromise = pulsePromise;
      try {
        const value = await pulsePromise;
        if (value.available) {
          const cache = { expiresAt: Date.now() + 60_000, value };
          sharedState._pulseCache = cache;
          marketPulseCache = cache;
        }
        return value;
      } finally {
        sharedState._pulsePromise = null;
      }
    }

    const [sectors, marketPulse, newsResult, indexResult] = await Promise.all([
      fetchSectors(),
      fetchMarketPulse(),
      httpGetJSON(WSCN_NEWS).catch((e: any) => {
        console.error('[fetchMarketData] WallStreetCN news failed:', e.message);
        return null;
      }),
      fetchAshareIndicesWithFallback(),
    ]);
    const indices = indexResult.indices;

    const newsItems = (newsResult?.data?.items || [])
      .map((item: any, index: number) => {
        const text = (item.content || '').replace(/<[^>]*>/g, '').trim();
        const first = text.split(/[。！？\n]/)[0];
        const title = first || text.substring(0, 50);
        const rawUrl = String(item.uri || item.url || '');
        return {
          id: `news-${item.id || index + 1}`,
          title,
          sourceName: '华尔街见闻',
          publishedAt: item.display_time ? new Date(Number(item.display_time) * 1000).toISOString() : undefined,
          url: /^https?:\/\//.test(rawUrl) ? rawUrl : undefined,
          kind: 'news' as const,
        };
      })
      .filter((item: any) => item.title.length > 0)
      .slice(0, 10);
    const newsHeadlines: string[] = newsItems.map((item: any) => item.title);

    const volume = indices.reduce((sum: number, i: any) => sum + (i.volume || 0), 0);

    // 板块广度优先使用完整的板块列表（行业+概念+地域全量），缺失时回退到市场脉搏聚合
    const breadthSectors = sectors.length > 0 ? sectors : marketPulse.sectors;

    return {
      indices: indices.length > 0 ? indices : [],
      sectors: breadthSectors,
      announcements: [],
      newsHeadlines: newsHeadlines.length > 0 ? newsHeadlines : ['今日财经快讯获取中，请稍后刷新'],
      newsItems,
      volume,
      marketPulse,
      sourceMeta: { indices: indexResult.sourceMeta },
      timestamp: new Date(),
    };
  }

  // fetchMarketData 整体缓存 + in-flight 去重：
  // 多个接口（sectors/overview/morning-report/sector-detail）共享同一份行情数据，
  // 避免每次请求都重复全量拉取指数、板块和新闻。
  async function fetchMarketData(force = false) {
    const cacheState = fetchMarketData as any;
    const now = Date.now();
    if (!force && cacheState._dataCache && cacheState._dataCache.expiresAt > now) {
      return cacheState._dataCache.value;
    }
    if (!force && cacheState._dataPromise) return cacheState._dataPromise;

    const dataPromise = fetchMarketDataInner().then((value) => {
      cacheState._dataCache = { expiresAt: Date.now() + 15_000, value };
      return value;
    });
    cacheState._dataPromise = dataPromise;
    try {
      return await dataPromise;
    } finally {
      cacheState._dataPromise = null;
    }
  }

  function buildMarketSnapshot(marketData: Awaited<ReturnType<typeof fetchMarketData>>): MarketSnapshot {
    const timestamp = marketData.timestamp instanceof Date ? marketData.timestamp : new Date(marketData.timestamp);
    const date = timestamp.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
    const marketSource: MarketSource = {
      id: `market-data-${date}`,
      title: `${date} A股指数与行业板块行情`,
      sourceName: '东方财富',
      publishedAt: timestamp.toISOString(),
      kind: 'market_data',
    };
    // 使用全量板块数据（marketPulse.sectors）计算广度，避免fetchSectors降序取前500名的偏差
    const breadthSectors = marketData.marketPulse?.sectors?.length ? marketData.marketPulse.sectors : marketData.sectors;
    const up = breadthSectors.filter((sector: any) => Number(sector.changePercent) > 0).length;
    const down = breadthSectors.filter((sector: any) => Number(sector.changePercent) < 0).length;
    const flat = Math.max(0, marketData.sectors.length - up - down);
    const missingData: string[] = [];
    if (!marketData.newsItems?.length) missingData.push('news');
    if (!marketData.marketPulse.turnoverAmount) missingData.push('turnover');
    if (!marketData.sectors.length) missingData.push('sectors');

    return {
      snapshotId: `cn-${date}-${timestamp.getTime()}`,
      market: 'CN',
      marketDate: date,
      generatedAt: new Date().toISOString(),
      dataUpdatedAt: timestamp.toISOString(),
      indices: marketData.indices.map((index: any) => ({
        name: index.name,
        code: index.code,
        price: index.price,
        changePercent: index.changePercent,
        volume: index.volume || 0,
        turnoverAmount: index.amount || 0,
      })),
      sectors: marketData.sectors.map((sector: any, index: number) => ({
        id: `sector-${index + 1}`,
        code: String(sector.code || ''),
        name: sector.name,
        changePercent: Number(sector.changePercent) || 0,
      })),
      totalTurnoverAmount: Number(marketData.marketPulse.turnoverAmount || 0),
      marketBreadth: {
        up,
        down,
        flat,
        breadthRatio: marketData.sectors.length ? Math.round((up / marketData.sectors.length) * 100) : 50,
      },
      marketStatus: getMarketStatus(),
      sources: [marketSource, ...(marketData.newsItems || [])],
      missingData,
    };
  }

  function fallbackStories(snapshot: MarketSnapshot): MarketStoryDraft[] {
    const sourceId = snapshot.sources[0]?.id || '';
    return [...snapshot.sectors]
      .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))
      .slice(0, Math.min(3, snapshot.sectors.length))
      .map((sector, index) => ({
        storyId: `fallback-${index + 1}`,
        type: 'sector_driver',
        title: `${sector.name}板块波动明显`,
        what: `${sector.name}板块今日${sector.changePercent >= 0 ? '上涨' : '下跌'}${Math.abs(sector.changePercent).toFixed(2)}%。`,
        metrics: [{ label: '板块涨跌', value: `${sector.changePercent >= 0 ? '+' : ''}${sector.changePercent.toFixed(2)}%` }],
        evidenceIds: sourceId ? [sourceId] : [],
        relatedSectors: [sector.name],
      }));
  }

  /**
   * v1 过渡输出：只重组既有 P2 结果，不补造原因或行业受益关系。
   * 三类专用 Skill 上线后会替换这里的 nodes/edges 生成器，API 协议保持不变。
   */
  function buildFallbackImpactAnalysis(
    story: MarketStoryDraft,
    reasoning: ReasoningChain,
    evidence: MarketSource[],
    evidencePack?: EventEvidencePack,
  ): ImpactAnalysis {
    const confidence = reasoning.confidenceLevel === 'high' ? 85 : reasoning.confidenceLevel === 'medium' ? 65 : 35;
    const trigger = {
      id: 'trigger', type: 'event', title: story.title, explanation: story.what,
      knowledgeType: 'fact', confidence, evidenceIds: story.evidenceIds,
    };
    const nodes: any[] = [trigger];
    const edges: any[] = [];
    let previousId = trigger.id;
    const append = (node: any, relation: string) => {
      nodes.push(node);
      edges.push({ from: previousId, to: node.id, relation, explanation: node.explanation, timeHorizon: 'short_term' });
      previousId = node.id;
    };
    reasoning.changedVariables.slice(0, 2).forEach((text, index) => append({
      id: `variable-${index}`, type: 'changed_variable', title: text,
      explanation: '已观测到的关键变化。', knowledgeType: 'fact', evidenceIds: story.evidenceIds,
    }, 'raises'));
    const mechanisms = reasoning.mechanism.length
      ? reasoning.mechanism.slice(0, 2)
      : ['暂未找到可验证的直接驱动，以下影响仅作为待核验路径。'];
    mechanisms.forEach((text, index) => append({
      id: `mechanism-${index}`, type: 'mechanism', title: text,
      explanation: reasoning.mechanism.length ? '基于已知机制的传导解释。' : '缺少直接驱动证据，不能视为已确认原因。',
      knowledgeType: reasoning.mechanism.length ? 'inference' : 'hypothesis',
      direction: reasoning.mechanism.length ? 'mixed' : 'uncertain',
    }, 'may_lead_to'));
    story.relatedSectors.slice(0, 3).forEach((sector, index) => {
      const node = {
        id: `sector-${index}`, type: 'sector', title: sector,
        explanation: '关联板块，仍需用产业链数据确认实际受益或承压方向。',
        knowledgeType: 'hypothesis', direction: 'uncertain',
      };
      nodes.push(node);
      edges.push({ from: previousId, to: node.id, relation: 'may_lead_to', explanation: node.explanation, timeHorizon: 'short_term' });
    });
    reasoning.marketValidation.slice(0, 2).forEach((text, index) => nodes.push({
      id: `validation-${index}`, type: 'market_validation', title: text,
      explanation: '这是市场验证，不等同于驱动原因。', knowledgeType: 'fact', evidenceIds: story.evidenceIds,
    }));
    const evidenceStatus = evidencePack?.evidenceStatus;
    return {
      id: `impact-${story.storyId}`,
      storyType: story.type === 'geo_event' ? 'geopolitical_event' : story.type === 'price_anomaly' ? 'commodity_anomaly' : 'sector_anomaly',
      reasoningMode: story.type === 'geo_event' ? 'forward' : 'reverse_then_forward',
      title: story.title,
      trigger,
      summary: {
        eventFact: story.what,
        coreMechanism: mechanisms[0],
        keyImpacts: story.relatedSectors.slice(0, 3),
        conclusionLevel: evidenceStatus === 'confirmed' && reasoning.confidenceLevel === 'high'
          ? 'confirmed'
          : reasoning.confidenceLevel === 'medium' ? 'high_probability' : evidenceStatus === 'related' ? 'possible' : 'unknown',
      },
      nodes,
      edges,
      evidence: evidence.map((source) => ({
        id: source.id,
        category: source.kind === 'announcement' ? 'official_announcement' : source.kind === 'market_data' ? 'market' : source.kind === 'policy' ? 'macro' : 'news',
        statement: source.title,
        sourceName: source.sourceName,
        sourceUrl: source.url,
        publishedAt: source.publishedAt,
        role: 'supports',
        reliability: source.kind === 'announcement' || source.kind === 'policy' ? 'primary' : source.kind === 'market_data' ? 'authoritative' : 'secondary',
      })),
      counterEvidence: [],
      missingEvidence: [...new Set([...(evidencePack?.dataGaps || []), ...(reasoning.counterEvidence || []), reasoning.uncertainty])].filter(Boolean).slice(0, 4),
      observationIndicators: [...new Set([...reasoning.observationIndicators])].slice(0, 4),
      version: 'impact-path-v1',
    };
  }

  // 行情放量只能说明交易活跃，不能自动证明资金流入；关联新闻也不能自动证明直接催化。
  // 这层规则在模型输出之后再次执行，确保“证据状态”能真正约束前端可见的因果表述。
  function enforceEvidencePackGuard(chain: ReasoningChain, pack: EventEvidencePack | undefined): ReasoningChain {
    if (!pack || pack.evidenceStatus === 'confirmed') return chain;
    const unsupportedClaim = /资金(?:集中)?流入|资金涌入|需求增长|需求改善|政策利好|行业前景(?:乐观|向好)|直接催化/;
    const guardedSteps = chain.steps
      .filter((step) => !unsupportedClaim.test(step.text))
      .map((step) => ({
        ...step,
        kind: step.kind === 'fact' && /可能|预期|情绪|带动/.test(step.text) ? 'inference' as const : step.kind,
      }));
    const needsPlaceholder = !guardedSteps.some((step) => step.kind === 'inference');
    if (needsPlaceholder) {
      guardedSteps.push({
        id: 'evidence-status',
        text: pack.evidenceStatus === 'related'
          ? '关联新闻与板块表现同时出现，但直接驱动关系仍待确认。'
          : '目前只确认到行情变化，具体驱动原因仍待确认。',
        evidenceIds: [], kind: 'inference', stepType: 'mechanism', relationshipConfidence: 'weak',
      });
    }
    const statusReminder = pack.evidenceStatus === 'related'
      ? '当前仅有关联线索与市场验证，尚不能确认直接因果。'
      : '当前仅确认市场表现，尚缺少可验证的事件驱动。';
    const sector = pack.sectorValidation[0];
    const changedVariables = sector
      ? [
          sector.change5d === null ? '' : `${sector.sectorName}近5日${sector.change5d >= 0 ? '上涨' : '下跌'}${Math.abs(sector.change5d)}%。`,
          sector.turnoverChangePercent === null ? '' : `成交额较近20日均值${sector.turnoverChangePercent >= 0 ? '增加' : '减少'}${Math.abs(sector.turnoverChangePercent)}%。`,
        ].filter(Boolean)
      : chain.changedVariables;
    const marketValidation = sector
      ? [
          `${sector.sectorName}当日${sector.todayChangePercent >= 0 ? '上涨' : '下跌'}${Math.abs(sector.todayChangePercent)}%。`,
          sector.upStockRatio === null ? '' : `${sector.sampleSize}只样本中${sector.upStockRatio}%上涨。`,
          sector.leaderContribution === null ? '' : `龙头贡献度${sector.leaderContribution}%，用于判断是否由少数个股主导。`,
        ].filter(Boolean)
      : chain.marketValidation;
    return {
      ...chain,
      steps: guardedSteps.slice(0, 6),
      uncertainty: [chain.uncertainty, statusReminder, ...pack.dataGaps].filter(Boolean).join('；').slice(0, 180),
      confidenceLevel: 'limited',
      validationStatus: 'limited',
      beginnerSummary: pack.evidenceStatus === 'related'
        ? '行情与相关新闻线索同时出现，但目前还不能确认两者存在直接因果。'
        : '目前只确认到行情变化，具体驱动原因仍待确认。',
      facts: chain.facts.length ? chain.facts : guardedSteps.filter((step) => step.kind === 'fact').map((step) => step.text).slice(0, 3),
      changedVariables,
      mechanism: [pack.evidenceStatus === 'related'
        ? '相关新闻提供了关联线索，但当前没有足够证据确认其传导到板块行情的直接机制。'
        : '尚未获得可验证的传导机制。'],
      marketValidation,
      observationIndicators: sector
        ? ['成交额是否持续变化', '上涨家数能否维持或扩散', '龙头贡献度是否明显上升']
        : chain.observationIndicators,
    };
  }

  function enforceEvidenceAwareTeacherContent(
    story: MarketStoryDraft,
    teacher: TeacherStoryContent,
    pack: EventEvidencePack | undefined,
  ): TeacherStoryContent {
    if (!pack || pack.evidenceStatus === 'confirmed') return teacher;
    const sector = pack.sectorValidation[0];
    if (!sector) {
      return {
        ...teacher,
        summary: `${story.what} 当前只确认到市场表现，具体驱动仍待确认。`.slice(0, 180),
        uncertaintyText: '当前没有足够的直接事件证据，不能把关联线索当成确定原因。',
      };
    }
    const breadth = sector.upStockRatio === null ? '' : `，${sector.upStockRatio}%成分股上涨`;
    const turnover = sector.turnoverChangePercent === null
      ? ''
      : `，成交额较近20日均值${sector.turnoverChangePercent >= 0 ? '增加' : '减少'}${Math.abs(sector.turnoverChangePercent)}%`;
    const note = pack.evidenceStatus === 'related'
      ? '；已有相关新闻线索，但是否为直接驱动仍待确认。'
      : '；目前只确认到行情变化，原因待确认。';
    return {
      ...teacher,
      summary: `${sector.sectorName}今日${sector.todayChangePercent >= 0 ? '上涨' : '下跌'}${Math.abs(sector.todayChangePercent)}%${breadth}${turnover}${note}`.slice(0, 180),
      uncertaintyText: pack.evidenceStatus === 'related'
        ? '关联新闻可以提供观察线索，但不能单独证明它导致了板块波动。'
        : '目前缺少可验证的事件驱动信息。',
      simpleChain: [
        `${sector.sectorName}今日${sector.todayChangePercent >= 0 ? '上涨' : '下跌'}${Math.abs(sector.todayChangePercent)}%。`,
        sector.upStockRatio === null ? '板块内部上涨范围数据暂不完整。' : `${sector.upStockRatio}%成分股上涨，说明板块内部表现可继续观察。`,
        pack.evidenceStatus === 'related' ? '关联新闻提供线索，但直接驱动关系仍待确认。' : '目前只确认行情变化，原因仍待确认。',
      ],
    };
  }

  function findEvidenceSector(story: MarketStoryDraft, snapshot: MarketSnapshot) {
    const normalized = (value: string) => value.replace(/(概念|板块|行业|指数|主题)/g, '').trim();
    const candidates = story.relatedSectors.map(normalized).filter(Boolean);
    const title = normalized(story.title);
    const titleMatch = snapshot.sectors.find((sector) => {
      const sectorName = normalized(sector.name);
      return sectorName.length >= 2 && (title.includes(sectorName) || sectorName.includes(title.slice(0, Math.min(title.length, 4))));
    });
    if (titleMatch) return titleMatch;
    return snapshot.sectors.find((sector) => candidates.some((name) =>
      normalized(sector.name) === name || normalized(sector.name).includes(name) || name.includes(normalized(sector.name)),
    )) || null;
  }

  async function enrichCompanyEvidence(primaryCompany: MarketStoryDraft['primaryCompany']): Promise<NonNullable<EventEvidencePack['companyValidation']>> {
    if (!primaryCompany?.name && !primaryCompany?.symbol) return { status: 'not_matched', officialAnnouncements: [] };
    try {
      let symbol = primaryCompany.symbol || '';
      let name = primaryCompany.name;
      if (!symbol && name) {
        const search = await searchAshareStocks(name);
        const normalizedName = name.replace(/[（(].*?[）)]/g, '');
        const match = search.results.find((item: any) => String(item?.name || '').replace(/[（(].*?[）)]/g, '') === normalizedName);
        symbol = String(match?.code || '').replace(/\D/g, '').slice(0, 6);
        name = String(match?.name || name);
      }
      if (!/^\d{6}$/.test(symbol)) return { status: 'not_matched', name, officialAnnouncements: [] };
      const [quoteResult, eventResult] = await Promise.allSettled([
        fetchAshareStockQuoteWithFallback(symbol),
        buildStockEventSnapshot(symbol, 30),
      ]);
      const officialAnnouncements: MarketSource[] = eventResult.status === 'fulfilled'
        ? (eventResult.value.events || [])
          .filter((event: any) => event?.verification === 'official_verified')
          .slice(0, 3)
          .map((event: any, index: number) => ({
            id: `company-announcement-${symbol}-${index + 1}`,
            title: String(event.title || '').slice(0, 160),
            sourceName: '巨潮资讯网（CNINFO）',
            publishedAt: event.publishedAt,
            url: event.sourceUrl || undefined,
            kind: 'announcement' as const,
          }))
        : [];
      return {
        status: 'matched',
        name,
        symbol,
        changePercent: quoteResult.status === 'fulfilled' ? Number(quoteResult.value.quote?.changePercent) : undefined,
        eventCount: eventResult.status === 'fulfilled' ? Number(eventResult.value.events?.length || 0) : undefined,
        officialAnnouncements,
      };
    } catch (error: any) {
      console.warn(`[event-evidence] company enrichment failed: ${error?.message || 'unknown error'}`);
      return { status: 'unavailable', name: primaryCompany.name, symbol: primaryCompany.symbol, officialAnnouncements: [] };
    }
  }

  // 同一公司近期开过公告，不等于当前故事已经被公告证实；必须有事件动作上的语义对应。
  function officialAnnouncementMatchesStory(story: MarketStoryDraft, announcements: MarketSource[]) {
    const storyText = `${story.title} ${story.what}`.replace(/\s+/g, '');
    const eventGroups = [
      ['申购', '发行', '上市', '招股', '配售'],
      ['中标', '订单', '合同', '签署'],
      ['业绩', '利润', '营收', '预告', '快报'],
      ['诉讼', '仲裁', '立案', '判决'],
      ['停产', '复产', '产能', '投产'],
      ['减持', '增持', '回购', '分红'],
      ['收购', '重组', '并购', '资产'],
    ];
    return announcements.some((announcement) => {
      const title = String(announcement.title || '').replace(/\s+/g, '');
      return eventGroups.some((group) =>
        group.some((keyword) => storyText.includes(keyword))
        && group.some((keyword) => title.includes(keyword)),
      );
    });
  }

  async function buildEventEvidencePacks(stories: MarketStoryDraft[], snapshot: MarketSnapshot): Promise<EventEvidencePack[]> {
    const marketContext = {
      marketDate: snapshot.marketDate,
      indices: snapshot.indices,
      totalTurnoverAmount: snapshot.totalTurnoverAmount,
      marketBreadth: snapshot.marketBreadth,
    };
    return Promise.all(stories.map(async (story) => {
      const sector = findEvidenceSector(story, snapshot);
      const dataGaps: string[] = [];
      const extraSources: MarketSource[] = [];
      let sectorValidation: EventEvidencePack['sectorValidation'] = [];
      if (sector?.code) {
        const [kline, breadth, relatedNews] = await Promise.all([
          fetchSectorKline(sector.code),
          fetchSectorBreadth(sector.code),
          fetchEastMoneySectorNews(sector.name),
        ]);
        const todayAmount = Number(kline?.todayAmount);
        const avg20dAmount = Number(kline?.avg20dAmount);
        const turnoverChangePercent = Number.isFinite(todayAmount) && Number.isFinite(avg20dAmount) && avg20dAmount > 0
          ? round2(((todayAmount / avg20dAmount) - 1) * 100)
          : null;
        const dataStatus = breadth?.dataStatus === 'available' && Number.isFinite(Number(kline?.change5d))
          ? 'available' as const
          : breadth?.dataStatus === 'available' || Number.isFinite(Number(kline?.change5d))
            ? 'partial' as const
            : 'unavailable' as const;
        sectorValidation = [{
          sectorName: sector.name,
          sectorCode: sector.code,
          todayChangePercent: sector.changePercent,
          change5d: Number.isFinite(Number(kline?.change5d)) ? round2(Number(kline.change5d)) : null,
          change20d: Number.isFinite(Number(kline?.change20d)) ? round2(Number(kline.change20d)) : null,
          turnoverChangePercent,
          upStockRatio: breadth?.upStockRatio ?? null,
          sampleSize: breadth?.sampleSize ?? 0,
          limitUpCount: breadth?.limitUpCount ?? null,
          leaderContribution: breadth?.leaderContribution ?? null,
          dispersion: breadth?.dispersion ?? null,
          leaders: (breadth?.stocks || []).slice().sort((a: any, b: any) => b.changePercent - a.changePercent).slice(0, 3)
            .map((stock: any) => ({ code: stock.code, name: stock.name, changePercent: stock.changePercent })),
          dataStatus,
        }];
        extraSources.push({
          id: `sector-validation-${story.storyId}-${sector.code}`,
          title: `${sector.name}：当日${sector.changePercent >= 0 ? '+' : ''}${sector.changePercent.toFixed(2)}%，5日/20日走势、成交与成分股广度验证`,
          sourceName: '东方财富', kind: 'market_data', publishedAt: snapshot.dataUpdatedAt,
        });
        for (const news of relatedNews.slice(0, 2)) {
          extraSources.push({ id: `story-${story.storyId}-${news.id}`, title: news.title, sourceName: news.sourceName, kind: 'news' });
        }
        if (dataStatus !== 'available') dataGaps.push(`${sector.name}的历史走势或成分股广度不完整`);
        if (!relatedNews.length) dataGaps.push(`${sector.name}未检索到可作为直接催化的事实新闻`);
      } else {
        dataGaps.push('未匹配到可验证的关联板块编码');
      }
      const companyValidation = story.type === 'company_event'
        ? await enrichCompanyEvidence(story.primaryCompany)
        : undefined;
      if (companyValidation) {
        companyValidation.officialEventMatched = officialAnnouncementMatchesStory(story, companyValidation.officialAnnouncements);
      }
      if (companyValidation?.officialAnnouncements.length) extraSources.push(...companyValidation.officialAnnouncements);
      if (story.type === 'company_event' && companyValidation?.status !== 'matched') dataGaps.push('公司主体未能可靠匹配到A股代码，未调用公告验证');
      if (story.type === 'company_event' && companyValidation?.status === 'matched' && !companyValidation.officialAnnouncements.length) dataGaps.push('近30日未检索到可匹配的官方公告');
      if (story.type === 'company_event' && companyValidation?.officialAnnouncements.length && !companyValidation.officialEventMatched) dataGaps.push('已找到公司官方公告，但公告标题未能与当前事件动作匹配');
      if (story.type === 'policy_driver') dataGaps.push('尚未接入政策发布部门的原文接口，当前政策仅能作为新闻线索核验');
      const hasMarketValidation = sectorValidation.some((item) => item.dataStatus === 'available');
      const hasRelatedNews = extraSources.some((source) => source.kind === 'news');
      const evidenceStatus: EvidenceStatus = story.type === 'company_event' && companyValidation?.status === 'matched' && companyValidation.officialEventMatched
        ? 'confirmed'
        : hasRelatedNews || hasMarketValidation
          ? 'related'
          : 'market_only';
      return {
        storyId: story.storyId,
        storyType: story.type,
        evidenceStatus,
        marketContext,
        sectorValidation,
        ...(companyValidation ? { companyValidation } : {}),
        sources: extraSources,
        dataGaps: [...new Set(dataGaps)],
      } satisfies EventEvidencePack;
    }));
  }

  const clampScore = (value: number, min = 0, max = 100) =>
    Math.min(max, Math.max(min, value));

  type TurnoverSample = {
    date: string;
    minuteBucket: number;
    amount: number;
  };

  const MARKET_TEMPERATURE_HISTORY_FILE = path.join(
    process.cwd(),
    'work',
    '.runtime',
    'market-temperature-history.json',
  );

  function getShanghaiDateParts(date: Date) {
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const part = (type: string) => Number(parts.find((item) => item.type === type)?.value || 0);
    const year = part('year');
    const month = part('month');
    const day = part('day');
    const hour = part('hour');
    const minute = part('minute');
    return {
      dateKey: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      minuteBucket: Math.round((hour * 60 + minute) / 10) * 10,
    };
  }

  function readTurnoverHistory(): TurnoverSample[] {
    try {
      if (!fs.existsSync(MARKET_TEMPERATURE_HISTORY_FILE)) return [];
      const parsed = JSON.parse(fs.readFileSync(MARKET_TEMPERATURE_HISTORY_FILE, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function updateTurnoverHistory(amount: number, timestamp: Date) {
    if (!Number.isFinite(amount) || amount <= 0) {
      return { baseline: null as number | null, sampleCount: 0 };
    }

    const { dateKey, minuteBucket } = getShanghaiDateParts(timestamp);
    const history = readTurnoverHistory();
    const comparableByDate = new Map<string, TurnoverSample>();

    history
      .filter((sample) =>
        sample.date !== dateKey &&
        Math.abs(sample.minuteBucket - minuteBucket) <= 10 &&
        Number.isFinite(sample.amount) &&
        sample.amount > 0
      )
      .sort((a, b) => b.date.localeCompare(a.date))
      .forEach((sample) => {
        if (!comparableByDate.has(sample.date)) comparableByDate.set(sample.date, sample);
      });

    const comparable = [...comparableByDate.values()].slice(0, 5);
    const baseline = comparable.length >= 2
      ? comparable.reduce((sum, sample) => sum + sample.amount, 0) / comparable.length
      : null;

    const next = history.filter((sample) =>
      !(sample.date === dateKey && sample.minuteBucket === minuteBucket)
    );
    next.push({ date: dateKey, minuteBucket, amount });

    try {
      fs.mkdirSync(path.dirname(MARKET_TEMPERATURE_HISTORY_FILE), { recursive: true });
      fs.writeFileSync(
        MARKET_TEMPERATURE_HISTORY_FILE,
        JSON.stringify(next.sort((a, b) => a.date.localeCompare(b.date)).slice(-1800), null, 2),
        'utf8',
      );
    } catch (error: any) {
      console.warn('[market-temperature] turnover history write failed:', error.message);
    }

    return { baseline, sampleCount: comparable.length };
  }

  function calculateMarketTemperature(marketData: Awaited<ReturnType<typeof fetchMarketData>>) {
    const sectors = marketData.sectors.filter((sector: any) =>
      Number.isFinite(Number(sector.changePercent))
    );
    const upCount = sectors.filter((sector: any) => sector.changePercent > 0).length;
    const downCount = sectors.filter((sector: any) => sector.changePercent < 0).length;
    const totalSectors = sectors.length;

    // 方向分：板块广度45% + 三大指数35% + 涨跌停极端表现20%。
    const breadthScore = totalSectors > 0
      ? clampScore(50 + (50 * (upCount - downCount)) / totalSectors)
      : 50;
    const validIndexChanges = marketData.indices
      .map((index: any) => Number(index.changePercent))
      .filter(Number.isFinite);
    const averageIndexChange = validIndexChanges.length
      ? validIndexChanges.reduce((sum: number, value: number) => sum + value, 0) / validIndexChanges.length
      : 0;
    const indexScore = clampScore(50 + averageIndexChange * 12, 5, 95);

    const { limitUp, limitDown, available: pulseAvailable } = marketData.marketPulse;
    const extremeScore = pulseAvailable
      ? clampScore(50 + (50 * (limitUp - limitDown)) / (limitUp + limitDown + 10))
      : 50;
    const directionScore =
      breadthScore * 0.45 +
      indexScore * 0.35 +
      extremeScore * 0.20;

    // 确认层：成交量、集中度、波动率只验证方向，合计最多修正±15分。
    const turnoverAmount = Number(marketData.marketPulse.turnoverAmount || 0);
    const turnoverHistory = updateTurnoverHistory(turnoverAmount, marketData.timestamp);
    const turnoverRatio = turnoverHistory.baseline
      ? turnoverAmount / turnoverHistory.baseline
      : null;
    const directionSign = directionScore > 52 ? 1 : directionScore < 48 ? -1 : 0;
    const turnoverScore = turnoverRatio === null
      ? 50
      : clampScore(50 + directionSign * clampScore((turnoverRatio - 1) * 100, -35, 35), 15, 85);

    const positiveChanges = sectors
      .map((sector: any) => Math.max(0, Number(sector.changePercent)))
      .sort((a: number, b: number) => b - a);
    const totalPositiveChange = positiveChanges.reduce((sum: number, value: number) => sum + value, 0);
    const top3PositiveChange = positiveChanges.slice(0, 3).reduce((sum: number, value: number) => sum + value, 0);
    const top3Share = totalPositiveChange > 0 ? top3PositiveChange / totalPositiveChange : null;
    const concentrationScore = top3Share === null ? 50 : clampScore(100 - top3Share * 100);

    const amplitudes = marketData.indices
      .map((index: any) => {
        const high = Number(index.high);
        const low = Number(index.low);
        const previousClose = Number(index.previousClose);
        return high > 0 && low > 0 && previousClose > 0
          ? ((high - low) / previousClose) * 100
          : null;
      })
      .filter((value: number | null): value is number => value !== null && Number.isFinite(value));
    const averageAmplitude = amplitudes.length
      ? amplitudes.reduce((sum: number, value: number) => sum + value, 0) / amplitudes.length
      : null;
    const volatilityScore = averageAmplitude === null
      ? 50
      : clampScore(100 - averageAmplitude * 20);

    const confirmationScore =
      turnoverScore * 0.40 +
      concentrationScore * 0.35 +
      volatilityScore * 0.25;
    const correction = clampScore((confirmationScore - 50) * 0.30, -15, 15);
    const score = Math.round(clampScore(directionScore + correction));

    const presentation =
      score >= 75
        ? { emoji: '🔥', text: '市场活跃', label: '明显偏强', description: '多数信号相互印证', tone: 'hot' }
        : score >= 60
          ? { emoji: '☀️', text: '温和偏暖', label: '市场偏强', description: '上涨力量相对占优', tone: 'warm' }
          : score >= 40
            ? { emoji: '⛅', text: '多空平衡', label: '市场平稳', description: '方向仍有分歧', tone: 'neutral' }
            : { emoji: '🌧️', text: '市场偏冷', label: '市场偏弱', description: '下跌与避险信号占优', tone: 'cool' };

    return {
      score,
      ...presentation,
      directionScore: Math.round(directionScore * 10) / 10,
      confirmationScore: Math.round(confirmationScore * 10) / 10,
      correction: Math.round(correction * 10) / 10,
      components: {
        breadth: {
          score: Math.round(breadthScore * 10) / 10,
          up: upCount,
          down: downCount,
          total: totalSectors,
        },
        indices: {
          score: Math.round(indexScore * 10) / 10,
          averageChange: Math.round(averageIndexChange * 100) / 100,
        },
        extremes: {
          score: Math.round(extremeScore * 10) / 10,
          limitUp,
          limitDown,
          stockCount: marketData.marketPulse.stockCount,
          available: pulseAvailable,
        },
        turnover: {
          score: Math.round(turnoverScore * 10) / 10,
          amount: turnoverAmount,
          baseline: turnoverHistory.baseline,
          ratio: turnoverRatio === null ? null : Math.round(turnoverRatio * 1000) / 1000,
          sampleCount: turnoverHistory.sampleCount,
          status: turnoverAmount <= 0
            ? '成交额数据待更新，暂按中性处理'
            : turnoverRatio === null
              ? '同期基准积累中，暂按中性处理'
              : '已按近5个交易日同期均值比较',
        },
        concentration: {
          score: Math.round(concentrationScore * 10) / 10,
          top3Share: top3Share === null ? null : Math.round(top3Share * 1000) / 10,
        },
        volatility: {
          score: Math.round(volatilityScore * 10) / 10,
          averageAmplitude: averageAmplitude === null ? null : Math.round(averageAmplitude * 100) / 100,
        },
      },
      formula: '方向分=板块广度×45%+指数×35%+涨跌停×20%；确认修正=(成交量×40%+集中度×35%+波动率×25%-50)×0.3，修正范围±15分',
    };
  }

  // POST /api/feedback — 用户反馈闭环（写入 DB；登录时关联 user_id，匿名 user_id=NULL）
  app.post('/api/feedback', async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'invalid body' });
    }
    let userId: string | null = null;
    try {
      const auth = await authService.authenticate(bearerToken(req));
      userId = auth.user.id;
    } catch { /* 匿名反馈也允许 */ }

    try {
      await feedbackService.submit({ ...body, userId });
      res.json({ ok: true });
    } catch (e) {
      if (e instanceof ApiError) return res.status(e.status).json({ error: e.message });
      console.error('[feedback] write failed:', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'feedback save failed' });
    }
  });

  // GET /api/feedback-stats — A/B Test 反馈统计（从 DB 聚合）
  app.get('/api/feedback-stats', async (_req, res) => {
    try {
      const result = await feedbackService.stats();
      res.json(result);
    } catch {
      res.json({ stats: {}, total: 0 });
    }
  });

  // POST /api/morning-report — Prompt 1 → 2 → 3 pipeline
  let morningReportCache: { data: any; timestamp: number } | null = null;
  let morningReportPromise: Promise<any> | null = null;
  // 首页日报和“今天发生了什么”共用同一份生成结果，统一缓存 15 分钟。
  const REPORT_CACHE_TTL = 15 * 60 * 1000;

  app.get('/api/morning-report', async (req, res) => {
    console.log(`[morning-report] incoming request, ref=${req.header('referer') || 'none'}, ua=${req.header('user-agent')?.substring(0, 40) || 'none'}`);
    const now = Date.now();
    if (morningReportCache && (now - morningReportCache.timestamp) < REPORT_CACHE_TTL) {
      console.log(`[morning-report] served from cache, data.sentiment=${morningReportCache.data.sentiment}, summaryLen=${morningReportCache.data.summaryText?.length || 0}`);
      return res.json(morningReportCache.data);
    }

    // 缓存过期期间并发请求共享同一个生成任务，避免重复执行昂贵的 AI pipeline
    if (morningReportPromise) {
      try {
        return res.json(await morningReportPromise);
      } catch (e: any) {
        console.error('[morning-report] shared generation failed:', e.message);
      }
    }

    const startedAt = Date.now();
    const reportPromise = (async () => {
      try {
        const marketData = await fetchMarketData();
        const snapshot = buildMarketSnapshot(marketData);
        console.log('[morning-report] step 0: market data fetched');

        const p1Input = JSON.stringify({
          snapshotId: snapshot.snapshotId,
          market: snapshot.market,
          marketDate: snapshot.marketDate,
          indices: snapshot.indices,
          totalTurnoverAmount: snapshot.totalTurnoverAmount,
          marketBreadth: snapshot.marketBreadth,
          marketStatus: snapshot.marketStatus,
          sectorCandidates: [...snapshot.sectors]
            .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))
            .slice(0, 30),
          sources: snapshot.sources,
          missingData: snapshot.missingData,
        }, null, 2);

        let fallback = false;
        let aiFailed = false;
        let sentiment = '中性';
        let storyDrafts: MarketStoryDraft[] = [];
        try {
          const p1Result = await callAIWithParseRetry(PROMPT_1_SYSTEM, p1Input, 0.1);
          if (['乐观', '中性', '谨慎'].includes(p1Result?.marketSentiment)) {
            sentiment = p1Result.marketSentiment;
          }
          storyDrafts = normalizeStories(p1Result?.stories, snapshot);
        } catch (error: any) {
          console.error('[morning-report] P1 failed:', error.message);
          fallback = true;
          aiFailed = true;
        }
        console.log('[morning-report] step 1: market understanding done');
        if (storyDrafts.length === 0) {
          // AI 调用失败时，不生成兜底假故事，直接标记失败让前端提示
          if (aiFailed) {
            const aiErrorResult = {
              aiFailed: true,
              sentiment,
              summaryText: 'AI 服务暂时不可用，早报生成失败。',
              reasonBrief: '',
              stories: [] as MarketStoryDraft[],
              top3Themes: [] as MarketStoryDraft[],
              fallback: true,
              timestamp: marketData.timestamp,
            };
            console.log('[morning-report] AI failed, short-circuit');
            return aiErrorResult;
          }
          storyDrafts = fallbackStories(snapshot);
          fallback = true;
        }

        // P1 只负责选题。入选后由服务端补取可复核的数据，P2 不再只凭标题推演。
        const evidencePacks = await buildEventEvidencePacks(storyDrafts, snapshot);
        const evidenceSources = [
          ...snapshot.sources,
          ...evidencePacks.flatMap((pack) => pack.sources),
        ].filter((source, index, all) => all.findIndex((item) => item.id === source.id) === index);
        const evidencePackByStory = new Map(evidencePacks.map((pack) => [pack.storyId, pack]));
        storyDrafts = storyDrafts.map((story) => ({
          ...story,
          evidenceIds: [...new Set([
            ...story.evidenceIds,
            ...(evidencePackByStory.get(story.storyId)?.sources.map((source) => source.id) || []),
          ])],
        }));
        const evidenceSnapshot: MarketSnapshot = { ...snapshot, sources: evidenceSources };
        console.log(`[morning-report] evidence packs built: ${evidencePacks.map((pack) => `${pack.storyId}:${pack.evidenceStatus}`).join(', ')}`);

        let chains: ReasoningChain[] = [];
        let impactAnalysesByStory = new Map<string, ImpactAnalysis>();
        try {
          const p2Result = await callAIWithParseRetry(
            MARKET_REASONING_PROMPT_V2_ENABLED
              ? `${PROMPT_2_SYSTEM}\n${PROMPT_2_EVIDENCE_V2_APPENDIX}\n${PROMPT_2_IMPACT_PATH_APPENDIX}`
              : PROMPT_2_SYSTEM,
            JSON.stringify({
              stories: storyDrafts,
              evidencePacks,
              impactSkillInputs: buildImpactSkillInputs(storyDrafts, evidencePacks),
              sources: evidenceSnapshot.sources,
            }, null, 2),
            0.05,
          );
          chains = normalizeChains(p2Result?.chains, storyDrafts, evidenceSnapshot)
            .map((chain) => enforceEvidencePackGuard(chain, evidencePackByStory.get(chain.storyId)));
          impactAnalysesByStory = normalizeImpactAnalyses(
            p2Result?.impactAnalyses,
            storyDrafts,
            evidenceSnapshot,
            evidencePacks,
          );
        } catch (error: any) {
          console.error('[morning-report] P2 failed:', error.message);
          fallback = true;
        }
        console.log('[morning-report] step 2: causal reasoning done');
        const chainByStory = new Map(chains.map((chain) => [chain.storyId, chain]));
        const sourceById = new Map(evidenceSnapshot.sources.map((source) => [source.id, source]));
        const evidenceConfidenceByStory = new Map(
          storyDrafts.map((story) => {
            const chain = chainByStory.get(story.storyId) || defaultReasoning(story);
            const independentSourceCount = new Set(
              story.evidenceIds
                .map((id) => sourceById.get(id)?.sourceName)
                .filter(Boolean),
            ).size;
            return [story.storyId, calculateEvidenceConfidence(chain, independentSourceCount)];
          }),
        );
        const sharedP3Input = {
          marketOverview: {
            indices: snapshot.indices.map((index: any) => ({
              name: index.name,
              changePercent: index.changePercent,
            })),
            marketBreadth: snapshot.marketBreadth,
            totalTurnoverAmount: snapshot.totalTurnoverAmount,
            marketStatus: snapshot.marketStatus,
            missingData: snapshot.missingData,
          },
          sentiment,
          stories: storyDrafts,
          evidencePacks,
          chains: storyDrafts.map((story) => chainByStory.get(story.storyId) || defaultReasoning(story)),
        };
        const p3BeginnerInput = JSON.stringify(sharedP3Input, null, 2);
        const p3ProfessionalInput = JSON.stringify({
          ...sharedP3Input,
          confidenceByStory: storyDrafts.map((story) => ({
            storyId: story.storyId,
            ...evidenceConfidenceByStory.get(story.storyId),
          })),
        }, null, 2);

        const [beginnerResponse, professionalResponse] = await Promise.allSettled([
          callAIWithParseRetry(PROMPT_3_BEGINNER_SYSTEM, p3BeginnerInput, 0.35),
          callAIWithParseRetry(PROMPT_3_PROFESSIONAL_SYSTEM, p3ProfessionalInput, 0.2),
        ]);
        let p3BeginnerResult: any = {};
        let p3ProfessionalResult: any = {};
        if (beginnerResponse.status === 'fulfilled') {
          p3BeginnerResult = beginnerResponse.value;
        } else {
          console.error('[morning-report] P3 beginner failed:', beginnerResponse.reason?.message);
          fallback = true;
        }
        if (professionalResponse.status === 'fulfilled') {
          p3ProfessionalResult = professionalResponse.value;
        } else {
          console.error('[morning-report] P3 professional failed:', professionalResponse.reason?.message);
          fallback = true;
        }
        console.log('[morning-report] step 3: beginner and professional expression done');

        const summaryText = sanitizeTeacherText(p3BeginnerResult?.summaryText, 92)
          || fallbackDailySummary(marketData, storyDrafts);
        const reasonBrief = sanitizeTeacherText(p3BeginnerResult?.reasonBrief, 170)
          || '泡泡会继续结合指数、板块涨跌分布和当天热点，帮助你理解今天市场为何呈现这样的状态。';
        const teacherItems: TeacherStoryContent[] = Array.isArray(p3BeginnerResult?.stories)
          ? p3BeginnerResult.stories.map((item: any) => ({
              storyId: String(item?.storyId || ''),
              summary: sanitizeTeacherText(item?.summary, 180),
              uncertaintyText: sanitizeTeacherText(item?.uncertaintyText, 180),
              simpleChain: normalizeTextList(item?.simpleChain, 3, 80),
            })).filter((item: TeacherStoryContent) => item.storyId && item.summary)
          : [];
        const teacherByStory = new Map(teacherItems.map((item) => [item.storyId, item]));
        const sourceIds = new Set(evidenceSnapshot.sources.map((source) => source.id));
        const validRoles = new Set(['primary', 'secondary', 'diffusion']);
        const professionalItems: ProfessionalStoryContent[] = Array.isArray(p3ProfessionalResult?.stories)
          ? p3ProfessionalResult.stories.map((item: any) => {
              const storyId = String(item?.storyId || '');
              const calculatedConfidence = evidenceConfidenceByStory.get(storyId);
              if (!calculatedConfidence) return null;
              return {
                storyId,
                conclusion: sanitizeTeacherText(item?.conclusion, 220),
                drivers: Array.isArray(item?.drivers)
                  ? item.drivers.slice(0, 3).map((driver: any, index: number) => ({
                      role: validRoles.has(driver?.role) ? driver.role : index === 0 ? 'primary' : 'secondary',
                      title: sanitizeTeacherText(driver?.title, 40),
                      explanation: sanitizeTeacherText(driver?.explanation, 120),
                      evidenceIds: Array.isArray(driver?.evidenceIds)
                        ? [...new Set<string>(driver.evidenceIds.map(String).filter((id: string) => sourceIds.has(id)))]
                        : [],
                    })).filter((driver: any) => driver.title && driver.explanation)
                  : [],
                supportingEvidence: normalizeTextList(item?.supportingEvidence),
                evidenceGaps: normalizeTextList(item?.evidenceGaps),
                alternativeExplanations: normalizeTextList(item?.alternativeExplanations),
                counterLogic: normalizeTextList(item?.counterLogic),
                observationIndicators: normalizeTextList(item?.observationIndicators),
                confidence: {
                  score: calculatedConfidence.score,
                  level: calculatedConfidence.level,
                  explanation: calculatedConfidence.calculation,
                },
              } satisfies ProfessionalStoryContent;
            }).filter(Boolean) as ProfessionalStoryContent[]
          : [];
        const professionalByStory = new Map(professionalItems.map((item) => [item.storyId, item]));
        const stories = storyDrafts.map((draft) => {
          const reasoning = chainByStory.get(draft.storyId) || defaultReasoning(draft);
          const rawTeacher = teacherByStory.get(draft.storyId) || defaultTeacherContent(draft, reasoning);
          const teacher = enforceEvidenceAwareTeacherContent(
            draft,
            rawTeacher,
            evidencePackByStory.get(draft.storyId),
          );
          const evidenceConfidence = evidenceConfidenceByStory.get(draft.storyId)
            || calculateEvidenceConfidence(reasoning, new Set(
              draft.evidenceIds.map((id) => sourceById.get(id)?.sourceName).filter(Boolean),
            ).size);
          const professional = professionalByStory.get(draft.storyId)
            || defaultProfessionalContent(draft, reasoning, evidenceConfidence);
          const evidence = draft.evidenceIds.map((id) => sourceById.get(id)).filter(Boolean) as MarketSource[];
          return {
            ...draft,
            reasoning,
            teacher,
            professional,
            evidencePack: evidencePackByStory.get(draft.storyId),
            evidence,
            impactAnalysis: MARKET_IMPACT_PATH_ENABLED
              ? impactAnalysesByStory.get(draft.storyId)
                || buildFallbackImpactAnalysis(draft, reasoning, evidence, evidencePackByStory.get(draft.storyId))
              : undefined,
          };
        });

        const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
        console.log(`[morning-report] completed in ${elapsed}s`);

        const result = {
          sentiment,
          summaryText,
          reasonBrief,
          stories,
          top3Themes: stories,
          promptVersion: MARKET_REASONING_PROMPT_V2_ENABLED
            ? 'market-stories-v7-impact-path'
            : 'market-stories-v5-evidence-pack',
          promptVersions: {
            reasoning: MARKET_REASONING_PROMPT_V2_ENABLED ? 'p2-impact-path-v1' : 'p2-legacy-guarded',
            beginner: 'p3a-beginner-v1',
            professional: 'p3b-professional-v1',
          },
          fallback,
          timestamp: marketData.timestamp,
        };
        morningReportCache = { data: result, timestamp: Date.now() };
        return result;
      } catch (error: any) {
        console.error('[morning-report] error:', error.message);
        throw error;
      }
    })();

    morningReportPromise = reportPromise;
    try {
      const result = await reportPromise;
      res.json(result);
    } catch (error: any) {
      res.status(500).json({
        error: '早报生成失败，请稍后重试',
        fallback: true,
      });
    } finally {
      morningReportPromise = null;
    }
  });

  // GET /api/stock-quote — A 股个股实时行情，多源回退并显式返回来源元数据

  // MCP Server（Streamable HTTP，无状态模式）——供赛事平台 tools/list 验证与调用
  // 数据源为 Node 原生 HTTP（腾讯/新浪/东财），不依赖 Python，Vercel / Railway 均可运行。
  // 注意：无状态模式下，每个请求必须使用全新的 server + transport（官方示例 simpleStatelessStreamableHttp）。
  const handleMcp = async (req: express.Request, res: express.Response) => {
    const mcpServer = createMcpServer();
    const mcpTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // 无状态：Vercel Serverless 每次请求独立，不维护 session
      enableJsonResponse: true, // 直接返回 JSON（而非 SSE 流），适配 Serverless 与评测平台
    });
    try {
      console.log(`[mcp] ${req.method} ${req.url} body=${JSON.stringify(req.body)?.slice(0, 120)}`);
      await mcpServer.connect(mcpTransport);
      await mcpTransport.handleRequest(req as any, res as any, req.body);
      console.log(`[mcp] handled ${req.method} status=${res.statusCode}`);
    } catch (error: any) {
      console.error('[mcp] handle error:', error?.message, error?.stack);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      } else {
        res.end();
      }
    } finally {
      res.on('close', () => {
        void mcpTransport.close();
        void mcpServer.close();
      });
    }
  };
  app.post('/api/mcp', handleMcp);
  app.get('/api/mcp', handleMcp);

  // GET /api/stock-quote — A 股个股实时行情，多源回退并显式返回来源元数据
  app.get('/api/stock-quote', async (req, res) => {
    try {
      const symbol = String(req.query.symbol || '');
      if (!symbol) return res.status(400).json({ error: 'symbol is required' });
      res.json(await fetchAshareStockQuoteWithFallback(symbol));
    } catch (error: any) {
      res.status(503).json({ error: error.message || '个股行情暂不可用', dataUnavailable: true });
    }
  });

  // GET /api/cninfo/announcements — 官方公告检索，为财报与风险证据链提供原始来源
  app.get('/api/cninfo/announcements', async (req, res) => {
    try {
      const symbol = String(req.query.symbol || '');
      const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }).replaceAll('-', '');
      const startDate = String(req.query.startDate || `${today.slice(0, 4)}0101`);
      const endDate = String(req.query.endDate || today);
      const category = String(req.query.category || '');
      res.json(await fetchCninfoAnnouncements(symbol, startDate, endDate, category));
    } catch (error: any) {
      console.error('[cninfo] announcement query failed:', error.message);
      res.status(503).json({ error: 'CNINFO 公告暂不可用', detail: error.message, dataUnavailable: true });
    }
  });

  // GET /api/cninfo/document - 仅解析巨潮公告 ID，对正文页码和证据 ID 做可追溯提取。
  app.get('/api/cninfo/document', async (req, res) => {
    try {
      const announcementId = String(req.query.announcementId || '').trim();
      const announcementTime = String(req.query.announcementTime || '').trim();
      const stockCode = String(req.query.stockCode || '').trim();
      const force = String(req.query.force || '').trim() === '1';
      res.json(await parseCninfoDocument(announcementId, announcementTime, stockCode, force));
    } catch (error: any) {
      console.error('[cninfo] document parse failed:', error.message);
      const invalidInput = /announcementId 应为|announcementTime 应为|stockCode 应为/.test(String(error.message || ''));
      res.status(invalidInput ? 400 : 503).json({ error: invalidInput ? '公告文档请求参数不正确' : 'CNINFO 公告文档暂不可用', detail: safeRuntimeDataGap(error.message), dataUnavailable: !invalidInput });
    }
  });

  // GET /api/cninfo/business-segments - 最新正式定期报告中的分产品/地区/行业原文表格与页码。
  app.get('/api/cninfo/business-segments', async (req, res) => {
    try {
      const symbol = String(req.query.symbol || '');
      if (!symbol) return res.status(400).json({ error: 'symbol is required' });
      res.json(await buildStockBusinessSegments(symbol));
    } catch (error: any) {
      console.error('[cninfo] business segment parse failed:', error.message);
      res.status(503).json({ error: '分业务经营数据暂不可用', detail: safeRuntimeDataGap(error.message), dataUnavailable: true });
    }
  });

  // GET /api/stock-search — 全市场 A 股名称/代码检索。东方财富为主，新浪联想为兜底。
  app.get('/api/stock-search', async (req, res) => {
    try {
      const query = String(req.query.q || '');
      if (!query.trim()) return res.status(400).json({ error: 'q is required' });
      res.json(await searchAshareStocks(query));
    } catch (error: any) {
      res.status(503).json({ error: error.message || '股票搜索暂不可用', dataUnavailable: true });
    }
  });

  // GET /api/stock-events - 个股事件确定性快照，不调用 AI
  app.get('/api/stock-events', async (req, res) => {
    try {
      const symbol = String(req.query.symbol || '');
      if (!symbol) return res.status(400).json({ error: 'symbol is required' });
      const days = Number(req.query.days || 180);
      if (!Number.isInteger(days) || days < 1 || days > 365) return res.status(400).json({ error: 'days must be an integer between 1 and 365' });
      res.json(await buildStockEventSnapshot(symbol, days));
    } catch (error: any) {
      console.error('[stock-events] query failed:', error.message);
      res.status(503).json({ error: '个股事件快照暂不可用', detail: error.message, dataUnavailable: true });
    }
  });

  // GET /api/stock-sentiment - 个股舆情确定性快照，不调用 AI
  app.get('/api/stock-sentiment', async (req, res) => {
    try {
      const symbol = String(req.query.symbol || '');
      if (!symbol) return res.status(400).json({ error: 'symbol is required' });
      const days = Number(req.query.days || 30);
      if (!Number.isInteger(days) || days < 1 || days > 90) return res.status(400).json({ error: 'days must be an integer between 1 and 90' });
      res.json(await buildStockSentimentSnapshot(symbol, days));
    } catch (error: any) {
      console.error('[stock-sentiment] query failed:', error.message);
      res.status(503).json({ error: '个股舆情快照暂不可用', detail: error.message, dataUnavailable: true });
    }
  });

  // GET /api/stock-risk-snapshot - 风险/反方确定性快照，不调用 AI
  app.get('/api/stock-risk-snapshot', async (req, res) => {
    try {
      const symbol = String(req.query.symbol || '');
      if (!symbol) return res.status(400).json({ error: 'symbol is required' });
      res.json(await buildStockRiskSnapshot(symbol));
    } catch (error: any) {
      console.error('[stock-risk-snapshot] query failed:', error.message);
      res.status(503).json({ error: '个股风险快照暂不可用', detail: error.message, dataUnavailable: true });
    }
  });

  // GET /api/stock-manager-snapshot - CIO/Manager 确定性汇总，不调用 AI
  app.get('/api/stock-manager-snapshot', async (req, res) => {
    try {
      const symbol = String(req.query.symbol || '');
      if (!symbol) return res.status(400).json({ error: 'symbol is required' });
      res.json(await buildStockManagerSnapshot(symbol));
    } catch (error: any) {
      console.error('[stock-manager-snapshot] query failed:', error.message);
      res.status(503).json({ error: 'CIO/Manager 汇总快照暂不可用', detail: error.message, dataUnavailable: true });
    }
  });

  // GET /api/stock-agents/cio-manager - CIO/Manager：只解释冻结汇总快照
  app.get('/api/stock-agents/cio-manager', async (req, res) => {
    try {
      const symbol = String(req.query.symbol || '');
      if (!symbol) return res.status(400).json({ error: 'symbol is required' });
      const refresh = String(req.query.refresh || '') === '1';
      if (refresh) invalidateStockResearchCaches(symbol);
      res.json(await runCioManagerAgent(symbol, refresh));
    } catch (error: any) {
      console.error('[cio-manager-agent] query failed:', error.message);
      res.status(503).json({ error: 'CIO/Manager Agent 暂不可用', detail: error.message, dataUnavailable: true });
    }
  });

  // GET /api/stock-financials - 标准化关键财务指标；CNINFO 公告用于对应报告期核验
  app.get('/api/stock-financials', async (req, res) => {
    try {
      res.json(await fetchFinancialDataWithFallback(String(req.query.symbol || '')));
    } catch (error: any) {
      console.error('[financials] summary query failed:', error.message);
      res.status(503).json({ error: '结构化财务指标暂不可用', detail: error.message, dataUnavailable: true });
    }
  });

  app.get('/api/xueqiu/profile', async (req, res) => {
    try {
      res.json(await fetchXueqiuProfile(String(req.query.symbol || '')));
    } catch (error: any) {
      res.status(503).json({ error: '雪球公司画像暂不可用', detail: error.message, dataUnavailable: true });
    }
  });

  app.get('/api/xueqiu/heat', async (_req, res) => {
    try {
      res.json(await fetchXueqiuHeat());
    } catch (error: any) {
      res.status(503).json({ error: '雪球热度暂不可用', detail: error.message, dataUnavailable: true });
    }
  });

  // GET /api/stock-technical — 个股复权日线和确定性技术指标
  app.get('/api/stock-technical', async (req, res) => {
    try {
      res.json(await fetchStockTechnicalData(String(req.query.symbol || '')));
    } catch (error: any) {
      console.error('[stock-technical] query failed:', error.message);
      res.status(503).json({ error: '个股技术指标暂不可用', detail: error.message, dataUnavailable: true });
    }
  });

  // GET /api/market-daily-kline — 统一个股/指数日线来源与回退元数据
  app.get('/api/market-daily-kline', async (req, res) => {
    try {
      const kind = String(req.query.kind || 'stock');
      if (kind !== 'stock' && kind !== 'index') return res.status(400).json({ error: 'kind 应为 stock 或 index' });
      res.json(await fetchMarketDailyKline(kind, String(req.query.symbol || '')));
    } catch (error: any) {
      res.status(503).json({ error: '市场日线暂不可用', detail: error.message, dataUnavailable: true });
    }
  });

  // GET /api/market-environment — 指数趋势 + 市场广度/成交额/涨跌停脉冲的可审计快照
  app.get('/api/market-environment', async (_req, res) => {
    try {
      res.json(await buildMarketEnvironmentSnapshot());
    } catch (error: any) {
      console.error('[market-environment] query failed:', error.message);
      res.status(503).json({ error: '市场环境快照暂不可用', detail: error.message, dataUnavailable: true });
    }
  });

  // GET /api/stock-industry-benchmark — 股票所属同花顺行业及其直接行业指数基准
  app.get('/api/stock-industry-benchmark', async (req, res) => {
    try {
      const symbol = String(req.query.symbol || '');
      if (!symbol) return res.status(400).json({ error: 'symbol is required' });
      res.json(await fetchStockIndustryBenchmark(symbol));
    } catch (error: any) {
      console.error('[industry-benchmark] query failed:', error.message);
      res.status(503).json({ error: '行业归属与基准暂不可用', detail: error.message, dataUnavailable: true });
    }
  });

  // GET /api/stock-industry-financial-percentiles - 全量行业成员财务缓存的渐进结果。
  app.get('/api/stock-industry-financial-percentiles', async (req, res) => {
    try {
      const symbol = String(req.query.symbol || '');
      if (!symbol) return res.status(400).json({ error: 'symbol is required' });
      res.json(await buildIndustryFinancialPercentiles(symbol));
    } catch (error: any) {
      console.error('[industry-financial-percentiles] query failed:', error.message);
      res.status(503).json({ error: '行业财务分位暂不可用', detail: safeRuntimeDataGap(error.message), dataUnavailable: true });
    }
  });

  // GET /api/stock-industry-chain-mapping — 业务到上下游与景气指标的可审计映射；不包含实时价格事实。
  app.get('/api/stock-industry-chain-mapping', async (req, res) => {
    try {
      const symbol = String(req.query.symbol || '');
      if (!symbol) return res.status(400).json({ error: 'symbol is required' });
      res.json(await buildIndustryChainMapping(symbol));
    } catch (error: any) {
      console.error('[industry-chain-mapping] query failed:', error.message);
      res.status(503).json({ error: '产业链业务映射暂不可用', detail: safeRuntimeDataGap(error.message), dataUnavailable: true });
    }
  });

  // GET /api/industry-chain-indicators — 已标准化的产业链指标；仅允许规则库中的行业链条。
  app.get('/api/industry-chain-indicators', async (req, res) => {
    try {
      const ruleId = String(req.query.ruleId || '');
      if (!INDUSTRY_CHAIN_RULES.some((rule) => rule.id === ruleId)) return res.status(400).json({ error: 'unknown industry-chain ruleId' });
      res.json(await fetchIndustryChainIndicators(ruleId));
    } catch (error: any) {
      console.error('[industry-chain-indicators] query failed:', error.message);
      res.status(503).json({ error: '产业链指标暂不可用', detail: safeRuntimeDataGap(error.message), dataUnavailable: true });
    }
  });

  // GET /api/stock-agents/industry-chain — 行业与产业链 Agent；AI 只解释冻结快照。
  app.get('/api/stock-agents/industry-chain', async (req, res) => {
    try {
      const symbol = String(req.query.symbol || '');
      if (!symbol) return res.status(400).json({ error: 'symbol is required' });
      const refresh = String(req.query.refresh || '') === '1';
      if (refresh) invalidateStockResearchCaches(symbol);
      res.json(await runIndustryChainAgent(symbol, refresh));
    } catch (error: any) {
      console.error('[industry-chain-agent] query failed:', error.message);
      res.status(503).json({ error: '行业与产业链 Agent 暂不可用', detail: safeRuntimeDataGap(error.message), dataUnavailable: true });
    }
  });

  // GET /api/stock-relative-strength — 个股相对上证指数与所属行业的同期超额收益
  app.get('/api/stock-relative-strength', async (req, res) => {
    try {
      const symbol = String(req.query.symbol || '');
      if (!symbol) return res.status(400).json({ error: 'symbol is required' });
      res.json(await buildStockRelativeStrength(symbol));
    } catch (error: any) {
      console.error('[relative-strength] query failed:', error.message);
      res.status(503).json({ error: '相对强弱计算暂不可用', detail: error.message, dataUnavailable: true });
    }
  });

  // GET /api/stock-technical-market-signals — 技术与市场 Agent 使用的纯确定性信号，不调用 AI
  app.get('/api/stock-technical-market-signals', async (req, res) => {
    try {
      const symbol = String(req.query.symbol || '');
      if (!symbol) return res.status(400).json({ error: 'symbol is required' });
      res.json(await buildTechnicalMarketSignals(symbol));
    } catch (error: any) {
      console.error('[technical-market-signals] query failed:', error.message);
      res.status(503).json({ error: '技术与市场确定性信号暂不可用', detail: error.message, dataUnavailable: true });
    }
  });

  // GET /api/stock-facts — 所有个股 Agent 共用的事实快照与证据 ID
  app.get('/api/stock-facts', async (req, res) => {
    try {
      const symbol = String(req.query.symbol || '');
      if (!symbol) return res.status(400).json({ error: 'symbol is required' });
      res.json(await buildStockFactSnapshot(symbol));
    } catch (error: any) {
      res.status(503).json({ error: error.message || '个股事实快照暂不可用', dataUnavailable: true });
    }
  });

  // GET /api/stock-valuation - 个股估值事实快照，不调用 AI
  app.get('/api/stock-valuation', async (req, res) => {
    try {
      const symbol = String(req.query.symbol || '');
      if (!symbol) return res.status(400).json({ error: 'symbol is required' });
      res.json(await buildStockValuationSnapshot(symbol));
    } catch (error: any) {
      console.error('[stock-valuation] query failed:', error.message);
      res.status(503).json({ error: '个股估值快照暂不可用', detail: error.message, dataUnavailable: true });
    }
  });

  // GET /api/stock-agents/fundamental — 基本面 Agent：确定性信号 + AI 证据化解释
  app.get('/api/stock-agents/fundamental', async (req, res) => {
    try {
      const symbol = String(req.query.symbol || '');
      if (!symbol) return res.status(400).json({ error: 'symbol is required' });
      res.json(await runFundamentalAgent(symbol, String(req.query.refresh || '') === '1'));
    } catch (error: any) {
      console.error('[fundamental-agent] query failed:', error.message);
      res.status(503).json({ error: '基本面 Agent 暂不可用', detail: error.message, dataUnavailable: true });
    }
  });

  // GET /api/stock-agents/event - 事件 Agent：只解释冻结事件快照，不预测价格
  app.get('/api/stock-agents/event', async (req, res) => {
    try {
      const symbol = String(req.query.symbol || '');
      if (!symbol) return res.status(400).json({ error: 'symbol is required' });
      const days = Number(req.query.days || 180);
      if (!Number.isInteger(days) || days < 1 || days > 365) return res.status(400).json({ error: 'days must be an integer between 1 and 365' });
      res.json(await runEventAgent(symbol, days, String(req.query.refresh || '') === '1'));
    } catch (error: any) {
      console.error('[event-agent] query failed:', error.message);
      res.status(503).json({ error: '事件 Agent 暂不可用', detail: error.message, dataUnavailable: true });
    }
  });

  // GET /api/stock-agents/sentiment - 舆情 Agent：只解释冻结舆情快照，不预测价格
  app.get('/api/stock-agents/sentiment', async (req, res) => {
    try {
      const symbol = String(req.query.symbol || '');
      if (!symbol) return res.status(400).json({ error: 'symbol is required' });
      const days = Number(req.query.days || 30);
      if (!Number.isInteger(days) || days < 1 || days > 90) return res.status(400).json({ error: 'days must be an integer between 1 and 90' });
      res.json(await runSentimentAgent(symbol, days, String(req.query.refresh || '') === '1'));
    } catch (error: any) {
      console.error('[sentiment-agent] query failed:', error.message);
      res.status(503).json({ error: '舆情 Agent 暂不可用', detail: error.message, dataUnavailable: true });
    }
  });

  // GET /api/stock-agents/risk-counter - 风险/反方 Agent：只解释冻结风险快照
  app.get('/api/stock-agents/risk-counter', async (req, res) => {
    try {
      const symbol = String(req.query.symbol || '');
      if (!symbol) return res.status(400).json({ error: 'symbol is required' });
      res.json(await runRiskCounterAgent(symbol, String(req.query.refresh || '') === '1'));
    } catch (error: any) {
      console.error('[risk-counter-agent] query failed:', error.message);
      res.status(503).json({ error: '风险/反方 Agent 暂不可用', detail: error.message, dataUnavailable: true });
    }
  });

  // GET /api/stock-agents/valuation - 估值 Agent：只解释冻结估值事实
  app.get('/api/stock-agents/valuation', async (req, res) => {
    try {
      const symbol = String(req.query.symbol || '');
      if (!symbol) return res.status(400).json({ error: 'symbol is required' });
      res.json(await runValuationAgent(symbol, String(req.query.refresh || '') === '1'));
    } catch (error: any) {
      console.error('[valuation-agent] query failed:', error.message);
      res.status(503).json({ error: '估值 Agent 暂不可用', detail: error.message, dataUnavailable: true });
    }
  });

  // GET /api/stock-agents/technical-market - 技术与市场 Agent：只解释确定性结构，不预测价格
  app.get('/api/stock-agents/technical-market', async (req, res) => {
    try {
      const symbol = String(req.query.symbol || '');
      if (!symbol) return res.status(400).json({ error: 'symbol is required' });
      res.json(await runTechnicalMarketAgent(symbol, String(req.query.refresh || '') === '1'));
    } catch (error: any) {
      console.error('[technical-market-agent] query failed:', error.message);
      res.status(503).json({ error: '技术与市场 Agent 暂不可用', detail: error.message, dataUnavailable: true });
    }
  });

  // GET /api/sectors - 东方财富真实板块数据，供 MarketMapTab 使用
  app.get('/api/sectors', async (_req, res) => {
    try {
      const marketData = await fetchMarketData();
      // marketData.sectors 来自东方财富板块API，包含 name + changePercent
      // 将板块数据映射为我们前端使用的格式
      const sectors = (marketData.sectors || []).map((s: any, i: number) => ({
        id: `sector-${i}`,
        name: s.name,
        changePercent: s.changePercent,
        description: '',
      }));
      res.json({ sectors, timestamp: marketData.timestamp });
    } catch (error: any) {
      console.error('[sectors] error:', error.message);
      res.status(503).json({ error: '板块数据获取失败', dataUnavailable: true });
    }
  });

  // 判断是否为A股交易时段（按上海时区，避免服务器本地时区偏移导致误判）
  function getMarketStatus() {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date());
    const part = (type: string) => Number(parts.find((item) => item.type === type)?.value || 0);
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(
      parts.find((item) => item.type === 'weekday')?.value || 'Sun',
    );
    const hour = part('hour');
    const minute = part('minute');
    const timeNum = hour * 100 + minute;

    // 周末不开盘
    if (day === 0 || day === 6) {
      return { isOpen: false, phase: 'weekend', label: '周末休市' };
    }

    // 周一至周五
    if (timeNum < 925) {
      return { isOpen: false, phase: 'preopen', label: '盘前准备中（9:30 开盘）' };
    } else if (timeNum >= 925 && timeNum < 1130) {
      return { isOpen: true, phase: 'morning', label: '交易中（上午盘）' };
    } else if (timeNum >= 1130 && timeNum < 1300) {
      return { isOpen: false, phase: 'lunch', label: '午间休市（13:00 开盘）' };
    } else if (timeNum >= 1300 && timeNum < 1500) {
      return { isOpen: true, phase: 'afternoon', label: '交易中（下午盘）' };
    } else {
      return { isOpen: false, phase: 'closed', label: '已收盘' };
    }
  }

  // GET /api/market-overview — rule engine, no AI
  app.get('/api/market-overview', async (_req, res) => {
    try {
      const marketData = await fetchMarketData();

      // 如果没有任何数据，直接返回错误而非硬编码假数据
      if (!marketData.indices || marketData.indices.length === 0) {
        return res.status(503).json({
          error: '当前行情数据获取失败，请稍后重试',
          dataUnavailable: true,
        });
      }

      const sortedSectors = [...marketData.sectors].sort((a: any, b: any) => b.changePercent - a.changePercent);
      const upCount = sortedSectors.filter((s: any) => s.changePercent > 0).length;
      const downCount = sortedSectors.filter((s: any) => s.changePercent < 0).length;
      const totalSectors = sortedSectors.length;
      // 市场宽度 = 上涨板块占比
      const breadthRatio = totalSectors > 0 ? Math.round((upCount / totalSectors) * 100) : 50;
      const marketTemperature = calculateMarketTemperature(marketData);

      res.json({
        indices: marketData.indices.map((i: any) => ({
          name: i.name,
          code: i.code,
          price: i.price,
          changePercent: i.changePercent,
        })),
        topSectors: sortedSectors.slice(0, 3),
        bottomSectors: sortedSectors.slice(-3).reverse(),
        marketBreath: { up: upCount, down: downCount, breadthRatio },
        totalVolume: marketData.marketPulse.turnoverAmount || marketData.volume,
        marketTemperature,
        timestamp: marketData.timestamp,
        sourceMeta: marketData.sourceMeta || null,
        marketStatus: getMarketStatus(),
      });
    } catch (error: any) {
      console.error('[market-overview] error:', error.message);
      res.status(503).json({
        error: '当前行情数据获取失败，请稍后重试',
        dataUnavailable: true,
      });
    }
  });

  // Market Map Helpers
  function sectorNewsMatches(s, src) {
    const n = s.replace(/[行业板块概念]/g,'').trim();
    const a = [n, s].filter(Boolean).flatMap(t => [t, t.slice(0, Math.min(4, t.length))]);
    return (src||[]).filter(x => a.some(y => x.title && x.title.includes(y))).slice(0,3);
  }
  function inferRelatedChain(s) {
    const rs = [
      {m:/AI|人工智能|算力/i, c:['芯片','服务器','光模块','AI应用']},
      {m:/半导体|芯片/i, c:['设备','芯片设计','封测','电子材料']},
      {m:/机器人/i, c:['减速器','伺服电机','机器视觉','工业软件']},
      {m:/电力|电网/i, c:['燃料与发电','电网','储能','用电需求']},
      {m:/新能源|锂电|光伏/i, c:['上游材料','电池/组件','整机','充储能']},
      {m:/黄金|有色|稀土/i, c:['资源供给','现货价格','冶炼加工','下游需求']},
      {m:/证券|银行|保险/i, c:['流动性','资本市场活跃度','金融机构','风险偏好']},
    ];
    return rs.find(r => r.m.test(s))?.c || ['上游供给','行业需求',s];
  }
  function buildMarketMapIntelligence(md) {
    const all = (md.sectors||[])
      .map((s,i) => ({id: s.code ? (s.category+'-'+s.code) : 'sector-'+i, name: String(s.name||'').trim(), category: s.category==='concept'?'concept':'industry', changePercent: Number(s.changePercent)||0, turnoverAmount: Number.isFinite(Number(s.turnoverAmount))?Number(s.turnoverAmount):null}))
      .filter(s => s.name);
    const ranked = [...all].sort((a,b) => Math.abs(b.changePercent)-Math.abs(a.changePercent));
    const th = Math.max(2.5, [...all.map(s => Math.abs(s.changePercent))].sort((a,b) => a-b)[Math.floor(all.length*0.9)]||0);
    return all.map(s => {
      const r = ranked.findIndex(x => x.id === s.id)+1, m = s.changePercent>0&&r<=3, sc = Math.round(Math.min(100,Math.max(0,Math.abs(s.changePercent)*15+Math.max(0,16-r)+(m?14:0))));
      const t = [];
      if(m) t.push('今日主线');
      if(Math.abs(s.changePercent) >= th) t.push('异动上涨');
      if(sectorNewsMatches(s.name,md.newsItems||[]).length) t.push('新闻驱动');
      if(!m) t.push('值得观察');
      const n = sectorNewsMatches(s.name,md.newsItems||[]);
      const category = s.category === 'concept' ? 'concept' : 'industry';
      const sectorCode = String(s.code || '').trim();
      return {sectorId: sectorCode ? `${category}-${sectorCode}` : `${category}-${s.name}`, sector: s.name, category, change: (s.changePercent>=0?'+':'')+s.changePercent.toFixed(2)+'%', changePercent: s.changePercent, turnoverAmount: s.turnoverAmount, turnoverChange: null, volumeChange: null, signalTags: t.slice(0,3), signalTypes: [], isAnomaly: Math.abs(s.changePercent)>=th, anomalyReason: Math.abs(s.changePercent)>=th?'今日涨跌幅度较大，需要关注':null, analysisSource: 'rule', evidenceStatus: n.length?'partially_verified':'market_data_only', importanceScore: sc, shouldHighlight: sc>=55||m, beginnerExplanation: s.name+'今日'+(s.changePercent>=0?'上涨':'下跌')+Math.abs(s.changePercent).toFixed(2)+'%', professionalSummary: s.name+(s.changePercent>=0?'上涨':'下跌')+Math.abs(s.changePercent).toFixed(2)+'%，重要度'+sc+'分', relatedNews: n, relatedChain: inferRelatedChain(s.name), dataNotes: ['重要度由涨跌异动、排行和新闻关联共同计算。']};
    }).sort((a,b) => b.importanceScore-a.importanceScore);
  }
  const MARKET_MAP_CACHE_TTL = 15 * 60 * 1000;
  let marketMapCache: { expiresAt: number; value: any } | null = null;
  app.get('/api/market-map/intelligence', async (_req, res) => {
    if (marketMapCache && marketMapCache.expiresAt > Date.now()) return res.json(marketMapCache.value);
    try {
      const md = await fetchMarketData(); const s = buildMarketMapIntelligence(md);
      if(!s.length) return res.status(503).json({error:'暂无可用的板块数据',dataUnavailable:true});
      const value = {market:'CN',generatedAt:new Date().toISOString(),timestamp:md.timestamp,sectors:s};
      marketMapCache = { expiresAt: Date.now() + MARKET_MAP_CACHE_TTL, value };
      res.json(value);
    }
    catch(e) { console.error('[market-map]',e.message); res.status(503).json({error:'市场地图信号生成失败',dataUnavailable:true}); }
  });
  // Fetch K-line data for a sector (5d, 20d, 3m changes)
  async function fetchSectorKline(bkCode) {
    var hosts = ['push2his.eastmoney.com', 'push2.eastmoney.com', '59.push2.eastmoney.com'];
    var url = '/api/qt/stock/kline/get?secid=90.' + bkCode + '&fields1=f1&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&end=20500101&lmt=120';
    for (var i = 0; i < hosts.length; i++) {
      try {
        var data = await httpGetJSON('http://' + hosts[i] + url);
        if (data && data.data && data.data.klines && data.data.klines.length > 0) {
          var klines = data.data.klines.map(function(k) {
            var parts = k.split(',');
            return { date: parts[0], open: parseFloat(parts[1]), close: parseFloat(parts[2]), high: parseFloat(parts[3]), low: parseFloat(parts[4]), volume: parseInt(parts[5]) || 0, amount: parseFloat(parts[6]) || 0 };
          }).filter(function(k) { return k.close > 0; });
          if (klines.length < 2) continue;
          var latest = klines[klines.length - 1];
          var change5d = null, change20d = null, change3m = null, volumeSum = 0, volumeCount = 0;
          if (klines.length >= 5) { change5d = ((latest.close / klines[klines.length - 5].close) - 1) * 100; }
          if (klines.length >= 20) { change20d = ((latest.close / klines[klines.length - 20].close) - 1) * 100; }
          if (klines.length >= 60) { change3m = ((latest.close / klines[klines.length - 60].close) - 1) * 100; }
          // Average volume for turnoverHeat
          for (var j = Math.max(0, klines.length - 20); j < klines.length; j++) { if (klines[j].amount > 0) { volumeSum += klines[j].amount; volumeCount++; } }
          var avgAmount = volumeCount > 0 ? volumeSum / volumeCount : null;
          return { change5d: change5d, change20d: change20d, change3m: change3m, todayAmount: latest.amount, avg20dAmount: avgAmount };
        }
      } catch(e) {}
    }
    return { change5d: null, change20d: null, change3m: null, todayAmount: null, avg20dAmount: null };
  }

  // Fetch real stocks for a sector from East Money
  async function fetchSectorStocks(bkCode) {
    try {
      const r = await httpGetJSON('http://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=10&po=1&np=1&fltt=2&invt=2&fid=f3&fs=b:' + bkCode + '%2Bf:!50&fields=f2,f3,f4,f6,f12,f14,f20,f25');
      return (r.data && r.data.diff) ? r.data.diff.map(function(st) {
        return {
          code: String(st.f12 || ''),
          name: String(st.f14 || ''),
          changePercent: Number(st.f3) || 0,
          turnoverAmount: Number.isFinite(Number(st.f6)) ? Number(st.f6) : null,
          totalMarketCap: Number.isFinite(Number(st.f20)) ? Math.round(Number(st.f20) / 100000000) : null,
          isLeader: false
        };
      }).sort(function(a, b) { return b.changePercent - a.changePercent; }) : [];
    } catch(e) { return []; }
  }

  // ─── Prompt 5: 泡泡精选板块筛选 ───

  // 板块内部广度。注意：clist 带 fid=f3 是按涨幅降序返回的，只取第一页会让上涨占比
  // 系统性偏高，因此这里按 total 翻页取回全部成分股；超过 PAGE_CAP 页时视为样本不完整，
  // upStockRatio 返回 null，让 P5 明确按"缺少内部数据"降分，而不是拿偏差数据打分。
  const BREADTH_PAGE_SIZE = 100;
  const BREADTH_PAGE_CAP = 4;

  async function fetchSectorBreadth(bkCode: string, options: { full?: boolean } = {}) {
    const empty = {
      upStockRatio: null as number | null,
      sampleSize: 0,
      limitUpCount: null as number | null,
      leaderContribution: null as number | null,
      dispersion: null as number | null,
      sampleCoverage: null as number | null,
      sampleComplete: false,
      totalCount: 0,
      upCount: 0,
      downCount: 0,
      flatCount: 0,
      medianChange: null as number | null,
      dataStatus: 'unavailable' as 'available' | 'partial' | 'unavailable' | 'empty',
      dataError: '未提供板块编码' as string | null,
      stocks: [] as Array<{ code: string; name: string; changePercent: number; turnoverAmount: number | null; turnoverRate: number | null; volumeRatio: number | null; totalMarketCap: number | null }>,
    };
    if (!bkCode) return empty;
    const hosts = ['push2delay.eastmoney.com', 'push2.eastmoney.com', '59.push2.eastmoney.com', '70.push2.eastmoney.com'];
    const buildUrl = (host: string, page: number) =>
      `http://${host}/api/qt/clist/get?pn=${page}&pz=${BREADTH_PAGE_SIZE}`
      + `&po=1&np=1&fltt=2&invt=2&fid=f3&fs=b:${bkCode}%2Bf:!50&fields=f3,f6,f8,f10,f12,f14,f20`;
    let lastError = '成分股数据源未返回有效数据';
    for (const host of hosts) {
      try {
      const first = await httpGetJSON(buildUrl(host, 1));
      const total = Number(first?.data?.total || 0);
      const rows: any[] = [...(first?.data?.diff || [])];
      if (!rows.length) { lastError = `${host} 未返回成分股`; continue; }
      const pages = Math.ceil(total / BREADTH_PAGE_SIZE);
      // Summary cards deliberately use a capped sample. Detail pages opt into a
      // complete, minimal-field scan so breadth never treats a ranked sample as a full sector.
      const pageLimit = options.full ? pages : Math.min(pages, BREADTH_PAGE_CAP);
      if (pages > 1) {
        for (let pageStart = 2; pageStart <= pageLimit; pageStart += 3) {
          const rest = await Promise.all(
            Array.from({ length: Math.min(3, pageLimit - pageStart + 1) },
              (_, i) => httpGetJSON(buildUrl(host, pageStart + i)).catch(() => null)),
          );
          for (const r of rest) if (r?.data?.diff) rows.push(...r.data.diff);
        }
      }
      const stocks = [...new Map(
        rows.filter((r) => r?.f12 && Number.isFinite(Number(r?.f3)))
          .map((r) => [String(r.f12), {
            code: String(r.f12), name: String(r.f14 || ''), changePercent: Number(r.f3),
            turnoverAmount: Number.isFinite(Number(r.f6)) ? Number(r.f6) : null,
            turnoverRate: Number.isFinite(Number(r.f8)) ? Number(r.f8) : null,
            volumeRatio: Number.isFinite(Number(r.f10)) ? Number(r.f10) : null,
            totalMarketCap: Number.isFinite(Number(r.f20)) ? Number(r.f20) : null,
          }]),
      )].map(([, stock]) => stock);
      if (!stocks.length) { lastError = `${host} 返回的数据缺少有效涨跌幅`; continue; }

      // 取回比例不足九成时不给出 upStockRatio，避免用涨幅榜头部冒充板块整体
      const sampleCoverage = total > 0 ? round2((stocks.length / total) * 100) : null;
      const sampleComplete = total > 0 && stocks.length >= total * 0.99;
      const up = stocks.filter((s) => s.changePercent > 0).length;
      const down = stocks.filter((s) => s.changePercent < 0).length;
      const flat = stocks.length - up - down;
      const totalAbs = stocks.reduce((sum, s) => sum + Math.abs(s.changePercent), 0);
      const top3Abs = [...stocks]
        .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))
        .slice(0, 3)
        .reduce((sum, s) => sum + Math.abs(s.changePercent), 0);
      const orderedChanges = stocks.map((s) => s.changePercent).sort((a, b) => a - b);
      const percentile = (ratio: number) => orderedChanges[Math.min(orderedChanges.length - 1, Math.max(0, Math.round((orderedChanges.length - 1) * ratio)))];
      return {
        upStockRatio: sampleComplete ? Math.round((up / stocks.length) * 100) : null,
        sampleSize: stocks.length,
        totalCount: total,
        upCount: up,
        downCount: down,
        flatCount: flat,
        medianChange: orderedChanges.length ? round2(orderedChanges[Math.floor(orderedChanges.length / 2)]) : null,
        limitUpCount: stocks.filter((s) => s.changePercent >= 9.8).length,
        leaderContribution: totalAbs > 0 ? Math.round((top3Abs / totalAbs) * 100) : null,
        dispersion: orderedChanges.length >= 5 ? round2(percentile(0.9) - percentile(0.1)) : null,
        sampleCoverage,
        sampleComplete,
        dataStatus: (sampleComplete ? 'available' : 'partial') as 'available' | 'partial',
        dataError: null,
        stocks,
      };
      } catch (error: any) {
        lastError = `${host} 请求失败：${error?.message || '未知错误'}`;
      }
    }
    console.warn(`[sector-breadth] ${bkCode}: ${lastError}`);
    return { ...empty, dataError: lastError };
  }

  // P5 新闻检索使用东财相关度排序，而不是全站时间排序；后者会忽略关键词。
  const SECTOR_NEWS_KEYWORDS: Record<string, string> = {
    种子: '种业',
    种植业: '种业',
    氦气概念: '氦气',
    化学制品: '化工',
  };
  const SECTOR_NEWS_SKIP = [/连板/, /涨停/, /炸板/, /打板/, /首板/, /昨日/, /^ST/];
  const PRICE_RECAP = /涨停|涨超|跌超|领涨|领跌|拉升|探底|回升|走强|走弱|走高|走低|大涨|大跌|冲高|异动|飘红|收涨|收跌|盘中|快评|复盘|收评|午评|多股/;
  const FACTUAL_NEWS = /政策|规划|实施|发布|公告|获批|签署|中标|订单|产能|停产|复产|价格|涨价|降价|出口|进口|供给|需求|库存|业绩|营收|利润|数据|禁止|批准|回应/;

  function sectorNewsKeyword(sectorName: string): string | null {
    const base = sectorName.split('_')[0].trim();
    if (!base || SECTOR_NEWS_SKIP.some((rule) => rule.test(base))) return null;
    return SECTOR_NEWS_KEYWORDS[base] || base.replace(/(概念|板块|行业|指数)$/, '').trim() || null;
  }

  function isPriceRecap(title: string): boolean {
    return PRICE_RECAP.test(title) && !FACTUAL_NEWS.test(title);
  }

  // 多家媒体转述同一事件不能累加为多件证据。先按公司主体或政策动作做保守归并；
  // 无法确认同源时保留，避免把真实的不同事件误删。
  function newsEventKey(title: string): string {
    const normalized = title.replace(/[“”"'‘’]/g, '').replace(/\s+/g, '').trim();
    const actionStart = normalized.search(/禁止|暂停|恢复/);
    if (actionStart >= 0) {
      const tradeClause = normalized.slice(actionStart).split(/[，。！？:：]/)[0];
      const direction = tradeClause.includes('进口') ? '进口' : tradeClause.includes('出口') ? '出口' : '';
      const subject = normalized.slice(0, actionStart).replace(/[^\u4e00-\u9fa5]/g, '');
      if (direction && subject.length >= 2) return `trade:${subject}:${direction}`;
      const directionIndex = direction ? tradeClause.indexOf(direction) + direction.length : 0;
      const materials = tradeClause.slice(0, directionIndex)
        .replace(/^(禁止|暂停|恢复)/, '')
        .replace(/出口|进口|精矿|[、和]/g, '')
        .replace(/[^\u4e00-\u9fa5]/g, '');
      if (direction && materials) return `trade:${direction}:${materials}`;
    }
    const action = normalized.match(/(禁止|暂停|恢复|实施|发布|批准|上调|下调)[^，。！？:：]{0,18}(出口|进口|生产|供应|项目|投资|建设|产能)/)?.[0];
    if (action) return `action:${action.replace(/精矿/g, '').replace(/[、和]/g, '')}`;
    const entity = normalized.match(/^([^：:，,。！？]{2,18})[：:]/)?.[1];
    if (entity) return `entity:${entity}`;
    return `title:${normalized}`;
  }

  async function fetchEastMoneySectorNews(sectorName: string): Promise<Array<{ id: string; title: string; sourceName: string }>> {
    const keyword = sectorNewsKeyword(sectorName);
    if (!keyword) return [];
    const params = {
      uid: '', keyword, type: ['cmsArticleWebOld'], client: 'web', clientType: 'web', clientVersion: 'curr',
      param: { cmsArticleWebOld: { searchScope: 'default', sort: 'default', pageIndex: 1, pageSize: 6, preTag: '', postTag: '' } },
    };
    try {
      const url = `https://search-api-web.eastmoney.com/search/jsonp?cb=bubbleNews&param=${encodeURIComponent(JSON.stringify(params))}`;
      const raw = await httpGetText(url, 'https://so.eastmoney.com/');
      const start = raw.indexOf('(');
      const end = raw.lastIndexOf(')');
      if (start < 0 || end <= start) return [];
      const parsed = JSON.parse(raw.slice(start + 1, end));
      const articles = parsed?.result?.cmsArticleWebOld || [];
      const seenTitles = new Set<string>();
      const seenEvents = new Set<string>();
      const result: Array<{ id: string; title: string; sourceName: string }> = [];
      for (const [index, article] of articles.entries()) {
          const title = String(article?.title || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
          const eventKey = newsEventKey(title);
          if (!title || isPriceRecap(title) || seenTitles.has(title) || seenEvents.has(eventKey)) continue;
          seenTitles.add(title);
          seenEvents.add(eventKey);
          result.push({ id: `em-news-${sectorName}-${index + 1}`, title, sourceName: String(article?.mediaName || '东方财富') });
          if (result.length >= 2) break;
      }
      return result;
    } catch (error: any) {
      console.warn(`[bubble-selection] EastMoney news failed for ${sectorName}: ${error.message}`);
      return [];
    }
  }

  type BubbleCandidate = {
    name: string;
    code: string;
    changePercent: number;
    rank: number;
    change5d: number | null;
    change20d: number | null;
    todayTurnover: number | null;
    avg20dTurnover: number | null;
    turnoverChangePercent: number | null;
    upStockRatio: number | null;
    sampleSize: number;
    limitUpCount: number | null;
    leaderContribution: number | null;
    relatedNews: Array<{ id: string; title: string; sourceName: string }>;
  };

  const BUBBLE_CANDIDATE_COUNT = 10;
  const round2 = (value: number) => Math.round(value * 100) / 100;

  // 每个候选补 1 次 K 线 + 最多 4 次成分股分页。并发限 3，避免对东财瞬时压力过大。
  async function buildBubbleCandidates(
    marketData: Awaited<ReturnType<typeof fetchMarketData>>,
  ): Promise<BubbleCandidate[]> {
    const all = (marketData.sectors || [])
      .map((s: any) => ({
        name: String(s?.name || '').trim(),
        code: String(s?.code || ''),
        changePercent: Number(s?.changePercent) || 0,
      }))
      .filter((s) => s.name);
    const ranked = [...all].sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));
    const picked = ranked.slice(0, BUBBLE_CANDIDATE_COUNT);
    const out: BubbleCandidate[] = [];

    for (let i = 0; i < picked.length; i += 3) {
      const batch = picked.slice(i, i + 3);
      const enriched = await Promise.all(batch.map(async (sector) => {
        const [kline, breadth, relatedNews] = await Promise.all([
          sector.code ? fetchSectorKline(sector.code) : Promise.resolve(null),
          sector.code ? fetchSectorBreadth(sector.code) : Promise.resolve(null),
          fetchEastMoneySectorNews(sector.name),
        ]);
        const todayTurnover = Number.isFinite(Number(kline?.todayAmount)) ? Number(kline.todayAmount) : null;
        const avg20dTurnover = Number.isFinite(Number(kline?.avg20dAmount)) ? Number(kline.avg20dAmount) : null;
        return {
          name: sector.name,
          code: sector.code,
          changePercent: sector.changePercent,
          rank: ranked.findIndex((r) => r.name === sector.name) + 1,
          change5d: Number.isFinite(Number(kline?.change5d)) ? round2(Number(kline.change5d)) : null,
          change20d: Number.isFinite(Number(kline?.change20d)) ? round2(Number(kline.change20d)) : null,
          todayTurnover,
          avg20dTurnover,
          turnoverChangePercent: todayTurnover !== null && avg20dTurnover ? round2(((todayTurnover / avg20dTurnover) - 1) * 100) : null,
          upStockRatio: breadth?.upStockRatio ?? null,
          sampleSize: breadth?.sampleSize ?? 0,
          limitUpCount: breadth?.limitUpCount ?? null,
          leaderContribution: breadth?.leaderContribution ?? null,
          relatedNews,
        } satisfies BubbleCandidate;
      }));
      out.push(...enriched);
    }
    return out;
  }

  type BubbleSignalItem = {
    sectorName: string;
    bubbleScore: number;
    scoreBreakdown: { anomaly: number; health: number; capitalAttention: number; eventSupport: number };
    todayChange: string;
    signalType: 'trend_start' | 'trend_continue' | 'leader_driven' | 'event_driven' | 'price_only';
    healthStatus: 'broad_rise' | 'leader_driven' | 'divergence';
    rankReason: string;
    metrics: { priceChange: string; upStockRatio: string; volumeChange: string };
    supportingSignals: string[];
    riskSignals: string[];
    evidence: Array<{ id: string; title: string; sourceName: string }>;
    mergedSectors: string[];
    bubbleExplanation: string;
    confidence: ConfidenceLevel;
  };

  const BUBBLE_SELECTION_LIMIT = 6;

  function normalizeBubbleSelection(raw: unknown, candidates: BubbleCandidate[]): BubbleSignalItem[] {
    if (!Array.isArray(raw)) return [];
    const byName = new Map(candidates.map((c) => [c.name, c]));
    const candidateNames = new Set(byName.keys());
    const validSignals = new Set(['trend_start', 'trend_continue', 'leader_driven', 'event_driven', 'price_only']);
    const validHealth = new Set(['broad_rise', 'leader_driven', 'divergence']);
    const validConfidence = new Set<ConfidenceLevel>(['high', 'medium', 'limited']);
    const clamp = (value: unknown, max: number) => {
      const num = Number(value);
      if (!Number.isFinite(num)) return 0;
      return Math.min(max, Math.max(0, Math.round(num)));
    };
    const seen = new Set<string>();
    const items: BubbleSignalItem[] = [];

    for (const entry of raw as any[]) {
      const sectorName = String(entry?.sectorName || '').trim();
      const candidate = byName.get(sectorName);
      // 只接受候选集中真实存在的板块，杜绝凭空生成板块名
      if (!candidate || seen.has(sectorName)) continue;
      seen.add(sectorName);

      const hasNews = candidate.relatedNews.length > 0;
      const breakdown = entry?.scoreBreakdown;
      let anomaly = clamp(breakdown?.anomaly, 30);
      let health = clamp(breakdown?.health, 25);
      let capitalAttention = clamp(breakdown?.capitalAttention, 20);
      let eventSupport = clamp(breakdown?.eventSupport, 25);

      // 服务端强制执行 prompt 中的数据缺失上限，不依赖模型自觉
      if (candidate.change5d === null && candidate.change20d === null) anomaly = Math.min(anomaly, 20);
      if (candidate.upStockRatio === null) health = Math.min(health, 10);
      if (candidate.turnoverChangePercent === null) capitalAttention = Math.min(capitalAttention, 6);
      if (!hasNews) eventSupport = Math.min(eventSupport, 7);
      if (candidate.relatedNews.length < 2) eventSupport = Math.min(eventSupport, 22);

      let signalType = validSignals.has(entry?.signalType) ? entry.signalType : 'price_only';
      if (signalType === 'event_driven' && !hasNews) signalType = 'price_only';
      let healthStatus = validHealth.has(entry?.healthStatus) ? entry.healthStatus : 'divergence';
      if (candidate.upStockRatio === null) healthStatus = 'divergence';

      let confidence: ConfidenceLevel = validConfidence.has(entry?.confidence) ? entry.confidence : 'limited';
      const missingCount = [candidate.upStockRatio === null, candidate.turnoverChangePercent === null, !hasNews]
        .filter(Boolean).length;
      if (missingCount >= 2) confidence = 'limited';
      else if (missingCount === 1 && confidence === 'high') confidence = 'medium';

      const newsIds = new Set(candidate.relatedNews.map((n) => n.id));
      const evidence = Array.isArray(entry?.evidenceIds)
        ? [...new Set<string>(entry.evidenceIds.map(String).filter((id: string) => newsIds.has(id)))]
            .map((id) => candidate.relatedNews.find((n) => n.id === id)!)
        : [];

      const signed = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
      items.push({
        sectorName,
        bubbleScore: anomaly + health + capitalAttention + eventSupport,
        scoreBreakdown: { anomaly, health, capitalAttention, eventSupport },
        todayChange: signed(candidate.changePercent),
        signalType,
        healthStatus,
        rankReason: sanitizeTeacherText(entry?.rankReason, 60),
        // metrics 一律由服务端用真实候选数据覆写，不采用模型自报的数字
        metrics: {
          priceChange: signed(candidate.changePercent),
          upStockRatio: candidate.upStockRatio === null ? '暂无数据' : `${candidate.upStockRatio}%`,
          volumeChange: candidate.turnoverChangePercent === null
            ? '暂无数据'
            : signed(candidate.turnoverChangePercent),
        },
        supportingSignals: normalizeTextList(entry?.supportingSignals, 3, 40),
        riskSignals: normalizeTextList(entry?.riskSignals, 3, 40),
        evidence,
        mergedSectors: Array.isArray(entry?.mergedSectors)
          ? [...new Set<string>(entry.mergedSectors.map(String)
              .filter((name: string) => candidateNames.has(name) && name !== sectorName))].slice(0, 4)
          : [],
        bubbleExplanation: sanitizeTeacherText(entry?.bubbleExplanation, 120),
        confidence,
      });
    }
    return items
      .sort((a, b) => b.bubbleScore - a.bubbleScore)
      .slice(0, BUBBLE_SELECTION_LIMIT);
  }

  // 同主题近义板块去重。P5 走 AI 语义判断，规则兜底没有语义能力，
  // 这里用板块名的包含关系和公共前缀做启发式合并，避免"昨日连板"和"昨日连板_含一字"同时占位。
  // 前缀阈值取 3 是为了避免误合并：白银/白酒 只共享 1 字不会合并，
  // 半导体材料/半导体设备 共享"半导体"会合并。
  const THEME_PREFIX_MIN = 3;

  function themeKey(name: string): string {
    // 去掉分类后缀和下划线补充说明，"昨日连板_含一字" -> "昨日连板"
    return name.split('_')[0].replace(/(行业|板块|概念|指数)$/g, '').trim();
  }

  function dedupeByTheme(items: BubbleSignalItem[]): BubbleSignalItem[] {
    const kept: BubbleSignalItem[] = [];
    for (const item of items) {
      const key = themeKey(item.sectorName);
      const host = kept.find((k) => {
        const hostKey = themeKey(k.sectorName);
        if (hostKey === key || hostKey.includes(key) || key.includes(hostKey)) return true;
        const shorter = Math.min(hostKey.length, key.length);
        if (shorter < THEME_PREFIX_MIN) return false;
        return hostKey.slice(0, THEME_PREFIX_MIN) === key.slice(0, THEME_PREFIX_MIN);
      });
      // items 已按分数降序，先到的即为该主题内分数最高者，后来的并入其 mergedSectors
      if (host) {
        if (host.mergedSectors.length < 4) host.mergedSectors.push(item.sectorName);
        continue;
      }
      kept.push(item);
    }
    return kept;
  }

  // AI 不可用时的规则兜底：同样只用真实候选数据，分项遵守与 P5 一致的缺失上限
  function fallbackBubbleSelection(candidates: BubbleCandidate[]): BubbleSignalItem[] {
    const signed = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
    const scored = candidates
      .map((candidate) => {
        const absChange = Math.abs(candidate.changePercent);
        const hasNews = candidate.relatedNews.length > 0;
        const hasTrend = candidate.change5d !== null || candidate.change20d !== null;
        const turnover = candidate.turnoverChangePercent;

        let anomaly = Math.min(30, Math.round(absChange * 5 + Math.max(0, 11 - candidate.rank)));
        if (!hasTrend) anomaly = Math.min(anomaly, 20);
        let health = candidate.upStockRatio === null
          ? 10
          : Math.min(25, Math.round((candidate.upStockRatio / 100) * 25));
        let capitalAttention = turnover === null
          ? 6
          : Math.min(20, Math.max(0, Math.round(10 + turnover / 10)));
        const eventSupport = hasNews ? Math.min(17, 8 + candidate.relatedNews.length * 3) : 4;

        const leaderHeavy = (candidate.leaderContribution ?? 0) >= 55;
        const healthStatus: BubbleSignalItem['healthStatus'] = candidate.upStockRatio === null
          ? 'divergence'
          : candidate.upStockRatio >= 65 && !leaderHeavy
            ? 'broad_rise'
            : leaderHeavy ? 'leader_driven' : 'divergence';
        const signalType: BubbleSignalItem['signalType'] = hasNews
          ? 'event_driven'
          : healthStatus === 'leader_driven'
            ? 'leader_driven'
            : (candidate.change20d ?? 0) > 0 && (candidate.change5d ?? 0) > 0
              ? 'trend_continue'
              : turnover !== null && turnover > 20 ? 'trend_start' : 'price_only';

        const riskSignals: string[] = [];
        if (candidate.upStockRatio === null) riskSignals.push('缺少板块内部涨跌家数数据');
        if (turnover === null) riskSignals.push('缺少成交额数据，资金关注度无法验证');
        if (!hasNews) riskSignals.push('暂无相关新闻，变化原因待确认');

        return {
          sectorName: candidate.name,
          bubbleScore: anomaly + health + capitalAttention + eventSupport,
          scoreBreakdown: { anomaly, health, capitalAttention, eventSupport },
          todayChange: signed(candidate.changePercent),
          signalType,
          healthStatus,
          rankReason: `涨跌幅市场排名第${candidate.rank}，由规则引擎给出`,
          metrics: {
            priceChange: signed(candidate.changePercent),
            upStockRatio: candidate.upStockRatio === null ? '暂无数据' : `${candidate.upStockRatio}%`,
            volumeChange: turnover === null ? '暂无数据' : signed(turnover),
          },
          supportingSignals: [`板块今日${candidate.changePercent >= 0 ? '上涨' : '下跌'}${absChange.toFixed(2)}%`],
          riskSignals: riskSignals.slice(0, 3),
          evidence: candidate.relatedNews.slice(0, 3),
          mergedSectors: [],
          bubbleExplanation: `${candidate.name}今日${candidate.changePercent >= 0 ? '上涨' : '下跌'}`
            + `${absChange.toFixed(2)}%，涨跌幅排名第${candidate.rank}。当前结论由规则计算得出，尚未经过 AI 解释。`,
          confidence: 'limited' as ConfidenceLevel,
        } satisfies BubbleSignalItem;
      })
      .sort((a, b) => b.bubbleScore - a.bubbleScore);
    // 先排序再去重，保证每个主题保留的是分数最高的那个板块
    return dedupeByTheme(scored).slice(0, BUBBLE_SELECTION_LIMIT);
  }

  let bubbleSelectionCache: { data: any; timestamp: number } | null = null;
  let bubbleSelectionPromise: Promise<any> | null = null;
  const BUBBLE_CACHE_TTL = 15 * 60 * 1000;

  // GET /api/bubble-selection — Prompt 5，泡泡精选板块
  app.get('/api/bubble-selection', async (_req, res) => {
    const now = Date.now();
    if (bubbleSelectionCache && (now - bubbleSelectionCache.timestamp) < BUBBLE_CACHE_TTL) {
      return res.json(bubbleSelectionCache.data);
    }
    // 缓存过期期间的并发请求共享同一次生成，避免重复打东财和 AI
    if (bubbleSelectionPromise) {
      try {
        return res.json(await bubbleSelectionPromise);
      } catch (e: any) {
        console.error('[bubble-selection] shared generation failed:', e.message);
      }
    }

    const startedAt = Date.now();
    const task = (async () => {
      const marketData = await fetchMarketData();
      if (!marketData.sectors?.length) {
        const err: any = new Error('sectors unavailable');
        err.dataUnavailable = true;
        throw err;
      }
      const candidates = await buildBubbleCandidates(marketData);
      console.log(`[bubble-selection] enriched ${candidates.length} candidates`);

      let selection: BubbleSignalItem[] = [];
      let fallback = false;
      try {
        // 只传 P5 评分真正需要的字段，避免重复传输服务端会覆写的指标和冗余行情对象。
        const p5Candidates = candidates.map((candidate) => ({
          name: candidate.name,
          changePercent: candidate.changePercent,
          rank: candidate.rank,
          change5d: candidate.change5d,
          change20d: candidate.change20d,
          turnoverChangePercent: candidate.turnoverChangePercent,
          upStockRatio: candidate.upStockRatio,
          sampleSize: candidate.sampleSize,
          limitUpCount: candidate.limitUpCount,
          leaderContribution: candidate.leaderContribution,
          relatedNews: candidate.relatedNews.slice(0, 2),
        }));
        const p5Input = JSON.stringify({
          marketDate: new Date(marketData.timestamp).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }),
          candidates: p5Candidates,
        });
        const p5Raw = await callAI(PROMPT_5_SYSTEM, p5Input, 0.1, P5_MAX_TOKENS, 'disabled');
        selection = normalizeBubbleSelection(parseAIJson(p5Raw)?.bubbleSelection, candidates);
      } catch (error: any) {
        console.error('[bubble-selection] P5 failed:', error.message);
      }
      if (!selection.length) {
        selection = fallbackBubbleSelection(candidates);
        fallback = true;
      }

      const result = {
        bubbleSelection: selection,
        candidateCount: candidates.length,
        promptVersion: 'p5-bubble-signal-v2',
        fallback,
        timestamp: marketData.timestamp,
      };
      console.log(`[bubble-selection] completed in ${((Date.now() - startedAt) / 1000).toFixed(1)}s, fallback=${fallback}`);
      bubbleSelectionCache = { data: result, timestamp: Date.now() };
      return result;
    })();

    bubbleSelectionPromise = task;
    try {
      res.json(await task);
    } catch (error: any) {
      console.error('[bubble-selection] error:', error.message);
      res.status(503).json({
        error: error.dataUnavailable ? '板块数据获取失败，请稍后重试' : '泡泡精选生成失败，请稍后重试',
        dataUnavailable: true,
      });
    } finally {
      bubbleSelectionPromise = null;
    }
  });

  function normalizeSectorKey(value: string) {
    return String(value || '').replace(/(概念|板块|行业|指数|Ⅱ|Ⅲ|IV)/g, '').replace(/\s+/g, '').trim();
  }

  const stockQuoteSnapshotCache = new Map<string, any>();
  const stockSearchCache = new Map<string, { expiresAt: number; value: any }>();

  function normalizeAshareSymbol(input: string) {
    const code = String(input || '').trim().toUpperCase().replace(/^(SH|SZ)/, '');
    if (!/^\d{6}$/.test(code)) throw new Error('股票代码应为 6 位数字，例如 600000');
    const exchange = /^(5|6|9)/.test(code) ? 'SH' : 'SZ';
    return { code, exchange, tencent: `${exchange.toLowerCase()}${code}`, sina: `${exchange.toLowerCase()}${code}`, xueqiu: `${exchange}${code}` };
  }

  async function fetchTencentStockQuote(symbol: ReturnType<typeof normalizeAshareSymbol>) {
    const text = await httpGetText(`https://qt.gtimg.cn/q=${symbol.tencent}`, 'https://gu.qq.com/', 'gb18030');
    const matched = text.match(new RegExp(`v_${symbol.tencent}="([^"]*)"`));
    const fields = matched?.[1]?.split('~') || [];
    const price = Number(fields[3]);
    const previousClose = Number(fields[4]);
    if (!Number.isFinite(price) || !Number.isFinite(previousClose)) throw new Error('腾讯行情字段不完整');
    const change = Number(fields[31]);
    const changePercent = Number(fields[32]);
    return {
      code: symbol.code, name: fields[1] || symbol.code, price, previousClose,
      open: Number(fields[5]) || null, high: Number(fields[33]) || null, low: Number(fields[34]) || null,
      change: Number.isFinite(change) ? change : Math.round((price - previousClose) * 100) / 100,
      changePercent: Number.isFinite(changePercent) ? changePercent : Math.round(((price / previousClose) - 1) * 10_000) / 100,
      volume: Number(fields[6]) || null, amount: Number(fields[37]) || null,
      asOf: fields[30] || null,
    };
  }

  async function fetchSinaStockQuote(symbol: ReturnType<typeof normalizeAshareSymbol>) {
    const text = await httpGetText(`https://hq.sinajs.cn/list=${symbol.sina}`, 'https://finance.sina.com.cn/', 'gb18030');
    const matched = text.match(new RegExp(`hq_str_${symbol.sina}="([^"]*)"`));
    const fields = matched?.[1]?.split(',') || [];
    const price = Number(fields[3]);
    const previousClose = Number(fields[2]);
    if (!Number.isFinite(price) || !Number.isFinite(previousClose)) throw new Error('新浪行情字段不完整');
    return {
      code: symbol.code, name: fields[0] || symbol.code, price, previousClose,
      open: Number(fields[1]) || null, high: Number(fields[4]) || null, low: Number(fields[5]) || null,
      change: Math.round((price - previousClose) * 100) / 100,
      changePercent: Math.round(((price / previousClose) - 1) * 10_000) / 100,
      volume: Number(fields[8]) || null, amount: Number(fields[9]) || null,
      asOf: fields[30] && fields[31] ? `${fields[30]} ${fields[31]}` : null,
    };
  }

  async function fetchXueqiuStockQuote(symbol: ReturnType<typeof normalizeAshareSymbol>) {
    const data = await httpGetJSON(`https://stock.xueqiu.com/v5/stock/realtime/quotec.json?symbol=${symbol.xueqiu}`);
    const quote = Array.isArray(data?.data) ? data.data[0] : null;
    const price = Number(quote?.current);
    const previousClose = Number(quote?.last_close);
    if (!Number.isFinite(price) || !Number.isFinite(previousClose)) throw new Error('雪球行情字段不完整');
    return {
      code: symbol.code, name: quote.name || symbol.code, price, previousClose,
      open: Number(quote.open) || null, high: Number(quote.high) || null, low: Number(quote.low) || null,
      change: Number(quote.chg) || Math.round((price - previousClose) * 100) / 100,
      changePercent: Number(quote.percent) || Math.round(((price / previousClose) - 1) * 10_000) / 100,
      volume: Number(quote.volume) || null, amount: Number(quote.amount) || null,
      asOf: quote.timestamp ? new Date(Number(quote.timestamp)).toISOString() : null,
    };
  }

  async function fetchAshareStockQuoteWithFallback(input: string) {
    const symbol = normalizeAshareSymbol(input);
    const providers = [
      { source: 'tencent', fetcher: fetchTencentStockQuote },
      { source: 'sina', fetcher: fetchSinaStockQuote },
      { source: 'xueqiu', fetcher: fetchXueqiuStockQuote },
    ];
    for (let index = 0; index < providers.length; index += 1) {
      const provider = providers[index];
      try {
        const quote = await provider.fetcher(symbol);
        const sourceMeta = { source: provider.source, fetchedAt: new Date().toISOString(), asOf: quote.asOf || undefined, freshness: 'realtime', confidence: 'market', fallbackLevel: index };
        const result = { quote, sourceMeta };
        stockQuoteSnapshotCache.set(symbol.code, result);
        return result;
      } catch (error: any) {
        console.warn(`[stock-source] ${provider.source} ${symbol.code} failed:`, error.message);
      }
    }
    const stale = stockQuoteSnapshotCache.get(symbol.code);
    if (stale) return { quote: stale.quote, sourceMeta: { ...stale.sourceMeta, source: 'cache', fetchedAt: new Date().toISOString(), freshness: 'stale', confidence: 'limited', fallbackLevel: 3, asOf: stale.sourceMeta.fetchedAt } };
    throw new Error(`暂无 ${symbol.code} 的可用行情`);
  }

  // 同一研究快照会被基本面、事件等模块同时消费；并发去重可避免对巨潮发出重复请求而触发限流。
  const cninfoAnnouncementInFlight = new Map<string, Promise<any>>();

  async function fetchCninfoAnnouncements(symbol: string, startDate: string, endDate: string, category = '') {
    if (!/^\d{6}$/.test(symbol)) throw new Error('symbol 应为 6 位证券代码');
    if (!/^\d{8}$/.test(startDate) || !/^\d{8}$/.test(endDate)) throw new Error('日期应为 YYYYMMDD');
    const cacheKey = `${symbol}:${startDate}:${endDate}:${category}`;
    const inFlight = cninfoAnnouncementInFlight.get(cacheKey);
    if (inFlight) return inFlight;
    const request = (async () => {
      const { command, args } = resolvePythonInvocation('cninfo_announcements.py', [symbol, startDate, endDate, category]);
      const { stdout } = await execFileAsync(command, args, { timeout: 45_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024, env: pythonChildEnv() });
      const payload = JSON.parse(stdout);
      return {
        announcements: Array.isArray(payload?.announcements) ? payload.announcements : [],
        sourceMeta: {
          source: 'cninfo', fetchedAt: new Date().toISOString(), freshness: 'delayed', confidence: 'official', fallbackLevel: 0,
        },
      };
    })();
    cninfoAnnouncementInFlight.set(cacheKey, request);
    try {
      return await request;
    } finally {
      cninfoAnnouncementInFlight.delete(cacheKey);
    }
  }

  function toSearchResult(code: string, name: string, exchange?: string) {
    const normalizedCode = String(code || '').replace(/\D/g, '');
    if (!/^\d{6}$/.test(normalizedCode) || !name) return null;
    const normalizedExchange = exchange === 'SH' || exchange === 'SZ' ? exchange : /^(5|6|9)/.test(normalizedCode) ? 'SH' : 'SZ';
    return { code: `${normalizedCode}.${normalizedExchange}`, name: String(name).trim(), price: 0, changePercent: 0, volume: '--', turnover: '--', history: [] };
  }

  function uniqueStockSearchResults(items: any[]) {
    const values = new Map<string, any>();
    for (const item of items) if (item?.code && !values.has(item.code)) values.set(item.code, item);
    return [...values.values()].slice(0, 10);
  }

  async function searchEastmoneyAshareStocks(query: string) {
    const url = `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(query)}&type=14&token=D43BF722C1B2D6D0F3513D2F4B09D208&count=10`;
    const data = await httpGetJSON(url);
    const rows = Array.isArray(data?.QuotationCodeTable?.Data) ? data.QuotationCodeTable.Data : [];
    const results = rows
      .filter((item: any) => item?.Classify === 'AStock' || /A/.test(String(item?.SecurityTypeName || '')))
      .map((item: any) => {
        const exchange = String(item?.QuoteID || '').split('.')[0] === '1' ? 'SH' : String(item?.QuoteID || '').split('.')[0] === '0' ? 'SZ' : undefined;
        return toSearchResult(item?.Code || item?.UnifiedCode, item?.Name, exchange);
      })
      .filter(Boolean);
    if (!results.length) throw new Error('东方财富未返回可用 A 股匹配结果');
    return uniqueStockSearchResults(results);
  }

  async function searchSinaAshareStocks(query: string) {
    const text = await httpGetText(`https://suggest3.sinajs.cn/suggest/type=11,12,13,14,15/&key=${encodeURIComponent(query)}`, 'https://finance.sina.com.cn/', 'gb18030');
    const payload = text.match(/="([\s\S]*)";/)?.[1] || '';
    const results = payload.split(';').map((row) => {
      const fields = row.split(',');
      const marketCode = String(fields[3] || '').toLowerCase();
      const exchange = marketCode.startsWith('sh') ? 'SH' : marketCode.startsWith('sz') ? 'SZ' : undefined;
      return exchange ? toSearchResult(fields[2], fields[0], exchange) : null;
    }).filter(Boolean);
    if (!results.length) throw new Error('新浪未返回可用 A 股匹配结果');
    return uniqueStockSearchResults(results);
  }

  async function searchAshareStocks(input: string) {
    const query = String(input || '').trim().replace(/\s+/g, '');
    if (!query || query.length > 30) throw new Error('请输入 1 至 30 个字符的股票名称或代码');
    const cacheKey = query.toLowerCase();
    const cached = stockSearchCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return { ...cached.value, sourceMeta: { ...cached.value.sourceMeta, source: 'cache', freshness: 'stale' } };
    const providers = [
      { source: 'eastmoney_search', fetcher: searchEastmoneyAshareStocks },
      { source: 'sina_suggest', fetcher: searchSinaAshareStocks },
    ];
    for (let index = 0; index < providers.length; index += 1) {
      const provider = providers[index];
      try {
        const results = await provider.fetcher(query);
        const value = { results, sourceMeta: { source: provider.source, fetchedAt: new Date().toISOString(), freshness: 'delayed', confidence: 'market', fallbackLevel: index } };
        stockSearchCache.set(cacheKey, { expiresAt: Date.now() + 5 * 60_000, value });
        return value;
      } catch (error: any) {
        console.warn(`[stock-search] ${provider.source} ${query} failed:`, error.message);
      }
    }
    throw new Error('全市场股票搜索暂不可用，请稍后重试');
  }

  const stockEventSnapshotCache = new Map<string, { expiresAt: number; value: any }>();

  async function buildIndustryEventContext(symbol: string, companyName: string) {
    const [profileResult, industryResult] = await Promise.allSettled([fetchXueqiuProfile(symbol), fetchStockIndustryBenchmark(symbol)]);
    const profile: any = profileResult.status === 'fulfilled' ? profileResult.value?.profile || {} : {};
    const industry: any = industryResult.status === 'fulfilled' ? industryResult.value?.industry || null : null;
    const contextText = [companyName, profile.main_operation_business, profile.industry, industry?.name].filter(Boolean).join(' ').toLowerCase();
    const rules = INDUSTRY_CHAIN_RULES.filter((rule) => rule.keywords.some((keyword) => contextText.includes(keyword.toLowerCase())));
    const terms = [...new Set([
      String(industry?.name || '').replace(/^I\d+/, '').trim(),
      ...rules.flatMap((rule) => rule.keywords),
    ].filter((term) => term.length >= 3 && term !== companyName))];
    const dataGaps = [
      ...(industryResult.status === 'rejected' ? ['行业归属不可用，行业/政策事件仅按已匹配业务术语过滤。'] : []),
      ...(terms.length ? [] : ['未形成可审计的行业或业务关键词集合，未接入行业/政策事件。']),
    ];
    return { industry, ruleIds: rules.map((rule) => rule.id), terms, dataGaps };
  }

  function buildIndustryPolicyEvents(symbol: string, newsItems: any[], context: any, companyName: string, start: Date, end: Date) {
    const events: any[] = [];
    const evidence: any[] = [];
    const clusters = new Map<string, any>();
    const policyPattern = /(政策|通知|意见|规划|条例|办法|国务院|工信部|发改委|财政部|监管)/;
    const normalizedCompanyName = companyName.replace(/[（(].*?[）)]/g, '').trim();
    for (const news of newsItems) {
      const title = String(news?.title || '').trim().slice(0, 180);
      if (!title || (normalizedCompanyName && title.includes(normalizedCompanyName)) || title.includes(symbol)) continue;
      const matchedTerms = (context.terms || []).filter((term: string) => title.toLowerCase().includes(term.toLowerCase()));
      if (!matchedTerms.length) continue;
      const publishedAt = eventDate(news?.publishedAt) || null;
      if (publishedAt && (Date.parse(publishedAt) < start.getTime() || Date.parse(publishedAt) > end.getTime() + 86_400_000)) continue;
      const impactScope = policyPattern.test(title) ? 'policy' : 'industry';
      // 同一主题的多条转载/跟进报道只保留一个事件簇；每条原始报道仍保留为可追溯证据。
      const topicKey = `${impactScope}_${normalizedEventKey(title, null)}`;
      const sourceKey = `${topicKey}_${publishedAt?.slice(0, 10) || 'current'}`;
      const category = eventCategory(title);
      const sourceEvidenceId = makeEvidenceId(symbol, 'industry_event_source', sourceKey, publishedAt?.slice(0, 10) || 'current');
      const eventClusterId = makeEvidenceId(symbol, 'industry_event_cluster', topicKey, 'current');
      const direction = eventDirection(title, category);
      const sourceEvidence = { evidenceId: sourceEvidenceId, type: impactScope === 'policy' ? 'policy_event' : 'industry_event', title, value: JSON.stringify({ impactScope, matchedTerms, mappedRuleIds: context.ruleIds || [], eventClusterId }), period: publishedAt?.slice(0, 10), source: news?.sourceName || 'wallstreetcn', sourceUrl: news?.url || undefined, publishedAt: publishedAt || undefined, fetchedAt: new Date().toISOString(), freshness: 'delayed', verification: 'third_party' };
      evidence.push(sourceEvidence);
      const existing = clusters.get(eventClusterId);
      if (existing) {
        existing.clusterSize += 1;
        existing.evidenceIds.push(sourceEvidenceId);
        existing.matchedTerms = [...new Set([...existing.matchedTerms, ...matchedTerms])];
        if (String(publishedAt || '') > String(existing.publishedAt || '')) {
          existing.title = title;
          existing.publishedAt = publishedAt;
          existing.source = news?.sourceName || 'wallstreetcn';
          existing.sourceUrl = String(news?.url || '');
          existing.direction = direction;
          existing.category = category;
          existing.impactHorizon = eventImpactHorizon(category);
          existing.status = eventStatus(title, publishedAt, category);
        }
        continue;
      }
      const item = { eventId: eventClusterId, eventClusterId, category, title, publishedAt, source: news?.sourceName || 'wallstreetcn', sourceUrl: String(news?.url || ''), verification: 'third_party', direction, impactScope, eventLayer: impactScope === 'policy' ? 'policy' : 'industry', impactHorizon: eventImpactHorizon(category), status: eventStatus(title, publishedAt, category), matchedTerms, mappedRuleIds: context.ruleIds || [], relevance: 'mapped_industry_or_business', clusterSize: 1, evidenceIds: [sourceEvidenceId] };
      clusters.set(eventClusterId, item);
    }
    events.push(...clusters.values());
    return { events, evidence };
  }

  async function buildStockEventSnapshot(input: string, days = 180) {
    const symbol = normalizeAshareSymbol(input).code;
    const cacheKey = `${symbol}:${days}`;
    const cached = stockEventSnapshotCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { ...cached.value, snapshotMeta: { ...cached.value.snapshotMeta, source: 'cache', freshness: 'stale' } };
    }
    const end = new Date();
    const start = new Date(end.getTime() - days * 86_400_000);
    const formatDate = (date: Date) => date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }).replaceAll('-', '');
    const startDate = formatDate(start);
    const endDate = formatDate(end);
    const [announcementResult, marketResult, quoteResult] = await Promise.allSettled([
      fetchCninfoAnnouncements(symbol, startDate, endDate),
      fetchMarketData(),
      fetchAshareStockQuoteWithFallback(symbol),
    ]);
    const dataGaps: string[] = [];
    const announcements = announcementResult.status === 'fulfilled' ? announcementResult.value.announcements : [];
    if (announcementResult.status !== 'fulfilled') dataGaps.push(`CNINFO 公告不可用：${announcementResult.reason?.message || '未知原因'}`);
    const marketData: any = marketResult.status === 'fulfilled' ? marketResult.value : null;
    if (!marketData) dataGaps.push(`个股相关新闻不可用：${marketResult.status === 'rejected' ? marketResult.reason?.message || '未知原因' : '未知原因'}`);
    const companyName = quoteResult.status === 'fulfilled' ? String(quoteResult.value.quote?.name || '') : '';
    if (!companyName) dataGaps.push('公司名称不可用，相关新闻仅按股票代码匹配。');
    const events: any[] = [];
    const evidence: any[] = [];
    const seen = new Set<string>();
    let duplicateEventCount = 0;
    const addEvent = (raw: any, sourceType: 'announcement' | 'news', sourceMeta: any) => {
      const title = String(raw?.title || '').trim().slice(0, 180);
      if (!title) return;
      const publishedAt = eventDate(raw?.publishedAt) || eventDate(raw?.公告时间) || null;
      const key = normalizedEventKey(title, publishedAt);
      if (seen.has(key)) {
        duplicateEventCount++;
        return;
      }
      seen.add(key);
      const category = eventCategory(title);
      const direction = eventDirection(title, category);
      const impactHorizon = eventImpactHorizon(category);
      const eventId = makeEvidenceId(symbol, 'event', `${sourceType}_${key}`);
      const verification = sourceType === 'announcement' ? 'official_verified' : 'third_party';
      const item = {
        eventId, category, title, publishedAt, source: sourceMeta?.source || (sourceType === 'announcement' ? 'cninfo' : 'wallstreetcn'),
        sourceUrl: String(raw?.url || ''), verification, direction, impactScope: 'company', impactHorizon,
        status: eventStatus(title, publishedAt, category), evidenceIds: [eventId],
      };
      events.push(item);
      evidence.push({ evidenceId: eventId, type: sourceType, title, period: publishedAt?.slice(0, 10), source: item.source, sourceUrl: item.sourceUrl || undefined, publishedAt: publishedAt || undefined, fetchedAt: sourceMeta?.fetchedAt || new Date().toISOString(), freshness: sourceMeta?.freshness || 'delayed', verification });
    };
    for (const announcement of announcements) addEvent(announcement, 'announcement', announcementResult.status === 'fulfilled' ? announcementResult.value.sourceMeta : null);
    const newsItems = Array.isArray(marketData?.newsItems) ? marketData.newsItems : [];
    const normalizedCompanyName = companyName.replace(/[（(].*?[）)]/g, '').trim();
    for (const news of newsItems) {
      const title = String(news?.title || '');
      if (!title.includes(symbol) && (!normalizedCompanyName || !title.includes(normalizedCompanyName))) continue;
      addEvent(news, 'news', { source: news.sourceName || 'wallstreetcn', fetchedAt: marketData.timestamp || new Date().toISOString(), freshness: 'delayed' });
    }
    const industryContext = await buildIndustryEventContext(symbol, companyName).catch((error: any) => ({ industry: null, ruleIds: [], terms: [], dataGaps: [`行业/政策事件上下文不可用：${error.message || '未知原因'}`] }));
    dataGaps.push(...(industryContext.dataGaps || []).map(String));
    const industryPolicy = buildIndustryPolicyEvents(symbol, newsItems, industryContext, companyName, start, end);
    events.push(...industryPolicy.events);
    evidence.push(...industryPolicy.evidence);
    events.sort((left, right) => String(right.publishedAt || '').localeCompare(String(left.publishedAt || '')));
    const value = {
      symbol, period: { start: `${startDate.slice(0, 4)}-${startDate.slice(4, 6)}-${startDate.slice(6, 8)}`, end: `${endDate.slice(0, 4)}-${endDate.slice(4, 6)}-${endDate.slice(6, 8)}` },
      events: events.slice(0, 100), evidence: evidence.slice(0, 100), metrics: { candidateEventCount: announcements.length + newsItems.length, duplicateEventCount, uniqueEventCount: events.length, companyEventCount: events.filter((item) => item.impactScope === 'company').length, industryEventCount: industryPolicy.events.filter((item) => item.impactScope === 'industry').length, policyEventCount: industryPolicy.events.filter((item) => item.impactScope === 'policy').length }, dataGaps: [...new Set(dataGaps)],
      sourceMeta: { announcements: announcementResult.status === 'fulfilled' ? announcementResult.value.sourceMeta : null, news: marketData?.sourceMeta || null, industryContext: { industry: industryContext.industry?.name || null, mappedRuleIds: industryContext.ruleIds || [] } },
      snapshotMeta: { generatedAt: new Date().toISOString(), source: 'live', freshness: events.length ? 'delayed' : 'stale', evidenceCount: evidence.length, eventVersion: 'stock-event-v1' },
    };
    stockEventSnapshotCache.set(cacheKey, { expiresAt: Date.now() + 5 * 60_000, value });
    return value;
  }

  const stockSentimentSnapshotCache = new Map<string, { expiresAt: number; value: any }>();
  const stockSentimentHistory = new Map<string, Array<{ observedAt: string; attention: number }>>();

  function sentimentHeatItem(items: any[], symbol: string) {
    return items.find((item: any) => Object.entries(item || {}).some(([key, value]) => /代码|证券代码|股票/.test(key) && String(value || '').replace(/\D/g, '').endsWith(symbol))) || null;
  }

  function sentimentAttentionValue(item: any) {
    const entry = Object.entries(item || {}).find(([key, value]) => /关注|热度/.test(key) && Number.isFinite(Number(value)));
    return entry ? Number(entry[1]) : null;
  }

  function classifyAttentionTrend(history: Array<{ observedAt: string; attention: number }>) {
    if (history.length < 2) return { state: 'unavailable', change: null, sampleCount: history.length };
    const current = history.at(-1)!.attention;
    const prior = history.at(-2)!.attention;
    const change = prior === 0 ? null : current / prior - 1;
    if (change === null) return { state: 'unavailable', change, sampleCount: history.length };
    return { state: change > 0.1 ? 'rising' : change < -0.1 ? 'falling' : 'stable', change, sampleCount: history.length };
  }

  function calculateEventReaction(events: any[], bars: any[], symbol: string) {
    const cleanBars = bars.filter((bar: any) => Number.isFinite(Number(bar.close)) && eventDate(bar.date)).sort((left: any, right: any) => String(left.date).localeCompare(String(right.date)));
    const reactions: any[] = [];
    for (const event of events) {
      const eventDateKey = eventDate(event.publishedAt)?.slice(0, 10);
      if (!eventDateKey) continue;
      const eventIndex = cleanBars.findIndex((bar: any) => String(eventDate(bar.date)).slice(0, 10) >= eventDateKey);
      if (eventIndex < 1 || eventIndex + 3 >= cleanBars.length) continue;
      const before = cleanBars[eventIndex - 1];
      const after = cleanBars[eventIndex + 3];
      const beforeClose = Number(before.close);
      const afterClose = Number(after.close);
      const returnValue = beforeClose > 0 ? afterClose / beforeClose - 1 : null;
      if (returnValue === null) continue;
      const aligned = event.direction === 'positive' ? returnValue >= 0.01 : event.direction === 'negative' ? returnValue <= -0.01 : null;
      const reaction = Math.abs(returnValue) < 0.01 ? 'weak_reaction' : aligned === true ? 'confirmed_reaction' : aligned === false ? 'divergent_reaction' : 'not_evaluable';
      const evidenceId = makeEvidenceId(symbol, 'sentiment_reaction', event.eventId, `${eventDateKey}_${String(after.date)}`);
      reactions.push({ eventId: event.eventId, eventDate: eventDateKey, beforeDate: String(before.date), afterDate: String(after.date), beforeClose, afterClose, return3d: returnValue, reaction, evidenceIds: [...new Set([...(event.evidenceIds || []), evidenceId])] });
    }
    return reactions;
  }

  function summarizeEventReaction(reactions: any[]) {
    if (!reactions.length) return 'not_evaluable';
    const kinds = new Set(reactions.map((item: any) => item.reaction));
    if (kinds.has('divergent_reaction')) return 'divergent_reaction';
    if (kinds.has('confirmed_reaction')) return 'confirmed_reaction';
    if (kinds.has('weak_reaction')) return 'weak_reaction';
    return 'not_evaluable';
  }

  function calculatePropagationQuality(events: any[], duplicateEventCount: number, hasMatchedHeat: boolean) {
    const sources = [...new Set(events.map((event: any) => String(event.source || '')).filter(Boolean))];
    const officialCount = events.filter((event: any) => event.verification === 'official_verified' || event.verification === 'official_document_only').length;
    const mediaCount = events.filter((event: any) => event.verification === 'third_party').length;
    const candidateCount = events.length + duplicateEventCount;
    const propagationQuality = officialCount && mediaCount ? 'official_and_media' : officialCount ? 'official_primary' : mediaCount ? 'media_only' : hasMatchedHeat ? 'community_heat_only' : 'insufficient';
    return {
      propagationQuality,
      sourceCount: sources.length,
      duplicateEventCount,
      duplicateRate: candidateCount ? duplicateEventCount / candidateCount : null,
      communityViewpointDisagreement: 'unavailable',
      viewpointScope: events.length ? 'event_direction_evidence' : 'unavailable',
    };
  }

  async function buildStockSentimentSnapshot(input: string, days = 30) {
    const symbol = normalizeAshareSymbol(input).code;
    const cacheKey = `${symbol}:${days}`;
    const cached = stockSentimentSnapshotCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { ...cached.value, snapshotMeta: { ...cached.value.snapshotMeta, source: 'cache', freshness: 'stale' } };
    }
    const [eventResult, heatResult] = await Promise.allSettled([
      buildStockEventSnapshot(symbol, days),
      fetchXueqiuHeat(),
    ]);
    const dataGaps: string[] = [];
    const eventSnapshot: any = eventResult.status === 'fulfilled' ? eventResult.value : null;
    if (!eventSnapshot) dataGaps.push(`事件快照不可用：${eventResult.status === 'rejected' ? eventResult.reason?.message || '未知原因' : '未知原因'}`);
    const heatData: any = heatResult.status === 'fulfilled' ? heatResult.value : null;
    if (!heatData) dataGaps.push(`雪球热度不可用：${heatResult.status === 'rejected' ? heatResult.reason?.message || '未知原因' : '未知原因'}`);
    dataGaps.push(...(eventSnapshot?.dataGaps || []).map(String));
    if (!heatData) dataGaps.push('缺少个股热度，无法评估社区关注度。');

    const events = Array.isArray(eventSnapshot?.events) ? eventSnapshot.events.filter((event: any) => event.status !== 'expired') : [];
    const officialEvents = events.filter((event: any) => event.verification === 'official_verified' || event.verification === 'official_document_only');
    const mediaEvents = events.filter((event: any) => event.verification === 'third_party');
    const positiveCount = events.filter((event: any) => event.direction === 'positive').length;
    const negativeCount = events.filter((event: any) => event.direction === 'negative').length;
    const mixedCount = events.filter((event: any) => event.direction === 'mixed' || event.direction === 'unknown' || event.status === 'unconfirmed').length;
    const hasMatchedHeat = Array.isArray(heatData?.items) && heatData.items.some((item: any) => Object.entries(item || {}).some(([key, value]) => /代码|证券代码|股票/.test(key) && String(value || '').replace(/\D/g, '').endsWith(symbol)));
    const tone: 'positive' | 'negative' | 'mixed' | 'neutral' | 'unavailable' = !events.length ? 'unavailable' : positiveCount > 0 && negativeCount > 0 ? 'mixed' : positiveCount > 0 ? 'positive' : negativeCount > 0 ? 'negative' : mixedCount > 0 ? 'mixed' : 'neutral';
    const disagreement: 'low' | 'medium' | 'high' | 'unavailable' = !events.length ? 'unavailable' : positiveCount > 0 && negativeCount > 0 ? 'high' : mixedCount > 0 ? 'medium' : 'low';
    const sourceQuality: 'official_led' | 'media_led' | 'community_led' | 'mixed' | 'insufficient' = officialEvents.length && mediaEvents.length ? 'mixed' : officialEvents.length ? 'official_led' : mediaEvents.length ? 'media_led' : hasMatchedHeat ? 'community_led' : 'insufficient';
    const propagation = calculatePropagationQuality(events, Number(eventSnapshot?.metrics?.duplicateEventCount) || 0, hasMatchedHeat);
    const heatItems = Array.isArray(heatData?.items) ? heatData.items : [];
    const heatItem = sentimentHeatItem(heatItems, symbol);
    const attentionValue = heatItem ? sentimentAttentionValue(heatItem) : null;
    if (heatItem && attentionValue === null) dataGaps.push('雪球热度结果缺少可解析的关注度字段。');
    if (heatData && !heatItem) dataGaps.push('当前雪球热度榜未找到该股票，不能据此判断关注度。');
    const evidence: any[] = Array.isArray(eventSnapshot?.evidence) ? eventSnapshot.evidence.map((item: any) => ({ ...item })) : [];
    const sentimentEvidenceIds: string[] = [];
    if (events.length || hasMatchedHeat) {
      const evidenceId = makeEvidenceId(symbol, 'sentiment_propagation', 'source_structure', eventSnapshot?.period?.end || 'current');
      sentimentEvidenceIds.push(evidenceId);
      evidence.push({ evidenceId, type: 'sentiment_calculation', title: '舆情传播来源结构', value: JSON.stringify({ propagationQuality: propagation.propagationQuality, sourceCount: propagation.sourceCount, duplicateEventCount: propagation.duplicateEventCount, duplicateRate: propagation.duplicateRate, viewpointScope: propagation.viewpointScope }), period: eventSnapshot?.period?.end, source: 'calculation', fetchedAt: new Date().toISOString(), freshness: 'delayed', verification: 'derived' });
    }
    if (heatItem && attentionValue !== null) {
      const evidenceId = makeEvidenceId(symbol, 'sentiment', 'xueqiu_attention', eventSnapshot?.period?.end || 'current');
      sentimentEvidenceIds.push(evidenceId);
      evidence.push({ evidenceId, type: 'sentiment', title: '雪球个股关注度', value: String(attentionValue), period: eventSnapshot?.period?.end, source: heatData.sourceMeta?.source || 'xueqiu', fetchedAt: heatData.sourceMeta?.fetchedAt || new Date().toISOString(), freshness: heatData.sourceMeta?.freshness || 'delayed', verification: 'third_party' });
    }
    const numericAttention = sentimentAttentionValue(heatItem);
    if (heatItem && Number.isFinite(numericAttention) && heatData?.sourceMeta?.source !== 'cache') {
      const history = stockSentimentHistory.get(symbol) || [];
      const observedAt = heatData.sourceMeta?.fetchedAt || new Date().toISOString();
      if (!history.some((point) => point.observedAt === observedAt)) history.push({ observedAt, attention: numericAttention });
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      stockSentimentHistory.set(symbol, history.filter((point) => Date.parse(point.observedAt) >= cutoff).slice(-120));
    }
    const attentionTrend = classifyAttentionTrend(stockSentimentHistory.get(symbol) || []);
    if (attentionTrend.state === 'unavailable') dataGaps.push('缺少个股热度历史序列，暂不判断关注度上升或下降。');

    let klineData: any = null;
    if (events.length) {
      try { klineData = await fetchMarketDailyKline('stock', symbol); }
      catch (error: any) { dataGaps.push(`个股日线不可用：${error?.message || '未知原因'}`); }
    }
    const eventReactions = klineData ? calculateEventReaction(events, klineData.bars || [], symbol) : [];
    const eventReaction = summarizeEventReaction(eventReactions);
    if (!eventReactions.length && events.length) dataGaps.push('缺少事件前后行情窗口，暂不判断市场是否形成确认反应。');
    if (klineData) {
      const evidenceId = makeEvidenceId(symbol, 'sentiment_market', 'daily_kline', `${eventSnapshot?.period?.start || 'window'}_${eventSnapshot?.period?.end || 'current'}`);
      sentimentEvidenceIds.push(evidenceId);
      evidence.push({ evidenceId, type: 'market_window', title: '事件前后个股日线', period: eventSnapshot?.period?.end, source: klineData.sourceMeta?.source || 'market_daily_kline', fetchedAt: klineData.sourceMeta?.fetchedAt || new Date().toISOString(), freshness: klineData.sourceMeta?.freshness || 'delayed', verification: 'market_data' });
      for (const reaction of eventReactions) if (!reaction.evidenceIds.includes(evidenceId)) reaction.evidenceIds.push(evidenceId);
    }
    const eventEvidenceIds = events.flatMap((event: any) => Array.isArray(event.evidenceIds) ? event.evidenceIds.map(String) : []);
    const reactionEvidenceIds = eventReactions.flatMap((reaction: any) => Array.isArray(reaction.evidenceIds) ? reaction.evidenceIds.map(String) : []);
    const allEvidenceIds = [...new Set([...eventEvidenceIds, ...sentimentEvidenceIds, ...reactionEvidenceIds])];
    const value = {
      symbol,
      period: eventSnapshot?.period || { start: null, end: null },
      attention: attentionTrend.state,
      tone,
      disagreement,
      evidenceDirectionDisagreement: disagreement,
      communityViewpointDisagreement: propagation.communityViewpointDisagreement,
      viewpointScope: propagation.viewpointScope,
      sourceQuality,
      propagationQuality: propagation.propagationQuality,
      eventReaction,
      eventReactions,
      metrics: { eventCount: events.length, officialEventCount: officialEvents.length, mediaEventCount: mediaEvents.length, positiveEventCount: positiveCount, negativeEventCount: negativeCount, mixedEventCount: mixedCount, currentAttention: attentionValue === null ? null : String(attentionValue), attentionChange: attentionTrend.change, attentionSampleCount: attentionTrend.sampleCount, sourceCount: propagation.sourceCount, duplicateEventCount: propagation.duplicateEventCount, duplicateRate: propagation.duplicateRate, eventReactionCount: eventReactions.length, confirmedReactionCount: eventReactions.filter((item: any) => item.reaction === 'confirmed_reaction').length, divergentReactionCount: eventReactions.filter((item: any) => item.reaction === 'divergent_reaction').length, weakReactionCount: eventReactions.filter((item: any) => item.reaction === 'weak_reaction').length },
      events,
      evidence,
      evidenceIds: allEvidenceIds,
      dataGaps: [...new Set(dataGaps)],
      sourceMeta: { eventSnapshot: eventSnapshot?.sourceMeta || null, heat: heatData?.sourceMeta || null, marketWindow: klineData?.sourceMeta || null },
      snapshotMeta: { generatedAt: new Date().toISOString(), source: 'live', freshness: events.length || heatItem ? 'delayed' : 'stale', evidenceCount: evidence.length, sentimentVersion: 'stock-sentiment-v3' },
    };
    stockSentimentSnapshotCache.set(cacheKey, { expiresAt: Date.now() + 5 * 60_000, value });
    return value;
  }

  const stockValuationSnapshotCache = new Map<string, { expiresAt: number; value: any }>();

  async function fetchStockValuationData(symbol: string) {
    if (!/^\d{6}$/.test(symbol)) throw new Error('symbol 应为 6 位证券代码');
    const invocation = resolvePythonInvocation('stock_valuation.py', [symbol]);
    const { stdout } = await execFileAsync(invocation.command, invocation.args, { timeout: 45_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024, env: pythonChildEnv() });
    const payload = JSON.parse(stdout);
    return { valuation: payload?.valuation || {}, sourceMeta: { ...payload?.sourceMeta, fetchedAt: payload?.sourceMeta?.fetchedAt || new Date().toISOString() } };
  }

  async function fetchStockValuationComparison(symbol: string) {
    const industry = await fetchStockIndustryBenchmark(symbol);
    const members = Array.isArray(industry?.industry?.members) ? industry.industry.members.map((item: any) => String(item.symbol || '')).filter((item: string) => /^\d{6}$/.test(item)).slice(0, 80) : [];
    const invocation = resolvePythonInvocation('valuation_comparison.py', [symbol, members.join(',')]);
    const { stdout } = await execFileAsync(invocation.command, invocation.args, { timeout: 90_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024, env: pythonChildEnv() });
    const payload = JSON.parse(stdout);
    return { ...payload, industry: industry.industry || null, sourceMeta: { ...payload?.sourceMeta, industrySource: industry.sourceMeta || null, fetchedAt: payload?.sourceMeta?.fetchedAt || new Date().toISOString() }, dataGaps: industry.dataGaps || [] };
  }

  function valuationMultipleStatus(value: unknown, denominator?: unknown) {
    const numeric = finiteNumber(value);
    if (numeric === null) return 'unavailable';
    if (arguments.length > 1) {
      const denominatorValue = finiteNumber(denominator);
      if (denominatorValue === null) return 'unavailable';
      if (denominatorValue <= 0) return 'not_meaningful';
    }
    return numeric > 0 ? 'meaningful' : 'not_meaningful';
  }

  function buildValuationScenarioModel(template: 'bank' | 'non_financial', financialMetrics: any, calculationMetrics: any, market: any, financialEvidenceIds: string[]) {
    const netProfit = finiteNumber(financialMetrics?.netProfit);
    const equity = finiteNumber(financialMetrics?.equity);
    const baseGrowth = finiteNumber(calculationMetrics?.netProfitYoY);
    const roe = finiteNumber(calculationMetrics?.roeApprox);
    const scenarioDefinitions = baseGrowth === null ? [] : [
      { id: 'bear', label: '保守', growthRate: Math.max(-0.5, baseGrowth - 0.1) },
      { id: 'base', label: '基准', growthRate: Math.max(-0.5, Math.min(0.5, baseGrowth)) },
      { id: 'bull', label: '乐观', growthRate: Math.min(0.5, baseGrowth + 0.1) },
    ];
    const earningsScenarios = scenarioDefinitions.map((scenario) => ({
      ...scenario,
      horizonYears: 3,
      projectedNetProfit: netProfit === null ? null : Array.from({ length: 3 }, (_item, index) => netProfit * Math.pow(1 + scenario.growthRate, index + 1)),
      assumptionType: 'derived_from_latest_net_profit_yoy_with_10pp_sensitivity',
      evidenceIds: financialEvidenceIds,
    }));
    const dcfInputsAvailable = template === 'non_financial' && finiteNumber(calculationMetrics?.freeCashFlowProxy) !== null && Number(calculationMetrics.freeCashFlowProxy) > 0 && finiteNumber(calculationMetrics?.netDebt) !== null;
    const dcfScenarios = dcfInputsAvailable ? earningsScenarios.map((scenario) => {
      const discountRate = 0.10;
      const terminalGrowthRate = 0.03;
      const baseFcf = Number(calculationMetrics.freeCashFlowProxy);
      const projectedFcf = Array.from({ length: 5 }, (_item, index) => baseFcf * Math.pow(1 + scenario.growthRate, index + 1));
      const pvExplicit = projectedFcf.reduce((sum, value, index) => sum + value / Math.pow(1 + discountRate, index + 1), 0);
      const terminalValue = projectedFcf[4] * (1 + terminalGrowthRate) / (discountRate - terminalGrowthRate);
      const enterpriseValue = pvExplicit + terminalValue / Math.pow(1 + discountRate, 5);
      const equityValue = enterpriseValue - Number(calculationMetrics.netDebt);
      return { ...scenario, discountRate, terminalGrowthRate, projectedFcf, enterpriseValue, equityValue, perShare: Number(market?.price) > 0 && Number(market?.marketCap) > 0 ? equityValue / (Number(market.marketCap) / Number(market.price)) : null, evidenceIds: financialEvidenceIds };
    }) : [];
    const residualIncomeAvailable = template === 'bank' && equity !== null && equity > 0 && roe !== null;
    const residualIncomeScenarios = residualIncomeAvailable ? scenarioDefinitions.map((scenario) => {
      const costOfEquity = 0.10;
      const terminalGrowthRate = 0.03;
      const scenarioRoe = Math.max(-0.2, Math.min(0.5, roe + (scenario.id === 'bear' ? -0.02 : scenario.id === 'bull' ? 0.02 : 0)));
      const residualIncome = Array.from({ length: 3 }, () => equity * (scenarioRoe - costOfEquity));
      const pvExplicit = residualIncome.reduce((sum, value, index) => sum + value / Math.pow(1 + costOfEquity, index + 1), 0);
      const terminalValue = residualIncome[2] * (1 + terminalGrowthRate) / (costOfEquity - terminalGrowthRate);
      const equityValue = equity + pvExplicit + terminalValue / Math.pow(1 + costOfEquity, 3);
      return { ...scenario, scenarioRoe, costOfEquity, terminalGrowthRate, residualIncome, equityValue, perShare: Number(market?.price) > 0 && Number(market?.marketCap) > 0 ? equityValue / (Number(market.marketCap) / Number(market.price)) : null, evidenceIds: financialEvidenceIds };
    }) : [];
    return {
      version: 'valuation-scenario-v1',
      earnings: { status: earningsScenarios.length ? 'limited' : 'unavailable', baseGrowth, scenarios: earningsScenarios, reason: earningsScenarios.length ? '情景增长率由最新净利润同比派生，并使用上下 10 个百分点敏感性。' : '缺少最新净利润同比，无法生成盈利情景。' },
      dcf: { status: dcfScenarios.length ? 'limited' : 'unavailable', scenarios: dcfScenarios, reason: dcfScenarios.length ? 'DCF 使用 FCF、净债务和显式折现假设；结果为模型情景，不是目标价。' : '缺少正的自由现金流代理值或净债务，暂不计算 DCF。' },
      residualIncome: { status: residualIncomeScenarios.length ? 'limited' : 'unavailable', scenarios: residualIncomeScenarios, reason: residualIncomeScenarios.length ? '剩余收益使用 ROE、权益和资本成本情景；结果为模型情景，不是目标价。' : '仅在银行且权益与 ROE 近似值可用时计算剩余收益。' },
      assumptions: { growthSensitivity: 0.10, discountRate: 0.10, terminalGrowthRate: 0.03, costOfEquity: 0.10, source: 'program_defaults_for_scenario_only' },
    };
  }

  async function buildStockValuationSnapshot(input: string) {
    const symbol = normalizeAshareSymbol(input).code;
    const cached = stockValuationSnapshotCache.get(symbol);
    if (cached && cached.expiresAt > Date.now()) return { ...cached.value, snapshotMeta: { ...cached.value.snapshotMeta, source: 'cache', freshness: 'stale' } };
    const [marketResult, factResult, comparisonResult, industryFinancialResult] = await Promise.allSettled([
      fetchStockValuationData(symbol),
      buildStockFactSnapshot(symbol),
      fetchStockValuationComparison(symbol),
      buildIndustryFinancialPercentiles(symbol),
    ]);
    const dataGaps: string[] = [];
    const evidence: any[] = [];
    const marketData: any = marketResult.status === 'fulfilled' ? marketResult.value : null;
    const factSnapshot: any = factResult.status === 'fulfilled' ? factResult.value : null;
    const comparisonData: any = comparisonResult.status === 'fulfilled' ? comparisonResult.value : null;
    const industryFinancial = buildIndustryFinancialComparison(symbol, industryFinancialResult.status === 'fulfilled' ? industryFinancialResult.value : null);
    if (!marketData) dataGaps.push(`市场估值数据不可用：${marketResult.status === 'rejected' ? marketResult.reason?.message || '未知原因' : '未知原因'}`);
    if (!factSnapshot) dataGaps.push(`财务分母数据不可用：${factResult.status === 'rejected' ? factResult.reason?.message || '未知原因' : '未知原因'}`);
    if (!comparisonData) dataGaps.push(`历史/行业估值数据不可用：${comparisonResult.status === 'rejected' ? comparisonResult.reason?.message || '未知原因' : '未知原因'}`);
    if (industryFinancialResult.status === 'rejected') dataGaps.push(`行业财务横向比较不可用：${industryFinancialResult.reason?.message || '未知原因'}`);

    const market = marketData?.valuation || {};
    const latestReport = factSnapshot?.facts?.financialReports?.[0] || null;
    const financialMetrics = latestReport?.metrics || {};
    const calculationMetrics = factSnapshot?.facts?.financialCalculations?.metrics || {};
    const template = factSnapshot?.company?.financialTemplate === 'bank' ? 'bank' : 'non_financial';
    const period = latestReport?.period || null;
    const marketEvidenceIds: string[] = [];
    for (const key of ['price', 'marketCap', 'floatMarketCap', 'peDynamic', 'peStatic', 'pb']) {
      if (market[key] === null || market[key] === undefined) continue;
      const evidenceId = makeEvidenceId(symbol, 'valuation_market', key, marketData.sourceMeta?.fetchedAt || 'current');
      marketEvidenceIds.push(evidenceId);
      evidence.push({ evidenceId, type: 'valuation', title: `市场估值 ${key}`, value: String(market[key]), source: marketData.sourceMeta?.source || 'eastmoney', fetchedAt: marketData.sourceMeta?.fetchedAt || new Date().toISOString(), freshness: marketData.sourceMeta?.freshness || 'realtime', verification: 'third_party' });
    }
    const financialEvidenceIds = factSnapshot ? fundamentalEvidenceIds(factSnapshot, ['revenue', 'netProfit', 'adjustedNetProfit', 'equity', 'roeApprox', 'operatingCashFlow', 'creditImpairmentToRevenue', 'interestNetIncomeYoY'], period) : [];
    evidence.push(...(factSnapshot?.evidence || []).filter((item: any) => financialEvidenceIds.includes(String(item.evidenceId))).map((item: any) => ({ ...item })));
    const netProfit = finiteNumber(financialMetrics.netProfit);
    const equity = finiteNumber(financialMetrics.equity);
    const roeApprox = finiteNumber(calculationMetrics.roeApprox);
    const peDynamicStatus = valuationMultipleStatus(market.peDynamic, netProfit);
    const peStaticStatus = valuationMultipleStatus(market.peStatic, netProfit);
    const pbStatus = valuationMultipleStatus(market.pb, equity);
    if (!marketData) dataGaps.push('缺少市场市值和估值倍数字段。');
    if (!period) dataGaps.push('缺少最新财务报告期，无法核验估值分母。');
    if (peDynamicStatus === 'not_meaningful' || peStaticStatus === 'not_meaningful') dataGaps.push('PE 倍数为非正或无意义，不能用 PE 判断估值高低。');
    if (pbStatus === 'not_meaningful') dataGaps.push('PB 倍数为非正或无意义，不能用 PB 判断估值高低。');
    if (template === 'bank' && roeApprox === null) dataGaps.push('银行估值缺少 ROE 近似值，PB 缺少盈利能力解释基础。');
    if (template === 'non_financial' && finiteNumber(financialMetrics.operatingCashFlow) === null) dataGaps.push('普通企业缺少经营现金流，暂不能扩展现金流估值口径。');
    const historyComparison = comparisonData?.history || {};
    const peerComparison = comparisonData?.peers || {};
    const comparisonEvidenceIds: string[] = [];
    for (const metric of ['pe', 'pb', 'ps']) {
      const historyItem = historyComparison[metric];
      const peerItem = peerComparison[metric];
      if (historyItem && historyItem.percentile !== null && historyItem.percentile !== undefined) {
        const evidenceId = makeEvidenceId(symbol, 'valuation_history', metric, historyItem.lastDate || 'current');
        comparisonEvidenceIds.push(evidenceId);
        evidence.push({ evidenceId, type: 'valuation_comparison', title: `历史估值分位 ${metric}`, value: historyItem.percentile, period: historyItem.lastDate, source: comparisonData.sourceMeta?.source || 'akshare_valuation_comparison', fetchedAt: comparisonData.sourceMeta?.fetchedAt || new Date().toISOString(), freshness: 'delayed', verification: 'third_party' });
      }
      if (peerItem && peerItem.peerPercentile !== null && peerItem.peerPercentile !== undefined) {
        const evidenceId = makeEvidenceId(symbol, 'valuation_peer', metric, String(comparisonData.industry?.name || 'unknown'));
        comparisonEvidenceIds.push(evidenceId);
        evidence.push({ evidenceId, type: 'valuation_comparison', title: `行业可比分位 ${metric}`, value: peerItem.peerPercentile, period: comparisonData.sourceMeta?.fetchedAt, source: comparisonData.sourceMeta?.source || 'akshare_valuation_comparison', fetchedAt: comparisonData.sourceMeta?.fetchedAt || new Date().toISOString(), freshness: 'delayed', verification: 'third_party' });
      }
    }
    const industryFinancialEvidenceIds = industryFinancial.evidence.map((item: any) => item.evidenceId);
    evidence.push(...industryFinancial.evidence);
    dataGaps.push(...industryFinancial.dataGaps.map(String));
    const comparisonStatus = Object.values(historyComparison).some((item: any) => item?.percentile !== null && item?.percentile !== undefined) || Object.values(peerComparison).some((item: any) => item?.peerPercentile !== null && item?.peerPercentile !== undefined) ? 'available' : 'unavailable';
    if (comparisonStatus === 'unavailable') dataGaps.push('历史估值分位和行业可比样本不足，不能输出相对高低判断。');
    dataGaps.push(...(comparisonData?.dataGaps || []).map(String));
    const availableMarketFields = ['marketCap', 'pb', 'peDynamic', 'peStatic'].filter((key) => market[key] !== null && market[key] !== undefined).length;
    const status = !marketData ? 'unavailable' : availableMarketFields >= 2 && period ? 'limited' : 'unavailable';
    const scenarioModel = buildValuationScenarioModel(template, financialMetrics, calculationMetrics, market, financialEvidenceIds);
    const value = {
      symbol,
      company: { name: market.name || factSnapshot?.company?.name || symbol, financialTemplate: template },
      valuationStatus: status,
      multiples: { peDynamic: market.peDynamic ?? null, peStatic: market.peStatic ?? null, pb: market.pb ?? null, ps: null, peDynamicStatus, peStaticStatus, pbStatus, psStatus: 'unavailable' },
      market: { price: market.price ?? null, marketCap: market.marketCap ?? null, floatMarketCap: market.floatMarketCap ?? null, asOf: marketData?.sourceMeta?.fetchedAt || null },
      financialBasis: { period, revenue: financialMetrics.revenue ?? null, netProfit: financialMetrics.netProfit ?? null, adjustedNetProfit: financialMetrics.adjustedNetProfit ?? null, equity: financialMetrics.equity ?? null, roeApprox, operatingCashFlow: financialMetrics.operatingCashFlow ?? null, evidenceIds: financialEvidenceIds },
      valuationFramework: template === 'bank'
        ? { template: 'bank', preferredMultiples: ['pb', 'peDynamic'], interpretationInputs: { roeApprox, creditImpairmentToRevenue: calculationMetrics.creditImpairmentToRevenue ?? null, interestNetIncomeYoY: calculationMetrics.interestNetIncomeYoY ?? null }, excludedMultiples: ['ps', 'evEbitda', 'freeCashFlowYield'], reason: '银行优先使用 PB 与 ROE；普通企业现金流和 EV/EBITDA 口径不适用。' }
        : { template: 'non_financial', preferredMultiples: ['peDynamic', 'pb'], interpretationInputs: { revenue: financialMetrics.revenue ?? null, netProfit, adjustedNetProfit: financialMetrics.adjustedNetProfit ?? null, operatingCashFlow: financialMetrics.operatingCashFlow ?? null }, excludedMultiples: ['bank_pb_roe_framework'], reason: '普通企业首期使用 PE 与 PB；PS、EV/EBITDA、现金流收益率待取得一致口径后接入。' },
      scenarioModel,
      comparison: { historyPercentile: historyComparison, peerComparison, financialIndustry: industryFinancial, status: comparisonStatus, industry: comparisonData?.industry || industryFinancial.industry || null, reason: comparisonStatus === 'available' ? '已提供历史/同行估值分位数据，但仍需结合企业类型和数据口径解释。' : '历史估值分位和行业可比估值样本不足。' },
      evidence,
      evidenceIds: [...new Set([...marketEvidenceIds, ...financialEvidenceIds, ...comparisonEvidenceIds, ...industryFinancialEvidenceIds])],
      dataGaps: [...new Set(dataGaps)],
      sourceMeta: { marketValuation: marketData?.sourceMeta || null, financialBasis: factSnapshot?.snapshotMeta || null, comparison: comparisonData?.sourceMeta || null },
      snapshotMeta: { generatedAt: new Date().toISOString(), source: 'live', freshness: marketData || comparisonData ? 'delayed' : 'stale', evidenceCount: evidence.length, valuationVersion: 'stock-valuation-v3' },
    };
    stockValuationSnapshotCache.set(symbol, { expiresAt: Date.now() + (industryFinancial.status === 'warming' ? 30_000 : 5 * 60_000), value });
    return value;
  }

  const valuationAgentCache = new Map<string, { expiresAt: number; value: any }>();

  function buildValuationAgentInput(snapshot: any) {
    const evidenceIds = new Set<string>((snapshot.evidenceIds || []).map(String).filter(Boolean));
    const multiples = snapshot.multiples || {};
    const metrics = ['peDynamic', 'peStatic', 'pb', 'ps'].map((key) => ({ metric: key, value: multiples[key] ?? null, status: multiples[`${key}Status`] || 'unavailable' }));
    return { snapshot, evidenceIds, metrics };
  }

  function fallbackValuationOpinion(snapshot: any, input: ReturnType<typeof buildValuationAgentInput>, reason: string) {
    const metricEvidence = (metric: string) => (snapshot.evidence || []).filter((item: any) => String(item.evidenceId || '').includes(`:${metric}:`)).map((item: any) => String(item.evidenceId));
    const interpretations = input.metrics.filter((item) => item.status !== 'unavailable').map((item) => ({ metric: item.metric, statement: `${item.metric} 当前值为 ${item.value}，程序状态为 ${item.status}；未接入历史和同行基准，不能据此判断估值高低。`, evidenceIds: metricEvidence(item.metric) })).filter((item) => item.evidenceIds.length);
    const uncertainties = (snapshot.dataGaps || []).map((text: unknown) => ({ text: String(text), evidenceIds: [] }));
    return {
      agent: 'valuation', status: snapshot.valuationStatus === 'unavailable' ? 'blocked' : 'limited',
      conclusion: snapshot.valuationStatus === 'unavailable' ? '估值事实输入不可用，无法形成可核验的估值解释。' : '当前只能解释估值倍数及其口径状态，历史分位和行业可比数据不足。',
      confidence: { score: Math.min(60, 25 + input.evidenceIds.size), level: 'limited', reason: `估值 Agent 使用确定性回退：${reason}` },
      valuationStatus: snapshot.valuationStatus, valuationFramework: snapshot.valuationFramework, multiples: snapshot.multiples, scenarioModel: snapshot.scenarioModel, comparison: snapshot.comparison,
      interpretations, uncertainties, evidenceIds: [...input.evidenceIds], dataGaps: snapshot.dataGaps || [],
    };
  }

  function normalizeValuationItems(items: unknown, evidenceSet: Set<string>) {
    if (!Array.isArray(items)) return [];
    return items.slice(0, 8).map((item: any) => ({
      metric: sanitizeTeacherText(item?.metric, 60), statement: sanitizeTeacherText(item?.statement, 220),
      evidenceIds: Array.isArray(item?.evidenceIds) ? [...new Set<string>(item.evidenceIds.map(String).filter((id: string) => evidenceSet.has(id)))].slice(0, 8) : [],
    })).filter((item: any) => item.metric && item.statement && item.evidenceIds.length);
  }

  async function runValuationAgent(inputSymbol: string, refresh = false) {
    const symbol = normalizeAshareSymbol(inputSymbol).code;
    const cached = valuationAgentCache.get(symbol);
    if (!refresh && cached && cached.expiresAt > Date.now()) return { ...cached.value, agentMeta: { ...cached.value.agentMeta, source: 'cache' } };
    const snapshot = await buildStockValuationSnapshot(symbol);
    const input = buildValuationAgentInput(snapshot);
    const evidenceCatalog = (snapshot.evidence || []).map((item: any) => ({ evidenceId: String(item.evidenceId), title: item.title, value: item.value, period: item.period, source: item.source, sourceUrl: item.sourceUrl, verification: item.verification })).filter((item: any) => input.evidenceIds.has(item.evidenceId));
    if (snapshot.valuationStatus === 'unavailable' || !input.evidenceIds.size) {
      const opinion = fallbackValuationOpinion(snapshot, input, snapshot.valuationStatus === 'unavailable' ? '估值事实来源不可用。' : '没有可引用的估值证据，不调用 AI。');
      const value = { symbol, valuationSnapshot: snapshot, deterministicValuation: { valuationStatus: snapshot.valuationStatus, valuationFramework: snapshot.valuationFramework, multiples: snapshot.multiples, market: snapshot.market, financialBasis: snapshot.financialBasis, scenarioModel: snapshot.scenarioModel, comparison: snapshot.comparison }, opinion, agentMeta: { generatedAt: new Date().toISOString(), source: 'live', aiStatus: 'not_requested', promptVersion: 'valuation-v1', snapshotGeneratedAt: snapshot.snapshotMeta.generatedAt, valuationVersion: snapshot.snapshotMeta.valuationVersion } };
      valuationAgentCache.set(symbol, { expiresAt: Date.now() + (snapshot.comparison?.financialIndustry?.status === 'warming' ? 30_000 : 15 * 60_000), value });
      return value;
    }
    let opinion: any;
    let aiStatus: 'completed' | 'fallback' = 'completed';
    try {
      const raw = await callAI(
        '你是个股估值 Agent。只解释输入中的冻结估值事实、企业类型口径、盈利情景/模型状态和证据，不搜索新事实、不修改 valuationStatus、valuationFramework、multiples、market、financialBasis、scenarioModel 或 comparison，不预测股价、不提供目标价、买卖或仓位建议。PE/PB 的 not_meaningful 不得写成高估；comparison.status 为 unavailable 时，不得输出高估、低估、合理或目标价判断，只能说明当前数值和数据缺口。DCF 或剩余收益模型的结果只是带假设的情景，不得写成目标价或确定价值。所有事实判断必须引用 evidenceCatalog 中存在的 evidenceId；没有证据只能放入 uncertainties。严格输出 JSON：{"summary":"","confidence":{"score":0,"level":"high|medium|limited","reason":""},"interpretations":[{"metric":"","statement":"","evidenceIds":[]}],"uncertainties":[{"text":"","evidenceIds":[]}]}' ,
        JSON.stringify({ symbol, deterministicValuation: { valuationStatus: snapshot.valuationStatus, valuationFramework: snapshot.valuationFramework, multiples: snapshot.multiples, market: snapshot.market, financialBasis: snapshot.financialBasis, scenarioModel: snapshot.scenarioModel, comparison: snapshot.comparison }, metrics: input.metrics, dataGaps: snapshot.dataGaps, evidenceCatalog }),
        0.1,
        3_000,
      );
      const parsed = parseAIJson(raw);
      const interpretations = normalizeValuationItems(parsed?.interpretations, input.evidenceIds);
      const uncertainties = normalizeEventAgentItems(parsed?.uncertainties, input.evidenceIds);
      const citedIds = [...new Set<string>([...interpretations, ...uncertainties].flatMap((item: any) => item.evidenceIds || []))];
      const requestedLevel = ['high', 'medium', 'limited'].includes(parsed?.confidence?.level) ? parsed.confidence.level : 'limited';
      const confidenceLevel = snapshot.dataGaps.length || !citedIds.length ? 'limited' : requestedLevel === 'high' ? 'medium' : requestedLevel;
      const confidenceScore = Math.max(0, Math.min(confidenceLevel === 'limited' ? 65 : 85, Number(parsed?.confidence?.score) || 0));
      opinion = {
        agent: 'valuation', status: snapshot.dataGaps.length || !citedIds.length ? 'limited' : 'completed',
        conclusion: sanitizeTeacherText(parsed?.summary, 280) || '估值解释暂不可用。',
        confidence: { score: confidenceScore, level: confidenceLevel, reason: sanitizeTeacherText(parsed?.confidence?.reason, 180) || '置信度由估值口径、数据完整度和证据引用共同约束。' },
        valuationStatus: snapshot.valuationStatus, valuationFramework: snapshot.valuationFramework, multiples: snapshot.multiples, scenarioModel: snapshot.scenarioModel, comparison: snapshot.comparison,
        interpretations, uncertainties, evidenceIds: citedIds, dataGaps: snapshot.dataGaps || [],
      };
    } catch (error: any) {
      aiStatus = 'fallback';
      console.warn(`[valuation-agent] AI fallback for ${symbol}:`, error.message);
      opinion = fallbackValuationOpinion(snapshot, input, error.message);
    }
    const value = {
      symbol, valuationSnapshot: snapshot,
      deterministicValuation: { valuationStatus: snapshot.valuationStatus, valuationFramework: snapshot.valuationFramework, multiples: snapshot.multiples, market: snapshot.market, financialBasis: snapshot.financialBasis, scenarioModel: snapshot.scenarioModel, comparison: snapshot.comparison },
      opinion,
      agentMeta: { generatedAt: new Date().toISOString(), source: 'live', aiStatus, promptVersion: 'valuation-v1', snapshotGeneratedAt: snapshot.snapshotMeta.generatedAt, valuationVersion: snapshot.snapshotMeta.valuationVersion },
    };
    valuationAgentCache.set(symbol, { expiresAt: Date.now() + (snapshot.comparison?.financialIndustry?.status === 'warming' ? 30_000 : 15 * 60_000), value });
    return value;
  }

  const stockRiskSnapshotCache = new Map<string, { expiresAt: number; value: any }>();

  function riskSnapshotItem(category: string, severity: 'high' | 'medium' | 'low', status: 'triggered' | 'watch', claim: string, trigger: string, resolutionCondition: string, evidenceIds: string[], disposition: 'veto' | 'downgrade' | 'watch') {
    return { riskId: `${category}:${disposition}:${claim}`.replace(/[^a-zA-Z0-9:_-]/g, '_'), category, severity, status, claim, trigger, resolutionCondition, evidenceIds: [...new Set(evidenceIds.map(String).filter(Boolean))], disposition };
  }

  async function buildStockRiskSnapshot(input: string) {
    const symbol = normalizeAshareSymbol(input).code;
    const cached = stockRiskSnapshotCache.get(symbol);
    if (cached && cached.expiresAt > Date.now()) return { ...cached.value, snapshotMeta: { ...cached.value.snapshotMeta, source: 'cache', freshness: 'stale' } };

    const [technicalResult, eventResult, sentimentResult, fundamentalResult, valuationResult] = await Promise.allSettled([
      buildTechnicalMarketSignals(symbol),
      buildStockEventSnapshot(symbol, 180),
      buildStockSentimentSnapshot(symbol, 30),
      buildStockFactSnapshot(symbol),
      buildStockValuationSnapshot(symbol),
    ]);
    const dataGaps: string[] = [];
    const evidence: any[] = [];
    const risks: any[] = [];
    const technical: any = technicalResult.status === 'fulfilled' ? technicalResult.value : null;
    const eventSnapshot: any = eventResult.status === 'fulfilled' ? eventResult.value : null;
    const sentiment: any = sentimentResult.status === 'fulfilled' ? sentimentResult.value : null;
    const fundamentalSnapshot: any = fundamentalResult.status === 'fulfilled' ? fundamentalResult.value : null;
    const valuationSnapshot: any = valuationResult.status === 'fulfilled' ? valuationResult.value : null;

    if (!technical) dataGaps.push(`技术与市场快照不可用：${technicalResult.status === 'rejected' ? technicalResult.reason?.message || '未知原因' : '未知原因'}`);
    if (!eventSnapshot) dataGaps.push(`事件快照不可用：${eventResult.status === 'rejected' ? eventResult.reason?.message || '未知原因' : '未知原因'}`);
    if (!sentiment) dataGaps.push(`舆情快照不可用：${sentimentResult.status === 'rejected' ? sentimentResult.reason?.message || '未知原因' : '未知原因'}`);
    if (!fundamentalSnapshot) dataGaps.push(`基本面快照不可用：${fundamentalResult.status === 'rejected' ? fundamentalResult.reason?.message || '未知原因' : '未知原因'}`);
    if (!valuationSnapshot) dataGaps.push(`估值快照不可用：${valuationResult.status === 'rejected' ? valuationResult.reason?.message || '未知原因' : '未知原因'}`);
    for (const snapshot of [technical, eventSnapshot, sentiment, fundamentalSnapshot, valuationSnapshot]) {
      evidence.push(...(Array.isArray(snapshot?.evidence) ? snapshot.evidence.map((item: any) => ({ ...item })) : []));
      dataGaps.push(...(Array.isArray(snapshot?.dataGaps) ? snapshot.dataGaps.map((item: any) => typeof item === 'string' ? item : String(item?.reason || item)) : []));
    }

    if (technical) {
      const signals = Array.isArray(technical.signals) ? technical.signals : [];
      const signal = (id: string) => signals.find((item: any) => item.signalId === id) || null;
      const structureRules = Array.isArray(technical.structureInvalidation?.rules) ? technical.structureInvalidation.rules : [];
      for (const rule of structureRules.filter((item: any) => item.triggered === true)) {
        const hardVeto = ['ma50_two_day_volume_break', 'support20d_two_day_volume_break'].includes(String(rule.ruleId));
        risks.push(riskSnapshotItem(
          'technical', 'high', 'triggered', String(rule.description || '技术结构失效规则已触发。'), String(rule.ruleId || 'structure_invalidation'),
          '等待该结构失效规则恢复，且后续交易日与量能条件不再满足。', rule.evidenceIds || [], hardVeto ? 'veto' : 'downgrade',
        ));
      }
      const technicalRisk = signal('risk');
      if (technicalRisk?.status === 'risk') risks.push(riskSnapshotItem('technical', 'medium', 'triggered', String(technicalRisk.summary), '技术风险信号已达到预设阈值。', '相关 ATR、波动率或回撤指标回到预设风险阈值以内。', technicalRisk.evidenceIds || [], 'downgrade'));
      const environment = signal('environment');
      if (environment?.status === 'risk') risks.push(riskSnapshotItem('market', 'medium', 'triggered', String(environment.summary), '市场环境被程序标记为 risk_off。', '市场环境不再为 risk_off，且市场广度与成交条件恢复。', environment.evidenceIds || [], 'downgrade'));
      const relative = signal('relative_strength');
      if (relative?.status === 'risk') risks.push(riskSnapshotItem('market', 'medium', 'triggered', String(relative.summary), '相对大盘强弱信号被程序标记为 risk。', '相对大盘多周期表现不再同时处于弱势。', relative.evidenceIds || [], 'downgrade'));
    }

    if (eventSnapshot) {
      const activeEvents = (Array.isArray(eventSnapshot.events) ? eventSnapshot.events : []).filter((event: any) => event.status !== 'expired');
      for (const event of activeEvents.filter((item: any) => item.direction === 'negative')) {
        const indirectIndustryOrPolicy = ['industry', 'policy'].includes(String(event.impactScope));
        const hardVeto = event.verification === 'official_verified' && ['regulatory', 'litigation'].includes(event.category);
        const disposition = hardVeto ? 'veto' : indirectIndustryOrPolicy && event.verification !== 'official_verified' ? 'watch' : 'downgrade';
        risks.push(riskSnapshotItem('event', hardVeto ? 'high' : indirectIndustryOrPolicy ? 'low' : 'medium', disposition === 'watch' ? 'watch' : 'triggered', event.title, hardVeto ? '官方核验的负面监管或诉讼事件。' : indirectIndustryOrPolicy ? '已匹配到行业或政策层负面事件，但当前为第三方来源，不能直接归因于公司。' : '活动事件被程序标记为负面。', '等待后续官方公告、执行进展或明确澄清以重新评估影响。', event.evidenceIds || [], disposition));
      }
      for (const event of activeEvents.filter((item: any) => item.status === 'unconfirmed' || item.direction === 'unknown' || item.direction === 'mixed')) {
        risks.push(riskSnapshotItem('event', 'low', 'watch', event.title, '事件尚未完全核验或方向不明确。', '获得官方核验或更明确的事件方向后重新评估。', event.evidenceIds || [], 'watch'));
      }
    }

    if (sentiment) {
      const sentimentEvidence = (sentiment.evidence || []).filter((item: any) => item.type === 'sentiment_calculation').map((item: any) => String(item.evidenceId));
      if (sentiment.eventReaction === 'divergent_reaction') risks.push(riskSnapshotItem('sentiment', 'medium', 'watch', '已知事件方向与事件后行情反应出现背离。', 'eventReaction 为 divergent_reaction。', '等待新增事件、后续行情窗口或方向更明确的证据。', sentimentEvidence, 'watch'));
      if (['media_only', 'community_heat_only', 'insufficient'].includes(String(sentiment.propagationQuality))) risks.push(riskSnapshotItem('sentiment', 'low', 'watch', '舆情传播来源结构不足以形成强交叉验证。', `propagationQuality 为 ${sentiment.propagationQuality}。`, '补充官方公告或独立可追溯来源后重新评估。', sentimentEvidence, 'watch'));
    }

    let fundamental: any = null;
    if (fundamentalSnapshot) {
      fundamental = buildFundamentalSignals(fundamentalSnapshot);
      dataGaps.push(...(fundamental.dataGaps || []).map(String));
      for (const veto of (fundamental.vetoes || []).filter((item: any) => item.triggered === true)) {
        risks.push(riskSnapshotItem('fundamental', 'high', 'triggered', String(veto.description), String(veto.code), '等待后续正式财务报告或官方披露确认该否决条件已经解除。', veto.evidenceIds || [], 'veto'));
      }
      const vetoEvidence = new Set((fundamental.vetoes || []).filter((item: any) => item.triggered).flatMap((item: any) => item.evidenceIds || []));
      for (const signal of (fundamental.signals || []).filter((item: any) => ['deteriorating', 'risk'].includes(item.status))) {
        const evidenceIds = (signal.evidenceIds || []).filter((id: string) => !vetoEvidence.has(id));
        risks.push(riskSnapshotItem('fundamental', signal.severity === 'high' ? 'high' : 'medium', 'triggered', String(signal.summary), `基本面信号 ${signal.signalId} 被程序标记为 ${signal.status}。`, '等待后续同口径报告期指标改善，或得到足以解释该恶化的官方披露。', evidenceIds, 'downgrade'));
      }
    }
    const valuation = valuationSnapshot ? { status: valuationSnapshot.valuationStatus, multiples: valuationSnapshot.multiples, comparison: valuationSnapshot.comparison, reason: valuationSnapshot.comparison?.reason || '估值快照可用但比较基准不足。' } : { status: 'unavailable', reason: '估值快照不可用，不能判断估值高低或估值风险。' };
    dataGaps.push(...(valuationSnapshot?.dataGaps || [valuation.reason]).map(String));

    const vetoes = risks.filter((item) => item.disposition === 'veto');
    const downgrades = risks.filter((item) => item.disposition === 'downgrade');
    const watches = risks.filter((item) => item.disposition === 'watch');
    const allInputsUnavailable = !technical && !eventSnapshot && !sentiment && !fundamentalSnapshot && !valuationSnapshot;
    const decision = allInputsUnavailable ? 'blocked' : vetoes.length ? 'veto' : downgrades.length ? 'downgrade' : watches.length ? 'watch' : 'clear';
    const riskLevel = allInputsUnavailable ? 'unavailable' : vetoes.length || downgrades.some((item) => item.severity === 'high') ? 'high' : downgrades.length || watches.length ? 'medium' : 'low';
    const evidenceIds = [...new Set([...risks.flatMap((item) => item.evidenceIds), ...evidence.map((item) => String(item.evidenceId || ''))].filter(Boolean))];
    const value = {
      symbol,
      riskLevel,
      decision,
      vetoes,
      risks: downgrades,
      watchConditions: watches,
      dataGaps: [...new Set(dataGaps)],
      evidence,
      evidenceIds,
      fundamental: fundamental ? { template: fundamental.template, signals: fundamental.signals, vetoes: fundamental.vetoes } : null,
      valuation,
      inputMeta: { technical: technical?.snapshotMeta || null, event: eventSnapshot?.snapshotMeta || null, sentiment: sentiment?.snapshotMeta || null, fundamental: fundamentalSnapshot?.snapshotMeta || null, valuation: valuationSnapshot?.snapshotMeta || null },
      snapshotMeta: { generatedAt: new Date().toISOString(), source: 'live', freshness: technical || eventSnapshot || sentiment || fundamentalSnapshot || valuationSnapshot ? 'delayed' : 'stale', evidenceCount: evidence.length, riskVersion: 'stock-risk-v3' },
    };
    stockRiskSnapshotCache.set(symbol, { expiresAt: Date.now() + 5 * 60_000, value });
    return value;
  }

  const stockManagerSnapshotCache = new Map<string, { expiresAt: number; value: any }>();

  function managerConflict(conflictId: string, dimensions: string[], severity: 'high' | 'medium' | 'low', description: string, resolutionCondition: string, evidenceIds: string[]) {
    return { conflictId, dimensions, severity, description, resolutionCondition, evidenceIds: [...new Set(evidenceIds.map(String).filter(Boolean))] };
  }

  async function buildStockManagerSnapshot(input: string) {
    const symbol = normalizeAshareSymbol(input).code;
    const cached = stockManagerSnapshotCache.get(symbol);
    if (cached && cached.expiresAt > Date.now()) return { ...cached.value, snapshotMeta: { ...cached.value.snapshotMeta, source: 'cache', freshness: 'stale' } };
    const [factResult, technicalResult, eventResult, sentimentResult, valuationResult, riskResult, industryResult] = await Promise.allSettled([
      buildStockFactSnapshot(symbol),
      buildTechnicalMarketSignals(symbol),
      buildStockEventSnapshot(symbol, 180),
      buildStockSentimentSnapshot(symbol, 30),
      buildStockValuationSnapshot(symbol),
      buildStockRiskSnapshot(symbol),
      buildIndustryChainSnapshot(symbol),
    ]);
    const fact: any = factResult.status === 'fulfilled' ? factResult.value : null;
    const technical: any = technicalResult.status === 'fulfilled' ? technicalResult.value : null;
    const eventSnapshot: any = eventResult.status === 'fulfilled' ? eventResult.value : null;
    const sentiment: any = sentimentResult.status === 'fulfilled' ? sentimentResult.value : null;
    const valuation: any = valuationResult.status === 'fulfilled' ? valuationResult.value : null;
    const risk: any = riskResult.status === 'fulfilled' ? riskResult.value : null;
    const industryChain: any = industryResult.status === 'fulfilled' ? industryResult.value : null;
    const dataGaps: string[] = [];
    const evidence: any[] = [];
    const pushSnapshot = (snapshot: any, result: PromiseSettledResult<any>, label: string) => {
      if (!snapshot) dataGaps.push(safeRuntimeDataGap(`${label}不可用：${result.status === 'rejected' ? result.reason?.message || '未知原因' : '未知原因'}`));
      evidence.push(...(snapshot?.evidence || []).map((item: any) => ({ ...item })));
      dataGaps.push(...(snapshot?.dataGaps || []).map((item: any) => safeRuntimeDataGap(typeof item === 'string' ? item : String(item?.reason || item))).filter(Boolean));
    };
    pushSnapshot(fact, factResult, '基本面');
    pushSnapshot(technical, technicalResult, '技术与市场');
    pushSnapshot(eventSnapshot, eventResult, '事件');
    pushSnapshot(sentiment, sentimentResult, '舆情');
    pushSnapshot(valuation, valuationResult, '估值');
    pushSnapshot(risk, riskResult, '风险');
    pushSnapshot(industryChain, industryResult, '行业与产业链');

    const fundamental = fact ? buildFundamentalSignals(fact) : null;
    const positiveFundamental = (fundamental?.signals || []).filter((item: any) => ['positive', 'stable'].includes(item.status));
    const negativeFundamental = (fundamental?.signals || []).filter((item: any) => ['deteriorating', 'risk'].includes(item.status));
    const positiveTechnical = (technical?.signals || []).filter((item: any) => item.status === 'positive');
    const triggeredStructure = (technical?.structureInvalidation?.rules || []).filter((item: any) => item.triggered === true);
    const activeEvents = (eventSnapshot?.events || []).filter((item: any) => item.status !== 'expired');
    const positiveEvents = activeEvents.filter((item: any) => item.direction === 'positive');
    const negativeEvents = activeEvents.filter((item: any) => item.direction === 'negative');
    const industryPolicyEvents = activeEvents.filter((item: any) => ['industry', 'policy'].includes(String(item.impactScope)));
    const conflicts: any[] = [];
    if (positiveFundamental.length && triggeredStructure.length) conflicts.push(managerConflict('fundamental_technical_conflict', ['fundamental', 'technical'], 'high', '基本面存在正向/稳定信号，但技术结构失效规则已触发。', '技术结构失效条件解除，且后续交易日重新确认。', [...positiveFundamental.flatMap((item: any) => item.evidenceIds || []), ...triggeredStructure.flatMap((item: any) => item.evidenceIds || [])]));
    if (positiveEvents.length && sentiment?.eventReaction === 'divergent_reaction') conflicts.push(managerConflict('event_sentiment_reaction_conflict', ['event', 'sentiment', 'market'], 'medium', '事件证据方向为正面，但事件后行情反应出现背离。', '获得新的事件证据或后续行情窗口，确认反应是否持续背离。', [...positiveEvents.flatMap((item: any) => item.evidenceIds || []), ...(sentiment.eventReactions || []).flatMap((item: any) => item.evidenceIds || [])]));
    if (positiveFundamental.length && risk?.decision === 'downgrade') conflicts.push(managerConflict('fundamental_risk_conflict', ['fundamental', 'risk'], 'medium', '基本面存在正向/稳定信号，但风险快照要求降级。', '风险降级项解除，并由后续快照确认。', [...positiveFundamental.flatMap((item: any) => item.evidenceIds || []), ...(risk.risks || []).flatMap((item: any) => item.evidenceIds || [])]));
    const vetoes = risk?.vetoes || [];
    const watchConditions = risk?.watchConditions || [];
    const requiredConditions = [...watchConditions.map((item: any) => ({ text: item.resolutionCondition, evidenceIds: item.evidenceIds || [] }))];
    const unverifiedIndustryPolicy = industryPolicyEvents.filter((item: any) => item.verification !== 'official_verified');
    if (unverifiedIndustryPolicy.length) {
      requiredConditions.push({
        text: '行业/政策事件目前仅为第三方匹配；需以正式政策文件、公司公告或业绩披露核验传导路径后再调整公司结论。',
        evidenceIds: unverifiedIndustryPolicy.flatMap((item: any) => item.evidenceIds || []),
      });
    }
    if (valuation?.comparison?.status !== 'available') requiredConditions.push({ text: '补充足够的历史估值分位或行业可比样本后，再讨论估值相对位置。', evidenceIds: valuation?.evidenceIds || [] });
    if (sentiment?.communityViewpointDisagreement === 'unavailable') requiredConditions.push({ text: '接入社区帖子/评论立场数据后，才能评估社区观点分歧。', evidenceIds: [] });
    const allCoreAvailable = Boolean(fact && technical && eventSnapshot && sentiment && valuation && risk);
    const criticalGap = dataGaps.some((gap) => /不可用|缺少|不足|无法|不能/.test(gap));
    const researchStatus = !risk || risk.decision === 'blocked' || !allCoreAvailable && !risk ? 'blocked' : vetoes.length || risk.decision === 'veto' ? 'rejected' : risk.decision === 'downgrade' || conflicts.some((item) => item.severity === 'high') || criticalGap ? 'deferred' : risk.decision === 'watch' || requiredConditions.length ? 'watch' : 'research_ready';
    const supportingCase = [...positiveFundamental.slice(0, 5).map((item: any) => ({ text: item.summary, evidenceIds: item.evidenceIds || [] })), ...positiveTechnical.slice(0, 3).map((item: any) => ({ text: item.summary, evidenceIds: item.evidenceIds || [] })), ...positiveEvents.slice(0, 3).map((item: any) => ({ text: item.title, evidenceIds: item.evidenceIds || [] }))];
    const counterCase = [...vetoes, ...(risk?.risks || []), ...negativeFundamental.slice(0, 4).map((item: any) => ({ claim: item.summary, evidenceIds: item.evidenceIds || [] })), ...negativeEvents.slice(0, 3).map((item: any) => ({ claim: item.title, evidenceIds: item.evidenceIds || [] }))].map((item: any) => ({ text: item.claim || item.description || item.summary || '', evidenceIds: item.evidenceIds || [] })).filter((item: any) => item.text);
    const researchPriorities = [
      ...vetoes.map((item: any) => ({ text: `优先核验否决项：${item.claim || item.description}`, evidenceIds: item.evidenceIds || [] })),
      ...conflicts.map((item: any) => ({ text: item.description, evidenceIds: item.evidenceIds || [] })),
      ...dataGaps.slice(0, 6).map((text) => ({ text, evidenceIds: [] })),
    ].slice(0, 10);
    const evidenceIds = [...new Set([...evidence.map((item: any) => String(item.evidenceId || '')), ...supportingCase.flatMap((item: any) => item.evidenceIds || []), ...counterCase.flatMap((item: any) => item.evidenceIds || []), ...conflicts.flatMap((item: any) => item.evidenceIds || [])].filter(Boolean))];
    const inputAvailability = { fundamental: Boolean(fact), technicalMarket: Boolean(technical), event: Boolean(eventSnapshot), sentiment: Boolean(sentiment), valuation: Boolean(valuation), risk: Boolean(risk) };
    const valueBase = {
      symbol,
      researchStatus,
      riskDecision: risk?.decision || 'blocked',
      riskLevel: risk?.riskLevel || 'unavailable',
      inputAvailability,
      supportingCase,
      counterCase,
      conflicts,
      requiredConditions,
      researchPriorities,
      dataGaps: [...new Set(dataGaps)],
      evidence,
      evidenceIds,
      // Keep the deterministic source snapshot with each module. The UI can then show
      // date/source provenance and draw trends only from real series (never placeholders).
      agentOutputs: {
        fundamental: fundamental ? { signals: fundamental.signals, vetoes: fundamental.vetoes, reports: fact?.facts?.financialReports || [], financialCalculations: fact?.facts?.financialCalculations || null, businessSegments: fact?.facts?.businessSegments || null, sourceMeta: fact?.facts?.financialMeta?.sourceMeta || null, template: fundamental.template, aiStatus: 'not_requested' } : null,
        technical: technical ? { signals: technical.signals, keyLevels: technical.keyLevels, chartBars: technical.chartBars || [], structureInvalidation: technical.structureInvalidation, riskThresholds: technical.ruleSet?.riskThresholds || null, sourceMeta: technical.inputMeta?.technical?.sourceMeta || technical.snapshotMeta || null, aiStatus: 'not_requested' } : null,
        events: eventSnapshot ? { events: activeEvents, industryPolicyEvents, sourceMeta: eventSnapshot.snapshotMeta || null, aiStatus: 'not_requested' } : null,
        industry: industryChain ? { status: industryChain.status, industry: industryChain.industry, financialPosition: industryChain.financialPosition, chain: industryChain.chain, events: industryChain.events, dataQuality: industryChain.dataQuality, sourceMeta: industryChain.snapshotMeta || null, aiStatus: 'not_requested' } : null,
        sentiment: sentiment ? { attention: sentiment.attention, tone: sentiment.tone, disagreement: sentiment.disagreement, eventReaction: sentiment.eventReaction, propagationQuality: sentiment.propagationQuality, sourceQuality: sentiment.sourceQuality, sourceMeta: sentiment.snapshotMeta || null, aiStatus: 'not_requested' } : null,
        valuation: valuation ? { valuationStatus: valuation.valuationStatus, multiples: valuation.multiples, comparison: valuation.comparison, scenarioModel: valuation.scenarioModel, market: valuation.market || null, financialBasis: valuation.financialBasis || null, valuationFramework: valuation.valuationFramework || null, sourceMeta: valuation.snapshotMeta || null, aiStatus: 'not_requested' } : null,
        risk: risk ? { riskLevel: risk.riskLevel, decision: risk.decision, vetoes: risk.vetoes, risks: risk.risks, watchConditions: risk.watchConditions, sourceMeta: risk.snapshotMeta || null, aiStatus: 'not_requested' } : null,
      },
      snapshotMeta: { generatedAt: new Date().toISOString(), source: 'live', freshness: allCoreAvailable ? 'delayed' : 'stale', evidenceCount: evidence.length, managerVersion: 'stock-manager-v1' },
    };
    const value = { ...valueBase, managerStance: buildManagerStance(valueBase) };
    stockManagerSnapshotCache.set(symbol, { expiresAt: Date.now() + 5 * 60_000, value });
    return value;
  }

  const cioManagerAgentCache = new Map<string, { expiresAt: number; value: any }>();

  function buildCioManagerInput(snapshot: any) {
    const evidenceIds = new Set<string>((snapshot.evidenceIds || []).map(String).filter(Boolean));
    return { snapshot, evidenceIds };
  }

  function normalizeManagerItems(items: unknown, evidenceSet: Set<string>, maxItems = 8) {
    if (!Array.isArray(items)) return [];
    return items.slice(0, maxItems).map((item: any) => ({
      text: sanitizeTeacherText(item?.text, 220),
      evidenceIds: Array.isArray(item?.evidenceIds) ? [...new Set<string>(item.evidenceIds.map(String).filter((id: string) => evidenceSet.has(id)))].slice(0, 8) : [],
    })).filter((item: any) => item.text && item.evidenceIds.length);
  }

  const cninfoDocumentCache = new Map<string, { expiresAt: number; value: any }>();
  const stockBusinessSegmentsCache = new Map<string, { expiresAt: number; value: any }>();

  async function parseCninfoDocument(announcementId: string, announcementTime: string, stockCode: string, force = false) {
    if (!/^\d{8,20}$/.test(announcementId)) throw new Error('announcementId 应为 8 至 20 位数字');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(announcementTime)) throw new Error('announcementTime 应为 YYYY-MM-DD');
    if (!/^\d{6}$/.test(stockCode)) throw new Error('stockCode 应为 6 位证券代码');
    const cacheKey = `${announcementId}:${announcementTime}:${stockCode}`;
    const cached = cninfoDocumentCache.get(cacheKey);
    if (!force && cached && cached.expiresAt > Date.now()) return { ...cached.value, sourceMeta: { ...cached.value.sourceMeta, cache: 'memory_hit' } };
    const invocation = resolvePythonInvocation('cninfo_document_parser.py', [announcementId, announcementTime, stockCode, ...(force ? ['--force'] : [])]);
    const { stdout } = await execFileAsync(invocation.command, invocation.args, { timeout: 120_000, windowsHide: true, maxBuffer: 3 * 1024 * 1024, env: pythonChildEnv() });
    const payload = JSON.parse(stdout);
    const value = {
      document: payload?.document || null,
      sections: Array.isArray(payload?.sections) ? payload.sections : [],
      businessSegments: payload?.businessSegments || { segmentSets: [], dataGaps: [] },
      ocrEvidence: Array.isArray(payload?.ocrEvidence) ? payload.ocrEvidence : [],
      dataGaps: Array.isArray(payload?.dataGaps) ? payload.dataGaps : [],
      sourceMeta: { ...(payload?.sourceMeta || {}), fetchedAt: new Date().toISOString(), freshness: 'delayed', confidence: 'official', fallbackLevel: 0 },
    };
    cninfoDocumentCache.set(cacheKey, { expiresAt: Date.now() + 30 * 60_000, value });
    return value;
  }

  function cninfoAnnouncementIdentity(item: any) {
    const url = String(item?.url || '');
    const id = url.match(/announcementId[=:/]([0-9]{8,20})/i)?.[1] || url.match(/([0-9]{10,20})(?!.*[0-9])/)?.[1] || '';
    const published = String(item?.publishedAt || '').match(/\d{4}-\d{2}-\d{2}/)?.[0] || '';
    return { announcementId: id, announcementTime: published };
  }

  function isBusinessReportTitle(title: unknown) {
    const value = String(title || '').replace(/\s+/g, '');
    return /(年度报告|年报|半年度报告|半年报)/.test(value) && !/(摘要|英文版|取消|更正|问询函)/.test(value);
  }

  async function buildStockBusinessSegments(input: string) {
    const symbol = normalizeAshareSymbol(input).code;
    const cached = stockBusinessSegmentsCache.get(symbol);
    if (cached && cached.expiresAt > Date.now()) return { ...cached.value, snapshotMeta: { ...cached.value.snapshotMeta, source: 'cache', freshness: 'stale' } };
    const end = new Date();
    const start = new Date(end.getTime() - 800 * 86_400_000);
    const compact = (date: Date) => date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }).replaceAll('-', '');
    const announcementPayload = await fetchCninfoAnnouncements(symbol, compact(start), compact(end));
    const candidates = (announcementPayload.announcements || []).filter((item: any) => isBusinessReportTitle(item?.title));
    const selected = candidates.map((item: any) => ({ ...item, ...cninfoAnnouncementIdentity(item) })).find((item: any) => item.announcementId && item.announcementTime);
    if (!selected) throw new Error('未找到可解析的年报或半年报公告；不会从标题或摘要推断分业务数据。');
    const parsed = await parseCninfoDocument(selected.announcementId, selected.announcementTime, symbol);
    const sets = Array.isArray(parsed?.businessSegments?.segmentSets) ? parsed.businessSegments.segmentSets : [];
    const evidence = [
      ...(parsed.sections || []).filter((section: any) => /^business_by_|revenue_composition$/.test(String(section?.sectionType || ''))).map((section: any) => ({
        evidenceId: section.evidenceId, type: 'financial', title: `分业务原文：${section.sectionType}`, value: section.snippet, period: selected.announcementTime, pageNumber: section.pageNumber,
        source: 'cninfo', sourceUrl: parsed.document?.documentUrl, fetchedAt: parsed.sourceMeta?.fetchedAt, freshness: 'delayed', verification: 'official_verified',
      })),
      ...sets.flatMap((set: any) => (set.items || []).map((item: any) => ({
        evidenceId: item.evidenceId, type: 'financial', title: `${set.dimension}：${item.name}`, value: item.revenue, period: selected.announcementTime, pageNumber: item.pageNumber,
        source: 'cninfo_pdf_table', sourceUrl: parsed.document?.documentUrl, fetchedAt: parsed.sourceMeta?.fetchedAt, freshness: 'delayed', verification: 'official_verified', sourceEvidenceIds: [item.sourceEvidenceId].filter(Boolean),
      }))),
    ];
    const dataGaps = [...(parsed.dataGaps || []), ...sets.filter((set: any) => set.status !== 'available').map((set: any) => set.dataGap || `${set.dimension}章节仅有原文证据，未可靠识别表格数值。`)];
    const value = {
      symbol,
      announcement: { title: selected.title, publishedAt: selected.announcementTime, announcementId: selected.announcementId, sourceUrl: selected.url || null },
      document: parsed.document,
      segmentSets: sets,
      evidence,
      dataGaps: [...new Set(dataGaps.filter(Boolean))],
      snapshotMeta: { generatedAt: new Date().toISOString(), source: 'live', freshness: 'delayed', evidenceCount: evidence.length },
    };
    stockBusinessSegmentsCache.set(symbol, { expiresAt: Date.now() + 6 * 60 * 60_000, value });
    return value;
  }

  function normalizeCioModuleExplanations(items: unknown, evidenceSet: Set<string>) {
    const validModules = new Set(['fundamental', 'technical', 'events', 'sentiment', 'valuation', 'risk', 'industry']);
    if (!Array.isArray(items)) return {};
    const result: Record<string, any> = {};
    for (const item of items.slice(0, 6)) {
      const module = String(item?.module || '');
      if (!validModules.has(module) || result[module]) continue;
      const why = normalizeManagerItems(item?.why, evidenceSet, 3);
      const supporting = normalizeManagerItems(item?.supporting, evidenceSet, 3);
      const counter = normalizeManagerItems(item?.counter, evidenceSet, 3);
      const conclusion = sanitizeTeacherText(item?.conclusion, 180);
      if (!conclusion && !why.length && !supporting.length && !counter.length) continue;
      result[module] = { conclusion, why, supporting, counter, evidenceIds: [...new Set([...why, ...supporting, ...counter].flatMap((entry: any) => entry.evidenceIds || []))] };
    }
    return result;
  }

  function fallbackCioManagerOpinion(snapshot: any, input: ReturnType<typeof buildCioManagerInput>, reason: string) {
    const toItems = (items: any[]) => normalizeManagerItems((items || []).map((item: any) => ({ text: item.text || item.claim || item.description || '', evidenceIds: item.evidenceIds || [] })), input.evidenceIds);
    const blocked = snapshot.researchStatus === 'blocked';
    const conclusion = blocked
      ? '核心研究输入不可用，无法形成可核验的 CIO/Manager 汇总。'
      : `当前研究状态为 ${snapshot.researchStatus}；该状态由程序按风险否决、跨 Agent 冲突和数据缺口确定。`;
    return {
      agent: 'cio_manager', status: blocked ? 'blocked' : 'limited', conclusion,
      confidence: { score: Math.min(60, 25 + input.evidenceIds.size), level: 'limited', reason: `CIO/Manager 使用确定性回退：${reason}` },
      researchStatus: snapshot.researchStatus, riskDecision: snapshot.riskDecision, riskLevel: snapshot.riskLevel, conflicts: snapshot.conflicts || [],
      supportingCase: toItems(snapshot.supportingCase), counterCase: toItems(snapshot.counterCase), requiredConditions: toItems(snapshot.requiredConditions), researchPriorities: toItems(snapshot.researchPriorities), uncertainties: (snapshot.dataGaps || []).slice(0, 10).map((text: string) => ({ text, evidenceIds: [] })), moduleExplanations: {},
      evidenceIds: [...input.evidenceIds], dataGaps: snapshot.dataGaps || [], managerStance: snapshot.managerStance,
    };
  }

  async function runCioManagerAgent(inputSymbol: string, refresh = false) {
    const symbol = normalizeAshareSymbol(inputSymbol).code;
    const cached = cioManagerAgentCache.get(symbol);
    if (!refresh && cached && cached.expiresAt > Date.now()) return { ...cached.value, agentMeta: { ...cached.value.agentMeta, source: 'cache' } };
    const snapshot = await buildStockManagerSnapshot(symbol);
    const input = buildCioManagerInput(snapshot);
    const promptEvidenceIds = new Set<string>([
      ...(snapshot.supportingCase || []),
      ...(snapshot.counterCase || []),
      ...(snapshot.requiredConditions || []),
      ...(snapshot.researchPriorities || []),
      ...(snapshot.conflicts || []),
    ].flatMap((item: any) => Array.isArray(item?.evidenceIds) ? item.evidenceIds.map(String) : []));
    const evidenceCatalog = (snapshot.evidence || []).map((item: any) => ({ evidenceId: String(item.evidenceId), title: item.title, value: item.value, period: item.period, source: item.source, sourceUrl: item.sourceUrl, publishedAt: item.publishedAt, verification: item.verification })).filter((item: any) => promptEvidenceIds.has(item.evidenceId));
    if (snapshot.researchStatus === 'blocked' || !input.evidenceIds.size) {
      const opinion = fallbackCioManagerOpinion(snapshot, input, snapshot.researchStatus === 'blocked' ? '核心输入不可用。' : '没有可引用的汇总证据，不调用 AI。');
      const value = { symbol, managerSnapshot: snapshot, deterministicManager: { researchStatus: snapshot.researchStatus, riskDecision: snapshot.riskDecision, riskLevel: snapshot.riskLevel, managerStance: snapshot.managerStance, conflicts: snapshot.conflicts, requiredConditions: snapshot.requiredConditions, researchPriorities: snapshot.researchPriorities }, opinion, agentMeta: { generatedAt: new Date().toISOString(), source: 'live', aiStatus: 'not_requested', promptVersion: 'cio-manager-v1', snapshotGeneratedAt: snapshot.snapshotMeta.generatedAt, managerVersion: snapshot.snapshotMeta.managerVersion } };
      cioManagerAgentCache.set(symbol, { expiresAt: Date.now() + 15 * 60_000, value });
      return value;
    }
    let opinion: any;
    let aiStatus: 'completed' | 'fallback' = 'completed';
    try {
      const parsed = await callAIWithParseRetry(
        '你是 CIO/Manager Agent。只解释输入中的冻结多 Agent 汇总快照和证据目录，不搜索新事实，不重新计算下游信号，不修改 researchStatus、riskDecision、riskLevel、conflicts、requiredConditions 或 researchPriorities。riskDecision 为 veto 时必须保留 researchStatus=rejected，blocked 必须保持 blocked；research_ready 只表示研究材料完整，不得写成买入、看多、可交易或收益判断。必须区分支持项、反方项、冲突和待验证条件。所有事实判断必须引用 evidenceCatalog 中存在的 evidenceId；没有证据只能放入 uncertainties。除总览外，为每个已提供的模块生成一段解释：只解释该模块事实，不能跨模块补充内容。输出必须精简：summary 不超过 120 个汉字；每个模块 conclusion 不超过 100 个汉字，why/supporting/counter 各最多 3 条；每条 text 不超过 100 个汉字，evidenceIds 最多 3 个。严格输出 JSON：{"summary":"","confidence":{"score":0,"level":"high|medium|limited","reason":""},"supportingCase":[{"text":"","evidenceIds":[]}],"counterCase":[{"text":"","evidenceIds":[]}],"requiredConditions":[{"text":"","evidenceIds":[]}],"researchPriorities":[{"text":"","evidenceIds":[]}],"uncertainties":[{"text":"","evidenceIds":[]}],"moduleExplanations":[{"module":"fundamental|technical|events|sentiment|valuation|risk","conclusion":"","why":[{"text":"","evidenceIds":[]}],"supporting":[{"text":"","evidenceIds":[]}],"counter":[{"text":"","evidenceIds":[]}]}]}' ,
        JSON.stringify({ symbol, deterministicManager: { researchStatus: snapshot.researchStatus, riskDecision: snapshot.riskDecision, riskLevel: snapshot.riskLevel, conflicts: snapshot.conflicts, supportingCase: snapshot.supportingCase, counterCase: snapshot.counterCase, requiredConditions: snapshot.requiredConditions, researchPriorities: snapshot.researchPriorities }, agentOutputs: snapshot.agentOutputs, dataGaps: snapshot.dataGaps, evidenceCatalog: (snapshot.evidence || []).map((item: any) => ({ evidenceId: String(item.evidenceId), title: item.title, value: item.value, period: item.period, source: item.source, verification: item.verification })).slice(0, 80) }),
        0.1,
        2,
        4_000,
      );
      const supportingCase = normalizeManagerItems(parsed?.supportingCase, input.evidenceIds);
      const counterCase = normalizeManagerItems(parsed?.counterCase, input.evidenceIds);
      const requiredConditions = normalizeManagerItems(parsed?.requiredConditions, input.evidenceIds);
      const researchPriorities = normalizeManagerItems(parsed?.researchPriorities, input.evidenceIds);
      const uncertainties = normalizeEventAgentItems(parsed?.uncertainties, input.evidenceIds);
      const moduleExplanations = normalizeCioModuleExplanations(parsed?.moduleExplanations, input.evidenceIds);
      const citedIds = [...new Set<string>([...supportingCase, ...counterCase, ...requiredConditions, ...researchPriorities, ...uncertainties, ...Object.values(moduleExplanations).flatMap((item: any) => item.evidenceIds || [])].flatMap((item: any) => item.evidenceIds || item))];
      const requestedLevel = ['high', 'medium', 'limited'].includes(parsed?.confidence?.level) ? parsed.confidence.level : 'limited';
      const confidenceLevel = snapshot.dataGaps.length || !citedIds.length || snapshot.researchStatus !== 'research_ready' ? 'limited' : requestedLevel === 'high' ? 'medium' : requestedLevel;
      const confidenceScore = Math.max(0, Math.min(confidenceLevel === 'limited' ? 65 : 85, Number(parsed?.confidence?.score) || 0));
      opinion = {
        agent: 'cio_manager', status: snapshot.researchStatus === 'blocked' ? 'blocked' : snapshot.dataGaps.length || !citedIds.length ? 'limited' : 'completed',
        conclusion: sanitizeTeacherText(parsed?.summary, 280) || 'CIO/Manager 汇总解释暂不可用。',
        confidence: { score: confidenceScore, level: confidenceLevel, reason: sanitizeTeacherText(parsed?.confidence?.reason, 180) || '置信度由输入完整度、风险状态、冲突和证据引用共同约束。' },
        researchStatus: snapshot.researchStatus, riskDecision: snapshot.riskDecision, riskLevel: snapshot.riskLevel, conflicts: snapshot.conflicts || [],
        supportingCase, counterCase, requiredConditions, researchPriorities, uncertainties, moduleExplanations, evidenceIds: citedIds, dataGaps: snapshot.dataGaps || [], managerStance: snapshot.managerStance,
      };
    } catch (error: any) {
      aiStatus = 'fallback';
      console.warn(`[cio-manager-agent] AI fallback for ${symbol}:`, error.message);
      opinion = fallbackCioManagerOpinion(snapshot, input, error.message);
    }
    const value = {
      symbol, managerSnapshot: snapshot,
      deterministicManager: { researchStatus: snapshot.researchStatus, riskDecision: snapshot.riskDecision, riskLevel: snapshot.riskLevel, managerStance: snapshot.managerStance, conflicts: snapshot.conflicts, requiredConditions: snapshot.requiredConditions, researchPriorities: snapshot.researchPriorities },
      opinion,
      agentMeta: { generatedAt: new Date().toISOString(), source: 'live', aiStatus, promptVersion: 'cio-manager-v1', snapshotGeneratedAt: snapshot.snapshotMeta.generatedAt, managerVersion: snapshot.snapshotMeta.managerVersion },
    };
    cioManagerAgentCache.set(symbol, { expiresAt: Date.now() + 15 * 60_000, value });
    return value;
  }

  const riskCounterAgentCache = new Map<string, { expiresAt: number; value: any }>();

  function buildRiskCounterInput(snapshot: any) {
    const riskItems = [...(snapshot.vetoes || []), ...(snapshot.risks || []), ...(snapshot.watchConditions || [])];
    const evidenceIds = new Set<string>(riskItems.flatMap((item: any) => Array.isArray(item.evidenceIds) ? item.evidenceIds.map(String) : []).filter(Boolean));
    return { snapshot, riskItems, evidenceIds };
  }

  function fallbackRiskCounterOpinion(snapshot: any, input: ReturnType<typeof buildRiskCounterInput>, reason: string) {
    const supportedItems = input.riskItems.filter((item: any) => item.evidenceIds?.length);
    const counterThesis = supportedItems.slice(0, 10).map((item: any) => ({ riskId: item.riskId, claim: item.claim, trigger: item.trigger, resolutionCondition: item.resolutionCondition, evidenceIds: item.evidenceIds }));
    const uncertainties = [...(snapshot.dataGaps || []).map((text: unknown) => ({ text: String(text), evidenceIds: [] }))];
    if (input.riskItems.length > supportedItems.length) uncertainties.unshift({ text: '部分确定性风险项缺少可引用证据，只能作为数据缺口保留。', evidenceIds: [] });
    const conclusion = snapshot.decision === 'blocked'
      ? '风险快照所需输入均不可用，无法形成可核验的反方结论。'
      : snapshot.decision === 'clear'
        ? '当前没有程序可验证的否决、降级或观察条件；这不代表安全、看多或可交易。'
        : `程序风险状态为 ${snapshot.decision}，应优先核验已触发条件及其解除标准。`;
    return {
      agent: 'risk_counter', status: snapshot.decision === 'blocked' ? 'blocked' : 'limited', conclusion,
      confidence: { score: Math.min(60, 25 + input.evidenceIds.size), level: 'limited', reason: `风险/反方 Agent 使用确定性回退：${reason}` },
      riskLevel: snapshot.riskLevel, decision: snapshot.decision, vetoes: snapshot.vetoes, risks: snapshot.risks, watchConditions: snapshot.watchConditions,
      counterThesis, uncertainties, evidenceIds: [...input.evidenceIds], dataGaps: snapshot.dataGaps || [],
    };
  }

  function normalizeRiskCounterItems(items: unknown, evidenceSet: Set<string>) {
    if (!Array.isArray(items)) return [];
    return items.slice(0, 10).map((item: any) => {
      const evidenceIds = Array.isArray(item?.evidenceIds) ? [...new Set<string>(item.evidenceIds.map(String).filter((id: string) => evidenceSet.has(id)))].slice(0, 8) : [];
      return { riskId: sanitizeTeacherText(item?.riskId, 120), claim: sanitizeTeacherText(item?.claim, 220), trigger: sanitizeTeacherText(item?.trigger, 180), resolutionCondition: sanitizeTeacherText(item?.resolutionCondition, 180), evidenceIds };
    }).filter((item: any) => item.claim && item.evidenceIds.length);
  }

  async function runRiskCounterAgent(inputSymbol: string, refresh = false) {
    const symbol = normalizeAshareSymbol(inputSymbol).code;
    const cached = riskCounterAgentCache.get(symbol);
    if (!refresh && cached && cached.expiresAt > Date.now()) return { ...cached.value, agentMeta: { ...cached.value.agentMeta, source: 'cache' } };
    const snapshot = await buildStockRiskSnapshot(symbol);
    const input = buildRiskCounterInput(snapshot);
    const evidenceCatalog = (snapshot.evidence || []).map((item: any) => ({ evidenceId: String(item.evidenceId), title: item.title, value: item.value, period: item.period, source: item.source, sourceUrl: item.sourceUrl, publishedAt: item.publishedAt, verification: item.verification })).filter((item: any) => input.evidenceIds.has(item.evidenceId));
    if (snapshot.decision === 'blocked' || !input.evidenceIds.size) {
      const opinion = fallbackRiskCounterOpinion(snapshot, input, snapshot.decision === 'blocked' ? '风险快照输入不可用。' : '没有可引用的风险证据，不调用 AI。');
      const value = { symbol, riskSnapshot: snapshot, deterministicRisk: { riskLevel: snapshot.riskLevel, decision: snapshot.decision, vetoes: snapshot.vetoes, risks: snapshot.risks, watchConditions: snapshot.watchConditions, valuation: snapshot.valuation }, opinion, agentMeta: { generatedAt: new Date().toISOString(), source: 'live', aiStatus: 'not_requested', promptVersion: 'risk-counter-v1', snapshotGeneratedAt: snapshot.snapshotMeta.generatedAt, riskVersion: snapshot.snapshotMeta.riskVersion } };
      riskCounterAgentCache.set(symbol, { expiresAt: Date.now() + 15 * 60_000, value });
      return value;
    }
    let opinion: any;
    let aiStatus: 'completed' | 'fallback' = 'completed';
    try {
      const raw = await callAI(
        '你是个股风险与反方 Agent。只解释输入中的冻结风险快照、确定性风险项和证据，不搜索新事实、不预测股价、不提供买卖指令或仓位。riskLevel、decision、vetoes、risks、watchConditions 和 valuation 均由程序确定，不得改写。你的任务是说明已触发风险、正向结论依赖的前提及其证伪/解除条件；不得把 clear 写成安全或看多，不得把 unavailable 写成风险已解除。所有事实判断必须引用 evidenceCatalog 中存在的 evidenceId；没有证据只能放入 uncertainties。严格输出 JSON：{"summary":"","confidence":{"score":0,"level":"high|medium|limited","reason":""},"counterThesis":[{"riskId":"","claim":"","trigger":"","resolutionCondition":"","evidenceIds":[]}],"uncertainties":[{"text":"","evidenceIds":[]}]}' ,
        JSON.stringify({ symbol, deterministicRisk: { riskLevel: snapshot.riskLevel, decision: snapshot.decision, vetoes: snapshot.vetoes, risks: snapshot.risks, watchConditions: snapshot.watchConditions, valuation: snapshot.valuation }, dataGaps: snapshot.dataGaps, evidenceCatalog }),
        0.1,
        3_500,
      );
      const parsed = parseAIJson(raw);
      const counterThesis = normalizeRiskCounterItems(parsed?.counterThesis, input.evidenceIds);
      const uncertainties = normalizeEventAgentItems(parsed?.uncertainties, input.evidenceIds);
      const citedIds = [...new Set<string>([...counterThesis, ...uncertainties].flatMap((item: any) => item.evidenceIds || []))];
      const requestedLevel = ['high', 'medium', 'limited'].includes(parsed?.confidence?.level) ? parsed.confidence.level : 'limited';
      const confidenceLevel = snapshot.dataGaps.length || !citedIds.length ? 'limited' : requestedLevel === 'high' ? 'medium' : requestedLevel;
      const confidenceScore = Math.max(0, Math.min(confidenceLevel === 'limited' ? 65 : 85, Number(parsed?.confidence?.score) || 0));
      opinion = {
        agent: 'risk_counter', status: snapshot.dataGaps.length || !citedIds.length ? 'limited' : 'completed', conclusion: sanitizeTeacherText(parsed?.summary, 280) || '风险/反方解释暂不可用。',
        confidence: { score: confidenceScore, level: confidenceLevel, reason: sanitizeTeacherText(parsed?.confidence?.reason, 180) || '置信度由风险证据、数据完整度和证据引用共同约束。' },
        riskLevel: snapshot.riskLevel, decision: snapshot.decision, vetoes: snapshot.vetoes, risks: snapshot.risks, watchConditions: snapshot.watchConditions,
        counterThesis, uncertainties, evidenceIds: citedIds, dataGaps: snapshot.dataGaps || [],
      };
    } catch (error: any) {
      aiStatus = 'fallback';
      console.warn(`[risk-counter-agent] AI fallback for ${symbol}:`, error.message);
      opinion = fallbackRiskCounterOpinion(snapshot, input, error.message);
    }
    const value = {
      symbol, riskSnapshot: snapshot,
      deterministicRisk: { riskLevel: snapshot.riskLevel, decision: snapshot.decision, vetoes: snapshot.vetoes, risks: snapshot.risks, watchConditions: snapshot.watchConditions, valuation: snapshot.valuation },
      opinion,
      agentMeta: { generatedAt: new Date().toISOString(), source: 'live', aiStatus, promptVersion: 'risk-counter-v1', snapshotGeneratedAt: snapshot.snapshotMeta.generatedAt, riskVersion: snapshot.snapshotMeta.riskVersion },
    };
    riskCounterAgentCache.set(symbol, { expiresAt: Date.now() + 15 * 60_000, value });
    return value;
  }

  async function fetchFinancialSummary(symbol: string) {
    if (!/^\d{6}$/.test(symbol)) throw new Error('symbol 应为 6 位证券代码');
    const invocation = resolvePythonInvocation('financial_summary.py', [symbol]);
    const { stdout } = await execFileAsync(invocation.command, invocation.args, { timeout: 45_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024, env: pythonChildEnv() });
    const payload = JSON.parse(stdout);
    return {
      reports: Array.isArray(payload?.reports) ? payload.reports : [],
      sourceMeta: { source: 'sina_financial_summary', fetchedAt: new Date().toISOString(), freshness: 'delayed', confidence: 'market', fallbackLevel: 0, officialStatus: 'official_document_only' },
    };
  }

  const xueqiuProfileCache = new Map<string, { expiresAt: number; value: any }>();
  let xueqiuHeatCache: { expiresAt: number; value: any } | null = null;

  async function runXueqiuAdapter(args: string[]) {
    const invocation = resolvePythonInvocation('xueqiu_insights.py', args);
    const { stdout } = await execFileAsync(invocation.command, invocation.args, { timeout: 60_000, windowsHide: true, maxBuffer: 3 * 1024 * 1024, env: pythonChildEnv() });
    return JSON.parse(stdout);
  }

  async function fetchXueqiuProfile(symbol: string) {
    if (!/^\d{6}$/.test(symbol)) throw new Error('symbol 应为 6 位证券代码');
    const cached = xueqiuProfileCache.get(symbol);
    if (cached && cached.expiresAt > Date.now()) return { ...cached.value, sourceMeta: { ...cached.value.sourceMeta, source: 'cache', freshness: 'stale', fallbackLevel: 1 } };
    const payload = await runXueqiuAdapter(['profile', symbol]);
    const value = { profile: payload?.profile || {}, sourceMeta: { source: 'xueqiu', fetchedAt: new Date().toISOString(), freshness: 'delayed', confidence: 'market', fallbackLevel: 0 } };
    xueqiuProfileCache.set(symbol, { expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, value });
    return value;
  }

  async function fetchXueqiuHeat() {
    if (xueqiuHeatCache && xueqiuHeatCache.expiresAt > Date.now()) return { ...xueqiuHeatCache.value, sourceMeta: { ...xueqiuHeatCache.value.sourceMeta, source: 'cache', freshness: 'stale', fallbackLevel: 1 } };
    const payload = await runXueqiuAdapter(['heat']);
    const value = { items: Array.isArray(payload?.items) ? payload.items : [], sourceMeta: { source: 'xueqiu', fetchedAt: new Date().toISOString(), freshness: 'delayed', confidence: 'sentiment', fallbackLevel: 0 } };
    xueqiuHeatCache = { expiresAt: Date.now() + 15 * 60 * 1000, value };
    return value;
  }

  function ratio(current: unknown, prior: unknown) {
    if (current === null || current === undefined || prior === null || prior === undefined) return null;
    const currentValue = Number(current);
    const priorValue = Number(prior);
    return Number.isFinite(currentValue) && Number.isFinite(priorValue) && priorValue !== 0 ? currentValue / priorValue - 1 : null;
  }

  function divide(numerator: unknown, denominator: unknown) {
    if (numerator === null || numerator === undefined || denominator === null || denominator === undefined) return null;
    const numeratorValue = Number(numerator);
    const denominatorValue = Number(denominator);
    return Number.isFinite(numeratorValue) && Number.isFinite(denominatorValue) && denominatorValue !== 0 ? numeratorValue / denominatorValue : null;
  }

  function previousYearReport(reports: any[], period?: string) {
    if (!period) return null;
    const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(period);
    if (!matched) return null;
    const priorPeriod = `${Number(matched[1]) - 1}-${matched[2]}-${matched[3]}`;
    return reports.find((report: any) => report.period === priorPeriod) || null;
  }

  function calculateFinancialMetrics(reports: any[], template: 'bank' | 'non_financial', source = 'ths_financial_statements') {
    const latest = reports[0] || null;
    const prior = previousYearReport(reports, latest?.period);
    if (!latest) return { template, period: null, metrics: {}, dataGaps: ['尚无可用于计算的结构化报告期'] };
    const current = latest.metrics || {};
    const previous = prior?.metrics || {};
    const averageEquity = current.equity != null && previous.equity != null ? (Number(current.equity) + Number(previous.equity)) / 2 : null;
    const averageBalance = (key: string) => current[key] != null && previous[key] != null ? (Number(current[key]) + Number(previous[key])) / 2 : null;
    const debtKeys = ['shortTermBorrowings', 'currentPortionOfNonCurrentDebt', 'longTermBorrowings', 'bondsPayable', 'leaseLiabilities'];
    const sumDebt = (row: any) => {
      const values = debtKeys.map((key) => finiteNumber(row?.[key]));
      return values.some((value) => value !== null) ? values.reduce((sum, value) => sum + (value || 0), 0) : null;
    };
    const interestBearingDebt = sumDebt(current);
    const priorInterestBearingDebt = sumDebt(previous);
    const interestExpense = finiteNumber(current.interestExpense);
    const ebitProxy = current.operatingProfit != null && interestExpense !== null ? Number(current.operatingProfit) + Math.abs(interestExpense) : null;
    const effectiveTaxRate = divide(current.incomeTaxExpense, current.profitBeforeTax);
    const investedCapitalProxy = averageEquity !== null && interestBearingDebt !== null && priorInterestBearingDebt !== null && current.cashAndCashEquivalents != null && previous.cashAndCashEquivalents != null
      ? averageEquity + (interestBearingDebt + priorInterestBearingDebt) / 2 - (Number(current.cashAndCashEquivalents) + Number(previous.cashAndCashEquivalents)) / 2 : null;
    const month = Number((latest.period || '').slice(5, 7));
    const periodDays = month === 3 ? 90 : month === 6 ? 181 : month === 9 ? 273 : month === 12 ? 365 : null;
    const annualizedTurnover = (numerator: unknown, averageBalanceValue: number | null) => {
      const value = divide(numerator, averageBalanceValue);
      return value !== null && periodDays !== null ? value * 365 / periodDays : null;
    };
    const metricDetails = (metrics: Record<string, unknown>, definitions: Record<string, { unit: string; formula: string; inputs: string[]; applicability?: 'applicable' | 'not_applicable' }>) => Object.fromEntries(Object.entries(definitions).map(([key, definition]) => {
      const value = finiteNumber(metrics[key]);
      const applicable = definition.applicability !== 'not_applicable';
      return [key, { value, status: !applicable ? 'not_applicable' : value === null ? 'data_insufficient' : 'available', period: latest.period, comparisonPeriod: prior?.period || null, unit: definition.unit, source, formula: definition.formula, inputFields: definition.inputs, dataGap: !applicable ? '该指标不适用于银行财务口径。' : value === null ? `缺少计算 ${key} 所需字段。` : null }];
    }));
    const common = {
      revenueYoY: ratio(current.revenue, previous.revenue),
      netProfitYoY: ratio(current.netProfit, previous.netProfit),
      adjustedNetProfitYoY: ratio(current.adjustedNetProfit, previous.adjustedNetProfit),
      equityYoY: ratio(current.equity, previous.equity),
      roeApprox: divide(current.netProfit, averageEquity),
    };
    if (template === 'bank') {
      const metrics = {
        ...common,
        assetYoY: ratio(current.assets, previous.assets),
        loanYoY: ratio(current.loans, previous.loans),
        depositYoY: ratio(current.deposits, previous.deposits),
        interestNetIncomeYoY: ratio(current.interestNetIncome, previous.interestNetIncome),
        feeNetIncomeYoY: ratio(current.feeNetIncome, previous.feeNetIncome),
        creditImpairmentToRevenue: divide(current.creditImpairment, current.revenue),
      };
      return {
        template, period: latest.period, comparisonPeriod: prior?.period || null,
        unit: { amount: 'CNY', ratio: 'fraction' }, source,
        metrics,
        metricDetails: metricDetails(metrics, {
          revenueYoY: { unit: 'fraction', formula: '(本期营业收入/上年同期营业收入)-1', inputs: ['revenue'] }, netProfitYoY: { unit: 'fraction', formula: '(本期净利润/上年同期净利润)-1', inputs: ['netProfit'] }, adjustedNetProfitYoY: { unit: 'fraction', formula: '(本期扣非净利润/上年同期扣非净利润)-1', inputs: ['adjustedNetProfit'] }, equityYoY: { unit: 'fraction', formula: '(本期权益/上年同期权益)-1', inputs: ['equity'] }, roeApprox: { unit: 'fraction', formula: '本期净利润/平均权益', inputs: ['netProfit', 'equity'] }, assetYoY: { unit: 'fraction', formula: '(本期资产/上年同期资产)-1', inputs: ['assets'] }, loanYoY: { unit: 'fraction', formula: '(本期贷款/上年同期贷款)-1', inputs: ['loans'] }, depositYoY: { unit: 'fraction', formula: '(本期存款/上年同期存款)-1', inputs: ['deposits'] }, interestNetIncomeYoY: { unit: 'fraction', formula: '(本期净利息收入/上年同期净利息收入)-1', inputs: ['interestNetIncome'] }, feeNetIncomeYoY: { unit: 'fraction', formula: '(本期手续费及佣金净收入/上年同期)-1', inputs: ['feeNetIncome'] }, creditImpairmentToRevenue: { unit: 'fraction', formula: '信用减值损失/营业收入', inputs: ['creditImpairment', 'revenue'] },
        }),
        notApplicableMetrics: ['grossMargin', 'inventoryTurnover', 'inventoryDays', 'accountsReceivableTurnover', 'accountsReceivableDays', 'interestBearingDebt', 'netDebt', 'interestCoverage', 'freeCashFlow', 'roic'],
        dataGaps: ['净息差、不良贷款率、拨备覆盖率和资本充足率需继续从 CNINFO 定期报告解析。普通企业的毛利率、存货周转、债务覆盖和自由现金流指标不适用于银行模板。'],
      };
    }
    const freeCashFlow = current.operatingCashFlow != null && current.capex != null ? Number(current.operatingCashFlow) - Math.abs(Number(current.capex)) : null;
    const accountsReceivableTurnover = annualizedTurnover(current.revenue, averageBalance('accountsReceivable'));
    const inventoryTurnover = annualizedTurnover(current.operatingCost, averageBalance('inventory'));
    const interestCoverage = ebitProxy !== null && interestExpense !== null && interestExpense !== 0 ? ebitProxy / Math.abs(interestExpense) : null;
    const metrics = {
      ...common,
      netMargin: divide(current.netProfit, current.revenue), adjustedNetMargin: divide(current.adjustedNetProfit, current.revenue), grossMargin: divide(current.revenue != null && current.operatingCost != null ? Number(current.revenue) - Number(current.operatingCost) : null, current.revenue), cashConversion: divide(current.operatingCashFlow, current.netProfit), assetLiabilityRatio: divide(current.liabilities, current.assets), freeCashFlow, freeCashFlowProxy: freeCashFlow, capex: finiteNumber(current.capex), accountsReceivableTurnover, inventoryTurnover, accountsReceivableDays: accountsReceivableTurnover !== null && accountsReceivableTurnover > 0 ? 365 / accountsReceivableTurnover : null, inventoryDays: inventoryTurnover !== null && inventoryTurnover > 0 ? 365 / inventoryTurnover : null, interestBearingDebt, netDebt: interestBearingDebt !== null && current.cashAndCashEquivalents != null ? interestBearingDebt - Number(current.cashAndCashEquivalents) : null, netDebtProxy: interestBearingDebt !== null && current.cashAndCashEquivalents != null ? interestBearingDebt - Number(current.cashAndCashEquivalents) : null, interestCoverage, interestCoverageProxy: interestCoverage, effectiveTaxRate, investedCapitalProxy, roic: ebitProxy !== null && effectiveTaxRate !== null && investedCapitalProxy !== null && investedCapitalProxy > 0 ? (ebitProxy * (1 - effectiveTaxRate)) / investedCapitalProxy : null,
    };
    return {
      template, period: latest.period, comparisonPeriod: prior?.period || null,
      unit: { amount: 'CNY', ratio: 'fraction', turnover: 'times_per_year', days: 'days' }, source, metrics,
      metricDetails: metricDetails(metrics, {
        revenueYoY: { unit: 'fraction', formula: '(本期营业收入/上年同期营业收入)-1', inputs: ['revenue'] }, netProfitYoY: { unit: 'fraction', formula: '(本期净利润/上年同期净利润)-1', inputs: ['netProfit'] }, adjustedNetProfitYoY: { unit: 'fraction', formula: '(本期扣非净利润/上年同期扣非净利润)-1', inputs: ['adjustedNetProfit'] }, equityYoY: { unit: 'fraction', formula: '(本期权益/上年同期权益)-1', inputs: ['equity'] }, roeApprox: { unit: 'fraction', formula: '本期净利润/平均权益', inputs: ['netProfit', 'equity'] }, grossMargin: { unit: 'fraction', formula: '(营业收入-营业成本)/营业收入', inputs: ['revenue', 'operatingCost'] }, netMargin: { unit: 'fraction', formula: '净利润/营业收入', inputs: ['netProfit', 'revenue'] }, adjustedNetMargin: { unit: 'fraction', formula: '扣非净利润/营业收入', inputs: ['adjustedNetProfit', 'revenue'] }, accountsReceivableTurnover: { unit: 'times_per_year', formula: '营业收入年化/平均应收账款', inputs: ['revenue', 'accountsReceivable'] }, accountsReceivableDays: { unit: 'days', formula: '365/应收账款周转率', inputs: ['accountsReceivableTurnover'] }, inventoryTurnover: { unit: 'times_per_year', formula: '营业成本年化/平均存货', inputs: ['operatingCost', 'inventory'] }, inventoryDays: { unit: 'days', formula: '365/存货周转率', inputs: ['inventoryTurnover'] }, interestBearingDebt: { unit: 'CNY', formula: '短期借款+一年内到期非流动负债+长期借款+应付债券+租赁负债', inputs: debtKeys }, netDebt: { unit: 'CNY', formula: '有息负债-货币资金', inputs: ['interestBearingDebt', 'cashAndCashEquivalents'] }, interestCoverage: { unit: 'times', formula: 'EBIT代理值/利息费用绝对值', inputs: ['operatingProfit', 'interestExpense'] }, operatingCashFlow: { unit: 'CNY', formula: '经营活动现金流量净额', inputs: ['operatingCashFlow'] }, capex: { unit: 'CNY', formula: '购建长期资产支付的现金', inputs: ['capex'] }, freeCashFlow: { unit: 'CNY', formula: '经营现金流-资本开支绝对值', inputs: ['operatingCashFlow', 'capex'] }, roic: { unit: 'fraction', formula: 'EBIT代理值×(1-有效税率)/平均投入资本代理值', inputs: ['operatingProfit', 'interestExpense', 'incomeTaxExpense', 'profitBeforeTax', 'equity', ...debtKeys, 'cashAndCashEquivalents'] },
      }),
      dataGaps: [
        ...(current.operatingCost == null ? ['缺少营业成本，无法计算毛利率和存货周转率。'] : []),
        ...(current.accountsReceivable == null ? ['缺少应收账款，无法计算应收周转率。'] : []),
        ...(current.inventory == null ? ['缺少存货，无法计算存货周转率。'] : []),
        ...(interestExpense === null ? ['缺少利息费用，无法计算利息覆盖代理值。'] : []),
        ...(investedCapitalProxy === null || effectiveTaxRate === null ? ['缺少平均投入资本或税费口径，无法计算 ROIC。'] : []),
      ],
    };
  }

  async function fetchThsFinancialStatements(symbol: string) {
    if (!/^\d{6}$/.test(symbol)) throw new Error('symbol 应为 6 位证券代码');
    const invocation = resolvePythonInvocation('ths_financial_statements.py', [symbol]);
    const { stdout } = await execFileAsync(invocation.command, invocation.args, { timeout: 90_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024, env: pythonChildEnv() });
    const payload = JSON.parse(stdout);
    const reports = Array.isArray(payload?.reports) ? payload.reports : [];
    if (!reports.length) throw new Error('同花顺三大报表未返回有效报告期');
    const template = payload?.template === 'bank' ? 'bank' : 'non_financial';
    return {
      reports, template, unit: payload?.unit || 'CNY', normalization: payload?.normalization,
      calculations: calculateFinancialMetrics(reports, template, 'ths_financial_statements'),
      sourceMeta: { source: 'ths_financial_statements', fetchedAt: new Date().toISOString(), freshness: 'delayed', confidence: 'market', fallbackLevel: 0, officialStatus: 'official_document_only' },
    };
  }

  async function fetchFinancialDataWithFallback(symbol: string) {
    try {
      return await fetchThsFinancialStatements(symbol);
    } catch (error: any) {
      console.warn(`[financial-source] ths ${symbol} failed:`, error.message);
      const fallback = await fetchFinancialSummary(symbol);
      const reports = fallback.reports || [];
      return {
        ...fallback,
        template: 'non_financial' as const,
        unit: 'CNY',
        normalization: '金额单位由摘要源提供；未覆盖的字段为空。',
        calculations: calculateFinancialMetrics(reports, 'non_financial', fallback.sourceMeta?.source || 'sina_financial_summary'),
        sourceMeta: { ...fallback.sourceMeta, fallbackLevel: 1 },
      };
    }
  }

  const stockTechnicalCache = new Map<string, { expiresAt: number; value: any }>();

  function average(values: number[]) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  }

  function standardDeviation(values: number[]) {
    const mean = average(values);
    if (mean === null || values.length < 2) return null;
    return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
  }

  function exponentialMovingAverage(values: number[], period: number) {
    if (values.length < period) return null;
    const multiplier = 2 / (period + 1);
    let result = average(values.slice(0, period))!;
    for (const value of values.slice(period)) result = value * multiplier + result * (1 - multiplier);
    return result;
  }

  function roundMetric(value: number | null, digits = 4) {
    return value === null || !Number.isFinite(value) ? null : Math.round(value * 10 ** digits) / 10 ** digits;
  }

  function rollingAverage(values: number[], period: number) {
    return values.map((_value, index) => index + 1 < period ? null : average(values.slice(index - period + 1, index + 1)));
  }

  function emaSeries(values: number[], period: number) {
    const result: Array<number | null> = Array(values.length).fill(null);
    if (values.length < period) return result;
    const multiplier = 2 / (period + 1);
    let current = average(values.slice(0, period))!;
    result[period - 1] = current;
    for (let index = period; index < values.length; index += 1) {
      current = values[index] * multiplier + current * (1 - multiplier);
      result[index] = current;
    }
    return result;
  }

  function rollingRsi(values: number[], period: number) {
    return values.map((_value, index) => {
      if (index < period) return null;
      const moves = values.slice(index - period, index + 1).map((value, moveIndex, list) => moveIndex ? value - list[moveIndex - 1] : null).filter((value): value is number => value !== null);
      const gains = average(moves.map((value) => Math.max(0, value)));
      const losses = average(moves.map((value) => Math.max(0, -value)));
      return gains === null || losses === null ? null : losses === 0 ? 100 : 100 - 100 / (1 + gains / losses);
    });
  }

  function latestSeriesChange(values: Array<number | null>, days: number) {
    const latestIndex = values.length - 1;
    const current = values[latestIndex];
    const prior = values[latestIndex - days];
    return current === null || current === undefined || prior === null || prior === undefined ? null : current - prior;
  }

  function percentileRank(current: number | null, history: Array<number | null>) {
    const values = history.filter((value): value is number => value !== null && Number.isFinite(value));
    if (current === null || !values.length) return null;
    return values.filter((value) => value <= current).length / values.length;
  }

  function maxDrawdown(values: number[]) {
    if (!values.length) return null;
    let peak = values[0]; let drawdown = 0;
    for (const value of values) {
      peak = Math.max(peak, value);
      drawdown = Math.min(drawdown, value / peak - 1);
    }
    return drawdown;
  }

  function latestCross(left: Array<number | null>, right: Array<number | null>, dates: string[]) {
    for (let index = left.length - 1; index > 0; index -= 1) {
      const previousLeft = left[index - 1], previousRight = right[index - 1], currentLeft = left[index], currentRight = right[index];
      if ([previousLeft, previousRight, currentLeft, currentRight].some((value) => value === null)) continue;
      if (previousLeft! <= previousRight! && currentLeft! > currentRight!) return { type: 'golden_cross', date: dates[index] };
      if (previousLeft! >= previousRight! && currentLeft! < currentRight!) return { type: 'death_cross', date: dates[index] };
    }
    return null;
  }

  function calculateTechnicalMetrics(bars: any[], adjust = 'qfq') {
    const cleanBars = bars.filter((bar: any) => [bar.close, bar.high, bar.low, bar.volume].every((value) => Number.isFinite(Number(value)))).sort((a: any, b: any) => String(a.date).localeCompare(String(b.date)));
    if (cleanBars.length < 60) throw new Error('可用日线不足 60 个交易日，无法计算技术指标');
    const closes = cleanBars.map((bar: any) => Number(bar.close));
    const volumes = cleanBars.map((bar: any) => Number(bar.volume));
    const dates = cleanBars.map((bar: any) => String(bar.date));
    const latest = cleanBars.at(-1);
    const ma20Series = rollingAverage(closes, 20);
    const ma50Series = rollingAverage(closes, 50);
    const ma200Series = rollingAverage(closes, 200);
    const ma20 = ma20Series.at(-1), ma50 = ma50Series.at(-1), ma200 = ma200Series.at(-1);
    const change = (days: number) => closes.length > days ? closes.at(-1)! / closes.at(-days - 1)! - 1 : null;
    const rsiSeries = rollingRsi(closes, 14);
    const rsi14 = rsiSeries.at(-1) ?? null;
    const trueRanges = cleanBars.map((bar: any, index: number) => index === 0 ? null : Math.max(Number(bar.high) - Number(bar.low), Math.abs(Number(bar.high) - closes[index - 1]), Math.abs(Number(bar.low) - closes[index - 1])));
    const atrSeries = trueRanges.map((_value, index) => index < 14 ? null : average(trueRanges.slice(index - 13, index + 1).filter((value): value is number => value !== null)));
    const atr14 = atrSeries.at(-1) ?? null;
    const ema12Series = emaSeries(closes, 12), ema26Series = emaSeries(closes, 26);
    const macdSeries = closes.map((_value, index) => ema12Series[index] !== null && ema26Series[index] !== null ? ema12Series[index]! - ema26Series[index]! : null);
    const validMacdIndexes = macdSeries.map((value, index) => value === null ? null : index).filter((value): value is number => value !== null);
    const compactSignal = emaSeries(validMacdIndexes.map((index) => macdSeries[index]!), 9);
    const macdSignalSeries: Array<number | null> = Array(closes.length).fill(null);
    validMacdIndexes.forEach((index, compactIndex) => { macdSignalSeries[index] = compactSignal[compactIndex]; });
    const macdHistogramSeries = macdSeries.map((value, index) => value !== null && macdSignalSeries[index] !== null ? value - macdSignalSeries[index]! : null);
    const macd = macdSeries.at(-1) ?? null, macdSignal = macdSignalSeries.at(-1) ?? null, macdHistogram = macdHistogramSeries.at(-1) ?? null;
    const logReturns = closes.map((value, index) => index ? Math.log(value / closes[index - 1]) : null);
    const volatilitySeries = logReturns.map((_value, index) => index < 20 ? null : (standardDeviation(logReturns.slice(index - 19, index + 1).filter((value): value is number => value !== null)) || 0) * Math.sqrt(252));
    const annualizedVolatility20d = volatilitySeries.at(-1) ?? null;
    const highest52w = Math.max(...cleanBars.slice(-252).map((bar: any) => Number(bar.high)));
    const lowest52w = Math.min(...cleanBars.slice(-252).map((bar: any) => Number(bar.low)));
    const support20d = Math.min(...cleanBars.slice(-21, -1).map((bar: any) => Number(bar.low)));
    const resistance60d = Math.max(...cleanBars.slice(-61, -1).map((bar: any) => Number(bar.high)));
    const keyLevelAtrBuffer = atr14 === null ? null : atr14 * 0.5;
    const consecutiveBelowBuffered = (levelSeries: Array<number | null>) => {
      let count = 0;
      for (let index = cleanBars.length - 1; index >= 0; index -= 1) {
        const close = closes[index];
        const level = levelSeries[index];
        const atr = atrSeries[index] ?? atr14;
        if (level === null || level === undefined || atr === null || close >= level - atr * 0.5) break;
        count += 1;
      }
      return count;
    };
    const consecutiveBelowStatic = (level: number) => {
      if (!Number.isFinite(level) || keyLevelAtrBuffer === null) return 0;
      let count = 0;
      for (let index = cleanBars.length - 1; index >= 0; index -= 1) {
        if (closes[index] >= level - keyLevelAtrBuffer) break;
        count += 1;
      }
      return count;
    };
    const volumeAbovePrior20Average = (index: number) => {
      if (index < 20) return false;
      const baseline = average(volumes.slice(index - 20, index));
      return baseline !== null && volumes[index] > baseline;
    };
    const latestTwoVolumeConfirmed = (levelSeries: Array<number | null>, staticLevel?: number) => {
      if (cleanBars.length < 2 || keyLevelAtrBuffer === null) return false;
      for (let index = cleanBars.length - 2; index < cleanBars.length; index += 1) {
        const level = staticLevel ?? levelSeries[index];
        const atr = atrSeries[index] ?? atr14;
        if (level === null || level === undefined || atr === null || closes[index] >= level - atr * 0.5 || !volumeAbovePrior20Average(index)) return false;
      }
      return true;
    };
    const ma20BreakDays = consecutiveBelowBuffered(ma20Series);
    const ma50BreakDays = consecutiveBelowBuffered(ma50Series);
    const ma200BreakDays = consecutiveBelowBuffered(ma200Series);
    const supportBreakDays = consecutiveBelowStatic(support20d);
    const ma20VolumeConfirmedBreak = latestTwoVolumeConfirmed(ma20Series);
    const ma50VolumeConfirmedBreak = latestTwoVolumeConfirmed(ma50Series);
    const ma200VolumeConfirmedBreak = latestTwoVolumeConfirmed(ma200Series);
    const supportVolumeConfirmedBreak = latestTwoVolumeConfirmed([], support20d);
    const trendAt = (index: number) => ma20Series[index] !== null && ma50Series[index] !== null && closes[index] > ma20Series[index]! && ma20Series[index]! > ma50Series[index]! ? 'bullish' : ma20Series[index] !== null && ma50Series[index] !== null && closes[index] < ma20Series[index]! && ma20Series[index]! < ma50Series[index]! ? 'bearish' : 'neutral';
    const trend = trendAt(cleanBars.length - 1);
    let trendDuration = 0;
    for (let index = cleanBars.length - 1; index >= 0 && trendAt(index) === trend; index -= 1) trendDuration += 1;
    const recentVolumes = volumes.slice(-21, -1);
    const volumeRatio20d = divide(Number(latest.volume), average(recentVolumes));
    const priceDirections = cleanBars.slice(-20).map((bar: any, index: number, selected: any[]) => index === 0 ? null : Number(bar.close) - Number(selected[index - 1].close));
    const upVolume = cleanBars.slice(-20).reduce((sum: number, bar: any, index: number, selected: any[]) => index && Number(bar.close) > Number(selected[index - 1].close) ? sum + Number(bar.volume) : sum, 0);
    const downVolume = cleanBars.slice(-20).reduce((sum: number, bar: any, index: number, selected: any[]) => index && Number(bar.close) < Number(selected[index - 1].close) ? sum + Number(bar.volume) : sum, 0);
    const turnoverSeries = cleanBars.map((bar: any) => Number.isFinite(Number(bar.turnover)) ? Number(bar.turnover) : null);
    const turnover = turnoverSeries.at(-1) ?? null;
    const turnoverAvg20d = average(turnoverSeries.slice(-21, -1).filter((value): value is number => value !== null));
    const lastDailyMove = priceDirections.at(-1) ?? null;
    const priceVolumeState = lastDailyMove === null || volumeRatio20d === null ? 'data_insufficient' : lastDailyMove > 0 && volumeRatio20d >= 1 ? 'up_volume_confirmed' : lastDailyMove > 0 ? 'up_volume_unconfirmed' : lastDailyMove < 0 && volumeRatio20d >= 1 ? 'down_volume_expanded' : lastDailyMove < 0 ? 'down_volume_contracting' : 'flat';
    return {
      period: { start: cleanBars[0].date, end: latest.date, barCount: cleanBars.length, adjust },
      latestBar: latest,
      metrics: {
        change5d: roundMetric(change(5)), change20d: roundMetric(change(20)), change60d: roundMetric(change(60)),
        ma20: roundMetric(ma20, 3), ma50: roundMetric(ma50, 3), ma200: roundMetric(ma200, 3),
        ma20Slope5d: roundMetric(divide(latestSeriesChange(ma20Series, 5), ma20Series.at(-6) ?? null)), ma50Slope5d: roundMetric(divide(latestSeriesChange(ma50Series, 5), ma50Series.at(-6) ?? null)), ma200Slope5d: roundMetric(divide(latestSeriesChange(ma200Series, 5), ma200Series.at(-6) ?? null)),
        trendDurationDays: trendDuration, ma20Ma50LastCross: latestCross(ma20Series, ma50Series, dates), ma50Ma200LastCross: latestCross(ma50Series, ma200Series, dates),
        rsi14: roundMetric(rsi14, 2), rsi14Change5d: roundMetric(latestSeriesChange(rsiSeries, 5), 2), atr14: roundMetric(atr14, 3), atrPercentOfPrice: roundMetric(divide(atr14, Number(latest.close))),
        annualizedVolatility20d: roundMetric(annualizedVolatility20d), volatilityPercentile1y: roundMetric(percentileRank(annualizedVolatility20d, volatilitySeries.slice(-252))), maxDrawdown20d: roundMetric(maxDrawdown(closes.slice(-20))), maxDrawdown60d: roundMetric(maxDrawdown(closes.slice(-60))),
        volumeRatio20d: roundMetric(volumeRatio20d), volumePercentile1y: roundMetric(percentileRank(Number(latest.volume), volumes.slice(-252))), upDownVolumeRatio20d: roundMetric(divide(upVolume, downVolume)), priceVolumeState,
        turnover: roundMetric(turnover), turnoverAvg20d: roundMetric(turnoverAvg20d), turnoverRatio20d: roundMetric(divide(turnover, turnoverAvg20d)), turnoverPercentile1y: roundMetric(percentileRank(turnover, turnoverSeries.slice(-252))),
        macd: roundMetric(macd, 4), macdSignal: roundMetric(macdSignal, 4), macdHistogram: roundMetric(macdHistogram, 4), macdHistogramChange5d: roundMetric(latestSeriesChange(macdHistogramSeries, 5), 4),
        support20d: roundMetric(support20d, 3),
        resistance60d: roundMetric(resistance60d, 3),
        rangeLow20d: roundMetric(support20d, 3),
        rangeHigh60d: roundMetric(resistance60d, 3),
        keyLevelAtrBuffer: roundMetric(keyLevelAtrBuffer, 3),
        ma20InvalidationLevel: roundMetric(ma20 === null || keyLevelAtrBuffer === null ? null : ma20 - keyLevelAtrBuffer, 3),
        ma50InvalidationLevel: roundMetric(ma50 === null || keyLevelAtrBuffer === null ? null : ma50 - keyLevelAtrBuffer, 3),
        ma200InvalidationLevel: roundMetric(ma200 === null || keyLevelAtrBuffer === null ? null : ma200 - keyLevelAtrBuffer, 3),
        support20dInvalidationLevel: roundMetric(keyLevelAtrBuffer === null ? null : support20d - keyLevelAtrBuffer, 3),
        consecutiveBelowMa20BufferDays: ma20BreakDays,
        consecutiveBelowMa50BufferDays: ma50BreakDays,
        consecutiveBelowMa200BufferDays: ma200BreakDays,
        consecutiveBelowSupportBufferDays: supportBreakDays,
        ma20VolumeConfirmedBreak,
        ma50VolumeConfirmedBreak,
        ma200VolumeConfirmedBreak,
        supportVolumeConfirmedBreak,
        high52w: roundMetric(highest52w, 3), low52w: roundMetric(lowest52w, 3),
        distanceTo52wHigh: roundMetric(Number(latest.close) / highest52w - 1),
        trend, turnoverAvailable: turnover !== null,
      },
    };
  }

  async function fetchStockTechnicalData(symbol: string) {
    if (!/^\d{6}$/.test(symbol)) throw new Error('symbol 应为 6 位证券代码');
    const cached = stockTechnicalCache.get(symbol);
    if (cached && cached.expiresAt > Date.now()) return { ...cached.value, sourceMeta: { ...cached.value.sourceMeta, source: 'cache', freshness: 'stale', fallbackLevel: 1 } };
    const payload = await fetchMarketDailyKline('stock', symbol);
    const computed = calculateTechnicalMetrics(Array.isArray(payload?.bars) ? payload.bars : [], String(payload?.sourceMeta?.adjust || 'none'));
    // The research UI only needs a short, auditable window. Keep the full series server-side.
    const chartBars = payload.bars.slice(-30).map((bar: any) => ({ date: bar.date, open: Number(bar.open), high: Number(bar.high), low: Number(bar.low), close: Number(bar.close), volume: Number(bar.volume) }));
    const value = { ...computed, chartBars, sourceMeta: { ...payload.sourceMeta, freshness: 'delayed', confidence: 'market' } };
    stockTechnicalCache.set(symbol, { expiresAt: Date.now() + 15 * 60_000, value });
    return value;
  }

  async function fetchMarketDailyKline(kind: 'stock' | 'index', symbol: string) {
    if (!/^\d{6}$/.test(symbol)) throw new Error('symbol 应为 6 位证券代码');
    const invocation = resolvePythonInvocation('market_daily_kline.py', [kind, symbol]);
    const { stdout } = await execFileAsync(invocation.command, invocation.args, { timeout: 90_000, windowsHide: true, maxBuffer: 5 * 1024 * 1024, env: pythonChildEnv() });
    const payload = JSON.parse(stdout);
    const bars = Array.isArray(payload?.bars) ? payload.bars : [];
    if (bars.length < 60) throw new Error('统一日线适配未返回足够数据');
    return { kind, symbol, bars, sourceMeta: { ...payload?.sourceMeta, fetchedAt: payload?.sourceMeta?.fetchedAt || new Date().toISOString() } };
  }

  let marketEnvironmentCache: { expiresAt: number; value: any } | null = null;
  const stockIndustryBenchmarkCache = new Map<string, { expiresAt: number; value: any }>();
  type IndustryFinancialRecord = { symbol: string; name: string; template: 'bank' | 'non_financial'; reports: any[]; source: string };
  type IndustryFinancialJob = { startedAt: string; expiresAt: number; total: number; processed: number; failed: number; status: 'warming' | 'ready' | 'failed'; target: any; records: IndustryFinancialRecord[]; result?: any; error?: string; promise?: Promise<void> };
  const industryFinancialJobs = new Map<string, IndustryFinancialJob>();
  const industryMemberFinancialCache = new Map<string, { expiresAt: number; value: any }>();
  const INDUSTRY_FINANCIAL_CACHE_TTL_MS = 24 * 60 * 60_000;

  function percentile(values: number[], value: number) {
    if (!values.length) return null;
    return values.filter((item) => item <= value).length / values.length;
  }

  function quartile(values: number[], ratio: number) {
    if (!values.length) return null;
    const ordered = [...values].sort((a, b) => a - b);
    const position = (ordered.length - 1) * ratio;
    const lower = Math.floor(position); const upper = Math.ceil(position);
    return lower === upper ? ordered[lower] : ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower);
  }

  function calculateFinancialMetricsForPeriod(financial: any, period: string | null) {
    if (!period || !Array.isArray(financial?.reports)) return null;
    const selected = financial.reports.find((report: any) => report?.period === period);
    if (!selected) return null;
    const reports = [selected, ...financial.reports.filter((report: any) => report !== selected)];
    return calculateFinancialMetrics(reports, financial.template === 'bank' ? 'bank' : 'non_financial', financial.sourceMeta?.source || 'ths_financial_statements');
  }

  function buildIndustryFinancialResult(symbol: string, industry: any, target: any, job: IndustryFinancialJob) {
    const targetTemplate = target?.template === 'bank' ? 'bank' : 'non_financial';
    const targetPeriod = target?.reports?.[0]?.period || null;
    const targetCalculation = calculateFinancialMetricsForPeriod(target, targetPeriod);
    const aligned = job.records.map((record) => ({ record, calculation: calculateFinancialMetricsForPeriod(record, targetPeriod) }));
    const peers = aligned.filter(({ record, calculation }) => record.symbol !== symbol && record.template === targetTemplate && calculation);
    const metrics: Record<string, any> = targetCalculation?.metrics || {};
    const definitions: Record<string, { label: string; value: any; rankDirection: 'higher_better' | 'lower_better' | 'neutral' }> = targetTemplate === 'bank'
      ? {
        revenueYoY: { label: '营业收入同比', value: metrics.revenueYoY, rankDirection: 'higher_better' }, netProfitYoY: { label: '净利润同比', value: metrics.netProfitYoY, rankDirection: 'higher_better' },
        roeApprox: { label: 'ROE（近似）', value: metrics.roeApprox, rankDirection: 'higher_better' }, assetYoY: { label: '资产同比', value: metrics.assetYoY, rankDirection: 'higher_better' },
        loanYoY: { label: '贷款同比', value: metrics.loanYoY, rankDirection: 'higher_better' }, depositYoY: { label: '存款同比', value: metrics.depositYoY, rankDirection: 'higher_better' },
        creditImpairmentToRevenue: { label: '信用减值/营业收入', value: metrics.creditImpairmentToRevenue, rankDirection: 'lower_better' },
      }
      : {
        revenueYoY: { label: '营收同比', value: metrics.revenueYoY, rankDirection: 'higher_better' }, netProfitYoY: { label: '净利润同比', value: metrics.netProfitYoY, rankDirection: 'higher_better' },
        grossMargin: { label: '毛利率', value: metrics.grossMargin, rankDirection: 'higher_better' }, netMargin: { label: '净利率', value: metrics.netMargin, rankDirection: 'higher_better' },
        roeApprox: { label: 'ROE（近似）', value: metrics.roeApprox, rankDirection: 'higher_better' }, roic: { label: 'ROIC（近似）', value: metrics.roic, rankDirection: 'higher_better' },
        assetLiabilityRatio: { label: '资产负债率', value: metrics.assetLiabilityRatio, rankDirection: 'lower_better' }, cashConversion: { label: '经营现金流/净利润', value: metrics.cashConversion, rankDirection: 'higher_better' },
        accountsReceivableDays: { label: '应收周转天数', value: metrics.accountsReceivableDays, rankDirection: 'lower_better' }, inventoryDays: { label: '存货周转天数', value: metrics.inventoryDays, rankDirection: 'lower_better' },
        interestCoverage: { label: '利息保障倍数', value: metrics.interestCoverage, rankDirection: 'higher_better' }, freeCashFlow: { label: '自由现金流', value: metrics.freeCashFlow, rankDirection: 'higher_better' },
      };
    const output: any[] = [];
    const exclusions: Record<string, number> = { fetch_failed: job.failed, different_template: job.records.filter((record) => record.template !== targetTemplate).length, missing_target_period: aligned.filter(({ record, calculation }) => record.template === targetTemplate && !calculation).length, outlier: 0 };
    for (const [key, definition] of Object.entries(definitions)) {
      const targetValue = finiteNumber(definition.value);
      const raw = peers.map(({ calculation }) => finiteNumber(calculation?.metrics?.[key])).filter((value): value is number => value !== null);
      const q1 = quartile(raw, 0.25); const q3 = quartile(raw, 0.75); const iqr = q1 !== null && q3 !== null ? q3 - q1 : null;
      const values = iqr !== null ? raw.filter((value) => value >= q1! - 3 * iqr && value <= q3! + 3 * iqr) : raw;
      exclusions.outlier += raw.length - values.length;
      output.push({ key, label: definition.label, value: targetValue, median: quartile(values, 0.5), percentile: targetValue === null || values.length < 10 ? null : percentile(values, targetValue), rankDirection: definition.rankDirection, sampleSize: values.length, excludedOutliers: raw.length - values.length, status: targetValue === null || values.length < 10 ? 'data_insufficient' : 'available' });
    }
    const membershipSource = industry.classification === '同花顺行业' ? 'ths_industry_members' : 'baostock_industry_members';
    return { symbol, industry: { name: industry.name, code: industry.code, classification: industry.classification, memberCount: industry.memberCount }, period: targetPeriod, template: targetTemplate, metrics: output, coverage: { totalMembers: job.total, processed: job.processed, successful: job.records.length, failed: job.failed, comparable: peers.length, exclusions }, status: 'ready', dataGaps: [...new Set([...(targetCalculation ? [] : ['目标股票缺少当前报告期的可比财务数据。']), ...(output.some((item) => item.status !== 'available') ? ['行业可比样本不足 10 家、报告期未对齐或指标缺失时，不显示分位数。'] : [])])], snapshotMeta: { generatedAt: new Date().toISOString(), source: `ths_financial_statements + ${membershipSource}`, freshness: 'delayed', confidence: 'market', membershipAsOf: industry.asOf || null, cacheExpiresAt: new Date(job.expiresAt).toISOString() } };
  }

  function startIndustryFinancialWarmup(industry: any, target: any) {
    const key = String(industry?.code || industry?.name || 'unknown');
    const existing = industryFinancialJobs.get(key);
    if (existing && existing.status !== 'failed' && existing.expiresAt > Date.now()) return existing;
    const members = Array.isArray(industry?.members) ? industry.members : [];
    const job: IndustryFinancialJob = { startedAt: new Date().toISOString(), expiresAt: Date.now() + INDUSTRY_FINANCIAL_CACHE_TTL_MS, total: members.length, processed: 0, failed: 0, status: 'warming', target, records: [] };
    job.promise = (async () => {
      let cursor = 0;
      const worker = async () => {
        while (cursor < members.length) {
          const member = members[cursor++];
          try {
            const memberSymbol = String(member.symbol);
            const cached = industryMemberFinancialCache.get(memberSymbol);
            const financial = cached && cached.expiresAt > Date.now() ? cached.value : await fetchFinancialDataWithFallback(memberSymbol);
            if (!cached || cached.expiresAt <= Date.now()) industryMemberFinancialCache.set(memberSymbol, { expiresAt: Date.now() + INDUSTRY_FINANCIAL_CACHE_TTL_MS, value: financial });
            const latest = financial?.reports?.[0];
            if (!latest?.period) throw new Error('missing latest report');
            job.records.push({ symbol: memberSymbol, name: member.name, template: financial.template === 'bank' ? 'bank' : 'non_financial', reports: financial.reports, source: financial.sourceMeta?.source || 'unknown' });
          } catch { job.failed += 1; }
          finally { job.processed += 1; }
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      job.status = 'ready';
    })().catch((error: any) => { job.status = 'failed'; job.error = error?.message || 'industry financial warmup failed'; });
    industryFinancialJobs.set(key, job);
    return job;
  }

  async function buildIndustryFinancialPercentiles(input: string) {
    const symbol = normalizeAshareSymbol(input).code;
    const industrySnapshot = await fetchStockIndustryBenchmark(symbol);
    if (!industrySnapshot.industry?.code || !Array.isArray(industrySnapshot.industry?.members) || !industrySnapshot.industry.members.length) {
      return { symbol, industry: { name: industrySnapshot.industry?.name || '未分类', code: industrySnapshot.industry?.code || null, classification: industrySnapshot.industry?.classification || null, memberCount: industrySnapshot.industry?.memberCount || 0 }, status: 'unavailable', period: null, coverage: { totalMembers: 0, processed: 0, successful: 0, failed: 0 }, metrics: [], dataGaps: ['当前未获取到同一行业口径的全量成员快照；不会用空样本或混合行业口径计算行业分位。'], snapshotMeta: { generatedAt: new Date().toISOString(), source: industrySnapshot.sourceMeta?.mappingSource || 'unknown', freshness: 'delayed', confidence: 'limited' } };
    }
    const jobKey = String(industrySnapshot.industry.code || industrySnapshot.industry.name || 'unknown');
    const existing = industryFinancialJobs.get(jobKey);
    const job = existing && existing.status !== 'failed' && existing.expiresAt > Date.now() ? existing : startIndustryFinancialWarmup(industrySnapshot.industry, await fetchFinancialDataWithFallback(symbol));
    if (job.status === 'ready') return job.result = buildIndustryFinancialResult(symbol, industrySnapshot.industry, job.target, job);
    return { symbol, industry: { name: industrySnapshot.industry.name, code: industrySnapshot.industry.code, classification: industrySnapshot.industry.classification, memberCount: industrySnapshot.industry.memberCount }, status: job.status, period: job.target?.reports?.[0]?.period || null, coverage: { totalMembers: job.total, processed: job.processed, successful: job.records.length, failed: job.failed }, metrics: [], dataGaps: ['行业成员财务快照正在后台预热；只使用完成同报告期对齐与异常值处理后的样本。'], snapshotMeta: { generatedAt: new Date().toISOString(), source: `ths_financial_statements + ${industrySnapshot.sourceMeta?.mappingSource || 'industry_members'}`, freshness: 'delayed', confidence: 'market' } };
  }

  function buildIndustryFinancialComparison(symbol: string, result: any) {
    const base = {
      status: result?.status === 'ready' ? 'available' : result?.status === 'warming' ? 'warming' : 'unavailable',
      industry: result?.industry || null,
      period: result?.period || null,
      template: result?.template || null,
      coverage: result?.coverage || null,
      sourceMeta: result?.snapshotMeta || null,
    };
    if (result?.status !== 'ready') {
      return { ...base, items: [], evidence: [], dataGaps: result?.dataGaps || ['行业财务分位暂不可用。'] };
    }
    const items = (Array.isArray(result.metrics) ? result.metrics : []).filter((item: any) => item?.status === 'available' && finiteNumber(item?.percentile) !== null).map((item: any) => {
      const rawPercentile = Number(item.percentile);
      const comparisonPercentile = item.rankDirection === 'lower_better' ? 1 - rawPercentile : rawPercentile;
      const evidenceId = makeEvidenceId(symbol, 'industry_financial_percentile', String(item.key), result.period || 'current');
      return { key: item.key, label: item.label, value: item.value, median: item.median, rawPercentile, comparisonPercentile, rankDirection: item.rankDirection || 'neutral', sampleSize: item.sampleSize, evidenceId };
    });
    const evidence = items.map((item: any) => ({ evidenceId: item.evidenceId, type: 'industry_financial_comparison', title: `行业财务分位 ${item.label}`, value: JSON.stringify({ value: item.value, median: item.median, rawPercentile: item.rawPercentile, comparisonPercentile: item.comparisonPercentile, rankDirection: item.rankDirection, sampleSize: item.sampleSize }), period: result.period, source: result.snapshotMeta?.source || 'industry_financial_percentiles', fetchedAt: result.snapshotMeta?.generatedAt || new Date().toISOString(), freshness: result.snapshotMeta?.freshness || 'delayed', verification: 'third_party' }));
    const dataGaps = [...(result.dataGaps || [])];
    const unavailable = (Array.isArray(result.metrics) ? result.metrics : []).filter((item: any) => item?.status !== 'available').map((item: any) => String(item.label || item.key));
    if (unavailable.length) dataGaps.push(`行业横向比较未覆盖：${unavailable.join('、')}。`);
    return { ...base, items, evidence, dataGaps: [...new Set(dataGaps)] };
  }
  const stockRelativeStrengthCache = new Map<string, { expiresAt: number; value: any }>();
  const technicalMarketSignalCache = new Map<string, { expiresAt: number; value: any }>();

  function makeMarketEvidenceId(key: string, period = 'current') {
    return `market_environment:${key}:${period}`.replace(/[^a-zA-Z0-9:_-]/g, '_');
  }

  async function buildMarketEnvironmentSnapshot() {
    if (marketEnvironmentCache && marketEnvironmentCache.expiresAt > Date.now()) {
      return { ...marketEnvironmentCache.value, snapshotMeta: { ...marketEnvironmentCache.value.snapshotMeta, source: 'cache', freshness: 'stale' } };
    }
    const [indexResult, marketDataResult] = await Promise.allSettled([
      fetchMarketDailyKline('index', '000001'),
      fetchMarketData(),
    ]);
    if (indexResult.status !== 'fulfilled') throw indexResult.reason;
    const indexData = indexResult.value;
    const indexTechnical = calculateTechnicalMetrics(indexData.bars, String(indexData.sourceMeta?.adjust || 'none'));
    const evidence: any[] = [];
    const dataGaps: string[] = [];
    const marketData: any = marketDataResult.status === 'fulfilled' ? marketDataResult.value : null;
    if (!marketData) dataGaps.push(`市场广度和成交额暂不可用：${marketDataResult.status === 'rejected' ? marketDataResult.reason?.message || '数据源失败' : '未知原因'}`);

    const indexPeriod = indexTechnical.period.end;
    for (const key of ['change5d', 'change20d', 'change60d', 'ma20', 'ma50', 'ma200', 'macdHistogram', 'annualizedVolatility20d', 'maxDrawdown20d', 'trend']) {
      const value = indexTechnical.metrics[key];
      if (value === null || value === undefined) continue;
      evidence.push({ evidenceId: makeMarketEvidenceId(`index_${key}`, indexPeriod), type: 'market', title: `上证指数 ${key}`, value: String(value), period: indexPeriod, source: indexData.sourceMeta.source, fetchedAt: indexData.sourceMeta.fetchedAt, freshness: 'delayed', verification: 'third_party' });
    }
    evidence.push({ evidenceId: makeMarketEvidenceId('index_close', indexPeriod), type: 'market', title: '上证指数收盘价', value: indexTechnical.latestBar.close, period: indexPeriod, source: indexData.sourceMeta.source, fetchedAt: indexData.sourceMeta.fetchedAt, freshness: 'delayed', verification: 'third_party' });

    let breadth: any = null;
    let turnover: any = null;
    let marketPulse: any = null;
    let temperature: any = null;
    if (marketData) {
      const breadthItems = marketData.marketPulse?.sectors?.length ? marketData.marketPulse.sectors : marketData.sectors || [];
      const up = breadthItems.filter((item: any) => Number(item.changePercent) > 0).length;
      const down = breadthItems.filter((item: any) => Number(item.changePercent) < 0).length;
      const flat = Math.max(0, breadthItems.length - up - down);
      breadth = breadthItems.length ? { scope: 'sector', up, down, flat, total: breadthItems.length, upRatio: up / breadthItems.length } : null;
      turnover = Number(marketData.marketPulse?.turnoverAmount || marketData.volume || 0) || null;
      marketPulse = marketData.marketPulse?.available ? { limitUp: Number(marketData.marketPulse.limitUp || 0), limitDown: Number(marketData.marketPulse.limitDown || 0), stockCount: Number(marketData.marketPulse.stockCount || 0) || null } : null;
      temperature = calculateMarketTemperature(marketData);
      if (!breadth) dataGaps.push('未取得板块广度，不能确认市场参与度。');
      if (!turnover) dataGaps.push('未取得两市成交额。');
      if (!marketPulse) dataGaps.push('未取得涨跌停脉冲。');
    }
    if (breadth) evidence.push({ evidenceId: makeMarketEvidenceId('sector_breadth', indexPeriod), type: 'market', title: '板块上涨广度', value: breadth.upRatio, period: indexPeriod, source: 'market_pulse', fetchedAt: new Date().toISOString(), freshness: 'realtime', verification: 'third_party' });
    if (turnover) evidence.push({ evidenceId: makeMarketEvidenceId('turnover_amount', indexPeriod), type: 'market', title: '两市成交额', value: turnover, unit: 'CNY', period: indexPeriod, source: 'market_pulse', fetchedAt: new Date().toISOString(), freshness: 'realtime', verification: 'third_party' });
    if (marketPulse) {
      evidence.push({ evidenceId: makeMarketEvidenceId('limit_up', indexPeriod), type: 'market', title: '涨停家数', value: marketPulse.limitUp, period: indexPeriod, source: 'market_pulse', fetchedAt: new Date().toISOString(), freshness: 'realtime', verification: 'third_party' });
      evidence.push({ evidenceId: makeMarketEvidenceId('limit_down', indexPeriod), type: 'market', title: '跌停家数', value: marketPulse.limitDown, period: indexPeriod, source: 'market_pulse', fetchedAt: new Date().toISOString(), freshness: 'realtime', verification: 'third_party' });
    }

    const trend = indexTechnical.metrics.trend;
    const change20d = finiteNumber(indexTechnical.metrics.change20d);
    const histogram = finiteNumber(indexTechnical.metrics.macdHistogram);
    let state: 'risk_on' | 'neutral' | 'risk_off' = 'neutral';
    let stateReason = '指数趋势或市场参与度未形成同向确认。';
    if (breadth && trend === 'bullish' && (change20d || 0) > 0 && (histogram || 0) >= 0 && breadth.upRatio > 0.5) {
      state = 'risk_on'; stateReason = '指数趋势、20日表现、MACD动量与板块广度同向偏强。';
    } else if (breadth && trend === 'bearish' && (change20d || 0) < 0 && (histogram || 0) <= 0 && breadth.upRatio < 0.5) {
      state = 'risk_off'; stateReason = '指数趋势、20日表现、MACD动量与板块广度同向偏弱。';
    }
    const confidence = !breadth ? { level: 'limited', reason: '缺少市场广度，环境状态仅由指数结构支持。' } : dataGaps.length ? { level: 'medium', reason: '指数与广度可用，但部分市场脉冲字段缺失。' } : { level: 'medium', reason: '状态由指数结构与板块广度确定，尚未引入行业相对强弱。' };
    const value = {
      benchmark: { symbol: '000001', name: '上证指数', technical: indexTechnical, sourceMeta: indexData.sourceMeta },
      breadth, turnover: turnover ? { amount: turnover, temperature: temperature?.components?.turnover || null } : null,
      marketPulse, marketRegime: { state, reason: stateReason, confidence }, evidence, dataGaps: [...new Set(dataGaps)],
      snapshotMeta: { generatedAt: new Date().toISOString(), source: 'live', freshness: breadth ? 'realtime' : 'delayed', evidenceCount: evidence.length, marketStatus: getMarketStatus() },
    };
    marketEnvironmentCache = { expiresAt: Date.now() + 5 * 60_000, value };
    return value;
  }

  async function fetchStockIndustryBenchmark(input: string) {
    const symbol = normalizeAshareSymbol(input).code;
    const cached = stockIndustryBenchmarkCache.get(symbol);
    if (cached && cached.expiresAt > Date.now()) return { ...cached.value, snapshotMeta: { ...cached.value.snapshotMeta, source: 'cache', freshness: 'stale' } };
    const invocation = resolvePythonInvocation('industry_benchmark.py', [symbol]);
    const { stdout } = await execFileAsync(invocation.command, invocation.args, { timeout: 180_000, windowsHide: true, maxBuffer: 5 * 1024 * 1024, env: pythonChildEnv() });
    const payload = JSON.parse(stdout);
    const bars = Array.isArray(payload?.bars) ? payload.bars : [];
    if (!payload?.industry?.name) throw new Error('行业归属未返回');
    const technical = bars.length >= 60 ? calculateTechnicalMetrics(bars, String(payload?.sourceMeta?.adjust || 'none')) : null;
    const period = technical?.period.end || new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
    const evidence: any[] = [
      { evidenceId: makeEvidenceId(symbol, 'industry_mapping', String(payload.sourceMeta.mappingSource || 'unknown'), period), type: 'industry', title: '行业归属', value: payload.industry.name, period, source: payload.sourceMeta.mappingSource, fetchedAt: payload.sourceMeta.fetchedAt, freshness: 'delayed', verification: 'third_party' },
    ];
    if (technical) evidence.push(...['change5d', 'change20d', 'change60d', 'trend', 'macdHistogram', 'annualizedVolatility20d', 'maxDrawdown20d'].map((key) => ({ evidenceId: makeEvidenceId(symbol, 'industry_benchmark', key, period), type: 'industry', title: `${payload.industry.name} ${key}`, value: String(technical.metrics[key]), period, source: payload.sourceMeta.benchmarkSource, fetchedAt: payload.sourceMeta.fetchedAt, freshness: 'delayed', verification: 'third_party' })));
    const value = {
      symbol, industry: payload.industry, benchmark: technical ? { technical, sourceMeta: payload.sourceMeta } : null, sourceMeta: payload.sourceMeta || null, evidence,
      dataGaps: [...new Set([...(payload.dataGaps || []), technical ? '行业归属和基准采用同花顺行业口径；后续相对强弱计算需与个股日线同交易日对齐。' : '当前无法取得同花顺行业指数，因此不得输出相对行业强弱。'])],
      snapshotMeta: { generatedAt: new Date().toISOString(), source: payload.sourceMeta?.mappingSource || 'live', freshness: 'delayed', evidenceCount: evidence.length },
    };
    stockIndustryBenchmarkCache.set(symbol, { expiresAt: Date.now() + 24 * 60 * 60_000, value });
    return value;
  }

  function classifyRelativeStrength(excessReturns: Record<string, number | null>) {
    const values = Object.values(excessReturns).filter((value): value is number => value !== null && Number.isFinite(value));
    if (!values.length) return 'data_insufficient';
    if (values.every((value) => value > 0)) return 'strong';
    if (values.every((value) => value < 0)) return 'weak';
    return 'mixed';
  }

  function relativeStrengthEvidence(symbol: string, benchmark: 'market' | 'industry', excessReturns: Record<string, number | null>, period: string, sourceEvidenceIds: string[]) {
    return Object.entries(excessReturns).filter(([, value]) => value !== null).map(([window, value]) => ({
      evidenceId: makeEvidenceId(symbol, 'relative_strength', `${benchmark}_${window}`, period), type: 'market', title: `${benchmark === 'market' ? '相对上证指数' : '相对行业'} ${window} 超额收益`, value, period, source: 'calculation', fetchedAt: new Date().toISOString(), freshness: 'delayed', verification: 'third_party', sourceEvidenceIds,
    }));
  }

  async function buildStockRelativeStrength(input: string) {
    const symbol = normalizeAshareSymbol(input).code;
    const cached = stockRelativeStrengthCache.get(symbol);
    if (cached && cached.expiresAt > Date.now()) return { ...cached.value, snapshotMeta: { ...cached.value.snapshotMeta, source: 'cache', freshness: 'stale' } };
    const [stockResult, marketResult, industryResult] = await Promise.allSettled([
      fetchStockTechnicalData(symbol),
      buildMarketEnvironmentSnapshot(),
      fetchStockIndustryBenchmark(symbol),
    ]);
    if (stockResult.status !== 'fulfilled') throw stockResult.reason;
    const stock = stockResult.value;
    const dataGaps: string[] = [];
    const windows = ['change5d', 'change20d', 'change60d'];
    const stockDate = stock.period.end;
    const stockReturns = Object.fromEntries(windows.map((key) => [key, finiteNumber(stock.metrics[key])])) as Record<string, number | null>;
    const stockEvidenceIds = windows.map((key) => makeEvidenceId(symbol, 'technical_calculation', key, stockDate));
    let market: any = null;
    let industry: any = null;
    const evidence: any[] = [];

    if (marketResult.status === 'fulfilled') {
      const environment = marketResult.value;
      const benchmarkTechnical = environment.benchmark?.technical;
      const benchmarkDate = benchmarkTechnical?.period?.end;
      if (benchmarkTechnical && benchmarkDate === stockDate) {
        const benchmarkReturns = Object.fromEntries(windows.map((key) => [key, finiteNumber(benchmarkTechnical.metrics[key])])) as Record<string, number | null>;
        const excessReturns = Object.fromEntries(windows.map((key) => [key, stockReturns[key] !== null && benchmarkReturns[key] !== null ? stockReturns[key] - benchmarkReturns[key] : null])) as Record<string, number | null>;
        const sourceEvidenceIds = [...stockEvidenceIds, ...windows.map((key) => makeMarketEvidenceId(`index_${key}`, benchmarkDate))];
        market = { benchmark: { symbol: '000001', name: '上证指数', period: benchmarkDate }, stockReturns, benchmarkReturns, excessReturns, state: classifyRelativeStrength(excessReturns), marketRegime: environment.marketRegime, evidenceIds: sourceEvidenceIds };
        evidence.push(...relativeStrengthEvidence(symbol, 'market', excessReturns, stockDate, sourceEvidenceIds));
      } else {
        dataGaps.push('个股与上证指数最后交易日未对齐，不能计算相对大盘强弱。');
      }
    } else {
      dataGaps.push(`市场环境快照不可用：${marketResult.reason?.message || '未知原因'}`);
    }

    if (industryResult.status === 'fulfilled') {
      const industrySnapshot = industryResult.value;
      const benchmarkTechnical = industrySnapshot.benchmark?.technical;
      const benchmarkDate = benchmarkTechnical?.period?.end;
      if (benchmarkTechnical && benchmarkDate === stockDate) {
        const benchmarkReturns = Object.fromEntries(windows.map((key) => [key, finiteNumber(benchmarkTechnical.metrics[key])])) as Record<string, number | null>;
        const excessReturns = Object.fromEntries(windows.map((key) => [key, stockReturns[key] !== null && benchmarkReturns[key] !== null ? stockReturns[key] - benchmarkReturns[key] : null])) as Record<string, number | null>;
        const industryEvidenceIds = (industrySnapshot.evidence || []).map((item: any) => String(item.evidenceId));
        const sourceEvidenceIds = [...stockEvidenceIds, ...industryEvidenceIds];
        industry = { industry: industrySnapshot.industry, period: benchmarkDate, stockReturns, benchmarkReturns, excessReturns, state: classifyRelativeStrength(excessReturns), evidenceIds: sourceEvidenceIds };
        evidence.push(...relativeStrengthEvidence(symbol, 'industry', excessReturns, stockDate, sourceEvidenceIds));
      } else {
        dataGaps.push('行业基准缺失或与个股最后交易日未对齐，不能计算相对行业强弱。');
      }
    } else {
      dataGaps.push(`行业基准不可用：${industryResult.reason?.message || '未知原因'}`);
    }
    const value = {
      symbol, period: stockDate, market, industry, evidence,
      dataGaps: [...new Set(dataGaps)],
      snapshotMeta: { generatedAt: new Date().toISOString(), source: 'live', freshness: market && industry ? 'delayed' : 'stale', evidenceCount: evidence.length },
    };
    stockRelativeStrengthCache.set(symbol, { expiresAt: Date.now() + 5 * 60_000, value });
    return value;
  }

  type TechnicalMarketSignalStatus = 'positive' | 'stable' | 'mixed' | 'risk' | 'data_insufficient';
  type TechnicalMarketSignal = {
    signalId: 'trend' | 'confirmation' | 'risk' | 'environment' | 'relative_strength' | 'data_quality';
    dimension: 'trend' | 'confirmation' | 'risk' | 'environment' | 'relative_strength' | 'data_quality';
    status: TechnicalMarketSignalStatus;
    severity: 'low' | 'medium' | 'high';
    summary: string;
    values: Record<string, number | string | boolean | null>;
    evidenceIds: string[];
  };

  function technicalCalculationEvidenceIds(symbol: string, keys: string[], period: string) {
    return keys.map((key) => makeEvidenceId(symbol, 'technical_calculation', key, period));
  }

  // 第六步：只按已披露的指标和规则生成信号；不调用 AI，也不输出价格预测或交易指令。
  async function buildTechnicalMarketSignals(input: string) {
    const symbol = normalizeAshareSymbol(input).code;
    const cached = technicalMarketSignalCache.get(symbol);
    if (cached && cached.expiresAt > Date.now()) {
      return { ...cached.value, snapshotMeta: { ...cached.value.snapshotMeta, source: 'cache', freshness: 'stale' } };
    }

    const [technicalResult, environmentResult, relativeStrengthResult] = await Promise.allSettled([
      fetchStockTechnicalData(symbol),
      buildMarketEnvironmentSnapshot(),
      buildStockRelativeStrength(symbol),
    ]);
    if (technicalResult.status !== 'fulfilled') throw technicalResult.reason;

    const technical = technicalResult.value;
    const metrics = technical.metrics || {};
    const period = String(technical.period?.end || new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }));
    const riskThresholds = { atrPercentOfPrice: 0.05, volatilityPercentile1y: 0.8, maxDrawdown20d: -0.12, maxDrawdown60d: -0.2 };
    const signals: TechnicalMarketSignal[] = [];
    const evidence: any[] = [];
    const dataGaps: string[] = [];
    const addSignal = (signal: Omit<TechnicalMarketSignal, 'evidenceIds'>, sourceEvidenceIds: string[]) => {
      const evidenceId = makeEvidenceId(symbol, 'technical_market_signal', signal.signalId, period);
      const evidenceIds = [...new Set([...sourceEvidenceIds, evidenceId])];
      signals.push({ ...signal, evidenceIds });
      evidence.push({ evidenceId, type: 'market', title: `技术与市场信号：${signal.signalId}`, value: signal.status, period, source: 'calculation', fetchedAt: new Date().toISOString(), freshness: 'delayed', verification: 'third_party', sourceEvidenceIds });
    };
    const metricEvidence = (keys: string[]) => technicalCalculationEvidenceIds(symbol, keys, period);
    const keyLevelAtrBuffer = finiteNumber(metrics.keyLevelAtrBuffer);
    const keyLevels = {
      movingAverages: {
        ma20: finiteNumber(metrics.ma20),
        ma50: finiteNumber(metrics.ma50),
        ma200: finiteNumber(metrics.ma200),
      },
      range: {
        low20d: finiteNumber(metrics.rangeLow20d ?? metrics.support20d),
        high60d: finiteNumber(metrics.rangeHigh60d ?? metrics.resistance60d),
      },
      atrBuffer: {
        multiplier: 0.5,
        value: keyLevelAtrBuffer,
        description: '关键位以 ATR14 的 0.5 倍作为缓冲区；跌破指收盘价低于关键位减去该缓冲。',
      },
      invalidationLevels: {
        ma20: finiteNumber(metrics.ma20InvalidationLevel),
        ma50: finiteNumber(metrics.ma50InvalidationLevel),
        ma200: finiteNumber(metrics.ma200InvalidationLevel),
        low20d: finiteNumber(metrics.support20dInvalidationLevel),
      },
    };
    const keyLevelEvidenceIds = metricEvidence(['ma20', 'ma50', 'ma200', 'rangeLow20d', 'rangeHigh60d', 'atr14', 'keyLevelAtrBuffer', 'ma20InvalidationLevel', 'ma50InvalidationLevel', 'ma200InvalidationLevel', 'support20dInvalidationLevel']);
    const keyLevelsEvidenceId = makeEvidenceId(symbol, 'technical_market_structure', 'key_levels', period);
    evidence.push({ evidenceId: keyLevelsEvidenceId, type: 'market', title: '技术与市场关键位', value: JSON.stringify(keyLevels), period, source: 'calculation', fetchedAt: new Date().toISOString(), freshness: 'delayed', verification: 'third_party', sourceEvidenceIds: keyLevelEvidenceIds });
    const structureInvalidationRules: Array<{ ruleId: string; description: string; triggered: boolean; values: Record<string, number | string | boolean | null>; evidenceIds: string[] }> = [];
    const addStructureInvalidationRule = (ruleId: string, description: string, triggered: boolean, values: Record<string, number | string | boolean | null>, sourceEvidenceIds: string[]) => {
      const evidenceId = makeEvidenceId(symbol, 'technical_market_structure', ruleId, period);
      const evidenceIds = [...new Set([...sourceEvidenceIds, evidenceId])];
      structureInvalidationRules.push({ ruleId, description, triggered, values, evidenceIds });
      evidence.push({ evidenceId, type: 'market', title: `技术结构失效条件：${ruleId}`, value: triggered ? 'triggered' : 'not_triggered', period, source: 'calculation', fetchedAt: new Date().toISOString(), freshness: 'delayed', verification: 'third_party', sourceEvidenceIds });
    };

    const trend = String(metrics.trend || 'neutral');
    const ma20Slope = finiteNumber(metrics.ma20Slope5d);
    const ma50Slope = finiteNumber(metrics.ma50Slope5d);
    const trendDurationDays = finiteNumber(metrics.trendDurationDays);
    const trendStatus: TechnicalMarketSignalStatus = trend === 'bullish' && (ma20Slope ?? 0) > 0 && (ma50Slope ?? 0) >= 0
      ? 'positive' : trend === 'bearish' && (ma20Slope ?? 0) < 0 && (ma50Slope ?? 0) <= 0 ? 'risk' : 'mixed';
    addSignal({
      signalId: 'trend', dimension: 'trend', status: trendStatus, severity: trendStatus === 'risk' ? 'high' : trendStatus === 'mixed' ? 'medium' : 'low',
      summary: trendStatus === 'positive' ? `均线结构偏多，MA20/MA50 近5日斜率为 ${formatPercent(ma20Slope)} / ${formatPercent(ma50Slope)}，该状态已持续 ${trendDurationDays ?? '未知'} 个交易日。`
        : trendStatus === 'risk' ? `均线结构偏空，MA20/MA50 近5日斜率为 ${formatPercent(ma20Slope)} / ${formatPercent(ma50Slope)}，该状态已持续 ${trendDurationDays ?? '未知'} 个交易日。`
          : `均线结构与斜率未形成同向确认，当前趋势状态为 ${{ bullish: '多头', bearish: '空头', neutral: '震荡' }[trend] || '待确认'}。`,
      values: { trend, ma20Slope5d: ma20Slope, ma50Slope5d: ma50Slope, trendDurationDays },
    }, metricEvidence(['trend', 'ma20Slope5d', 'ma50Slope5d', 'trendDurationDays', 'ma20', 'ma50']));

    const macdHistogram = finiteNumber(metrics.macdHistogram);
    const macdHistogramChange = finiteNumber(metrics.macdHistogramChange5d);
    const rsi14 = finiteNumber(metrics.rsi14);
    const rsiChange = finiteNumber(metrics.rsi14Change5d);
    const priceVolumeState = String(metrics.priceVolumeState || 'data_insufficient');
    const confirmationStatus: TechnicalMarketSignalStatus = macdHistogram !== null && macdHistogramChange !== null && macdHistogram >= 0 && macdHistogramChange > 0 && ['up_volume_confirmed', 'up_volume_unconfirmed'].includes(priceVolumeState)
      ? 'positive' : macdHistogram !== null && macdHistogramChange !== null && macdHistogram <= 0 && macdHistogramChange < 0 && priceVolumeState === 'down_volume_expanded' ? 'risk' : 'mixed';
    addSignal({
      signalId: 'confirmation', dimension: 'confirmation', status: confirmationStatus, severity: confirmationStatus === 'risk' ? 'high' : confirmationStatus === 'mixed' ? 'medium' : 'low',
      summary: confirmationStatus === 'positive' ? 'MACD 柱位于零轴上方且近5日改善，量价未出现下跌放量，动量获得初步确认。'
        : confirmationStatus === 'risk' ? 'MACD 柱位于零轴下方且近5日走弱，并出现下跌放量，动量确认偏弱。'
          : 'MACD、RSI 与量价未形成充分同向确认，应视为等待验证的分歧状态。',
      values: { macdHistogram, macdHistogramChange5d: macdHistogramChange, rsi14, rsi14Change5d: rsiChange, priceVolumeState },
    }, metricEvidence(['macdHistogram', 'macdHistogramChange5d', 'rsi14', 'rsi14Change5d', 'priceVolumeState', 'volumeRatio20d']));

    const atrPercent = finiteNumber(metrics.atrPercentOfPrice);
    const volatilityPercentile = finiteNumber(metrics.volatilityPercentile1y);
    const drawdown20d = finiteNumber(metrics.maxDrawdown20d);
    const drawdown60d = finiteNumber(metrics.maxDrawdown60d);
    const riskElevated = (atrPercent !== null && atrPercent >= riskThresholds.atrPercentOfPrice) || (volatilityPercentile !== null && volatilityPercentile >= riskThresholds.volatilityPercentile1y) || (drawdown20d !== null && drawdown20d <= riskThresholds.maxDrawdown20d) || (drawdown60d !== null && drawdown60d <= riskThresholds.maxDrawdown60d);
    addSignal({
      signalId: 'risk', dimension: 'risk', status: riskElevated ? 'risk' : atrPercent === null || volatilityPercentile === null || drawdown20d === null ? 'data_insufficient' : 'stable', severity: riskElevated ? 'high' : 'low',
      summary: riskElevated ? 'ATR、波动率分位数或阶段最大回撤至少一项达到预设风险阈值，趋势信号应降低权重。'
        : atrPercent === null || volatilityPercentile === null || drawdown20d === null ? '波动或回撤字段不完整，不能完整评估技术风险。'
          : 'ATR、波动率分位数和阶段最大回撤均未触发预设高风险阈值。',
      values: { atrPercentOfPrice: atrPercent, volatilityPercentile1y: volatilityPercentile, maxDrawdown20d: drawdown20d, maxDrawdown60d: drawdown60d },
    }, metricEvidence(['atrPercentOfPrice', 'volatilityPercentile1y', 'maxDrawdown20d', 'maxDrawdown60d']));
    addStructureInvalidationRule(
      'ma50_two_day_volume_break',
      '连续两日收盘低于 MA50 减去 0.5 倍 ATR14，且两日成交量均高于各自前 20 日平均成交量。',
      metrics.ma50VolumeConfirmedBreak === true && finiteNumber(metrics.consecutiveBelowMa50BufferDays) !== null && finiteNumber(metrics.consecutiveBelowMa50BufferDays)! >= 2,
      { ma50: finiteNumber(metrics.ma50), invalidationLevel: finiteNumber(metrics.ma50InvalidationLevel), consecutiveDays: finiteNumber(metrics.consecutiveBelowMa50BufferDays), volumeConfirmed: metrics.ma50VolumeConfirmedBreak === true },
      metricEvidence(['ma50', 'atr14', 'keyLevelAtrBuffer', 'ma50InvalidationLevel', 'consecutiveBelowMa50BufferDays', 'ma50VolumeConfirmedBreak', 'volumeRatio20d']),
    );
    addStructureInvalidationRule(
      'support20d_two_day_volume_break',
      '连续两日收盘低于 20 日区间低点减去 0.5 倍 ATR14，且两日成交量均高于各自前 20 日平均成交量。',
      metrics.supportVolumeConfirmedBreak === true && finiteNumber(metrics.consecutiveBelowSupportBufferDays) !== null && finiteNumber(metrics.consecutiveBelowSupportBufferDays)! >= 2,
      { support20d: finiteNumber(metrics.rangeLow20d ?? metrics.support20d), invalidationLevel: finiteNumber(metrics.support20dInvalidationLevel), consecutiveDays: finiteNumber(metrics.consecutiveBelowSupportBufferDays), volumeConfirmed: metrics.supportVolumeConfirmedBreak === true },
      metricEvidence(['rangeLow20d', 'atr14', 'keyLevelAtrBuffer', 'support20dInvalidationLevel', 'consecutiveBelowSupportBufferDays', 'supportVolumeConfirmedBreak', 'volumeRatio20d']),
    );
    addStructureInvalidationRule(
      'trend_momentum_deterioration',
      'MA20 近 5 日斜率转负，且 MACD 柱近 5 日继续走弱。',
      (ma20Slope !== null && ma20Slope < 0) && (macdHistogramChange !== null && macdHistogramChange < 0),
      { ma20Slope5d: ma20Slope, macdHistogram: macdHistogram, macdHistogramChange5d: macdHistogramChange },
      metricEvidence(['ma20Slope5d', 'macdHistogram', 'macdHistogramChange5d']),
    );
    addStructureInvalidationRule(
      'risk_threshold_exceeded',
      'ATR/股价、波动率一年分位数或 20/60 日最大回撤触及已披露的风险阈值。',
      riskElevated,
      { atrPercentOfPrice: atrPercent, volatilityPercentile1y: volatilityPercentile, maxDrawdown20d: drawdown20d, maxDrawdown60d: drawdown60d },
      metricEvidence(['atrPercentOfPrice', 'volatilityPercentile1y', 'maxDrawdown20d', 'maxDrawdown60d']),
    );

    if (environmentResult.status === 'fulfilled') {
      const environment = environmentResult.value;
      const marketRegime = String(environment.marketRegime?.state || 'neutral');
      addSignal({
        signalId: 'environment', dimension: 'environment', status: marketRegime === 'risk_on' ? 'positive' : marketRegime === 'risk_off' ? 'risk' : 'mixed', severity: marketRegime === 'risk_off' ? 'high' : marketRegime === 'neutral' ? 'medium' : 'low',
        summary: String(environment.marketRegime?.reason || '市场环境状态未提供。'),
        values: { marketRegime, breadthUpRatio: finiteNumber(environment.breadth?.upRatio), turnoverAmount: finiteNumber(environment.turnover?.amount) },
      }, (environment.evidence || []).map((item: any) => String(item.evidenceId)));
      dataGaps.push(...(environment.dataGaps || []).map(String));
    } else {
      dataGaps.push(`市场环境不可用：${environmentResult.reason?.message || '未知原因'}`);
      addSignal({ signalId: 'environment', dimension: 'environment', status: 'data_insufficient', severity: 'medium', summary: '市场环境数据不可用，不能判断指数趋势与市场参与度是否配合。', values: { marketRegime: null, breadthUpRatio: null, turnoverAmount: null } }, []);
    }

    if (relativeStrengthResult.status === 'fulfilled') {
      const relative = relativeStrengthResult.value;
      const marketState = String(relative.market?.state || 'data_insufficient');
      const industryState = String(relative.industry?.state || 'data_insufficient');
      const relativeStatus: TechnicalMarketSignalStatus = marketState === 'strong' ? 'positive' : marketState === 'weak' ? 'risk' : marketState === 'data_insufficient' ? 'data_insufficient' : 'mixed';
      addSignal({
        signalId: 'relative_strength', dimension: 'relative_strength', status: relativeStatus, severity: relativeStatus === 'risk' ? 'high' : relativeStatus === 'data_insufficient' ? 'medium' : 'low',
        summary: marketState === 'strong' ? `个股相对上证指数在 5/20/60 日窗口均为正；相对行业状态为 ${industryState}。`
          : marketState === 'weak' ? `个股相对上证指数在 5/20/60 日窗口均为负；相对行业状态为 ${industryState}。`
            : marketState === 'data_insufficient' ? '个股与市场基准未满足日期对齐或市场数据不可用，不能输出相对大盘强弱。'
              : `个股相对上证指数的多周期表现分化；相对行业状态为 ${industryState}。`,
        values: { relativeToMarket: marketState, relativeToIndustry: industryState, marketExcessReturn5d: finiteNumber(relative.market?.excessReturns?.change5d), marketExcessReturn20d: finiteNumber(relative.market?.excessReturns?.change20d), marketExcessReturn60d: finiteNumber(relative.market?.excessReturns?.change60d) },
      }, (relative.evidence || []).map((item: any) => String(item.evidenceId)));
      addStructureInvalidationRule(
        'relative_market_all_windows_weak',
        '相对大盘的 5/20/60 日超额收益同时为负；仅在交易日对齐时评估。',
        marketState === 'weak',
        { relativeToMarket: marketState, excessReturn5d: finiteNumber(relative.market?.excessReturns?.change5d), excessReturn20d: finiteNumber(relative.market?.excessReturns?.change20d), excessReturn60d: finiteNumber(relative.market?.excessReturns?.change60d) },
        (relative.evidence || []).map((item: any) => String(item.evidenceId)),
      );
      dataGaps.push(...(relative.dataGaps || []).map(String));
    } else {
      dataGaps.push(`相对强弱不可用：${relativeStrengthResult.reason?.message || '未知原因'}`);
      addSignal({ signalId: 'relative_strength', dimension: 'relative_strength', status: 'data_insufficient', severity: 'medium', summary: '相对大盘与行业的超额收益不可用，不能给出强弱结论。', values: { relativeToMarket: null, relativeToIndustry: null, marketExcessReturn5d: null, marketExcessReturn20d: null, marketExcessReturn60d: null } }, []);
    }

    if (relativeStrengthResult.status !== 'fulfilled') {
      addStructureInvalidationRule(
        'relative_market_all_windows_weak',
        '相对大盘的 5/20/60 日超额收益同时为负；仅在交易日对齐时评估。',
        false,
        { relativeToMarket: 'unavailable', excessReturn5d: null, excessReturn20d: null, excessReturn60d: null },
        [],
      );
    }

    const qualityGaps: string[] = [];
    if (technical.period?.barCount < 200) qualityGaps.push('有效日线不足 200 根，长期均线和一年分位数的稳定性有限。');
    if (technical.period?.adjust !== 'qfq') qualityGaps.push(`当前日线复权方式为 ${technical.period?.adjust || 'unknown'}，不得与前复权序列直接比较。`);
    if (technical.sourceMeta?.source === 'cache') qualityGaps.push('个股技术数据来自缓存，非本次实时拉取。');
    dataGaps.push(...qualityGaps);
    addSignal({
      signalId: 'data_quality', dimension: 'data_quality', status: qualityGaps.length ? 'data_insufficient' : 'stable', severity: qualityGaps.length ? 'medium' : 'low',
      summary: qualityGaps.length ? qualityGaps.join(' ') : '日线长度、复权方式与数据新鲜度满足当前技术信号计算要求。',
      values: { barCount: finiteNumber(technical.period?.barCount), adjust: String(technical.period?.adjust || 'unknown'), source: String(technical.sourceMeta?.source || 'unknown'), stale: technical.sourceMeta?.source === 'cache' },
    }, metricEvidence(['ma20', 'ma50', 'ma200', 'volatilityPercentile1y']));

    const structureInvalidation = {
      ruleVersion: 'technical-market-structure-v1',
      triggered: structureInvalidationRules.some((rule) => rule.triggered),
      rules: structureInvalidationRules,
      evidenceIds: [...new Set([keyLevelsEvidenceId, ...structureInvalidationRules.flatMap((rule) => rule.evidenceIds)])],
    };
    const uniqueGaps = [...new Set(dataGaps.filter(Boolean))];
    const value = {
      symbol, period, signals, keyLevels: { ...keyLevels, evidenceIds: [...new Set([...keyLevelEvidenceIds, keyLevelsEvidenceId])] }, chartBars: technical.chartBars || [], structureInvalidation, structureRuleSet: { version: 'technical-market-structure-v1', atrBuffer: { multiplier: 0.5, basis: 'ATR14', breakDefinition: 'close < key level - 0.5 * ATR14' } }, evidence, dataGaps: uniqueGaps,
      ruleSet: { version: 'technical-market-v1', riskThresholds, relativeStrength: '5/20/60 日相对收益全正为 strong、全负为 weak，其余为 mixed；仅在交易日对齐时计算。', trend: '趋势需要均线结构与 MA20/MA50 近5日斜率同向确认。' },
      inputMeta: { technical: { sourceMeta: technical.sourceMeta, period: technical.period }, marketEnvironment: environmentResult.status === 'fulfilled' ? environmentResult.value.snapshotMeta : null, relativeStrength: relativeStrengthResult.status === 'fulfilled' ? relativeStrengthResult.value.snapshotMeta : null },
      snapshotMeta: { generatedAt: new Date().toISOString(), source: 'live', freshness: 'delayed', evidenceCount: evidence.length, signalVersion: 'technical-market-v1' },
    };
    technicalMarketSignalCache.set(symbol, { expiresAt: Date.now() + 5 * 60_000, value });
    return value;
  }

  const stockFactSnapshotCache = new Map<string, { expiresAt: number; value: any }>();
  const stockIndustryChainMappingCache = new Map<string, { expiresAt: number; value: any }>();
  const industryChainIndicatorCache = new Map<string, { expiresAt: number; value: any }>();
  const stockIndustryChainSnapshotCache = new Map<string, { expiresAt: number; value: any }>();
  const industryChainAgentCache = new Map<string, { expiresAt: number; value: any }>();

  const INDUSTRY_CHAIN_RULES = [
    {
      id: 'ai_software', label: '人工智能软件与平台', keywords: ['人工智能', '大模型', '语音', '智能交互', '开放平台', '企业 ai', '软件和信息技术服务', '科大讯飞'],
      upstream: [{ name: 'AI 加速芯片与服务器', relation: '算力基础设施', dataIndicator: 'AI 服务器出货/算力供给' }, { name: '云计算与数据中心', relation: '模型训练与推理资源', dataIndicator: '云服务支出/数据中心资本开支' }],
      downstream: [{ name: '教育与办公', relation: '智能化应用需求', dataIndicator: '教育信息化招投标/企业软件支出' }, { name: '医疗、汽车与公共服务', relation: '行业解决方案需求', dataIndicator: '行业数字化投资/项目落地' }],
      indicators: [{ name: '企业 IT 与云服务支出', direction: '需求', frequency: '季度/年度' }, { name: 'AI 服务器出货与算力供给', direction: '供给与成本', frequency: '月度/季度' }, { name: '行业数字化项目中标与落地', direction: '需求验证', frequency: '事件/季度' }],
    },
    {
      id: 'semiconductor', label: '半导体与芯片', keywords: ['半导体', '芯片', '集成电路', '晶圆', '存储', '光刻'],
      upstream: [{ name: '硅片、光刻胶与电子特气', relation: '制造材料', dataIndicator: '材料价格/供给周期' }, { name: '半导体设备', relation: '产能与工艺投入', dataIndicator: '设备订单/资本开支' }],
      downstream: [{ name: '消费电子、服务器与通信设备', relation: '芯片需求', dataIndicator: '终端出货/库存周期' }, { name: '汽车电子与工业控制', relation: '结构性需求', dataIndicator: '汽车产量/工业投资' }],
      indicators: [{ name: '晶圆代工稼动率与库存', direction: '景气', frequency: '月度/季度' }, { name: '终端电子与服务器出货', direction: '需求', frequency: '月度/季度' }, { name: '半导体设备订单与资本开支', direction: '供给', frequency: '季度' }],
    },
    {
      id: 'power_battery', label: '动力电池与储能', keywords: ['动力电池', '锂电', '储能', '电池材料', '正极', '负极'],
      upstream: [{ name: '碳酸锂、镍、钴与石墨', relation: '关键原材料', dataIndicator: '现货/期货价格与库存' }, { name: '电解液、隔膜与铜箔', relation: '电池材料', dataIndicator: '材料价格/开工率' }],
      downstream: [{ name: '新能源汽车', relation: '动力电池装机需求', dataIndicator: '新能源车销量/电池装机量' }, { name: '电力储能', relation: '储能电池需求', dataIndicator: '储能招标/装机量' }],
      indicators: [{ name: '碳酸锂及材料价格', direction: '成本', frequency: '日度/周度' }, { name: '新能源车销量与装机量', direction: '需求', frequency: '月度' }, { name: '电池库存与开工率', direction: '供需', frequency: '月度' }],
    },
    {
      id: 'photovoltaic', label: '光伏产业链', keywords: ['光伏', '硅料', '硅片', '电池片', '组件', '逆变器'],
      upstream: [{ name: '多晶硅与工业硅', relation: '核心原材料', dataIndicator: '硅料/工业硅价格与库存' }, { name: '玻璃、胶膜与银浆', relation: '辅材成本', dataIndicator: '辅材价格与开工率' }],
      downstream: [{ name: '集中式与分布式电站', relation: '组件装机需求', dataIndicator: '新增光伏装机/招标规模' }, { name: '海外市场', relation: '出口与项目需求', dataIndicator: '组件出口/海外装机' }],
      indicators: [{ name: '硅料、硅片、组件价格', direction: '价格与利润', frequency: '周度' }, { name: '光伏新增装机', direction: '需求', frequency: '月度' }, { name: '产业链库存与开工率', direction: '供需', frequency: '周度/月度' }],
    },
    {
      id: 'consumer_electronics', label: '消费电子', keywords: ['消费电子', '智能手机', '可穿戴', '显示', '面板', '智能硬件'],
      upstream: [{ name: '面板、存储与元器件', relation: '核心零部件', dataIndicator: '面板/存储价格与库存' }, { name: '代工与模组', relation: '制造供给', dataIndicator: '开工率/订单能见度' }],
      downstream: [{ name: '智能手机、PC 与可穿戴终端', relation: '终端需求', dataIndicator: '终端出货量/渠道库存' }],
      indicators: [{ name: '手机、PC 与可穿戴出货', direction: '需求', frequency: '月度/季度' }, { name: '面板与存储价格', direction: '成本与库存', frequency: '周度/月度' }, { name: '渠道库存', direction: '去库进度', frequency: '月度/季度' }],
    },
  ] as const;

  async function fetchIndustryChainIndicators(ruleId: string) {
    const cached = industryChainIndicatorCache.get(ruleId);
    if (cached && cached.expiresAt > Date.now()) return { ...cached.value, sourceMeta: { ...cached.value.sourceMeta, source: 'cache', freshness: 'stale' } };
    const invocation = resolvePythonInvocation('industry_chain_indicators.py', [ruleId]);
    const { stdout } = await execFileAsync(invocation.command, invocation.args, { timeout: 90_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024, env: pythonChildEnv() });
    const value = JSON.parse(stdout);
    industryChainIndicatorCache.set(ruleId, { expiresAt: Date.now() + 6 * 60 * 60_000, value });
    return value;
  }

  function makeEvidenceId(symbol: string, type: string, key: string, period = 'current') {
    return `${type}:${symbol}:${key}:${period}`.replace(/[^a-zA-Z0-9:_-]/g, '_');
  }

  async function buildStockFactSnapshot(input: string) {
    const symbol = normalizeAshareSymbol(input).code;
    const cached = stockFactSnapshotCache.get(symbol);
    if (cached && cached.expiresAt > Date.now()) {
      return { ...cached.value, snapshotMeta: { ...cached.value.snapshotMeta, source: 'cache', freshness: 'stale' } };
    }
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }).replaceAll('-', '');
    const startDate = `${today.slice(0, 4)}0101`;
    const [quoteResult, financialResult, technicalResult, announcementResult, profileResult, heatResult, businessSegmentsResult] = await Promise.allSettled([
      fetchAshareStockQuoteWithFallback(symbol),
      fetchFinancialDataWithFallback(symbol),
      fetchStockTechnicalData(symbol),
      fetchCninfoAnnouncements(symbol, startDate, today),
      fetchXueqiuProfile(symbol),
      fetchXueqiuHeat(),
      buildStockBusinessSegments(symbol),
    ]);
    const evidence: any[] = [];
    const dataGaps: Array<{ source: string; reason: string }> = [];
    const fulfilled = <T>(result: PromiseSettledResult<T>, source: string): T | null => {
      if (result.status === 'fulfilled') return result.value;
      dataGaps.push({ source, reason: result.reason?.message || '数据源暂不可用' });
      return null;
    };
    const quoteData: any = fulfilled(quoteResult, 'market_quote');
    const financialData: any = fulfilled(financialResult, 'financial_summary');
    const technicalData: any = fulfilled(technicalResult, 'stock_technical');
    const announcementData: any = fulfilled(announcementResult, 'cninfo');
    const profileData: any = fulfilled(profileResult, 'xueqiu_profile');
    const heatData: any = fulfilled(heatResult, 'xueqiu_heat');
    const businessSegmentsData: any = fulfilled(businessSegmentsResult, 'cninfo_business_segments');

    if (quoteData?.quote) {
      const quote = quoteData.quote;
      for (const key of ['price', 'change', 'changePercent', 'volume', 'amount', 'previousClose', 'open', 'high', 'low']) {
        if (quote[key] === null || quote[key] === undefined) continue;
        evidence.push({ evidenceId: makeEvidenceId(symbol, 'market', key, String(quote.asOf || quoteData.sourceMeta.fetchedAt)), type: 'market', title: `${quote.name} ${key}`, value: quote[key], source: quoteData.sourceMeta.source, fetchedAt: quoteData.sourceMeta.fetchedAt, freshness: quoteData.sourceMeta.freshness, verification: 'third_party' });
      }
    }
    for (const report of financialData?.reports || []) {
      for (const [key, value] of Object.entries(report.metrics || {})) {
        if (value === null || value === undefined) continue;
        evidence.push({ evidenceId: makeEvidenceId(symbol, 'financial', key, report.period), type: 'financial', title: `${report.period} ${key}`, value, period: report.period, source: financialData.sourceMeta.source, fetchedAt: financialData.sourceMeta.fetchedAt, freshness: financialData.sourceMeta.freshness, verification: financialData.sourceMeta.officialStatus || 'third_party' });
      }
    }
    for (const [key, value] of Object.entries(financialData?.calculations?.metrics || {})) {
      if (value === null || value === undefined) continue;
      evidence.push({ evidenceId: makeEvidenceId(symbol, 'financial_calculation', key, financialData.calculations.period || 'current'), type: 'financial', title: `${financialData.template || 'non_financial'} ${key}`, value, period: financialData.calculations.period, source: 'calculation', fetchedAt: financialData.sourceMeta.fetchedAt, freshness: financialData.sourceMeta.freshness, verification: 'third_party' });
    }
    if (technicalData?.latestBar) {
      for (const key of ['open', 'high', 'low', 'close', 'volume', 'amount', 'turnover']) {
        const value = technicalData.latestBar[key];
        if (value === null || value === undefined) continue;
        evidence.push({ evidenceId: makeEvidenceId(symbol, 'technical_input', key, technicalData.latestBar.date), type: 'market', title: `${technicalData.latestBar.date} ${key}`, value, period: technicalData.latestBar.date, source: technicalData.sourceMeta.source, fetchedAt: technicalData.sourceMeta.fetchedAt, freshness: technicalData.sourceMeta.freshness, verification: 'third_party' });
      }
      for (const [key, value] of Object.entries(technicalData.metrics || {})) {
        if (value === null || value === undefined) continue;
        evidence.push({ evidenceId: makeEvidenceId(symbol, 'technical_calculation', key, technicalData.period?.end || 'current'), type: 'market', title: `technical ${key}`, value: String(value), period: technicalData.period?.end, source: 'calculation', fetchedAt: technicalData.sourceMeta.fetchedAt, freshness: technicalData.sourceMeta.freshness, verification: 'third_party' });
      }
    }
    for (const item of (announcementData?.announcements || []).slice(0, 20)) {
      evidence.push({ evidenceId: makeEvidenceId(symbol, 'announcement', item.title, item.publishedAt), type: 'announcement', title: item.title, source: 'cninfo', sourceUrl: item.url, publishedAt: item.publishedAt, fetchedAt: announcementData.sourceMeta.fetchedAt, freshness: announcementData.sourceMeta.freshness, verification: 'official_verified' });
    }
    evidence.push(...(businessSegmentsData?.evidence || []));
    for (const gap of businessSegmentsData?.dataGaps || []) dataGaps.push({ source: 'cninfo_business_segments', reason: String(gap) });
    for (const [key, value] of Object.entries(profileData?.profile || {})) {
      if (!value) continue;
      evidence.push({ evidenceId: makeEvidenceId(symbol, 'profile', key), type: 'industry', title: key, value: String(value), source: profileData.sourceMeta.source, fetchedAt: profileData.sourceMeta.fetchedAt, freshness: profileData.sourceMeta.freshness, verification: 'third_party' });
    }
    const heatItem = (heatData?.items || []).find((item: any) => String(item['股票代码'] || '').endsWith(symbol));
    if (heatItem) {
      evidence.push({ evidenceId: makeEvidenceId(symbol, 'sentiment', 'hot_tweet'), type: 'sentiment', title: '雪球热门讨论榜', value: heatItem['关注'], source: heatData.sourceMeta.source, fetchedAt: heatData.sourceMeta.fetchedAt, freshness: heatData.sourceMeta.freshness, verification: 'third_party' });
    } else {
      dataGaps.push({ source: 'xueqiu_heat', reason: '该股票未进入当前热门讨论榜' });
    }
    const value = {
      symbol,
      company: { name: quoteData?.quote?.name || profileData?.profile?.org_short_name_cn || symbol, profile: profileData?.profile || {}, financialTemplate: financialData?.template || null },
      facts: { quote: quoteData?.quote || null, financialReports: financialData?.reports || [], financialCalculations: financialData?.calculations || null, financialMeta: financialData ? { template: financialData.template, unit: financialData.unit, normalization: financialData.normalization, sourceMeta: financialData.sourceMeta } : null, businessSegments: businessSegmentsData || null, technical: technicalData || null, announcements: announcementData?.announcements?.slice(0, 20) || [], sentiment: heatItem || null },
      evidence,
      dataGaps,
      snapshotMeta: { generatedAt: new Date().toISOString(), source: 'live', freshness: 'realtime', evidenceCount: evidence.length },
    };
    stockFactSnapshotCache.set(symbol, { expiresAt: Date.now() + 60_000, value });
    return value;
  }

  async function buildIndustryChainMapping(input: string) {
    const symbol = normalizeAshareSymbol(input).code;
    const cached = stockIndustryChainMappingCache.get(symbol);
    if (cached && cached.expiresAt > Date.now()) return { ...cached.value, snapshotMeta: { ...cached.value.snapshotMeta, source: 'cache', freshness: 'stale' } };
    const snapshot = await buildStockFactSnapshot(symbol);
    const profile = snapshot.company?.profile || {};
    const segmentNames = (snapshot.facts?.businessSegments?.segmentSets || []).flatMap((set: any) => (set?.items || []).map((item: any) => String(item?.name || ''))).filter(Boolean);
    const businessText = [snapshot.company?.name, profile.main_operation_business, profile.industry, profile.org_name_cn, ...segmentNames].filter(Boolean).join(' ').toLowerCase();
    const businessEvidenceIds = (snapshot.evidence || []).filter((item: any) => item?.type === 'industry' || String(item?.evidenceId || '').startsWith('business_segment:')).map((item: any) => String(item.evidenceId));
    const matchedRules = INDUSTRY_CHAIN_RULES.filter((rule) => rule.keywords.some((keyword) => businessText.includes(keyword.toLowerCase())));
    const evidence = matchedRules.map((rule) => ({ evidenceId: makeEvidenceId(symbol, 'industry_chain_mapping', rule.id), type: 'industry_chain_mapping', title: `产业链业务映射 ${rule.label}`, value: JSON.stringify({ ruleId: rule.id, matchedKeywords: rule.keywords.filter((keyword) => businessText.includes(keyword.toLowerCase())) }), source: 'rule_based_business_mapping', fetchedAt: new Date().toISOString(), freshness: 'delayed', verification: 'derived' }));
    const mappings = matchedRules.map((rule) => ({ ruleId: rule.id, label: rule.label, matchedKeywords: rule.keywords.filter((keyword) => businessText.includes(keyword.toLowerCase())), upstream: rule.upstream, downstream: rule.downstream, indicators: rule.indicators, evidenceIds: [...new Set([...businessEvidenceIds, makeEvidenceId(symbol, 'industry_chain_mapping', rule.id)])] }));
    const indicatorResults = await Promise.allSettled(mappings.map((mapping) => fetchIndustryChainIndicators(mapping.ruleId)));
    const mappingsWithData = mappings.map((mapping, index) => {
      const result = indicatorResults[index];
      const chainData = result.status === 'fulfilled' ? result.value : null;
      const indicatorEvidence = (chainData?.indicators || []).map((item: any) => ({ evidenceId: makeEvidenceId(symbol, 'industry_chain_indicator', `${mapping.ruleId}_${item.key}`, item.asOf || 'current'), type: 'industry_chain_indicator', title: `${mapping.label} ${item.label}`, value: JSON.stringify({ value: item.value, unit: item.unit, change: item.change ?? null, yoy: item.yoy ?? null, basisRate: item.basisRate ?? null }), period: item.asOf || null, source: item.source || chainData?.sourceMeta?.source || 'unknown', fetchedAt: chainData?.sourceMeta?.fetchedAt || new Date().toISOString(), freshness: chainData?.sourceMeta?.freshness || 'delayed', verification: 'third_party' }));
      evidence.push(...indicatorEvidence);
      return { ...mapping, chainData: { status: chainData?.status || 'unavailable', indicators: chainData?.indicators || [], dataGaps: chainData?.dataGaps || [result.status === 'rejected' ? `产业链数据请求失败：${result.reason?.message || '未知原因'}` : '产业链数据暂不可用。'], sourceMeta: chainData?.sourceMeta || null, evidenceIds: indicatorEvidence.map((item: any) => item.evidenceId) } };
    });
    const dataGaps = [
      ...(businessText ? [] : ['缺少主营业务描述和可用分业务表格，无法建立产业链映射。']),
      ...(mappings.length ? [] : ['未命中高置信业务映射规则；需人工补充公司业务标签后再关联上下游。']),
      ...mappingsWithData.flatMap((mapping) => mapping.chainData.dataGaps || []),
    ];
    const value = { symbol, company: { name: snapshot.company?.name || symbol, businessContext: { mainOperation: profile.main_operation_business || null, industry: profile.industry || null, segmentNames } }, status: mappingsWithData.length ? 'mapped' : businessText ? 'partial' : 'unavailable', mappingVersion: 'industry-chain-mapping-v2', mappings: mappingsWithData, evidence, evidenceIds: evidence.map((item) => item.evidenceId), dataGaps: [...new Set(dataGaps)], snapshotMeta: { generatedAt: new Date().toISOString(), source: 'rule_based_business_mapping + akshare_public_industry_chain', freshness: 'delayed', confidence: mappingsWithData.length ? 'limited' : 'low', mappingRequiresMarketData: false } };
    stockIndustryChainMappingCache.set(symbol, { expiresAt: Date.now() + 24 * 60 * 60_000, value });
    return value;
  }

  function industryPercentileStatus(metric: any) {
    const percentile = finiteNumber(metric?.percentile);
    if (percentile === null) return 'data_insufficient';
    if (percentile >= 0.75) return 'upper_quartile';
    if (percentile <= 0.25) return 'lower_quartile';
    return 'middle_range';
  }

  async function buildIndustryChainSnapshot(input: string) {
    const symbol = normalizeAshareSymbol(input).code;
    const cached = stockIndustryChainSnapshotCache.get(symbol);
    if (cached && cached.expiresAt > Date.now()) return { ...cached.value, snapshotMeta: { ...cached.value.snapshotMeta, source: 'cache', freshness: 'stale' } };
    const [benchmarkResult, financialResult, mappingResult, eventResult] = await Promise.allSettled([
      fetchStockIndustryBenchmark(symbol),
      buildIndustryFinancialPercentiles(symbol),
      buildIndustryChainMapping(symbol),
      buildStockEventSnapshot(symbol, 180),
    ]);
    const benchmark: any = benchmarkResult.status === 'fulfilled' ? benchmarkResult.value : null;
    const financial: any = financialResult.status === 'fulfilled' ? financialResult.value : null;
    const mapping: any = mappingResult.status === 'fulfilled' ? mappingResult.value : null;
    const eventSnapshot: any = eventResult.status === 'fulfilled' ? eventResult.value : null;
    const dataGaps: string[] = [];
    for (const [name, result] of [['行业归属', benchmarkResult], ['行业财务分位', financialResult], ['产业链映射', mappingResult], ['行业与政策事件', eventResult]] as const) {
      if (result.status === 'rejected') dataGaps.push(`${name}不可用：${safeRuntimeDataGap(result.reason?.message || '未知原因')}`);
    }
    dataGaps.push(...(financial?.dataGaps || []).map(String), ...(mapping?.dataGaps || []).map(String), ...(eventSnapshot?.dataGaps || []).map(String));
    const financialMetrics = (financial?.metrics || []).map((metric: any) => ({ ...metric, position: industryPercentileStatus(metric) }));
    const financialEvidence = financialMetrics.filter((metric: any) => metric.status === 'available').map((metric: any) => ({
      evidenceId: makeEvidenceId(symbol, 'industry_financial_percentile', metric.key, financial?.period || 'current'), type: 'industry_financial_percentile', title: `${financial?.industry?.name || '行业'} ${metric.label} 分位`, value: JSON.stringify({ value: metric.value, median: metric.median, percentile: metric.percentile, sampleSize: metric.sampleSize, rankDirection: metric.rankDirection }), period: financial?.period || null, source: 'industry_financial_calculation', fetchedAt: new Date().toISOString(), freshness: 'delayed', verification: 'derived',
    }));
    const industryEvents = (eventSnapshot?.events || []).filter((event: any) => ['industry', 'policy'].includes(String(event.impactScope)) && event.status !== 'expired');
    const eventEvidenceIds = new Set(industryEvents.flatMap((event: any) => event.evidenceIds || []));
    const eventEvidence = (eventSnapshot?.evidence || []).filter((item: any) => eventEvidenceIds.has(item.evidenceId));
    const evidence = [...(benchmark?.evidence || []), ...financialEvidence, ...(mapping?.evidence || []), ...eventEvidence];
    const memberCount = Number(benchmark?.industry?.memberCount || financial?.industry?.memberCount || 0);
    const availableFinancialCount = financialMetrics.filter((metric: any) => metric.status === 'available' && Number(metric.sampleSize) >= 20).length;
    const mappedChains = mapping?.mappings || [];
    const chainIndicators = mappedChains.flatMap((item: any) => item?.chainData?.indicators || []);
    const dataQuality = {
      memberSnapshot: memberCount > 0 ? 'complete' : 'unavailable',
      financialSample: availableFinancialCount >= 3 ? 'sufficient' : availableFinancialCount ? 'thin' : 'unavailable',
      chainData: chainIndicators.length ? 'mapped' : mappedChains.length ? 'partial' : 'unavailable',
    };
    const status = dataQuality.memberSnapshot === 'unavailable' && dataQuality.chainData === 'unavailable' ? 'unavailable' : dataQuality.financialSample === 'sufficient' || dataQuality.chainData === 'mapped' ? 'available' : 'limited';
    const value = {
      symbol,
      status,
      industry: benchmark?.industry || financial?.industry || null,
      financialPosition: { period: financial?.period || null, template: financial?.template || null, metrics: financialMetrics, coverage: financial?.coverage || null },
      chain: { status: mapping?.status || 'unavailable', mappings: mappedChains, indicatorCount: chainIndicators.length },
      events: industryEvents,
      dataQuality,
      evidence,
      evidenceIds: [...new Set(evidence.map((item: any) => String(item.evidenceId || '')).filter(Boolean))],
      dataGaps: [...new Set(dataGaps.filter(Boolean))],
      snapshotMeta: { generatedAt: new Date().toISOString(), source: 'industry_chain_snapshot', freshness: status === 'available' ? 'delayed' : 'stale', evidenceCount: evidence.length, version: 'industry-chain-v1', warming: financial?.status === 'warming' },
    };
    stockIndustryChainSnapshotCache.set(symbol, { expiresAt: Date.now() + (financial?.status === 'warming' ? 30_000 : 5 * 60_000), value });
    return value;
  }

  function fallbackIndustryChainOpinion(snapshot: any, reason: string) {
    const metrics = (snapshot?.financialPosition?.metrics || []).filter((item: any) => item.status === 'available');
    const mapped = snapshot?.chain?.mappings || [];
    const positives = metrics.filter((item: any) => item.position === 'upper_quartile').map((item: any) => ({ text: `${item.label}处于行业较高分位（样本 ${item.sampleSize} 家）。`, evidenceIds: [makeEvidenceId(snapshot.symbol, 'industry_financial_percentile', item.key, snapshot?.financialPosition?.period || 'current')] }));
    const negatives = metrics.filter((item: any) => item.position === 'lower_quartile').map((item: any) => ({ text: `${item.label}处于行业较低分位（样本 ${item.sampleSize} 家）。`, evidenceIds: [makeEvidenceId(snapshot.symbol, 'industry_financial_percentile', item.key, snapshot?.financialPosition?.period || 'current')] }));
    const conclusion = snapshot?.status === 'unavailable'
      ? '行业与产业链关键输入不可用，暂不形成行业结论。'
      : `${snapshot?.industry?.name || '所属行业'}已形成行业成员与产业链映射快照；${snapshot?.chain?.indicatorCount ? '已取得部分产业链指标。' : '产业链实时指标仍不完整。'}`;
    return { agent: 'industry_chain', status: snapshot?.status === 'available' ? 'limited' : snapshot?.status || 'unavailable', conclusion, confidence: { score: Math.min(60, 25 + snapshot.evidenceIds.length), level: 'limited', reason: `AI 解释层不可用，保留冻结快照与规则回退：${reason}` }, positives: positives.slice(0, 4), negatives: negatives.slice(0, 4), uncertainties: (snapshot?.dataGaps || []).slice(0, 6).map((text: string) => ({ text, evidenceIds: [] })), evidenceIds: snapshot?.evidenceIds || [], dataGaps: snapshot?.dataGaps || [], mappedRules: mapped.map((item: any) => item.ruleId) };
  }

  async function runIndustryChainAgent(inputSymbol: string, refresh = false) {
    const symbol = normalizeAshareSymbol(inputSymbol).code;
    const cached = industryChainAgentCache.get(symbol);
    if (!refresh && cached && cached.expiresAt > Date.now()) return { ...cached.value, agentMeta: { ...cached.value.agentMeta, source: 'cache' } };
    const snapshot = await buildIndustryChainSnapshot(symbol);
    const evidenceSet = new Set<string>(snapshot.evidenceIds || []);
    let opinion: any;
    let aiStatus: 'completed' | 'fallback' | 'not_requested' = 'completed';
    if (!evidenceSet.size || snapshot.status === 'unavailable') {
      aiStatus = 'not_requested';
      opinion = fallbackIndustryChainOpinion(snapshot, '没有足够的可引用行业证据，不调用 AI。');
    } else {
      try {
        const raw = await callAI(
          '你是行业与产业链 Agent。只解释输入中的冻结行业快照和证据目录，不搜索新事实、不预测股价、不提供买卖、仓位或目标价建议。行业财务分位、样本数、产业链映射、指标状态与事件范围均由程序确定，不得改写。产业链映射或第三方行业/政策事件只能说明待核验的传导线索，不能直接写成公司事实或公司业绩结论。没有产业链实时指标时必须明确数据缺口。每项事实判断必须引用 evidenceCatalog 中已有 evidenceId；无证据只能写入 uncertainties。严格输出 JSON：{"conclusion":"","confidence":{"score":0,"level":"high|medium|limited","reason":""},"industryPosition":"","chainAssessment":"","positives":[{"text":"","evidenceIds":[]}],"negatives":[{"text":"","evidenceIds":[]}],"uncertainties":[{"text":"","evidenceIds":[]}]}' ,
          JSON.stringify({ symbol, snapshot, evidenceCatalog: snapshot.evidence }), 0.1, 3_500,
        );
        const parsed = parseAIJson(raw);
        const normalizeItems = (items: unknown) => Array.isArray(items) ? items.slice(0, 5).map((item: any) => ({ text: sanitizeTeacherText(item?.text, 220), evidenceIds: Array.isArray(item?.evidenceIds) ? [...new Set(item.evidenceIds.map(String).filter((id: string) => evidenceSet.has(id)))].slice(0, 8) : [] })).filter((item: any) => item.text && item.evidenceIds.length) : [];
        const positives = normalizeItems(parsed?.positives); const negatives = normalizeItems(parsed?.negatives); const uncertainties = normalizeItems(parsed?.uncertainties);
        const citedIds = [...new Set([...positives, ...negatives, ...uncertainties].flatMap((item: any) => item.evidenceIds))];
        const requestedLevel = ['high', 'medium', 'limited'].includes(parsed?.confidence?.level) ? parsed.confidence.level : 'limited';
        opinion = { agent: 'industry_chain', status: snapshot.dataGaps.length || !citedIds.length ? 'limited' : 'completed', conclusion: sanitizeTeacherText(parsed?.conclusion, 280) || fallbackIndustryChainOpinion(snapshot, 'AI 未返回结论。').conclusion, industryPosition: sanitizeTeacherText(parsed?.industryPosition, 220), chainAssessment: sanitizeTeacherText(parsed?.chainAssessment, 220), confidence: { score: Math.max(0, Math.min(snapshot.dataGaps.length ? 65 : 85, Number(parsed?.confidence?.score) || 0)), level: snapshot.dataGaps.length ? 'limited' : requestedLevel === 'high' ? 'medium' : requestedLevel, reason: sanitizeTeacherText(parsed?.confidence?.reason, 180) || '置信度受成员样本、产业链指标覆盖和事件核验状态共同约束。' }, positives, negatives, uncertainties, evidenceIds: citedIds, dataGaps: snapshot.dataGaps || [] };
      } catch (error: any) {
        aiStatus = 'fallback';
        console.warn(`[industry-chain-agent] AI fallback for ${symbol}:`, error.message);
        opinion = fallbackIndustryChainOpinion(snapshot, error.message);
      }
    }
    const value = { symbol, industrySnapshot: snapshot, deterministicIndustry: { status: snapshot.status, industry: snapshot.industry, financialPosition: snapshot.financialPosition, chain: snapshot.chain, events: snapshot.events, dataQuality: snapshot.dataQuality }, opinion, agentMeta: { generatedAt: new Date().toISOString(), source: 'live', aiStatus, promptVersion: 'industry-chain-v1', snapshotGeneratedAt: snapshot.snapshotMeta.generatedAt, industryVersion: snapshot.snapshotMeta.version } };
    industryChainAgentCache.set(symbol, { expiresAt: Date.now() + (snapshot.snapshotMeta?.warming ? 30_000 : 15 * 60_000), value });
    return value;
  }

  type FundamentalSignalStatus = 'positive' | 'stable' | 'mixed' | 'deteriorating' | 'risk' | 'data_insufficient';
  type FundamentalSignal = {
    signalId: string;
    dimension: 'business_model' | 'growth' | 'profit_quality' | 'cash_quality' | 'resilience' | 'risk_disclosure' | 'industry_comparison';
    status: FundamentalSignalStatus;
    severity: 'low' | 'medium' | 'high';
    summary: string;
    values: Record<string, number | string | boolean | null>;
    evidenceIds: string[];
  };

  const fundamentalAgentCache = new Map<string, { expiresAt: number; value: any }>();

  function finiteNumber(value: unknown) {
    const numeric = Number(value);
    return value !== null && value !== undefined && Number.isFinite(numeric) ? numeric : null;
  }

  function formatPercent(value: unknown) {
    const numeric = finiteNumber(value);
    return numeric === null ? '数据不足' : `${(numeric * 100).toFixed(1)}%`;
  }

  function fundamentalEvidenceIds(snapshot: any, keys: string[], period?: string) {
    return (snapshot.evidence || [])
      .filter((item: any) => {
        const id = String(item.evidenceId || '');
        const keyMatched = keys.some((key) => id.includes(`:${key}:`));
        return keyMatched && (!period || item.period === period);
      })
      .map((item: any) => String(item.evidenceId));
  }

  function samePeriodYoYSeries(reports: any[], key: string) {
    return reports.map((report: any) => {
      const prior = previousYearReport(reports, report.period);
      return { period: report.period, value: ratio(report.metrics?.[key], prior?.metrics?.[key]) };
    }).filter((item: any) => item.value !== null).slice(0, 4);
  }

  function seriesDirection(series: Array<{ value: number }>) {
    if (series.length < 2) return 'data_insufficient';
    const changes = series.slice(0, -1).map((item, index) => item.value - series[index + 1].value);
    if (changes.every((value) => value > 0)) return 'improving';
    if (changes.every((value) => value < 0)) return 'deteriorating';
    return 'mixed';
  }

  function buildFundamentalSignals(snapshot: any, industryFinancial?: any) {
    const reports = snapshot.facts?.financialReports || [];
    const calculations = snapshot.facts?.financialCalculations || {};
    const metrics = calculations.metrics || {};
    const template = snapshot.company?.financialTemplate === 'bank' ? 'bank' : 'non_financial';
    const latest = reports[0] || null;
    const prior = previousYearReport(reports, latest?.period);
    const signals: FundamentalSignal[] = [];
    const vetoes: Array<{ code: string; description: string; triggered: boolean; evidenceIds: string[] }> = [];
    const dataGaps = [...(calculations.dataGaps || [])];
    const addSignal = (signal: FundamentalSignal) => signals.push({ ...signal, evidenceIds: [...new Set(signal.evidenceIds)] });

    if (!latest) {
      vetoes.push({ code: 'financial_data_missing', description: '未取得可用于分析的结构化财务报告，基本面判断被阻断。', triggered: true, evidenceIds: [] });
      dataGaps.push('缺少结构化财务报告。');
      return { template, latest, prior, signals, vetoes, dataGaps };
    }

    const profileEvidence = (snapshot.evidence || []).filter((item: any) => String(item.evidenceId || '').startsWith(`profile:${snapshot.symbol}:`)).map((item: any) => item.evidenceId);
    const businessSummary = snapshot.company?.profile?.main_operation_business || snapshot.company?.profile?.org_name_cn || '';
    addSignal({
      signalId: 'business_model_coverage', dimension: 'business_model', status: businessSummary ? 'stable' : 'data_insufficient', severity: businessSummary ? 'low' : 'medium',
      summary: businessSummary ? '已取得主营业务或公司画像，可用于解释财务表现。' : '缺少可核验的主营业务描述。',
      values: { businessSummary: String(businessSummary).slice(0, 300) || null }, evidenceIds: profileEvidence,
    });
    if (!businessSummary) dataGaps.push('缺少可核验的主营业务描述。');

    const businessSegments = snapshot.facts?.businessSegments;
    const segmentSets = Array.isArray(businessSegments?.segmentSets) ? businessSegments.segmentSets : [];
    const availableSegmentSets = segmentSets.filter((set: any) => set?.status === 'available' && Array.isArray(set?.items) && set.items.length);
    const concentrated = availableSegmentSets.find((set: any) => finiteNumber(set?.concentration?.top1RevenueShare) !== null && Number(set.concentration.top1RevenueShare) >= 0.7);
    const businessEvidenceIds = availableSegmentSets.flatMap((set: any) => (set.items || []).map((item: any) => item.evidenceId).filter(Boolean));
    addSignal({
      signalId: 'business_segment_structure', dimension: 'business_model',
      status: availableSegmentSets.length ? concentrated ? 'mixed' : 'stable' : 'data_insufficient', severity: concentrated ? 'medium' : 'low',
      summary: availableSegmentSets.length
        ? `${availableSegmentSets.map((set: any) => `${set.dimension}分部`).join('、')}已从巨潮原文表格提取；${concentrated ? `最大已提取分部收入占比${formatPercent(concentrated.concentration.top1RevenueShare)}，存在集中度观察项。` : '当前提取范围内未触发单一分部集中度观察规则。'}`
        : '未获得可可靠结构化的分业务表格；仅保留巨潮原文页码证据，不据此推断增长来源或业务恶化。',
      values: { segmentSetCount: availableSegmentSets.length, top1RevenueShare: finiteNumber(concentrated?.concentration?.top1RevenueShare) }, evidenceIds: businessEvidenceIds,
    });
    if (!availableSegmentSets.length) dataGaps.push('分业务经营章节已尝试解析，但尚未得到可可靠计算的收入/利润表格；请查看原文页码证据。');

    const revenueYoY = finiteNumber(metrics.revenueYoY);
    const adjustedYoY = finiteNumber(metrics.adjustedNetProfitYoY);
    const revenueTrend = seriesDirection(samePeriodYoYSeries(reports, 'revenue') as Array<{ value: number }>);
    const adjustedTrend = seriesDirection(samePeriodYoYSeries(reports, 'adjustedNetProfit') as Array<{ value: number }>);
    const trendLabels: Record<string, string> = { improving: '改善', stable: '稳定', mixed: '分化', deteriorating: '走弱', risk: '风险', data_insufficient: '数据不足' };
    const revenueTrendLabel = trendLabels[revenueTrend] || '待确认';
    const adjustedTrendLabel = trendLabels[adjustedTrend] || '待确认';
    const samePeriodTrendSummary = revenueTrendLabel === adjustedTrendLabel
      ? `营收与扣非净利润的自身同报告期趋势均为${revenueTrendLabel}`
      : `营收与扣非净利润的自身同报告期趋势分别为${revenueTrendLabel}、${adjustedTrendLabel}`;
    const growthStatus: FundamentalSignalStatus = revenueYoY === null || adjustedYoY === null ? 'data_insufficient'
      : revenueYoY >= 0 && adjustedYoY >= 0 ? (revenueTrend === 'deteriorating' || adjustedTrend === 'deteriorating' ? 'mixed' : 'positive')
        : revenueYoY < 0 && adjustedYoY < 0 ? 'deteriorating' : 'mixed';
    addSignal({
      signalId: 'growth_alignment', dimension: 'growth', status: growthStatus, severity: growthStatus === 'deteriorating' ? 'high' : growthStatus === 'mixed' ? 'medium' : 'low',
      summary: `最新营收同比${formatPercent(revenueYoY)}、扣非净利润同比${formatPercent(adjustedYoY)}；${samePeriodTrendSummary}。`,
      values: { revenueYoY, adjustedNetProfitYoY: adjustedYoY, revenueTrend, adjustedNetProfitTrend: adjustedTrend },
      evidenceIds: fundamentalEvidenceIds(snapshot, ['revenueYoY', 'adjustedNetProfitYoY'], latest.period),
    });

    const netProfit = finiteNumber(latest.metrics?.netProfit);
    const adjustedProfit = finiteNumber(latest.metrics?.adjustedNetProfit);
    const adjustedShare = divide(adjustedProfit, netProfit);
    const priorAdjustedShare = divide(prior?.metrics?.adjustedNetProfit, prior?.metrics?.netProfit);
    const qualityChange = adjustedShare !== null && priorAdjustedShare !== null ? adjustedShare - priorAdjustedShare : null;
    addSignal({
      signalId: 'adjusted_profit_quality', dimension: 'profit_quality',
      status: adjustedShare === null ? 'data_insufficient' : netProfit! > 0 && adjustedProfit! < 0 ? 'risk' : qualityChange !== null && qualityChange < 0 ? 'mixed' : 'stable',
      severity: netProfit !== null && adjustedProfit !== null && netProfit > 0 && adjustedProfit < 0 ? 'high' : 'medium',
      summary: `扣非净利润/归母净利润为${formatPercent(adjustedShare)}，较上年同期变化${formatPercent(qualityChange)}。`,
      values: { adjustedProfitShare: adjustedShare, priorAdjustedProfitShare: priorAdjustedShare, change: qualityChange },
      evidenceIds: fundamentalEvidenceIds(snapshot, ['netProfit', 'adjustedNetProfit'], latest.period).concat(fundamentalEvidenceIds(snapshot, ['netProfit', 'adjustedNetProfit'], prior?.period)),
    });

    const equity = finiteNumber(latest.metrics?.equity);
    vetoes.push({ code: 'negative_equity', description: `报告期 ${latest.period} 的归母权益为 ${equity == null ? '数据不足' : equity}（以数据源统一口径为准），已触发财务持续性否决项。`, triggered: equity !== null && equity < 0, evidenceIds: fundamentalEvidenceIds(snapshot, ['equity'], latest.period) });

    if (template === 'non_financial') {
      const cashConversion = finiteNumber(metrics.cashConversion);
      const priorCashConversion = divide(prior?.metrics?.operatingCashFlow, prior?.metrics?.netProfit);
      const latestCashNegative = netProfit !== null && netProfit > 0 && finiteNumber(latest.metrics?.operatingCashFlow) !== null && Number(latest.metrics.operatingCashFlow) < 0;
      const priorCashNegative = finiteNumber(prior?.metrics?.netProfit) !== null && Number(prior.metrics.netProfit) > 0 && finiteNumber(prior?.metrics?.operatingCashFlow) !== null && Number(prior.metrics.operatingCashFlow) < 0;
      addSignal({
        signalId: 'cash_profit_alignment', dimension: 'cash_quality',
        status: latestCashNegative && priorCashNegative ? 'risk' : latestCashNegative ? 'deteriorating' : cashConversion === null ? 'data_insufficient' : 'stable',
        severity: latestCashNegative && priorCashNegative ? 'high' : latestCashNegative ? 'medium' : 'low',
        summary: `经营现金流/归母净利润为${formatPercent(cashConversion)}，上年同期为${formatPercent(priorCashConversion)}。${latestCashNegative ? '本期利润为正但经营现金流为负。' : ''}`,
        values: { cashConversion, priorCashConversion, latestPositiveProfitNegativeCashFlow: latestCashNegative, priorPositiveProfitNegativeCashFlow: priorCashNegative },
        evidenceIds: fundamentalEvidenceIds(snapshot, ['cashConversion'], latest.period).concat(fundamentalEvidenceIds(snapshot, ['operatingCashFlow', 'netProfit'], latest.period), fundamentalEvidenceIds(snapshot, ['operatingCashFlow', 'netProfit'], prior?.period)),
      });
      addSignal({
        signalId: 'balance_sheet_resilience', dimension: 'resilience', status: metrics.assetLiabilityRatio == null ? 'data_insufficient' : 'stable', severity: 'low',
        summary: `资产负债率${formatPercent(metrics.assetLiabilityRatio)}、上年同期${formatPercent(divide(prior?.metrics?.liabilities, prior?.metrics?.assets))}，权益同比${formatPercent(metrics.equityYoY)}。`,
        values: { assetLiabilityRatio: finiteNumber(metrics.assetLiabilityRatio), priorAssetLiabilityRatio: divide(prior?.metrics?.liabilities, prior?.metrics?.assets), equityYoY: finiteNumber(metrics.equityYoY), roeApprox: finiteNumber(metrics.roeApprox), freeCashFlowProxy: finiteNumber(metrics.freeCashFlowProxy) },
        evidenceIds: fundamentalEvidenceIds(snapshot, ['assetLiabilityRatio', 'equityYoY', 'roeApprox', 'freeCashFlowProxy'], latest.period),
      });
    } else {
      const loanYoY = finiteNumber(metrics.loanYoY); const depositYoY = finiteNumber(metrics.depositYoY);
      const expansionGap = loanYoY !== null && depositYoY !== null ? loanYoY - depositYoY : null;
      const priorImpairmentRatio = divide(prior?.metrics?.creditImpairment, prior?.metrics?.revenue);
      const currentImpairmentRatio = finiteNumber(metrics.creditImpairmentToRevenue);
      addSignal({
        signalId: 'bank_funding_alignment', dimension: 'resilience', status: expansionGap === null ? 'data_insufficient' : expansionGap > 0 ? 'mixed' : 'stable', severity: expansionGap !== null && expansionGap > 0 ? 'medium' : 'low',
        summary: `贷款同比${formatPercent(loanYoY)}、存款同比${formatPercent(depositYoY)}，贷款与存款增速差${formatPercent(expansionGap)}。`,
        values: { loanYoY, depositYoY, loanDepositGrowthGap: expansionGap, assetYoY: finiteNumber(metrics.assetYoY) },
        evidenceIds: fundamentalEvidenceIds(snapshot, ['loanYoY', 'depositYoY', 'assetYoY'], latest.period),
      });
      addSignal({
        signalId: 'bank_income_and_impairment', dimension: 'profit_quality',
        status: finiteNumber(metrics.interestNetIncomeYoY) !== null && Number(metrics.interestNetIncomeYoY) < 0 || currentImpairmentRatio !== null && priorImpairmentRatio !== null && currentImpairmentRatio > priorImpairmentRatio ? 'mixed' : 'stable', severity: 'medium',
        summary: `净利息收入同比${formatPercent(metrics.interestNetIncomeYoY)}、手续费收入同比${formatPercent(metrics.feeNetIncomeYoY)}；信用减值占营收${formatPercent(currentImpairmentRatio)}，上年同期${formatPercent(priorImpairmentRatio)}。`,
        values: { interestNetIncomeYoY: finiteNumber(metrics.interestNetIncomeYoY), feeNetIncomeYoY: finiteNumber(metrics.feeNetIncomeYoY), creditImpairmentToRevenue: currentImpairmentRatio, priorCreditImpairmentToRevenue: priorImpairmentRatio },
        evidenceIds: fundamentalEvidenceIds(snapshot, ['interestNetIncomeYoY', 'feeNetIncomeYoY', 'creditImpairmentToRevenue'], latest.period),
      });
    }

    if (industryFinancial?.status === 'available' && Array.isArray(industryFinancial.items) && industryFinancial.items.length) {
      const preferredKeys = template === 'bank' ? ['revenueYoY', 'netProfitYoY', 'roeApprox', 'loanYoY', 'creditImpairmentToRevenue'] : ['revenueYoY', 'netProfitYoY', 'netMargin', 'roeApprox', 'assetLiabilityRatio', 'cashConversion'];
      const peerItems = preferredKeys.map((key) => industryFinancial.items.find((item: any) => item.key === key)).filter(Boolean).slice(0, 4);
      const averagePosition = peerItems.length ? peerItems.reduce((sum: number, item: any) => sum + Number(item.comparisonPercentile), 0) / peerItems.length : null;
      const peerStatus: FundamentalSignalStatus = averagePosition === null ? 'data_insufficient' : averagePosition >= 0.65 ? 'positive' : averagePosition <= 0.35 ? 'deteriorating' : 'mixed';
      const peerSummary = peerItems.map((item: any) => `${item.label}${(Number(item.comparisonPercentile) * 100).toFixed(1)}%分位（${item.sampleSize}家，${item.rankDirection === 'lower_better' ? '已按低值优先换算' : '高值优先'}）`).join('；');
      addSignal({
        signalId: 'industry_financial_position', dimension: 'industry_comparison', status: peerStatus, severity: peerStatus === 'deteriorating' ? 'medium' : 'low',
        summary: `行业横向比较（${industryFinancial.industry?.name || '未分类'}，${industryFinancial.period || '报告期未知'}）：${peerSummary}。分位仅说明同口径样本中的相对位置，不代表投资结论。`,
        values: { averageComparisonPercentile: averagePosition, comparableSampleSize: Number(industryFinancial.coverage?.comparable || 0), itemCount: peerItems.length, period: industryFinancial.period || null }, evidenceIds: peerItems.map((item: any) => item.evidenceId),
      });
    } else {
      dataGaps.push(...(industryFinancial?.dataGaps || ['行业财务横向比较尚未就绪。']));
    }

    const riskAnnouncements = (snapshot.facts?.announcements || []).filter((item: any) => /(退市风险警示|终止上市)/.test(String(item.title || ''))).slice(0, 3);
    const riskEvidence = riskAnnouncements.flatMap((item: any) => (snapshot.evidence || []).filter((evidence: any) => evidence.type === 'announcement' && evidence.title === item.title).map((evidence: any) => evidence.evidenceId));
    vetoes.push({ code: 'official_listing_risk', description: `CNINFO 已检索到 ${riskAnnouncements.length} 条退市风险警示或终止上市正式公告，已触发上市风险否决项。`, triggered: riskAnnouncements.length > 0, evidenceIds: riskEvidence });
    if (riskAnnouncements.length) addSignal({ signalId: 'official_listing_risk', dimension: 'risk_disclosure', status: 'risk', severity: 'high', summary: `发现${riskAnnouncements.length}条上市风险正式披露。`, values: { count: riskAnnouncements.length }, evidenceIds: riskEvidence });
    return { template, latest, prior, signals, vetoes, dataGaps: [...new Set(dataGaps)] };
  }

  function normalizeFundamentalItems(items: unknown, evidenceSet: Set<string>, maxItems = 5) {
    if (!Array.isArray(items)) return [];
    return items.slice(0, maxItems).map((item: any) => ({
      text: sanitizeTeacherText(item?.text, 180),
      evidenceIds: Array.isArray(item?.evidenceIds) ? [...new Set<string>(item.evidenceIds.map(String).filter((id: string) => evidenceSet.has(id)))].slice(0, 6) : [],
    })).filter((item: any) => item.text && item.evidenceIds.length);
  }

  function fallbackFundamentalOpinion(snapshot: any, input: any, reason: string) {
    const positive = input.signals.filter((signal: FundamentalSignal) => ['positive', 'stable'].includes(signal.status));
    const negative = input.signals.filter((signal: FundamentalSignal) => ['deteriorating', 'risk'].includes(signal.status));
    const triggeredVetoes = input.vetoes.filter((veto: any) => veto.triggered);
    const conclusion = triggeredVetoes.length ? '基本面存在已触发的硬性风险项，需优先核验。' : negative.length ? '基本面存在需要持续核验的恶化信号。' : '当前结构化指标整体未出现明确硬性风险，但仍需结合数据缺口持续验证。';
    const toItem = (signal: FundamentalSignal) => ({ text: signal.summary, evidenceIds: signal.evidenceIds });
    return {
      agent: 'fundamental', status: 'limited', conclusion,
      confidence: { score: Math.min(65, 30 + new Set(input.signals.flatMap((signal: FundamentalSignal) => signal.evidenceIds)).size), level: 'limited', reason: `AI 解释层不可用，当前为确定性信号回退：${reason}` },
      businessModel: { summary: String(snapshot.company?.profile?.main_operation_business || '主营业务描述不足。').slice(0, 300), evidenceIds: input.signals.find((signal: FundamentalSignal) => signal.dimension === 'business_model')?.evidenceIds || [], dataGaps: input.dataGaps },
      dimensions: input.signals.map((signal: FundamentalSignal) => ({ name: signal.dimension, assessment: signal.summary, status: signal.status, evidenceIds: signal.evidenceIds })),
      positives: positive.slice(0, 5).map(toItem), negatives: negative.slice(0, 5).map(toItem), uncertainties: input.dataGaps.map((text: string) => ({ text, evidenceIds: [] })),
      deteriorationSignals: negative.map((signal: FundamentalSignal) => ({ signal: signal.summary, severity: signal.severity, evidenceIds: signal.evidenceIds })),
      vetoes: input.vetoes, evidenceIds: [...new Set(input.signals.flatMap((signal: FundamentalSignal) => signal.evidenceIds))], dataGaps: input.dataGaps,
    };
  }

  async function runFundamentalAgent(inputSymbol: string, refresh = false) {
    const symbol = normalizeAshareSymbol(inputSymbol).code;
    const cached = fundamentalAgentCache.get(symbol);
    if (!refresh && cached && cached.expiresAt > Date.now()) return { ...cached.value, agentMeta: { ...cached.value.agentMeta, source: 'cache' } };
    const [snapshot, industryFinancialResult] = await Promise.all([buildStockFactSnapshot(symbol), buildIndustryFinancialPercentiles(symbol)]);
    const industryFinancial = buildIndustryFinancialComparison(symbol, industryFinancialResult);
    const enrichedSnapshot = { ...snapshot, evidence: [...(snapshot.evidence || []), ...industryFinancial.evidence] };
    const input = buildFundamentalSignals(enrichedSnapshot, industryFinancial);
    const evidenceSet = new Set<string>((enrichedSnapshot.evidence || []).map((item: any) => String(item.evidenceId)));
    const evidenceCatalog = (enrichedSnapshot.evidence || []).filter((item: any) => input.signals.some((signal: FundamentalSignal) => signal.evidenceIds.includes(item.evidenceId))).map((item: any) => ({ evidenceId: item.evidenceId, title: item.title, value: item.value, period: item.period, source: item.source, verification: item.verification }));
    let opinion: any;
    let aiStatus: 'completed' | 'fallback' = 'completed';
    try {
      const raw = await callAI(`你是个股基本面研究 Agent。只解释输入中的结构化事实与确定性信号，不搜索新事实、不做估值、不预测股价、不提供买卖建议。\n必须区分普通非金融企业与银行；银行不得使用经营现金流/利润或普通企业资产负债率评价经营质量。\n结论应同时说明支持证据、反证和数据缺口。所有事实判断必须引用 evidenceCatalog 中存在的 evidenceId；没有证据只能放入 uncertainties。\n不要把单期波动直接写成持续趋势，不要把第三方结构化数据写成已由官方原文核验。只有输入明确提供历史或行业比较时才能使用“较高、较低、偏高、偏低、压力较大、稳健”等比较性评价；只有单期占比时必须只陈述数值及待验证项。\n严格输出 JSON：{"conclusion":"","confidence":{"score":0,"level":"high|medium|limited","reason":""},"businessModel":{"summary":"","evidenceIds":[],"dataGaps":[]},"dimensions":[{"name":"growth|profit_quality|cash_quality|resilience|business_model","assessment":"","status":"improving|stable|mixed|deteriorating|risk|data_insufficient","evidenceIds":[]}],"positives":[{"text":"","evidenceIds":[]}],"negatives":[{"text":"","evidenceIds":[]}],"uncertainties":[{"text":"","evidenceIds":[]}],"deteriorationSignals":[{"signal":"","severity":"low|medium|high","evidenceIds":[]}]}`,
        JSON.stringify({ symbol, company: snapshot.company, template: input.template, latestPeriod: input.latest?.period, comparisonPeriod: input.prior?.period, deterministicSignals: input.signals, vetoes: input.vetoes, dataGaps: input.dataGaps, evidenceCatalog }), 0.1, 3_500);
      const parsed = parseAIJson(raw);
      const confidenceScore = Math.max(0, Math.min(100, Number(parsed?.confidence?.score) || 0));
      const dimensions = Array.isArray(parsed?.dimensions) ? parsed.dimensions.slice(0, 6).map((item: any) => ({ name: sanitizeTeacherText(item?.name, 40), assessment: sanitizeTeacherText(item?.assessment, 220), status: String(item?.status || 'data_insufficient'), evidenceIds: Array.isArray(item?.evidenceIds) ? [...new Set<string>(item.evidenceIds.map(String).filter((id: string) => evidenceSet.has(id)))].slice(0, 8) : [] })).filter((item: any) => item.name && item.assessment) : [];
      const positives = normalizeFundamentalItems(parsed?.positives, evidenceSet);
      const negatives = normalizeFundamentalItems(parsed?.negatives, evidenceSet);
      const uncertainties = Array.isArray(parsed?.uncertainties) ? parsed.uncertainties.slice(0, 5).map((item: any) => ({ text: sanitizeTeacherText(item?.text, 180), evidenceIds: Array.isArray(item?.evidenceIds) ? item.evidenceIds.map(String).filter((id: string) => evidenceSet.has(id)) : [] })).filter((item: any) => item.text) : [];
      const deteriorationSignals = Array.isArray(parsed?.deteriorationSignals) ? parsed.deteriorationSignals.slice(0, 5).map((item: any) => ({ signal: sanitizeTeacherText(item?.signal, 180), severity: ['low', 'medium', 'high'].includes(item?.severity) ? item.severity : 'medium', evidenceIds: Array.isArray(item?.evidenceIds) ? item.evidenceIds.map(String).filter((id: string) => evidenceSet.has(id)) : [] })).filter((item: any) => item.signal && item.evidenceIds.length) : [];
      const citedIds = [...new Set<string>([...dimensions, ...positives, ...negatives, ...deteriorationSignals].flatMap((item: any) => item.evidenceIds))];
      const businessIds = Array.isArray(parsed?.businessModel?.evidenceIds) ? parsed.businessModel.evidenceIds.map(String).filter((id: string) => evidenceSet.has(id)) : [];
      const hasTriggeredVeto = input.vetoes.some((veto: any) => veto.triggered);
      const citedFinancialEvidence = (snapshot.evidence || []).filter((item: any) => citedIds.includes(item.evidenceId) && item.type === 'financial');
      const financialVerificationLimited = citedFinancialEvidence.length > 0 && !citedFinancialEvidence.some((item: any) => item.verification === 'official_verified');
      const requestedLevel = ['high', 'medium', 'limited'].includes(parsed?.confidence?.level) ? parsed.confidence.level : 'limited';
      const confidenceLevel = financialVerificationLimited && requestedLevel === 'high' ? 'medium' : requestedLevel;
      const confidenceReason = `${sanitizeTeacherText(parsed?.confidence?.reason, 180)}${financialVerificationLimited ? ' 财务数据尚未与 CNINFO 原文逐项核验。' : ''}`.trim();
      opinion = {
        agent: 'fundamental', status: input.dataGaps.length || citedIds.length === 0 || financialVerificationLimited ? 'limited' : 'completed',
        conclusion: sanitizeTeacherText(parsed?.conclusion, 260) || '基本面结论暂不可用。',
        confidence: { score: hasTriggeredVeto ? Math.min(confidenceScore, 60) : financialVerificationLimited ? Math.min(confidenceScore, 74) : confidenceScore, level: confidenceLevel, reason: confidenceReason },
        businessModel: { summary: sanitizeTeacherText(parsed?.businessModel?.summary, 300), evidenceIds: businessIds, dataGaps: Array.isArray(parsed?.businessModel?.dataGaps) ? parsed.businessModel.dataGaps.map((item: any) => sanitizeTeacherText(item, 120)).filter(Boolean).slice(0, 5) : [] },
        dimensions, positives, negatives, uncertainties, deteriorationSignals,
        vetoes: input.vetoes, evidenceIds: [...new Set([...citedIds, ...businessIds])], dataGaps: input.dataGaps,
      };
    } catch (error: any) {
      aiStatus = 'fallback';
      console.warn(`[fundamental-agent] AI fallback for ${symbol}:`, error.message);
      opinion = fallbackFundamentalOpinion(enrichedSnapshot, input, error.message);
    }
    const value = { symbol, company: snapshot.company, deterministicSignals: input.signals, opinion, agentMeta: { generatedAt: new Date().toISOString(), source: 'live', aiStatus, promptVersion: 'fundamental-v1', snapshotGeneratedAt: snapshot.snapshotMeta.generatedAt } };
    fundamentalAgentCache.set(symbol, { expiresAt: Date.now() + (industryFinancial.status === 'warming' ? 30_000 : 15 * 60_000), value });
    return value;
  }

  const eventAgentCache = new Map<string, { expiresAt: number; value: any }>();

  function buildEventAgentInput(snapshot: any) {
    const events = Array.isArray(snapshot.events) ? snapshot.events : [];
    const activeEvents: any[] = events.filter((event: any) => event.status !== 'expired');
    const eventById = new Map<string, any>(activeEvents.map((event: any) => [String(event.eventId), event] as [string, any]));
    const evidenceIds = new Set<string>([
      ...(snapshot.evidence || []).map((item: any) => String(item.evidenceId || '')),
      ...events.flatMap((event: any) => Array.isArray(event.evidenceIds) ? event.evidenceIds.map(String) : []),
    ].filter(Boolean));
    const verifiedEvents = activeEvents.filter((event: any) => event.verification === 'official_verified' || event.verification === 'official_document_only');
    const catalysts = activeEvents.filter((event: any) => event.direction === 'positive' && event.status !== 'unconfirmed');
    const risks = activeEvents.filter((event: any) => event.direction === 'negative');
    const uncertainties = activeEvents.filter((event: any) => event.direction === 'unknown' || event.direction === 'mixed' || event.status === 'unconfirmed');
    const vetoes = activeEvents
      .filter((event: any) => ['regulatory', 'litigation'].includes(event.category) && event.direction === 'negative' && event.verification === 'official_verified')
      .map((event: any) => ({ code: event.category, description: event.title, triggered: true, evidenceIds: event.evidenceIds || [] }));
    return { events, activeEvents, eventById, evidenceIds, verifiedEvents, catalysts, risks, uncertainties, vetoes };
  }

  function normalizeEventAgentItems(items: unknown, evidenceSet: Set<string>, maxItems = 5) {
    if (!Array.isArray(items)) return [];
    return items.slice(0, maxItems).map((item: any) => ({
      text: sanitizeTeacherText(item?.text, 200),
      evidenceIds: Array.isArray(item?.evidenceIds) ? [...new Set<string>(item.evidenceIds.map(String).filter((id: string) => evidenceSet.has(id)))].slice(0, 8) : [],
    })).filter((item: any) => item.text && item.evidenceIds.length);
  }

  function fallbackEventOpinion(snapshot: any, input: ReturnType<typeof buildEventAgentInput>, reason: string) {
    const noSources = !snapshot.sourceMeta?.announcements && !snapshot.sourceMeta?.news;
    const status = noSources ? 'blocked' : 'limited';
    const eventText = (event: any) => `${event.title}（${event.status}，${event.direction}，影响期限${event.impactHorizon}）`;
    const toActiveEvent = (event: any) => ({
      eventId: event.eventId,
      conclusion: eventText(event),
      direction: event.direction,
      impactHorizon: event.impactHorizon,
      catalysts: event.direction === 'positive' ? ['事件方向被程序标记为 positive，仍需跟踪后续披露。'] : [],
      risks: event.direction === 'negative' ? ['事件方向被程序标记为 negative，需核验影响是否持续。'] : [],
      watchConditions: ['关注后续公告、事件生效日期和执行进展。'],
      evidenceIds: event.evidenceIds || [],
    });
    const dataGaps = [...new Set<string>((snapshot.dataGaps || []).map((item: unknown) => String(item)))];
    const conclusion = input.activeEvents.length
      ? `当前窗口内有 ${input.activeEvents.length} 项未过期事件，AI 解释层不可用，暂按程序标记保留事件事实。`
      : noSources
        ? '事件来源全部不可用，无法形成可核验的个股事件判断。'
        : '当前时间窗口内未发现可核验的个股事件。';
    return {
      agent: 'event', status, conclusion,
      confidence: { score: Math.min(55, 25 + input.evidenceIds.size), level: 'limited', reason: `事件 Agent 使用确定性回退：${reason}` },
      eventSummary: conclusion,
      activeEvents: input.activeEvents.slice(0, 20).map(toActiveEvent),
      catalysts: input.catalysts.slice(0, 5).map((event: any) => ({ text: eventText(event), evidenceIds: event.evidenceIds || [] })),
      risks: input.risks.slice(0, 5).map((event: any) => ({ text: eventText(event), evidenceIds: event.evidenceIds || [] })),
      positives: input.catalysts.slice(0, 5).map((event: any) => ({ text: eventText(event), evidenceIds: event.evidenceIds || [] })),
      negatives: input.risks.slice(0, 5).map((event: any) => ({ text: eventText(event), evidenceIds: event.evidenceIds || [] })),
      uncertainties: [...input.uncertainties.map((event: any) => ({ text: eventText(event), evidenceIds: event.evidenceIds || [] })), ...dataGaps.map((text) => ({ text, evidenceIds: [] }))].slice(0, 8),
      eventGaps: dataGaps,
      evidenceIds: [...input.evidenceIds], dataGaps, vetoes: input.vetoes,
    };
  }

  async function runEventAgent(inputSymbol: string, days = 180, refresh = false) {
    const symbol = normalizeAshareSymbol(inputSymbol).code;
    const cacheKey = `${symbol}:${days}`;
    const cached = eventAgentCache.get(cacheKey);
    if (!refresh && cached && cached.expiresAt > Date.now()) return { ...cached.value, agentMeta: { ...cached.value.agentMeta, source: 'cache' } };
    const snapshot = await buildStockEventSnapshot(symbol, days);
    const input = buildEventAgentInput(snapshot);
    const dataGaps: string[] = [...new Set<string>((snapshot.dataGaps || []).map((item: unknown) => String(item)))];
    const evidenceSet = input.evidenceIds;
    const evidenceCatalog = (snapshot.evidence || []).map((item: any) => ({
      evidenceId: String(item.evidenceId), title: item.title, value: item.value, period: item.period, source: item.source, sourceUrl: item.sourceUrl, publishedAt: item.publishedAt, verification: item.verification,
    })).filter((item: any) => evidenceSet.has(item.evidenceId));
    if (!input.activeEvents.length) {
      const noSources = !snapshot.sourceMeta?.announcements && !snapshot.sourceMeta?.news;
      const opinion = fallbackEventOpinion(snapshot, input, noSources ? '所有事件来源不可用。' : '当前窗口没有可核验事件，不调用 AI。');
      const value = { symbol, period: snapshot.period, eventSnapshot: { events: snapshot.events, dataGaps: snapshot.dataGaps, snapshotMeta: snapshot.snapshotMeta }, deterministicEvents: input.activeEvents, opinion, agentMeta: { generatedAt: new Date().toISOString(), source: 'live', aiStatus: 'not_requested', promptVersion: 'event-v1', snapshotGeneratedAt: snapshot.snapshotMeta.generatedAt } };
      eventAgentCache.set(cacheKey, { expiresAt: Date.now() + 15 * 60_000, value });
      return value;
    }
    let opinion: any;
    let aiStatus: 'completed' | 'fallback' = 'completed';
    try {
      const raw = await callAI(
        '你是个股事件 Agent。只解释输入中的冻结事件、公告原文元数据和证据，不搜索新事实、不补充公告没有的数字、不预测股价、不提供买卖指令或仓位。事件的 category、direction、impactHorizon、status 和 eventId 由程序确定，不得改写。所有事实判断必须引用 evidenceCatalog 中存在的 evidenceId；没有证据只能放入 uncertainties。未经核验的传闻必须保留不确定性，不得写成已确认事实。严格输出 JSON：{"eventSummary":"","confidence":{"score":0,"level":"high|medium|limited","reason":""},"activeEvents":[{"eventId":"","conclusion":"","catalysts":[],"risks":[],"watchConditions":[],"evidenceIds":[]}],"catalysts":[{"text":"","evidenceIds":[]}],"risks":[{"text":"","evidenceIds":[]}],"uncertainties":[{"text":"","evidenceIds":[]}]}' ,
        JSON.stringify({
          symbol,
          period: snapshot.period,
          events: input.activeEvents,
          eventHandlingRule: 'impactScope 为 industry 或 policy 的事件仅代表行业/政策层线索。除非输入存在公司正式披露或官方核验的直接传导证据，不得表述为公司已发生事实，也不得单独作为否决或买卖依据。',
          dataGaps,
          evidenceCatalog,
        }),
        0.1,
        3_500,
      );
      const parsed = parseAIJson(raw);
      const activeEvents = Array.isArray(parsed?.activeEvents) ? parsed.activeEvents.slice(0, 20).map((item: any) => {
        const event = input.eventById.get(String(item?.eventId));
        if (!event) return null;
        const evidenceIds = Array.isArray(item?.evidenceIds) ? [...new Set<string>(item.evidenceIds.map(String).filter((id: string) => evidenceSet.has(id)))].slice(0, 8) : [];
        return { eventId: event.eventId, conclusion: sanitizeTeacherText(item?.conclusion, 240) || event.title, direction: event.direction, impactHorizon: event.impactHorizon, catalysts: Array.isArray(item?.catalysts) ? item.catalysts.map((value: unknown) => sanitizeTeacherText(value, 120)).filter(Boolean).slice(0, 3) : [], risks: Array.isArray(item?.risks) ? item.risks.map((value: unknown) => sanitizeTeacherText(value, 120)).filter(Boolean).slice(0, 3) : [], watchConditions: Array.isArray(item?.watchConditions) ? item.watchConditions.map((value: unknown) => sanitizeTeacherText(value, 120)).filter(Boolean).slice(0, 3) : [], evidenceIds };
      }).filter(Boolean) : [];
      const catalysts = normalizeEventAgentItems(parsed?.catalysts, evidenceSet);
      const risks = normalizeEventAgentItems(parsed?.risks, evidenceSet);
      const uncertainties = normalizeEventAgentItems(parsed?.uncertainties, evidenceSet);
      const citedIds = [...new Set<string>([...activeEvents, ...catalysts, ...risks, ...uncertainties].flatMap((item: any) => item.evidenceIds || []))];
      const requestedLevel = ['high', 'medium', 'limited'].includes(parsed?.confidence?.level) ? parsed.confidence.level : 'limited';
      const hasUnverified = input.activeEvents.some((event: any) => event.verification === 'unverified' || event.status === 'unconfirmed');
      const confidenceLevel = dataGaps.length || hasUnverified || !citedIds.length ? 'limited' : requestedLevel === 'high' ? 'medium' : requestedLevel;
      const confidenceScore = Math.max(0, Math.min(confidenceLevel === 'limited' ? 65 : 85, Number(parsed?.confidence?.score) || 0));
      opinion = {
        agent: 'event', status: dataGaps.length || !citedIds.length ? 'limited' : 'completed',
        conclusion: sanitizeTeacherText(parsed?.eventSummary, 280) || '事件解释暂不可用。',
        confidence: { score: confidenceScore, level: confidenceLevel, reason: sanitizeTeacherText(parsed?.confidence?.reason, 180) || '置信度由来源核验状态、事件时效性和证据引用共同约束。' },
        eventSummary: sanitizeTeacherText(parsed?.eventSummary, 280) || '事件解释暂不可用。',
        activeEvents, catalysts, risks,
        positives: catalysts, negatives: risks, uncertainties,
        eventGaps: dataGaps, evidenceIds: citedIds, dataGaps, vetoes: input.vetoes,
      };
    } catch (error: any) {
      aiStatus = 'fallback';
      console.warn(`[event-agent] AI fallback for ${symbol}:`, error.message);
      opinion = fallbackEventOpinion(snapshot, input, error.message);
    }
    const value = {
      symbol, period: snapshot.period,
      eventSnapshot: { events: snapshot.events, dataGaps: snapshot.dataGaps, snapshotMeta: snapshot.snapshotMeta },
      deterministicEvents: input.activeEvents, opinion,
      agentMeta: { generatedAt: new Date().toISOString(), source: 'live', aiStatus, promptVersion: 'event-v1', snapshotGeneratedAt: snapshot.snapshotMeta.generatedAt, eventVersion: snapshot.snapshotMeta.eventVersion },
    };
    eventAgentCache.set(cacheKey, { expiresAt: Date.now() + 15 * 60_000, value });
    return value;
  }

  const sentimentAgentCache = new Map<string, { expiresAt: number; value: any }>();

  function buildSentimentAgentInput(snapshot: any) {
    const events = Array.isArray(snapshot.events) ? snapshot.events : [];
    const evidenceIds = new Set<string>([
      ...(snapshot.evidenceIds || []).map(String),
      ...(snapshot.evidence || []).map((item: any) => String(item.evidenceId || '')),
      ...events.flatMap((event: any) => Array.isArray(event.evidenceIds) ? event.evidenceIds.map(String) : []),
    ].filter(Boolean));
    return { snapshot, events, evidenceIds };
  }

  function fallbackSentimentOpinion(snapshot: any, input: ReturnType<typeof buildSentimentAgentInput>, reason: string) {
    const noSources = !snapshot.sourceMeta?.eventSnapshot && !snapshot.sourceMeta?.heat;
    const status = noSources ? 'blocked' : 'limited';
    const positiveEvents = input.events.filter((event: any) => event.direction === 'positive');
    const negativeEvents = input.events.filter((event: any) => event.direction === 'negative');
    const toItem = (event: any) => ({ text: `${event.title}（来源：${event.verification}）`, evidenceIds: event.evidenceIds || [] });
    const dataGaps = [...new Set<string>((snapshot.dataGaps || []).map((item: unknown) => String(item)))];
    const conclusion = noSources
      ? '舆情来源全部不可用，无法形成个股舆情判断。'
      : !input.events.length
        ? '当前窗口内没有明确匹配个股的事件或新闻，不能据此判断市场情绪。'
        : `当前窗口内有 ${input.events.length} 项关联事件；情绪方向为 ${snapshot.tone}，但市场反应仍不可评估。`;
    return {
      agent: 'sentiment', status, conclusion,
      confidence: { score: Math.min(55, 25 + input.evidenceIds.size), level: 'limited', reason: `舆情 Agent 使用确定性回退：${reason}` },
      attention: snapshot.attention, tone: snapshot.tone, disagreement: snapshot.disagreement, evidenceDirectionDisagreement: snapshot.evidenceDirectionDisagreement, communityViewpointDisagreement: snapshot.communityViewpointDisagreement, viewpointScope: snapshot.viewpointScope, sourceQuality: snapshot.sourceQuality, propagationQuality: snapshot.propagationQuality, eventReaction: snapshot.eventReaction,
      catalysts: positiveEvents.slice(0, 5).map(toItem), risks: negativeEvents.slice(0, 5).map(toItem),
      positives: positiveEvents.slice(0, 5).map(toItem), negatives: negativeEvents.slice(0, 5).map(toItem),
      uncertainties: dataGaps.map((text) => ({ text, evidenceIds: [] })),
      evidenceIds: [...input.evidenceIds], dataGaps, vetoes: [],
    };
  }

  async function runSentimentAgent(inputSymbol: string, days = 30, refresh = false) {
    const symbol = normalizeAshareSymbol(inputSymbol).code;
    const cacheKey = `${symbol}:${days}`;
    const cached = sentimentAgentCache.get(cacheKey);
    if (!refresh && cached && cached.expiresAt > Date.now()) return { ...cached.value, agentMeta: { ...cached.value.agentMeta, source: 'cache' } };
    const snapshot = await buildStockSentimentSnapshot(symbol, days);
    const input = buildSentimentAgentInput(snapshot);
    const dataGaps: string[] = [...new Set<string>((snapshot.dataGaps || []).map((item: unknown) => String(item)))];
    if (!input.evidenceIds.size && !snapshot.sourceMeta?.eventSnapshot && !snapshot.sourceMeta?.heat) {
      const opinion = fallbackSentimentOpinion(snapshot, input, '所有舆情来源不可用。');
      const value = { symbol, period: snapshot.period, sentimentSnapshot: snapshot, deterministicSentiment: { attention: snapshot.attention, tone: snapshot.tone, disagreement: snapshot.disagreement, evidenceDirectionDisagreement: snapshot.evidenceDirectionDisagreement, communityViewpointDisagreement: snapshot.communityViewpointDisagreement, viewpointScope: snapshot.viewpointScope, sourceQuality: snapshot.sourceQuality, propagationQuality: snapshot.propagationQuality, eventReaction: snapshot.eventReaction }, opinion, agentMeta: { generatedAt: new Date().toISOString(), source: 'live', aiStatus: 'not_requested', promptVersion: 'sentiment-v2', snapshotGeneratedAt: snapshot.snapshotMeta.generatedAt, sentimentVersion: snapshot.snapshotMeta.sentimentVersion } };
      sentimentAgentCache.set(cacheKey, { expiresAt: Date.now() + 15 * 60_000, value });
      return value;
    }
    const evidenceSet = input.evidenceIds;
    const evidenceCatalog = (snapshot.evidence || []).map((item: any) => ({ evidenceId: String(item.evidenceId), title: item.title, value: item.value, period: item.period, source: item.source, sourceUrl: item.sourceUrl, publishedAt: item.publishedAt, verification: item.verification })).filter((item: any) => evidenceSet.has(item.evidenceId));
    let opinion: any;
    let aiStatus: 'completed' | 'fallback' = 'completed';
    try {
      const raw = await callAI(
        '你是个股舆情与市场反应 Agent。只解释输入中的冻结舆情快照、事件证据和确定性字段，不搜索新事实、不把单点热度写成上升趋势、不把讨论热度写成资金流入、不把市场反应不可评估写成已确认，也不预测股价、不提供买卖指令或仓位。attention、tone、disagreement、evidenceDirectionDisagreement、communityViewpointDisagreement、viewpointScope、sourceQuality、propagationQuality、eventReaction 由程序确定，不得改写。communityViewpointDisagreement 为 unavailable 时，必须说明当前未接入帖子或评论立场数据，不能声称已经识别社区观点分歧。所有事实判断必须引用 evidenceCatalog 中存在的 evidenceId；没有证据只能放在 uncertainties。严格输出 JSON：{"eventSummary":"","confidence":{"score":0,"level":"high|medium|limited","reason":""},"catalysts":[{"text":"","evidenceIds":[]}],"risks":[{"text":"","evidenceIds":[]}],"uncertainties":[{"text":"","evidenceIds":[]}]}' ,
        JSON.stringify({ symbol, period: snapshot.period, deterministicSentiment: { attention: snapshot.attention, tone: snapshot.tone, disagreement: snapshot.disagreement, evidenceDirectionDisagreement: snapshot.evidenceDirectionDisagreement, communityViewpointDisagreement: snapshot.communityViewpointDisagreement, viewpointScope: snapshot.viewpointScope, sourceQuality: snapshot.sourceQuality, propagationQuality: snapshot.propagationQuality, eventReaction: snapshot.eventReaction, metrics: snapshot.metrics }, events: input.events, eventReactions: snapshot.eventReactions || [], dataGaps, evidenceCatalog }),
        0.1,
        3_000,
      );
      const parsed = parseAIJson(raw);
      const catalysts = normalizeEventAgentItems(parsed?.catalysts, evidenceSet);
      const risks = normalizeEventAgentItems(parsed?.risks, evidenceSet);
      const uncertainties = normalizeEventAgentItems(parsed?.uncertainties, evidenceSet);
      const citedIds = [...new Set<string>([...catalysts, ...risks, ...uncertainties].flatMap((item: any) => item.evidenceIds || []))];
      const requestedLevel = ['high', 'medium', 'limited'].includes(parsed?.confidence?.level) ? parsed.confidence.level : 'limited';
      const confidenceLevel = dataGaps.length || !citedIds.length ? 'limited' : requestedLevel === 'high' ? 'medium' : requestedLevel;
      const confidenceScore = Math.max(0, Math.min(confidenceLevel === 'limited' ? 65 : 85, Number(parsed?.confidence?.score) || 0));
      const eventSummary = sanitizeTeacherText(parsed?.eventSummary, 280) || '舆情解释暂不可用。';
      opinion = {
        agent: 'sentiment', status: dataGaps.length || !citedIds.length ? 'limited' : 'completed', conclusion: eventSummary, eventSummary,
        confidence: { score: confidenceScore, level: confidenceLevel, reason: sanitizeTeacherText(parsed?.confidence?.reason, 180) || '置信度由来源质量、事件方向一致性和证据完整度共同约束。' },
        attention: snapshot.attention, tone: snapshot.tone, disagreement: snapshot.disagreement, evidenceDirectionDisagreement: snapshot.evidenceDirectionDisagreement, communityViewpointDisagreement: snapshot.communityViewpointDisagreement, viewpointScope: snapshot.viewpointScope, sourceQuality: snapshot.sourceQuality, propagationQuality: snapshot.propagationQuality, eventReaction: snapshot.eventReaction,
        catalysts, risks, positives: catalysts, negatives: risks, uncertainties, evidenceIds: citedIds, dataGaps, vetoes: [],
      };
    } catch (error: any) {
      aiStatus = 'fallback';
      console.warn(`[sentiment-agent] AI fallback for ${symbol}:`, error.message);
      opinion = fallbackSentimentOpinion(snapshot, input, error.message);
    }
    const value = {
      symbol, period: snapshot.period, sentimentSnapshot: snapshot,
      deterministicSentiment: { attention: snapshot.attention, tone: snapshot.tone, disagreement: snapshot.disagreement, evidenceDirectionDisagreement: snapshot.evidenceDirectionDisagreement, communityViewpointDisagreement: snapshot.communityViewpointDisagreement, viewpointScope: snapshot.viewpointScope, sourceQuality: snapshot.sourceQuality, propagationQuality: snapshot.propagationQuality, eventReaction: snapshot.eventReaction, metrics: snapshot.metrics },
      opinion,
      agentMeta: { generatedAt: new Date().toISOString(), source: 'live', aiStatus, promptVersion: 'sentiment-v2', snapshotGeneratedAt: snapshot.snapshotMeta.generatedAt, sentimentVersion: snapshot.snapshotMeta.sentimentVersion },
    };
    sentimentAgentCache.set(cacheKey, { expiresAt: Date.now() + 15 * 60_000, value });
    return value;
  }

  const technicalMarketAgentCache = new Map<string, { expiresAt: number; value: any }>();

  function technicalMarketOpinionInput(snapshot: any) {
    const signals = Array.isArray(snapshot.signals) ? snapshot.signals : [];
    const signal = (signalId: string) => signals.find((item: any) => item.signalId === signalId) || null;
    const trendSignal = signal('trend');
    const confirmationSignal = signal('confirmation');
    const riskSignal = signal('risk');
    const environmentSignal = signal('environment');
    const relativeSignal = signal('relative_strength');
    const structureInvalidation = snapshot.structureInvalidation || { triggered: false, rules: [], evidenceIds: [] };
    const trendValue = String(trendSignal?.values?.trend || 'neutral');
    const trendDurationTradingDays = finiteNumber(trendSignal?.values?.trendDurationDays);
    const trendState = trendValue === 'bullish' && trendDurationTradingDays !== null && trendDurationTradingDays >= 2
      ? 'uptrend' : trendValue === 'bearish' && trendDurationTradingDays !== null && trendDurationTradingDays >= 2
        ? 'downtrend' : trendValue === 'neutral' ? 'range' : 'unclear';
    const marketRegimeValue = String(environmentSignal?.values?.marketRegime || 'unknown');
    const marketRegime = ['risk_on', 'neutral', 'risk_off'].includes(marketRegimeValue) ? marketRegimeValue : 'unknown';
    const relativeValue = (value: unknown) => ['strong', 'weak', 'mixed'].includes(String(value)) ? String(value) : 'unavailable';
    const relativeStrength = {
      vsMarket: relativeValue(relativeSignal?.values?.relativeToMarket),
      vsIndustry: relativeValue(relativeSignal?.values?.relativeToIndustry),
    };
    const invalidationConditions = (Array.isArray(structureInvalidation.rules) ? structureInvalidation.rules : []).map((rule: any) => String(rule.description || '')).filter(Boolean);
    const isRisk = riskSignal?.status === 'risk' || structureInvalidation.triggered === true;
    const stance = isRisk || trendState === 'downtrend'
      ? 'avoid'
      : trendSignal?.status === 'positive' && confirmationSignal?.status === 'positive'
        ? 'trend_following_candidate'
        : trendSignal?.status === 'positive'
          ? 'wait_for_confirmation'
          : 'observe';
    const entryConditions = stance === 'trend_following_candidate'
      ? ['趋势与确认信号仍为 positive，且未触发任何结构失效条件。']
      : stance === 'wait_for_confirmation'
        ? ['趋势信号保持偏强，并等待 MACD/量价确认同步改善。']
        : stance === 'avoid'
          ? ['已触发结构失效或技术风险条件；需等待确定性信号恢复后再评估。']
          : ['等待趋势、确认或市场环境形成可验证的一致信号。'];
    const allEvidenceIds = new Set<string>([
      ...(snapshot.evidence || []).map((item: any) => String(item.evidenceId || '')),
      ...signals.flatMap((item: any) => Array.isArray(item.evidenceIds) ? item.evidenceIds.map(String) : []),
      ...(snapshot.keyLevels?.evidenceIds || []).map(String),
      ...(structureInvalidation.evidenceIds || []).map(String),
      ...(Array.isArray(structureInvalidation.rules) ? structureInvalidation.rules.flatMap((rule: any) => Array.isArray(rule.evidenceIds) ? rule.evidenceIds.map(String) : []) : []),
    ].filter(Boolean));
    return {
      signals, trendSignal, confirmationSignal, riskSignal, environmentSignal, relativeSignal, structureInvalidation,
      trend: { state: trendState, durationTradingDays: trendDurationTradingDays, evidenceIds: trendSignal?.evidenceIds || [] },
      marketRegime, relativeStrength,
      keyLevels: snapshot.keyLevels || { evidenceIds: [] },
      execution: { stance, entryConditions, invalidationConditions },
      allEvidenceIds,
    };
  }

  function normalizeTechnicalMarketItems(items: unknown, evidenceSet: Set<string>, maxItems = 5) {
    if (!Array.isArray(items)) return [];
    return items.slice(0, maxItems).map((item: any) => ({
      text: sanitizeTeacherText(item?.text, 180),
      evidenceIds: Array.isArray(item?.evidenceIds) ? [...new Set<string>(item.evidenceIds.map(String).filter((id: string) => evidenceSet.has(id)))].slice(0, 8) : [],
    })).filter((item: any) => item.text && item.evidenceIds.length);
  }

  function fallbackTechnicalMarketOpinion(input: ReturnType<typeof technicalMarketOpinionInput>, dataGaps: string[], reason: string) {
    const positive = input.signals.filter((signal: TechnicalMarketSignal) => ['positive', 'stable'].includes(signal.status));
    const negative = input.signals.filter((signal: TechnicalMarketSignal) => signal.status === 'risk');
    const triggered = (input.structureInvalidation.rules || []).filter((rule: any) => rule.triggered);
    const toItem = (item: any) => ({ text: String(item.summary || item.description || ''), evidenceIds: item.evidenceIds || [] });
    const conclusion = triggered.length
      ? `当前技术结构已有 ${triggered.length} 项失效条件触发，应以风险控制和后续日线验证为先。`
      : input.trend.state === 'uptrend' && input.confirmationSignal?.status === 'positive'
        ? '趋势与动量信号同向，但仍须以关键位和结构失效条件持续验证。'
        : input.trend.state === 'downtrend'
          ? '均线结构偏弱，当前不具备趋势跟随的确定性条件。'
          : '趋势、动量或市场环境尚未形成充分一致，维持观察并等待可验证条件。';
    return {
      agent: 'technical_market', status: 'limited', conclusion,
      confidence: { score: Math.min(65, 35 + input.allEvidenceIds.size), level: 'limited', reason: `AI 解释层不可用，以下为确定性信号回退：${reason}` },
      trend: input.trend, marketRegime: input.marketRegime, relativeStrength: input.relativeStrength, keyLevels: input.keyLevels, execution: input.execution,
      positives: positive.slice(0, 5).map(toItem),
      negatives: [...negative, ...triggered].slice(0, 5).map(toItem),
      uncertainties: dataGaps.map((text) => ({ text, evidenceIds: [] })),
      evidenceIds: [...input.allEvidenceIds], dataGaps,
      vetoes: triggered.map((rule: any) => ({ code: rule.ruleId, description: rule.description, triggered: true, evidenceIds: rule.evidenceIds || [] })),
    };
  }

  async function runTechnicalMarketAgent(inputSymbol: string, refresh = false) {
    const symbol = normalizeAshareSymbol(inputSymbol).code;
    const cached = technicalMarketAgentCache.get(symbol);
    if (!refresh && cached && cached.expiresAt > Date.now()) return { ...cached.value, agentMeta: { ...cached.value.agentMeta, source: 'cache' } };

    const snapshot = await buildTechnicalMarketSignals(symbol);
    const input = technicalMarketOpinionInput(snapshot);
    const dataGaps: string[] = [...new Set<string>((snapshot.dataGaps || []).map((item: unknown) => String(item)))];
    const evidenceCatalog = (snapshot.evidence || []).map((item: any) => ({ evidenceId: String(item.evidenceId), title: item.title, value: item.value, period: item.period, source: item.source, verification: item.verification })).filter((item: any) => input.allEvidenceIds.has(item.evidenceId));
    let opinion: any;
    let aiStatus: 'completed' | 'fallback' = 'completed';
    try {
      const raw = await callAI(
        `你是个股技术与市场 Agent。你只能解释输入中冻结的确定性信号、关键位、结构失效条件和数据缺口；不得重新计算指标、搜索新事实、预测股价、给出买卖指令或具体仓位。\n所有事实判断必须引用 evidenceCatalog 中存在的 evidenceId；没有证据的内容只能放在 uncertainties。关键位与结构失效规则由程序定义，你不得改写数值、补充新规则或声称已触发未触发的条件。市场环境仅是背景，不等于个股机会；相对行业不可用时必须保持 unavailable。\n严格输出 JSON：{"conclusion":"","confidence":{"score":0,"level":"high|medium|limited","reason":""},"positives":[{"text":"","evidenceIds":[]}],"negatives":[{"text":"","evidenceIds":[]}],"uncertainties":[{"text":"","evidenceIds":[]}]}`,
        JSON.stringify({ symbol, period: snapshot.period, deterministicSignals: input.signals, keyLevels: input.keyLevels, structureInvalidation: input.structureInvalidation, execution: input.execution, dataGaps, evidenceCatalog }),
        0.1,
        3_000,
      );
      const parsed = parseAIJson(raw);
      const positives = normalizeTechnicalMarketItems(parsed?.positives, input.allEvidenceIds);
      const negatives = normalizeTechnicalMarketItems(parsed?.negatives, input.allEvidenceIds);
      const uncertainties = Array.isArray(parsed?.uncertainties) ? parsed.uncertainties.slice(0, 5).map((item: any) => ({ text: sanitizeTeacherText(item?.text, 180), evidenceIds: Array.isArray(item?.evidenceIds) ? item.evidenceIds.map(String).filter((id: string) => input.allEvidenceIds.has(id)).slice(0, 8) : [] })).filter((item: any) => item.text) : [];
      const citedIds = [...new Set<string>([...positives, ...negatives, ...uncertainties].flatMap((item: any) => item.evidenceIds))];
      const requestedLevel = ['high', 'medium', 'limited'].includes(parsed?.confidence?.level) ? parsed.confidence.level : 'limited';
      const confidenceLevel = dataGaps.length || snapshot.inputMeta?.technical?.sourceMeta?.adjust !== 'qfq' ? 'limited' : requestedLevel === 'high' ? 'medium' : requestedLevel;
      const confidenceScore = Math.max(0, Math.min(confidenceLevel === 'limited' ? 65 : 85, Number(parsed?.confidence?.score) || 0));
      const triggeredRules = (input.structureInvalidation.rules || []).filter((rule: any) => rule.triggered);
      const parsedConclusion = sanitizeTeacherText(parsed?.conclusion, 260);
      const conclusion = input.trend.state === 'unclear'
        ? '当前趋势结构持续时间不足，单日变化不能构成趋势判断，应等待后续交易日确认。'
        : parsedConclusion || '技术与市场结论暂不可用。';
      opinion = {
        agent: 'technical_market', status: dataGaps.length || citedIds.length === 0 ? 'limited' : 'completed',
        conclusion,
        confidence: { score: confidenceScore, level: confidenceLevel, reason: sanitizeTeacherText(parsed?.confidence?.reason, 180) || '置信度由日线质量、信号一致性及市场/行业数据可用性共同约束。' },
        trend: input.trend, marketRegime: input.marketRegime, relativeStrength: input.relativeStrength, keyLevels: input.keyLevels, execution: input.execution,
        positives, negatives, uncertainties, evidenceIds: citedIds, dataGaps,
        vetoes: triggeredRules.map((rule: any) => ({ code: rule.ruleId, description: rule.description, triggered: true, evidenceIds: rule.evidenceIds || [] })),
      };
    } catch (error: any) {
      aiStatus = 'fallback';
      console.warn(`[technical-market-agent] AI fallback for ${symbol}:`, error.message);
      opinion = fallbackTechnicalMarketOpinion(input, dataGaps, error.message);
    }
    const value = {
      symbol, period: snapshot.period, deterministicSignals: input.signals, keyLevels: input.keyLevels, structureInvalidation: input.structureInvalidation,
      opinion,
      agentMeta: { generatedAt: new Date().toISOString(), source: 'live', aiStatus, promptVersion: 'technical-market-v1', signalVersion: snapshot.snapshotMeta?.signalVersion, structureRuleVersion: snapshot.structureRuleSet?.version, snapshotGeneratedAt: snapshot.snapshotMeta?.generatedAt },
    };
    technicalMarketAgentCache.set(symbol, { expiresAt: Date.now() + 15 * 60_000, value });
    return value;
  }

  /**
   * 用户主动点击个股分析页刷新时使用：仅清理会变化的行情、公告聚合、指标和 AI 快照。
   * 已下载的公告原文/PDF 解析结果不在此处清除，原文内容不可变，保留它可避免重复下载。
   */
  function invalidateStockResearchCaches(inputSymbol: string) {
    const symbol = normalizeAshareSymbol(inputSymbol).code;
    const eventKeys = [`${symbol}:180`, `${symbol}:30`];
    stockQuoteSnapshotCache.delete(symbol);
    stockEventSnapshotCache.delete(`${symbol}:180`);
    stockSentimentSnapshotCache.delete(`${symbol}:30`);
    stockValuationSnapshotCache.delete(symbol);
    valuationAgentCache.delete(symbol);
    stockRiskSnapshotCache.delete(symbol);
    stockManagerSnapshotCache.delete(symbol);
    cioManagerAgentCache.delete(symbol);
    stockBusinessSegmentsCache.delete(symbol);
    xueqiuProfileCache.delete(symbol);
    stockTechnicalCache.delete(symbol);
    stockIndustryBenchmarkCache.delete(symbol);
    stockRelativeStrengthCache.delete(symbol);
    technicalMarketSignalCache.delete(symbol);
    stockFactSnapshotCache.delete(symbol);
    stockIndustryChainMappingCache.delete(symbol);
    stockIndustryChainSnapshotCache.delete(symbol);
    industryChainAgentCache.delete(symbol);
    fundamentalAgentCache.delete(symbol);
    riskCounterAgentCache.delete(symbol);
    technicalMarketAgentCache.delete(symbol);
    eventKeys.forEach((key) => eventAgentCache.delete(key));
    eventKeys.forEach((key) => sentimentAgentCache.delete(key));

    // 市场环境在个股技术与事件判断中被复用；主动刷新时也应重新请求。
    const marketCacheState = fetchMarketData as any;
    marketCacheState._dataCache = null;
  }

  function findSectorInsight(sectorName: string, fallback: string, watchPoints: string[], relatedNews: Array<{ title: string }> = []) {
    const report = morningReportCache?.data;
    const stories = Array.isArray(report?.stories) ? report.stories : [];
    const target = normalizeSectorKey(sectorName);
    let matched: any = null;
    let matchQuality: 'exact' | 'related' | 'weak' | 'none' = 'none';
    for (const story of stories) {
      const related = Array.isArray(story?.relatedSectors) ? story.relatedSectors : [];
      if (related.some((name: string) => normalizeSectorKey(name) === target)) { matched = story; matchQuality = 'exact'; break; }
      if (related.some((name: string) => normalizeSectorKey(name).includes(target) || target.includes(normalizeSectorKey(name)))) { matched = story; matchQuality = 'related'; }
    }
    if (!matched) return {
      whatHappened: fallback,
      matchQuality,
      evidenceStatus: relatedNews.length ? 'related_news' : 'market_only',
      supportingEvidence: relatedNews.slice(0, 2).map((item) => `关联新闻：${item.title}`),
      counterEvidence: relatedNews.length ? ['关联新闻尚未形成可验证的直接催化证据。'] : [],
      confidence: { level: 'limited', explanation: relatedNews.length ? '已找到关联新闻线索，但尚未匹配到可验证的直接驱动证据。' : '当前仅观察到行情变化，尚未匹配到充分驱动证据。' },
      observationIndicators: watchPoints,
      generatedAt: report?.timestamp || null,
    };
    const reasoning = matched.reasoning || {};
    const professional = matched.professional || {};
    const supportingEvidence = [...new Set([...(reasoning.supportingEvidence || []), ...(professional.supportingEvidence || [])])].slice(0, 3);
    const counterEvidence = [...new Set([...(reasoning.counterEvidence || []), ...(professional.counterLogic || [])])].slice(0, 3);
    const confidence = professional.confidence || { level: reasoning.confidenceLevel || 'limited', explanation: reasoning.uncertainty || '' };
    return {
      whatHappened: String(matched.what || fallback), matchQuality,
      evidenceStatus: supportingEvidence.length ? 'confirmed' : 'insufficient',
      supportingEvidence, counterEvidence,
      confidence: { level: confidence.level || 'limited', explanation: String(confidence.explanation || reasoning.uncertainty || '') },
      observationIndicators: (professional.observationIndicators || watchPoints).slice(0, 3),
      generatedAt: report?.timestamp || null,
    };
  }

  const SECTOR_DETAIL_CACHE_TTL = 15 * 60 * 1000;
  const sectorDetailCache = new Map<string, { expiresAt: number; value: any }>();

  app.get('/api/sector-detail', async (req, res) => {
    try {
      const sn = String(req.query.sectorName || ''); if(!sn) return res.status(400).json({error:'sectorName is required'});
      const cached = sectorDetailCache.get(sn);
      if (cached && cached.expiresAt > Date.now()) return res.json(cached.value);
      const md = await fetchMarketData(); const sec = (md.sectors||[]).find(s => s.name === sn); const pct = Number(sec?.changePercent)||0;
      
      // Get real stock data
      const bkCode = (sec && sec.code) ? String(sec.code) : (req.query.sectorId ? String(req.query.sectorId).replace(/^(industry|concept)-/, '') : '');
      const [breadth, klineData, sectorNews] = await Promise.all([
        bkCode ? fetchSectorBreadth(bkCode, { full: true }) : Promise.resolve(null),
        bkCode ? fetchSectorKline(bkCode) : Promise.resolve(null),
        fetchEastMoneySectorNews(sn),
      ]);
      var allStocks = breadth?.stocks || [];
      const rankPercentile = (value: number | null, field: 'changePercent' | 'turnoverAmount' | 'turnoverRate' | 'totalMarketCap') => {
        if (value === null) return 0;
        const available = allStocks.map((stock) => stock[field]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
        if (!available.length) return 0;
        return available.filter((v) => v <= value).length / available.length;
      };
      const strength = [...allStocks].map((stock) => ({
        ...stock,
        score: rankPercentile(stock.changePercent, 'changePercent') * 0.4
          + rankPercentile(stock.turnoverAmount, 'turnoverAmount') * 0.3
          + rankPercentile(stock.turnoverRate, 'turnoverRate') * 0.2
          + rankPercentile(stock.totalMarketCap, 'totalMarketCap') * 0.1,
        reason: '涨幅、成交、换手与市值在板块内综合靠前',
      })).sort((a, b) => b.score - a.score).slice(0, 3);
      const leaders = [...allStocks].sort((a, b) => (Number(b.totalMarketCap || 0) + Number(b.turnoverAmount || 0)) - (Number(a.totalMarketCap || 0) + Number(a.turnoverAmount || 0))).slice(0, 3).map((stock) => ({ ...stock, reason: '市值与成交规模位于板块前列', isLeader: true }));
      const unusual = allStocks.filter((stock) => Number(stock.volumeRatio || 0) > 3 && stock.changePercent > 0).sort((a, b) => Number(b.volumeRatio || 0) - Number(a.volumeRatio || 0)).slice(0, 3).map((stock) => ({ ...stock, reason: '量比显著放大且当日上涨' }));
      const leading = strength;
      const lagging = [...allStocks].sort((a, b) => a.changePercent - b.changePercent).slice(0, 3).map((stock) => ({ ...stock, reason: '板块内当日表现较弱' }));
      const newsItems = sectorNews.map((news) => ({ ...news, category: '行业背景', summary: news.title.slice(0, 42) }));
      var c5 = klineData ? klineData.change5d : null;
      var c20 = klineData ? klineData.change20d : null;
      var c3m = klineData ? klineData.change3m : null;
      var heatMetrics = {
        todayTurnover: klineData ? klineData.todayAmount : null,
        turnoverChangePercent: (klineData && klineData.avg20dAmount && klineData.todayAmount) ? ((klineData.todayAmount / klineData.avg20dAmount) - 1) * 100 : null,
        turnoverVs20dAvg: (klineData && klineData.avg20dAmount) ? klineData.avg20dAmount : null,
        turnoverRate: allStocks.length ? Math.round((allStocks.reduce((sum, stock) => sum + Number(stock.turnoverRate || 0), 0) / allStocks.length) * 100) / 100 : null,
        upRatio: breadth?.upStockRatio ?? null
      };
      
      // Better stage rules (use multi-period data if available)
      var stage, stageLabel;
      if (c20 !== null && c20 > 10) { stage = 'strengthening'; stageLabel = '持续走强'; }
      else if (pct > 4) { stage = 'strengthening'; stageLabel = '持续走强'; }
      else if (pct > 2) { stage = 'just_starting'; stageLabel = '刚刚启动'; }
      else if (pct > 0) { stage = 'high_volatility'; stageLabel = '高位震荡'; }
      else if (pct > -2) { stage = 'pullback'; stageLabel = '冲高回落'; }
      else if (pct > -4) { stage = 'cooling_down'; stageLabel = '逐步降温'; }
      else { stage = 'no_clear_trend'; stageLabel = '暂无明确趋势'; }
      
      const defaultWatchPoints = ['成交额是否继续放大', '上涨是否扩散', '龙头股能否保持强势'];
      const fallbackConclusion = sn + '今日' + (pct >= 0 ? '上涨' : '下跌') + Math.abs(pct).toFixed(2) + '%';
      const insight = findSectorInsight(sn, fallbackConclusion, defaultWatchPoints, sectorNews);
      if (breadth?.dataStatus !== 'available') {
        insight.counterEvidence = [...(insight.counterEvidence || []), '板块成分股数据暂不可用，无法确认上涨是否扩散。'].slice(0, 3);
      }
      const structureAvailable = breadth?.dataStatus === 'available' && breadth.sampleComplete;
      const healthPresentation = !structureAvailable
        ? 'unavailable'
        : (breadth.upStockRatio ?? 50) >= 70
          ? 'broad_rise'
          : (breadth.upStockRatio ?? 50) <= 30
            ? 'broad_fall'
            : (breadth.leaderContribution ?? 0) >= 55 ? 'concentrated' : 'divergence';
      const topGainers = [...allStocks].sort((a, b) => b.changePercent - a.changePercent).slice(0, 3);
      const evidenceSummary = {
        status: sectorNews.length ? 'related_clues' : 'market_only',
        marketFacts: [
          `板块当日${pct >= 0 ? '上涨' : '下跌'}${Math.abs(pct).toFixed(2)}%`,
          structureAvailable ? `成分股 ${breadth.upCount}/${breadth.totalCount} 上涨（${breadth.upStockRatio}%）` : `成分股覆盖 ${breadth?.sampleSize || 0}/${breadth?.totalCount || 0}，结构暂不可判断`,
          breadth?.limitUpCount != null ? `涨停成分股 ${breadth.limitUpCount} 只` : '',
        ].filter(Boolean),
        relatedClues: sectorNews.map((news) => ({ title: news.title, sourceName: news.sourceName })),
        analysisInference: insight.whatHappened ? [insight.whatHappened] : [],
        counterAndGaps: insight.counterEvidence || [],
      };
      const detailPayload = {
        sector: sn,sectorId:req.query.sectorId||'',todayChange:(pct>=0?'+':'')+pct.toFixed(2)+'%',todayChangePercent:pct,
        change5d:c5,change20d:c20,change3m:c3m,
        stage:stage,stageLabel:stageLabel,signalTags:[],signalTypes:[],
        bubbleConclusion: fallbackConclusion,
        insight,
        health: {
          status: healthPresentation,
          presentation: healthPresentation,
          upRatio: breadth?.upStockRatio ?? null,
          sampleCoverage: breadth?.sampleCoverage ?? null,
          leaderContribution: breadth?.leaderContribution ?? null,
          dispersion: breadth?.dispersion ?? null,
          limitUpCount: breadth?.limitUpCount ?? null,
          dataAsOf: md.timestamp,
        },
        constituentStats: { status: structureAvailable ? 'available' : (breadth?.dataStatus || 'unavailable'), totalCount: breadth?.totalCount || 0, loadedCount: breadth?.sampleSize || 0, upCount: breadth?.upCount || 0, downCount: breadth?.downCount || 0, flatCount: breadth?.flatCount || 0, upRatio: breadth?.upStockRatio ?? null, coverage: breadth?.sampleCoverage ?? null, limitUpCount: breadth?.limitUpCount ?? null, medianChange: breadth?.medianChange ?? null, dataError: breadth?.dataError || null, dataAsOf: md.timestamp, sourceName: '东方财富板块成分股' },
        topGainers,
        subdivisions: [],
        leadingStocks: leading, laggingStocks: lagging,
        representativeStocks: { status: allStocks.length ? (breadth?.dataStatus || 'available') : 'empty', strength, rankingRule: '涨幅 40% · 成交额 30% · 换手率 20% · 市值 10%' },
        evidenceSummary,
        healthMetrics:{ upCount: breadth?.upCount || 0, totalCount: breadth?.totalCount || 0, medianChange: breadth?.medianChange ?? null, leaderContribution: breadth?.leaderContribution ?? null, divergence: breadth?.dispersion ?? null, sampleComplete: breadth?.sampleComplete ?? false, dataStatus: breadth?.dataStatus || 'unavailable', dataError: breadth?.dataError || null },
        news:newsItems,
        heatMetrics:heatMetrics,
        watchPoints: insight.observationIndicators,
        exploreQuestions:['为什么'+sn+'今天表现突出？',sn+'现在处于什么阶段？']
      };
      sectorDetailCache.set(sn, { expiresAt: Date.now() + SECTOR_DETAIL_CACHE_TTL, value: detailPayload });
      res.json(detailPayload);
    } catch(e) { res.status(503).json({error:'生成失败'}); }
  });


  // Vercel 上静态资源由平台托管，函数只处理 /api/*，无需托管 dist。
  // Vite middleware integration for full-stack build/dev environment
  if (process.env.VERCEL) {
    // no static handling on Vercel
  } else if (process.env.NODE_ENV !== 'production') {
    const viteModuleName = 'vite';
    const { createServer: createViteServer } = await import(viteModuleName);
    const vite = await createViteServer({
      root: path.join(process.cwd(), 'frontend'),
      server: { middlewareMode: true, hmr: false, watch: null },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  if (!process.env.VERCEL) {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`[Paopao Server] Running at http://localhost:${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
    });
  }

  return app;
}

// Vercel Serverless 模式：导出 Express app 作为 handler。
// 在 Vercel 上通过 api/[...path].ts 引用；本地开发时仍由 startServer() 启动。
let cachedApp: express.Express | null = null;

export default async function vercelHandler(req: express.Request, res: express.Response) {
  if (!cachedApp) {
    cachedApp = await startServer();
  }
  return cachedApp(req, res);
}

if (!process.env.VERCEL) {
  void startServer();
}
