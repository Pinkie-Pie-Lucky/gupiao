/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * mockWebData —— 为桌面端提供的演示数据层
 * 封装 data.ts 中的模拟数据，补充桌面端特有的类型与辅助方法。
 */

import { initialIndices, initialSectors } from '../data';
import { StockItem, MarketStory } from '../types';

/* ========== 指数 ========== */

export interface WebIndex {
  code: string;
  name: string;
  value: number;
  changePercent: number;
  changeValue: number;
}

export const webIndices: WebIndex[] = initialIndices.map((idx) => ({
  code: idx.code,
  name: idx.name,
  value: idx.value,
  changePercent: idx.changePercent,
  changeValue: idx.changeValue,
}));

/* ========== 板块热力 ========== */

export interface HeatSector {
  id: string;
  name: string;
  changePercent: number;
  stocks: StockItem[];
}

export const heatSectors: HeatSector[] = initialSectors.map((s) => ({
  id: s.id,
  name: s.name,
  changePercent: s.changePercent,
  stocks: s.stocks.map((st) => ({
    name: st.name,
    code: st.code,
    price: st.price,
    changePercent: st.changePercent,
    volume: st.volume,
    turnover: st.turnover,
    history: st.history || [],
  })),
}));

/* ========== 排行榜 ========== */

export function getRankedStocks(): StockItem[] {
  const all: StockItem[] = [];
  for (const s of heatSectors) {
    for (const st of s.stocks) {
      all.push(st);
    }
  }
  return all.sort((a, b) => b.changePercent - a.changePercent);
}

/* ========== 市场温度 ========== */

export const marketTemperature = {
  temp: 58,
  label: '温和偏暖',
};

/* ========== 市场要闻 ========== */

export const marketHeadline =
  '🎈 泡泡老师发现，今日大盘温和放量上行，上证指数成功站上3026点！AI算力板块虽涨幅领先，但主力资金高位出现分歧流出，值得留意回调风险。同时，半导体设备和机器人概念开始接力补涨，资金有从高位向低位切换的迹象。';

/* ========== 市场故事（P1→P2→P3 管线演示用） ========== */

const baseTime = new Date();
const isoTime = baseTime.toISOString();

