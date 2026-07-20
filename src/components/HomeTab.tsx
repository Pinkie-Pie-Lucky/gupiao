/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, TrendingUp, TrendingDown, ChevronRight, X, AlertTriangle, ArrowUpRight, Award, MessageSquare, Flame, BarChart2, Activity, BookOpen, Sun, GraduationCap, RefreshCw } from 'lucide-react';
import { MarketIndex, StockSector, PersonalizedAlert } from '../types';
import { formatChineseDate, initialSectors, initialAlerts } from '../data';
import { InteractiveChart } from './InteractiveChart';

const LEARNING_KNOWLEDGE = [
  {
    title: '什么叫"放量"？',
    explanation: '放量就是今天成交的人比平时更多，通常意味着这次上涨（或下跌）更容易得到市场认可。'
  },
  {
    title: '什么是"回踩"？',
    explanation: '回踩就像是跑步跑累了，退回到前一个台阶（支撑位）确认支撑强度，如果站稳了就会继续往上冲！'
  },
  {
    title: '什么是"换手率"？',
    explanation: '换手率代表今天有多少比例的股票换了新主人。换手率高说明交投活跃，买卖双方博弈非常激烈。'
  },
  {
    title: '什么是"超买"？',
    explanation: '超买就是短时间内买的人太多太疯狂，价格被推得过高，犹如橡皮筋拉得太紧，短期容易面临回调修正。'
  },
  {
    title: '什么是"洗盘"？',
    explanation: '洗盘是主力资金故意砸盘震荡，让不坚定的散户因恐慌离场，从而洗净浮动筹码，为后市拉升做准备。'
  },
  {
    title: '什么是"底背离"？',
    explanation: '底背离指股价还在跌并创出新低，但技术指标（如MACD）却开始逐波走高，通常预示下跌动能衰竭，可能见底。'
  }
];

interface HomeTabProps {
  onSelectSector: (sectorId: string) => void;
  onNavigateToTab: (tabId: string) => void;
  onAskTeacherAboutStock: (stockName: string, stockCode: string) => void;
  followedStocks?: { name: string; code: string; price: number; changePercent: number }[];
}

