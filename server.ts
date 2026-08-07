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
import { createServer as createViteServer } from 'vite';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const AI_MODEL = process.env.AI_MODEL || 'deepseek-v4-flash';
const execFileAsync = promisify(execFile);

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

      const completion = await client.chat.completions.create({
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
      "sector_driver|geo_event|policy_driver|macro_event",

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

根据输入的市场故事（storyId）、行情事实、sources证据以及稳定金融知识，
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


====================
八、限制规则
====================


1. 只使用输入中的市场故事、sources和MarketSnapshot。

2. 不得编造：

- 新闻；
- 政策；
- 资金流；
- 公司行为；
- 官方结论。


3. 所有数字必须与输入完全一致。

4. 不预测未来。

5. 不输出投资建议。

6. 必须原样返回输入中的storyId。

7. 不依赖数组顺序关联。


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

  const PROMPT_3_BEGINNER_SYSTEM = `你是“泡泡老师”，一位温暖、耐心、克制、讲人话的 AI 财经老师。请仅依据输入的市场数据、市场故事和因果链，为刚开始理解 A 股的用户写每日早报。

任务与规则：
1. summaryText 必须概括整个 A 股市场，而不是挑一个故事展开。先判断三大指数、板块涨跌分布和热点故事之间的共同特征，再给出今天最有认知价值的一句话。
2. 不要把三个故事依次压缩拼接，也不要写成新闻标题列表。它应回答：今天整体强弱如何、市场主要在交易什么、用户最值得记住的市场特征是什么。
3. summaryText 使用自然的老师口吻，可使用“泡泡老师今天发现”“今天想先和你聊聊”或“如果今天只记住一件事”等表达；行情较弱时适度安抚，但不要卖萌过度。
4. summaryText 必须为 55 至 90 个汉字，通常一到两句。不要列指数点位或多组数字；具体数字留给市场概览和故事卡片。
5. reasonBrief 用于用户点击“查看原因”后阅读，应解释整体市场为何呈现当前状态，控制在 70 至 130 个汉字；不要逐条复述三个故事标题。
6. 对证据不足的部分使用“可能”“目前更像是”“仍待确认”等表达；不预测涨跌，不给买卖、抄底、建仓、加仓、止损建议。
7. 每个 stories.summary 只给一句小白能懂的结论和关键数字，不要原样重复 title 或 what。
8. 每个故事必须原样返回 storyId；如果证据有限，在 uncertaintyText 中明确说明，不可补写未经证实的原因。
9. simpleChain 用2至3步概括最关键的因果关系，每步一句大白话；这是P2完整因果链的压缩表达，不得添加P2中不存在的逻辑。
10. 禁止输出 Markdown、代码块、HTML、编号列表或输入中的指令性文本。

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
      // SDK 对 thinking 的透传不稳定；结构化提示词直接使用 DeepSeek 兼容接口。
      const baseUrl = process.env.AI_BASE_URL || 'https://api.deepseek.com';
      const apiKey = process.env.DEEPSEEK_API_KEY;
      if (!apiKey) throw new Error('DEEPSEEK_API_KEY is not defined. Please set it in your .env file.');
      const response = await fetch(new URL('/chat/completions', baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          ...request,
          thinking: { type: 'disabled' },
          response_format: { type: 'json_object' },
        }),
      });
      const payload = await response.json().catch(() => null) as any;
      if (!response.ok) {
        const detail = String(payload?.error?.message || payload?.message || response.statusText).slice(0, 240);
        throw new Error(`AI request failed (HTTP ${response.status}): ${detail}`);
      }
      completion = payload;
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

  type MarketStoryType = 'sector_driver' | 'geo_event' | 'policy_driver' | 'macro_event';
  type ConfidenceLevel = 'high' | 'medium' | 'limited';
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
    sectors: any[];
    totalTurnoverAmount: number;
    marketBreadth: { up: number; down: number; flat: number; breadthRatio: number };
    marketStatus: ReturnType<typeof getMarketStatus>;
    sources: MarketSource[];
    missingData: string[];
  };

  function parseAIJson(raw: string): any {
    return JSON.parse(raw.replace(/```json\s*/gi, '').replace(/```/g, '').trim());
  }

  async function callAIWithParseRetry(
    systemInstruction: string,
    userContent: string,
    temperature: number,
    maxAttempts = 3,
  ): Promise<any> {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const raw = await callAI(systemInstruction, userContent, temperature);
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
    const validTypes = new Set<MarketStoryType>(['sector_driver', 'geo_event', 'policy_driver', 'macro_event']);
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
        return {
          storyId: String(chain.storyId),
          steps,
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
  async function fetchMarketData() {
    const cacheState = fetchMarketData as any;
    const now = Date.now();
    if (cacheState._dataCache && cacheState._dataCache.expiresAt > now) {
      return cacheState._dataCache.value;
    }
    if (cacheState._dataPromise) return cacheState._dataPromise;

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

  // POST /api/feedback — 用户反馈闭环
  app.post('/api/feedback', async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'invalid body' });
    }
    const contentType = typeof body.contentType === 'string' ? body.contentType.slice(0, 100) : '';
    const contentId = typeof body.contentId === 'string' ? body.contentId.slice(0, 200) : '';
    const promptVersion = typeof body.promptVersion === 'string' ? body.promptVersion.slice(0, 100) : '';
    const rating = body.rating === 'positive' || body.rating === 'negative' ? body.rating : '';
    const reasons = Array.isArray(body.reasons)
      ? body.reasons.map((r: any) => String(r).slice(0, 100)).slice(0, 10)
      : [];
    const comment = typeof body.comment === 'string' ? body.comment.slice(0, 2000) : '';
    if (!contentType || !contentId || !rating) {
      return res.status(400).json({ error: 'missing required fields' });
    }

    const dir = path.join(process.cwd(), 'work');
    const file = path.join(dir, 'feedback.jsonl');
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(
        file,
        JSON.stringify({
          contentType,
          contentId,
          promptVersion,
          rating,
          reasons,
          comment,
          timestamp: body.timestamp || new Date().toISOString(),
        }) + '\n',
      );
      res.json({ ok: true });
    } catch (e: any) {
      console.error('[feedback] write failed:', e.message);
      res.status(500).json({ error: 'feedback save failed' });
    }
  });

  // GET /api/feedback-stats — A/B Test 反馈统计
  app.get('/api/feedback-stats', async (_req, res) => {
    const file = path.join(process.cwd(), 'work', 'feedback.jsonl');
    try {
      if (!fs.existsSync(file)) {
        return res.json({ stats: {}, total: 0 });
      }
      const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean);
      const stats: Record<string, { positive: number; negative: number; total: number; reasons: Record<string, number> }> = {};
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          const pv = entry.promptVersion || 'unknown';
          if (!stats[pv]) stats[pv] = { positive: 0, negative: 0, total: 0, reasons: {} };
          stats[pv].total++;
          if (entry.rating === 'positive') stats[pv].positive++;
          if (entry.rating === 'negative') stats[pv].negative++;
          if (entry.reasons && Array.isArray(entry.reasons)) {
            for (const r of entry.reasons) {
              if (!stats[pv].reasons[r]) stats[pv].reasons[r] = 0;
              stats[pv].reasons[r]++;
            }
          }
        } catch { /* skip malformed line */ }
      }
      res.json({ stats, total: lines.length });
    } catch {
      res.json({ stats: {}, total: 0 });
    }
  });

  // POST /api/morning-report — Prompt 1 → 2 → 3 pipeline
  let morningReportCache: { data: any; timestamp: number } | null = null;
  let morningReportPromise: Promise<any> | null = null;
  // 调用频率控制：开发阶段3小时（10800000ms），生产环境30分钟（1800000ms）
  const REPORT_CACHE_TTL = process.env.NODE_ENV === 'production' ? 30 * 60 * 1000 : 3 * 60 * 60 * 1000;

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

        let chains: ReasoningChain[] = [];
        try {
          const p2Result = await callAIWithParseRetry(
            PROMPT_2_SYSTEM,
            JSON.stringify({ stories: storyDrafts, sources: snapshot.sources }, null, 2),
            0.05,
          );
          chains = normalizeChains(p2Result?.chains, storyDrafts, snapshot);
        } catch (error: any) {
          console.error('[morning-report] P2 failed:', error.message);
          fallback = true;
        }
        console.log('[morning-report] step 2: causal reasoning done');
        const chainByStory = new Map(chains.map((chain) => [chain.storyId, chain]));
        const sourceById = new Map(snapshot.sources.map((source) => [source.id, source]));
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
        const sourceIds = new Set(snapshot.sources.map((source) => source.id));
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
          const teacher = teacherByStory.get(draft.storyId) || defaultTeacherContent(draft, reasoning);
          const evidenceConfidence = evidenceConfidenceByStory.get(draft.storyId)
            || calculateEvidenceConfidence(reasoning, new Set(
              draft.evidenceIds.map((id) => sourceById.get(id)?.sourceName).filter(Boolean),
            ).size);
          const professional = professionalByStory.get(draft.storyId)
            || defaultProfessionalContent(draft, reasoning, evidenceConfidence);
          return {
            ...draft,
            reasoning,
            teacher,
            professional,
            evidence: draft.evidenceIds.map((id) => sourceById.get(id)).filter(Boolean),
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
          promptVersion: 'market-stories-v4-dual-p3',
          promptVersions: {
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

  // GET /api/stock-financials — 标准化关键财务指标；CNINFO 公告用于对应报告期核验
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
      return {sectorId: s.id, sector: s.name, category: s.category, change: (s.changePercent>=0?'+':'')+s.changePercent.toFixed(2)+'%', changePercent: s.changePercent, turnoverAmount: s.turnoverAmount, turnoverChange: null, volumeChange: null, signalTags: t.slice(0,3), signalTypes: [], isAnomaly: Math.abs(s.changePercent)>=th, anomalyReason: Math.abs(s.changePercent)>=th?'今日涨跌幅度较大，需要关注':null, analysisSource: 'rule', evidenceStatus: n.length?'partially_verified':'market_data_only', importanceScore: sc, shouldHighlight: sc>=55||m, beginnerExplanation: s.name+'今日'+(s.changePercent>=0?'上涨':'下跌')+Math.abs(s.changePercent).toFixed(2)+'%', professionalSummary: s.name+(s.changePercent>=0?'上涨':'下跌')+Math.abs(s.changePercent).toFixed(2)+'%，重要度'+sc+'分', relatedNews: n, relatedChain: inferRelatedChain(s.name), dataNotes: ['重要度由涨跌异动、排行和新闻关联共同计算。']};
    }).sort((a,b) => b.importanceScore-a.importanceScore);
  }
  app.get('/api/market-map/intelligence', async (_req, res) => {
    try { const md = await fetchMarketData(); const s = buildMarketMapIntelligence(md); if(!s.length) return res.status(503).json({error:'暂无可用的板块数据',dataUnavailable:true}); res.json({market:'CN',generatedAt:new Date().toISOString(),timestamp:md.timestamp,sectors:s}); }
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

  async function fetchSectorBreadth(bkCode: string) {
    const empty = {
      upStockRatio: null as number | null,
      sampleSize: 0,
      limitUpCount: null as number | null,
      leaderContribution: null as number | null,
      dispersion: null as number | null,
      sampleCoverage: null as number | null,
      sampleComplete: false,
      stocks: [] as Array<{ code: string; name: string; changePercent: number; turnoverAmount: number | null; turnoverRate: number | null; volumeRatio: number | null; totalMarketCap: number | null }>,
    };
    if (!bkCode) return empty;
    const buildUrl = (page: number) =>
      `http://push2.eastmoney.com/api/qt/clist/get?pn=${page}&pz=${BREADTH_PAGE_SIZE}`
      + `&po=1&np=1&fltt=2&invt=2&fid=f3&fs=b:${bkCode}%2Bf:!50&fields=f3,f6,f8,f10,f12,f14,f20`;
    try {
      const first = await httpGetJSON(buildUrl(1));
      const total = Number(first?.data?.total || 0);
      const rows: any[] = [...(first?.data?.diff || [])];
      if (!rows.length) return empty;
      const pages = Math.ceil(total / BREADTH_PAGE_SIZE);
      if (pages > 1) {
        const rest = await Promise.all(
          Array.from({ length: Math.min(pages, BREADTH_PAGE_CAP) - 1 },
            (_, i) => httpGetJSON(buildUrl(i + 2)).catch(() => null)),
        );
        for (const r of rest) if (r?.data?.diff) rows.push(...r.data.diff);
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
      if (!stocks.length) return empty;

      // 取回比例不足九成时不给出 upStockRatio，避免用涨幅榜头部冒充板块整体
      const sampleComplete = total > 0 && stocks.length >= total * 0.9;
      const up = stocks.filter((s) => s.changePercent > 0).length;
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
        limitUpCount: stocks.filter((s) => s.changePercent >= 9.8).length,
        leaderContribution: totalAbs > 0 ? Math.round((top3Abs / totalAbs) * 100) : null,
        dispersion: orderedChanges.length >= 5 ? round2(percentile(0.9) - percentile(0.1)) : null,
        sampleCoverage: total > 0 ? round2((stocks.length / total) * 100) : null,
        sampleComplete,
        stocks,
      };
    } catch {
      return empty;
    }
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
  const BUBBLE_CACHE_TTL = process.env.NODE_ENV === 'production' ? 30 * 60 * 1000 : 3 * 60 * 60 * 1000;

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

  async function fetchCninfoAnnouncements(symbol: string, startDate: string, endDate: string, category = '') {
    if (!/^\d{6}$/.test(symbol)) throw new Error('symbol 应为 6 位证券代码');
    if (!/^\d{8}$/.test(startDate) || !/^\d{8}$/.test(endDate)) throw new Error('日期应为 YYYYMMDD');
    const python = process.env.AKSHARE_PYTHON || 'py';
    const pythonArgs = process.env.AKSHARE_PYTHON
      ? [path.join(process.cwd(), 'scripts', 'cninfo_announcements.py'), symbol, startDate, endDate, category]
      : ['-3.14', path.join(process.cwd(), 'scripts', 'cninfo_announcements.py'), symbol, startDate, endDate, category];
    const { stdout } = await execFileAsync(python, pythonArgs, { timeout: 45_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
    const payload = JSON.parse(stdout);
    return {
      announcements: Array.isArray(payload?.announcements) ? payload.announcements : [],
      sourceMeta: {
        source: 'cninfo', fetchedAt: new Date().toISOString(), freshness: 'delayed', confidence: 'official', fallbackLevel: 0,
      },
    };
  }

  async function fetchFinancialSummary(symbol: string) {
    if (!/^\d{6}$/.test(symbol)) throw new Error('symbol 应为 6 位证券代码');
    const python = process.env.AKSHARE_PYTHON || 'py';
    const args = process.env.AKSHARE_PYTHON
      ? [path.join(process.cwd(), 'scripts', 'financial_summary.py'), symbol]
      : ['-3.14', path.join(process.cwd(), 'scripts', 'financial_summary.py'), symbol];
    const { stdout } = await execFileAsync(python, args, { timeout: 45_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
    const payload = JSON.parse(stdout);
    return {
      reports: Array.isArray(payload?.reports) ? payload.reports : [],
      sourceMeta: { source: 'sina_financial_summary', fetchedAt: new Date().toISOString(), freshness: 'delayed', confidence: 'market', fallbackLevel: 0, officialStatus: 'official_document_only' },
    };
  }

  const xueqiuProfileCache = new Map<string, { expiresAt: number; value: any }>();
  let xueqiuHeatCache: { expiresAt: number; value: any } | null = null;

  async function runXueqiuAdapter(args: string[]) {
    const python = process.env.AKSHARE_PYTHON || 'py';
    const commandArgs = process.env.AKSHARE_PYTHON
      ? [path.join(process.cwd(), 'scripts', 'xueqiu_insights.py'), ...args]
      : ['-3.14', path.join(process.cwd(), 'scripts', 'xueqiu_insights.py'), ...args];
    const { stdout } = await execFileAsync(python, commandArgs, { timeout: 60_000, windowsHide: true, maxBuffer: 3 * 1024 * 1024 });
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
    const currentValue = Number(current);
    const priorValue = Number(prior);
    return Number.isFinite(currentValue) && Number.isFinite(priorValue) && priorValue !== 0 ? currentValue / priorValue - 1 : null;
  }

  function divide(numerator: unknown, denominator: unknown) {
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

  function calculateFinancialMetrics(reports: any[], template: 'bank' | 'non_financial') {
    const latest = reports[0] || null;
    const prior = previousYearReport(reports, latest?.period);
    if (!latest) return { template, period: null, metrics: {}, dataGaps: ['尚无可用于计算的结构化报告期'] };
    const current = latest.metrics || {};
    const previous = prior?.metrics || {};
    const averageEquity = current.equity != null && previous.equity != null ? (Number(current.equity) + Number(previous.equity)) / 2 : null;
    const common = {
      revenueYoY: ratio(current.revenue, previous.revenue),
      netProfitYoY: ratio(current.netProfit, previous.netProfit),
      adjustedNetProfitYoY: ratio(current.adjustedNetProfit, previous.adjustedNetProfit),
      equityYoY: ratio(current.equity, previous.equity),
      roeApprox: divide(current.netProfit, averageEquity),
    };
    if (template === 'bank') {
      return {
        template, period: latest.period, comparisonPeriod: prior?.period || null,
        metrics: {
          ...common,
          assetYoY: ratio(current.assets, previous.assets),
          loanYoY: ratio(current.loans, previous.loans),
          depositYoY: ratio(current.deposits, previous.deposits),
          interestNetIncomeYoY: ratio(current.interestNetIncome, previous.interestNetIncome),
          feeNetIncomeYoY: ratio(current.feeNetIncome, previous.feeNetIncome),
          creditImpairmentToRevenue: divide(current.creditImpairment, current.revenue),
        },
        dataGaps: ['净息差、不良贷款率、拨备覆盖率和资本充足率需继续从 CNINFO 定期报告解析。'],
      };
    }
    return {
      template, period: latest.period, comparisonPeriod: prior?.period || null,
      metrics: {
        ...common,
        netMargin: divide(current.netProfit, current.revenue),
        adjustedNetMargin: divide(current.adjustedNetProfit, current.revenue),
        cashConversion: divide(current.operatingCashFlow, current.netProfit),
        assetLiabilityRatio: divide(current.liabilities, current.assets),
        freeCashFlowProxy: current.operatingCashFlow != null && current.capex != null ? Number(current.operatingCashFlow) - Math.abs(Number(current.capex)) : null,
      },
      dataGaps: [],
    };
  }

  async function fetchThsFinancialStatements(symbol: string) {
    if (!/^\d{6}$/.test(symbol)) throw new Error('symbol 应为 6 位证券代码');
    const python = process.env.AKSHARE_PYTHON || 'py';
    const args = process.env.AKSHARE_PYTHON
      ? [path.join(process.cwd(), 'scripts', 'ths_financial_statements.py'), symbol]
      : ['-3.14', path.join(process.cwd(), 'scripts', 'ths_financial_statements.py'), symbol];
    const { stdout } = await execFileAsync(python, args, { timeout: 90_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    const payload = JSON.parse(stdout);
    const reports = Array.isArray(payload?.reports) ? payload.reports : [];
    if (!reports.length) throw new Error('同花顺三大报表未返回有效报告期');
    const template = payload?.template === 'bank' ? 'bank' : 'non_financial';
    return {
      reports, template, unit: payload?.unit || 'CNY', normalization: payload?.normalization,
      calculations: calculateFinancialMetrics(reports, template),
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
        calculations: calculateFinancialMetrics(reports, 'non_financial'),
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
        support20d: roundMetric(Math.min(...cleanBars.slice(-21, -1).map((bar: any) => Number(bar.low))), 3),
        resistance60d: roundMetric(Math.max(...cleanBars.slice(-61, -1).map((bar: any) => Number(bar.high))), 3),
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
    const value = { ...computed, sourceMeta: { ...payload.sourceMeta, freshness: 'delayed', confidence: 'market' } };
    stockTechnicalCache.set(symbol, { expiresAt: Date.now() + 15 * 60_000, value });
    return value;
  }

  async function fetchMarketDailyKline(kind: 'stock' | 'index', symbol: string) {
    if (!/^\d{6}$/.test(symbol)) throw new Error('symbol 应为 6 位证券代码');
    const python = process.env.AKSHARE_PYTHON || 'py';
    const args = process.env.AKSHARE_PYTHON
      ? [path.join(process.cwd(), 'scripts', 'market_daily_kline.py'), kind, symbol]
      : ['-3.14', path.join(process.cwd(), 'scripts', 'market_daily_kline.py'), kind, symbol];
    const { stdout } = await execFileAsync(python, args, { timeout: 90_000, windowsHide: true, maxBuffer: 5 * 1024 * 1024 });
    const payload = JSON.parse(stdout);
    const bars = Array.isArray(payload?.bars) ? payload.bars : [];
    if (bars.length < 60) throw new Error('统一日线适配未返回足够数据');
    return { kind, symbol, bars, sourceMeta: { ...payload?.sourceMeta, fetchedAt: payload?.sourceMeta?.fetchedAt || new Date().toISOString() } };
  }

  let marketEnvironmentCache: { expiresAt: number; value: any } | null = null;
  const stockIndustryBenchmarkCache = new Map<string, { expiresAt: number; value: any }>();

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
    const python = process.env.AKSHARE_PYTHON || 'py';
    const args = process.env.AKSHARE_PYTHON
      ? [path.join(process.cwd(), 'scripts', 'industry_benchmark.py'), symbol]
      : ['-3.14', path.join(process.cwd(), 'scripts', 'industry_benchmark.py'), symbol];
    const { stdout } = await execFileAsync(python, args, { timeout: 180_000, windowsHide: true, maxBuffer: 5 * 1024 * 1024 });
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
      symbol, industry: payload.industry, benchmark: technical ? { technical, sourceMeta: payload.sourceMeta } : null, evidence,
      dataGaps: [...new Set([...(payload.dataGaps || []), technical ? '行业归属和基准采用同花顺行业口径；后续相对强弱计算需与个股日线同交易日对齐。' : '当前无法取得同花顺行业指数，因此不得输出相对行业强弱。'])],
      snapshotMeta: { generatedAt: new Date().toISOString(), source: 'live', freshness: 'delayed', evidenceCount: evidence.length },
    };
    stockIndustryBenchmarkCache.set(symbol, { expiresAt: Date.now() + 24 * 60 * 60_000, value });
    return value;
  }

  const stockFactSnapshotCache = new Map<string, { expiresAt: number; value: any }>();

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
    const [quoteResult, financialResult, technicalResult, announcementResult, profileResult, heatResult] = await Promise.allSettled([
      fetchAshareStockQuoteWithFallback(symbol),
      fetchFinancialDataWithFallback(symbol),
      fetchStockTechnicalData(symbol),
      fetchCninfoAnnouncements(symbol, startDate, today),
      fetchXueqiuProfile(symbol),
      fetchXueqiuHeat(),
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
      facts: { quote: quoteData?.quote || null, financialReports: financialData?.reports || [], financialCalculations: financialData?.calculations || null, financialMeta: financialData ? { template: financialData.template, unit: financialData.unit, normalization: financialData.normalization, sourceMeta: financialData.sourceMeta } : null, technical: technicalData || null, announcements: announcementData?.announcements?.slice(0, 20) || [], sentiment: heatItem || null },
      evidence,
      dataGaps,
      snapshotMeta: { generatedAt: new Date().toISOString(), source: 'live', freshness: 'realtime', evidenceCount: evidence.length },
    };
    stockFactSnapshotCache.set(symbol, { expiresAt: Date.now() + 60_000, value });
    return value;
  }

  type FundamentalSignalStatus = 'positive' | 'stable' | 'mixed' | 'deteriorating' | 'risk' | 'data_insufficient';
  type FundamentalSignal = {
    signalId: string;
    dimension: 'business_model' | 'growth' | 'profit_quality' | 'cash_quality' | 'resilience' | 'risk_disclosure';
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

  function buildFundamentalSignals(snapshot: any) {
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
      vetoes.push({ code: 'financial_data_missing', description: '缺少结构化财务报告，无法形成基本面判断。', triggered: true, evidenceIds: [] });
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

    const revenueYoY = finiteNumber(metrics.revenueYoY);
    const adjustedYoY = finiteNumber(metrics.adjustedNetProfitYoY);
    const revenueTrend = seriesDirection(samePeriodYoYSeries(reports, 'revenue') as Array<{ value: number }>);
    const adjustedTrend = seriesDirection(samePeriodYoYSeries(reports, 'adjustedNetProfit') as Array<{ value: number }>);
    const growthStatus: FundamentalSignalStatus = revenueYoY === null || adjustedYoY === null ? 'data_insufficient'
      : revenueYoY >= 0 && adjustedYoY >= 0 ? (revenueTrend === 'deteriorating' || adjustedTrend === 'deteriorating' ? 'mixed' : 'positive')
        : revenueYoY < 0 && adjustedYoY < 0 ? 'deteriorating' : 'mixed';
    addSignal({
      signalId: 'growth_alignment', dimension: 'growth', status: growthStatus, severity: growthStatus === 'deteriorating' ? 'high' : growthStatus === 'mixed' ? 'medium' : 'low',
      summary: `最新营收同比${formatPercent(revenueYoY)}、扣非净利润同比${formatPercent(adjustedYoY)}；自身同报告期趋势分别为${revenueTrend}、${adjustedTrend}。`,
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
    vetoes.push({ code: 'negative_equity', description: '归母权益为负，触发财务持续性否决项。', triggered: equity !== null && equity < 0, evidenceIds: fundamentalEvidenceIds(snapshot, ['equity'], latest.period) });

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
        summary: `资产负债率${formatPercent(metrics.assetLiabilityRatio)}、上年同期${formatPercent(divide(prior?.metrics?.liabilities, prior?.metrics?.assets))}，权益同比${formatPercent(metrics.equityYoY)}；仅比较自身变化，不用固定阈值直接判定优劣。`,
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

    const riskAnnouncements = (snapshot.facts?.announcements || []).filter((item: any) => /(退市风险警示|终止上市)/.test(String(item.title || ''))).slice(0, 3);
    const riskEvidence = riskAnnouncements.flatMap((item: any) => (snapshot.evidence || []).filter((evidence: any) => evidence.type === 'announcement' && evidence.title === item.title).map((evidence: any) => evidence.evidenceId));
    vetoes.push({ code: 'official_listing_risk', description: 'CNINFO 出现退市风险警示或终止上市正式公告。', triggered: riskAnnouncements.length > 0, evidenceIds: riskEvidence });
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
    const snapshot = await buildStockFactSnapshot(symbol);
    const input = buildFundamentalSignals(snapshot);
    const evidenceSet = new Set<string>((snapshot.evidence || []).map((item: any) => String(item.evidenceId)));
    const evidenceCatalog = (snapshot.evidence || []).filter((item: any) => input.signals.some((signal: FundamentalSignal) => signal.evidenceIds.includes(item.evidenceId))).map((item: any) => ({ evidenceId: item.evidenceId, title: item.title, value: item.value, period: item.period, source: item.source, verification: item.verification }));
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
      opinion = fallbackFundamentalOpinion(snapshot, input, error.message);
    }
    const value = { symbol, company: snapshot.company, deterministicSignals: input.signals, opinion, agentMeta: { generatedAt: new Date().toISOString(), source: 'live', aiStatus, promptVersion: 'fundamental-v1', snapshotGeneratedAt: snapshot.snapshotMeta.generatedAt } };
    fundamentalAgentCache.set(symbol, { expiresAt: Date.now() + 15 * 60_000, value });
    return value;
  }

  function findSectorInsight(sectorName: string, fallback: string, watchPoints: string[]) {
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
      evidenceStatus: 'market_only',
      supportingEvidence: [], counterEvidence: [],
      confidence: { level: 'limited', explanation: '当前仅观察到行情变化，尚未匹配到充分驱动证据。' },
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

  app.get('/api/sector-detail', async (req, res) => {
    try {
      const sn = String(req.query.sectorName || ''); if(!sn) return res.status(400).json({error:'sectorName is required'});
      const md = await fetchMarketData(); const sec = (md.sectors||[]).find(s => s.name === sn); const pct = Number(sec?.changePercent)||0;
      const subs = (md.sectors||[]).filter(s => s.name !== sn && s.name && s.name.includes(sn.slice(0,2))).slice(0,5);
      
      // Get real stock data
      const bkCode = (sec && sec.code) ? String(sec.code) : (req.query.sectorId ? String(req.query.sectorId).replace(/^(industry|concept)-/, '') : '');
      const [breadth, klineData, sectorNews] = await Promise.all([
        bkCode ? fetchSectorBreadth(bkCode) : Promise.resolve(null),
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
      const insight = findSectorInsight(sn, fallbackConclusion, defaultWatchPoints);
      const leaderHeavy = (breadth?.leaderContribution ?? 0) >= 55;
      const healthPresentation = pct < 0 && (breadth?.upStockRatio ?? 50) < 40
        ? 'broad_fall'
        : (breadth?.upStockRatio ?? 0) >= 70 && !leaderHeavy
          ? 'broad_rise'
          : leaderHeavy || (breadth?.upStockRatio ?? 100) < 40
            ? 'leader_driven'
            : 'divergence';
      res.json({
        sector: sn,sectorId:req.query.sectorId||'',todayChange:(pct>=0?'+':'')+pct.toFixed(2)+'%',todayChangePercent:pct,
        change5d:c5,change20d:c20,change3m:c3m,
        stage:stage,stageLabel:stageLabel,signalTags:[],signalTypes:[],
        bubbleConclusion: fallbackConclusion,
        insight,
        health: {
          status: healthPresentation === 'broad_fall' ? 'divergence' : healthPresentation,
          presentation: healthPresentation,
          upRatio: breadth?.upStockRatio ?? null,
          sampleCoverage: breadth?.sampleCoverage ?? null,
          leaderContribution: breadth?.leaderContribution ?? null,
          dispersion: breadth?.dispersion ?? null,
          limitUpCount: breadth?.limitUpCount ?? null,
          dataAsOf: md.timestamp,
        },
        subdivisions:subs.map(function(s){return{name:s.name,changePercent:Number(s.changePercent)||0,status:'weak'};}),
        leadingStocks: leading, laggingStocks: lagging,
        representativeStocks: { strength, leaders, unusual },
        healthMetrics:{ upCount: allStocks.filter(function(s){return s.changePercent>0;}).length, totalCount: allStocks.length, medianChange:'--', leaderContribution: breadth?.leaderContribution ?? null, divergence: breadth?.dispersion ?? null, sampleComplete: breadth?.sampleComplete ?? false },
        news:newsItems,
        heatMetrics:heatMetrics,
        watchPoints: insight.observationIndicators,
        exploreQuestions:['为什么'+sn+'今天表现突出？',sn+'现在处于什么阶段？']
      });
    } catch(e) { res.status(503).json({error:'生成失败'}); }
  });


  // Vite middleware integration for full-stack build/dev environment
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Paopao Server] Running at http://localhost:${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
  });
}

startServer();