export const webStories: MarketStory[] = [
  {
    storyId: 'story-1',
    type: 'sector_driver',
    title: 'AI算力板块主力高位分歧，短线回调风险加大',
    what: 'AI算力板块今日整体上涨4.32%，但盘中主力大单资金出现高位松动流出，约23.5亿元。',
    metrics: [
      { label: '板块涨跌', value: '+4.32%' },
      { label: '主力资金', value: '-23.5亿' },
    ],
    evidenceIds: ['market-data-1'],
    relatedSectors: ['AI算力', '光模块'],
    reasoning: {
      storyId: 'story-1',
      steps: [
        { id: 'step-1', text: 'AI算力板块今日上涨4.32%', evidenceIds: ['market-data-1'], kind: 'fact' },
        { id: 'step-2', text: '盘中主力资金净流出约23.5亿元', evidenceIds: ['market-data-1'], kind: 'fact' },
        { id: 'step-3', text: '过去一周AI板块累计涨幅超15%，积累了大量获利盘', evidenceIds: [], kind: 'knowledge' },
        { id: 'step-4', text: '获利资金与套牢盘在3026点附近选择逢高减仓', evidenceIds: ['market-data-1'], kind: 'inference' },
      ],
      uncertainty: '主力资金流出数据基于大单统计，可能存在统计口径差异。',
      confidenceLevel: 'medium',
      validationStatus: 'passed',
    },
    teacher: {
      storyId: 'story-1',
      summary:
        '泡泡老师发现，AI算力板块今天虽然还在涨，但已经有聪明资金开始悄悄获利离场了（主力流出23亿）。过去一周涨得太猛，积累了很多短期获利盘，这时候容易出现高位震荡。',
      uncertaintyText: '主力流出的数据来自大单统计，可能无法完全反映全貌，但仍是一个值得重点关注的信号。',
      simpleChain: [
        'AI算力板块今天虽然上涨4.32%，但主力资金却在悄悄流出约23.5亿元',
        '过去一周涨了15%，短线获利资金和之前的套牢盘都在趁高减仓',
        '所以板块短期可能出现震荡回调——上涨不追，等回调再看',
      ],
    },
    professional: {
      storyId: 'story-1',
      conclusion:
        'AI算力板块呈现「价量背离」：指数收涨4.32%但主力资金净流出23.5亿，属于高位筹码松动信号。',
      drivers: [
        { role: 'primary', title: '获利资金兑现', explanation: 'AI板块过去5日累计涨幅超15%，短线交易型资金有较强兑现意愿', evidenceIds: [] },
        { role: 'secondary', title: '多空分歧加大', explanation: '指数冲高至3026点压力位后，大单卖出额开始超过买入额', evidenceIds: ['market-data-1'] },
      ],
      supportingEvidence: ['AI算力板块今日涨幅4.32%', '主力资金净流出23.5亿（大单统计口径）'],
      evidenceGaps: ['缺少分时资金流向的连续数据', '未确认流出是否来自机构席位'],
      alternativeExplanations: ['可能是量化调仓而非主动减仓', '不排除部分资金做T+0回转交易'],
      counterLogic: ['北向资金今日仍在净买入AI龙头', '板块成交额维持在近期高位，流动性充足'],
      observationIndicators: ['明日早盘前30分钟资金流向', '光模块龙头KDJ是否进入超卖区', 'AI板块成交额是否缩量至均值以下'],
      confidence: { score: 55, level: 'medium', explanation: '引用事实2步、来源1家、推断1步，并存在未确认项' },
    },
    evidence: [
      {
        id: 'market-data-1',
        title: '东方财富行业资金流向数据',
        sourceName: '东方财富',
        kind: 'market_data',
      },
    ],
  },
  {
    storyId: 'story-2',
    type: 'sector_driver',
    title: '半导体设备板块逆势放量，资金回流迹象明显',
    what: '半导体设备板块今日上涨3.28%，成交额较昨日放大40%，主力资金净流入15.8亿元。',
    metrics: [
      { label: '板块涨跌', value: '+3.28%' },
      { label: '成交额', value: '较昨日+40%' },
      { label: '主力资金', value: '+15.8亿' },
    ],
    evidenceIds: ['market-data-1'],
    relatedSectors: ['半导体', '芯片设备'],
    reasoning: {
      storyId: 'story-2',
      steps: [
        { id: 'step-1', text: '半导体设备板块上涨3.28%，成交额放大40%', evidenceIds: ['market-data-1'], kind: 'fact' },
        { id: 'step-2', text: '主力资金净流入约15.8亿元', evidenceIds: ['market-data-1'], kind: 'fact' },
        { id: 'step-3', text: '科技强国战略强调半导体装备国产化，多地产业基金落地', evidenceIds: [], kind: 'knowledge' },
        { id: 'step-4', text: 'AI板块流出的部分资金选择半导体设备作为高低切换标的', evidenceIds: [], kind: 'inference' },
      ],
      uncertainty:
        '放量是否持续需观察后续交易日成交额是否维持。产业基金落地的具体规模尚未获得官方确认。',
      confidenceLevel: 'medium',
      validationStatus: 'passed',
    },
    teacher: {
      storyId: 'story-2',
      summary:
        '泡泡老师发现，半导体设备板块今天悄悄放量了！成交额比昨天大了四成，而且有15.8亿的主力资金净流入。这可能说明从AI板块流出来的资金开始往半导体搬家了。',
      uncertaintyText:
        '今天的放量信号不错，但能不能持续还要看接下来几天的成交额变化。产业基金的利好也还没有官方确认。',
      simpleChain: [
        '半导体设备今天涨了3.28%，成交额比昨天多了40%',
        '主力资金净流入15.8亿——和AI算力流出形成对比',
        '可能是资金在做「高低切换」，从高位的AI流向估值更合理的半导体',
      ],
    },
    professional: {
      storyId: 'story-2',
      conclusion:
        '半导体设备板块呈现「量价齐升」的健康态势——涨幅3.28%、成交额放量40%，且主力资金净流入15.8亿。',
      drivers: [
        {
          role: 'primary',
          title: 'AI溢出资金高低切换',
          explanation: 'AI算力板块高位分歧资金寻找低估值方向，半导体设备成为承接方向之一',
          evidenceIds: [],
        },
        {
          role: 'secondary',
          title: '国产替代政策预期',
          explanation: '市场对半导体设备国产化率提升有持续预期，科技强国战略提供政策背书',
          evidenceIds: [],
        },
      ],
      supportingEvidence: ['半导体设备板块今日涨幅3.28%', '成交额较昨日放大40%', '主力资金净流入15.8亿'],
      evidenceGaps: ['未确认产业基金落地规模和具体投向', '缺少机构席位买卖数据'],
      alternativeExplanations: ['可能是量化策略的板块轮动因子触发', '不排除是短期事件驱动的脉冲行情'],
      counterLogic: ['半导体板块过去一个月整体处于震荡区间', '美日荷联合出口管制升级可能压制板块估值上行空间'],
      observationIndicators: ['半导体设备指数能否站稳20日均线', '中芯国际成交量是否持续放大', '板块内上涨家数占比是否维持70%以上'],
      confidence: { score: 62, level: 'medium', explanation: '引用事实3步、来源1家，量价数据充分但政策面证据不足' },
    },
    evidence: [
      {
        id: 'market-data-1',
        title: '东方财富行业资金流向数据',
        sourceName: '东方财富',
        kind: 'market_data',
      },
    ],
  },
  {
    storyId: 'story-3',
    type: 'sector_driver',
    title: '机器人概念受具身智能利好提振，游资积极介入',
    what: '机器人板块今日上涨2.45%，减速器、伺服电机等细分方向领涨，游资活跃度提升。',
    metrics: [
      { label: '板块涨跌', value: '+2.45%' },
      { label: '涨停家数', value: '3只' },
    ],
    evidenceIds: ['market-data-1'],
    relatedSectors: ['机器人', '减速器'],
    reasoning: {
      storyId: 'story-3',
      steps: [
        { id: 'step-1', text: '机器人板块今日上涨2.45%', evidenceIds: ['market-data-1'], kind: 'fact' },
        { id: 'step-2', text: '减速器、伺服电机细分方向领涨', evidenceIds: ['market-data-1'], kind: 'fact' },
        {
          id: 'step-3',
          text: '具身智能与人形机器人近期政策及产业利好消息频出',
          evidenceIds: [],
          kind: 'knowledge',
        },
        { id: 'step-4', text: '游资在题材催化下积极介入机器人概念', evidenceIds: [], kind: 'inference' },
      ],
      uncertainty:
        '游资数据难以实时跟踪，短期涨幅可能受情绪驱动大于基本面支撑。',
      confidenceLevel: 'limited',
      validationStatus: 'limited',
    },
    teacher: {
      storyId: 'story-3',
      summary:
        '泡泡老师发现，机器人板块今天表现也不错！减速器、伺服电机这些「机器人关节」相关的股票涨得最好。消息面上最近具身智能和人形机器人的利好挺多的。',
      uncertaintyText:
        '不过泡泡要提醒一下，机器人的这波上涨更多是短线情绪在驱动，基本面支撑还需要更多确认。',
      simpleChain: [
        '机器人板块今天涨2.45%，减速器和伺服电机是领头羊',
        '最近人形机器人和具身智能出了不少政策利好',
        '短线游资比较活跃，但基本面是否真正改善还需要观察',
      ],
    },
    professional: {
      storyId: 'story-3',
      conclusion:
        '机器人板块受题材催化上涨2.45%，减速器与伺服电机领涨，但资金以游资为主，基本面支撑有限。',
      drivers: [
        {
          role: 'primary',
          title: '题材催化驱动',
          explanation: '具身智能与人形机器人的政策利好和产业进展为板块提供短期催化',
          evidenceIds: [],
        },
      ],
      supportingEvidence: ['机器人板块今日涨幅2.45%', '减速器和伺服电机方向领涨'],
      evidenceGaps: ['缺少游资流入的具体数据', '未确认机构是否有参与'],
      alternativeExplanations: ['可能是个股公告带动而非行业整体逻辑', '不排除是量化策略的短期博弈'],
      counterLogic: ['机器人板块整体PE偏高', '商业化路径仍不清晰，业绩兑现期较长'],
      observationIndicators: ['连板家数是否增加', '成交额能否维持或继续放大', '是否有新的产业政策或订单公告'],
      confidence: { score: 38, level: 'limited', explanation: '引用事实2步、来源1家、推断2步，证据以行情数据为主' },
    },
    evidence: [
      {
        id: 'market-data-1',
        title: '东方财富行业行情数据',
        sourceName: '东方财富',
        kind: 'market_data',
      },
    ],
  },
];

