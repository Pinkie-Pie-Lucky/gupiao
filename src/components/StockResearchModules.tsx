import { ExternalLink } from 'lucide-react';
import { researchItemText, type ResearchSectionKey } from '../lib/stockResearch';

interface Props {
  sectionKey: ResearchSectionKey;
  outputs: any;
  counterCase: any[];
  evidence: any[];
}

const labels: Record<string, string> = {
  available: '可用', unavailable: '不可用', limited: '有限可用', meaningful: '有效', not_meaningful: '不具解释意义',
  positive: '正向', negative: '负面', stable: '稳定', mixed: '分歧', risk: '风险', data_insufficient: '数据不足',
  triggered: '已触发', watch: '观察中', clear: '未触发', veto: '否决', downgrade: '降级',
  new: '最新披露', ongoing: '持续跟踪', settled: '已披露', expired: '已过期', unconfirmed: '待核验', unknown: '待评估', other: '其他公告',
  earnings: '业绩披露', forecast: '业绩预告', contract: '订单/合同', m_and_a: '并购重组', financing: '融资', shareholder: '股东事项', governance: '公司治理', regulatory: '监管', litigation: '诉讼仲裁', production: '生产经营', dividend: '分红回购', clarification: '澄清说明',
  high: '高', medium: '中', low: '低', rejected: '风险否决', blocked: '输入阻断', deferred: '暂缓推进', research_ready: '材料完整',
  bullish: '偏多', bearish: '偏空', neutral: '中性', uncertain: '待确认',
  immediate: '即时', short: '短期', long: '长期', short_term: '短期', medium_term: '中期', long_term: '长期',
  official_and_media: '官方与媒体交叉验证', official_primary: '以官方来源为主', media_only: '仅媒体来源',
  community_heat_only: '仅社区热度', insufficient: '来源不足', third_party: '第三方数据', derived: '计算结果', market_data: '行情数据',
};

const asList = (value: any): any[] => Array.isArray(value) ? value.filter(Boolean) : value == null ? [] : [value];
const display = (value: any, fallback = '暂无数据') => value == null || value === '' ? fallback : labels[String(value)] || String(value);
const displayHorizon = (value: any) => ({ immediate: '即时', short: '短期', medium: '中期', long: '长期', short_term: '短期', medium_term: '中期', long_term: '长期' }[String(value)] || display(value));

function Empty({ text = '暂无可用数据' }: { text?: string }) {
  return <p className="rounded-lg bg-slate-100 px-3 py-3 text-[11px] leading-relaxed text-slate-600">{text}</p>;
}

const triggerValueLabels: Record<string, string> = {
  ma50: 'MA50', support20d: '20 日区间低点', invalidationLevel: '失效参考位', consecutiveDays: '连续跌破天数', volumeConfirmed: '放量确认',
  ma20Slope5d: 'MA20 近 5 日斜率', macdHistogram: 'MACD 柱值', macdHistogramChange5d: 'MACD 柱近 5 日变化',
  atrPercentOfPrice: 'ATR/股价', volatilityPercentile1y: '波动率一年分位数', maxDrawdown20d: '20 日最大回撤', maxDrawdown60d: '60 日最大回撤',
};

function triggerValueText(key: string, value: any) {
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (value == null || value === '') return '数据不足';
  if (/Slope|Percent|Drawdown/.test(key) && Number.isFinite(Number(value))) return `${(Number(value) * 100).toFixed(2)}%`;
  return Number.isFinite(Number(value)) ? Number(value).toFixed(4).replace(/\.?(0+)$/, '') : String(value);
}

function TriggerData({ values }: { values?: Record<string, any> }) {
  const entries = Object.entries(values || {}).filter(([, value]) => value !== null && value !== undefined);
  if (!entries.length) return null;
  return <p className="mt-2 text-[10px] leading-relaxed text-slate-600"><b className="text-slate-700">触发数据：</b>{entries.map(([key, value]) => `${triggerValueLabels[key] || key} ${triggerValueText(key, value)}`).join('；')}。</p>;
}

