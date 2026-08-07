/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'path';
import fs from 'node:fs';
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

  function httpGetText(urlStr: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const u = new URL(urlStr);
      const mod = u.protocol === 'http:' ? http : https;
      const req = mod.get(
        {
          hostname: u.hostname,
          path: u.pathname + u.search,
          headers: {
            'User-Agent': 'Mozilla/5.0',
            Referer: 'https://gu.qq.com/',
          },
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
            resolve(data);
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

    const indexPromises = indexDefs.map(async ({ secid, name, code }) => {
      try {
        // 注意：东方财富HTTPS在此环境下会ECONNRESET，必须使用HTTP
        const data = await httpGetJSON(`http://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f44,f45,f46,f47,f48,f60,f170,f100`);
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
          high: Number.isFinite(Number(d.f44)) ? d.f44 / 100 : null,
          low: Number.isFinite(Number(d.f45)) ? d.f45 / 100 : null,
          previousClose: Number.isFinite(Number(d.f60)) ? d.f60 / 100 : null,
          volume: d.f47 || 0,
          amount: d.f48 || 0,
        };
      } catch (e: any) {
        console.error(`[fetchMarketData] East Money ${name} failed:`, e.message);
        return null;
      }
    });

    // 东财在部分网络环境会出现 socket hang up。腾讯行情仅作为指数回退：
    // 它补齐三大指数，不伪造板块、资金或新闻数据。
    async function fetchTencentIndices() {
      const definitions = [
        { symbol: 's_sh000001', name: '上证指数', code: '000001' },
        { symbol: 's_sz399001', name: '深证成指', code: '399001' },
        { symbol: 's_sz399006', name: '创业板指', code: '399006' },
      ];
      const text = await httpGetText(
        `https://qt.gtimg.cn/q=${definitions.map((item) => item.symbol).join(',')}`,
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

    const [sectors, marketPulse, newsResult, rawIndices] = await Promise.all([
      fetchSectors(),
      fetchMarketPulse(),
      httpGetJSON(WSCN_NEWS).catch((e: any) => {
        console.error('[fetchMarketData] WallStreetCN news failed:', e.message);
        return null;
      }),
      Promise.all(indexPromises),
    ]);

    let indices = rawIndices.filter(Boolean);
    if (indices.length < indexDefs.length) {
      try {
        const tencentIndices = await fetchTencentIndices();
        const indexByCode = new Map(indices.map((item: any) => [item.code, item]));
        tencentIndices.forEach((item: any) => {
          if (!indexByCode.has(item.code)) indexByCode.set(item.code, item);
        });
        indices = indexDefs
          .map((definition) => indexByCode.get(definition.code))
          .filter(Boolean);
        console.info('[fetchMarketData] Tencent quote fallback filled missing indices');
      } catch (error: any) {
        console.error('[fetchMarketData] Tencent index fallback failed:', error.message);
      }
    }

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

  app.get('/api/sector-detail', async (req, res) => {
    try {
      const sn = String(req.query.sectorName || ''); if(!sn) return res.status(400).json({error:'sectorName is required'});
      const md = await fetchMarketData(); const sec = (md.sectors||[]).find(s => s.name === sn); const pct = Number(sec?.changePercent)||0;
      const subs = (md.sectors||[]).filter(s => s.name !== sn && s.name && s.name.includes(sn.slice(0,2))).slice(0,5);
      
      // Get real stock data
      const bkCode = (sec && sec.code) ? String(sec.code) : (req.query.sectorId ? String(req.query.sectorId).replace(/^(industry|concept)-/, '') : '');
      var allStocks = [];
      if (bkCode) allStocks = await fetchSectorStocks(bkCode);
      
      // Top 5 leaders
      var leading = allStocks.slice(0, 5).map(function(s, i) {
        var reasons = ['板块上涨时弹性更强', '成交额明显放大，资金关注度提升', '受益于行业政策预期', '板块龙头，带动效应明显', '跟随板块整体走强'];
        s.reason = reasons[i] || reasons[reasons.length - 1];
        s.isLeader = i === 0;
        return s;
      });
      
      // Bottom 3 laggards
      var lagging = allStocks.slice(-3).reverse().map(function(s) {
        s.reason = '板块内部表现较弱';
        return s;
      });
      
      // News with classification
      var rawNews = (md.newsItems||[]);
      var catalystKeywords = ['政策','利好','扶持','补贴','规划','推动','支持','印发','发布'];
      var riskKeywords = ['风险','警告','监管','处罚','降温','收紧','利空','下跌','回调'];
      var industryKeywords = [sn.slice(0,2),'板块','行业','市场','景气','需求'];      
      var newsItems = rawNews.slice(0,6).map(function(n) {
        var t = n.title || '';
        var isCatalyst = catalystKeywords.some(function(k) { return t.includes(k); });
        var isRisk = riskKeywords.some(function(k) { return t.includes(k); });
        var isIndustry = industryKeywords.some(function(k) { return t.includes(k); });
        var category = isCatalyst ? '直接催化' : isRisk ? '风险信息' : isIndustry ? '行业背景' : '市场动态';
        var summary = t.length > 30 ? t.substring(0, 30) + '...' : t;
        return {id:n.id, title:t, sourceName:n.sourceName, category: category, summary: summary};
      });
      
      // Fetch kline data for multi-period changes + heat
      var klineData = null;
      if (bkCode) klineData = await fetchSectorKline(bkCode);
      var c5 = klineData ? klineData.change5d : null;
      var c20 = klineData ? klineData.change20d : null;
      var c3m = klineData ? klineData.change3m : null;
      var heatMetrics = {
        todayTurnover: klineData ? klineData.todayAmount : null,
        turnoverChangePercent: (klineData && klineData.avg20dAmount && klineData.todayAmount) ? ((klineData.todayAmount / klineData.avg20dAmount) - 1) * 100 : null,
        turnoverVs20dAvg: (klineData && klineData.avg20dAmount) ? klineData.avg20dAmount : null,
        turnoverRate: null,
        upRatio: allStocks.length ? Math.round(allStocks.filter(function(s){return s.changePercent>0;}).length/allStocks.length*100) : null
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
      
      res.json({
        sector: sn,sectorId:req.query.sectorId||'',todayChange:(pct>=0?'+':'')+pct.toFixed(2)+'%',todayChangePercent:pct,
        change5d:c5,change20d:c20,change3m:c3m,
        stage:stage,stageLabel:stageLabel,signalTags:[],signalTypes:[],
        bubbleConclusion:sn+'今日'+(pct>=0?'上涨':'下跌')+Math.abs(pct).toFixed(2)+'%',
        subdivisions:subs.map(function(s){return{name:s.name,changePercent:Number(s.changePercent)||0,status:'weak'};}),
        leadingStocks: leading, laggingStocks: lagging,
        healthMetrics:{ upCount: allStocks.filter(function(s){return s.changePercent>0;}).length, totalCount: allStocks.length, medianChange:'--', leaderContribution: leading[0]&&leading.length>1?((leading[0].changePercent/(leading.reduce(function(a,b){return a+Math.abs(b.changePercent)},0)))*100).toFixed(0)+'%':'--', divergence:  'moderate' },
        news:newsItems,
        heatMetrics:heatMetrics,
        watchPoints:['成交额是否继续放大','上涨是否扩散','龙头股能否保持强势'],
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