/* ========== 板块详情（市场地图用） ========== */

export interface SectorDetail {
  sectorId: string;
  sectorName: string;
  todayChangePercent: number;
  change5d: number | null;
  change20d: number | null;
  change3m: number | null;
  stage: string;
  stageLabel: string;
  signalTags: string[];
  signalTypes: string[];
  healthMetrics: {
    upCount: number;
    totalCount: number;
    medianChange: string;
    leaderContribution: string;
    divergence: string;
    upRatio: number;
  };
  leadingStocks: Array<{
    code: string;
    name: string;
    changePercent: number;
    reason: string;
    isLeader: boolean;
    totalMarketCap: number | null;
  }>;
  laggingStocks: Array<{
    code: string;
    name: string;
    changePercent: number;
    reason: string;
  }>;
  news: Array<{
    id: string;
    title: string;
    sourceName: string;
    category: string;
    summary: string;
  }>;
  heatMetrics: {
    todayTurnover: number | null;
    turnoverChangePercent: number | null;
    turnoverVs20dAvg: number | null;
    turnoverRate: number | null;
    upRatio: number | null;
  };
  watchPoints: string[];
  exploreQuestions: string[];
  relatedChain: string[];
  internalStocks: Array<{
    code: string;
    name: string;
    changePercent: number;
    isLeader: boolean;
    reason: string;
    totalMarketCap: number | null;
  }>;
}

