import type { LucideIcon } from 'lucide-react';
import { Activity, Landmark, MessageCircle, Network, Scale, ShieldAlert } from 'lucide-react';
import { researchItemText, type ResearchSectionKey } from '../lib/stockResearch';
import { StockResearchModules } from './StockResearchModules';

type SectionKey = Exclude<ResearchSectionKey, 'evidence'>;
export type ResearchWorkspaceView = 'overview' | SectionKey;

const sectionMeta: Record<SectionKey, { title: string; subtitle: string; icon: LucideIcon }> = {
  fundamental: { title: '基本面', subtitle: '盈利质量、财务信号和否决项', icon: Landmark },
  technical: { title: '技术与市场', subtitle: '趋势、结构和市场环境', icon: Activity },
  events: { title: '事件', subtitle: '公告、事件事实和影响方向', icon: MessageCircle },
  industry: { title: '行业与产业链', subtitle: '同业位置、上下游和行业/政策事件', icon: Network },
  sentiment: { title: '舆情', subtitle: '讨论热度、情绪和传播质量', icon: MessageCircle },
  valuation: { title: '估值', subtitle: '估值状态与可比数据', icon: Scale },
  risk: { title: '风险与反方', subtitle: '否决项、风险项和观察条件', icon: ShieldAlert },
};

const sectionKeys: SectionKey[] = ['fundamental', 'technical', 'events', 'industry', 'sentiment', 'valuation', 'risk'];

function InsightList({ title, items, tone, emptyText }: { title: string; items: any[]; tone: 'emerald' | 'rose'; emptyText: string }) {
  const surface = tone === 'emerald' ? 'border-emerald-100 bg-emerald-50/60 text-emerald-950' : 'border-rose-100 bg-rose-50/60 text-rose-950';
  return <section className={`rounded-xl border p-3 ${surface}`}>
    <div className="flex items-center justify-between gap-3"><h3 className="text-xs font-bold">{title}</h3><span className="text-[10px] opacity-70">{items.length} 项</span></div>
    {items.length ? <ul className="mt-3 space-y-2">{items.slice(0, 3).map((item, index) => <li className="rounded-lg bg-white/75 px-3 py-2 text-[11px] leading-relaxed" key={`${researchItemText(item)}-${index}`}>{researchItemText(item)}</li>)}</ul> : <p className="mt-3 text-[11px] leading-relaxed opacity-80">{emptyText}</p>}
  </section>;
}

interface Props {
  activeView: ResearchWorkspaceView;
  onChangeView: (view: ResearchWorkspaceView) => void;
  onRefresh: () => void;
  refreshing: boolean;
  outputs: any;
  counter: any[];
  supporting: any[];
  evidence: any[];
  dataGaps: string[];
  agentMeta: any;
  moduleExplanations: any;
}

export function StockResearchWorkspace({ activeView, onChangeView, onRefresh, refreshing, outputs, counter, supporting, evidence, dataGaps, agentMeta, moduleExplanations }: Props) {
  const activeMeta = activeView === 'overview' ? { title: '研究总览', subtitle: '汇总支持观点、反方观点及待核验事项' } : sectionMeta[activeView];
  const viewButton = (view: ResearchWorkspaceView, title: string, subtitle: string, Icon?: LucideIcon) => {
    const selected = activeView === view;
    const ready = view === 'overview' || Boolean(outputs?.[view]);
    return <button type="button" key={view} onClick={() => onChangeView(view)} aria-current={selected ? 'page' : undefined} className={`group flex min-h-12 min-w-[132px] items-center gap-2 rounded-xl px-2.5 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 md:min-w-0 md:px-3 ${selected ? 'bg-indigo-50 text-indigo-800 ring-1 ring-indigo-100' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}>
      {Icon ? <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${selected ? 'bg-white text-indigo-700' : 'bg-slate-100 text-slate-500'}`}><Icon className="h-3.5 w-3.5" /></span> : <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-xs font-black ${selected ? 'bg-white text-indigo-700' : 'bg-slate-100 text-slate-500'}`}>综</span>}
      <span className="min-w-0 flex-1"><span className="block text-[11px] font-bold">{title}</span><span className="mt-0.5 hidden truncate text-[9px] leading-snug text-slate-500 md:block">{subtitle}</span></span>
      <span aria-label={ready ? '数据可用' : '数据待补充'} className={`h-1.5 w-1.5 shrink-0 rounded-full ${ready ? 'bg-emerald-500' : 'bg-slate-300'}`} />
    </button>;
  };

  return <section className="grid gap-3 md:grid-cols-[208px_minmax(0,1fr)] md:gap-4">
    <aside className="rounded-xl border border-slate-200 bg-white p-2 md:p-2.5">
      <div className="hidden px-2 pb-2 md:block"><h2 className="text-xs font-bold text-slate-900">研究模块</h2><p className="mt-1 text-[10px] leading-relaxed text-slate-500">点击查看不同维度的研究详情</p></div>
      <nav aria-label="个股研究模块" className="flex gap-1 overflow-x-auto pb-1 no-scrollbar md:grid md:gap-1 md:overflow-visible md:pb-0">
        {viewButton('overview', '研究总览', '综合结论与行动')}
        {sectionKeys.map((key) => { const meta = sectionMeta[key]; return viewButton(key, meta.title, meta.subtitle, meta.icon); })}
      </nav>
    </aside>
    <div className="min-w-0 rounded-xl border border-slate-200 bg-white">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3.5">
        <div><h2 className="text-sm font-bold text-slate-900">{activeMeta.title}</h2><p className="mt-1 text-[10px] leading-relaxed text-slate-600">{activeMeta.subtitle}</p></div>
        <button type="button" onClick={onRefresh} disabled={refreshing} className="min-h-9 rounded-lg border border-slate-200 bg-white px-3 text-[10px] font-bold text-slate-700 transition hover:border-indigo-200 hover:text-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-wait disabled:opacity-60">{refreshing ? '正在刷新' : '刷新研究'}</button>
      </header>
      <div className="bg-slate-50/60 p-3 sm:p-4">
        {activeView === 'overview'
          ? <div><p className="mb-3 text-[11px] font-bold text-slate-700">支持与反方</p><div className="grid gap-3 lg:grid-cols-2"><InsightList title="支持观点" items={supporting} tone="emerald" emptyText="暂无有证据支持的正向观点" /><InsightList title="反方观点" items={counter} tone="rose" emptyText="暂无有证据支持的反方观点" /></div></div>
          : <StockResearchModules sectionKey={activeView} outputs={outputs} counterCase={counter} evidence={evidence} dataGaps={dataGaps} agentMeta={{ ...agentMeta, moduleExplanations }} />}
      </div>
    </div>
  </section>;
}
