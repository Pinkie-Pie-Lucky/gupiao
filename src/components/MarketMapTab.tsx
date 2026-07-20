/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, TrendingUp, TrendingDown, Eye, MessageSquare, PieChart, Activity, Briefcase, ChevronRight, AlertTriangle } from 'lucide-react';
import { StockSector, StockItem } from '../types';
import { InteractiveChart } from './InteractiveChart';

interface RawSector {
  id: string;
  name: string;
  changePercent: number;
  description: string;
}

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
  const [sectors, setSectors] = useState<RawSector[]>([]);
  const [activeSector, setActiveSector] = useState<RawSector | null>(null);
  const [filterQuery, setFilterQuery] = useState('');
  const [dataError, setDataError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // 直接从后端获取真实板块数据
  useEffect(() => {
    let cancelled = false;
    async function loadSectors() {
      try {
        const res = await fetch('/api/sectors');
        if (!res.ok) throw new Error('Sector API failed');
        const data = await res.json();
        if (!cancelled && data.sectors?.length > 0) {
          const mapped = data.sectors.map((s: any, i: number) => ({
            id: s.id || `sector-${i}`,
            name: s.name,
            changePercent: s.changePercent,
            description: '',
          }));
          setSectors(mapped);
          setActiveSector(mapped[0]);
        } else {
          setDataError('暂无可用板块数据');
        }
      } catch {
        if (!cancelled) setDataError('板块实时数据获取失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadSectors();
    return () => { cancelled = true; };
  }, []);

  // Sync active sector when selectedSectorId changes from parent
  useEffect(() => {
    if (selectedSectorId && sectors.length > 0) {
      const match = sectors.find((s) => s.id === selectedSectorId);
      if (match) setActiveSector(match);
    }
  }, [selectedSectorId, sectors]);

  const filteredSectors = sectors.filter((s) =>
    s.name.toLowerCase().includes(filterQuery.toLowerCase())
  );

  if (loading) {
    return (
      <div id="market-map-tab-view" className="space-y-6 pb-24">
        <div id="map-header" className="px-4 pt-2">
          <h2 className="text-2xl font-bold text-gray-950 flex items-center gap-2">
            <PieChart className="w-6 h-6 text-indigo-600" />
            全景市场地图
          </h2>
        </div>
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
            <span className="text-xs text-gray-400">加载中...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div id="market-map-tab-view" className="space-y-6 pb-24">
      {/* Tab Title */}
      <div id="map-header" className="px-4 pt-2">
        <h2 id="map-title" className="text-2xl font-bold text-gray-950 flex items-center gap-2">
          <PieChart className="w-6 h-6 text-indigo-600" />
          全景市场地图
        </h2>
        <p id="map-subtitle" className="text-xs text-gray-400 mt-1">
          东方财富实时板块行情
          {sectors.length > 0 && (
            <span className="text-emerald-500 ml-1">● {sectors.length} 个板块 · 真实数据</span>
          )}
        </p>
        {dataError && (
          <div className="flex items-center gap-1 mt-1 text-[10px] text-yellow-600 bg-yellow-50 px-2 py-1 rounded-lg">
            <AlertTriangle className="w-3 h-3" />
            <span>{dataError}</span>
          </div>
        )}
      </div>

      {/* Filter Sector Row */}
      <div id="map-search-row" className="px-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4.5 h-4.5" />
          <input
            id="map-filter-input"
            type="text"
            placeholder="搜索行业板块..."
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            className="w-full bg-gray-50 text-gray-900 placeholder-gray-400 pl-10 pr-4 py-2 rounded-2xl border border-gray-200 focus:outline-none focus:border-indigo-500 focus:bg-white text-sm transition-all"
          />
        </div>
      </div>

      {/* Grid of Sector Tags (Heatmap style) */}
      <div id="sector-chips-carousel" className="px-4 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
        {filteredSectors.map((sector) => {
          const isActive = activeSector?.id === sector.id;
          const isUp = sector.changePercent >= 0;
          return (
            <button
              key={sector.id}
              onClick={() => {
                setActiveSector(sector);
                onSelectSectorId(sector.id);
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
      {activeSector && (
        <div id="active-sector-panel" className="mx-4 bg-white border border-gray-100 rounded-3xl p-5 shadow-sm space-y-4">
          <div className="flex justify-between items-start">
            <div>
              <h3 id="active-sector-header-title" className="text-lg font-bold text-gray-950 flex items-center gap-2">
                <Activity className="w-5 h-5 text-indigo-600" />
                {activeSector.name}
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">
                板块涨跌幅：
                <span className={`font-bold ml-1 ${activeSector.changePercent >= 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                  {activeSector.changePercent >= 0 ? '+' : ''}{activeSector.changePercent}%
                </span>
              </p>
            </div>
            <div className={`px-3 py-1.5 rounded-xl font-bold font-mono text-sm ${activeSector.changePercent >= 0 ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}>
              {activeSector.changePercent >= 0 ? '↑' : '↓'} {activeSector.changePercent}%
            </div>
          </div>
        </div>
      )}

      {/* 空状态提示 */}
      {filteredSectors.length === 0 && !loading && (
        <div className="text-center text-gray-400 text-xs py-10">
          未找到匹配的板块
        </div>
      )}
    </div>
  );
}