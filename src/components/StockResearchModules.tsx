import { Bot, CalendarDays, CheckCircle2, CircleAlert, Database, FileWarning, Info, Sparkles, XCircle } from 'lucide-react';
import { researchItemText, type ResearchSectionKey } from '../lib/stockResearch';

interface Props {
  sectionKey: ResearchSectionKey;
  outputs: any;
  counterCase: any[];
  evidence: any[];
  dataGaps?: string[];
  agentMeta?: any;
}

const labels: Record<string, string> = {
  available: '可用', unavailable: '暂不可用', limited: '有限可用', meaningful: '有效', not_meaningful: '不具解释意义',
  positive: '正向', negative: '负向', stable: '稳定', mixed: '分歧', risk: '风险', data_insufficient: '数据不足',
  triggered: '已触发', watch: '观察中', clear: '未触发', veto: '否决', downgrade: '降级',
  new: '最新披露', ongoing: '持续跟踪', settled: '已披露', expired: '已过期', unconfirmed: '待核验', unknown: '待评估', other: '其他公告',
  high: '高', medium: '中', low: '低', bullish: '偏多', bearish: '偏空', neutral: '中性', uncertain: '待确认',
  immediate: '即时', short: '短期', long: '长期', short_term: '短期', medium_term: '中期', long_term: '长期',
  official_and_media: '官方与媒体交叉核验', official_primary: '以官方来源为主', media_only: '仅媒体来源', community_heat_only: '仅社区热度', insufficient: '来源不足', third_party: '第三方数据', derived: '计算结果', market_data: '行情数据',
};

const asList = (value: any): any[] => Array.isArray(value) ? value.filter(Boolean) : value == null ? [] : [value];
const text = (value: any, fallback = '暂无数据') => value == null || value === '' ? fallback : labels[String(value)] || String(value);
const unique = (items: any[]) => {
  const result = new Map<string, any>();
  for (const item of items) {
    const value = researchItemText(item);
    if (value && !result.has(value)) result.set(value, item);
  }
  return [...result.values()];
};
const dateText = (value: any) => value ? String(value).replace('T', ' ').slice(0, 16) : '日期未标注';

function Empty({ children = '暂无可展示数据' }: { children?: React.ReactNode }) {
  return <p className="rounded-lg bg-slate-100 px-3 py-3 text-[11px] leading-relaxed text-slate-600">{children}</p>;
}

function BulletList({ items, tone = 'neutral', empty }: { items: any[]; tone?: 'neutral' | 'positive' | 'negative'; empty: string }) {
  if (!items.length) return <Empty>{empty}</Empty>;
  const tones = { neutral: 'border-slate-200 bg-white text-slate-800', positive: 'border-emerald-200 bg-emerald-50/60 text-emerald-950', negative: 'border-rose-200 bg-rose-50/60 text-rose-950' };
  return <ul className="space-y-2">{unique(items).slice(0, 4).map((item, index) => <li className={`rounded-lg border px-3 py-2 text-[11px] leading-relaxed ${tones[tone]}`} key={`${researchItemText(item)}-${index}`}>{researchItemText(item)}</li>)}</ul>;
}

