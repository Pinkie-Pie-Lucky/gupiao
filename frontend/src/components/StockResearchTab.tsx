import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  ChevronDown,
  Database,
  Landmark,
  MessageCircle,
  Network,
  RefreshCw,
  Scale,
  ShieldAlert,
} from 'lucide-react';
import { createResearchViewModel, normalizeResearchSymbol, researchItemText, type ResearchSectionKey } from '../lib/stockResearch';
import { StockResearchOverview } from './StockResearchOverview';
import { StockResearchPicker } from './StockResearchPicker';
import { StockResearchModules } from './StockResearchModules';
import type { StockItem } from '../types';

interface StockResearchTabProps {
  stock: StockItem;
  followedStocks: StockItem[];
  onSelectStock: (stock: StockItem) => void;
  onFollowStock: (stock: StockItem) => void;
  onBack: () => void;
  onAskTeacher: () => void;
}

type SectionKey = Exclude<ResearchSectionKey, 'evidence'>;
type IconType = typeof Landmark;

const sectionMeta: Record<SectionKey, { title: string; subtitle: string; icon: IconType }> = {
  fundamental: { title: '基本面', subtitle: '盈利质量、财务信号和否决项', icon: Landmark },
  technical: { title: '技术与市场', subtitle: '趋势、结构和市场环境', icon: Activity },
  events: { title: '事件', subtitle: '公告、事件事实和影响方向', icon: MessageCircle },
  industry: { title: '行业与产业链', subtitle: '同业位置、上下游和行业/政策事件', icon: Network },
  sentiment: { title: '舆情', subtitle: '讨论热度、情绪和传播质量', icon: MessageCircle },
  valuation: { title: '估值', subtitle: '估值状态与可比数据', icon: Scale },
  risk: { title: '风险与反方', subtitle: '否决项、风险项和观察条件', icon: ShieldAlert },
};

const visibleSectionKeys: SectionKey[] = [
  'fundamental',
  'technical',
  'events',
  'industry',
  // 舆情 Agent 的数据源与解释层尚待完善；保留模块与后端链路，恢复展示时取消下一行注释即可。
  // 'sentiment',
  'valuation',
  'risk',
];

// 保留返回逻辑，恢复时改为 true；当前个股分析页不展示左上角返回按钮。
const SHOW_RESEARCH_BACK_BUTTON = false;

function FactList({ items, tone = 'slate', emptyText = '暂无可用数据' }: { items: any[]; tone?: 'slate' | 'emerald' | 'rose' | 'amber'; emptyText?: string }) {
  const colors = { slate: 'border-slate-100 bg-white', emerald: 'border-emerald-100 bg-emerald-50/60', rose: 'border-rose-100 bg-rose-50/60', amber: 'border-amber-100 bg-amber-50/60' };
  if (!items.length) return <p className="rounded-lg bg-slate-100 p-3 text-[11px] leading-relaxed text-slate-600">{emptyText}</p>;
  return <div className="space-y-2">{items.slice(0, 6).map((item, index) => <div className={`rounded-lg border p-3 ${colors[tone]}`} key={`${researchItemText(item)}-${index}`}><p className="text-[11px] font-medium leading-relaxed text-slate-800">{researchItemText(item)}</p></div>)}</div>;
}