function Group({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return <section><div className="mb-2 flex items-center justify-between gap-3"><h3 className="text-[11px] font-bold text-slate-800">{title}</h3>{typeof count === 'number' && <span className="text-[10px] text-slate-500">{count} 项</span>}</div>{children}</section>;
}

function Rows({ items, tone = 'neutral', showTriggerData = false }: { items: any[]; tone?: 'neutral' | 'positive' | 'risk' | 'warning'; showTriggerData?: boolean }) {
  if (!items.length) return <Empty />;
  const tones = { neutral: 'border-slate-200 bg-white', positive: 'border-emerald-200 bg-emerald-50/50', risk: 'border-rose-200 bg-rose-50/50', warning: 'border-amber-200 bg-amber-50/50' };
  return <div className="space-y-2">{items.slice(0, 8).map((item, index) => {
    const text = researchItemText(item);
    const state = item?.triggered === true ? 'triggered' : item?.status;
    return <article className={`rounded-lg border p-3 ${tones[tone]}`} key={`${item?.signalId || item?.riskId || item?.ruleId || text || 'row'}-${index}`}>
      <div className="flex items-start justify-between gap-3"><p className="min-w-0 text-[11px] font-medium leading-relaxed text-slate-800">{text || '未提供说明'}</p>{state && <span className="shrink-0 rounded-md bg-white/80 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">{display(state)}</span>}</div>
      {item?.trigger && <p className="mt-2 text-[10px] leading-relaxed text-slate-600"><b className="text-slate-700">触发：</b>{item.trigger}</p>}
      {showTriggerData && item?.triggered === true && <TriggerData values={item?.values} />}
      {item?.resolutionCondition && <p className="mt-1 text-[10px] leading-relaxed text-slate-600"><b className="text-slate-700">解除：</b>{item.resolutionCondition}</p>}
    </article>;
  })}</div>;
}

function Fundamental({ data }: { data: any }) {
  const signals = asList(data?.signals); const vetoes = asList(data?.vetoes).filter((item) => item?.triggered === true);
  return <div className="space-y-4"><Group title="确定性信号" count={signals.length}><Rows items={signals} /></Group>{vetoes.length > 0 && <Group title="已触发基本面否决项" count={vetoes.length}><Rows items={vetoes} tone="risk" /></Group>}</div>;
}

function Technical({ data }: { data: any }) {
  const signals = asList(data?.signals); const rules = asList(data?.structureInvalidation?.rules).filter((item) => item?.triggered === true);
  return <div className="space-y-4"><Group title="趋势与市场信号" count={signals.length}><Rows items={signals} /></Group>{rules.length > 0 && <Group title="已触发结构失效条件" count={rules.length}><Rows items={rules} tone="risk" showTriggerData /></Group>}</div>;
}

function Events({ data }: { data: any }) {
  const events = asList(data?.events || data?.items);
  if (!events.length) return <Empty text="当前窗口内暂无可展示的有效事件" />;
  return <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">{events.slice(0, 8).map((event, index) => {
    const direction = String(event?.direction || 'uncertain');
    const tone = direction === 'positive' ? 'text-emerald-700' : direction === 'negative' ? 'text-rose-700' : 'text-slate-600';
    return <article className="p-3" key={event?.eventId || index}><div className="flex items-start justify-between gap-3"><p className="text-[11px] font-semibold leading-relaxed text-slate-800">{event?.title || event?.summary || '未命名事件'}</p><span className={`shrink-0 text-[10px] font-bold ${tone}`}>{display(direction)}</span></div><div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-600"><span>影响：{displayHorizon(event?.impactHorizon)}</span><span>状态：{display(event?.status)}</span>{event?.category && <span>类型：{display(event.category)}</span>}</div>{event?.summary && event.summary !== event.title && <p className="mt-2 text-[10px] leading-relaxed text-slate-600">{event.summary}</p>}</article>;
  })}</div>;
}

function Sentiment({ data }: { data: any }) {
  const metrics = [['关注度', data?.attention], ['情绪倾向', data?.tone], ['观点分歧', data?.disagreement], ['事件后反应', data?.eventReaction], ['传播质量', data?.propagationQuality]];
  return <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 sm:grid-cols-3">{metrics.map(([name, value]) => <div className="min-h-16 bg-white p-3" key={name}><span className="block text-[10px] text-slate-500">{name}</span><b className={`mt-1 block text-[11px] leading-relaxed ${value == null || value === 'unavailable' ? 'text-slate-500' : 'text-slate-800'}`}>{display(value)}</b></div>)}</div>;
}

