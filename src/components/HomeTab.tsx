/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, TrendingUp, TrendingDown, ChevronRight, X, AlertTriangle, ArrowUpRight, Award, MessageSquare, Flame, BarChart2, Activity, BookOpen, Sun, GraduationCap, RefreshCw } from 'lucide-react';
import { MarketIndex, StockSector, PersonalizedAlert } from '../types';
import { formatChineseDate, initialIndices, initialSectors, initialAlerts } from '../data';
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
}

export function HomeTab({ onSelectSector, onNavigateToTab, onAskTeacherAboutStock }: HomeTabProps) {
  const [indices, setIndices] = useState<MarketIndex[]>(initialIndices);
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
    top3Themes: { title: string; evidence: string; chain: any }[];
    sentiment: string;
    loading: boolean;
  }>({ summaryText: '', top3Themes: [], sentiment: '中性', loading: true });

  // Market overview from rule engine
  const [marketOverview, setMarketOverview] = useState<{
    topSectors: { name: string; changePercent: number }[];
    bottomSectors: { name: string; changePercent: number }[];
    marketBreath: { up: number; down: number };
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      try {
        const [reportRes, overviewRes] = await Promise.all([
          fetch('/api/morning-report').then(r => r.json()),
          fetch('/api/market-overview').then(r => r.json()),
        ]);
        if (!cancelled) {
          if (!reportRes.fallback) {
            setMorningReport({ ...reportRes, loading: false });
          } else {
            setMorningReport(prev => ({ ...prev, loading: false }));
          }
          setMarketOverview(overviewRes);
          if (overviewRes.indices?.length) {
            setIndices(overviewRes.indices.map((i: any) => ({
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
        if (!cancelled) setMorningReport(prev => ({ ...prev, loading: false }));
      }
    }
    loadData();
    return () => { cancelled = true; };
  }, []);

  // Dynamic market weather calculation based on simulated indices
  const averageChange = indices.reduce((acc, idx) => acc + idx.changePercent, 0) / indices.length;
  let weatherEmoji = '☀️';
  let weatherText = '晴空万里 / 多头活跃 📈';
  let weatherBg = 'bg-amber-50 border-amber-100 text-amber-700';
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

  const sentimentBase = morningReport.sentiment === '乐观' ? 72 : morningReport.sentiment === '中性' ? 50 : 28;
  const sentimentAdjust = Math.round(averageChange * 3);
  const sentimentTemp = Math.round(Math.min(90, Math.max(10, sentimentBase + sentimentAdjust)));
  const sentimentLabel =
    morningReport.sentiment === '乐观' ? '情绪偏多'
    : morningReport.sentiment === '中性' ? '多空平衡'
    : '情绪偏空';
  const sentimentDesc =
    morningReport.sentiment === '乐观'
      ? (sentimentTemp >= 80 ? '极度贪婪' : sentimentTemp >= 65 ? '中度看涨' : '温和偏多')
      : morningReport.sentiment === '中性'
      ? '方向不明'
      : (sentimentTemp <= 15 ? '极度恐慌' : sentimentTemp <= 30 ? '明显偏空' : '谨慎偏空');

  // Dynamic ticking values to simulate live stock market!
  useEffect(() => {
    const interval = setInterval(() => {
      setIndices((prevIndices) =>
        prevIndices.map((idx) => {
          const tick = (Math.random() - 0.47) * 0.4; // Slightly positive bias
          const newValue = parseFloat((idx.value + tick).toFixed(2));
          const netChange = parseFloat((idx.changeValue + tick).toFixed(2));
          const pctChange = parseFloat(((netChange / (idx.value - idx.changeValue)) * 100).toFixed(2));
          return {
            ...idx,
            value: newValue,
            changeValue: netChange,
            changePercent: pctChange,
          };
        })
      );
    }, 4000);

    return () => clearInterval(interval);
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

      {/* 顶部区域: AI老师每日早报 */}
      <div id="paopao-greeting-hero" className="mx-4 bg-white border border-slate-100 rounded-[32px] p-5 shadow-sm space-y-4">
        {/* Card Header with Module Title and Dynamic Weather */}
        <div className="flex justify-between items-center border-b border-slate-50 pb-2">
          <div className="text-xs font-bold text-gray-400 flex items-center gap-1.5">
            AI老师每日早报
          </div>
          {/* Dynamic Weather Badge */}
          <div className={`flex items-center gap-1 px-2.5 py-0.5 rounded-full border text-[10px] font-bold ${weatherBg} transition-all duration-300`}>
            <span>{weatherEmoji} {weatherText}</span>
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
              {morningReport.loading
                ? '泡泡正在为你整理今日市场动态...'
                : morningReport.summaryText || '早上好！今天市场整体上涨，AI 板块领涨，成交额增加 12%。如果今天只记住一件事，就是资金重新回到了科技板块。'}
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

      {/* 今日学习（泡泡老师指导） */}
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

      {/* 核心区域: 今日市场概览 */}
      <div id="today-market-overview-card" className="mx-4 bg-white border border-slate-100 rounded-[32px] p-5 shadow-sm space-y-5">
        <div className="flex justify-between items-baseline">
          <h3 className="text-base font-bold text-gray-950 flex items-center gap-1.5">
            <BarChart2 className="w-4.5 h-4.5 text-indigo-600" />
            今日市场概览
          </h3>
          <span className="text-[10px] text-gray-400 font-medium">{formatChineseDate(new Date())}</span>
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
              情绪状态：<span className="text-indigo-600">{morningReport.loading ? '加载中...' : `${sentimentLabel} (${sentimentDesc})`}</span>
            </span>
            <span className="text-indigo-600 font-mono">{sentimentTemp}℃ / 100℃</span>
          </div>
          <div className="relative w-full h-3 bg-gray-100 rounded-full overflow-hidden border border-gray-100/50">
            <div className="absolute inset-0 bg-gradient-to-r from-emerald-400 via-indigo-500 to-rose-500 opacity-80"></div>
            <motion.div
              className="absolute top-0 bottom-0 w-1.5 bg-white shadow-md border border-slate-300 rounded-full"
              style={{ left: `${sentimentTemp}%` }}
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
          {morningReport.top3Themes.length > 0 ? morningReport.top3Themes.map((theme, i) => {
            return (
              <div key={i} className="bg-white border border-slate-100 rounded-3xl p-4 space-y-3 shadow-sm hover:border-indigo-100 transition-all">
                <div className="flex justify-end items-center">
                  {theme.chain && (
                    <span className="text-[9px] text-gray-400 font-semibold font-mono">
                      确定性: {theme.chain.certainty || '中'}
                    </span>
                  )}
                </div>
                <h4 className="text-xs font-bold text-gray-950">
                  {theme.title}
                </h4>
                <div className="bg-indigo-50/30 rounded-xl p-3 border border-indigo-100/20 text-[11px] text-slate-700 leading-relaxed flex gap-2">
                  <span className="text-sm">🤖</span>
                  <div>
                    <span className="font-bold text-indigo-950">泡泡解读：</span>
                    “{theme.evidence}”
                    {theme.chain && theme.chain.certainty !== '不确定' && (
                      <span className="block mt-1 text-[10px] text-indigo-500">
                        因果链: {theme.chain.event} → {theme.chain.reason} → {theme.chain.marketResult}
                      </span>
                    )}
                  </div>
                </div>
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

        {/* Dynamic heatmap blocks with soft colors */}
        <div className="grid grid-cols-2 gap-2.5">
          <div
            onClick={() => {
              onSelectSector('ai-compute');
              onNavigateToTab('market-map');
            }}
            className="bg-rose-50 border border-rose-100 hover:bg-rose-100/60 p-4 rounded-2xl flex flex-col justify-between h-24 cursor-pointer transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            <span className="text-xs font-bold text-rose-800">AI算力</span>
            <div className="text-right">
              <span className="text-lg font-mono font-bold text-rose-600">+4.32%</span>
              <p className="text-[9px] text-rose-500 font-semibold mt-0.5">强势流入</p>
            </div>
          </div>

          <div
            onClick={() => {
              onSelectSector('semiconductor');
              onNavigateToTab('market-map');
            }}
            className="bg-red-50 border border-red-100 hover:bg-red-100/60 p-4 rounded-2xl flex flex-col justify-between h-24 cursor-pointer transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            <span className="text-xs font-bold text-red-800">半导体</span>
            <div className="text-right">
              <span className="text-lg font-mono font-bold text-red-600">+3.28%</span>
              <p className="text-[9px] text-red-500 font-semibold mt-0.5">国产突围</p>
            </div>
          </div>

          <div
            onClick={() => {
              onSelectSector('robot');
              onNavigateToTab('market-map');
            }}
            className="bg-orange-50 border border-orange-100 hover:bg-orange-100/60 p-4 rounded-2xl flex flex-col justify-between h-24 cursor-pointer transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            <span className="text-xs font-bold text-orange-800">机器人</span>
            <div className="text-right">
              <span className="text-lg font-mono font-bold text-orange-600">+2.45%</span>
              <p className="text-[9px] text-orange-500 font-semibold mt-0.5">具身突破</p>
            </div>
          </div>

          <div
            onClick={() => {
              onSelectSector('new-energy');
              onNavigateToTab('market-map');
            }}
            className="bg-emerald-50 border border-emerald-100 hover:bg-emerald-100/60 p-4 rounded-2xl flex flex-col justify-between h-24 cursor-pointer transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            <span className="text-xs font-bold text-emerald-800">新能源</span>
            <div className="text-right">
              <span className="text-lg font-mono font-bold text-emerald-600">-0.98%</span>
              <p className="text-[9px] text-emerald-500 font-semibold mt-0.5">底部震荡</p>
            </div>
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
                  泡泡投研观察：
                </p>
                <p className="font-medium text-slate-600">
                  {selectedIndex.name}今日主力买盘力度充足，整体震荡上攻，短期建议配置AI及高新技术制造业龙头标的，不建议盲目追高亏损垃圾股。
                </p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Interactive Modal Sheet for AI Morning Report Reasons */}
      <AnimatePresence>
        {isReasonOpen && (
          <div id="morning-report-reasons-overlay" className="fixed inset-0 bg-slate-950/40 backdrop-blur-sm z-50 flex items-end justify-center">
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 220 }}
              id="morning-report-reasons-sheet"
              className="bg-white rounded-t-[32px] w-full max-w-md p-6 pb-8 border-t border-gray-100 shadow-2xl space-y-6 max-h-[85vh] overflow-y-auto"
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

              <div className="space-y-4">
                <div className="flex gap-3 items-center">
                  <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center text-lg">
                    💡
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-gray-900">今日市场驱动因素分析</h3>
                    <p className="text-[10px] text-gray-400 mt-0.5 font-medium">泡泡 AI 三层推理引擎自动生成</p>
                  </div>
                </div>

                <div className="space-y-3 pt-2">
                  {morningReport.top3Themes.length > 0 ? morningReport.top3Themes.map((theme, i) => (
                    <div key={i} className="bg-slate-50 border border-slate-100 rounded-2xl p-4 space-y-1.5">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md">
                          {i === 0 ? '核心催化' : i === 1 ? '资金风向' : '流动性保障'}
                        </span>
                        {theme.chain && (
                          <span className="text-[9px] text-gray-400 font-semibold font-mono">
                            确定性: {theme.chain.certainty || '中'}
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-bold text-gray-900">
                        {theme.title}
                      </p>
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
                    <div className="text-center text-gray-400 text-xs py-8">
                      {morningReport.loading ? 'AI 引擎分析中...' : '暂无可用的市场分析数据'}
                    </div>
                  )}
                </div>
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