export function StockResearchTab({ stock, followedStocks, onSelectStock, onFollowStock, onBack, onAskTeacher }: StockResearchTabProps) {
  const [payload, setPayload] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [marketQuote, setMarketQuote] = useState<any>(null);
  const requestSequence = useRef(0);
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({ fundamental: true, technical: false, events: false, industry: false, sentiment: false, valuation: false, risk: true });

  const load = useCallback(async (refresh = false) => {
    const requestId = ++requestSequence.current;
    if (refresh) {
      setRefreshing(true);
      setRefreshError(null);
    } else {
      setLoading(true);
      setError(null);
      setPayload(null);
      setMarketQuote(null);
    }
    try {
      const symbol = normalizeResearchSymbol(stock.code);
      const suffix = refresh ? '&refresh=1' : '';
      // 报价、CIO、行业 Agent 相互独立，并发请求；报价失败不能阻塞研究结论。
      const [response, industryResponse, quoteResponse] = await Promise.all([
        fetch(`/api/stock-agents/cio-manager?symbol=${encodeURIComponent(symbol)}${suffix}`),
        fetch(`/api/stock-agents/industry-chain?symbol=${encodeURIComponent(symbol)}${suffix}`),
        fetch(`/api/stock-quote?symbol=${encodeURIComponent(symbol)}`).catch(() => null),
      ]);
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.detail || result?.error || '研究快照暂不可用');
      const industryResult = industryResponse.ok ? await industryResponse.json().catch(() => null) : null;
      const quoteResult = quoteResponse?.ok ? await quoteResponse.json().catch(() => null) : null;
      if (industryResult?.industrySnapshot) {
        result.managerSnapshot = result.managerSnapshot || {};
        result.managerSnapshot.agentOutputs = result.managerSnapshot.agentOutputs || {};
        result.managerSnapshot.agentOutputs.industry = {
          ...(result.managerSnapshot.agentOutputs.industry || {}),
          ...industryResult.deterministicIndustry,
          sourceMeta: industryResult.industrySnapshot.snapshotMeta || null,
          industryAgentMeta: industryResult.agentMeta || null,
        };
        const industryOpinion = industryResult.opinion || {};
        result.opinion = result.opinion || {};
        result.opinion.moduleExplanations = {
          ...(result.opinion.moduleExplanations || {}),
          industry: {
            conclusion: industryOpinion.conclusion || '',
            why: [industryOpinion.industryPosition, industryOpinion.chainAssessment].filter(Boolean).map((text: string) => ({ text, evidenceIds: industryOpinion.evidenceIds || [] })),
            supporting: industryOpinion.positives || [],
            counter: industryOpinion.negatives || [],
          },
        };
        result.managerSnapshot.dataGaps = [...new Set([...(result.managerSnapshot.dataGaps || []), ...(industryOpinion.dataGaps || industryResult.industrySnapshot.dataGaps || [])])];
      }
      if (requestId === requestSequence.current) {
        setPayload(result);
        if (quoteResult?.quote) setMarketQuote(quoteResult);
      }
    } catch (loadError: any) {
      if (requestId !== requestSequence.current) return;
      const message = loadError?.message || '研究快照暂不可用';
      if (refresh) setRefreshError(message); else setError(message);
    } finally {
      if (requestId === requestSequence.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [stock.code]);

  useEffect(() => {
    void load();
    return () => { requestSequence.current += 1; };
  }, [load]);

  const { manager, opinion, snapshot, outputs, evidence, supporting, counter, required, dataGaps } = createResearchViewModel(payload);
  const stance = manager.managerStance || snapshot.managerStance || opinion.managerStance;
  // “limited” means some upstream facts are missing, not that the AI/API call failed.
  // Keep the usable conclusion visible and surface those missing facts in the unified data-gaps section.
  const aiFailed = Boolean(payload?.agentMeta?.aiStatus === 'fallback');
  const evidenceSet = useMemo(() => new Set(snapshot.evidenceIds || []), [snapshot.evidenceIds]);
  const isFollowed = useMemo(() => {
    const currentCode = normalizeResearchSymbol(stock.code);
    return followedStocks.some((item) => normalizeResearchSymbol(item.code) === currentCode);
  }, [followedStocks, stock.code]);
  const displayStock = useMemo(() => {
    const quote = marketQuote?.quote;
    if (!quote || !Number.isFinite(quote.price)) return stock;
    return {
      ...stock,
      name: quote.name || stock.name,
      price: Number(quote.price),
      changePercent: Number.isFinite(quote.changePercent) ? Number(quote.changePercent) : stock.changePercent,
      volume: Number.isFinite(quote.volume) ? `${(Number(quote.volume) / 1e4).toFixed(0)}万` : stock.volume,
      turnover: Number.isFinite(quote.amount) ? `${(Number(quote.amount) / 1e8).toFixed(2)}亿` : stock.turnover,
    };
  }, [marketQuote, stock]);
  const toggle = (key: SectionKey) => setOpenSections((current) => ({ ...current, [key]: !current[key] }));

  return <div className="space-y-4 px-3 pb-24 pt-2">
    <header className="grid grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2"><div>{SHOW_RESEARCH_BACK_BUTTON && <button onClick={onBack} aria-label="返回自选列表" className="grid h-11 w-11 place-items-center rounded-xl bg-white text-slate-600 shadow-sm hover:text-indigo-600"><ArrowLeft className="h-4 w-4" /></button>}</div><div className="min-w-0 text-center"><p className="text-sm font-bold text-slate-900">个股分析</p><div className="mt-0.5 flex items-center justify-center gap-2"><p className="truncate font-mono text-[10px] text-slate-500">{displayStock.name} · {normalizeResearchSymbol(displayStock.code)}</p><button onClick={() => onFollowStock(displayStock)} disabled={isFollowed} className="min-h-7 shrink-0 rounded-md border border-indigo-200 bg-indigo-50 px-2 text-[10px] font-bold text-indigo-700 disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-500">{isFollowed ? '已在自选' : '加入自选'}</button></div></div><button onClick={() => void load(true)} disabled={refreshing} aria-label="刷新研究快照（重新请求数据源）" className="grid h-11 w-11 place-items-center rounded-xl bg-white text-slate-600 shadow-sm hover:text-indigo-600 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /></button></header>
    <StockResearchPicker selectedStock={displayStock} followedStocks={followedStocks} onSelectStock={onSelectStock} />
    <StockResearchOverview stock={displayStock} stance={stance} researchStatus={manager.researchStatus} riskLevel={manager.riskLevel} conclusion={opinion.conclusion} evidenceCount={evidenceSet.size} loading={loading} error={error} aiFailed={aiFailed} />
    {error && <section role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4"><div className="flex items-start gap-3"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-700" /><div className="min-w-0 flex-1"><h2 className="text-xs font-bold text-rose-900">研究数据加载失败</h2><p className="mt-1 break-words text-[11px] leading-relaxed text-rose-800">{error}</p></div></div><button onClick={() => void load()} className="mt-3 min-h-11 w-full rounded-lg bg-rose-700 px-4 text-xs font-bold text-white hover:bg-rose-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700">重新加载</button></section>}
    {refreshError && !error && <section role="status" className="flex items-start justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3"><div className="min-w-0"><p className="text-[11px] font-bold text-amber-900">刷新失败，当前仍显示上一次结果</p><p className="mt-1 break-words text-[10px] text-amber-800">{refreshError}</p></div><button onClick={() => void load(true)} className="min-h-10 shrink-0 rounded-lg px-3 text-[11px] font-bold text-amber-900 hover:bg-amber-100">重试</button></section>}
    {loading && <section aria-label="正在加载研究模块" aria-busy="true" className="rounded-xl border border-slate-200 bg-white p-4"><span className="sr-only">正在加载研究模块</span><div className="h-3 w-24 animate-pulse rounded bg-slate-200" /><div className="mt-4 space-y-3">{[72, 92, 64].map((width) => <div className="h-11 animate-pulse rounded-lg bg-slate-100" key={width} style={{ width: `${width}%` }} />)}</div></section>}
    {!loading && !error && <><section className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-bold text-slate-900">支持与反方</h2><span className="text-[10px] text-slate-500">不构成交易建议</span></div><FactList items={supporting.slice(0, 2)} tone="emerald" emptyText="暂无有证据支持的正向观点" /><FactList items={counter.slice(0, 2)} tone="rose" emptyText="暂无有证据支持的反方观点" /></section><section className="overflow-hidden rounded-xl border border-slate-200 bg-white">{visibleSectionKeys.map((key) => { const meta = sectionMeta[key]; const Icon = meta.icon; const isOpen = openSections[key]; return <div key={key} className="border-b border-slate-100 last:border-0"><button onClick={() => toggle(key)} className="flex min-h-14 w-full items-center gap-3 px-3 text-left hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-indigo-600 sm:px-4" aria-expanded={isOpen}><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-700"><Icon className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block text-xs font-bold text-slate-900">{meta.title}</span><span className="mt-0.5 block text-[10px] leading-snug text-slate-600">{meta.subtitle}</span></span><ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} /></button>{isOpen && <div className="bg-slate-50/60 px-3 pb-4 pt-1 sm:px-4"><StockResearchModules sectionKey={key} outputs={outputs} counterCase={counter} evidence={evidence} dataGaps={dataGaps} agentMeta={{ ...payload?.agentMeta, moduleExplanations: opinion?.moduleExplanations }} /></div>}</div>; })}</section><section className="rounded-xl border border-amber-200 bg-amber-50/60 p-3"><div className="flex items-center gap-2 text-xs font-bold text-amber-900"><Scale className="h-4 w-4" />下一步核验</div><div className="mt-3"><FactList items={required.slice(0, 3)} tone="amber" emptyText="暂无新增核验条件" /></div></section>{dataGaps.length > 0 && <section className="rounded-xl border border-slate-200 bg-slate-100/70 p-3"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2 text-xs font-bold text-slate-800"><Database className="h-4 w-4" />数据缺口</div><span className="text-[10px] text-slate-500">{dataGaps.length} 项</span></div><ul className="mt-2 space-y-1.5">{dataGaps.map((gap: string) => <li className="flex gap-2 text-[11px] leading-relaxed text-slate-700" key={gap}><span aria-hidden="true">•</span><span className="min-w-0 break-words">{gap}</span></li>)}</ul></section>}<button onClick={onAskTeacher} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-xs font-bold text-white hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"><MessageCircle className="h-4 w-4" />带着这份研究去问 AI 泡泡</button></>}
  </div>;
}
