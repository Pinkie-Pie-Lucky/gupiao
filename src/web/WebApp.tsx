/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WebApp —— 桌面端外壳
 *  - 左侧深底侧边栏（220px）：品牌「泡泡看市」（按 v3 去除「AI智能投研」副标题）+ 导航
 *  - 顶栏：当前页面标题 / 日期 / 搜索 / 用户
 *  - 内容区：渲染对应页面（今日大盘已完整实现，其余为建设中占位）
 */

import { useState, useEffect, useMemo } from 'react';
import { Compass, Star, MessageSquare, User, Search, Home, Construction, TrendingUp, TrendingDown, Grid3x3 } from 'lucide-react';
import { StockItem } from '../types';
import { formatChineseDate, mockUserProfile } from '../data';
import { heatSectors } from './mockWebData';
import { BrainMark } from './BrainMark';
import { TodayMarketPage } from './TodayMarketPage';
import { MarketMapPage } from './MarketMapPage';
import { AiBubblePage } from './AiBubblePage';
import { AccountPage } from './AccountPage';
import { WatchlistPage } from './WatchlistPage';
import { AuthProvider, useAuth } from './AuthContext';
import { AuthModal } from './AuthModal';

type WebNav = 'today' | 'map' | 'watchlist' | 'ai' | 'mine';

const NAV: { id: WebNav; label: string; icon: typeof Home; desc: string }[] = [
  { id: 'today', label: '今日大盘', icon: Home, desc: '盘面概览与今日要闻' },
  { id: 'map', label: '市场地图', icon: Compass, desc: '板块全景热力图' },
  // 「我的关注」标签暂隐藏
  // { id: 'watchlist', label: '我的关注', icon: Star, desc: '自选股与预警' },
  { id: 'ai', label: 'AI泡泡', icon: MessageSquare, desc: '智能投研问答' },
  // 「个人中心」标签暂隐藏
  // { id: 'mine', label: '个人中心', icon: User, desc: '账户与偏好设置' },
];

const PAGE_TITLE: Record<WebNav, string> = {
  today: '今日大盘',
  map: '市场地图',
  watchlist: '我的关注',
  ai: 'AI泡泡',
  mine: '个人中心',
};

function Placeholder({ id }: { id: WebNav }) {
  const item = NAV.find((n) => n.id === id)!;
  const Icon = item.icon;
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#0b1120] text-indigo-300">
        <Construction size={28} />
      </div>
      <h2 className="mt-4 text-lg font-bold text-gray-900">{item.label}</h2>
      <p className="mt-1 text-sm text-gray-500">Web 端「{item.label}」页面正在建设中，敬请期待。</p>
      <p className="mt-1 text-xs text-gray-400">{item.desc}</p>
    </div>
  );
}

export function WebApp() {
  return (
    <AuthProvider>
      <WebAppShell />
    </AuthProvider>
  );
}

