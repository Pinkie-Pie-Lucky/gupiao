/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, TrendingUp, TrendingDown, Eye, MessageSquare, PieChart, Activity, Briefcase, ChevronRight } from 'lucide-react';
import { StockSector, StockItem } from '../types';
import { initialSectors } from '../data';
import { InteractiveChart } from './InteractiveChart';

interface MarketMapTabProps {
  selectedSectorId: string | null;
  onSelectSectorId: (sectorId: string | null) => void;
  onNavigateToTab: (tabId: string) => void;
  onAskTeacherAboutStock: (stockName: string, stockCode: string) => void;
}

export function MarketMapTab({
  selectedSectorId,
  onSelectSectorId,
  onNavigateToTab,
  onAskTeacherAboutStock,
}: MarketMapTabProps) {
  const [sectors, setSectors] = useState<StockSector[]>(initialSectors);
  const [activeSector, setActiveSector] = useState<StockSector>(
    initialSectors.find((s) => s.id === selectedSectorId) || initialSectors[0]
  );
  const [selectedStock, setSelectedStock] = useState<StockItem | null>(null);
  const [filterQuery, setFilterQuery] = useState('');

  // Sync state if selectedSectorId changes from parent
  useEffect(() => {
    if (selectedSectorId) {
      const match = sectors.find((s) => s.id === selectedSectorId);
      if (match) {
        setActiveSector(match);
      }
    }
  }, [selectedSectorId, sectors]);

  // Simulate price changes on stocks in real time!
  useEffect(() => {
    const interval = setInterval(() => {
      setSectors((prevSectors) =>
        prevSectors.map((sector) => {
          let sectorChangeSum = 0;
          const updatedStocks = sector.stocks.map((stock) => {
            const pctChange = (Math.random() - 0.48) * 0.5; // Tick stock price slightly
            const newPrice = parseFloat((stock.price * (1 + pctChange / 100)).toFixed(2));
            const newPct = parseFloat((stock.changePercent + pctChange).toFixed(2));
            sectorChangeSum += newPct;
            return {
              ...stock,
              price: newPrice,
              changePercent: newPct,
            };
          });

          const averageSectorChange = parseFloat((sectorChangeSum / sector.stocks.length).toFixed(2));
          const updatedSector = {
            ...sector,
            changePercent: averageSectorChange,
            stocks: updatedStocks,
          };

          // If this is the active sector, keep it updated
          if (sector.id === activeSector.id) {
            setActiveSector(updatedSector);
          }

          return updatedSector;
        })
      );
    }, 5000);

    return () => clearInterval(interval);
  }, [activeSector]);

  const filteredSectors = sectors.filter((s) =>
    s.name.toLowerCase().includes(filterQuery.toLowerCase())
  );

  return (
    <div id="market-map-tab-view" className="space-y-6 pb-24">
      {/* Tab Title */}
      <div id="map-header" className="px-4 pt-2">
        <h2 id="map-title" className="text-2xl font-bold text-gray-950 flex items-center gap-2">
          <PieChart className="w-6 h-6 text-indigo-600" />
          全景市场地图
        </h2>
        <p id="map-subtitle" className="text-xs text-gray-400 mt-1">
          直观掌控A股热门行业主力脉搏与成分股动向，数据每 5s 动态更新
        </p>
      </div>

      {/* Filter Sector Row */}
      <div id="map-search-row" className="px-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4.5 h-4.5" />
          <input
            id="map-filter-input"
            type="text"
            placeholder="搜索行业板块 (如AI算力, 半导体)..."
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            className="w-full bg-gray-50 text-gray-900 placeholder-gray-400 pl-10 pr-4 py-2 rounded-2xl border border-gray-200 focus:outline-none focus:border-indigo-500 focus:bg-white text-sm transition-all"
          />
        </div>
      </div>

      {/* Grid of Sector Tags (Heatmap style) */}
      <div id="sector-chips-carousel" className="px-4 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
        {filteredSectors.map((sector) => {
          const isActive = sector.id === activeSector.id;
          const isUp = sector.changePercent >= 0;
          return (
            <button
              key={sector.id}
              id={`sector-chip-${sector.id}`}
              onClick={() => {
                setActiveSector(sector);
                onSelectSectorId(sector.id);
                setSelectedStock(null);
              }}
              className={`flex-shrink-0 px-4 py-2.5 rounded-2xl text-xs font-bold transition-all flex items-center gap-1.5 border ${
                isActive
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-600/15 scale-105'
                  : 'bg-white text-gray-700 border-gray-100 hover:border-gray-300'
              }`}
            >
              <span>{sector.name}</span>
              <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-mono ${
                isActive 
                  ? 'bg-white/20 text-white' 
                  : isUp ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'
              }`}>
                {isUp ? '+' : ''}{sector.changePercent}%
              </span>
            </button>
          );
        })}
      </div>

      {/* Active Sector Analysis Panel */}
      <div id="active-sector-panel" className="mx-4 bg-white border border-gray-100 rounded-3xl p-5 shadow-sm space-y-4">
        {/* Sector Title Summary */}
        <div className="flex justify-between items-start">
          <div>
            <h3 id="active-sector-header-title" className="text-lg font-bold text-gray-950 flex items-center gap-2">
              <Activity className="w-5 h-5 text-indigo-600" />
              {activeSector.name} 板块全景
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">主力资金今日大单净占比：
              <span className={`font-bold ml-1 ${activeSector.changePercent >= 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                {activeSector.changePercent >= 2 ? '+5.8% (净流入)' : activeSector.changePercent >= 0 ? '+1.2% (偏多)' : '-2.4% (流出)'}
              </span>
            </p>
          </div>
          <div className={`px-3 py-1.5 rounded-xl font-bold font-mono text-sm ${activeSector.changePercent >= 0 ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}>
            {activeSector.changePercent >= 0 ? '↑' : '↓'} {activeSector.changePercent}%
          </div>
        </div>

        {/* Sector description */}
        <p id="active-sector-summary-text" className="text-xs text-gray-600 leading-relaxed bg-gray-50/50 rounded-2xl p-4 border border-gray-100/50">
          {activeSector.description}
        </p>

        {/* Recharts sector simulated visual index representation */}
        <InteractiveChart
          data={activeSector.stocks[0]?.history || []}
          title={`${activeSector.name} 综合行业走势 (1D)`}
          isPositive={activeSector.changePercent >= 0}
        />
      </div>

      {/* Component Stocks Grid */}
      <div id="sector-stocks-grid-section" className="space-y-3 px-4">
        <h3 id="stocks-list-heading" className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
          <Briefcase className="w-4 h-4 text-gray-500" />
          {activeSector.name} 成分股详情
        </h3>
        
        <div id="sector-stocks-rows" className="space-y-2.5">
          {activeSector.stocks.map((stock) => {
            const isUp = stock.changePercent >= 0;
            const isSelected = selectedStock?.code === stock.code;
            return (
              <div
                key={stock.code}
                id={`map-stock-card-${stock.code}`}
                className={`bg-white border rounded-2xl transition-all overflow-hidden ${
                  isSelected ? 'border-indigo-500 shadow-sm' : 'border-gray-100 hover:border-gray-200'
                }`}
              >
                {/* Header row click toggles expansion chart */}
                <div
                  onClick={() => setSelectedStock(isSelected ? null : stock)}
                  className="flex justify-between items-center p-4 cursor-pointer hover:bg-gray-50/30 transition-colors"
                >
                  <div>
                    <div className="font-semibold text-sm text-gray-950 flex items-center gap-1.5">
                      {stock.name}
                      <span className="text-[10px] text-gray-400 font-mono">{stock.code}</span>
                    </div>
                    <div className="flex gap-4 text-[10px] text-gray-400 font-medium mt-1">
                      <span>成交量: {stock.volume}</span>
                      <span>成交额: {stock.turnover}</span>
                    </div>
                  </div>

                  <div className="text-right flex items-center gap-3">
                    <div>
                      <div className="font-bold text-sm font-mono text-gray-900 leading-none">
                        ¥{stock.price.toFixed(2)}
                      </div>
                      <div className={`text-[10px] font-bold font-mono mt-1 ${isUp ? 'text-red-500' : 'text-emerald-500'}`}>
                        {isUp ? '+' : ''}{stock.changePercent}%
                      </div>
                    </div>
                    <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform ${isSelected ? 'rotate-90 text-indigo-600' : ''}`} />
                  </div>
                </div>

                {/* Expanded Chart & AI Action Area */}
                <AnimatePresence>
                  {isSelected && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25 }}
                      className="border-t border-gray-100 bg-gray-50/30 p-4 space-y-4 overflow-hidden"
                    >
                      <InteractiveChart
                        data={stock.history}
                        title={`${stock.name} 实时极速K线`}
                        symbolCode={stock.code}
                        isPositive={isUp}
                      />

                      {/* Stock actions */}
                      <div className="flex gap-2">
                        <button
                          id={`btn-ask-bot-stock-${stock.code}`}
                          onClick={() => {
                            onAskTeacherAboutStock(stock.name, stock.code);
                            onNavigateToTab('ai-teacher');
                          }}
                          className="flex-1 bg-indigo-600 text-white font-semibold text-xs py-2.5 rounded-xl hover:bg-indigo-700 active:scale-98 transition-all flex items-center justify-center gap-1.5 shadow-sm"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                          向泡泡老师提问此股
                        </button>
                        <button
                          id={`btn-stock-add-portfolio-${stock.code}`}
                          onClick={() => {
                            // Dispatch event to simulate portfolio addition
                            const customEvent = new CustomEvent('add-stock-portfolio', { detail: stock });
                            window.dispatchEvent(customEvent);
                          }}
                          className="flex-1 bg-white text-gray-700 border border-gray-200 font-semibold text-xs py-2.5 rounded-xl hover:bg-gray-100 hover:text-gray-950 active:scale-98 transition-all flex items-center justify-center gap-1.5"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          加入我的关注
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
