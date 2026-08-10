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
import { getActiveAccount, getStoredAccount, registerLocalAccount, signInLocalAccount, signOutLocalAccount, updateLocalNickname, type LocalAccount } from './lib/localAccount';
import { Home, Compass, Star, MessageSquare, User, BarChart3 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { StockItem } from './types';

type TabId = 'home' | 'market-map' | 'watchlist' | 'ai-teacher' | 'mine' | 'stock-research';

// 暂停个人中心与本机体验登录；恢复时改为 true 即可，无需重写账号相关代码。
const ACCOUNT_FEATURE_ENABLED = false;

const normalizeWatchlistCode = (code: string) => String(code || '').trim().toUpperCase().replace(/^(SH|SZ)/, '').replace(/\.(SH|SZ)$/, '');

export default function App() {
  const [account, setAccount] = useState<LocalAccount | null>(() => getActiveAccount());
  const [activeTab, setActiveTab] = useState<TabId>('home');
  const [selectedSectorId, setSelectedSectorId] = useState<string | null>(null);
  const [prefilledStock, setPrefilledStock] = useState<{ name: string; code: string } | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [researchStock, setResearchStock] = useState<StockItem | null>(null);

  // Centralized Watchlist state shared among tabs
  const [followedStocks, setFollowedStocks] = useState<StockItem[]>([
    {
      name: '科大讯飞',
      code: '002230.SZ',
      price: 45.12,
      changePercent: 2.85,
      volume: '28.9万手',
      turnover: '13.0亿元',
      history: []
    },
    {
      name: '中芯国际',
      code: '688981.SH',
      price: 53.42,
      changePercent: 4.21,
      volume: '38.4万手',
      turnover: '20.3亿元',
      history: []
    }
  ]);

  // Listen to global events for adding stocks to followed watchlist
  useEffect(() => {
    const handleAddStock = (e: Event) => {
      const customEvent = e as CustomEvent<StockItem>;
      if (customEvent.detail) {
        const newStock = customEvent.detail;
        setFollowedStocks((prev) => {
          if (prev.some((s) => normalizeWatchlistCode(s.code) === normalizeWatchlistCode(newStock.code))) return prev;
          return [newStock, ...prev];
        });
      }
    };
    window.addEventListener('add-stock-portfolio', handleAddStock);
    return () => window.removeEventListener('add-stock-portfolio', handleAddStock);
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
    setFollowedStocks((prev) => {
      if (prev.some((item) => normalizeWatchlistCode(item.code) === normalizeWatchlistCode(stock.code))) return prev;
      return [stock, ...prev];
    });
  };

  const handleOpenResearchEntry = () => {
    const stock = researchStock || followedStocks[0];
    if (stock) setResearchStock(stock);
    setActiveTab('stock-research');
  };

  const handleRegister = (phone: string, nickname: string) => {
    setAccount(registerLocalAccount({ phone, nickname }));
  };

  const handleSignIn = (phone: string) => {
    const signedInAccount = signInLocalAccount(phone);
    if (signedInAccount) setAccount(signedInAccount);
    return Boolean(signedInAccount);
  };

  const handleUpdateNickname = (nickname: string) => {
    const updatedAccount = updateLocalNickname(nickname);
    if (updatedAccount) setAccount(updatedAccount);
  };

  const handleSignOut = () => {
    signOutLocalAccount();
    setAccount(null);
    setActiveTab('home');
  };

  if (ACCOUNT_FEATURE_ENABLED && !account) {
    return <LoginScreen existingPhone={getStoredAccount()?.phone || null} onRegister={handleRegister} onSignIn={handleSignIn} />;
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
                  setFollowedStocks={setFollowedStocks}
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
