/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { HomeTab } from './components/HomeTab';
import { MarketMapTab } from './components/MarketMapTab';
import { WatchlistTab } from './components/WatchlistTab';
import { AiTeacherTab } from './components/AiTeacherTab';
import { MineTab } from './components/MineTab';
import { StockResearchTab } from './components/StockResearchTab';
import { StockResearchEmptyState } from './components/StockResearchEmptyState';
import { LoginScreen } from './components/LoginScreen';
import { apiLogout, apiMe, apiUpdateNickname, apiWatchlist, apiWatchlistAdd, apiWatchlistRemove, clearSession, getSessionUser, ApiError, type User as SessionUser, type WatchlistEntry } from './lib/api';
import { Home, Compass, Star, MessageSquare, User, BarChart3 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { StockItem } from './types';

type TabId = 'home' | 'market-map' | 'watchlist' | 'ai-teacher' | 'mine' | 'stock-research';

// 个人中心与账号登录：基于服务端 PostgreSQL 存储（手机号 + 密码 + JWT）。
const ACCOUNT_FEATURE_ENABLED = true;

const normalizeWatchlistCode = (code: string) => String(code || '').trim().toUpperCase().replace(/^(SH|SZ)/, '').replace(/\.(SH|SZ)$/, '');

const formatQuoteVolume = (value: number | null | undefined) => Number.isFinite(value) && Number(value) > 0
  ? `${(Number(value) / 1e4).toFixed(0)}万`
  : '--';

const formatQuoteAmount = (value: number | null | undefined) => Number.isFinite(value) && Number(value) > 0
  ? `${(Number(value) / 1e8).toFixed(2)}亿`
  : '--';

export default function App() {
  const [account, setAccount] = useState<SessionUser | null>(() => getSessionUser());
  const [authReady, setAuthReady] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('home');
  const [selectedSectorId, setSelectedSectorId] = useState<string | null>(null);
  const [prefilledStock, setPrefilledStock] = useState<{ name: string; code: string } | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [researchStock, setResearchStock] = useState<StockItem | null>(null);

  // Centralized Watchlist state（持久化于服务端 watchlist 表，登录后从 /api/watchlist 加载）
  const [followedStocks, setFollowedStocks] = useState<StockItem[]>([]);

  // DB 只存 symbol+name；实时行情字段先以占位展示，后续批次接入行情快照后再填充
  const toStockItem = (entry: WatchlistEntry): StockItem => ({
    code: entry.symbol,
    name: entry.name,
    price: Number.isFinite(entry.price) ? Number(entry.price) : 0,
    changePercent: Number.isFinite(entry.changePercent) ? Number(entry.changePercent) : 0,
    volume: formatQuoteVolume(entry.volume),
    turnover: formatQuoteAmount(entry.amount),
    history: [],
  });

  // Listen to global events for adding stocks to followed watchlist（持久化到服务端）
  useEffect(() => {
    const handleAddStock = (e: Event) => {
      const customEvent = e as CustomEvent<StockItem>;
      if (!customEvent.detail) return;
      const newStock = customEvent.detail;
      const symbol = normalizeWatchlistCode(newStock.code);
      void apiWatchlistAdd(symbol, newStock.name)
        .then((entry) => {
          setFollowedStocks((prev) =>
            prev.some((s) => normalizeWatchlistCode(s.code) === symbol) ? prev : [toStockItem(entry), ...prev],
          );
        })
        .catch(() => { /* 服务端失败则本次不加入，不打扰用户 */ });
    };
    window.addEventListener('add-stock-portfolio', handleAddStock);
    return () => window.removeEventListener('add-stock-portfolio', handleAddStock);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 登录/切换账号后从服务端加载自选股
  useEffect(() => {
    if (!account) {
      setFollowedStocks([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const items = await apiWatchlist();
        if (!cancelled) setFollowedStocks(items.map(toStockItem));
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          clearSession();
          if (!cancelled) setAccount(null);
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.id, activeTab === 'watchlist']);

  // 恢复会话：有本地 token 则向后端校验；失效则清理
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!getSessionUser()) {
        setAuthReady(true);
        return;
      }
      try {
        const user = await apiMe();
        if (!cancelled) setAccount(user);
      } catch {
        clearSession();
        if (!cancelled) setAccount(null);
      } finally {
        if (!cancelled) setAuthReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSelectSectorId = (sectorId: string | null) => {
    setSelectedSectorId(sectorId);
  };

  const handleAskTeacherAboutStock = (stockName: string, stockCode: string) => {
    setPrefilledStock({ name: stockName, code: stockCode });
  };

  const handleAskTeacherAboutSector = (name: string, question: string) => {
    setPrefilledStock(null);
    setPendingPrompt(question || `${name}现在处于什么阶段？`);
    setActiveTab('ai-teacher');
  };

  const handleClearPrefilledStock = () => {
    setPrefilledStock(null);
  };

  const handleConsumePendingPrompt = () => {
    setPendingPrompt(null);
  };

  const handleOpenResearch = (stock: StockItem) => {
    setResearchStock(stock);
    setActiveTab('stock-research');
  };

  const handleFollowResearchStock = (stock: StockItem) => {
    const symbol = normalizeWatchlistCode(stock.code);
    void apiWatchlistAdd(symbol, stock.name)
      .then((entry) => {
        setFollowedStocks((prev) =>
          prev.some((s) => normalizeWatchlistCode(s.code) === symbol) ? prev : [toStockItem(entry), ...prev],
        );
      })
      .catch(() => { /* 忽略失败 */ });
  };

  const handleRemoveWatchStock = async (symbol: string) => {
    setFollowedStocks((prev) => prev.filter((s) => normalizeWatchlistCode(s.code) !== symbol));
    try {
      await apiWatchlistRemove(symbol);
    } catch {
      // 删除失败时重新拉取服务端列表，避免本地与 DB 不一致
      try {
        const items = await apiWatchlist();
        setFollowedStocks(items.map(toStockItem));
      } catch { /* 网络异常，保持当前显示 */ }
    }
  };

  const handleOpenResearchEntry = () => {
    const stock = researchStock || followedStocks[0];
    if (stock) setResearchStock(stock);
    setActiveTab('stock-research');
  };

  const handleAuthenticated = (user: SessionUser) => {
    setAccount(user);
  };

  const handleUpdateNickname = async (nickname: string) => {
    try {
      const updated = await apiUpdateNickname(nickname);
      setAccount(updated);
    } catch { /* 服务端/网络失败时保持原昵称 */ }
  };

  const handleSignOut = async () => {
    try { await apiLogout(); } catch { clearSession(); }
    setAccount(null);
    setActiveTab('home');
  };

  if (ACCOUNT_FEATURE_ENABLED && !authReady) {
    return <div className="min-h-screen bg-slate-50" />;
  }

  if (ACCOUNT_FEATURE_ENABLED && !account) {
    return <LoginScreen onAuthenticated={handleAuthenticated} />;
  }

  return (
    <div id="app-root-container" className="min-h-screen bg-[#F8FAFC] text-gray-900 font-sans flex justify-center">
      {/* Centered Mobile Frame container to match design and prevent layout stretching on large screens */}
      <div id="app-device-frame" className="w-full max-w-md bg-white min-h-screen shadow-2xl shadow-slate-200 border-x border-gray-100 flex flex-col justify-between relative overflow-hidden">
        
        {/* Main Viewport Content Scrollable Area */}
        <div id="app-viewport" className="flex-grow overflow-y-auto no-scrollbar">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.15 }}
              className="p-1"
            >
              {activeTab === 'home' && (
                <HomeTab
                  onSelectSector={handleSelectSectorId}
                  onNavigateToTab={(tabId) => setActiveTab(tabId as TabId)}
                  onAskTeacherAboutStock={handleAskTeacherAboutStock}
                  followedStocks={followedStocks}
                />
              )}
              {activeTab === 'market-map' && (
                <MarketMapTab
                  selectedSectorId={selectedSectorId}
                  onSelectSectorId={handleSelectSectorId}
                  onNavigateToTab={(tabId) => setActiveTab(tabId as TabId)}
                  onAskTeacherAboutSector={handleAskTeacherAboutSector}
                />
              )}
              {activeTab === 'watchlist' && (
                <WatchlistTab
                  followedStocks={followedStocks}
                  onRemoveStock={handleRemoveWatchStock}
                  onAskTeacherAboutStock={handleAskTeacherAboutStock}
                  onNavigateToTab={(tabId) => setActiveTab(tabId as TabId)}
                  onOpenResearch={handleOpenResearch}
                />
              )}
              {activeTab === 'stock-research' && (researchStock ? (
                <StockResearchTab stock={researchStock} followedStocks={followedStocks} onSelectStock={setResearchStock} onFollowStock={handleFollowResearchStock} onBack={() => setActiveTab('watchlist')} onAskTeacher={() => { handleAskTeacherAboutStock(researchStock.name, researchStock.code); setActiveTab('ai-teacher'); }} />
              ) : (
                <StockResearchEmptyState followedStocks={followedStocks} onSelectStock={setResearchStock} onBack={() => setActiveTab('watchlist')} />
              ))}
              {activeTab === 'ai-teacher' && (
                <AiTeacherTab
                  prefilledStock={prefilledStock}
                  onClearPrefilledStock={handleClearPrefilledStock}
                  pendingPrompt={pendingPrompt}
                  onConsumePendingPrompt={handleConsumePendingPrompt}
                />
              )}
              {ACCOUNT_FEATURE_ENABLED && activeTab === 'mine' && account && (
                <MineTab
                  account={account}
                  onUpdateNickname={handleUpdateNickname}
                  onSignOut={handleSignOut}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Global Bottom Navigation Bar - Clean 5-tab design */}
        <nav id="bottom-tab-bar" className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-white/95 backdrop-blur-md border-t border-slate-100 px-2 py-2 flex justify-between items-center z-40 h-16">
          
          {/* Tab: 首页 */}
          <button
            id="tab-btn-home"
            onClick={() => setActiveTab('home')}
              className={`order-1 flex flex-col items-center justify-center flex-1 py-1 transition-all relative ${
              activeTab === 'home' ? 'text-indigo-600 scale-105 font-semibold' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <Home className="w-4.5 h-4.5 stroke-[2.2]" />
            <span className="text-[9px] mt-1 tracking-tight">首页</span>
            {activeTab === 'home' && (
              <motion.div layoutId="activeTabDot" className="absolute -bottom-1 w-1 h-1 bg-indigo-600 rounded-full" />
            )}
          </button>

          {/* Tab: 市场地图 */}
          <button
            id="tab-btn-market-map"
            onClick={() => setActiveTab('market-map')}
              className={`order-2 flex flex-col items-center justify-center flex-1 py-1 transition-all relative ${
              activeTab === 'market-map' ? 'text-indigo-600 scale-105 font-semibold' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <Compass className="w-4.5 h-4.5 stroke-[2.2]" />
            <span className="text-[9px] mt-1 tracking-tight">市场地图</span>
            {activeTab === 'market-map' && (
              <motion.div layoutId="activeTabDot" className="absolute -bottom-1 w-1 h-1 bg-indigo-600 rounded-full" />
            )}
          </button>

          {/* Tab: 我的关注 */}
          <button
            id="tab-btn-watchlist"
            onClick={() => setActiveTab('watchlist')}
              className={`order-4 flex flex-col items-center justify-center flex-1 py-1 transition-all relative ${
              activeTab === 'watchlist' ? 'text-indigo-600 scale-105 font-semibold' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <Star className="w-4.5 h-4.5 stroke-[2.2]" />
            <span className="text-[9px] mt-1 tracking-tight">我的关注</span>
            {activeTab === 'watchlist' && (
              <motion.div layoutId="activeTabDot" className="absolute -bottom-1 w-1 h-1 bg-indigo-600 rounded-full" />
            )}
          </button>

          {/* Tab: 个股分析 */}
          <button
            id="tab-btn-stock-research"
            onClick={handleOpenResearchEntry}
              className={`order-3 flex flex-col items-center justify-center flex-1 py-1 transition-all relative ${
              activeTab === 'stock-research' ? 'text-indigo-600 scale-105 font-semibold' : 'text-slate-400 hover:text-slate-600'
            }`}
            aria-label="打开个股分析"
          >
            <BarChart3 className="w-4.5 h-4.5 stroke-[2.2]" />
            <span className="text-[9px] mt-1 tracking-tight">个股分析</span>
            {activeTab === 'stock-research' && (
              <motion.div layoutId="activeTabDot" className="absolute -bottom-1 w-1 h-1 bg-indigo-600 rounded-full" />
            )}
          </button>

          {/* Tab: AI泡泡 */}
          <button
            id="tab-btn-ai-teacher"
            onClick={() => setActiveTab('ai-teacher')}
              className={`order-5 flex flex-col items-center justify-center flex-1 py-1 transition-all relative ${
              activeTab === 'ai-teacher' ? 'text-indigo-600 scale-105 font-semibold' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <MessageSquare className="w-4.5 h-4.5 stroke-[2.2]" />
            <span className="text-[9px] mt-1 tracking-tight">AI泡泡</span>
            {activeTab === 'ai-teacher' && (
              <motion.div layoutId="activeTabDot" className="absolute -bottom-1 w-1 h-1 bg-indigo-600 rounded-full" />
            )}
          </button>

          {/* 暂停个人中心入口；恢复时将 ACCOUNT_FEATURE_ENABLED 改为 true。 */}
          {ACCOUNT_FEATURE_ENABLED && <button
            id="tab-btn-mine"
            onClick={() => setActiveTab('mine')}
            className={`order-6 flex flex-col items-center justify-center flex-1 py-1 transition-all relative ${
              activeTab === 'mine' ? 'text-indigo-600 scale-105 font-semibold' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <User className="w-4.5 h-4.5 stroke-[2.2]" />
            <span className="text-[9px] mt-1 tracking-tight">个人中心</span>
            {activeTab === 'mine' && (
              <motion.div layoutId="activeTabDot" className="absolute -bottom-1 w-1 h-1 bg-indigo-600 rounded-full" />
            )}
          </button>}
        </nav>
      </div>
    </div>
  );
}