export function getSectorDetail(sectorId: string): SectorDetail | null {
  const sector = heatSectors.find((s) => s.id === sectorId);
  if (!sector) return null;

  const sorted = [...sector.stocks].sort((a, b) => b.changePercent - a.changePercent);
  const upCount = sorted.filter((s) => s.changePercent > 0).length;
  const top3Change = sorted.slice(0, 3).reduce((sum, s) => sum + Math.max(0, s.changePercent), 0);
  const totalPosChange = sorted.reduce((sum, s) => sum + Math.max(0, s.changePercent), 0);
  const leaderContrib = top3Change > 0 && totalPosChange > 0
    ? ((sorted[0]?.changePercent ?? 0) / totalPosChange * 100).toFixed(0) + '%'
    : '--';

  const isUp = sector.changePercent >= 0;
  const absPct = Math.abs(sector.changePercent);
  let stage: string, stageLabel: string;
  if (absPct > 4) { stage = 'strengthening'; stageLabel = '持续走强'; }
  else if (absPct > 2) { stage = 'just_starting'; stageLabel = '刚刚启动'; }
  else if (isUp) { stage = 'high_volatility'; stageLabel = '高位震荡'; }
  else if (absPct > 2) { stage = 'pullback'; stageLabel = '冲高回落'; }
  else if (absPct > 4) { stage = 'cooling_down'; stageLabel = '逐步降温'; }
  else { stage = 'no_clear_trend'; stageLabel = '暂无明确趋势'; }

  const tags: string[] = [];
  if (absPct >= 3) tags.push('异动上涨');
  if (sorted.length > 0 && sorted[0].changePercent > 5) tags.push('今日主线');
  if (tags.length === 0) tags.push('值得观察');

  return {
    sectorId: sector.id,
    sectorName: sector.name,
    todayChangePercent: sector.changePercent,
    change5d: null,
    change20d: null,
    change3m: null,
    stage,
    stageLabel,
    signalTags: tags,
    signalTypes: [],
    healthMetrics: {
      upCount,
      totalCount: sorted.length,
      medianChange: '--',
      leaderContribution: leaderContrib,
      divergence: 'moderate',
      upRatio: sorted.length > 0 ? Math.round((upCount / sorted.length) * 100) : 0,
    },
    leadingStocks: sorted.slice(0, 3).map((s, i) => ({
      code: s.code,
      name: s.name,
      changePercent: s.changePercent,
      reason: i === 0 ? '板块龙头，带动效应明显' : i === 1 ? '受益于行业趋势' : '跟随板块整体走强',
      isLeader: i === 0,
      totalMarketCap: null,
    })),
    laggingStocks: sorted.slice(-2).reverse().map((s) => ({
      code: s.code,
      name: s.name,
      changePercent: s.changePercent,
      reason: '板块内部表现较弱',
    })),
    news: [],
    heatMetrics: {
      todayTurnover: null,
      turnoverChangePercent: null,
      turnoverVs20dAvg: null,
      turnoverRate: null,
      upRatio: sorted.length > 0 ? Math.round((upCount / sorted.length) * 100) : null,
    },
    watchPoints: ['成交额是否继续放大', '上涨是否扩散', '龙头股能否保持强势'],
    exploreQuestions: [`为什么${sector.name}今天表现突出？`, `${sector.name}现在处于什么阶段？`],
    relatedChain: ['上游供给', '行业需求', sector.name],
    internalStocks: sorted.slice(0, 5).map((s, i) => ({
      code: s.code,
      name: s.name,
      changePercent: s.changePercent,
      isLeader: i === 0,
      reason: i === 0 ? '板块龙头' : i < 3 ? '强势跟涨' : '温和上涨',
      totalMarketCap: null,
    })),
  };
}