function MetaStrip({ data, evidence, agentMeta }: { data: any; evidence: any[]; agentMeta: any }) {
  const sourceMeta = data?.sourceMeta || {};
  const latestEvidence = [...evidence].sort((a, b) => String(b?.period || b?.publishedAt || b?.fetchedAt || '').localeCompare(String(a?.period || a?.publishedAt || a?.fetchedAt || '')))[0];
  const source = sourceMeta.source || latestEvidence?.source || '来源未标注';
  const quality = data?.sourceQuality || latestEvidence?.verification || '未核验';
  const aiStatus = data?.aiStatus || 'not_requested';
  const cioStatus = agentMeta?.aiStatus;
  const aiLabel = data?.aiExplanation && cioStatus === 'completed' ? 'CIO AI 已完成本模块解释' : aiStatus === 'completed' ? '本模块 AI 已完成' : aiStatus === 'fallback' ? '本模块 AI 未完成，已回退' : cioStatus === 'completed' ? '本模块为确定性计算；CIO AI 已完成解释' : cioStatus === 'fallback' ? '本模块为确定性计算；CIO AI 已回退' : '本模块为确定性计算，未单独调用 AI';
  const aiTone = aiStatus === 'fallback' || cioStatus === 'fallback' ? 'text-amber-800 bg-amber-50' : 'text-slate-700 bg-slate-100';
  return <div className="mt-4 grid gap-2 border-t border-slate-200 pt-3 sm:grid-cols-3">
    <div className="rounded-lg bg-slate-100 px-2.5 py-2"><span className="flex items-center gap-1 text-[10px] font-bold text-slate-600"><Bot className="h-3 w-3" />AI 运行</span><p className={`mt-1 text-[10px] leading-relaxed ${aiTone}`}>{aiLabel}</p></div>
    <div className="rounded-lg bg-slate-100 px-2.5 py-2"><span className="flex items-center gap-1 text-[10px] font-bold text-slate-600"><CalendarDays className="h-3 w-3" />数据日期</span><p className="mt-1 text-[10px] leading-relaxed text-slate-700">{dateText(sourceMeta.generatedAt || sourceMeta.fetchedAt || latestEvidence?.period || latestEvidence?.publishedAt || latestEvidence?.fetchedAt)}</p></div>
    <div className="rounded-lg bg-slate-100 px-2.5 py-2"><span className="flex items-center gap-1 text-[10px] font-bold text-slate-600"><Database className="h-3 w-3" />来源与质量</span><p className="mt-1 break-words text-[10px] leading-relaxed text-slate-700">{source} · {text(quality)}</p></div>
  </div>;
}

function ModuleFrame({ conclusion, why, support, counter, gaps, data, evidence, agentMeta, children }: { conclusion: string; why: any[]; support: any[]; counter: any[]; gaps: string[]; data: any; evidence: any[]; agentMeta: any; children: React.ReactNode }) {
  const ai = data?.aiExplanation || {};
  const aiWhy = asList(ai?.why); const aiSupport = asList(ai?.supporting); const aiCounter = asList(ai?.counter);
  const displayConclusion = ai?.conclusion || conclusion;
  return <div className="space-y-4 pt-3">
    <section className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-3"><p className="flex items-center gap-1.5 text-[10px] font-bold text-indigo-800"><Sparkles className="h-3.5 w-3.5" />一句话结论{ai?.conclusion && <span className="rounded bg-white px-1.5 py-0.5 text-[9px] text-indigo-700">AI 解读</span>}</p><p className="mt-1.5 text-xs font-semibold leading-relaxed text-slate-900">{displayConclusion}</p></section>
    <section><h3 className="mb-2 text-[11px] font-bold text-slate-800">为什么{aiWhy.length > 0 && <span className="ml-1.5 text-[9px] font-medium text-indigo-700">AI 解读</span>}</h3><BulletList items={aiWhy.length ? aiWhy : why} empty="暂未形成可解释的确定性原因。" /></section>
    {children}
    <div className="grid gap-4 sm:grid-cols-2"><section><h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-bold text-emerald-800"><CheckCircle2 className="h-3.5 w-3.5" />支持证据</h3><BulletList items={aiSupport.length ? aiSupport : support} tone="positive" empty="暂无足够的正向证据。" /></section><section><h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-bold text-rose-800"><XCircle className="h-3.5 w-3.5" />反方证据</h3><BulletList items={aiCounter.length ? aiCounter : counter} tone="negative" empty="暂未发现本模块的反方证据。" /></section></div>
    <section><h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-bold text-slate-800"><FileWarning className="h-3.5 w-3.5" />数据缺口</h3>{gaps.length ? <ul className="space-y-1.5">{[...new Set(gaps)].slice(0, 4).map((gap) => <li className="flex gap-2 text-[11px] leading-relaxed text-slate-700" key={gap}><span aria-hidden="true">•</span><span>{gap}</span></li>)}</ul> : <Empty>当前模块未返回明确的数据缺口。</Empty>}</section>
    <MetaStrip data={data} evidence={evidence} agentMeta={agentMeta} />
  </div>;
}

