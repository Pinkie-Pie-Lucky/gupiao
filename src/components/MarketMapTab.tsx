/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Compass,
  Heart,
  Layers3,
  MessageCircle,
  Search,
  Sparkles,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { SectorIntelligence } from '../types';
import { SectorDetailPanel } from './SectorDetailPanel';

interface MarketMapTabProps {
  selectedSectorId: string | null;
  onSelectSectorId: (sectorId: string | null) => void;
  onNavigateToTab: (tabId: string) => void;
  onAskTeacherAboutSector: (name: string, question: string) => void;
}

interface IntelligenceResponse {
  sectors: SectorIntelligence[];
  timestamp?: string;
}

type MapFilter = 'all' | 'featured' | 'anomaly' | 'followed';
type CategoryScope = 'all' | 'industry' | 'concept';

const tagStyles: Record<string, string> = {
  今日主线: 'bg-violet-100 text-violet-700',
  异动放量: 'bg-amber-100 text-amber-800',
  新闻驱动: 'bg-sky-100 text-sky-700',
  资金扩散: 'bg-cyan-100 text-cyan-800',
  值得观察: 'bg-slate-100 text-slate-700',
  与我有关: 'bg-rose-100 text-rose-700',
};

export function MarketMapTab({ selectedSectorId, onSelectSectorId, onNavigateToTab, onAskTeacherAboutSector }: MarketMapTabProps) {
  const [sectors, setSectors] = useState<SectorIntelligence[]>([]);
  const [activeSector, setActiveSector] = useState<SectorIntelligence | null>(null);
  const [detailTarget, setDetailTarget] = useState<{ sectorId: string; sectorName: string } | null>(null);
  const [filterQuery, setFilterQuery] = useState('');
  const [mapFilter, setMapFilter] = useState<MapFilter>('all');
  const [categoryScope, setCategoryScope] = useState<CategoryScope>('all');
  const [followedSectorIds, setFollowedSectorIds] = useState<string[]>([]);
  const [dataError, setDataError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [marketSummary, setMarketSummary] = useState<{sentiment?:string; upSectors?:number; downSectors?:number; temperature?:number; temperatureLabel?:string; indices?:Array<{name:string;changePercent:number}>} | null>(null);

  // Fetch market overview
  useEffect(() => {
    fetch('/api/market-overview').then(r=>r.json()).then(d=>{
      if (d && !d.error) {
        setMarketSummary({
          indices: (d.indices||[]).slice(0,3),
          upSectors: d.marketBreath?.up,
          downSectors: d.marketBreath?.down,
          temperature: d.marketTemperature?.score,
          temperatureLabel: d.marketTemperature?.text,
        });
      }
    }).catch(()=>{});
  }, []);
  useEffect(() => {
    let live = true;
    async function load() {
      try {
        const r = await fetch(`/api/market-map/intelligence?t=${Date.now()}`);
        if (!r.ok) throw new Error('fail');
        const d = await r.json() as IntelligenceResponse;
        if (!live) return;
        const s = d.sectors || [];
        setSectors(s);
        const target = selectedSectorId ? s.find(i => i.sectorId === selectedSectorId) : undefined;
        setActiveSector(target || s.find(i => i.shouldHighlight) || s[0] || null);
        setUpdatedAt(d.timestamp || null);
        if (selectedSectorId && target) {
          setDetailTarget({ sectorId: target.sectorId, sectorName: target.sector });
        }
        if (!s.length) setDataError('暂时没有可用于绘制市场地图的板块数据。');
      } catch {
        if (live) setDataError('市场地图暂时无法更新，请稍后刷新重试。');
      } finally { if (live) setLoading(false); }
    }
    load();
    return () => { live = false; };
  }, [selectedSectorId]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('market-map-followed-sectors') || '[]');
      if (Array.isArray(saved)) setFollowedSectorIds(saved.filter(i => typeof i === 'string'));
    } catch {}
  }, []);

  const toggleFollowedSector = (sectorId: string) => {
    setFollowedSectorIds(prev => {
      const next = prev.includes(sectorId)
        ? prev.filter(id => id !== sectorId)
        : [...prev, sectorId];
      try {
        localStorage.setItem('market-map-followed-sectors', JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const selectSector = (sector: SectorIntelligence) => {
    setActiveSector(sector);
    onSelectSectorId(sector.sectorId);
    setDetailTarget({ sectorId: sector.sectorId, sectorName: sector.sector });
  };

  const filterCounts = useMemo(() => ({
    all: sectors.length,
    featured: Math.min(10, sectors.filter(s => s.shouldHighlight).length),
    anomaly: Math.min(10, sectors.filter(s => s.isAnomaly).length),
    followed: followedSectorIds.length,
  }), [sectors, followedSectorIds]);

  const filteredSectors = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    return sectors.filter(s => {
      const pm = mapFilter === 'all' || (mapFilter === 'featured' && s.shouldHighlight) || (mapFilter === 'anomaly' && s.isAnomaly) || (mapFilter === 'followed' && followedSectorIds.includes(s.sectorId));
      const cm = categoryScope === 'all' || s.category === categoryScope;
      const qm = !q || s.sector.toLowerCase().includes(q);
      return pm && cm && qm;
    });
  }, [sectors, filterQuery, mapFilter, categoryScope, followedSectorIds]);

  const isUp = (pct: number) => pct >= 0;

  return (
    <div className="space-y-4 px-3 pb-24 pt-3">
      <header className="flex items-center gap-2 px-1">
        <div className="grid h-8 w-8 place-items-center rounded-xl bg-indigo-600 text-white"><Compass className="h-4 w-4" /></div>
        <h2 className="text-xl font-bold">A股市场地图</h2>
        <span className="ml-auto rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-semibold text-indigo-700">β</span>
      </header>

      {/* 市场概览卡片 */}
      {marketSummary ? <div className="bg-gradient-to-r from-indigo-50 to-blue-50 rounded-2xl p-4 border border-indigo-100">
        <div className="flex items-center gap-2 mb-2"><Sparkles className="w-4 h-4 text-indigo-600"/><span className="text-xs font-bold text-indigo-700">泡泡发现</span></div>
        <div className="flex items-center justify-between">
          <div className="flex gap-4 text-[11px]">
            {(marketSummary.indices||[]).map(function(idx,i){return <div key={i}><span className="text-slate-500">{idx.name}</span><span className={'ml-1 font-bold '+(idx.changePercent>=0?'text-red-500':'text-emerald-500')}>{idx.changePercent>=0?'+':''}{idx.changePercent?.toFixed(2)}%</span></div>;})}
          </div>
          {marketSummary.temperature ? <div className="text-right"><span className="text-lg">{marketSummary.temperature>=60?'🔥':marketSummary.temperature>=40?'☀️':'🌧️'}</span><span className="text-[10px] text-slate-500 ml-1">{marketSummary.temperatureLabel||''}</span></div> : null}
        </div>
        {marketSummary.upSectors!==undefined ? <div className="flex gap-2 mt-2 text-[10px]"><span className="text-red-600 font-medium">上涨 {marketSummary.upSectors} 板块</span><span className="text-slate-300">|</span><span className="text-emerald-600 font-medium">下跌 {marketSummary.downSectors} 板块</span></div> : null}
      </div> : null}

      {dataError && <div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800"><AlertTriangle className="inline w-3 h-3 mr-1"/>{dataError}</div>}

      <div className="flex gap-2 overflow-x-auto pb-1">
        {(['all','featured','anomaly','followed'] as MapFilter[]).map(o => (
          <button key={o} onClick={() => setMapFilter(o)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ${mapFilter===o?'bg-indigo-600 text-white':'bg-slate-100 text-slate-600'}`}>
            {o==='all'?'全部':o==='featured'?'泡泡精选':o==='anomaly'?'异动':'关注'} ({filterCounts[o]})
          </button>
        ))}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/>
        <input type="search" placeholder="搜索板块" value={filterQuery} onChange={e => setFilterQuery(e.target.value)}
          className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none" />
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-2.5">{[0,1,2,3,4,5].map(i => <div key={i} className="h-28 animate-pulse rounded-2xl bg-slate-100"/>)}</div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5">
          {filteredSectors.map(s => (
            <div key={s.sectorId} className={`rounded-2xl border p-3 transition min-h-[100px] ${isUp(s.changePercent)?'border-red-100 bg-red-50/80':'border-emerald-100 bg-emerald-50/80'}`}>
              <button onClick={() => selectSector(s)} className="w-full text-left">
                <span className="text-sm font-bold">{s.sector}</span>
                <div className={`mt-1 text-xl font-bold ${isUp(s.changePercent)?'text-red-600':'text-emerald-600'}`}>{s.change}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                {s.signalTags.slice(0,2).map(t => (
                  <span key={t} className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${tagStyles[t]||'bg-slate-100'}`}>{t}</span>
                ))}
                {s.isAnomaly ? <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-700">⚡异动</span> : null}
                </div>
              </button>
              <button
                onClick={() => toggleFollowedSector(s.sectorId)}
                className={`mt-2 flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold transition ${
                  followedSectorIds.includes(s.sectorId)
                    ? 'bg-rose-100 text-rose-600'
                    : 'bg-white/70 text-slate-400 hover:text-rose-500'
                }`}
                aria-label={followedSectorIds.includes(s.sectorId) ? '取消关注' : '关注板块'}
              >
                <Heart className={`w-3 h-3 ${followedSectorIds.includes(s.sectorId) ? 'fill-rose-500 text-rose-500' : ''}`} />
                {followedSectorIds.includes(s.sectorId) ? '已关注' : '关注'}
              </button>
            </div>
          ))}
        </div>
      )}

      {!loading && !filteredSectors.length && (
        <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center">
          <Layers3 className="mx-auto h-5 w-5 text-slate-300"/>
          <p className="mt-2 text-xs text-slate-500">没有找到匹配板块。</p>
        </div>
      )}

      {/* 板块详情弹窗 */}
      <AnimatePresence>
        {detailTarget && (
          <SectorDetailPanel
            sectorId={detailTarget.sectorId}
            sectorName={detailTarget.sectorName}
            onClose={() => setDetailTarget(null)}
            onAskTeacher={(name, question) => onAskTeacherAboutSector(name, question)}
            initialSector={activeSector}
            isFollowed={followedSectorIds.includes(detailTarget.sectorId)}
            onToggleFollowed={toggleFollowedSector}
          />
        )}
      </AnimatePresence>
    </div>
  );
}