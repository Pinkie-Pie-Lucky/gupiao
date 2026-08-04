/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, TrendingUp, TrendingDown, ChevronRight, ChevronDown, X, AlertTriangle, ArrowUpRight, Award, MessageSquare, Flame, BarChart2, Activity, BookOpen, Sun, GraduationCap, RefreshCw, ShieldCheck, ThumbsUp, ThumbsDown, Star } from 'lucide-react';
import { MarketIndex, MarketStory, StockSector } from '../types';
import { formatChineseDate, initialSectors, initialAlerts } from '../data';
import { InteractiveChart } from './InteractiveChart';
import { FeedbackModal } from './FeedbackModal';
import { BubbleAvatar } from './BubbleAvatar';

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
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<{
    type: 'stock' | 'sector';
    stock?: { name: string; code: string; price: number; changePercent: number; volume?: string; turnover?: string };
    sector?: StockSector;
    query: string;
  } | null>(null);
  const [isReasonOpen, setIsReasonOpen] = useState(false);
  const [knowledgeIndex, setKnowledgeIndex] = useState(() => {
    return Math.floor(Math.random() * LEARNING_KNOWLEDGE.length);
  });

  // Morning report from AI pipeline
  const [morningReport, setMorningReport] = useState<{
    summaryText: string;
    reasonBrief: string;
    stories: MarketStory[];
    sentiment: string;
    loading: boolean;
    promptVersion?: string;
    promptVersions?: {
      beginner: string;
      professional: string;
    };
  }>({ summaryText: '', reasonBrief: '', stories: [], sentiment: '中性', loading: true });

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
    marketTemperature?: {
      score: number;
      emoji: string;
      text: string;
      label: string;
      description: string;
      tone: 'hot' | 'warm' | 'neutral' | 'cool';
      directionScore: number;
      confirmationScore: number;
      correction: number;
      components: {
        breadth: { score: number; up: number; down: number; total: number };
        indices: { score: number; averageChange: number };
        extremes: { score: number; limitUp: number; limitDown: number; stockCount: number; available: boolean };
        turnover: {
          score: number;
          amount: number;
          baseline: number | null;
          ratio: number | null;
          sampleCount: number;
          status: string;
        };
        concentration: { score: number; top3Share: number | null };
        volatility: { score: number; averageAmplitude: number | null };
      };
    };
  } | null>(null);

  // 数据是否成功加载
  const [dataError, setDataError] = useState<string | null>(null);
  // 缓存天气和情绪计算结果，避免每次渲染重新触发动画
  const [cachedWeather, setCachedWeather] = useState({
    emoji: '❓', text: '暂无数据', bg: 'bg-gray-50 border-gray-200 text-gray-500', temp: 50,
    label: '加载中', desc: ''
  });

  // 市场温度来自客观规则引擎；AI情绪只用于早报文案，不参与温度计算。
  useEffect(() => {
    if (dataError) {
      setCachedWeather({ emoji: '⚠️', text: '数据异常', bg: 'bg-yellow-50 border-yellow-200 text-yellow-700', temp: 0, label: '数据异常', desc: '行情数据获取失败' });
      return;
    }
    const temperature = marketOverview?.marketTemperature;
    if (!temperature) return;

    const bgByTone = {
      hot: 'bg-rose-50 border-rose-100 text-rose-700',
      warm: 'bg-amber-50 border-amber-100 text-amber-700',
      neutral: 'bg-slate-100 border-slate-200 text-slate-700',
      cool: 'bg-indigo-50 border-indigo-100 text-indigo-700',
    };
    setCachedWeather({
      emoji: temperature.emoji,
      text: temperature.text,
      bg: bgByTone[temperature.tone],
      temp: temperature.score,
      label: temperature.label,
      desc: temperature.description,
    });
  }, [marketOverview, dataError]);

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
          setIndices(overviewData.indices.map((i: any) => {
            const value = Number(i.price) || 0;
            const changePercent = Number(i.changePercent) || 0;
            const prevClose = changePercent !== 0 ? value / (1 + changePercent / 100) : value;
            // 生成当日分时近似曲线（真实分时接口不可用时的兜底展示）
            const history = Array.from({ length: 24 }, (_, idx) => {
              const progress = idx / 23;
              const eased = 0.5 - 0.5 * Math.cos(progress * Math.PI);
              const intradayValue = prevClose + (value - prevClose) * eased;
              return {
                time: `${String(9 + Math.floor((idx * 30) / 60)).padStart(2, '0')}:${String((idx * 30) % 60).padStart(2, '0')}`,
                value: Math.round(intradayValue * 100) / 100,
                volume: Math.floor(Math.random() * 8000 + 2000),
              };
            });
            return {
              name: i.name,
              code: i.code,
              value,
              changePercent,
              changeValue: parseFloat((value * changePercent / 100).toFixed(2)),
              history,
            };
          }));
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
          if (!cancelled && !reportRes.error) {
            setMorningReport({
              ...reportRes,
              stories: reportRes.stories || reportRes.top3Themes || [],
              loading: false,
            });
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
      // 白天9:30-11:30、13:00-15:00交易时段才刷新
      const h = new Date().getHours();
      const m = new Date().getMinutes();
      const t = h * 100 + m;
      const isTrading = (t >= 930 && t < 1130) || (t >= 1300 && t < 1500);
      if (isTrading) {
        loadMarketOverview({ cancelled });
      }
    }, 10000);

    return () => {
      cancelled = true;
      clearInterval(autoRefresh);
    };
  }, []);

  const turnoverText = (() => {
    const amount = marketOverview?.marketTemperature?.components.turnover.amount || marketOverview?.totalVolume || 0;
    if (!amount) return '成交额待更新';
    if (amount >= 1_000_000_000_000) return `成交额 ${(amount / 1_000_000_000_000).toFixed(2)}万亿`;
    return `成交额 ${Math.round(amount / 100_000_000)}亿`;
  })();

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

  const [expandedStories, setExpandedStories] = useState<Set<string>>(new Set());
  const [storyMode, setStoryMode] = useState<'beginner' | 'professional'>('beginner');

  // 反馈状态
  const [feedbackTarget, setFeedbackTarget] = useState<{
    contentType: string;
    contentId: string;
    promptVersion: string;
  } | null>(null);
  const [thumbsFeedback, setThumbsFeedback] = useState<Record<string, 'up' | 'down' | null>>({});

  const handleThumbsUp = (story: MarketStory) => {
    const feedbackKey = `${storyMode}:${story.storyId}`;
    if (thumbsFeedback[feedbackKey] === 'up') {
      setThumbsFeedback(prev => ({ ...prev, [feedbackKey]: null }));
    } else {
      setThumbsFeedback(prev => ({ ...prev, [feedbackKey]: 'up' }));
      fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentType: `market_story_${storyMode}`,
          contentId: story.storyId,
          promptVersion: storyMode === 'beginner'
            ? morningReport.promptVersions?.beginner || 'p3a-beginner-v1'
            : morningReport.promptVersions?.professional || 'p3b-professional-v1',
          rating: 'positive',
          reasons: [],
          comment: '',
          timestamp: new Date().toISOString(),
        }),
      }).catch(() => {});
    }
  };

  const handleThumbsDown = (story: MarketStory) => {
    const feedbackKey = `${storyMode}:${story.storyId}`;
    if (thumbsFeedback[feedbackKey] === 'down') {
      setThumbsFeedback(prev => ({ ...prev, [feedbackKey]: null }));
    } else {
      setThumbsFeedback(prev => ({ ...prev, [feedbackKey]: 'down' }));
      setFeedbackTarget({
        contentType: `market_story_${storyMode}`,
        contentId: story.storyId,
        promptVersion: storyMode === 'beginner'
          ? morningReport.promptVersions?.beginner || 'p3a-beginner-v1'
          : morningReport.promptVersions?.professional || 'p3b-professional-v1',
      });
    }
  };

  const toggleStory = (storyId: string) => {
    setExpandedStories(prev => {
      const next = new Set(prev);
      if (next.has(storyId)) next.delete(storyId);
      else next.add(storyId);
      return next;
    });
  };

  const TYPE_LABELS: Record<string, string> = {
    'sector_driver': '市场热点',
    'geo_event': '地缘事件',
    'policy_driver': '政策驱动',
    'macro_event': '宏观事件',
  };

  const confidenceText = (story: MarketStory): string | null => {
    if (story.reasoning.confidenceLevel === 'high') return '证据较充分';
    if (story.reasoning.confidenceLevel === 'medium') return '存在合理依据';
    return null;
  };

  const visibleReasoningSteps = (story: MarketStory) => {
    const steps = story.reasoning?.steps || [];
    const withoutRepeatedOpening = steps.filter((step, index) => !(index === 0 && step.kind === 'fact'));
    return withoutRepeatedOpening.length > 0 ? withoutRepeatedOpening : steps;
  };

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
      setSearchResult({
        type: 'stock',
        stock: foundStock,
        sector: foundSector,
        query: searchQuery.trim(),
      });
    } else if (foundSector) {
      setSearchResult({
        type: 'sector',
        sector: foundSector,
        query: searchQuery.trim(),
      });
    } else {
      setSearchResult(null);
      onNavigateToTab('ai-teacher');
      setTimeout(() => {
        const customEvent = new CustomEvent('trigger-ai-chat', { detail: searchQuery });
        window.dispatchEvent(customEvent);
      }, 100);
    }
    setSearchQuery('');
    setIsSearching(false);
  };

  const handleAskAboutSearchResult = (name: string, code: string) => {
    setSearchResult(null);
    onAskTeacherAboutStock(name, code);
    onNavigateToTab('ai-teacher');
  };

  const handleAddSearchResultToWatchlist = (stock: { name: string; code: string; price: number; changePercent: number; volume?: string; turnover?: string }) => {
    const customEvent = new CustomEvent('add-stock-portfolio', {
      detail: {
        code: stock.code,
        name: stock.name,
        price: stock.price,
        changePercent: stock.changePercent,
        volume: stock.volume || '--',
        turnover: stock.turnover || '--',
        history: [],
      },
    });
    window.dispatchEvent(customEvent);
  };

  const handleOpenSearchSector = (sectorId: string) => {
    setSearchResult(null);
    onSelectSector(sectorId);
    onNavigateToTab('market-map');
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

      {/* 搜索结果卡片 */}
      {searchResult && (
        <div id="home-search-result" className="mx-4">
          <div className="bg-white border border-indigo-100 rounded-3xl p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-gray-800">
                {searchResult.type === 'stock'
                  ? `个股「${searchResult.stock?.name}」`
                  : `板块「${searchResult.sector?.name}」`}
              </span>
              <button onClick={() => setSearchResult(null)} className="p-1 text-gray-300 hover:text-gray-500 rounded-full hover:bg-gray-50">
                <X className="w-4 h-4" />
              </button>
            </div>

            {searchResult.type === 'stock' && searchResult.stock ? (
              <>
                <div className="flex items-center justify-between bg-slate-50 rounded-2xl p-3">
                  <div>
                    <div className="text-sm font-bold text-gray-900">{searchResult.stock.name}</div>
                    <div className="text-[10px] text-gray-400 font-mono">{searchResult.stock.code} · {searchResult.sector?.name || '未分类'}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono font-bold text-sm">¥{searchResult.stock.price.toFixed(2)}</div>
                    <div className={`text-[10px] font-bold font-mono ${searchResult.stock.changePercent >= 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                      {searchResult.stock.changePercent >= 0 ? '+' : ''}{searchResult.stock.changePercent}%
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleAddSearchResultToWatchlist(searchResult.stock!)}
                    className={`flex-1 text-[10px] font-bold py-2 rounded-xl transition-all flex items-center justify-center gap-1 ${
                      followedStocks.some(s => s.code === searchResult.stock?.code)
                        ? 'bg-gray-100 text-gray-400'
                        : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-600'
                    }`}
                  >
                    <Star className="w-3.5 h-3.5" />
                    {followedStocks.some(s => s.code === searchResult.stock?.code) ? '已在自选中' : '加入自选'}
                  </button>
                  <button
                    onClick={() => handleAskAboutSearchResult(searchResult.stock!.name, searchResult.stock!.code)}
                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold py-2 rounded-xl transition-all flex items-center justify-center gap-1"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    向泡泡提问
                  </button>
                </div>
              </>
            ) : searchResult.sector ? (
              <>
                <div className="flex items-center justify-between bg-slate-50 rounded-2xl p-3">
                  <div>
                    <div className="text-sm font-bold text-gray-900">{searchResult.sector.name}</div>
                    <div className="text-[10px] text-gray-400">{searchResult.sector.description}</div>
                  </div>
                  <div className={`text-sm font-bold font-mono ${searchResult.sector.changePercent >= 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                    {searchResult.sector.changePercent >= 0 ? '+' : ''}{searchResult.sector.changePercent}%
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleOpenSearchSector(searchResult.sector!.id)}
                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold py-2 rounded-xl transition-all flex items-center justify-center gap-1"
                  >
                    <ArrowUpRight className="w-3.5 h-3.5" />
                    查看板块详情
                  </button>
                  <button
                    onClick={() => {
                      const name = searchResult.sector!.name;
                      setSearchResult(null);
                      onNavigateToTab('ai-teacher');
                      setTimeout(() => {
                        const customEvent = new CustomEvent('trigger-ai-chat', { detail: `分析${name}板块` });
                        window.dispatchEvent(customEvent);
                      }, 100);
                    }}
                    className="flex-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 text-[10px] font-bold py-2 rounded-xl transition-all flex items-center justify-center gap-1"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    向泡泡提问
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}

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
              市场温度：<span className="text-indigo-600">{marketOverview?.marketTemperature ? cachedWeather.label : '加载中...'}</span>
            </span>
            <span className="text-indigo-600 font-mono">{cachedWeather.temp}℃ / 100℃</span>
          </div>
          <div className="relative w-full h-3 bg-gray-100 rounded-full overflow-hidden border border-gray-100/50">
            <div className="absolute inset-0 bg-gradient-to-r from-emerald-400 via-indigo-500 to-rose-500 opacity-80"></div>
            <motion.div
              className="absolute top-0 bottom-0 w-1.5 bg-white shadow-md border border-slate-300 rounded-full"
              style={{ left: `${cachedWeather.temp}%` }}
            ></motion.div>
          </div>
          <div className="flex justify-between text-[9px] text-gray-400 font-semibold px-0.5">
            <span>市场偏冷 (0℃)</span>
            <span>多空平衡 (50℃)</span>
            <span>市场活跃 (100℃)</span>
          </div>
          {marketOverview?.marketTemperature && (
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                <div className="text-[9px] font-semibold text-slate-400">板块广度</div>
                <div className="mt-0.5 text-[11px] font-bold text-slate-700">
                  {marketOverview.marketTemperature.components.breadth.total > 0 ? (
                    <>
                      <span className="text-red-600">{marketOverview.marketTemperature.components.breadth.up} 个上涨</span>
                      <span className="mx-1 text-slate-300">/</span>
                      <span className="text-emerald-600">{marketOverview.marketTemperature.components.breadth.down} 个下跌</span>
                    </>
                  ) : (
                    <span className="text-slate-500">板块数据待更新</span>
                  )}
                </div>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                <div className="text-[9px] font-semibold text-slate-400">市场成交</div>
                <div className="mt-0.5 text-[11px] font-bold text-slate-700">{turnoverText}</div>
              </div>
            </div>
          )}
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

      <section id="what-happened-section" className="px-4 space-y-3 scroll-mt-4">
        <div className="flex items-center justify-between gap-3">
          <h3 id="events-heading" className="text-base font-bold text-slate-950 flex items-center gap-2">
            <Activity className="w-4 h-4 text-indigo-600" />
            今天发生了什么
          </h3>
          <div className="flex items-center rounded-xl bg-slate-100 p-1" role="group" aria-label="故事阅读模式">
            {([
              ['beginner', '小白模式'],
              ['professional', '专业模式'],
            ] as const).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                aria-pressed={storyMode === mode}
                onClick={() => {
                  setStoryMode(mode);
                  setExpandedStories(new Set());
                }}
                className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-colors ${
                  storyMode === mode
                    ? 'bg-white text-indigo-700 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <p className="text-[10px] leading-4 text-slate-500">
          {storyMode === 'beginner'
            ? '用一屏看懂事件和最短逻辑'
            : '查看数据验证、多因素驱动和反向条件'}
        </p>

        {morningReport.stories.length > 0 ? morningReport.stories.map((story) => {
          const expanded = expandedStories.has(story.storyId);
          const reasoningSteps = storyMode === 'beginner' && story.teacher.simpleChain?.length
            ? story.teacher.simpleChain.map((text, index) => ({
                id: `simple-${index + 1}`,
                text,
                kind: 'knowledge' as const,
                evidenceIds: [],
              }))
            : visibleReasoningSteps(story);
          const confidence = confidenceText(story);
          const professional = story.professional;
          const feedbackKey = `${storyMode}:${story.storyId}`;
          const driverLabels = {
            primary: '主驱动',
            secondary: '次驱动',
            diffusion: '扩散逻辑',
          };
          return (
            <article key={story.storyId} className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] font-bold text-indigo-700 bg-indigo-50 px-2 py-1 rounded-full">
                  {TYPE_LABELS[story.type] || '市场事件'}
                </span>
                {storyMode === 'professional' && (
                  <span className="text-[9px] text-slate-600 flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3 text-indigo-500" />
                    证据评分 {professional.confidence.score}/100
                  </span>
                )}
              </div>

              <div>
                <h4 className="text-sm font-bold text-slate-950">{story.title}</h4>
                {story.metrics.length > 0 && (
                  <div className="mt-2">
                    {storyMode === 'professional' && (
                      <p className="text-[9px] font-bold text-slate-400 mb-1.5">行情与数据验证</p>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                    {story.metrics.map((metric) => (
                      <span key={`${metric.label}-${metric.value}`} className="text-[10px] font-semibold bg-slate-50 text-slate-600 px-2 py-1 rounded-lg">
                        {metric.label}：{metric.value}
                      </span>
                    ))}
                    </div>
                  </div>
                )}
              </div>

              {storyMode === 'beginner' ? (
                <div className="flex gap-2 bg-indigo-50/60 rounded-2xl p-3 border border-indigo-100/70">
                  <BubbleAvatar size="sm" />
                  <p className="text-xs leading-5 text-slate-700">
                    <strong className="text-indigo-800">泡泡解读：</strong>
                    {story.teacher.summary}
                  </p>
                </div>
              ) : (
                <>
                  <div className="rounded-xl bg-indigo-50/60 p-3">
                    <p className="text-[9px] font-bold text-indigo-500 mb-1">事件结论</p>
                    <p className="text-xs leading-5 font-medium text-slate-800">{professional.conclusion}</p>
                  </div>
                  {professional.drivers.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[9px] font-bold text-slate-400">核心驱动因素</p>
                      {professional.drivers.map((driver, index) => (
                        <div key={`${driver.role}-${index}`} className="flex items-start gap-2">
                          <span className={`mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-bold ${
                            driver.role === 'primary'
                              ? 'bg-indigo-100 text-indigo-700'
                              : driver.role === 'secondary'
                                ? 'bg-sky-100 text-sky-700'
                                : 'bg-violet-100 text-violet-700'
                          }`}>
                            {driverLabels[driver.role]}
                          </span>
                          <div className="min-w-0">
                            <p className="text-[11px] font-bold text-slate-800">{driver.title}</p>
                            <p className="text-[10px] leading-4 text-slate-600 mt-0.5">{driver.explanation}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {reasoningSteps.length > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={() => toggleStory(story.storyId)}
                    aria-expanded={expanded}
                    className="w-full flex items-center justify-between text-[11px] font-bold text-slate-700 bg-slate-50 px-3 py-2.5 rounded-xl"
                  >
                    <span>{storyMode === 'beginner' ? '为什么会这样？' : '查看完整逻辑'}</span>
                    <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                  </button>
                  {expanded && (
                    <div className="mt-2 rounded-2xl bg-slate-50 border border-slate-100 p-3 space-y-3">
                      {storyMode === 'professional' && (
                        <p className="text-[9px] font-bold text-slate-400">完整因果链</p>
                      )}
                      {reasoningSteps.map((step, index) => (
                        <div key={step.id} className="flex gap-2">
                          <div className="flex flex-col items-center">
                            <span className="w-5 h-5 rounded-full bg-white border border-indigo-200 text-[9px] font-bold text-indigo-700 flex items-center justify-center">
                              {index + 1}
                            </span>
                            {index < reasoningSteps.length - 1 && <span className="w-px h-5 bg-indigo-200" />}
                          </div>
                          <div className="min-w-0 flex-1 pb-2">
                            <p className="text-[11px] leading-5 text-slate-700">{step.text}</p>
                            {storyMode === 'professional' && (
                              <span className="text-[9px] text-slate-400">
                                {step.kind === 'fact' ? '已确认事实' : step.kind === 'knowledge' ? '金融常识' : '合理推断'}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                      {storyMode === 'beginner' && (story.teacher.uncertaintyText || story.reasoning.uncertainty) && (
                        <p className="text-[10px] leading-4 text-amber-800 border-t border-amber-200/60 pt-2">
                          💭 {story.teacher.uncertaintyText || story.reasoning.uncertainty}
                        </p>
                      )}
                      {storyMode === 'professional' && (
                        <>
                          <div className="border-t border-slate-200 pt-3 space-y-2">
                            <div>
                              <p className="text-[9px] font-bold text-emerald-700">支持证据</p>
                              <ul className="mt-1 space-y-1">
                                {professional.supportingEvidence.length > 0
                                  ? professional.supportingEvidence.map((item) => <li key={item} className="text-[10px] leading-4 text-slate-600">• {item}</li>)
                                  : <li className="text-[10px] text-slate-500">当前仅有行情事实，暂无额外支持证据。</li>}
                              </ul>
                            </div>
                            <div>
                              <p className="text-[9px] font-bold text-amber-700">证据缺口</p>
                              <ul className="mt-1 space-y-1">
                                {(professional.evidenceGaps.length > 0 ? professional.evidenceGaps : [story.reasoning.uncertainty])
                                  .filter(Boolean)
                                  .map((item) => <li key={item} className="text-[10px] leading-4 text-slate-600">• {item}</li>)}
                              </ul>
                            </div>
                          </div>
                          <div className="rounded-xl bg-white p-3 border border-slate-200">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-[10px] font-bold text-slate-800">证据评分 {professional.confidence.score}/100</p>
                              <span className="text-[9px] text-slate-500">
                                {professional.confidence.level === 'high' ? '较充分' : professional.confidence.level === 'medium' ? '中等' : '有限'}
                              </span>
                            </div>
                            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mt-2">
                              <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${professional.confidence.score}%` }} />
                            </div>
                            <p className="text-[10px] leading-4 text-slate-600 mt-2">{professional.confidence.explanation}</p>
                          </div>
                          {professional.alternativeExplanations.length > 0 && (
                            <div>
                              <p className="text-[9px] font-bold text-slate-700">替代解释</p>
                              {professional.alternativeExplanations.map((item) => <p key={item} className="text-[10px] leading-4 text-slate-600 mt-1">• {item}</p>)}
                            </div>
                          )}
                          {professional.counterLogic.length > 0 && (
                            <div>
                              <p className="text-[9px] font-bold text-rose-700">反向逻辑</p>
                              {professional.counterLogic.map((item) => <p key={item} className="text-[10px] leading-4 text-slate-600 mt-1">• {item}</p>)}
                            </div>
                          )}
                          {professional.observationIndicators.length > 0 && (
                            <div>
                              <p className="text-[9px] font-bold text-indigo-700">后续观察</p>
                              <div className="flex flex-wrap gap-1.5 mt-1.5">
                                {professional.observationIndicators.map((item) => (
                                  <span key={item} className="text-[9px] leading-4 bg-white border border-slate-200 text-slate-600 px-2 py-1 rounded-lg">{item}</span>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {story.evidence.length > 0 && (
                <div className="text-[9px] text-slate-400 flex flex-wrap items-center gap-1">
                  <span>来源：</span>
                  {story.evidence
                    .filter(function(src, idx, arr) { return arr.findIndex(function(s) { return s.sourceName === src.sourceName; }) === idx; })
                    .slice(0, 3)
                    .map(function(source) {
                      return source.url?.startsWith('http')
                        ? <a key={source.id} href={source.url} target="_blank" rel="noreferrer" className="underline hover:text-indigo-600">{source.sourceName}</a>
                        : <span key={source.id}>{source.sourceName}</span>;
                    })}
                </div>
              )}

              <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-slate-50">
                <button
                  type="button"
                  onClick={() => handleThumbsUp(story)}
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-all ${
                    thumbsFeedback[feedbackKey] === 'up'
                      ? 'bg-indigo-50 text-indigo-600 border border-indigo-200'
                      : 'text-gray-400 hover:text-indigo-500 hover:bg-gray-50'
                  }`}
                >
                  <ThumbsUp className={`w-3 h-3 ${thumbsFeedback[feedbackKey] === 'up' ? 'fill-indigo-500' : ''}`} />
                  有用
                </button>
                <button
                  type="button"
                  onClick={() => handleThumbsDown(story)}
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-all ${
                    thumbsFeedback[feedbackKey] === 'down'
                      ? 'bg-rose-50 text-rose-600 border border-rose-200'
                      : 'text-gray-400 hover:text-rose-500 hover:bg-gray-50'
                  }`}
                >
                  <ThumbsDown className={`w-3 h-3 ${thumbsFeedback[feedbackKey] === 'down' ? 'fill-rose-500' : ''}`} />
                  改进
                </button>
              </div>
            </article>
          );
        }) : (
          <div className="text-center text-gray-400 text-xs py-6">
            {morningReport.loading ? 'AI 正在分析今日热点...' : '暂无可用的热点数据'}
          </div>
        )}
      </section>

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

      {/* 反馈弹窗 - 点踩后弹出 */}
      {feedbackTarget && (
        <FeedbackModal
          contentType={feedbackTarget.contentType}
          contentId={feedbackTarget.contentId}
          promptVersion={feedbackTarget.promptVersion}
          onClose={() => {
            const storyId = feedbackTarget.contentId;
            const mode = feedbackTarget.contentType.endsWith('professional') ? 'professional' : 'beginner';
            setFeedbackTarget(null);
            setThumbsFeedback(prev => ({ ...prev, [`${mode}:${storyId}`]: null }));
          }}
        />
      )}

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
                    {morningReport.stories.length > 0 ? morningReport.stories.map((story, i) => (
                      <div key={story.storyId} className="bg-slate-50 border border-slate-100 rounded-2xl p-4 space-y-1.5">
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md">
                            {i === 0 ? '核心催化' : i === 1 ? '资金风向' : '流动性保障'}
                          </span>
                        </div>
                        <p className="text-xs font-bold text-gray-900">{story.title}</p>
                        <p className="text-[11px] text-slate-600 leading-relaxed font-medium">
                          {story.teacher.summary}
                          {story.reasoning.steps.length > 0 && (
                            <span className="block mt-1 text-indigo-600 font-medium">
                              因果链：{story.reasoning.steps.map(step => step.text).join(' → ')}
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
