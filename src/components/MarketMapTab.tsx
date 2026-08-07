/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { SectorIntelligence, BubbleSignalItem, BubbleSelectionResponse } from '../types';
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

const signalTypeLabels: Record<BubbleSignalItem['signalType'], { text: string; className: string }> = {
  trend_start: { text: '趋势启动', className: 'bg-violet-100 text-violet-700' },
  trend_continue: { text: '趋势延续', className: 'bg-indigo-100 text-indigo-700' },
  leader_driven: { text: '龙头带动', className: 'bg-amber-100 text-amber-800' },
  event_driven: { text: '事件驱动', className: 'bg-sky-100 text-sky-700' },
  price_only: { text: '价格异动待确认', className: 'bg-slate-100 text-slate-600' },
};

const healthStatusLabels: Record<BubbleSignalItem['healthStatus'], { text: string; className: string }> = {
  broad_rise: { text: '普涨扩散', className: 'bg-red-50 text-red-600' },
  leader_driven: { text: '龙头带动', className: 'bg-amber-50 text-amber-700' },
  divergence: { text: '内部分化', className: 'bg-slate-100 text-slate-600' },
};

const confidenceLabels: Record<BubbleSignalItem['confidence'], string> = {
  high: '证据充分',
  medium: '证据中等',
  limited: '证据有限',
};

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
  const [bubbleItems, setBubbleItems] = useState<BubbleSignalItem[] | null>(null);
  const [bubbleLoading, setBubbleLoading] = useState(false);
  const [bubbleError, setBubbleError] = useState<string | null>(null);
  const [bubbleFallback, setBubbleFallback] = useState(false);

  // 已发起过请求的标记。不放进 state，否则它变化会触发 effect 重跑并中断在途请求。
  const bubbleRequestedRef = useRef(false);
  const bubbleMountedRef = useRef(true);
  useEffect(() => () => { bubbleMountedRef.current = false; }, []);

  const loadBubbleSelection = useCallback(async () => {
    bubbleRequestedRef.current = true;
    setBubbleLoading(true);
    setBubbleError(null);
    try {
      const r = await fetch('/api/bubble-selection');
      const d = await r.json() as BubbleSelectionResponse & { error?: string };
      if (!r.ok) throw new Error(d?.error || '生成失败');
      if (!bubbleMountedRef.current) return;
      setBubbleItems(d.bubbleSelection || []);
      setBubbleFallback(Boolean(d.fallback));
    } catch (err: any) {
      if (!bubbleMountedRef.current) return;
      bubbleRequestedRef.current = false; // 失败后允许重试
      setBubbleError(err?.message || '泡泡精选暂时无法生成，请稍后重试。');
    } finally {
      if (bubbleMountedRef.current) setBubbleLoading(false);
    }
  }, []);

  // 泡泡精选走 P5，单次生成要拉板块内部数据并调用 AI，耗时较长。
  // 因此只在用户首次切到该 tab 时请求，不在挂载时预加载。服务端已有缓存，重复进入不会重复生成。
  useEffect(() => {
    if (mapFilter === 'featured' && !bubbleRequestedRef.current) loadBubbleSelection();
  }, [mapFilter, loadBubbleSelection]);

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

  // featured 的数量来自 P5 实际返回结果，未加载时不显示数字，避免和规则打分的旧口径混淆
  const filterCounts = useMemo(() => ({
    all: sectors.length,
    featured: bubbleItems?.length ?? null,
    anomaly: Math.min(10, sectors.filter(s => s.isAnomaly).length),
    followed: followedSectorIds.length,
  }), [sectors, followedSectorIds, bubbleItems]);

  const filteredSectors = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    return sectors.filter(s => {
      const pm = mapFilter === 'all' || (mapFilter === 'featured' && s.shouldHighlight) || (mapFilter === 'anomaly' && s.isAnomaly) || (mapFilter === 'followed' && followedSectorIds.includes(s.sectorId));
      const cm = categoryScope === 'all' || s.category === categoryScope;
      const qm = !q || s.sector.toLowerCase().includes(q);
      return pm && cm && qm;
    });
  }, [sectors, filterQuery, mapFilter, categoryScope, followedSectorIds]);

  // P5 只返回 sectorName，详情面板需要 sectorId，这里回查市场地图已加载的板块列表
  const openBubbleDetail = (sectorName: string) => {
    const matched = sectors.find(s => s.sector === sectorName);
    if (matched) {
      setActiveSector(matched);
      onSelectSectorId(matched.sectorId);
    }
    setDetailTarget({ sectorId: matched?.sectorId || '', sectorName });
  };

  const filteredBubbleItems = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!bubbleItems) return [];
    return q ? bubbleItems.filter(i => i.sectorName.toLowerCase().includes(q)) : bubbleItems;
  }, [bubbleItems, filterQuery]);

  const isUp = (pct: number) => pct >= 0;
  // P5 的 todayChange 是格式化字符串（如 "+5.20%"），按符号判断涨跌
  const bubbleIsUp = (change: string) => !change.trim().startsWith('-');

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
            {o==='all'?'全部':o==='featured'?'泡泡精选':o==='anomaly'?'异动':'关注'}
            {filterCounts[o] === null ? '' : ` (${filterCounts[o]})`}
          </button>
        ))}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/>
        <input type="search" placeholder="搜索板块" value={filterQuery} onChange={e => setFilterQuery(e.target.value)}
          className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none" />
      </div>

      {mapFilter === 'featured' ? (
        <div className="space-y-3">
          {bubbleLoading && (
            <div className="space-y-3">
              <div className="rounded-xl bg-indigo-50 p-3 text-xs text-indigo-700">
                <Activity className="inline h-3 w-3 mr-1"/>泡泡正在分析今天的板块变化，首次生成约需两分钟，稍后进入会直接读缓存。
              </div>
              {[0,1,2].map(i => <div key={i} className="h-44 animate-pulse rounded-2xl bg-slate-100"/>)}
            </div>
          )}

          {!bubbleLoading && bubbleError && (
            <div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
              <AlertTriangle className="inline h-3 w-3 mr-1"/>{bubbleError}
              <button onClick={loadBubbleSelection} className="ml-2 font-semibold underline">重试</button>
            </div>
          )}

          {!bubbleLoading && !bubbleError && bubbleFallback && (
            <div className="rounded-xl bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-600">
              当前排序由规则引擎计算，尚未经过 AI 解释，仅供参考。
            </div>
          )}

          {!bubbleLoading && !bubbleError && filteredBubbleItems.map(item => (
            <div key={item.sectorName} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-2">
                <button onClick={() => openBubbleDetail(item.sectorName)} className="text-left">
                  <span className="text-sm font-bold">{item.sectorName}</span>
                  <span className={`ml-2 text-lg font-bold ${bubbleIsUp(item.todayChange)?'text-red-600':'text-emerald-600'}`}>
                    {item.todayChange}
                  </span>
                </button>
                <div className="shrink-0 text-right">
                  <div className="text-base font-bold text-indigo-600">{item.bubbleScore}</div>
                  <div className="text-[10px] text-slate-400">关注度</div>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap gap-1">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${signalTypeLabels[item.signalType].className}`}>
                  {signalTypeLabels[item.signalType].text}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${healthStatusLabels[item.healthStatus].className}`}>
                  {healthStatusLabels[item.healthStatus].text}
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                  {confidenceLabels[item.confidence]}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-2 text-center">
                {([
                  { label: '涨跌幅', value: item.metrics.priceChange },
                  { label: '上涨占比', value: item.metrics.upStockRatio },
                  { label: '成交变化', value: item.metrics.volumeChange },
                ]).map(m => (
                  <div key={m.label}>
                    <div className="text-[10px] text-slate-400">{m.label}</div>
                    <div className={`text-xs font-semibold ${m.value==='暂无数据'?'text-slate-400':'text-slate-700'}`}>{m.value}</div>
                  </div>
                ))}
              </div>

              {item.bubbleExplanation && (
                <p className="mt-3 text-xs leading-relaxed text-slate-700">{item.bubbleExplanation}</p>
              )}
              {item.rankReason && (
                <p className="mt-1.5 text-[11px] text-slate-500">入选理由：{item.rankReason}</p>
              )}

              {item.supportingSignals.length > 0 && (
                <ul className="mt-2.5 space-y-1">
                  {item.supportingSignals.map((s, i) => (
                    <li key={i} className="flex gap-1.5 text-[11px] text-slate-600">
                      <ArrowUpRight className="mt-0.5 h-3 w-3 shrink-0 text-red-500"/>
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              )}

              {item.riskSignals.length > 0 && (
                <ul className="mt-2 space-y-1 rounded-xl bg-amber-50 p-2">
                  {item.riskSignals.map((s, i) => (
                    <li key={i} className="flex gap-1.5 text-[11px] text-amber-800">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0"/>
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              )}

              {item.mergedSectors.length > 0 && (
                <p className="mt-2 text-[10px] text-slate-400">
                  已合并同主题板块：{item.mergedSectors.join('、')}
                </p>
              )}

              {item.evidence.length > 0 && (
                <div className="mt-2.5 space-y-1 border-t border-slate-100 pt-2">
                  {item.evidence.map(e => (
                    <div key={e.id} className="text-[10px] leading-relaxed text-slate-500">
                      <span className="font-semibold text-slate-600">{e.sourceName}</span>
                      <span className="ml-1">{e.title}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => openBubbleDetail(item.sectorName)}
                  className="rounded-full bg-indigo-600 px-3 py-1.5 text-[11px] font-semibold text-white"
                >
                  查看板块详情
                </button>
                <button
                  onClick={() => onAskTeacherAboutSector(item.sectorName, `${item.sectorName}今天为什么会有这样的变化？`)}
                  className="flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 text-[11px] font-semibold text-slate-600"
                >
                  <MessageCircle className="h-3 w-3"/>问泡泡老师
                </button>
              </div>
            </div>
          ))}

          {!bubbleLoading && !bubbleError && !filteredBubbleItems.length && (
            <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center">
              <Layers3 className="mx-auto h-5 w-5 text-slate-300"/>
              <p className="mt-2 text-xs text-slate-500">
                {filterQuery.trim() ? '没有找到匹配板块。' : '今天暂时没有筛选出值得关注的板块变化。'}
              </p>
            </div>
          )}
        </div>
      ) : loading ? (
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