function WebAppShell() {
  const auth = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  const [activeNav, setActiveNav] = useState<WebNav>('today');
  const [prefilledStock, setPrefilledStock] = useState<{ name: string; code: string } | null>(null);
  // 顶栏搜索
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  // 顶栏搜索跳转定位：切到市场地图后让 MarketMapPage 选中对应板块/个股
  const [mapTarget, setMapTarget] = useState<{ sectorId?: string | null; stockCode?: string | null } | null>(null);

  // 搜索：同时匹配板块名 / 板块ID / 个股名 / 个股代码
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return { sectors: [], stocks: [] };
    const sectors = heatSectors
      .filter((s) => s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q))
      .slice(0, 4);
    const stocks: Array<{ stock: StockItem; sectorId: string; sectorName: string }> = [];
    for (const s of heatSectors) {
      for (const st of s.stocks) {
        if (st.name.toLowerCase().includes(q) || st.code.toLowerCase().includes(q)) {
          stocks.push({ stock: st, sectorId: s.id, sectorName: s.name });
        }
      }
    }
    return { sectors, stocks: stocks.slice(0, 6) };
  }, [searchQuery]);
  const [followedStocks, setFollowedStocks] = useState<StockItem[]>([
    { name: '科大讯飞', code: '002230.SZ', price: 45.12, changePercent: 2.85, volume: '28.9万手', turnover: '13.0亿元', history: [] },
    { name: '中芯国际', code: '688981.SH', price: 53.42, changePercent: 4.21, volume: '38.4万手', turnover: '20.3亿元', history: [] },
  ]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<StockItem>).detail;
      if (detail) {
        setFollowedStocks((prev) => (prev.some((s) => s.code === detail.code) ? prev : [detail, ...prev]));
      }
    };
    window.addEventListener('add-stock-portfolio', handler);
    return () => window.removeEventListener('add-stock-portfolio', handler);
  }, []);

  const handleAskTeacher = (name: string, code: string) => {
    setPrefilledStock({ name, code });
    setActiveNav('ai');
  };

  const openAi = () => setActiveNav('ai');

  // 点击搜索结果：切到市场地图，并定位到对应板块 / 个股
  const handleSearchSelect = (target: { sectorId?: string | null; stockCode?: string | null }) => {
    setMapTarget(target);
    setActiveNav('map');
    setSearchQuery('');
    setSearchFocused(false);
  };

  return (
    <div className="flex min-h-screen bg-[#f5f6f8] font-sans text-gray-900">
      {/* ---------------- 侧边栏 ---------------- */}
      <aside className="sticky top-0 hidden h-screen w-[220px] shrink-0 flex-col bg-[#0b1120] px-4 py-5 lg:flex">
        {/* 品牌 */}
        <div className="flex items-center gap-2.5 px-1">
          <BrainMark size={36} />
          <div className="leading-tight">
            <p className="text-[15px] font-bold text-white">泡泡看市</p>
          </div>
        </div>

        {/* 导航 */}
        <nav className="mt-8 flex flex-col gap-1">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = activeNav === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveNav(item.id)}
                className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  active ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                }`}
              >
                {active && <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-indigo-400" />}
                <Icon size={18} strokeWidth={active ? 2.4 : 2} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* 底部用户（暂隐藏）
        <div className="mt-auto flex items-center gap-2.5 rounded-xl bg-white/5 px-3 py-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-500/20 text-xs font-bold text-indigo-200">
            {auth.isLoggedIn && auth.session ? (auth.session.user.nickname || auth.session.user.username || auth.session.user.email || 'I').slice(0, 1).toUpperCase() : mockUserProfile.name.slice(0, 1)}
          </div>
          <div className="min-w-0 leading-tight">
            {auth.isLoggedIn && auth.session ? (
              <>
                <p className="truncate text-xs font-semibold text-white">{auth.session.user.nickname || auth.session.user.username || auth.session.user.email || 'InfiniSynapse 用户'}</p>
                <p className="text-[10px] text-slate-400">已登录 · 可在个人中心退出</p>
              </>
            ) : (
              <p className="truncate text-xs font-semibold text-white">{mockUserProfile.name}</p>
            )}
          </div>
        </div>
        */}
      </aside>

      {/* ---------------- 主区域 ---------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 顶栏 */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-[#e8eaed] bg-white/90 px-6 py-3.5 backdrop-blur">
          <div>
            <h1 className="text-base font-bold text-gray-900">{PAGE_TITLE[activeNav]}</h1>
            <p className="text-[11px] text-gray-400">{formatChineseDate(new Date())} · 泡泡看市 Web 端</p>
          </div>
          <div className="flex items-center gap-3">
            {/* 顶栏搜索框（暂隐藏）
            <div className="relative lg:w-72">
              <div className="flex items-center gap-2 rounded-xl border border-[#e8eaed] bg-[#f7f8fa] px-3 py-2 transition-colors focus-within:border-indigo-300 focus-within:bg-white">
                <Search size={15} className="shrink-0 text-gray-400" />
                <input
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setSearchFocused(true);
                  }}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
                  className="w-full bg-transparent text-sm text-gray-700 outline-none placeholder:text-gray-400"
                  placeholder="搜索股票 / 板块"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setSearchQuery('');
                      setSearchFocused(true);
                    }}
                    className="shrink-0 text-[10px] font-semibold text-gray-400 hover:text-gray-600"
                  >
                    清空
                  </button>
                )}
              </div>
            </div>
            */}
            {/* 右上角登录按钮已按需求隐藏（AuthModal 不再由顶栏触发） */}
            {/*
            {auth.isLoggedIn && auth.session ? (
              <button ...已登录头像...</button>
            ) : (
              <button ...使用 InfiniSynapse 登录...</button>
            )}
            */}
          </div>
        </header>

        {/* 内容 */}
        <main className="custom-scrollbar flex-1 overflow-y-auto">
          {activeNav === 'today' ? (
            <TodayMarketPage followedStocks={followedStocks} onAskTeacherAboutStock={handleAskTeacher} />
          ) : activeNav === 'map' ? (
            <MarketMapPage onAskTeacherAboutStock={handleAskTeacher} initialTarget={mapTarget} />
          ) : activeNav === 'ai' ? (
            <AiBubblePage prefill={prefilledStock} onAskTeacherAboutStock={handleAskTeacher} />
          ) : activeNav === 'watchlist' ? (
            <WatchlistPage onAskTeacherAboutStock={handleAskTeacher} />
          ) : activeNav === 'mine' ? (
            <AccountPage onOpenAi={openAi} />
          ) : (
            <div className="mx-auto max-w-[1320px] px-6 py-6">
              <Placeholder id={activeNav} />
            </div>
          )}
        </main>

        {authOpen && <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />}
      </div>
    </div>
  );
}