export function HomeTab({ onSelectSector, onNavigateToTab, onAskTeacherAboutStock, followedStocks = [] }: HomeTabProps) {
  const [indices, setIndices] = useState<MarketIndex[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<MarketIndex | null>(null);
  const [selectedAlert, setSelectedAlert] = useState<PersonalizedAlert | null>(null);
  const [selectedSector, setSelectedSector] = useState<StockSector | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isReasonOpen, setIsReasonOpen] = useState(false);
  const [knowledgeIndex, setKnowledgeIndex] = useState(() => {
    return Math.floor(Math.random() * LEARNING_KNOWLEDGE.length);
  });

  // Morning report from AI pipeline
  const [morningReport, setMorningReport] = useState<{
    summaryText: string;
    reasonBrief: string;
    top3Themes: { title: string; evidence: string; chain: any }[];
    sentiment: string;
    loading: boolean;
  }>({ summaryText: '', reasonBrief: '', top3Themes: [], sentiment: '中性', loading: true });

  // 市场状态（交易时段判断）
  const [marketStatus, setMarketStatus] = useState<{
    isOpen: boolean;
    phase: string;
    label: string;
  } | null>(null);

  // Market overview from rule engine
  const [marketOverview, setMarketOverview] = useState<{
    topSectors: { name: string; changePercent: number }[];
    bottomSectors: { name: string; changePercent: number }[];
    marketBreath: { up: number; down: number; breadthRatio?: number };
    totalVolume?: number;
  } | null>(null);

  // 数据是否成功加载
  const [dataError, setDataError] = useState<string | null>(null);
  // 缓存天气和情绪计算结果，避免每次渲染重新触发动画
  const [cachedWeather, setCachedWeather] = useState({
    emoji: '❓', text: '暂无数据', bg: 'bg-gray-50 border-gray-200 text-gray-500', temp: 50,
    label: '加载中', desc: ''
  });

  // 当指数数据变更时才重新计算天气/情绪（而非每次渲染）
  useEffect(() => {
    if (indices.length === 0) {
      if (dataError) {
        setCachedWeather({ emoji: '⚠️', text: '数据异常', bg: 'bg-yellow-50 border-yellow-200 text-yellow-700', temp: 0, label: '数据异常', desc: '行情数据获取失败' });
      }
      return;
    }
    const avg = indices.reduce((acc, idx) => acc + idx.changePercent, 0) / indices.length;
    const base = morningReport.sentiment === '乐观' ? 72 : morningReport.sentiment === '中性' ? 50 : 28;
    const adj = Math.round(avg * 3);
    const temp = Math.round(Math.min(90, Math.max(10, base + adj)));
    const label = morningReport.sentiment === '乐观' ? '情绪偏多' : morningReport.sentiment === '中性' ? '多空平衡' : '情绪偏空';
    const desc = morningReport.sentiment === '乐观'
      ? (temp >= 80 ? '极度贪婪' : temp >= 65 ? '中度看涨' : '温和偏多')
      : morningReport.sentiment === '中性' ? '方向不明'
      : (temp <= 15 ? '极度恐慌' : temp <= 30 ? '明显偏空' : '谨慎偏空');

    if (avg > 1.2) {
      setCachedWeather({ emoji: '🔥', text: '烈日狂飙 / 极度看涨 📈', bg: 'bg-rose-50 border-rose-100 text-rose-700', temp, label, desc });
    } else if (avg > 0) {
      setCachedWeather({ emoji: '☀️', text: '温和晴朗 / 科技吸金 📈', bg: 'bg-amber-50 border-amber-100 text-amber-700', temp, label, desc });
    } else if (avg > -0.5) {
      setCachedWeather({ emoji: '⛅', text: '多云转阴 / 区间震荡 ⚖️', bg: 'bg-slate-100 border-slate-200 text-slate-700', temp, label, desc });
    } else {
      setCachedWeather({ emoji: '🌧️', text: '暴风雨临 / 避险防御 📉', bg: 'bg-indigo-50 border-indigo-100 text-indigo-700', temp, label, desc });
    }
  }, [indices, morningReport.sentiment, dataError]);

  async function loadMarketOverview({ cancelled }: { cancelled: boolean }) {
    try {
      const overviewRes = await fetch('/api/market-overview');
      if (!overviewRes.ok) {
        const errData = await overviewRes.json().catch(() => ({}));
        if (!cancelled) {
          setMorningReport(prev => ({ ...prev, loading: false }));
          setDataError(errData?.error || '当前行情数据获取失败');
          setIndices([]);
        }
        return;
      }

      const overviewData = await overviewRes.json();
      if (!cancelled) {
        setMarketOverview(overviewData);
        setMarketStatus(overviewData.marketStatus || null);
        if (overviewData.indices?.length) {
          setIndices(overviewData.indices.map((i: any) => ({
            name: i.name,
            code: i.code,
            value: i.price,
            changePercent: i.changePercent,
            changeValue: parseFloat((i.price * i.changePercent / 100).toFixed(2)),
            history: [],
          })));
        }
      }
    } catch {
      if (!cancelled) {
        setMorningReport(prev => ({ ...prev, loading: false }));
        setDataError('当前行情数据获取失败，请检查网络连接');
        setIndices([]);
      }
    }
  }

  useEffect(() => {
    let cancelled = false;

    // 首次加载 + 早报
    async function initLoad() {
      await loadMarketOverview({ cancelled });
      if (!cancelled) {
        try {
          const reportRes = await fetch('/api/morning-report').then(r => r.json());
          if (!cancelled && !reportRes.fallback) {
            setMorningReport({ ...reportRes, loading: false });
          } else if (!cancelled) {
            setMorningReport(prev => ({ ...prev, loading: false }));
          }
        } catch {
          if (!cancelled) setMorningReport(prev => ({ ...prev, loading: false }));
        }
      }
    }
    initLoad();

    // 自动刷新行情（仅交易时段每 10 秒刷新一次）
    const autoRefresh = setInterval(() => {
      // 白天9:30-15:00交易时段才刷新
      const h = new Date().getHours();
      const m = new Date().getMinutes();
      const t = h * 100 + m;
      const isTrading = h >= 9 && h < 15 && !(h === 9 && m < 30) && !(h >= 11 && h < 13);
      if (isTrading) {
        loadMarketOverview({ cancelled });
      }
    }, 10000);

    return () => {
      cancelled = true;
      clearInterval(autoRefresh);
    };
  }, []);

  // Dynamic market weather calculation based on simulated indices
  const averageChange = indices.length > 0
    ? indices.reduce((acc, idx) => acc + idx.changePercent, 0) / indices.length
    : 0;
  let weatherEmoji = '❓';
  let weatherText = '暂无数据';
  let weatherBg = 'bg-gray-50 border-gray-200 text-gray-500';
  if (dataError) {
    weatherEmoji = '⚠️';
    weatherText = '数据异常';
    weatherBg = 'bg-yellow-50 border-yellow-200 text-yellow-700';
  } else if (indices.length > 0) {
    if (averageChange > 1.2) {
      weatherEmoji = '🔥';
      weatherText = '烈日狂飙 / 极度看涨 📈';
      weatherBg = 'bg-rose-50 border-rose-100 text-rose-700';
    } else if (averageChange > 0) {
      weatherEmoji = '☀️';
      weatherText = '温和晴朗 / 科技吸金 📈';
      weatherBg = 'bg-amber-50 border-amber-100 text-amber-700';
    } else if (averageChange > -0.5) {
      weatherEmoji = '⛅';
      weatherText = '多云转阴 / 区间震荡 ⚖️';
      weatherBg = 'bg-slate-100 border-slate-200 text-slate-700';
    } else {
      weatherEmoji = '🌧️';
      weatherText = '暴风雨临 / 避险防御 📉';
      weatherBg = 'bg-indigo-50 border-indigo-100 text-indigo-700';
    }
  }

  const sentimentBase = morningReport.sentiment === '乐观' ? 72 : morningReport.sentiment === '中性' ? 50 : 28;
  const sentimentAdjust = Math.round(averageChange * 3);
  const sentimentTemp = indices.length > 0
    ? Math.round(Math.min(90, Math.max(10, sentimentBase + sentimentAdjust)))
    : 0;
  const sentimentLabel =
    dataError ? '数据异常'
    : morningReport.sentiment === '乐观' ? '情绪偏多'
    : morningReport.sentiment === '中性' ? '多空平衡'
    : '情绪偏空';
  const sentimentDesc =
    dataError ? '行情数据获取失败'
    : morningReport.sentiment === '乐观'
      ? (sentimentTemp >= 80 ? '极度贪婪' : sentimentTemp >= 65 ? '中度看涨' : '温和偏多')
      : morningReport.sentiment === '中性'
      ? '方向不明'
      : (sentimentTemp <= 15 ? '极度恐慌' : sentimentTemp <= 30 ? '明显偏空' : '谨慎偏空');

  // 今日一句话成长金句
  const [growthQuote, setGrowthQuote] = useState('');
  const GROWTH_QUOTES = [
    '今天的投资思维：不要只关注涨了什么，更要关注为什么涨。',
    '今天的投资思维：一次上涨不代表趋势改变，连续观察比一次判断更重要。',
    '今天的投资思维：市场恐慌的时候，往往是机会开始的时候。',
    '今天的投资思维：投资不是赌博，看不懂的时候就先别出手。',
    '今天的投资思维：学会等待，比学会操作更难，也更重要。',
    '今天的投资思维：亏钱不可怕，可怕的是不知道为什么亏。',
    '今天的投资思维：分散不是买很多只股票，而是买不同逻辑的资产。',
    '今天的投资思维：好公司不等于好股票，价格也很重要。',
    '今天的投资思维：别人贪婪时我恐惧，别人恐惧时我贪婪。',
    '今天的投资思维：没有人能每次都预测对，重要的是控制风险。',
    '今天的投资思维：短期的涨跌只是情绪，长期的价值才是根本。',
    '今天的投资思维：如果你不愿持有一只股票十年，那十分钟也不要持有。',
    '今天的投资思维：市场永远有机会，但本金只有一次。',
    '今天的投资思维：学习投资的第一步，是学会承认自己不懂。',
    '今天的投资思维：牛市赚的钱，往往会在熊市还回去。',
    '今天的投资思维：最好的投资策略是适合自己性格的策略。',
    '今天的投资思维：不要因为涨了就觉得是自己厉害，不要因为跌了就觉得是运气不好。',
    '今天的投资思维：每个新手都会经历"自信→怀疑→恐惧→理性"的过程。',
    '今天的投资思维：真正的风险不是波动，而是永久性损失。',
    '今天的投资思维：投资最难的不是技术，而是管住自己的手。',
    '今天的投资思维：数据和事实比消息和感觉更可靠。',
    '今天的投资思维：市场短期是投票机，长期是称重机。',
    '今天的投资思维：当你觉得所有人都赚钱了，那可能已经到尾声了。',
    '今天的投资思维：闲钱投资，才能在市场波动中保持冷静。',
    '今天的投资思维：不断学习的人，最终会打败那些只想打听消息的人。',
    '今天的投资思维：最贵的教训往往来自于"这次不一样"的错觉。',
    '今天的投资思维：看懂一个行业，比跟风十个热点更有价值。',
    '今天的投资思维：交易越频繁，收益越容易被费用吃掉。',
    '今天的投资思维：不买自己不理解的东西，是最基本的投资原则。',
    '今天的投资思维：复利是世界第八大奇迹，前提是你给它足够的时间。',
    '今天的投资思维：每天都看盘的人，往往比每周看盘的人赚得少。',
    '今天的投资思维：好消息已经反映在价格里了，坏消息也一样。',
    '今天的投资思维：与其预测明天天气，不如准备一把伞。',
    '今天的投资思维：知道自己不知道，比不知道更重要。',
    '今天的投资思维：世界上没有免费的午餐，高收益一定有高风险。',
    '今天的投资思维：投资是马拉松，不是百米冲刺。',
    '今天的投资思维：不要把所有鸡蛋放在一个篮子里，但也别放在太多篮子里。',
    '今天的投资思维：成功投资者的共同点：耐心、纪律、独立思考。',
    '今天的投资思维：市场总是在绝望中诞生，在犹豫中上涨，在乐观中消亡。',
    '今天的投资思维：今天的学习，是为了明天更从容地面对市场波动。',
  ];

  // 初始化金句
  useEffect(() => {
    setGrowthQuote(GROWTH_QUOTES[Math.floor(Math.random() * GROWTH_QUOTES.length)]);
  }, []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    
    const query = searchQuery.toLowerCase();
    let foundSector = initialSectors.find(s => s.name.toLowerCase().includes(query));
    let foundStock: any = null;
    
    for (const s of initialSectors) {
      const st = s.stocks.find(stock => 
        stock.name.toLowerCase().includes(query) || stock.code.includes(query)
      );
      if (st) {
        foundStock = st;
        foundSector = s;
        break;
      }
    }

    if (foundStock) {
      onAskTeacherAboutStock(foundStock.name, foundStock.code);
      onNavigateToTab('ai-teacher');
    } else if (foundSector) {
      onSelectSector(foundSector.id);
      onNavigateToTab('market-map');
    } else {
      onNavigateToTab('ai-teacher');
      setTimeout(() => {
        const customEvent = new CustomEvent('trigger-ai-chat', { detail: searchQuery });
        window.dispatchEvent(customEvent);
      }, 100);
    }
    setSearchQuery('');
    setIsSearching(false);
  };

  return (
    <div id="home-tab-view" className="space-y-5 pb-24">
      {/* Search Bar Header */}
      <div id="home-header-row" className="flex justify-between items-center px-4 pt-2">
        {!isSearching ? (
          <>
            <h1 id="app-brand-title" className="text-2xl font-bold font-sans tracking-tight text-gray-950 flex items-center gap-1.5">
              泡泡看市
              <span className="w-2 h-2 rounded-full bg-indigo-600 inline-block animate-pulse"></span>
            </h1>
            <button
              id="search-trigger-btn"
              onClick={() => setIsSearching(true)}
              className="p-2 bg-gray-50 rounded-full hover:bg-gray-100 transition-all text-gray-700 hover:scale-105 active:scale-95 shadow-sm border border-gray-100"
            >
              <Search className="w-4 h-4" />
            </button>
          </>
        ) : (
          <form id="search-input-form" onSubmit={handleSearchSubmit} className="flex-grow flex items-center gap-2">
            <div className="relative flex-grow">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input
                id="search-global-input"
                type="text"
                placeholder="搜索行业或个股，直接连线泡泡老师..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
                className="w-full bg-gray-50 text-gray-900 placeholder-gray-400 pl-10 pr-4 py-2 rounded-full border border-gray-200 focus:outline-none focus:border-indigo-500 focus:bg-white text-xs transition-all"
              />
            </div>
            <button
              id="search-cancel-btn"
              type="button"
              onClick={() => setIsSearching(false)}
              className="text-xs font-bold text-gray-500 hover:text-gray-900 px-1"
            >
              取消
            </button>
          </form>
        )}
      </div>

      {/* 市场状态 Banner - 非交易时段醒目提示 */}
      {marketStatus && !marketStatus.isOpen && (
        <div className="mx-4">
          <div className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-semibold ${
            marketStatus.phase === 'weekend'
              ? 'bg-purple-50 text-purple-700 border border-purple-200'
              : marketStatus.phase === 'preopen' || marketStatus.phase === 'lunch'
                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                : 'bg-slate-50 text-slate-600 border border-slate-200'
          }`}>
            <span className={`w-2 h-2 rounded-full ${
              marketStatus.phase === 'weekend' ? 'bg-purple-400' :
              marketStatus.phase === 'preopen' || marketStatus.phase === 'lunch' ? 'bg-amber-400' :
              'bg-slate-400'
            }`}></span>
            <span>📊 当前处于 <strong>{marketStatus.label}</strong>，显示最近交易日数据仅供参考</span>
          </div>
        </div>
      )}

      {/* 顶部区域: AI老师每日早报 */}
      <div id="paopao-greeting-hero" className="mx-4 bg-white border border-slate-100 rounded-[32px] p-5 shadow-sm space-y-4">
        {/* Card Header with Module Title and Dynamic Weather */}
        <div className="flex justify-between items-center border-b border-slate-50 pb-2">
          <div className="text-xs font-bold text-gray-400 flex items-center gap-1.5">
            泡泡老师
          </div>
          {/* Dynamic Weather Badge */}
          <div className={`flex items-center gap-1 px-2.5 py-0.5 rounded-full border text-[10px] font-bold ${cachedWeather.bg} transition-all duration-300`}>
            <span>{cachedWeather.emoji} {cachedWeather.text}</span>
          </div>
        </div>

        <div className="flex gap-4 items-start">
          {/* 泡泡圆润迷你机器人头像 */}
          <div className="w-14 h-14 bg-gradient-to-br from-indigo-50 to-indigo-100 rounded-2xl flex-shrink-0 flex items-center justify-center relative shadow-inner border border-indigo-100/50">
            {/* Soft pulse background rings */}
            <div className="absolute inset-0 rounded-2xl bg-indigo-500/5 animate-ping" style={{ animationDuration: '3s' }}></div>
            <svg viewBox="0 0 120 120" className="w-10 h-10 relative z-10">
              {/* Headband band */}
              <path d="M26,55 A35,35 0 0,1 94,55" fill="none" stroke="#818CF8" strokeWidth="4.5" strokeLinecap="round" />
              {/* Ear cups */}
              <rect x="22" y="46" width="8" height="20" rx="4" fill="#4F46E5" />
              <rect x="90" y="46" width="8" height="20" rx="4" fill="#4F46E5" />
              {/* Main Face Container */}
              <rect x="30" y="34" width="60" height="48" rx="24" fill="#FFFFFF" filter="drop-shadow(0px 3px 6px rgba(99,102,241,0.1))" />
              {/* Inner Face Screen */}
              <rect x="36" y="40" width="48" height="36" rx="18" fill="#1E1B4B" />
              {/* Glowing Eyes */}
              <circle cx="48" cy="56" r="3.5" fill="#818CF8" className="animate-pulse" />
              <circle cx="72" cy="56" r="3.5" fill="#818CF8" className="animate-pulse" />
              {/* Gentle Smiling Mouth */}
              <path d="M54,66 Q60,70 66,66" fill="none" stroke="#818CF8" strokeWidth="2" strokeLinecap="round" />
              {/* Antenna */}
              <circle cx="60" cy="18" r="4.5" fill="#F59E0B" />
              <line x1="60" y1="18" x2="60" y2="34" stroke="#E2E8F0" strokeWidth="2.5" />
            </svg>
            <div className="absolute -bottom-1 -right-1 bg-emerald-500 text-white text-[8px] font-bold px-1 py-0.5 rounded-full border border-white">
              在线
            </div>
          </div>

          <div className="space-y-1 flex-grow">
            <h2 id="paopao-greeting-title" className="text-xs font-bold text-gray-950 leading-relaxed">
              {dataError
                ? `⚠️ ${dataError}，AI 早报暂时无法生成`
                : morningReport.loading
                  ? '泡泡正在为你整理今日市场动态...'
                  : morningReport.summaryText || '当前暂无实时数据，请稍后刷新重试'}
            </h2>
            <p className="text-[10px] font-semibold text-indigo-500 bg-indigo-50/50 px-2 py-0.5 rounded-md inline-block mt-1">
              AI 陪伴研读 · 5分钟懂大盘
            </p>
          </div>
        </div>

        {/* Below are the two requested buttons */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => setIsReasonOpen(true)}
            className="flex-1 bg-indigo-50 hover:bg-indigo-100/80 text-indigo-600 font-bold text-xs py-2.5 rounded-xl transition-all flex items-center justify-center gap-1.5 border border-indigo-100 active:scale-[0.98]"
          >
            <BookOpen className="w-3.5 h-3.5" />
            查看原因
          </button>
          <button
            onClick={() => onNavigateToTab('ai-teacher')}
            className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs py-2.5 rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-sm active:scale-[0.98]"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            问问老师
          </button>
        </div>
      </div>

      {/* 核心区域: 今日市场概览 */}
      <div id="today-market-overview-card" className="mx-4 bg-white border border-slate-100 rounded-[32px] p-5 shadow-sm space-y-5">
        <div className="flex justify-between items-baseline">
          <h3 className="text-base font-bold text-gray-950 flex items-center gap-1.5">
            <BarChart2 className="w-4.5 h-4.5 text-indigo-600" />
            今日市场概览
          </h3>
          <span className="flex items-center gap-2">
            {marketStatus && (
              <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${
                marketStatus.isOpen
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'bg-slate-50 text-slate-500 border border-slate-200'
              }`}>
                {marketStatus.isOpen ? '● 盘中' : '○ ' + marketStatus.label}
              </span>
            )}
            <span className="text-[10px] text-gray-400 font-medium">{formatChineseDate(new Date())}</span>
          </span>
        </div>

        {/* 1. A股指数涨跌情况 (Mini card grid) */}
        <div className="grid grid-cols-3 gap-2.5">
          {indices.map((idx) => {
            const isUp = idx.changePercent >= 0;
            return (
              <div
                key={idx.code}
                onClick={() => setSelectedIndex(idx)}
                className="bg-slate-50 hover:bg-slate-100/60 rounded-2xl p-3 border border-slate-100 cursor-pointer transition-all hover:scale-[1.02] active:scale-[0.98] group text-center"
              >
                <div className="text-[10px] font-bold text-gray-500 group-hover:text-indigo-600 transition-colors">
                  {idx.name}
                </div>
                <div className="text-xs font-mono font-bold text-slate-900 mt-1">
                  {idx.value.toFixed(1)}
                </div>
                <div className={`text-[10px] font-mono font-bold mt-1 ${isUp ? 'text-red-600' : 'text-emerald-600'}`}>
                  {isUp ? '+' : ''}{idx.changePercent}%
                </div>
              </div>
            );
          })}
        </div>

        {/* 2. 市场情绪指标 */}
        <div id="sentiment-indicator-area" className="space-y-2 pt-1">
          <div className="flex justify-between text-[11px] font-bold text-gray-500">
            <span className="flex items-center gap-1">
              情绪状态：<span className="text-indigo-600">{morningReport.loading ? '加载中...' : `${cachedWeather.label} (${cachedWeather.desc})`}</span>
            </span>
            <span className="text-indigo-600 font-mono">{cachedWeather.temp}℃ / 100℃</span>
          </div>
          <div className="relative w-full h-3 bg-gray-100 rounded-full overflow-hidden border border-gray-100/50">
            <div className="absolute inset-0 bg-gradient-to-r from-emerald-400 via-indigo-500 to-rose-500 opacity-80"></div>
            <motion.div
              className="absolute top-0 bottom-0 w-1.5 bg-white shadow-md border border-slate-300 rounded-full"
              style={{ left: `${cachedWeather.temp}%` }}
              animate={{ scaleY: [1, 1.2, 1] }}
              transition={{ repeat: Infinity, duration: 2 }}
            ></motion.div>
          </div>
          <div className="flex justify-between text-[9px] text-gray-400 font-semibold px-0.5">
            <span>极度恐慌 (10℃)</span>
            <span>多空平衡 (50℃)</span>
            <span>极度贪婪 (90℃)</span>
          </div>
        </div>

        {/* 3. 今日热点主题 */}
        <div id="hot-themes-area" className="space-y-2 pt-1">
          <div className="text-[11px] font-bold text-gray-400 flex items-center gap-1">
            <Flame className="w-3.5 h-3.5 text-orange-500" />
            今日强势吸金板块
          </div>
          <div className="flex flex-wrap gap-1.5">
            {marketOverview?.topSectors && marketOverview.topSectors.length > 0
              ? marketOverview.topSectors.map(s => (
                  <span key={s.name} className="text-[10px] font-bold bg-rose-50 text-rose-600 border border-rose-100 px-2.5 py-1 rounded-xl">
                    {s.name} {s.changePercent > 0 ? '+' : ''}{s.changePercent.toFixed(2)}%
                  </span>
                ))
              : <>
                  <span className="text-[10px] font-bold bg-rose-50 text-rose-600 border border-rose-100 px-2.5 py-1 rounded-xl">
                    AI算力 +4.32%
                  </span>
                  <span className="text-[10px] font-bold bg-red-50 text-red-600 border border-red-100 px-2.5 py-1 rounded-xl">
                    半导体国产化 +3.28%
                  </span>
                  <span className="text-[10px] font-bold bg-orange-50 text-orange-600 border border-orange-100 px-2.5 py-1 rounded-xl">
                    具身智能 +2.45%
                  </span>
                </>
            }
          </div>
        </div>
      </div>

      {/* 中间区域: 今天发生了什么 */}
      <div id="what-happened-section" className="space-y-3 px-4">
        <h3 id="events-heading" className="text-base font-bold text-gray-950 flex items-center gap-2">
          <Activity className="w-4.5 h-4.5 text-indigo-600" />
          今天发生了什么
        </h3>

        {/* 3 Cards representation of Key Events */}
        <div id="notion-events-list" className="space-y-3">
          {morningReport.top3Themes.length > 0 ? morningReport.top3Themes
            .filter((theme) => {
              // 置信度 < 30 不展示
              const score = theme.chain?.confidenceScore;
              return score === undefined || score >= 30;
            })
            .map((theme, i) => {
            const confidenceScore = theme.chain?.confidenceScore;
            const scoreColor = confidenceScore >= 80 ? 'bg-emerald-500' : confidenceScore >= 60 ? 'bg-amber-500' : 'bg-slate-300';
            return (
              <div key={i} className="bg-white border border-slate-100 rounded-3xl p-4 space-y-3 shadow-sm hover:border-indigo-100 transition-all">
                <h4 className="text-xs font-bold text-gray-950">
                  {theme.title}
                </h4>
                <div className="bg-indigo-50/30 rounded-xl p-3 border border-indigo-100/20 text-[11px] text-slate-700 leading-relaxed flex gap-2">
                  <span className="text-sm">🤖</span>
                  <div>
                    <span className="font-bold text-indigo-950">泡泡解读：</span>
                    “{theme.evidence}”
                  </div>
                </div>
                {theme.chain && confidenceScore !== undefined && confidenceScore >= 50 && (
                  <div className="bg-amber-50/40 rounded-xl p-3 border border-amber-100/30 text-[11px] text-slate-700 leading-relaxed space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-amber-800 flex items-center gap-1">
                        <span className="text-sm">🔗</span>
                        因果链
                      </span>
                      <div className="flex items-center gap-1.5">
                        <div className="w-14 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${scoreColor}`}
                            style={{ width: `${confidenceScore}%` }}
                          ></div>
                        </div>
                        <span className="text-[9px] text-slate-500 font-mono">置信度 {confidenceScore}%</span>
                      </div>
                    </div>

                    {/* 箭头式因果链 */}
                    <div className="flex flex-col items-center py-1">
                      {(theme.chain.chainSteps || [{ step: theme.chain.event, impact: 3 }, { step: theme.chain.reason, impact: 3 }]).map((step: any, si: number) => (
                        <div key={si} className="flex flex-col items-center w-full">
                          <div className="flex items-center justify-between w-full bg-white/60 rounded-xl px-3 py-2 border border-amber-200/40">
                            <span className="text-[11px] font-medium text-slate-800">{step.step}</span>
                            <span className="text-[10px] text-amber-600">{'★'.repeat(step.impact || 3)}{'☆'.repeat(5 - (step.impact || 3))}</span>
                          </div>
                          {si < (theme.chain.chainSteps || []).length - 1 && (
                            <div className="flex flex-col items-center my-0.5">
                              <span className="text-amber-400 text-[10px]">↓</span>
                            </div>
                          )}
                        </div>
                      ))}
                      {/* 如果没有 chainSteps，使用旧数据 */}
                      {!theme.chain.chainSteps && (
                        <div className="w-full space-y-0.5">
                          <div className="flex items-center justify-between w-full bg-white/60 rounded-xl px-3 py-2 border border-amber-200/40">
                            <span className="text-[11px] font-medium text-slate-800">{theme.chain.event}</span>
                          </div>
                          <div className="flex flex-col items-center my-0.5">
                            <span className="text-amber-400 text-[10px]">↓</span>
                          </div>
                          <div className="flex items-center justify-between w-full bg-white/60 rounded-xl px-3 py-2 border border-amber-200/40">
                            <span className="text-[11px] font-medium text-slate-800">{theme.chain.reason}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          }) : (
            <div className="text-center text-gray-400 text-xs py-6">
              {morningReport.loading ? 'AI 正在分析今日热点...' : '暂无可用的热点数据'}
            </div>
          )}
        </div>
      </div>

      {/* 下方区域: 市场地图入口 */}
      <div id="market-map-entrance-section" className="space-y-3 px-4">

        <div className="flex justify-between items-baseline">
          <h3 className="text-base font-bold text-gray-950">全景市场地图</h3>
          <button
            onClick={() => onNavigateToTab('market-map')}
            className="text-[11px] font-bold text-indigo-600 hover:underline flex items-center"
          >
            全屏查看 <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Dynamic heatmap blocks with real data from marketOverview */}
        <div className="grid grid-cols-2 gap-2.5">
          {(marketOverview?.topSectors || []).slice(0, 4).map((s, i) => {
            const isUp = s.changePercent >= 0;
            const bgColors = [
              { bg: 'bg-rose-50', border: 'border-rose-100', text: 'text-rose-800', pct: isUp ? 'text-rose-600' : 'text-emerald-600', label: '' },
              { bg: 'bg-red-50', border: 'border-red-100', text: 'text-red-800', pct: isUp ? 'text-red-600' : 'text-emerald-600', label: '' },
              { bg: 'bg-orange-50', border: 'border-orange-100', text: 'text-orange-800', pct: isUp ? 'text-orange-600' : 'text-emerald-600', label: '' },
              { bg: 'bg-emerald-50', border: 'border-emerald-100', text: 'text-emerald-800', pct: isUp ? 'text-emerald-600' : 'text-emerald-600', label: '' },
            ];
            const c = bgColors[i] || bgColors[0];
            return (
              <div
                key={s.name}
                onClick={() => onNavigateToTab('market-map')}
                className={`${c.bg} border ${c.border} hover:${c.bg.replace('50', '100/60')} p-4 rounded-2xl flex flex-col justify-between h-24 cursor-pointer transition-all hover:scale-[1.02] active:scale-[0.98]`}
              >
                <span className={`text-xs font-bold ${c.text}`}>{s.name}</span>
                <div className="text-right">
                  <span className={`text-lg font-mono font-bold ${c.pct}`}>{isUp ? '+' : ''}{s.changePercent.toFixed(2)}%</span>
                  <p className="text-[9px] text-gray-500 font-semibold mt-0.5">实时数据</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 今日一句话成长 */}
      <div id="growth-quote-card" className="mx-4 px-5 py-4 bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-100 rounded-3xl shadow-sm">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 bg-indigo-100 rounded-xl flex items-center justify-center flex-shrink-0 text-lg">
            💡
          </div>
          <div>
            <p className="text-[10px] font-bold text-indigo-400 mb-1">今日投资思维</p>
            <p className="text-xs font-medium text-indigo-900 leading-relaxed">
              {growthQuote || '学会等待，比学会操作更难，也更重要。'}
            </p>
          </div>
        </div>
      </div>

      {/* 今天与你有关 */}
      <div id="related-to-you-card" className="mx-4 bg-white border border-slate-100 rounded-[32px] p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm">👤</span>
          <span className="text-xs font-bold text-gray-700">今天与你有关</span>
        </div>
        <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
          {followedStocks && followedStocks.length > 0 ? (
            <div className="space-y-3">
              <p className="text-[10px] text-gray-400 font-medium mb-2">根据你的关注动态</p>
              {followedStocks.slice(0, 3).map((stock) => {
                const isUp = stock.changePercent >= 0;
                return (
                  <div key={stock.code} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full ${isUp ? 'bg-red-400' : 'bg-emerald-400'}`}></span>
                      <span className="text-xs font-semibold text-gray-800">{stock.name}</span>
                    </div>
                    <span className={`text-[10px] font-mono font-bold ${isUp ? 'text-red-500' : 'text-emerald-500'}`}>
                      {isUp ? '+' : ''}{stock.changePercent}%
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-gray-400 text-center py-2">
              今天没有影响你关注内容的重要事件，可以安心休息 😊
            </p>
          )}
        </div>
      </div>

      {/* 今日学习（泡泡老师指导）- 放在页面最底部 */}
      <div id="paopao-daily-learning-card" className="mx-4 bg-white border border-slate-100 rounded-[32px] p-5 shadow-sm space-y-3.5">
        <div className="flex justify-between items-center border-b border-slate-50 pb-2">
          <div className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
            <GraduationCap className="w-4 h-4 text-indigo-600" />
            <span>今日学习 <span className="text-gray-400 font-normal">（泡泡老师指导）</span></span>
          </div>
          <button
            onClick={() => {
              setKnowledgeIndex((prev) => (prev + 1) % LEARNING_KNOWLEDGE.length);
            }}
            className="text-[10px] text-indigo-600 hover:text-indigo-700 font-bold flex items-center gap-1 bg-indigo-50/50 hover:bg-indigo-50 px-2.5 py-0.5 rounded-full transition-colors active:scale-95"
          >
            <RefreshCw className="w-2.5 h-2.5" />
            换个知识
          </button>
        </div>

        <div className="space-y-2">
          <h4 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
            <span>📚 今天学会：</span>
            <span className="text-indigo-600 underline decoration-indigo-200 decoration-2 underline-offset-2">
              {LEARNING_KNOWLEDGE[knowledgeIndex].title}
            </span>
          </h4>
          
          <div className="bg-slate-50 border border-slate-100/80 rounded-2xl p-3.5 space-y-1">
            <div className="text-[10px] font-bold text-slate-400">一句话解释：</div>
            <p className="text-xs text-slate-700 font-medium leading-relaxed">
              {LEARNING_KNOWLEDGE[knowledgeIndex].explanation}
            </p>
          </div>
        </div>
      </div>

      {/* Interactive Modal Sheet for Index Detail Info */}
      <AnimatePresence>
        {selectedIndex && (
          <div id="index-details-overlay" className="fixed inset-0 bg-slate-950/40 backdrop-blur-sm z-50 flex items-end justify-center">
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 220 }}
              id="index-details-sheet"
              className="bg-white rounded-t-[32px] w-full max-w-md p-6 pb-8 border-t border-gray-100 shadow-2xl space-y-6 max-h-[85vh] overflow-y-auto"
            >
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md">{selectedIndex.code}</span>
                  <span className="text-xs text-gray-400 font-bold">大盘核心走势</span>
                </div>
                <button
                  id="btn-close-index-modal"
                  onClick={() => setSelectedIndex(null)}
                  className="p-1.5 bg-gray-50 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-700 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div>
                <h3 id="sheet-index-name" className="text-2xl font-bold text-gray-950">{selectedIndex.name}</h3>
                <div className="flex gap-4 items-baseline mt-2">
                  <span className="text-3xl font-mono font-bold tracking-tight text-slate-900">
                    {selectedIndex.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className={`text-sm font-mono font-bold ${selectedIndex.changePercent >= 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                    {selectedIndex.changePercent >= 0 ? '+' : ''}{selectedIndex.changePercent}%
                  </span>
                </div>
              </div>

              {/* Chart */}
              <InteractiveChart
                data={selectedIndex.history}
                title={`${selectedIndex.name} 日内趋势走势`}
                symbolCode={selectedIndex.code}
                isPositive={selectedIndex.changePercent >= 0}
              />

              <div className="space-y-2 text-xs text-gray-600 leading-relaxed bg-slate-50 rounded-2xl p-4 border border-slate-100">
                <p className="font-bold text-indigo-950 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-600"></span>
                  指数说明：
                </p>
                <p className="font-medium text-slate-600">
                  {selectedIndex.name}（代码 {selectedIndex.code}）反映A股市场整体走势。其中代码的前缀"000001"代表上交所，"399001"代表深交所，是交易所分配给各个指数的唯一标识。
                </p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Interactive Modal Sheet for AI Morning Report Reasons */}
      <AnimatePresence>
        {isReasonOpen && (
          <div id="morning-report-reasons-overlay" className="fixed inset-0 bg-slate-950/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              id="morning-report-reasons-sheet"
              className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-2xl space-y-5 max-h-[85vh] overflow-y-auto"
            >
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md">早报原因解读</span>
                  <span className="text-xs text-gray-400 font-bold">泡泡投研观察</span>
                </div>
                <button
                  id="btn-close-reasons-modal"
                  onClick={() => setIsReasonOpen(false)}
                  className="p-1.5 bg-gray-50 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-700 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* 聚焦于因果分析，不再重复展示top3Themes */}
              <div className="space-y-4">
                <div className="flex gap-3 items-start">
                  <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center text-lg flex-shrink-0">
                    💡
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-gray-900">为什么今天会这样？</h3>
                    <p className="text-[10px] text-gray-400 mt-0.5 font-medium">根据市场数据进行的驱动因素分析</p>
                  </div>
                </div>

                {morningReport.reasonBrief ? (
                  <div className="bg-indigo-50/40 rounded-2xl p-4 border border-indigo-100/50">
                    {morningReport.reasonBrief.split(/(?=[①②③])/).map((segment, idx) => (
                      segment.trim() ? (
                        <p key={idx} className="text-[12px] text-slate-700 leading-relaxed font-medium mb-2 last:mb-0">
                          {segment}
                        </p>
                      ) : null
                    ))}
                  </div>
                ) : (
                  <div className="space-y-3 pt-1">
                    {morningReport.top3Themes.length > 0 ? morningReport.top3Themes.map((theme, i) => (
                      <div key={i} className="bg-slate-50 border border-slate-100 rounded-2xl p-4 space-y-1.5">
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md">
                            {i === 0 ? '核心催化' : i === 1 ? '资金风向' : '流动性保障'}
                          </span>
                        </div>
                        <p className="text-xs font-bold text-gray-900">{theme.title}</p>
                        <p className="text-[11px] text-slate-600 leading-relaxed font-medium">
                          {theme.evidence}
                          {theme.chain && (
                            <span className="block mt-1 text-indigo-600 font-medium">
                              因果链: {theme.chain.event} → {theme.chain.reason}
                            </span>
                          )}
                        </p>
                      </div>
                    )) : (
                      <div className="text-center text-gray-400 text-xs py-6">
                        {morningReport.loading ? 'AI 引擎分析中...' : '暂无可用的市场分析数据'}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => {
                    setIsReasonOpen(false);
                    onNavigateToTab('ai-teacher');
                  }}
                  className="flex-grow bg-indigo-600 text-white font-semibold text-xs py-3 rounded-xl hover:bg-indigo-700 transition-colors shadow-sm flex items-center justify-center gap-1.5"
                >
                  <MessageSquare className="w-4 h-4" />
                  对科技板块还有疑问？去问泡泡
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