/* ========== AI Bubble 问答 (mock) ========== */

export interface BubbleCard {
  k: string;
  v: string;
  tone?: 'up' | 'down' | 'neutral';
}

export interface BubbleLeader {
  code: string;
  name: string;
  pct: number;
  isLeader: boolean;
  reason: string;
}

export interface BubbleReply {
  text: string;
  cards: BubbleCard[];
  leaders: BubbleLeader[];
  closing?: string;
  followups: string[];
  sources: string[];
  sectorId?: string;
}

function generateBubbleReply(query: string, sectorId?: string): BubbleReply {
  const sector = sectorId ? heatSectors.find((s) => s.id === sectorId) : null;
  const sectorName = sector?.name || '该板块';
  const sorted = sector ? [...sector.stocks].sort((a, b) => b.changePercent - a.changePercent) : [];
  const pctText = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;

  const leaders: BubbleLeader[] = sorted.slice(0, 3).map((s, i) => ({
    code: s.code,
    name: s.name,
    pct: s.changePercent,
    isLeader: i === 0,
    reason: i === 0 ? '板块龙头，带动效应明显' : i === 1 ? '受益于行业趋势' : '跟随板块整体走强',
  }));

  const cards: BubbleCard[] = [];
  if (sector) {
    cards.push({ k: '板块涨跌', v: pctText(sector.changePercent), tone: sector.changePercent >= 0 ? 'up' : 'down' });
    if (sorted.length > 0) {
      const upCount = sorted.filter((s) => s.changePercent > 0).length;
      cards.push({ k: '上涨家数', v: `${upCount}/${sorted.length}`, tone: upCount > sorted.length / 2 ? 'up' : 'down' });
    }
  }

  let text: string;
  let closing: string;
  let followups: string[];
  let sources: string[];

  if (query.includes('半导体') || query.includes('芯片')) {
    text = '泡泡看到，半导体设备板块今天表现活跃，成交额较昨日放大40%。这轮上涨的主要逻辑有三点：\n1️⃣ 国产替代政策持续加码，多地产业基金落地；\n2️⃣ AI算力板块高位流出资金开始向半导体切换；\n3️⃣ 中芯国际、北方华创等龙头放量突破阻力位。';
    closing = '泡泡老师提醒：板块虽活跃，但仍需关注后续成交额能否维持，以及美日荷联合出口管制的影响。目前更像是资金轮动而非基本面反转，建议保持理性，分批关注。';
    followups = ['中芯国际现在的技术面如何？', '半导体板块的估值合理吗？', '半导体设备和芯片设计哪个更值得关注？'];
    sources = ['东方财富行业板块数据', '华尔街见闻'];
  } else if (sector) {
    text = `泡泡来聊聊「${sectorName}」板块！\n\n📊 ${sectorName}今日${sector.changePercent >= 0 ? '上涨' : '下跌'}${Math.abs(sector.changePercent).toFixed(2)}%，板块内${sorted.filter((s) => s.changePercent > 0).length}/${sorted.length}只成分股上涨。\n\n🎯 泡泡发现：板块龙头${sorted[0]?.name}表现最为突出，涨幅达${pctText(sorted[0]?.changePercent || 0)}，带动效应明显。`;
    closing = '泡泡老师提醒：板块短期表现受多种因素影响，建议结合自身风险偏好理性决策。股市有风险，投资需谨慎！';
    followups = [`为什么${sectorName}今天表现这么突出？`, `${sectorName}现在处于什么阶段？`, `${sectorName}的龙头股有哪些？`];
    sources = ['东方财富行业板块数据'];
  } else {
    text = '你好，我是泡泡老师！\n\n📈 今天大盘整体偏暖，上证指数站上3026点，AI算力和半导体板块表现活跃。\n\n💡 有什么具体的板块或个股想了解吗？泡泡可以帮你分析技术面、资金面、政策面等多维度的信息！🎈';
    closing = '泡泡老师提醒：股市有风险，投资需谨慎！以上研判仅供模拟盘练习参考，不构成实盘买入建议哦。';
    followups = ['今天AI算力板块资金面怎么样？', '半导体可以追涨吗？', '帮我看看大盘的整体氛围'];
    sources = [];
  }

  return { text, cards, leaders, closing, followups, sources, sectorId };
}

