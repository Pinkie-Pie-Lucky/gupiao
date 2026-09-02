import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Database, MessageCircle, RefreshCw, Scale, ShieldAlert } from 'lucide-react';
import { createResearchViewModel, normalizeResearchSymbol, researchItemText } from '../lib/stockResearch';
import { StockResearchOverview } from './StockResearchOverview';
import { StockResearchPicker } from './StockResearchPicker';
import { StockResearchWorkspace, type ResearchWorkspaceView } from './StockResearchWorkspace';
import type { StockItem } from '../types';

interface StockResearchTabProps {
  stock: StockItem;
  followedStocks: StockItem[];
  onSelectStock: (stock: StockItem) => void;
  onFollowStock: (stock: StockItem) => void;
  onBack: () => void;
  onAskTeacher: () => void;
}

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
  const [activeView, setActiveView] = useState<ResearchWorkspaceView>('overview');
  const requestSequence = useRef(0);

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
      const mergeIndustryResult = (base: any, industryResult: any) => {
        if (!industryResult?.industrySnapshot) return base;
        const result = { ...base, managerSnapshot: { ...(base?.managerSnapshot || {}) }, opinion: { ...(base?.opinion || {}) } };
        result.managerSnapshot.agentOutputs = result.managerSnapshot.agentOutputs || {};
        result.managerSnapshot.agentOutputs.industry = {
          ...(result.managerSnapshot.agentOutputs.industry || {}),
          ...industryResult.deterministicIndustry,
          sourceMeta: industryResult.industrySnapshot.snapshotMeta || null,
          industryAgentMeta: industryResult.agentMeta || null,
        };
        const industryOpinion = industryResult.opinion || {};
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
        return result;
      };
      const mergeSentimentResult = (base: any, sentimentResult: any) => {
        if (!sentimentResult?.opinion && !sentimentResult?.sentimentSnapshot) return base;
        const result = { ...base, managerSnapshot: { ...(base?.managerSnapshot || {}) }, opinion: { ...(base?.opinion || {}) } };
        result.managerSnapshot.agentOutputs = result.managerSnapshot.agentOutputs || {};
        const snapshot = sentimentResult.sentimentSnapshot || {};
        const sentimentOpinion = sentimentResult.opinion || {};
        const aiInterpretation = sentimentResult.aiInterpretation || {};
        result.managerSnapshot.agentOutputs.sentiment = {
          ...(result.managerSnapshot.agentOutputs.sentiment || {}),
          ...sentimentResult.deterministicSentiment,
          items: snapshot.items || [],
          contentClusters: snapshot.clusters || snapshot.contentClusters || [],
          eventReactions: snapshot.eventReactions || [],
          hotTopics: snapshot.hotTopics || [],
          marketContextHotTopics: snapshot.marketContextHotTopics || [],
          metrics: snapshot.metrics || {},
          viewpoints: aiInterpretation.viewpoints || sentimentOpinion.viewpoints || [],
          aiInterpretation,
          sourceMeta: snapshot.snapshotMeta || null,
          sentimentAgentMeta: sentimentResult.agentMeta || null,
        };
        result.opinion.moduleExplanations = {
          ...(result.opinion.moduleExplanations || {}),
          sentiment: {
            conclusion: aiInterpretation.summary || sentimentOpinion.conclusion || '',
            why: [aiInterpretation.notice || sentimentOpinion.eventSummary].filter(Boolean).map((text: string) => ({ text, evidenceIds: sentimentOpinion.evidenceIds || [] })),
            supporting: aiInterpretation.catalysts || sentimentOpinion.positives || sentimentOpinion.catalysts || [],
            counter: aiInterpretation.risks || sentimentOpinion.negatives || sentimentOpinion.risks || [],
          },
        };
        result.managerSnapshot.dataGaps = [...new Set([...(result.managerSnapshot.dataGaps || []), ...(sentimentOpinion.dataGaps || snapshot.dataGaps || [])])];
        return result;
      };
      const deterministicPayload = (managerSnapshot: any) => ({
        symbol,
        managerSnapshot,
        deterministicManager: {
          researchStatus: managerSnapshot?.researchStatus,
          riskDecision: managerSnapshot?.riskDecision,
          riskLevel: managerSnapshot?.riskLevel,
          managerStance: managerSnapshot?.managerStance,
          conflicts: managerSnapshot?.conflicts || [],
          requiredConditions: managerSnapshot?.requiredConditions || [],
          researchPriorities: managerSnapshot?.researchPriorities || [],
        },
        opinion: {
          conclusion: managerSnapshot?.researchStatus === 'blocked'
            ? '核心研究输入暂不完整，当前先展示已获得的确定性研究结果。'
            : `当前研究状态为 ${managerSnapshot?.researchStatus || '待汇总'}；AI 解读将在后台补充，不影响下方事实数据。`,
          supportingCase: managerSnapshot?.supportingCase || [],
          counterCase: managerSnapshot?.counterCase || [],
          requiredConditions: managerSnapshot?.requiredConditions || [],
          researchPriorities: managerSnapshot?.researchPriorities || [],
          moduleExplanations: {},
        },
        agentMeta: { source: 'deterministic_snapshot', aiStatus: 'pending', generatedAt: new Date().toISOString() },
      });
      const mergeCioResult = (base: any, cioResult: any) => ({
        ...cioResult,
        managerSnapshot: {
          ...(base?.managerSnapshot || {}),
          ...(cioResult?.managerSnapshot || {}),
          agentOutputs: {
            ...(cioResult?.managerSnapshot?.agentOutputs || {}),
            // 行业、舆情独立接口可能已完成；避免 CIO 的旧快照覆盖当前页面结果。
            ...(base?.managerSnapshot?.agentOutputs || {}),
          },
          dataGaps: [...new Set([...(base?.managerSnapshot?.dataGaps || []), ...(cioResult?.managerSnapshot?.dataGaps || [])])],
        },
      });
      // 先加载不调用 AI 的管理层快照。它是页面的事实底座；CIO、行业和舆情解释随后独立补入。
      const [snapshotResponse, quoteResponse] = await Promise.all([
        fetch(`/api/stock-manager-snapshot?symbol=${encodeURIComponent(symbol)}${suffix}`),
        fetch(`/api/stock-quote?symbol=${encodeURIComponent(symbol)}`).catch(() => null),
      ]);
      const managerSnapshot = await snapshotResponse.json().catch(() => ({}));
      if (!snapshotResponse.ok) throw new Error(managerSnapshot?.detail || managerSnapshot?.error || '研究快照暂不可用');
      const result = deterministicPayload(managerSnapshot);
      const quoteResult = quoteResponse?.ok ? await quoteResponse.json().catch(() => null) : null;
      if (requestId === requestSequence.current) {
        setPayload(result);
        if (quoteResult?.quote) setMarketQuote(quoteResult);
      }
      // AI 请求依赖同一份已完成的确定性快照，因此不再阻塞首屏，也不会在刷新时重复回源。
      const industryPromise = fetch(`/api/stock-agents/industry-chain?symbol=${encodeURIComponent(symbol)}`)
        .then((response) => response.ok ? response.json().catch(() => null) : null)
        .catch(() => null);
      const sentimentPromise = fetch(`/api/stock-agents/sentiment?symbol=${encodeURIComponent(symbol)}`)
        .then((response) => response.ok ? response.json().catch(() => null) : null)
        .catch(() => null);
      const cioPromise = fetch(`/api/stock-agents/cio-manager?symbol=${encodeURIComponent(symbol)}`)
        .then((response) => response.ok ? response.json().catch(() => null) : null)
        .catch(() => null);
      void cioPromise.then((cioResult) => {
        if (requestId !== requestSequence.current || !cioResult) return;
        setPayload((current: any) => current ? mergeCioResult(current, cioResult) : current);
      });
      void industryPromise.then((industryResult) => {
        if (requestId !== requestSequence.current || !industryResult?.industrySnapshot) return;
        setPayload((current: any) => current ? mergeIndustryResult(current, industryResult) : current);
      });
      void sentimentPromise.then((sentimentResult) => {
        if (requestId !== requestSequence.current || !sentimentResult) return;
        setPayload((current: any) => current ? mergeSentimentResult(current, sentimentResult) : current);
      });
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
    setActiveView('overview');
    void load();
    return () => { requestSequence.current += 1; };
  }, [load]);

  const { manager, opinion, snapshot, outputs, evidence, supporting, counter, required, dataGaps } = createResearchViewModel(payload);
  const stance = manager.managerStance || snapshot.managerStance || opinion.managerStance;
  const aiStatus = String(payload?.agentMeta?.aiStatus || (loading ? 'pending' : 'not_requested'));
  const aiFallback = aiStatus === 'fallback' || aiStatus === 'failed';
  const aiFailureStage = aiFallback ? String(payload?.agentMeta?.ai?.failureStage || '') : '';
  const aiStatusView = aiStatus === 'completed'
    ? { text: 'AI 解读已生成', tone: 'border-emerald-200 bg-emerald-50 text-emerald-800' }
    : aiStatus === 'partial'
      ? { text: 'AI 解读部分生成', tone: 'border-amber-200 bg-amber-50 text-amber-800' }
      : aiFallback
        ? { text: 'AI 解读本次失败，事实结果仍可用', tone: 'border-rose-200 bg-rose-50 text-rose-800' }
        : aiStatus === 'pending'
          ? { text: 'AI 解读生成中，事实结果可先查看', tone: 'border-indigo-200 bg-indigo-50 text-indigo-800' }
          : { text: '当前展示程序计算的事实结果', tone: 'border-slate-200 bg-slate-50 text-slate-700' };
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

  return <div className="space-y-4 px-3 pb-24 pt-2">
    <header className="grid grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2"><div>{SHOW_RESEARCH_BACK_BUTTON && <button onClick={onBack} aria-label="返回自选列表" className="grid h-11 w-11 place-items-center rounded-xl bg-white text-slate-600 shadow-sm hover:text-indigo-600"><ArrowLeft className="h-4 w-4" /></button>}</div><div className="min-w-0 text-center"><p className="text-sm font-bold text-slate-900">个股分析</p><div className="mt-0.5 flex items-center justify-center gap-2"><p className="truncate font-mono text-[10px] text-slate-500">{displayStock.name} · {normalizeResearchSymbol(displayStock.code)}</p><button onClick={() => onFollowStock(displayStock)} disabled={isFollowed} className="min-h-7 shrink-0 rounded-md border border-indigo-200 bg-indigo-50 px-2 text-[10px] font-bold text-indigo-700 disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-500">{isFollowed ? '已在自选' : '加入自选'}</button></div></div><button onClick={() => void load(true)} disabled={refreshing} aria-label="刷新研究快照（重新请求数据源）" className="grid h-11 w-11 place-items-center rounded-xl bg-white text-slate-600 shadow-sm hover:text-indigo-600 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /></button></header>
    {!loading && <p role="status" className={`mx-auto w-fit max-w-full rounded-full border px-2.5 py-1 text-center text-[9px] font-semibold ${aiStatusView.tone}`}>{aiStatusView.text}{aiFailureStage ? ` · ${aiFailureStage}` : ''}</p>}
    <StockResearchPicker selectedStock={displayStock} followedStocks={followedStocks} onSelectStock={onSelectStock} />
    <StockResearchOverview stock={displayStock} stance={stance} researchStatus={manager.researchStatus} riskLevel={manager.riskLevel} conclusion={opinion.conclusion} evidenceCount={evidenceSet.size} loading={loading} error={error} aiFallback={aiFallback} />
    {error && <section role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4"><div className="flex items-start gap-3"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-700" /><div className="min-w-0 flex-1"><h2 className="text-xs font-bold text-rose-900">研究数据加载失败</h2><p className="mt-1 break-words text-[11px] leading-relaxed text-rose-800">{error}</p></div></div><button onClick={() => void load()} className="mt-3 min-h-11 w-full rounded-lg bg-rose-700 px-4 text-xs font-bold text-white hover:bg-rose-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700">重新加载</button></section>}
    {refreshError && !error && <section role="status" className="flex items-start justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3"><div className="min-w-0"><p className="text-[11px] font-bold text-amber-900">刷新失败，当前仍显示上一次结果</p><p className="mt-1 break-words text-[10px] text-amber-800">{refreshError}</p></div><button onClick={() => void load(true)} className="min-h-10 shrink-0 rounded-lg px-3 text-[11px] font-bold text-amber-900 hover:bg-amber-100">重试</button></section>}
    {loading && <section aria-label="正在加载研究模块" aria-busy="true" className="rounded-xl border border-slate-200 bg-white p-4"><span className="sr-only">正在加载研究模块</span><div className="h-3 w-24 animate-pulse rounded bg-slate-200" /><div className="mt-4 space-y-3">{[72, 92, 64].map((width) => <div className="h-11 animate-pulse rounded-lg bg-slate-100" key={width} style={{ width: `${width}%` }} />)}</div></section>}
    {!loading && !error && <>
      <StockResearchWorkspace activeView={activeView} onChangeView={setActiveView} onRefresh={() => void load(true)} refreshing={refreshing} outputs={outputs} supporting={supporting} counter={counter} evidence={evidence} dataGaps={dataGaps} agentMeta={payload?.agentMeta} moduleExplanations={opinion?.moduleExplanations} />
      <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-3"><div className="flex items-center gap-2 text-xs font-bold text-amber-900"><Scale className="h-4 w-4" />下一步核验</div><div className="mt-3"><FactList items={required.slice(0, 3)} tone="amber" emptyText="暂无新增核验条件" /></div></section>
      {dataGaps.length > 0 && <section className="rounded-xl border border-slate-200 bg-slate-100/70 p-3"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2 text-xs font-bold text-slate-800"><Database className="h-4 w-4" />数据缺口</div><span className="text-[10px] text-slate-500">{dataGaps.length} 项</span></div><ul className="mt-2 space-y-1.5">{dataGaps.map((gap: string) => <li className="flex gap-2 text-[11px] leading-relaxed text-slate-700" key={gap}><span aria-hidden="true">•</span><span className="min-w-0 break-words">{gap}</span></li>)}</ul></section>}
      <button onClick={onAskTeacher} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-xs font-bold text-white hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"><MessageCircle className="h-4 w-4" />带着这份研究去问 AI 泡泡</button>
    </>}
  </div>;
}
