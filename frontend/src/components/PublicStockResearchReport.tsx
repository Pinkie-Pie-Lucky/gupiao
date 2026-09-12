import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, ChevronDown, Database, FileText, RefreshCw } from 'lucide-react';
import { ResponsiveAppShell, type AppNavigationItem } from './ResponsiveAppShell';
import { StockResearchOverview } from './StockResearchOverview';
import { StockResearchWorkspace, type ResearchWorkspaceView } from './StockResearchWorkspace';
import { StockResearchModules } from './StockResearchModules';
import { createResearchViewModel, researchItemText, type ResearchSectionKey } from '../lib/stockResearch';
import { useDeviceLayout } from '../hooks/useDeviceLayout';
import type { StockItem } from '../types';

interface Props {
  reportId: string;
}

type ReportResponse = {
  reportId: string;
  title: string;
  generatedAt: string;
  expiresAt: string;
  dataGaps: string[];
  payload: any;
};

type ReportModuleKey = Exclude<ResearchSectionKey, 'evidence'>;

const mobileModules: Array<{ key: ReportModuleKey; title: string; description: string }> = [
  { key: 'fundamental', title: '基本面', description: '盈利质量、财务信号和否决项' },
  { key: 'technical', title: '技术与市场', description: '趋势、结构和市场环境' },
  { key: 'events', title: '事件', description: '公告、事件事实和影响方向' },
  { key: 'industry', title: '行业与产业链', description: '同业位置、上下游和行业/政策事件' },
  { key: 'sentiment', title: '舆情', description: '讨论热度、情绪和传播质量' },
  { key: 'valuation', title: '估值', description: '估值状态与可比数据' },
  { key: 'risk', title: '风险与反方', description: '否决项、风险项和观察条件' },
];

function toFiniteNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function reportViewPayload(payload: any, reportDataGaps: string[]) {
  const snapshot = payload?.managerSnapshot || {};
  return {
    symbol: payload?.symbol,
    managerSnapshot: snapshot,
    deterministicManager: {
      researchStatus: snapshot.researchStatus,
      riskDecision: snapshot.riskDecision,
      riskLevel: snapshot.riskLevel,
      managerStance: snapshot.managerStance,
      conflicts: snapshot.conflicts || [],
      requiredConditions: snapshot.requiredConditions || [],
      researchPriorities: snapshot.researchPriorities || [],
    },
    opinion: {
      conclusion: snapshot.managerStance?.oneLine || snapshot.managerStance?.summary || snapshot.conclusion || '本报告展示生成时已冻结的事实快照。',
      supportingCase: snapshot.supportingCase || [],
      counterCase: snapshot.counterCase || [],
      requiredConditions: snapshot.requiredConditions || [],
      researchPriorities: snapshot.researchPriorities || [],
      dataGaps: reportDataGaps,
      moduleExplanations: snapshot.moduleExplanations || {},
    },
    agentMeta: {
      source: 'frozen_public_report',
      aiStatus: snapshot.agentMeta?.aiStatus || 'not_requested',
      generatedAt: payload?.generatedAt,
    },
  };
}

function PublicReportLoading({ message }: { message: string }) {
  return <section className="rounded-xl border border-slate-200 bg-white p-5 text-center shadow-sm"><RefreshCw className="mx-auto h-5 w-5 animate-spin text-indigo-600" /><p className="mt-3 text-sm font-semibold text-slate-800">{message}</p></section>;
}

function PublicMobileModules({ outputs, counter, evidence, dataGaps, agentMeta }: { outputs: any; counter: any[]; evidence: any[]; dataGaps: string[]; agentMeta: any }) {
  const [openModule, setOpenModule] = useState<ReportModuleKey | null>(null);
  return <section className="space-y-4" aria-label="个股研究模块详情">
    {mobileModules.map((module) => {
      const expanded = openModule === module.key;
      return <section className="rounded-xl border border-slate-200 bg-white" key={module.key}>
        <header className="flex items-center justify-between gap-3 p-3"><div className="min-w-0"><h2 className="text-sm font-bold text-slate-900">{module.title}</h2><p className="mt-1 text-[10px] leading-relaxed text-slate-600">{module.description}</p></div><button type="button" aria-expanded={expanded} onClick={() => setOpenModule((current) => current === module.key ? null : module.key)} className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-[10px] font-bold text-slate-700 transition hover:border-indigo-200 hover:text-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"><span>{expanded ? '收起' : '展开'}</span><ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} /></button></header>
        {expanded && <div className="border-t border-slate-100 px-3 pb-3"><StockResearchModules sectionKey={module.key} outputs={outputs} counterCase={counter} evidence={evidence} dataGaps={dataGaps} agentMeta={agentMeta} /></div>}
      </section>;
    })}
  </section>;
}

