/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { HomeTab, type HomeDashboardCache } from './components/HomeTab';
import { MarketMapTab } from './components/MarketMapTab';
import { WatchlistTab } from './components/WatchlistTab';
import { AiTeacherTab } from './components/AiTeacherTab';
import { MineTab } from './components/MineTab';
import { StockResearchTab } from './components/StockResearchTab';
import { StockResearchEmptyState } from './components/StockResearchEmptyState';
import { StockScreenerTab } from './components/StockScreenerTab';
import { LoginScreen } from './components/LoginScreen';
import { AdminTab } from './components/AdminTab';
import { apiLogout, apiMe, apiUpdateNickname, apiWatchlist, apiWatchlistAdd, apiWatchlistRemove, apiRefreshMarketContent, clearSession, getSessionUser, reportPageView, ApiError, type User as SessionUser, type WatchlistEntry } from './lib/api';
import { Home, Compass, Star, MessageSquare, User, BarChart3, SlidersHorizontal, ShieldCheck } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { StockItem } from './types';
import { ResponsiveAppShell, type AppNavigationItem } from './components/ResponsiveAppShell';
import { useDeviceLayout } from './hooks/useDeviceLayout';

type TabId = 'home' | 'market-map' | 'watchlist' | 'ai-teacher' | 'mine' | 'stock-research' | 'stock-screener' | 'admin';

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
  const [darkMode, setDarkMode] = useState(() => window.localStorage.getItem('bubble-theme') === 'dark');
  const deviceLayout = useDeviceLayout();
  const [account, setAccount] = useState<SessionUser | null>(() => getSessionUser());
  const [authReady, setAuthReady] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('home');
  const [selectedSectorId, setSelectedSectorId] = useState<string | null>(null);
  const [prefilledStock, setPrefilledStock] = useState<{ name: string; code: string } | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [researchStock, setResearchStock] = useState<StockItem | null>(null);
  // 首页会在标签切换时卸载；保留已加载的市场概览与早报，避免返回首页出现空白加载态。
  const [homeCache, setHomeCache] = useState<HomeDashboardCache | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [globalRefreshing, setGlobalRefreshing] = useState(false);
  const [globalRefreshMessage, setGlobalRefreshMessage] = useState<string | null>(null);

  // Centralized Watchlist state（持久化于服务端 watchlist 表，登录后从 /api/watchlist 加载）
  const [followedStocks, setFollowedStocks] = useState<StockItem[]>([]);

  // 页面浏览埋点：记录当前页进入时间；切换 tab / 登出 / 关页时上报停留时长（PV 口径）
  const pageEnterRef = useRef<{ tab: TabId; at: number } | null>(null);
  useEffect(() => {
    const now = Date.now();
    if (!account) {
      const previous = pageEnterRef.current;
      if (previous) reportPageView(previous.tab, now - previous.at); // 登出时补报最后一段
      pageEnterRef.current = null;
      return;
    }
    const previous = pageEnterRef.current;
    if (previous && previous.tab !== activeTab) {
      reportPageView(previous.tab, now - previous.at);
    }
    pageEnterRef.current = { tab: activeTab, at: now };
  }, [activeTab, account]);

  // 关页（含移动端切后台）时兜底上报；重复注册/卸载只清理监听，不触发上报
  useEffect(() => {
    const handleHide = () => {
      const current = pageEnterRef.current;
      if (current) reportPageView(current.tab, Date.now() - current.at);
    };
    window.addEventListener('pagehide', handleHide);
    return () => window.removeEventListener('pagehide', handleHide);
  }, []);

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

  const handleGlobalRefresh = useCallback(async () => {
    if (globalRefreshing) return;
    setGlobalRefreshing(true);
    setGlobalRefreshMessage('正在回源真实行情并生成 AI 内容…');
    try {
      const result = await apiRefreshMarketContent();
      setHomeCache(null);
      setRefreshVersion((value) => value + 1);
      if (account) {
        const items = await apiWatchlist();
        setFollowedStocks(items.map(toStockItem));
      }
      setGlobalRefreshMessage(result.ok ? '已更新真实行情与 AI 内容' : '行情已更新，部分 AI 内容暂未生成');
    } catch (error: any) {
      setGlobalRefreshMessage(error?.message || '刷新失败，请稍后重试');
    } finally {
      setGlobalRefreshing(false);
      window.setTimeout(() => setGlobalRefreshMessage(null), 3600);
    }
  }, [account, globalRefreshing]);

  if (ACCOUNT_FEATURE_ENABLED && !authReady) {
    return <div className="min-h-screen bg-slate-50" />;
  }

  if (ACCOUNT_FEATURE_ENABLED && !account) {
    return <LoginScreen onAuthenticated={handleAuthenticated} />;
  }

  const navigation: AppNavigationItem[] = [
    { id: 'home', label: '首页', icon: Home, onSelect: () => setActiveTab('home') },
    { id: 'market-map', label: '市场地图', icon: Compass, onSelect: () => setActiveTab('market-map') },
    { id: 'watchlist', label: '我的关注', icon: Star, onSelect: () => setActiveTab('watchlist') },
    ...(deviceLayout !== 'mobile' ? [{ id: 'stock-screener', label: '条件选股', icon: SlidersHorizontal, onSelect: () => setActiveTab('stock-screener') }] : []),
    { id: 'stock-research', label: '个股分析', icon: BarChart3, onSelect: handleOpenResearchEntry },
    { id: 'ai-teacher', label: 'AI泡泡', icon: MessageSquare, onSelect: () => setActiveTab('ai-teacher') },
    ...(ACCOUNT_FEATURE_ENABLED ? [{ id: 'mine', label: '个人中心', icon: User, onSelect: () => setActiveTab('mine') }] : []),
    // 管理端入口仅对 admin 角色可见；权限闸门在后端（非 admin 调 /api/admin/* 一律 403）
    ...(account?.role === 'admin' ? [{ id: 'admin', label: '管理后台', icon: ShieldCheck, onSelect: () => setActiveTab('admin') }] : []),
  ];
  const pageTitles: Record<TabId, string> = {
    home: '首页', 'market-map': '市场地图', watchlist: '我的关注', 'stock-screener': '条件选股', 'stock-research': '个股分析', 'ai-teacher': 'AI 泡泡', mine: '个人中心', admin: '管理后台',
  };

  return (
    <ResponsiveAppShell
      layout={deviceLayout}
      darkMode={darkMode}
      onToggleTheme={() => setDarkMode((value) => { const next = !value; window.localStorage.setItem('bubble-theme', next ? 'dark' : 'light'); return next; })}
      activeId={activeTab}
      navigation={navigation}
      title={pageTitles[activeTab]}
      onRefresh={() => void handleGlobalRefresh()}
      refreshing={globalRefreshing}
      refreshMessage={globalRefreshMessage}
      hideRefresh={activeTab === 'stock-research'}
    >
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
                  homeCache={homeCache}
                  onHomeCacheChange={setHomeCache}
                  refreshVersion={refreshVersion}
                />
              )}
              {activeTab === 'market-map' && (
                <MarketMapTab
                  selectedSectorId={selectedSectorId}
                  onSelectSectorId={handleSelectSectorId}
                  onNavigateToTab={(tabId) => setActiveTab(tabId as TabId)}
                  onAskTeacherAboutSector={handleAskTeacherAboutSector}
                  refreshVersion={refreshVersion}
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
              {activeTab === 'stock-screener' && <StockScreenerTab followedStocks={followedStocks} onOpenResearch={handleOpenResearch} onFollowStock={handleFollowResearchStock} />}
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
              {activeTab === 'admin' && account?.role === 'admin' && (
                <AdminTab currentUserId={account.id} />
              )}
            </motion.div>
          </AnimatePresence>
    </ResponsiveAppShell>
  );
}