function Trend({ reports }: { reports: any[] }) {
  const series = reports.slice(0, 5).reverse().map((report) => ({ period: report?.period, revenue: Number(report?.metrics?.revenue), profit: Number(report?.metrics?.netProfit) })).filter((item) => item.period && Number.isFinite(item.revenue));
  if (series.length < 2) return <Empty>历史财务趋势需要至少两个报告期；当前序列不足，未绘制图形。</Empty>;
  const max = Math.max(...series.flatMap((item) => [Math.abs(item.revenue), Number.isFinite(item.profit) ? Math.abs(item.profit) : 0]), 1);
  return <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="flex items-center justify-between"><h3 className="text-[11px] font-bold text-slate-800">财务历史趋势</h3><span className="text-[10px] text-slate-500">营收 / 归母净利润</span></div><div className="mt-3 flex h-28 items-end gap-2" aria-label="基于报告期真实数值的财务趋势图">{series.map((item) => <div className="flex min-w-0 flex-1 flex-col items-center gap-1" key={item.period}><div className="flex h-20 w-full items-end justify-center gap-1"><i className="w-2 rounded-t bg-indigo-500" style={{ height: `${Math.max(8, Math.abs(item.revenue) / max * 100)}%` }} title={`营收 ${item.revenue}`} />{Number.isFinite(item.profit) && <i className={`w-2 rounded-t ${item.profit >= 0 ? 'bg-emerald-500' : 'bg-rose-500'}`} style={{ height: `${Math.max(5, Math.abs(item.profit) / max * 100)}%` }} title={`归母净利润 ${item.profit}`} />}</div><span className="w-full truncate text-center text-[9px] text-slate-500">{String(item.period).slice(0, 7)}</span></div>)}</div><p className="mt-2 text-[9px] text-slate-500">蓝色：营收；绿色/红色：归母净利润。柱高仅比较本图内报告期。</p></div>;
}

function Fundamental({ data, gaps, evidence, counter, agentMeta }: any) {
  const signals = asList(data?.signals); const positive = signals.filter((item) => ['positive', 'stable'].includes(item?.status)); const negative = [...signals.filter((item) => ['deteriorating', 'risk', 'mixed'].includes(item?.status)), ...asList(data?.vetoes).filter((item) => item?.triggered)];
  const conclusion = positive[0] ? researchItemText(positive[0]) : negative[0] ? researchItemText(negative[0]) : '基本面尚未形成足够的确定性结论。';
  return <ModuleFrame conclusion={conclusion} why={signals} support={positive} counter={negative} gaps={gaps} data={data} evidence={evidence} agentMeta={agentMeta}><Trend reports={asList(data?.reports)} />{asList(data?.vetoes).filter((item) => item?.triggered).length > 0 && <section><h3 className="mb-2 text-[11px] font-bold text-rose-900">基本面否决项</h3><BulletList items={asList(data?.vetoes).filter((item) => item?.triggered)} tone="negative" empty="" /></section>}</ModuleFrame>;
}

function Technical({ data, gaps, evidence, counter, agentMeta }: any) {
  const signals = asList(data?.signals); const invalidations = asList(data?.structureInvalidation?.rules).filter((item) => item?.triggered); const positive = signals.filter((item) => item?.status === 'positive'); const negative = [...signals.filter((item) => ['negative', 'risk', 'deteriorating', 'mixed'].includes(item?.status)), ...invalidations];
  const conclusion = positive[0] ? researchItemText(positive[0]) : negative[0] ? researchItemText(negative[0]) : '技术与市场信号暂未形成明确方向。';
  return <ModuleFrame conclusion={conclusion} why={signals} support={positive} counter={negative} gaps={gaps} data={data} evidence={evidence} agentMeta={agentMeta}><>{invalidations.length > 0 && <section className="rounded-xl border border-rose-200 bg-rose-50 p-3"><h3 className="flex items-center gap-1.5 text-[11px] font-bold text-rose-900"><CircleAlert className="h-3.5 w-3.5" />结构失效条件</h3><BulletList items={invalidations} tone="negative" empty="" /></section>}</></ModuleFrame>;
}