function Valuation({ data }: { data: any }) {
  const multiples = data?.multiples || {}; const comparison = data?.comparison || {}; const model = data?.scenarioModel || {};
  const metrics = [['动态 PE', 'peDynamic'], ['静态 PE', 'peStatic'], ['市净率 PB', 'pb'], ['市销率 PS', 'ps']];
  const scenarios = [['盈利情景', model.earnings], ['DCF 情景', model.dcf], ['剩余收益', model.residualIncome]];
  const number = (value: any) => Number.isFinite(Number(value)) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(Number(value)) : '--';
  return <div className="space-y-4">
    <div className="flex items-center justify-between rounded-lg bg-slate-100 px-3 py-2"><span className="text-[11px] font-semibold text-slate-700">估值数据状态</span><b className="text-[11px] text-slate-900">{display(data?.valuationStatus)}</b></div>
    <Group title="估值倍数"><div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200">{metrics.map(([name, key]) => <div className="bg-white p-3" key={key}><span className="block text-[10px] text-slate-500">{name}</span><b className="mt-1 block font-mono text-sm text-slate-900">{number(multiples[key])}</b><span className="mt-1 block text-[10px] text-slate-600">{display(multiples[`${key}Status`])}</span></div>)}</div></Group>
    <Group title="历史与同行比较"><div className="rounded-lg border border-slate-200 bg-white p-3"><div className="flex items-center justify-between gap-3 text-[11px]"><span className="text-slate-600">可比状态</span><b className="text-slate-800">{display(comparison.status)}</b></div>{comparison.reason && <p className="mt-2 text-[10px] leading-relaxed text-slate-600">{comparison.reason}</p>}</div></Group>
    <Group title="估值情景（非目标价）"><div className="space-y-2">{scenarios.map(([name, scenario]: any) => <div className="rounded-lg border border-slate-200 bg-white p-3" key={name}><div className="flex items-center justify-between gap-3"><span className="text-[11px] font-semibold text-slate-800">{name}</span><span className="text-[10px] text-slate-600">{display(scenario?.status)}</span></div>{scenario?.reason && <p className="mt-1.5 text-[10px] leading-relaxed text-slate-600">{scenario.reason}</p>}</div>)}</div></Group>
  </div>;
}

function Risk({ data, counterCase }: { data: any; counterCase: any[] }) {
  const vetoes = asList(data?.vetoes); const risks = asList(data?.risks).length ? asList(data?.risks) : asList(counterCase); const watches = asList(data?.watchConditions);
  return <div className="space-y-4"><div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200"><div className="bg-white p-3"><span className="block text-[10px] text-slate-500">风险等级</span><b className="mt-1 block text-[11px] text-slate-900">{display(data?.riskLevel)}</b></div><div className="bg-white p-3"><span className="block text-[10px] text-slate-500">风险决策</span><b className="mt-1 block text-[11px] text-slate-900">{display(data?.decision)}</b></div></div><Group title="已触发否决项" count={vetoes.length}><Rows items={vetoes} tone="risk" /></Group><Group title="风险项与反方证据" count={risks.length}><Rows items={risks} tone="warning" /></Group><Group title="观察与解除条件" count={watches.length}><Rows items={watches} /></Group></div>;
}

function Evidence({ evidence }: { evidence: any[] }) {
  if (!evidence.length) return <Empty text="暂无证据记录，当前结论只能按数据不足处理" />;
  return <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">{evidence.slice(0, 12).map((item, index) => <article className="p-3" key={item?.evidenceId || index}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-[11px] font-semibold leading-relaxed text-slate-800">{item?.title || item?.evidenceId || '未命名证据'}</p>{item?.value != null && <p className="mt-1 break-all font-mono text-[10px] text-slate-700">{String(item.value)}</p>}</div>{item?.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer" aria-label="打开证据来源" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-indigo-700 hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"><ExternalLink className="h-3.5 w-3.5" /></a>}</div><div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-600"><span>来源：{item?.source || '未标注'}</span><span>日期：{item?.period || item?.publishedAt || '未知'}</span><span>核验：{display(item?.verification, '未核验')}</span></div>{item?.evidenceId && <p className="mt-1.5 break-all font-mono text-[9px] text-slate-500">{item.evidenceId}</p>}</article>)}</div>;
}

export function StockResearchModules({ sectionKey, outputs, counterCase, evidence }: Props) {
  if (sectionKey === 'fundamental') return <Fundamental data={outputs?.fundamental} />;
  if (sectionKey === 'technical') return <Technical data={outputs?.technical} />;
  if (sectionKey === 'events') return <Events data={outputs?.events} />;
  if (sectionKey === 'sentiment') return <Sentiment data={outputs?.sentiment} />;
  if (sectionKey === 'valuation') return <Valuation data={outputs?.valuation} />;
  if (sectionKey === 'risk') return <Risk data={outputs?.risk} counterCase={counterCase} />;
  return <Evidence evidence={evidence} />;
}