export function PublicStockResearchReport({ reportId }: Props) {
  const layout = useDeviceLayout();
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ResearchWorkspaceView>('overview');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/reports/${encodeURIComponent(reportId)}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || '报告暂时无法读取，请稍后重试。');
      setReport(payload as ReportResponse);
    } catch (loadError: any) {
      setError(loadError?.message || '报告暂时无法读取，请稍后重试。');
    } finally {
      setLoading(false);
    }
  }, [reportId]);

  useEffect(() => { void load(); }, [load]);

  // 公开报告是冻结的只读阅读页；不放首页/市场地图入口，避免用户误以为
  // 点击后仍在同一份报告内，实际却跳回带完整标签的交互产品。
  const navigation = useMemo<AppNavigationItem[]>(() => [
    { id: 'stock-research', label: '个股报告', icon: BarChart3, onSelect: () => undefined },
  ], []);

  const content = useMemo(() => {
    if (loading) return <PublicReportLoading message="正在读取已生成的研究报告" />;
    if (error || !report) return <section role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-center"><Database className="mx-auto h-5 w-5 text-rose-700" /><p className="mt-3 text-sm font-bold text-rose-900">报告读取失败</p><p className="mt-1 text-xs leading-relaxed text-rose-800">{error || '报告不存在或已过期。'}</p><button type="button" onClick={() => void load()} className="mt-4 min-h-10 rounded-lg bg-rose-700 px-4 text-xs font-bold text-white">重新读取</button></section>;

    const source = report.payload || {};
    const quote = source.quote || source.factSnapshot?.facts?.quote || {};
    const company = source.company || source.factSnapshot?.company || {};
    const stock: StockItem = {
      code: String(quote.code || source.symbol || '—'),
      name: String(quote.name || company.name || source.symbol || '个股'),
      price: toFiniteNumber(quote.price),
      changePercent: toFiniteNumber(quote.changePercent),
      volume: Number.isFinite(Number(quote.volume)) ? `${(Number(quote.volume) / 1e4).toFixed(0)}万` : '--',
      turnover: Number.isFinite(Number(quote.amount)) ? `${(Number(quote.amount) / 1e8).toFixed(2)}亿` : '--',
      history: [],
    };
    const view = createResearchViewModel(reportViewPayload(source, report.dataGaps));
    const stance = view.manager.managerStance || view.snapshot.managerStance || view.opinion.managerStance;
    const evidenceCount = new Set(view.snapshot.evidenceIds || []).size;
    const generatedAt = new Date(report.generatedAt).toLocaleString('zh-CN', { hour12: false });
    const agentMeta = { ...reportViewPayload(source, report.dataGaps).agentMeta, moduleExplanations: view.opinion.moduleExplanations };

    return <div className="space-y-4 px-3 pb-24 pt-2">
      <section className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-indigo-100 bg-indigo-50/70 px-3 py-2 text-[10px] text-indigo-900">
        <span className="inline-flex items-center gap-1.5 font-bold"><FileText className="h-3.5 w-3.5" />公开只读报告 · 使用产品研究页组件渲染</span>
        <span>数据冻结于 {generatedAt}</span>
      </section>
      <StockResearchOverview stock={stock} stance={stance} researchStatus={view.manager.researchStatus} riskLevel={view.manager.riskLevel} conclusion={view.opinion.conclusion} evidenceCount={evidenceCount} loading={false} error={null} />
      {layout === 'mobile'
        ? <PublicMobileModules outputs={view.outputs} counter={view.counter} evidence={view.evidence} dataGaps={view.dataGaps} agentMeta={agentMeta} />
        : <StockResearchWorkspace activeView={activeView} onChangeView={setActiveView} onRefresh={() => void load()} refreshing={false} outputs={view.outputs} supporting={view.supporting} counter={view.counter} evidence={view.evidence} dataGaps={view.dataGaps} agentMeta={agentMeta} moduleExplanations={view.opinion.moduleExplanations} />}
      {view.required.length > 0 && <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-3"><p className="text-xs font-bold text-amber-900">下一步核验</p><ul className="mt-2 space-y-1.5">{view.required.slice(0, 5).map((item: any, index: number) => <li className="flex gap-2 text-[11px] leading-relaxed text-amber-900" key={`${researchItemText(item)}-${index}`}><span>•</span><span>{researchItemText(item)}</span></li>)}</ul></section>}
      {view.dataGaps.length > 0 && <section className="rounded-xl border border-slate-200 bg-slate-100/70 p-3"><div className="flex items-center gap-2 text-xs font-bold text-slate-800"><Database className="h-4 w-4" />数据缺口</div><ul className="mt-2 space-y-1.5">{view.dataGaps.map((gap: string) => <li className="flex gap-2 text-[11px] leading-relaxed text-slate-700" key={gap}><span>•</span><span>{gap}</span></li>)}</ul></section>}
      <p className="px-1 text-[10px] leading-relaxed text-slate-400">本报告仅用于信息研究与学习，不构成投资建议、收益承诺或交易指令。</p>
    </div>;
  }, [activeView, error, layout, load, loading, report]);

  return <ResponsiveAppShell layout={layout} activeId="stock-research" navigation={navigation} title="个股分析报告" onRefresh={() => void load()} refreshing={loading} refreshMessage={null} hideRefresh hideProductMeta darkMode={false} onToggleTheme={() => undefined}>
    {content}
  </ResponsiveAppShell>;
}