function Events({ data, gaps, evidence, counter, agentMeta }: any) {
  const events = asList(data?.events).sort((a, b) => String(b?.publishedAt || b?.date || '').localeCompare(String(a?.publishedAt || a?.date || ''))); const positive = events.filter((item) => item?.direction === 'positive'); const negative = events.filter((item) => item?.direction === 'negative');
  const conclusion = events[0] ? `${text(events[0]?.direction, '待评估')}事件：${researchItemText(events[0])}` : '当前窗口内没有可展示的有效事件。';
  return <ModuleFrame conclusion={conclusion} why={events} support={positive} counter={negative} gaps={gaps} data={data} evidence={evidence} agentMeta={agentMeta}><section><h3 className="mb-2 text-[11px] font-bold text-slate-800">事件时间线</h3>{events.length ? <ol className="relative ml-2 space-y-0 border-l border-slate-200">{events.slice(0, 8).map((event, index) => <li className="relative pb-4 pl-4 last:pb-0" key={event?.eventId || index}><span className={`absolute -left-[5px] top-1 h-2 w-2 rounded-full ${event?.direction === 'positive' ? 'bg-emerald-500' : event?.direction === 'negative' ? 'bg-rose-500' : 'bg-slate-400'}`} /><p className="text-[10px] text-slate-500">{dateText(event?.publishedAt || event?.date)} · {text(event?.status)} · {text(event?.impactHorizon)}</p><p className="mt-1 text-[11px] font-semibold leading-relaxed text-slate-800">{researchItemText(event)}</p>{event?.summary && event.summary !== event.title && <p className="mt-1 text-[10px] leading-relaxed text-slate-600">{event.summary}</p>}</li>)}</ol> : <Empty>没有事件，因此没有绘制时间线。</Empty>}</section></ModuleFrame>;
}

function Sentiment({ data, gaps, evidence, counter, agentMeta }: any) {
  const metrics = [['关注度', data?.attention], ['情绪倾向', data?.tone], ['观点分歧', data?.disagreement], ['事件后反应', data?.eventReaction], ['传播质量', data?.propagationQuality]].filter(([, value]) => value != null).map(([name, value]) => ({ text: `${name}：${text(value)}` }));
  return <ModuleFrame conclusion={metrics[0] ? researchItemText(metrics[0]) : '当前未获得足够的舆情与市场反应数据。'} why={metrics} support={[]} counter={counter} gaps={gaps} data={data} evidence={evidence} agentMeta={agentMeta}><div className="grid grid-cols-2 overflow-hidden rounded-xl border border-slate-200 bg-slate-200 sm:grid-cols-3">{metrics.map((item) => <div className="min-h-16 bg-white p-3" key={item.text}><p className="text-[10px] leading-relaxed text-slate-700">{item.text}</p></div>)}</div></ModuleFrame>;
}

