/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'path';
import https from 'node:https';
import http from 'node:http';
import { createServer as createViteServer } from 'vite';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const AI_MODEL = process.env.AI_MODEL || 'deepseek-v4-flash';

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
    });
  }
  return aiClient;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware for parsing JSON
  app.use(express.json());

  // API Route: AI Teacher Dialogue Chat (with history)
  app.post('/api/chat', async (req, res) => {
    try {
      const { message, history } = req.body;
      if (!message) {
        return res.status(400).json({ error: 'Message is required' });
      }

      const client = getAIClient();

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
        for (const turn of history) {
          messages.push({
            role: turn.role,
            content: turn.parts?.[0]?.text || '',
          });
        }
      }
      messages.push({ role: 'user', content: message });

      const completion = await client.chat.completions.create({
        model: AI_MODEL,
        messages,
        temperature: 0.7,
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
    try {
      const client = getAIClient();

      const prompt = `
针对今天以下A股大市数据进行一键深度研判，并用可爱的泡泡老师口吻输出一个精炼的报告（150字以内，排版美观，加粗突出重点）：
- 上证指数：3026.49点，上涨 +0.72%
- 深证成指：9730.87点，上涨 +1.25%
- 创业板指：1905.15点，上涨 +1.48%
- 异动预警：AI算力板块今日涨幅高达 +4.32%，但盘中主力大单资金出现高位松动流出（约23.5亿元），存在短线筹码震荡回撤风险。
- 接力板块：国产半导体设备、机器人具身智能放量逆势补涨，主力资金净流入积极。

请输出：
1. 【大势泡泡评】 总结今日大市涨跌性质。
2. 【泡泡异动警示】 警告AI算力板块高位筹码出逃风险。
3. 【泡泡埋伏点睛】 推荐关注半导体与机器人低吸机会。
      `;

      const completion = await client.chat.completions.create({
        model: AI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.5,
      });

      res.json({
        report: completion.choices[0]?.message?.content
          || '今日大盘震荡上行，科创指数强势领涨，建议高避题材炒作，积极低吸半导体龙头。'
      });
    } catch (error: any) {
      console.error('Error in /api/market-report:', error.message);
      res.json({
        report: '【泡泡一键解盘】\n\n🎈今日大势回暖，上证成功收复**3026点**！多头攻势积极。但**AI算力**高位筹码松动明显（主力流出），注意短线回调风险。资金有回流**半导体**与**机器人**国产替代设备板块的低位补涨态势。建议逢低吸纳高壁垒龙头股。股市有风险，投资需谨慎！'
      });
    }
  });

  // ─── Prompt Pipeline: Three-Prompt Architecture ───

  const PROMPT_1_SYSTEM = `你是一名资深市场分析师。你的职责是从数据中提炼事实摘要，但绝不进行因果推导。

请遵循以下原则：
1. 优先依据市场数据（指数、板块涨跌幅、成交额变化）判断热点
2. 新闻仅作为解释依据，不要因为新闻数量多就认为影响大
3. 输出今天最重要的 3 个市场主题
4. 判断市场情绪（乐观 / 中性 / 谨慎）
5. 不预测未来，只描述今天市场正在交易什么
6. **关键约束：evidence 字段必须只陈述客观数据事实，不能包含任何因果推导**。例如："AI算力板块上涨4.3%，成交额较昨日增长12%"而不是"表明资金正在流入"

输出严格 JSON 格式，不可夹带任何解释或评论：
{
  "marketSentiment": "乐观" | "中性" | "谨慎",
  "top3Themes": [
    {
      "theme": "主题名称",
      "confidence": "高" | "中" | "低",
      "evidence": "纯事实陈述，仅包含数字和事件，不做推导"
    }
  ],
  "keyEvents": [
    {
      "event": "事件描述",
      "impact": "对市场的影响",
      "source": "新闻来源"
    }
  ],
  "affectedSectors": [
    {
      "sector": "板块名称",
      "changePercent": "涨跌幅",
      "reason": "该板块变动的事实描述（非推导）"
    }
  ]
}`;

  const PROMPT_2_SYSTEM = `你是一名财经逻辑分析师。请基于 Prompt 1 给出的事实，建立最合理的因果链。

要求：
1. 因果必须有依据，不允许猜测
2. 如果存在多个可能原因，请按影响程度排序
3. 如果证据不足，请明确说明并降低 confidenceScore
4. 只输出事件 → 行业 → 经济 → 板块逻辑链，不输出投资建议
5. 宁可回答"证据不足"，也不要编造因果关系
6. **chainSteps 要求**：将推理过程拆分成 3-4 步的链，每步一个简短事件描述（10字以内）
7. **impact 评分**：每一步的影响力度（1-5星），5=最强影响
8. **confidenceScore 评分标准**：
   - 80-100：多源数据交叉验证一致，量价配合明显
   - 60-79：有2个以上独立数据源支持
   - 30-59：有1个数据源支持但证据有限
   - 0-29：证据不足或仅基于推测（不推荐展示）

输出 JSON：
{
  "causalChains": [
    {
      "theme": "对应的主题",
      "confidenceScore": 0-100,
      "chainSteps": [
        { "step": "第一步事件", "impact": 5 },
        { "step": "第二步影响", "impact": 4 },
        { "step": "第三步结果", "impact": 3 },
        { "step": "第四步板块表现", "impact": 4 }
      ]
    }
  ]
}`;

  const PROMPT_3_SYSTEM = `你是一位温暖亲切的财经老师"泡泡老师"。请以老师的口吻把分析结果翻译成普通人能理解的话。

你是谁：
- 你叫"泡泡老师"，对学生说话时使用"泡泡老师"自称
- 你亲切、温暖、有耐心，擅长把复杂的事情说得简单
- 你相信帮助用户理解比炫耀知识更重要

你的说话风格：
1. 像在和朋友聊天，不是在播报新闻。多用"你知道吗""今天想跟你聊聊""泡泡老师今天发现"这样自然的开头
2. **禁止列出具体指数数值** — 不得出现具体数值。用"三大指数集体下跌"、"大部分板块收涨"等概括性描述
3. 尽量不用专业术语，如果必须出现，马上用括号解释
4. 行情不好时主动安抚："没事的，市场有涨有跌才是正常的 😊"
5. 末尾加一句温暖的话或加油的话，像老师对学生说的那样
6. 不制造焦虑，不给买卖建议
7. 目标是帮助用户理解，而不是预测市场
8. **特别重要**：你的语气要温和亲切，多用"~"、"哦"、"呀"、"呢"等语气词

输出严格 JSON 格式，不可夹带任何解释或评论：
{
  "summaryText": "泡泡老师的一句话市场总结（50-80字），用聊天式的温和语气描述今日市场，禁止出现具体数值",
  "reasonBrief": "一段原因分析（100-150字），用①②③编号分成三段，继续使用温和亲切的语气解释为什么今天市场会这样"
}`;

  async function callAI(systemInstruction: string, userContent: string, temperature: number): Promise<string> {
    const client = getAIClient();
    const completion = await client.chat.completions.create({
      model: AI_MODEL,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: userContent },
      ],
      temperature,
    });
    return completion.choices[0]?.message?.content || '';
  }

  function httpGetJSON(urlStr: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const u = new URL(urlStr);
      const mod = u.protocol === 'http:' ? http : https;
      const req = mod.get(
        {
          hostname: u.hostname,
          path: u.pathname + u.search,
          headers: { 'User-Agent': 'Mozilla/5.0' },
        },
        (res: any) => {
          let data = '';
          res.on('data', (chunk: string) => (data += chunk));
          res.on('end', () => {
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

  async function fetchMarketData() {
    const WSCN_NEWS = 'https://api-one.wallstcn.com/apiv1/content/lives?channel=global-channel&limit=10';

    // A股指数：改用东方财富API（中国大陆可用，免Key）
    const indexDefs = [
      { secid: '1.000001', name: '上证指数', code: '000001' },
      { secid: '0.399001', name: '深证成指', code: '399001' },
      { secid: '0.399006', name: '创业板指', code: '399006' },
    ];

    const indexPromises = indexDefs.map(async ({ secid, name, code }) => {
      try {
        // 注意：东方财富HTTPS在此环境下会ECONNRESET，必须使用HTTP
        const data = await httpGetJSON(`http://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f44,f45,f46,f47,f170,f100`);
        const d = data?.data;
        if (!d || d.f43 === undefined) throw new Error('Empty East Money response');
        // 东方财富返回的价格是整数（如376415代表3764.15），需要除以100
        const price = d.f43 / 100;
        const changePercent = d.f170 / 100;
        return {
          name,
          code,
          price: Math.round(price * 100) / 100,
          changePercent: Math.round(changePercent * 100) / 100,
          volume: d.f47 || 0,
        };
      } catch (e: any) {
        console.error(`[fetchMarketData] East Money ${name} failed:`, e.message);
        return null;
      }
    });

    async function fetchSectors(): Promise<any[]> {
      const EM_HOSTS = [
        'push2.eastmoney.com',
        '59.push2.eastmoney.com',
        '70.push2.eastmoney.com',
        '82.push2.eastmoney.com',
        'push2his.eastmoney.com',
      ];
      const EM_PATH = '/api/qt/clist/get?pn=1&pz=20&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:90+t:2&fields=f2,f3,f4,f12,f14';
      // 注意：东方财富HTTPS在此环境下会ECONNRESET，与指数API相同原因，必须使用HTTP
      for (const host of EM_HOSTS) {
        try {
          const result = await httpGetJSON(`http://${host}${EM_PATH}`);
          return (result?.data?.diff || [])
            .map((d: any) => ({ name: d.f14, changePercent: Math.round(d.f3 * 100) / 100 }))
            .filter((s: any) => s.name && s.changePercent !== undefined)
            .sort((a: any, b: any) => b.changePercent - a.changePercent);
        } catch {
          // try next host
        }
      }
      console.warn('[fetchMarketData] all EastMoney hosts unreachable, sectors unavailable');
      return [];
    }

    const [sectors, newsResult, rawIndices] = await Promise.all([
      fetchSectors(),
      httpGetJSON(WSCN_NEWS).catch((e: any) => {
        console.error('[fetchMarketData] WallStreetCN news failed:', e.message);
        return null;
      }),
      Promise.all(indexPromises),
    ]);

    const indices = rawIndices.filter(Boolean);

    const newsHeadlines: string[] = (newsResult?.data?.items || [])
      .map((item: any) => {
        const text = (item.content || '').replace(/<[^>]*>/g, '').trim();
        const first = text.split(/[。！？\n]/)[0];
        return first || text.substring(0, 50);
      })
      .filter((t: string) => t.length > 0)
      .slice(0, 10);

    const volume = indices.reduce((sum: number, i: any) => sum + (i.volume || 0), 0);

    return {
      indices: indices.length > 0 ? indices : [],
      sectors,
      announcements: [],
      newsHeadlines: newsHeadlines.length > 0 ? newsHeadlines : ['今日财经快讯获取中，请稍后刷新'],
      volume,
      timestamp: new Date(),
    };
  }

  // POST /api/morning-report — Prompt 1 → 2 → 3 pipeline
  let morningReportCache: { data: any; timestamp: number } | null = null;
  // 调用频率控制：开发阶段3小时（10800000ms），生产环境30分钟（1800000ms）
  const REPORT_CACHE_TTL = process.env.NODE_ENV === 'production' ? 30 * 60 * 1000 : 3 * 60 * 60 * 1000;

  app.get('/api/morning-report', async (req, res) => {
    console.log(`[morning-report] incoming request, ref=${req.header('referer') || 'none'}, ua=${req.header('user-agent')?.substring(0, 40) || 'none'}`);
    const now = Date.now();
    if (morningReportCache && (now - morningReportCache.timestamp) < REPORT_CACHE_TTL) {
      console.log(`[morning-report] served from cache, data.sentiment=${morningReportCache.data.sentiment}, summaryLen=${morningReportCache.data.summaryText?.length || 0}`);
      return res.json(morningReportCache.data);
    }

    const startedAt = Date.now();
    try {
      const marketData = await fetchMarketData();
      console.log('[morning-report] step 0: market data fetched');

      const p1Input = JSON.stringify({
        indices: marketData.indices,
        sectors: marketData.sectors,
        newsHeadlines: marketData.newsHeadlines,
        totalVolume: marketData.volume,
      }, null, 2);

      const p1Raw = await callAI(PROMPT_1_SYSTEM, p1Input, 0.3);
      console.log('[morning-report] step 1: market understanding done');

      let p1Result: any;
      try {
        p1Result = JSON.parse(p1Raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
      } catch {
        console.error('[morning-report] failed to parse P1 JSON, raw:', p1Raw.substring(0, 200));
        p1Result = {
          marketSentiment: '中性',
          top3Themes: [{ theme: '市场数据不足', confidence: '低', evidence: '无法解析' }],
          keyEvents: [],
          affectedSectors: [],
        };
      }

      const p2Input = JSON.stringify({
        themes: p1Result.top3Themes,
        events: p1Result.keyEvents,
        sectors: p1Result.affectedSectors,
        newsText: marketData.newsHeadlines.join('\n'),
      }, null, 2);

      const p2Raw = await callAI(PROMPT_2_SYSTEM, p2Input, 0.1);
      console.log('[morning-report] step 2: causal reasoning done');

      let p2Result: any;
      try {
        p2Result = JSON.parse(p2Raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
      } catch {
        console.error('[morning-report] failed to parse P2 JSON, raw:', p2Raw.substring(0, 200));
        p2Result = { causalChains: [] };
      }

      const p3Input = JSON.stringify({
        sentiment: p1Result.marketSentiment,
        themes: p1Result.top3Themes,
        chains: p2Result.causalChains,
      }, null, 2);

      const p3Raw = await callAI(PROMPT_3_SYSTEM, p3Input, 0.7);
      console.log('[morning-report] step 3: teacher expression done');

      // 解析 P3 JSON 输出，提取 summaryText 和 reasonBrief
      let p3Result: any;
      try {
        p3Result = JSON.parse(p3Raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
      } catch {
        console.error('[morning-report] failed to parse P3 JSON, raw:', p3Raw.substring(0, 200));
        p3Result = { summaryText: p3Raw, reasonBrief: '' };
      }

      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log(`[morning-report] completed in ${elapsed}s`);

      const result = {
        sentiment: p1Result.marketSentiment || '中性',
        summaryText: p3Result.summaryText || p3Raw,
        reasonBrief: p3Result.reasonBrief || '',
        top3Themes: (p1Result.top3Themes || []).map((t: any, i: number) => ({
          title: t.theme,
          evidence: t.evidence,
          chain: p2Result.causalChains?.[i] || null,
        })),
        keyEvents: p1Result.keyEvents || [],
        affectedSectors: p1Result.affectedSectors || [],
        timestamp: marketData.timestamp,
      };
      morningReportCache = { data: result, timestamp: Date.now() };
      res.json(result);
    } catch (error: any) {
      console.error('[morning-report] error:', error.message);
      res.status(500).json({
        error: '早报生成失败，请稍后重试',
        fallback: true,
      });
    }
  });

  // GET /api/sectors — 东方财富真实板块数据，供 MarketMapTab 使用
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

  // 判断是否为A股交易时段
  function getMarketStatus() {
    const now = new Date();
    const day = now.getDay(); // 0=周日, 1-5=周一至周五, 6=周六
    const hour = now.getHours();
    const minute = now.getMinutes();
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
      return { isOpen: false, phase: 'closed', label: '已收盘 — 显示昨日数据' };
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
        totalVolume: marketData.volume,
        timestamp: marketData.timestamp,
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

  // Vite middleware integration for full-stack build/dev environment
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Paopao Server] Running at http://localhost:${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
  });
}

startServer();
