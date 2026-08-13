/**
 * Sector detail deliberately separates observed market facts from contextual clues
 * and analysis. A partial constituent scan must never produce a structure verdict.
 */
import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Activity, BarChart3, ChevronDown, ChevronUp, Heart, Newspaper, RefreshCw, Shield, TrendingUp } from 'lucide-react';
import { SectorIntelligence } from '../types';

interface SectorDetailPanelProps {
  sectorId: string;
  sectorName: string;
  onClose: () => void;
  onAskTeacher?: (name: string, question: string) => void;
  initialSector?: SectorIntelligence | null;
  isFollowed?: boolean;
  onToggleFollowed?: (sectorId: string) => void;
}

const formatPercent = (value: number | null | undefined) => value == null ? '--' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
const valueColor = (value: number | null | undefined) => (value || 0) >= 0 ? 'text-red-500' : 'text-emerald-500';

export function SectorDetailPanel({ sectorId, sectorName, onClose, onAskTeacher, isFollowed, onToggleFollowed }: SectorDetailPanelProps) {
  const [data, setData] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [sections, setSections] = useState(new Set(['structure']));
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const toggle = (key: string) => setSections((previous) => {
    const next = new Set(previous); next.has(key) ? next.delete(key) : next.add(key); return next;
  });

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null); setData(null);
    fetch(`/api/sector-detail?sectorId=${encodeURIComponent(sectorId)}&sectorName=${encodeURIComponent(sectorName)}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || '详情数据暂时无法获取');
        return body;
      })
      .then(setData)
      .catch((reason) => { if (reason.name !== 'AbortError') setError(reason.message || '详情数据暂时无法获取'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [sectorId, sectorName, reloadKey]);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const viewport = document.getElementById('app-viewport');
    const bodyOverflow = document.body.style.overflow; const viewportOverflow = viewport?.style.overflow || '';
    document.body.style.overflow = 'hidden'; if (viewport) viewport.style.overflow = 'hidden';
    requestAnimationFrame(() => closeButtonRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onCloseRef.current(); } };
    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('keydown', onKeyDown); document.body.style.overflow = bodyOverflow; if (viewport) viewport.style.overflow = viewportOverflow; previousFocusRef.current?.focus(); };
  }, []);

  const Card = ({ id, label, icon, children }: { id: string; label: string; icon: React.ReactNode; children: React.ReactNode }) => <section className="space-y-2">
    <button onClick={() => toggle(id)} className="flex w-full items-center justify-between" aria-expanded={sections.has(id)}>
      <span className="flex items-center gap-2 text-sm font-bold text-slate-950"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100">{icon}</span>{label}</span>
      {sections.has(id) ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
    </button>
    {sections.has(id) && <div className="space-y-3 rounded-2xl border border-slate-100 bg-slate-50 p-4">{children}</div>}
  </section>;

  const shell = (content: React.ReactNode) => <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-stretch md:justify-end" onClick={onClose}>
    <motion.div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="sector-detail-title" initial={{ y: 48, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: .2 }} onClick={(event) => event.stopPropagation()} className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white shadow-2xl md:h-full md:max-h-none md:w-[min(480px,38vw)] md:max-w-none md:rounded-none md:rounded-l-2xl">
      {content}
    </motion.div>
  </div>;
  if (loading) return shell(<div className="animate-pulse p-5"><div className="h-6 w-1/3 rounded bg-slate-100" /></div>);
  if (error || !data) return shell(<div className="space-y-4 p-5"><button ref={closeButtonRef} onClick={onClose} className="float-right min-h-11 min-w-11 rounded-full bg-slate-50" aria-label="关闭板块详情"><ChevronDown className="mx-auto h-5 w-5" /></button><div className="clear-both pt-8 text-center"><p className="font-bold text-slate-800">板块详情暂时无法加载</p><p className="mt-2 text-xs text-slate-500">{error || '未返回有效数据'}</p><button onClick={() => setReloadKey((value) => value + 1)} className="mt-4 inline-flex items-center gap-1 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white"><RefreshCw className="h-3.5 w-3.5" />重新获取</button></div></div>);

  const stats = data.constituentStats || {};
  const structureText: Record<string, string> = { broad_rise: '多数成分股上涨，表现偏普涨', broad_fall: '多数成分股回落', concentrated: '涨跌分化，上涨集中于少数成分股', divergence: '涨跌分化', unavailable: '结构暂不可判断' };
  const evidence = data.evidenceSummary || {};
  const evidenceLabel = evidence.status === 'direct_evidence' ? '有直接证据' : evidence.status === 'related_clues' ? '关联线索' : '仅行情事实';
  const isUp = (data.todayChangePercent || 0) >= 0;
  const representativeStatus = data.representativeStocks?.status;

  return shell(<div className="space-y-5 px-5 pb-8 pt-5">
    <div className="flex justify-end"><button ref={closeButtonRef} onClick={onClose} aria-label="关闭板块详情" className="flex min-h-11 min-w-11 items-center justify-center rounded-full bg-slate-50"><ChevronDown className="h-5 w-5 text-slate-500" /></button></div>
    <header className="space-y-3"><div className="flex items-start justify-between"><div><h2 id="sector-detail-title" className="text-xl font-bold text-slate-950">{data.sector || sectorName}</h2><p className={`font-mono text-3xl font-bold ${isUp ? 'text-red-600' : 'text-emerald-600'}`}>{data.todayChange || '--'}</p></div><button onClick={() => onToggleFollowed?.(sectorId)} aria-label={isFollowed ? '取消关注' : '关注板块'} className="flex h-11 w-11 items-center justify-center rounded-full bg-rose-50 text-rose-500"><Heart className={isFollowed ? 'h-4 w-4 fill-rose-500' : 'h-4 w-4'} /></button></div><div className="flex gap-3 rounded-2xl bg-slate-50 p-3 text-[11px]"><span>5日 <b className={valueColor(data.change5d)}>{formatPercent(data.change5d)}</b></span><span>20日 <b className={valueColor(data.change20d)}>{formatPercent(data.change20d)}</b></span><span>3个月 <b className={valueColor(data.change3m)}>{formatPercent(data.change3m)}</b></span></div></header>
    <section className="space-y-2 rounded-2xl bg-indigo-50 p-4"><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-bold text-indigo-950">今日市场动态</h3><span className="rounded-full bg-white px-2 py-1 text-[9px] font-bold text-indigo-800">{evidenceLabel}</span></div><p className="text-xs leading-5 text-indigo-950">{data.insight?.whatHappened || data.bubbleConclusion}</p><p className="text-[9px] text-indigo-700">行情更新：{stats.dataAsOf ? new Date(stats.dataAsOf).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '待更新'} · 数据源：{stats.sourceName || '待确认'}</p></section>
    <Card id="structure" label="发生与结构" icon={<Shield className="h-3.5 w-3.5 text-indigo-700" />}>
      <p className="text-xs font-bold text-slate-800">{structureText[data.health?.presentation] || '结构暂不可判断'}</p>
      <div className="grid grid-cols-3 gap-2 text-center text-[10px]"><div className="rounded-xl bg-white p-2"><b className="text-base text-red-500">{stats.upCount ?? '--'}</b><p>上涨</p></div><div className="rounded-xl bg-white p-2"><b className="text-base text-emerald-500">{stats.downCount ?? '--'}</b><p>下跌</p></div><div className="rounded-xl bg-white p-2"><b className="text-base text-slate-700">{stats.flatCount ?? '--'}</b><p>平盘</p></div></div>
      <p className="text-[10px] text-slate-500">成分股 {stats.loadedCount ?? 0}/{stats.totalCount ?? 0} · 覆盖 {stats.coverage ?? '--'}% · 中位涨幅 {formatPercent(stats.medianChange)} · 涨停 {stats.limitUpCount ?? '--'} 只</p>
      {stats.status !== 'available' && <p className="text-[10px] leading-4 text-amber-800">成分股取数不完整，未输出普涨、分化或龙头驱动结论。{stats.dataError ? ' 可稍后重试。' : ''}</p>}
    </Card>
    <Card id="internal" label="领涨成分股" icon={<BarChart3 className="h-3.5 w-3.5 text-amber-600" />}>
      {(data.topGainers || []).length ? <><p className="text-[10px] text-slate-500">仅展示当日涨幅最高的 3 只真实成分股，不代表子行业。</p>{data.topGainers.map((stock: any, index: number) => <div key={stock.code || index} className="flex justify-between border-b border-slate-200 py-2 text-xs last:border-0"><span className="font-medium">{stock.name}</span><b className={valueColor(stock.changePercent)}>{formatPercent(stock.changePercent)}</b></div>)}</> : <p className="py-2 text-center text-[10px] text-slate-400">成分股数据暂不可用，无法展示领涨成分股</p>}
    </Card>
    <Card id="stocks" label="代表股票" icon={<Activity className="h-3.5 w-3.5 text-emerald-600" />}>
      {(data.representativeStocks?.strength || []).length ? <><p className="text-[10px] text-slate-500">入选规则：{data.representativeStocks.rankingRule}</p>{data.representativeStocks.strength.map((stock: any, index: number) => <div key={stock.code || index} className="flex items-center justify-between rounded-xl bg-white p-3"><div><p className="text-xs font-bold">{stock.name}</p><p className="mt-0.5 text-[9px] text-slate-400">综合强度排名 #{index + 1}</p></div><b className={valueColor(stock.changePercent)}>{formatPercent(stock.changePercent)}</b></div>)}</> : <p className="py-2 text-center text-[10px] text-slate-400">{representativeStatus === 'empty' ? '该板块没有有效成分股' : representativeStatus === 'partial' ? '成分股数据不完整，暂不生成代表股票' : '数据源暂不可用，可稍后重试'}</p>}
    </Card>
    <Card id="evidence" label="证据与反证" icon={<Newspaper className="h-3.5 w-3.5 text-violet-700" />}>
      <EvidenceGroup title="行情事实" items={evidence.marketFacts} empty="暂无完整行情事实" />
      <EvidenceGroup title="关联线索" items={(evidence.relatedClues || []).map((item: any) => `${item.title}（${item.sourceName}）`)} empty="暂无可引用的直接事件或政策线索" />
      <EvidenceGroup title="分析推断" items={evidence.analysisInference} empty="暂无额外分析推断" />
      <EvidenceGroup title="反证与缺口" items={evidence.counterAndGaps} empty="暂无补充反证；仍需留意成交与资金等缺失维度。" />
    </Card>
    <button onClick={() => onAskTeacher?.(sectorName, `为什么${sectorName}今天表现突出？`)} className="w-full rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-3 text-xs font-bold text-indigo-700">问泡泡：为什么今天这样走？</button>
  </div>);
}

function EvidenceGroup({ title, items, empty }: { title: string; items?: string[]; empty: string }) {
  return <div><p className="mb-1 text-[10px] font-bold text-slate-800">{title}</p>{items?.length ? <ul className="space-y-1 text-[10px] leading-4 text-slate-600">{items.map((item, index) => <li key={index}>· {item}</li>)}</ul> : <p className="text-[10px] leading-4 text-slate-400">{empty}</p>}</div>;
}