function Valuation({ data, gaps, evidence, counter, agentMeta }: any) {
  const multiples = data?.multiples || {}; const values = [['动态 PE', multiples.peDynamic], ['静态 PE', multiples.peStatic], ['PB', multiples.pb], ['PS', multiples.ps]].filter(([, value]) => Number.isFinite(Number(value)));
  const comparison = data?.comparison || {}; const percentile = Number(comparison?.percentile ?? comparison?.industryPercentile);
  const conclusion = data?.valuationStatus === 'available' ? (comparison?.reason || '估值快照可用，但需结合历史与可比基准解释。') : '估值事实或可比基准不完整，当前不判断高低估。';
  return <ModuleFrame conclusion={conclusion} why={comparison?.reason ? [{ text: comparison.reason }] : []} support={data?.valuationStatus === 'available' ? [{ text: '估值事实快照可用。' }] : []} counter={counter} gaps={[...gaps, ...(data?.valuationStatus === 'available' && Number.isFinite(percentile) ? [] : ['历史估值或行业分位尚未完整接入，不能据此判断相对高低。'])]} data={data} evidence={evidence} agentMeta={agentMeta}><section className="grid grid-cols-2 gap-2">{values.length ? values.map(([name, value]) => <div className="rounded-xl border border-slate-200 bg-white p-3" key={String(name)}><span className="text-[10px] text-slate-500">{name}</span><b className="mt-1 block font-mono text-lg text-slate-900">{Number(value).toFixed(2)}</b></div>) : <div className="col-span-2"><Empty>当前没有可展示的估值倍数。</Empty></div>}</section><section className="rounded-xl border border-slate-200 bg-white p-3"><div className="flex items-center justify-between"><h3 className="text-[11px] font-bold text-slate-800">行业分位</h3><span className="text-[10px] text-slate-500">真实可比数据</span></div>{Number.isFinite(percentile) ? <><div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-600" style={{ width: `${Math.max(0, Math.min(100, percentile * (percentile <= 1 ? 100 : 1)))}%` }} /></div><p className="mt-2 text-[10px] text-slate-700">当前分位：{(percentile <= 1 ? percentile * 100 : percentile).toFixed(1)}%</p></> : <p className="mt-2 text-[10px] leading-relaxed text-slate-600">尚无可核验的行业分位数，图表不显示推测位置。</p>}</section><section><h3 className="mb-2 text-[11px] font-bold text-slate-800">估值情景（非目标价）</h3><Empty>当前仅展示估值事实与可比基准，不输出目标价或交易建议。</Empty></section></ModuleFrame>;
}

function Risk({ data, gaps, evidence, counter, agentMeta }: any) {
  const vetoes = asList(data?.vetoes).filter((item) => item?.triggered); const risks = asList(data?.risks); const watches = asList(data?.watchConditions); const negative = unique([...vetoes, ...risks, ...counter]);
  const conclusion = vetoes.length ? `已触发 ${vetoes.length} 项否决条件，需要优先核验。` : data?.riskLevel ? `当前风险等级为${text(data.riskLevel)}，决策状态为${text(data.decision)}。` : '风险输入不完整，暂不能形成可靠评估。';
  return <ModuleFrame conclusion={conclusion} why={[...vetoes, ...risks, ...watches]} support={data?.decision === 'clear' ? [{ text: '当前未触发风险快照中的否决或降级条件。' }] : []} counter={negative} gaps={gaps} data={data} evidence={evidence} agentMeta={agentMeta}><>{watches.length > 0 && <section><h3 className="mb-2 text-[11px] font-bold text-slate-800">观察与解除条件</h3><BulletList items={watches} empty="暂无新增观察条件。" /></section>}</></ModuleFrame>;
}

function Evidence({ evidence, gaps, agentMeta }: any) {
  const sourceData = { sourceMeta: { generatedAt: evidence?.[0]?.fetchedAt }, aiStatus: 'not_requested' };
  return <ModuleFrame conclusion={evidence?.length ? `当前研究共引用 ${evidence.length} 条可追溯证据。` : '暂无可追溯证据，不能将结论视作已核验。'} why={evidence} support={evidence} counter={[]} gaps={gaps} data={sourceData} evidence={evidence} agentMeta={agentMeta}><section className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">{asList(evidence).slice(0, 12).map((item, index) => <article className="p-3" key={item?.evidenceId || index}><p className="text-[11px] font-semibold leading-relaxed text-slate-800">{item?.title || '未命名证据'}</p><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-600"><span>来源：{item?.source || '未标注'}</span><span>日期：{dateText(item?.period || item?.publishedAt || item?.fetchedAt)}</span><span>核验：{text(item?.verification, '未核验')}</span></div></article>)}</section></ModuleFrame>;
}

export function StockResearchModules({ sectionKey, outputs, counterCase, evidence, dataGaps = [], agentMeta }: Props) {
  const rawData = sectionKey === 'evidence' ? null : outputs?.[sectionKey];
  const aiExplanation = (agentMeta as any)?.moduleExplanations?.[sectionKey];
  const data = rawData ? { ...rawData, aiExplanation } : rawData;
  const moduleEvidence = evidence.filter((item: any) => sectionKey === 'evidence' || !data?.sourceMeta?.source || item?.source === data?.sourceMeta?.source || item?.type === (sectionKey === 'fundamental' ? 'financial' : sectionKey === 'events' ? 'announcement' : sectionKey === 'sentiment' ? 'sentiment' : undefined));
  const common = { data, gaps: dataGaps, evidence: moduleEvidence.length ? moduleEvidence : evidence, counter: counterCase, agentMeta };
  if (sectionKey === 'fundamental') return <Fundamental {...common} />;
  if (sectionKey === 'technical') return <Technical {...common} />;
  if (sectionKey === 'events') return <Events {...common} />;
  if (sectionKey === 'sentiment') return <Sentiment {...common} />;
  if (sectionKey === 'valuation') return <Valuation {...common} />;
  if (sectionKey === 'risk') return <Risk {...common} />;
  return <Evidence evidence={evidence} gaps={dataGaps} agentMeta={agentMeta} />;
}
