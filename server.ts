/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'path';
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

  const PROMPT_1_SYSTEM = `你是一名资深市场分析师。你的任务不是总结所有新闻，而是找出今天真正影响市场的核心交易逻辑。

请遵循以下原则：
1. 优先依据市场数据（指数、板块涨跌幅、成交额变化）判断热点
2. 新闻仅作为解释依据，不要因为新闻数量多就认为影响大
3. 输出今天最重要的 3 个市场主题
4. 判断市场情绪（乐观 / 中性 / 谨慎）
5. 不预测未来，只描述今天市场正在交易什么

输出严格 JSON 格式，不可夹带任何解释或评论：
{
  "marketSentiment": "乐观" | "中性" | "谨慎",
  "top3Themes": [
    {
      "theme": "主题名称",
      "confidence": "高" | "中" | "低",
      "evidence": "支撑该主题的数据证据"
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
      "reason": "涨跌原因一句话"
    }
  ]
}`;

  const PROMPT_2_SYSTEM = `你是一名财经逻辑分析师。请根据市场数据、新闻和已有知识，建立最合理的因果链。

要求：
1. 因果必须有依据，不允许猜测
2. 如果存在多个可能原因，请按影响程度排序
3. 如果证据不足，请明确说明"不确定"
4. 输出事件 → 原因 → 板块 → 结果，不输出投资建议
5. 宁可回答"证据不足"，也不要编造因果关系

输出 JSON：
{
  "causalChains": [
    {
      "theme": "对应的主题",
      "event": "触发事件",
      "reason": "原因分析",
      "affectedSectors": ["板块1", "板块2"],
      "marketResult": "市场表现数据",
      "certainty": "高" | "中" | "低" | "不确定"
    }
  ]
}`;

  const PROMPT_3_SYSTEM = `你是一位帮助投资小白成长的财经老师。请把分析结果翻译成普通人能理解的话。

要求：
1. 一句话原则 — 能用一句话说清楚就不用两句
2. 保留关键数字 — 涨跌幅、成交额等核心数据必须保留
3. 尽量不用专业术语 — 如果必须出现，同时用括号解释
4. 不制造焦虑，不给买卖建议
5. 目标是帮助用户理解，而不是预测市场`;

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

  async function fetchMarketData() {
    // TODO: Replace with finnews skill integration (East Money + Yahoo + WallStreetCN)
    // For now returns placeholder data matching the existing app's mock data
    return {
      indices: [
        { name: '上证指数', code: '000001', price: 3882.41, changePercent: -1.85, volume: 535281873 },
        { name: '深证成指', code: '399001', price: 14488.65, changePercent: -1.97, volume: 665968453 },
        { name: '创业板指', code: '399006', price: 3925.83, changePercent: -0.07, volume: 26776813 },
      ],
      sectors: [
        { name: 'AI算力', changePercent: 5.2, description: '北美云厂商加大AI投资带动算力需求' },
        { name: '半导体', changePercent: 3.1, description: '国产替代加速推进' },
        { name: '机器人', changePercent: 2.45, description: '具身智能概念持续发酵' },
        { name: '新能源', changePercent: -0.8, description: '短期获利回吐' },
        { name: '医药生物', changePercent: -1.2, description: '集采政策预期影响' },
        { name: '白酒消费', changePercent: -1.8, description: '消费数据不及预期' },
      ],
      announcements: [
        { title: '城投控股首次回购公司股份', company: '城投控股', type: '回购' },
        { title: '芯海科技关联交易暨募集资金补充流动资金', company: '芯海科技', type: '董事会决议' },
        { title: '展芯股份披露IPO相关文件', company: '展芯股份', type: 'IPO' },
      ],
      newsHeadlines: [
        '美联储沃什国会首秀：对通胀零容忍，放弃前瞻指引',
        '韩国央行意外加息25bp至2.75%',
        '美对伊朗发起当日第二波打击，中东局势持续升级',
        '中国上半年GDP同比增长4.7%，央行加大逆周期调节力度',
        '存储芯片板块重挫，SK海力士跌超9%',
        '苹果涨超4%，科技巨头多数上涨',
        '全球央行持续增持黄金，对冲美元政策不确定性',
      ],
      volume: 8923,
      timestamp: new Date(),
    };
  }

  // POST /api/morning-report — Prompt 1 → 2 → 3 pipeline
  app.post('/api/morning-report', async (_req, res) => {
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

      const narrative = await callAI(PROMPT_3_SYSTEM, p3Input, 0.7);
      console.log('[morning-report] step 3: teacher expression done');

      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log(`[morning-report] completed in ${elapsed}s`);

      res.json({
        sentiment: p1Result.marketSentiment || '中性',
        summaryText: narrative,
        top3Themes: (p1Result.top3Themes || []).map((t: any, i: number) => ({
          title: t.theme,
          evidence: t.evidence,
          chain: p2Result.causalChains?.[i] || null,
        })),
        keyEvents: p1Result.keyEvents || [],
        affectedSectors: p1Result.affectedSectors || [],
        timestamp: marketData.timestamp,
      });
    } catch (error: any) {
      console.error('[morning-report] error:', error.message);
      res.status(500).json({
        error: '早报生成失败，请稍后重试',
        fallback: true,
      });
    }
  });

  // GET /api/market-overview — rule engine, no AI
  app.get('/api/market-overview', async (_req, res) => {
    try {
      const marketData = await fetchMarketData();

      const sortedSectors = [...marketData.sectors].sort((a, b) => b.changePercent - a.changePercent);
      const upCount = sortedSectors.filter(s => s.changePercent > 0).length;
      const downCount = sortedSectors.filter(s => s.changePercent < 0).length;

      res.json({
        indices: marketData.indices.map(i => ({
          name: i.name,
          code: i.code,
          price: i.price,
          changePercent: i.changePercent,
        })),
        topSectors: sortedSectors.slice(0, 3),
        bottomSectors: sortedSectors.slice(-3).reverse(),
        marketBreath: { up: upCount, down: downCount },
        totalVolume: marketData.volume,
        timestamp: marketData.timestamp,
      });
    } catch (error: any) {
      console.error('[market-overview] error:', error.message);
      res.status(500).json({ error: '数据获取失败' });
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