export function askBubble(query: string, contextId?: string): BubbleReply {
  return generateBubbleReply(query, contextId);
}

/* ========== 个人中心（AccountPage） ========== */

export interface AccountSetting {
  id: string;
  icon: 'user' | 'bell' | 'shield' | 'info';
  label: string;
  desc: string;
}

export const accountProfile = {
  nickname: '泡泡老股民',
  avatarText: '泡',
  plan: '专业版',
  joinedAt: '2025年6月',
};

export const aiService = {
  plan: '专业版 · 年费',
  diagnosisQuota: 30,
  diagnosisUsed: 12,
  subscribedSectors: ['AI算力', '半导体', '机器人', '新能源'],
  questionCount: 128,
};

export const accountSettings: AccountSetting[] = [
  { id: 'profile', icon: 'user', label: '个人资料', desc: '修改昵称、头像等基本信息' },
  { id: 'notify', icon: 'bell', label: '通知偏好', desc: '管理板块异动、价格预警推送' },
  { id: 'security', icon: 'shield', label: '安全与登录', desc: '账号保护、退出登录' },
  { id: 'about', icon: 'info', label: '关于泡泡', desc: '版本 2.0 · 智能投研助手' },
];

export const accountSecurity = {
  loginMethod: '手机号 + 密码',
  lastLogin: '2026-07-30 09:15',
  devices: ['Windows Chrome', 'iOS Safari'],
};

/* ========== 自选股（WatchlistPage） ========== */

export type WatchlistTone = 'up' | 'down' | 'neutral';

export interface WatchlistStock {
  id: string;
  code: string;
  name: string;
  price: number;
  changePercent: number;
  changeValue: number;
  history: number[];
  sector: string;
  /** 前端展示用字段 */
  shortCode?: string;
  tag?: string;
  turnover?: string;
  turnoverRate?: string;
  spark?: number[];
  change?: number;
}

export interface WatchlistAlert {
  id: string;
  stockId: string;
  title: string;
  content: string;
  type: 'warning' | 'info' | 'success';
  time: string;
  /** 额外字段供 WatchlistPage 使用 */
  name?: string;
  condition?: string;
  current?: string;
  progress?: number;
  dir?: 'up' | 'down';
}

export interface WatchlistSector {
  id: string;
  name: string;
  changePercent: number;
  stocks: number;
}

export const watchlistStats = {
  followed: 12,
  avgChange: 2.35,
  alerts: 3,
  sectors: 4,
};

export const watchlistStocks: WatchlistStock[] = [
  {
    id: 'w1', code: '002230.SZ', name: '科大讯飞', price: 45.12, changePercent: 2.85, changeValue: 1.25,
    history: [43.2, 43.5, 43.8, 44.1, 44.3, 44.0, 44.5, 44.8, 45.0, 44.9, 45.12],
    sector: 'AI算力',
    shortCode: '002230', tag: '龙头', turnover: '13.0亿', turnoverRate: '2.85%', change: 1.25,
    spark: [43.2, 43.5, 43.8, 44.1, 44.3, 44.0, 44.5, 44.8, 45.0, 44.9, 45.12],
  },
  {
    id: 'w2', code: '688981.SH', name: '中芯国际', price: 53.42, changePercent: 4.21, changeValue: 2.16,
    history: [51.0, 51.3, 51.6, 51.8, 52.1, 52.0, 52.4, 52.8, 53.1, 53.2, 53.42],
    sector: '半导体',
    shortCode: '688981', tag: '龙头', turnover: '20.3亿', turnoverRate: '3.12%', change: 2.16,
    spark: [51.0, 51.3, 51.6, 51.8, 52.1, 52.0, 52.4, 52.8, 53.1, 53.2, 53.42],
  },
  {
    id: 'w3', code: '688017.SH', name: '绿的谐波', price: 122.35, changePercent: 4.65, changeValue: 5.43,
    history: [117.0, 117.8, 118.5, 119.2, 120.0, 119.8, 120.5, 121.2, 121.8, 122.0, 122.35],
    sector: '机器人',
    shortCode: '688017', tag: '热点', turnover: '8.7亿', turnoverRate: '4.56%', change: 5.43,
    spark: [117.0, 117.8, 118.5, 119.2, 120.0, 119.8, 120.5, 121.2, 121.8, 122.0, 122.35],
  },
  {
    id: 'w4', code: '600519.SH', name: '贵州茅台', price: 1650.0, changePercent: -0.32, changeValue: -5.30,
    history: [1660, 1658, 1655, 1652, 1651, 1650, 1649, 1648, 1649, 1650, 1650],
    sector: '白酒消费',
    shortCode: '600519', turnover: '45.2亿', turnoverRate: '0.12%', change: -5.30,
    spark: [1660, 1658, 1655, 1652, 1651, 1650, 1649, 1648, 1649, 1650, 1650],
  },
];

export const watchlistAlerts: WatchlistAlert[] = [
  {
    id: 'wa1', stockId: 'w1', title: '科大讯飞盘中拉升', content: '股价突破45元关口，成交量较昨日放大35%',
    type: 'info', time: '10:32',
    name: '科大讯飞', condition: '≥45.00', current: '45.12', progress: 82, dir: 'up',
  },
  {
    id: 'wa2', stockId: 'w2', title: '中芯国际放量上攻', content: '半导体板块资金流入明显，建议关注后续走势',
    type: 'success', time: '09:50',
    name: '中芯国际', condition: '≥53.50', current: '53.42', progress: 95, dir: 'up',
  },
  {
    id: 'wa3', stockId: 'w4', title: '贵州茅台小幅承压', content: '白酒消费板块走弱，茅台缩量回调0.32%',
    type: 'warning', time: '11:05',
    name: '贵州茅台', condition: '≤1640.00', current: '1650.00', progress: 38, dir: 'down',
  },
];

export const watchlistSectors: WatchlistSector[] = [
  { id: 'ai-compute', name: 'AI算力', changePercent: 4.32, stocks: 42 },
  { id: 'semiconductor', name: '半导体', changePercent: 3.28, stocks: 68 },
  { id: 'robot', name: '机器人', changePercent: 2.45, stocks: 28 },
  { id: 'consumer', name: '白酒消费', changePercent: -0.45, stocks: 18 },
];
