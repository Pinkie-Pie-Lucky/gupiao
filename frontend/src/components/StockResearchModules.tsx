import { CheckCircle2, CircleAlert, Info, Sparkles, XCircle } from 'lucide-react';
import { useState } from 'react';
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
  positive: '正向', negative: '负向', stable: '稳定', improving: '改善', deteriorating: '走弱', mixed: '分歧', risk: '风险', data_insufficient: '数据不足',
  triggered: '已触发', watch: '观察中', clear: '未触发', veto: '否决', downgrade: '降级',
  new: '最新披露', ongoing: '持续跟踪', settled: '已披露', expired: '已过期', unconfirmed: '待核验', unknown: '待评估', other: '其他公告',
  high: '高', medium: '中', low: '低', bullish: '偏多', bearish: '偏空', neutral: '中性', uncertain: '待确认',
  rising: '上升', falling: '下降', flat: '平稳',
  official_led: '官方事实为主', media_led: '媒体报道为主', community_led: '社区讨论为主',
  confirmed_reaction: '市场反应确认', divergent_reaction: '市场反应背离', weak_reaction: '市场反应偏弱', not_evaluable: '暂不可评估',
  immediate: '即时', short: '短期', long: '长期', short_term: '短期', medium_term: '中期', long_term: '长期',
  company: '公司', industry: '行业', market: '市场', revenue: '收入', profit: '利润', cash_flow: '现金流', valuation: '估值',
  partial: '部分可用', mapped: '已映射', upper_quartile: '行业较高分位', middle_range: '行业中间区间', lower_quartile: '行业较低分位', sufficient: '样本充足', thin: '样本偏少', complete: '成员完整', policy: '政策',
  official_verified: '官方已核验', official_document_only: '仅官方文件', credible_media_only: '可信媒体待核验', community_unverified: '社区线索待核验', officially_clarified: '已获官方澄清', disputed: '存在争议', unverified: '未核验',
  rumor: '传闻阶段', announced: '已披露', executing: '执行跟踪', verified: '进展核验', weakened: '影响减弱', invalidated: '已被澄清/失效',
  origin: '起点', media_report: '媒体报道', official_confirmation: '官方确认', official_clarification: '官方澄清', regulatory_response: '监管响应', follow_up: '后续进展',
  official_and_media: '官方与媒体交叉核验', official_primary: '以官方来源为主', media_only: '仅媒体来源', community_heat_only: '仅社区热度', insufficient: '来源不足', third_party: '第三方数据', derived: '计算结果', market_data: '行情数据',
  weibo_hot: '微博热搜', zhihu_hot: '知乎热榜', baidu_hot: '百度热搜', douyin_hot: '抖音热点', toutiao_hot: '头条热榜', bilibili_hot: 'B 站热搜', hotlist_discovery_only: '热点候选',
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

function ModuleFrame({ conclusion, why, support, counter, data, children }: { conclusion: string; why: any[]; support: any[]; counter: any[]; gaps?: string[]; evidence?: any[]; agentMeta?: any; data: any; children: React.ReactNode }) {
  const ai = data?.aiExplanation || {};
  const aiWhy = asList(ai?.why); const aiSupport = asList(ai?.supporting); const aiCounter = asList(ai?.counter);
  const hasAiInterpretation = Boolean(ai?.conclusion || aiWhy.length || aiSupport.length || aiCounter.length);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const displayConclusion = ai?.conclusion || conclusion;
  const supportItems = aiSupport.length ? aiSupport : support;
  const counterItems = aiCounter.length ? aiCounter : counter;
  const evidenceCount = unique([...supportItems, ...counterItems]).length;
  return <div className="space-y-4 pt-3">
    <section className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-3"><p className="flex items-center gap-1.5 text-[10px] font-bold text-indigo-800"><Sparkles className="h-3.5 w-3.5" />一句话结论{hasAiInterpretation && <span className="rounded bg-white px-1.5 py-0.5 text-[9px] text-indigo-700">AI 解读</span>}</p><p className="mt-1.5 text-xs font-semibold leading-relaxed text-slate-900">{displayConclusion}</p></section>
    <section><h3 className="mb-2 text-[11px] font-bold text-slate-800">为什么{aiWhy.length > 0 && <span className="ml-1.5 text-[9px] font-medium text-indigo-700">AI 解读</span>}</h3><BulletList items={aiWhy.length ? aiWhy : why} empty="暂未形成可解释的确定性原因。" /></section>
    {children}
    <section className="rounded-xl border border-slate-200 bg-white"><button type="button" aria-expanded={evidenceOpen} onClick={() => setEvidenceOpen((value) => !value)} className="flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-indigo-600"><span><span className="block text-[11px] font-bold text-slate-800">支持与反方证据</span><span className="mt-0.5 block text-[9px] text-slate-500">{evidenceCount ? `${evidenceCount} 条可核验事实，默认收起` : '当前没有可展开的证据项'}</span></span><span className="rounded-md bg-slate-100 px-2 py-1 text-[9px] font-semibold text-slate-700">{evidenceOpen ? '收起' : '展开'}</span></button>{evidenceOpen && <div className="grid gap-4 border-t border-slate-200 p-3 sm:grid-cols-2"><section><h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-bold text-emerald-800"><CheckCircle2 className="h-3.5 w-3.5" />支持证据</h3><BulletList items={supportItems} tone="positive" empty="暂无足够的正向证据。" /></section><section><h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-bold text-rose-800"><XCircle className="h-3.5 w-3.5" />反方证据</h3><BulletList items={counterItems} tone="negative" empty="暂未发现本模块的反方证据。" /></section></div>}</section>
  </div>;
}

function deterministicConclusion(label: string, positive: any[], negative: any[], empty: string) {
  if (positive.length && negative.length) return `${label}存在支持与反方并存的信号，当前判断需结合证据持续核验。`;
  if (negative.length) return `${label}存在需要关注的反方信号，当前尚未形成单向结论。`;
  if (positive.length) return `${label}目前有可核验的支持信号，仍需后续数据验证延续性。`;
  return empty;
}

function FinancialTrend({ trends }: { trends: any }) {
  const [view, setView] = useState<'annual' | 'quarterly'>('annual');
  const annual = asList(trends?.annual);
  const quarterly = asList(trends?.quarterly);
  const selected = view === 'annual' ? annual : quarterly;
  const series = selected.map((item) => ({ period: item?.period, label: view === 'annual' ? String(item?.year || item?.period || '').slice(0, 4) : item?.label || String(item?.period || '').slice(2, 7), revenue: Number(item?.revenue), profit: Number(item?.netProfit) })).filter((item) => item.period && (Number.isFinite(item.revenue) || Number.isFinite(item.profit)));
  if (series.length < 2) return <Empty>完整年度或可拆分的单季度财务序列不足，暂不绘制趋势图。</Empty>;
  const max = Math.max(...series.flatMap((item) => [Number.isFinite(item.revenue) ? Math.abs(item.revenue) : 0, Number.isFinite(item.profit) ? Math.abs(item.profit) : 0]), 1);
  return <section className="rounded-xl border border-slate-200 bg-white p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-[11px] font-bold text-slate-800">财务历史趋势</h3><p className="mt-1 text-[9px] leading-relaxed text-slate-600">营收 / 归母净利润 · {view === 'annual' ? '仅完整年报' : '已由累计季报拆分为单季度值'}</p></div><div className="flex rounded-lg bg-slate-100 p-0.5" role="tablist" aria-label="财务趋势口径"><button type="button" role="tab" aria-selected={view === 'annual'} onClick={() => setView('annual')} className={`min-h-8 rounded-md px-2.5 text-[9px] font-semibold ${view === 'annual' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}>年度</button><button type="button" role="tab" aria-selected={view === 'quarterly'} onClick={() => setView('quarterly')} className={`min-h-8 rounded-md px-2.5 text-[9px] font-semibold ${view === 'quarterly' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}>单季度</button></div></div><div className="mt-3 flex h-32 items-end gap-2" aria-label={`${view === 'annual' ? '完整年度' : '单季度'}营收和归母净利润趋势图`}>{series.map((item) => <div className="flex min-w-0 flex-1 flex-col items-center gap-1" key={item.period}><div className="flex h-24 w-full items-end justify-center gap-1"><i className="w-2 rounded-t bg-indigo-500" style={{ height: `${Number.isFinite(item.revenue) ? Math.max(4, Math.abs(item.revenue) / max * 100) : 0}%` }} title={`营收 ${formatFinancialValue(item.revenue, 'CNY')}`} />{Number.isFinite(item.profit) && <i className={`w-2 rounded-t ${item.profit >= 0 ? 'bg-emerald-500' : 'bg-rose-500'}`} style={{ height: `${Math.max(4, Math.abs(item.profit) / max * 100)}%` }} title={`归母净利润 ${formatFinancialValue(item.profit, 'CNY')}`} />}</div><span className="w-full truncate text-center text-[9px] text-slate-500">{item.label}</span></div>)}</div><div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[9px] text-slate-600"><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-indigo-500" />营收</span><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-500" />归母净利润为正</span><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-rose-500" />归母净利润为负</span></div>{trends?.sourceNote && <p className="mt-2 text-[9px] leading-relaxed text-slate-500">{trends.sourceNote}</p>}</section>;
}

function FinancialMiniTrend({ label, values, color, format }: { label: string; values: Array<{ period: string; value: number }>; color: string; format: (value: number) => string }) {
  if (values.length < 2) return <article className="rounded-lg border border-slate-200 bg-white p-3"><p className="text-[10px] font-semibold text-slate-800">{label}</p><p className="mt-2 text-[9px] text-slate-500">可比完整年度不足，暂不绘制。</p></article>;
  const width = 220; const height = 48; const padding = 5;
  const minimum = Math.min(...values.map((item) => item.value)); const maximum = Math.max(...values.map((item) => item.value)); const span = Math.max(maximum - minimum, Math.abs(maximum) * 0.05, 0.0001);
  const points = values.map((item, index) => ({ ...item, x: padding + index * (width - padding * 2) / Math.max(1, values.length - 1), y: height - padding - (item.value - minimum) / span * (height - padding * 2) }));
  const latest = values.at(-1)!; const first = values[0]; const change = latest.value - first.value;
  return <article className="rounded-lg border border-slate-200 bg-white p-3" title={`${label}：${first.period.slice(0, 4)} ${format(first.value)}，${latest.period.slice(0, 4)} ${format(latest.value)}`}><div className="flex items-baseline justify-between gap-2"><p className="text-[10px] font-semibold text-slate-800">{label}</p><p className="font-mono text-sm font-bold text-slate-950">{format(latest.value)}</p></div><p className={`mt-1 text-[9px] font-medium ${change > 0 ? 'text-emerald-700' : change < 0 ? 'text-rose-700' : 'text-slate-600'}`}>{first.period.slice(0, 4)} 至 {latest.period.slice(0, 4)} · {change > 0 ? '整体上行' : change < 0 ? '整体下行' : '整体平稳'}</p><svg aria-label={`${label}近年趋势`} className="mt-2 h-12 w-full" role="img" viewBox={`0 0 ${width} ${height}`}><polyline fill="none" points={points.map((point) => `${point.x},${point.y}`).join(' ')} stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />{points.map((point) => <circle cx={point.x} cy={point.y} fill="white" key={point.period} r="2.6" stroke={color} strokeWidth="2"><title>{point.period.slice(0, 4)}：{format(point.value)}</title></circle>)}</svg><div className="flex justify-between text-[8px] text-slate-500"><span>{first.period.slice(0, 4)}</span><span>{latest.period.slice(0, 4)}</span></div></article>;
}

function FinancialFiveYearTrends({ trends }: { trends: any }) {
  const annual = asList(trends?.annual).filter((item) => item?.period).slice(-5);
  if (annual.length < 2) return null;
  const roe = annual.filter((item) => hasNumber(item?.roe)).map((item) => ({ period: String(item.period), value: Number(item.roe) }));
  const netMargin = annual.filter((item) => hasNumber(item?.netMargin)).map((item) => ({ period: String(item.period), value: Number(item.netMargin) }));
  const revenueGrowth = annual.flatMap((item, index) => {
    const previous = annual[index - 1];
    if (!previous || !hasNumber(item?.revenue) || !hasNumber(previous?.revenue) || Number(previous.revenue) === 0) return [];
    return [{ period: String(item.period), value: Number(item.revenue) / Number(previous.revenue) - 1 }];
  });
  const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
  return <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-[11px] font-bold text-slate-800">近 5 年关键财务趋势</h3><p className="mt-1 text-[9px] leading-relaxed text-slate-600">仅使用完整年报，分别观察资本回报、盈利质量与增长动能。</p></div><span className="rounded-md bg-white px-2 py-1 text-[9px] text-slate-600">公司自身趋势</span></div><div className="mt-3 grid gap-2 sm:grid-cols-3"><FinancialMiniTrend label="ROE" values={roe} color="#059669" format={percent} /><FinancialMiniTrend label="净利率" values={netMargin} color="#4f46e5" format={percent} /><FinancialMiniTrend label="营收增速" values={revenueGrowth} color="#d97706" format={percent} /></div><p className="mt-2 text-[9px] leading-relaxed text-slate-500">图表不含行业评价；同行位置、行业景气和产业链影响请查看行业与产业链模块。</p></section>;
}

function FinancialTrendQuality({ quality }: { quality: any }) {
  if (!quality) return null;
  const dimensions = asList(quality?.dimensions);
  const score = hasNumber(quality?.score) ? Math.round(Number(quality.score)) : null;
  const confidence = quality?.confidence || {};
  const fallbackScore = (status: string) => status === 'improving' ? 90 : status === 'stable' ? 70 : status === 'mixed' ? 50 : status === 'deteriorating' ? 25 : null;
  const tone = (status: string) => status === 'improving' ? 'bg-emerald-500' : status === 'deteriorating' ? 'bg-rose-500' : status === 'mixed' ? 'bg-amber-500' : 'bg-slate-400';
  return <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-[11px] font-bold text-slate-800">年度趋势质量</h3><p className="mt-1 text-[9px] leading-relaxed text-slate-600">基于公司自身完整年度变化，不等同于行业排名、信用评级或投资建议。</p></div><div className="text-right"><p className="font-mono text-xl font-bold text-slate-950">{score === null ? '--' : score}<span className="text-[10px] text-slate-500"> / 100</span></p><p className="text-[9px] text-slate-500">计算覆盖度 {hasNumber(confidence?.score) ? `${Math.round(Number(confidence.score))}%` : '--'}</p></div></div>{dimensions.length ? <div className="mt-3 space-y-2.5">{dimensions.map((item) => { const itemScore = hasNumber(item.score) ? Math.round(Number(item.score)) : fallbackScore(String(item.status)); return <div key={item.key || item.label}><div className="flex items-center justify-between gap-2 text-[10px]"><span className="font-medium text-slate-800">{item.label}</span><span className="font-mono text-slate-700">{text(item.status, '数据不足')} · {itemScore === null ? '--' : itemScore}</span></div><div aria-label={`${item.label} ${itemScore ?? '数据不足'} 分`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={itemScore ?? undefined} className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200" role="progressbar"><div className={`h-full rounded-full ${tone(String(item.status))}`} style={{ width: `${itemScore === null ? 0 : Math.max(4, Math.min(100, itemScore))}%` }} /></div></div>; })}</div> : null}{confidence?.reason && <p className="mt-3 border-t border-slate-200 pt-2 text-[9px] leading-relaxed text-slate-500">{confidence.reason}</p>}</section>;
}

const hasNumber = (value: any) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const formatFinancialValue = (value: any, unit: string) => {
  if (!hasNumber(value)) return '--';
  const number = Number(value);
  if (unit === 'fraction') return `${(number * 100).toFixed(1)}%`;
  if (unit === 'days') return `${number.toFixed(1)} 天`;
  if (unit === 'times' || unit === 'times_per_year') return `${number.toFixed(2)} 次`;
  if (unit === 'CNY') return `${(Math.abs(number) >= 1e8 ? number / 1e8 : number / 1e4).toFixed(2)} ${Math.abs(number) >= 1e8 ? '亿' : '万'}`;
  return number.toFixed(2);
};

function FinancialQuality({ calculations, template, trends }: { calculations: any; template: string; trends?: any }) {
  const [showAll, setShowAll] = useState(false);
  const [openMetric, setOpenMetric] = useState<string | null>(null);
  const metrics = calculations?.metrics || {};
  const details = calculations?.metricDetails || {};
  const bank = template === 'bank' || calculations?.template === 'bank';
  const trendByKey = Object.fromEntries(asList(trends?.quality?.dimensions).map((item) => [String(item?.key), String(item?.status || 'unknown')]));
  const metricDimension: Record<string, string> = {
    revenueYoY: 'growth', netProfitYoY: 'growth', adjustedNetProfitYoY: 'growth',
    grossMargin: 'profitability', netMargin: 'profitability', adjustedNetMargin: 'profitability', roeApprox: 'profitability', roic: 'profitability',
    cashConversion: 'cash', freeCashFlow: 'cash', capex: 'cash',
    assetLiabilityRatio: 'resilience', currentRatio: 'resilience', interestBearingDebt: 'resilience', netDebt: 'resilience', interestCoverage: 'resilience',
    accountsReceivableDays: 'efficiency', inventoryDays: 'efficiency',
  };
  const semantic = (key: string, available: boolean) => {
    if (!available) return { label: '数据不足', card: 'border-slate-200 bg-slate-50', badge: 'bg-slate-200 text-slate-700' };
    const status = trendByKey[metricDimension[key]];
    if (status === 'improving') return { label: '趋势改善', card: 'border-emerald-200 bg-emerald-50/60', badge: 'bg-emerald-100 text-emerald-800' };
    if (status === 'deteriorating') return { label: '趋势走弱', card: 'border-rose-200 bg-rose-50/70', badge: 'bg-rose-100 text-rose-900' };
    if (status === 'mixed') return { label: '信号分歧', card: 'border-amber-200 bg-amber-50/60', badge: 'bg-amber-100 text-amber-900' };
    if (status === 'stable') return { label: '相对稳定', card: 'border-slate-200 bg-white', badge: 'bg-slate-100 text-slate-700' };
    return { label: '待形成趋势', card: 'border-slate-200 bg-white', badge: 'bg-slate-100 text-slate-600' };
  };
  const loanDepositGap = hasNumber(metrics.loanYoY) && hasNumber(metrics.depositYoY) ? Number(metrics.loanYoY) - Number(metrics.depositYoY) : null;
  const primary = bank
    ? [
      { key: 'roeApprox', label: 'ROE（近似）', unit: 'fraction', note: '净利润 / 平均权益' },
      { key: 'loanDepositGap', label: '贷款-存款增速差', unit: 'fraction', value: loanDepositGap, note: '正值表示贷款增速快于存款' },
      { key: 'interestNetIncomeYoY', label: '净利息收入同比', unit: 'fraction', note: '银行核心利息收入变化' },
      { key: 'creditImpairmentToRevenue', label: '信用减值/营收', unit: 'fraction', note: '需结合资产质量进一步判断' },
    ]
    : [
      { key: 'revenueYoY', label: '营收增速', unit: 'fraction', note: '观察当前报告期收入增长动能' },
      { key: 'adjustedNetProfitYoY', label: '扣非净利润增速', unit: 'fraction', note: '弱化非经常性损益后的利润增长' },
      { key: 'roeApprox', label: 'ROE（近似）', unit: 'fraction', note: '净利润 / 平均权益' },
      { key: 'cashConversion', label: '经营现金流/净利润', unit: 'fraction', note: '利润的现金回收质量' },
      { key: 'assetLiabilityRatio', label: '资产负债率', unit: 'fraction', note: '负债合计 / 资产合计' },
      { key: 'freeCashFlow', label: '自由现金流', unit: 'CNY', note: '经营现金流 - 资本开支' },
    ];
  const all = bank
    ? [
      ...primary,
      { key: 'assetYoY', label: '资产同比', unit: 'fraction' }, { key: 'loanYoY', label: '贷款同比', unit: 'fraction' }, { key: 'depositYoY', label: '存款同比', unit: 'fraction' }, { key: 'feeNetIncomeYoY', label: '手续费及佣金净收入同比', unit: 'fraction' },
    ]
    : [
      ...primary,
      { key: 'grossMargin', label: '毛利率', unit: 'fraction' }, { key: 'netMargin', label: '净利率', unit: 'fraction' }, { key: 'adjustedNetMargin', label: '扣非净利率', unit: 'fraction' }, { key: 'currentRatio', label: '流动比率', unit: 'times' }, { key: 'accountsReceivableDays', label: '应收周转天数', unit: 'days' }, { key: 'inventoryDays', label: '存货周转天数', unit: 'days' }, { key: 'interestBearingDebt', label: '有息负债', unit: 'CNY' }, { key: 'netDebt', label: '净负债', unit: 'CNY' }, { key: 'interestCoverage', label: '利息保障倍数', unit: 'times' }, { key: 'capex', label: '资本开支', unit: 'CNY' }, { key: 'roic', label: 'ROIC（代理）', unit: 'fraction' },
    ];
  const sourcePeriod = calculations?.period || '报告期未标注';
  const card = (item: any, primaryCard = false) => {
    const value = item.value === undefined ? metrics?.[item.key] : item.value;
    const detail = details?.[item.key];
    const available = hasNumber(value);
    const unavailableReason = detail?.dataGap || '当前报告期缺少计算所需字段。';
    const state = semantic(item.key, available);
    const expanded = openMetric === item.key;
    const explanation = available
      ? `${item.note || detail?.formula || '基于当前报告期结构化财务数据。'}；${state.label}仅表示公司自身多年变化，不代表行业优劣。`
      : unavailableReason;
    return <article className={`rounded-lg border p-3 ${state.card}`} key={item.key} title={explanation}><div className="flex items-start justify-between gap-2"><p className="text-[10px] font-medium text-slate-700">{item.label}</p><span className={`rounded px-1.5 py-0.5 text-[8px] font-semibold ${state.badge}`}>{state.label}</span></div><p className={`mt-1 font-mono font-bold tracking-tight ${primaryCard ? 'text-lg' : 'text-sm'} ${available ? 'text-slate-950' : 'text-slate-500'}`}>{formatFinancialValue(value, item.unit)}</p><button type="button" aria-expanded={expanded} className="mt-1 min-h-8 text-left text-[9px] font-medium leading-relaxed text-indigo-700 underline decoration-indigo-200 underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600" onClick={() => setOpenMetric(expanded ? null : item.key)}>{expanded ? '收起解释' : '这个指标怎么看？'}</button>{expanded && <div className="mt-1 rounded-md bg-white/80 p-2 text-[9px] leading-relaxed text-slate-600"><p>{explanation}</p><p className="mt-1">报告期：{sourcePeriod}{detail?.formula ? ` · 公式：${detail.formula}` : ''}</p><p className="mt-1">同行位置和行业合理区间请查看行业与产业链模块。</p></div>}</article>;
  };
  if (!calculations) return <Empty>财务质量指标尚未随事实快照返回，不能用估算值代替。</Empty>;
  return <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-[11px] font-bold text-slate-800">财务质量</h3><p className="mt-1 text-[10px] leading-relaxed text-slate-600">{bank ? '银行口径：盈利、资金匹配和减值压力。' : '普通企业口径：盈利、现金回收与资本效率。'} 指标来自 {sourcePeriod}。</p></div><span className="rounded-md bg-white px-2 py-1 text-[9px] font-medium text-slate-700">{bank ? '银行模板' : '普通企业模板'}</span></div><div className="mt-3 grid grid-cols-2 gap-2">{primary.map((item) => card(item, true))}</div><div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2"><p className="text-[10px] font-semibold text-slate-800">颜色怎么读</p><p className="mt-1 text-[9px] leading-relaxed text-slate-600">绿色表示公司自身趋势改善，红色表示趋势走弱，黄色表示信号分歧，白色表示稳定或尚未形成趋势。颜色不代替文字，也不直接代表行业优劣。</p></div>{showAll && <div className="mt-3 border-t border-slate-200 pt-3"><p className="mb-2 text-[10px] font-bold text-slate-800">完整财务口径</p><div className="grid gap-2 sm:grid-cols-2">{all.slice(primary.length).map((item) => card(item))}</div></div>}<button type="button" className="mt-3 min-h-9 rounded-lg border border-slate-300 bg-white px-3 py-2 text-[10px] font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600" aria-expanded={showAll} onClick={() => setShowAll((value) => !value)}>{showAll ? '收起完整指标' : '查看完整指标'}</button></section>;
}

function SegmentRows({ items, top, complete }: { items: any[]; top: number; complete: boolean }) {
  return <div className="space-y-2">{items.map((item) => <div key={item?.evidenceId || item?.name}><div className="flex items-baseline justify-between gap-3 text-[10px]"><span className="min-w-0 truncate font-medium text-slate-800">{item?.name}</span><span className="shrink-0 font-mono text-slate-700">{Number(item?.revenue).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-indigo-600" style={{ width: `${Math.max(2, top ? Number(item?.revenueShare || 0) / top * 100 : 0)}%` }} /></div><p className="mt-1 text-[9px] text-slate-500">{complete ? '占公司营业收入' : '占已披露项目'} {((Number(item?.revenueShare) || 0) * 100).toFixed(1)}% · 证据页 {item?.pageNumber}{asList(item?.childNames).length ? ` · 汇总：${asList(item.childNames).join('、')}` : ''}</p></div>)}</div>;
}

function BusinessSegments({ snapshot }: { snapshot: any }) {
  const sets = asList(snapshot?.segmentSets);
  const document = snapshot?.document || {};
  const [expanded, setExpanded] = useState(false);
  if (!sets.length) return <Empty>尚未定位到可展示的分产品、分地区或分行业原文章节。</Empty>;
  const labels: Record<string, string> = { product: '分产品', region: '分地区', industry: '分行业' };
  return <section className="rounded-xl border border-slate-200 bg-white p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-[11px] font-bold text-slate-800">分业务经营</h3><p className="mt-1 text-[10px] leading-relaxed text-slate-600">巨潮原文中的产品、地区和行业构成。默认收起，避免挤占基本面结论。</p></div><div className="flex shrink-0 items-center gap-2">{document?.documentUrl && <a className="min-h-9 rounded-lg px-2 py-2 text-[10px] font-semibold text-indigo-700 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600" href={document.documentUrl} target="_blank" rel="noreferrer">官方原文</a>}<button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)} className="min-h-9 rounded-lg bg-slate-900 px-3 py-2 text-[10px] font-semibold text-white hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600">{expanded ? '收起分部' : `展开分部（${sets.length} 类）`}</button></div></div>{expanded && <div className="mt-3 space-y-3">{sets.map((set, index) => { const items = asList(set?.items); const top = Math.max(...items.map((item) => Number(item?.revenueShare || 0)), 0); const pages = asList(set?.pageNumbers).length ? asList(set?.pageNumbers).join('、') : set?.pageNumber || '--'; const complete = set?.disclosureScope === 'complete_revenue_composition'; const mainItems = items.filter((item) => item?.businessGroup !== 'other_business'); const otherItems = items.filter((item) => item?.businessGroup === 'other_business'); return <article className="rounded-xl border border-slate-200 bg-slate-50/60 p-3" key={`${set?.dimension}-${set?.pageNumber}-${index}`}><div className="flex items-start justify-between gap-3"><div><h4 className="text-[11px] font-bold text-slate-900">{labels[String(set?.dimension)] || String(set?.dimension || '经营分部')}</h4><p className="mt-1 text-[10px] text-slate-600">原文第 {pages} 页 · {set?.status === 'available' ? complete ? '完整营业收入构成' : '仅披露占比达 10% 以上项目' : '仅原文证据'}</p></div>{set?.concentration?.top1RevenueShare != null && <span className="rounded-md bg-white px-2 py-1 text-[9px] font-medium text-slate-700">最大分部 {((Number(set.concentration.top1RevenueShare) || 0) * 100).toFixed(1)}%</span>}</div>{items.length ? set?.dimension === 'product' ? <div className="mt-3 space-y-4"><section><p className="mb-2 text-[10px] font-bold text-slate-700">主营业务</p><SegmentRows items={mainItems} top={top} complete={complete} /></section>{otherItems.length > 0 && <section className="border-t border-slate-200 pt-3"><p className="mb-2 text-[10px] font-bold text-slate-700">其他业务</p><SegmentRows items={otherItems} top={top} complete={complete} /></section>}</div> : <div className="mt-3"><SegmentRows items={items} top={top} complete={complete} /></div> : <p className="mt-3 text-[10px] leading-relaxed text-slate-600">{set?.dataGap || '该章节已定位，但未得到可可靠计算的结构化表格。请以官方原文为准。'}</p>}</article>; })}</div>}</section>;
}

function formatPrice(value: any) {
  return hasNumber(value) ? Number(value).toFixed(2) : '--';
}

function CandleChart({ bars, keyLevels }: { bars: any[]; keyLevels: any }) {
  const candles = asList(bars).filter((bar) => [bar?.open, bar?.high, bar?.low, bar?.close].every((value) => Number.isFinite(Number(value)))).slice(-30);
  if (candles.length < 8) return <Empty>最近日线数量不足，暂不绘制 K 线图。</Empty>;
  const levels = [
    { name: '20日支撑', value: keyLevels?.range?.low20d, color: '#0284c7' },
    { name: '60日压力', value: keyLevels?.range?.high60d, color: '#a855f7' },
    { name: 'MA20', value: keyLevels?.movingAverages?.ma20, color: '#f59e0b' },
    { name: 'MA50', value: keyLevels?.movingAverages?.ma50, color: '#64748b' },
  ].filter((item) => Number.isFinite(Number(item.value)));
  const allValues = [...candles.flatMap((bar) => [Number(bar.high), Number(bar.low)]), ...levels.map((item) => Number(item.value))];
  const min = Math.min(...allValues); const max = Math.max(...allValues); const span = Math.max(max - min, max * 0.015, 0.01);
  const chartTop = 14; const chartBottom = 148; const width = 320; const innerWidth = 292;
  const y = (value: number) => chartBottom - ((value - min) / span) * (chartBottom - chartTop);
  const x = (index: number) => 14 + (innerWidth * index) / Math.max(candles.length - 1, 1);
  const bodyWidth = Math.max(3, Math.min(7, innerWidth / candles.length * 0.55));
  const latestClose = Number(candles.at(-1)?.close);
  return <section className="rounded-xl border border-slate-200 bg-white p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-[11px] font-bold text-slate-800">近 30 日 K 线与关键位</h3><p className="mt-1 text-[9px] leading-relaxed text-slate-600">红：收涨；绿：收跌。虚线为程序计算的参考位，不是买卖指令。</p></div><div className="text-right"><p className="font-mono text-sm font-bold text-slate-950">收盘 {formatPrice(latestClose)}</p><span className="text-[9px] text-slate-500">{String(candles[0]?.date || '').slice(5)} — {String(candles.at(-1)?.date || '').slice(5)}</span></div></div><div className="mt-3 overflow-x-auto"><svg viewBox="0 0 320 170" className="h-44 min-w-[320px] w-full" role="img" aria-label="最近三十个交易日的真实 K 线和关键价格参考位"><rect x="0" y="0" width="320" height="170" fill="#ffffff" />{[0, 0.5, 1].map((ratio) => <line key={ratio} x1="14" x2="306" y1={chartTop + (chartBottom - chartTop) * ratio} y2={chartTop + (chartBottom - chartTop) * ratio} stroke="#e2e8f0" strokeWidth="1" />)}{levels.map((level) => <g key={level.name}><line x1="14" x2="306" y1={y(Number(level.value))} y2={y(Number(level.value))} stroke={level.color} strokeWidth="1" strokeDasharray="4 3" /><text x="307" y={y(Number(level.value)) + 3} fill={level.color} fontSize="8" textAnchor="end">{level.name}</text></g>)}<line x1="14" x2="306" y1={y(latestClose)} y2={y(latestClose)} stroke="#0f172a" strokeWidth="1.25" /><text x="14" y={y(latestClose) - 3} fill="#0f172a" fontSize="8">现价</text>{candles.map((bar, index) => { const open = Number(bar.open); const close = Number(bar.close); const rising = close >= open; const color = rising ? '#ef4444' : '#10b981'; const center = x(index); const top = y(Math.max(open, close)); const height = Math.max(1.5, Math.abs(y(open) - y(close))); return <g key={`${bar.date}-${index}`}><line x1={center} x2={center} y1={y(Number(bar.high))} y2={y(Number(bar.low))} stroke={color} strokeWidth="1" /><rect x={center - bodyWidth / 2} y={top} width={bodyWidth} height={height} fill={color} rx="0.5" /></g>; })}<text x="14" y="163" fill="#64748b" fontSize="8">{String(candles[0]?.date || '').slice(5)}</text><text x="306" y="163" fill="#64748b" fontSize="8" textAnchor="end">{String(candles.at(-1)?.date || '').slice(5)}</text></svg></div><div className="mt-2 flex flex-wrap gap-1.5">{levels.map((level) => <span className="rounded-md bg-slate-100 px-2 py-1 text-[9px] font-medium text-slate-700" key={level.name}>{level.name} {formatPrice(level.value)}</span>)}</div></section>;
}

function TechnicalRiskMetrics({ riskSignal, thresholds }: { riskSignal: any; thresholds: any }) {
  const values = riskSignal?.values || {};
  const rows = [
    { key: 'atrPercentOfPrice', label: 'ATR / 股价', current: values.atrPercentOfPrice, threshold: thresholds?.atrPercentOfPrice, risk: (value: number, limit: number) => value >= limit },
    { key: 'volatilityPercentile1y', label: '波动率一年分位', current: values.volatilityPercentile1y, threshold: thresholds?.volatilityPercentile1y, risk: (value: number, limit: number) => value >= limit },
    { key: 'maxDrawdown20d', label: '20 日最大回撤', current: values.maxDrawdown20d, threshold: thresholds?.maxDrawdown20d, risk: (value: number, limit: number) => value <= limit },
    { key: 'maxDrawdown60d', label: '60 日最大回撤', current: values.maxDrawdown60d, threshold: thresholds?.maxDrawdown60d, risk: (value: number, limit: number) => value <= limit },
  ].filter((item) => hasNumber(item.current));
  if (!rows.length) return <Empty>ATR、波动率或回撤数值未随本次快照返回。</Empty>;
  return <section className="rounded-xl border border-slate-200 bg-white p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-[11px] font-bold text-slate-800">波动与回撤风险</h3><p className="mt-1 text-[9px] leading-relaxed text-slate-600">只有当前值达到阈值，才标为“已触发”。</p></div><span className={`rounded-md px-2 py-1 text-[9px] font-semibold ${riskSignal?.status === 'risk' ? 'bg-rose-100 text-rose-900' : 'bg-emerald-50 text-emerald-800'}`}>{riskSignal?.status === 'risk' ? '存在触发项' : '未触发'}</span></div><div className="mt-3 grid gap-2 sm:grid-cols-2">{rows.map((item) => { const triggered = hasNumber(item.threshold) && item.risk(Number(item.current), Number(item.threshold)); return <div className={`rounded-lg border px-3 py-2 ${triggered ? 'border-rose-300 bg-rose-50' : 'border-slate-200 bg-slate-50/60'}`} key={item.key}><div className="flex items-baseline justify-between gap-2"><span className="text-[10px] font-semibold text-slate-800">{item.label}</span><b className={triggered ? 'font-mono text-sm text-rose-900' : 'font-mono text-sm text-slate-950'}>{(Number(item.current) * 100).toFixed(1)}%</b></div><p className="mt-1 text-[9px] leading-relaxed text-slate-600">阈值 {hasNumber(item.threshold) ? `${(Number(item.threshold) * 100).toFixed(1)}%` : '未返回'} · {triggered ? '已触发，趋势信号降权' : '未触发'}</p></div>; })}</div></section>;
}

function TechnicalLevels({ keyLevels, rules, latestClose }: { keyLevels: any; rules: any[]; latestClose: any }) {
  const rule = (id: string) => rules.find((item) => item?.ruleId === id);
  const levels = [
    { name: '20 日支撑', value: keyLevels?.range?.low20d, rule: rule('support20d_two_day_volume_break'), note: '接近或跌破时，需再看日线和量能。' },
    { name: '60 日压力', value: keyLevels?.range?.high60d, rule: null, note: '向上突破后仍需后续日线确认。' },
    { name: 'MA50 失效参考位', value: keyLevels?.invalidationLevels?.ma50, rule: rule('ma50_two_day_volume_break'), note: '连续两日跌破且放量才触发。' },
    { name: '20 日支撑失效位', value: keyLevels?.invalidationLevels?.low20d, rule: rule('support20d_two_day_volume_break'), note: '连续两日跌破且放量才触发。' },
  ].filter((item) => hasNumber(item.value));
  return <section><div className="mb-2 flex items-center justify-between gap-2"><div><h3 className="text-[11px] font-bold text-slate-800">关键位与结构条件</h3><p className="mt-1 text-[9px] leading-relaxed text-slate-600">关键位是观察坐标，不是止盈止损指令。</p></div><span className="font-mono text-[10px] text-slate-600">现价 {formatPrice(latestClose)}</span></div>{levels.length ? <div className="space-y-2">{levels.map((item) => { const distance = hasNumber(latestClose) ? (Number(latestClose) / Number(item.value) - 1) : null; const triggered = item.rule?.triggered === true; const days = item.rule?.values?.consecutiveDays; const volume = item.rule?.values?.volumeConfirmed; return <div className={`rounded-lg border px-3 py-2 ${triggered ? 'border-rose-300 bg-rose-50' : 'border-slate-200 bg-white'}`} key={item.name}><div className="flex items-baseline justify-between gap-3"><span className={`text-[10px] font-semibold ${triggered ? 'text-rose-900' : 'text-slate-800'}`}>{item.name}{triggered && ' · 已触发'}</span><b className={`font-mono text-sm ${triggered ? 'text-rose-900' : 'text-slate-950'}`}>{formatPrice(item.value)}</b></div><p className={`mt-1 text-[9px] leading-relaxed ${triggered ? 'font-semibold text-rose-900' : 'text-slate-600'}`}>现价距离 {distance === null ? '--' : `${distance >= 0 ? '+' : ''}${(distance * 100).toFixed(1)}%`} · {triggered ? `已连续 ${days ?? '--'} 日跌破，放量确认：${volume ? '是' : '否'}` : item.note}</p></div>; })}</div> : <Empty>关键位数据暂不可用。</Empty>}</section>;
}

function Fundamental({ data, gaps, evidence, counter, agentMeta }: any) {
  const signals = asList(data?.signals); const positive = signals.filter((item) => ['positive', 'stable'].includes(item?.status)); const negative = [...signals.filter((item) => ['deteriorating', 'risk', 'mixed'].includes(item?.status)), ...asList(data?.vetoes).filter((item) => item?.triggered)];
  const conclusion = deterministicConclusion('基本面', positive, negative, '基本面尚未形成足够的确定性结论。');
  return <ModuleFrame conclusion={conclusion} why={signals} support={positive} counter={negative} gaps={gaps} data={data} evidence={evidence} agentMeta={agentMeta}><FinancialTrendQuality quality={data?.financialTrends?.quality} /><FinancialFiveYearTrends trends={data?.financialTrends} /><FinancialTrend trends={data?.financialTrends} /><FinancialQuality calculations={data?.financialCalculations} template={data?.template} trends={data?.financialTrends} /><BusinessSegments snapshot={data?.businessSegments} />{asList(data?.vetoes).filter((item) => item?.triggered).length > 0 && <section><h3 className="mb-2 text-[11px] font-bold text-rose-900">基本面否决项</h3><BulletList items={asList(data?.vetoes).filter((item) => item?.triggered)} tone="negative" empty="" /></section>}</ModuleFrame>;
}

function TechnicalIndicatorTags({ tags }: { tags: any }) {
  if (!tags) return null;
  const stageLabels: Record<string, string> = { stage1_base: 'Stage 1 底部', stage2_advancing: 'Stage 2 上升', stage3_top: 'Stage 3 顶部', stage4_declining: 'Stage 4 下降', unknown: '阶段待确认' };
  const stageTones: Record<string, string> = { stage1_base: 'border-amber-300 bg-amber-50 text-amber-900', stage2_advancing: 'border-emerald-300 bg-emerald-50 text-emerald-900', stage3_top: 'border-rose-300 bg-rose-50 text-rose-900', stage4_declining: 'border-red-400 bg-red-50 text-red-900', unknown: 'border-slate-300 bg-slate-100 text-slate-700' };
  const maLabels: Record<string, string> = { bullish: 'MA 多头', bearish: 'MA 空头', mixed: 'MA 非多头' };
  const maTones: Record<string, string> = { bullish: 'border-emerald-300 bg-emerald-50 text-emerald-900', bearish: 'border-rose-300 bg-rose-50 text-rose-900', mixed: 'border-slate-300 bg-slate-100 text-slate-700' };
  const macdLabel = tags.macdPosition === 'above_zero' ? 'MACD 水上' : 'MACD 水下';
  const macdTone = tags.macdPosition === 'above_zero' ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-rose-300 bg-rose-50 text-rose-900';
  const obvLabels: Record<string, string> = { rising: 'OBV↑', falling: 'OBV↓', flat: 'OBV→' };
  const obvTones: Record<string, string> = { rising: 'border-emerald-300 bg-emerald-50 text-emerald-900', falling: 'border-rose-300 bg-rose-50 text-rose-900', flat: 'border-slate-300 bg-slate-100 text-slate-700' };
  const items: Array<{ label: string; tone: string }> = [
    { label: stageLabels[tags.weinsteinStage] || stageLabels.unknown, tone: stageTones[tags.weinsteinStage] || stageTones.unknown },
    { label: maLabels[tags.maAlignment] || 'MA 待确认', tone: maTones[tags.maAlignment] || maTones.mixed },
    { label: macdLabel, tone: macdTone },
  ];
  if (tags.rsi14 !== null && tags.rsi14 !== undefined) {
    const rsiVal = Math.round(Number(tags.rsi14));
    const rsiTone = rsiVal >= 70 ? 'border-rose-300 bg-rose-50 text-rose-900' : rsiVal <= 30 ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-slate-300 bg-slate-100 text-slate-700';
    items.push({ label: `RSI ${rsiVal}`, tone: rsiTone });
  }
  if (tags.kdjJ !== null && tags.kdjJ !== undefined) {
    const jVal = Math.round(Number(tags.kdjJ));
    const kdjTone = jVal >= 80 ? 'border-rose-300 bg-rose-50 text-rose-900' : jVal <= 20 ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-slate-300 bg-slate-100 text-slate-700';
    items.push({ label: `KDJ-J ${jVal}`, tone: kdjTone });
  }
  if (tags.williamsR !== null && tags.williamsR !== undefined) {
    const wrVal = Math.round(Number(tags.williamsR));
    const wrTone = wrVal >= -20 ? 'border-rose-300 bg-rose-50 text-rose-900' : wrVal <= -80 ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-slate-300 bg-slate-100 text-slate-700';
    items.push({ label: `W%R ${wrVal}`, tone: wrTone });
  }
  items.push({ label: obvLabels[tags.obvTrend] || 'OBV→', tone: obvTones[tags.obvTrend] || obvTones.flat });
  if (tags.ytdReturn !== null && tags.ytdReturn !== undefined) {
    const ytd = Number(tags.ytdReturn);
    const ytdTone = ytd > 0 ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : ytd < -0.1 ? 'border-rose-300 bg-rose-50 text-rose-900' : 'border-slate-300 bg-slate-100 text-slate-700';
    items.push({ label: `YTD ${(ytd * 100).toFixed(1)}%`, tone: ytdTone });
  }
  return <section className="rounded-xl border border-slate-200 bg-white p-3"><h3 className="text-[11px] font-bold text-slate-800">技术状态总览</h3><p className="mt-1 text-[9px] leading-relaxed text-slate-600">标签由程序确定性计算，不含预测成分：阶段看 MA150 价格位置与斜率，MA 看均线趋势，MACD 看柱体零轴，RSI/KDJ/W%R 看超买超卖区间，OBV 看量价累积，YTD 看年内收益。</p><div className="mt-2.5 flex flex-wrap gap-1.5">{items.map((item) => <span className={`rounded-md border px-2 py-1 text-[10px] font-semibold ${item.tone}`} key={item.label}>{item.label}</span>)}</div></section>;
}

function Technical({ data, gaps, evidence, counter, agentMeta }: any) {
  const signals = asList(data?.signals); const invalidations = asList(data?.structureInvalidation?.rules).filter((item) => item?.triggered); const riskSignal = signals.find((item) => item?.signalId === 'risk'); const latestClose = asList(data?.chartBars).at(-1)?.close; const positive = signals.filter((item) => item?.status === 'positive'); const negative = [...signals.filter((item) => ['negative', 'risk', 'deteriorating', 'mixed'].includes(item?.status)), ...invalidations];
  const conclusion = deterministicConclusion('技术与市场', positive, negative, '技术与市场信号暂未形成明确方向。');
  return <ModuleFrame conclusion={conclusion} why={signals} support={positive} counter={negative} gaps={gaps} data={data} evidence={evidence} agentMeta={agentMeta}><><TechnicalIndicatorTags tags={data?.indicatorTags} /><CandleChart bars={data?.chartBars} keyLevels={data?.keyLevels} /><TechnicalRiskMetrics riskSignal={riskSignal} thresholds={data?.riskThresholds} /><TechnicalLevels keyLevels={data?.keyLevels} rules={asList(data?.structureInvalidation?.rules)} latestClose={latestClose} />{invalidations.length > 0 && <section className="rounded-xl border border-rose-200 bg-rose-50 p-3"><h3 className="flex items-center gap-1.5 text-[11px] font-bold text-rose-900"><CircleAlert className="h-3.5 w-3.5" />已触发的结构失效条件</h3><BulletList items={invalidations} tone="negative" empty="" /></section>}</></ModuleFrame>;
}

function EventBadge({ children, tone = 'slate' }: { children: React.ReactNode; tone?: 'slate' | 'emerald' | 'rose' | 'amber' | 'indigo' }) {
  const tones = { slate: 'bg-slate-100 text-slate-700', emerald: 'bg-emerald-50 text-emerald-800', rose: 'bg-rose-50 text-rose-800', amber: 'bg-amber-50 text-amber-900', indigo: 'bg-indigo-50 text-indigo-800' };
  return <span className={`rounded-md px-1.5 py-1 text-[9px] font-medium ${tones[tone]}`}>{children}</span>;
}

function FactChainTimeline({ chains, nodes }: { chains: any[]; nodes: any[] }) {
  const [showRoutine, setShowRoutine] = useState(false);
  const sorted = chains.slice().sort((left, right) => Number(right?.materiality?.score || 0) - Number(left?.materiality?.score || 0) || String(right?.lastPublishedAt || '').localeCompare(String(left?.lastPublishedAt || '')));
  const nonRoutine = sorted.filter((chain) => !chain?.isRoutine && !chain?.materiality?.isRoutine);
  const routine = sorted.filter((chain) => chain?.isRoutine || chain?.materiality?.isRoutine);
  const visible = [...nonRoutine.slice(0, 6), ...(showRoutine ? routine.slice(0, 6) : [])];
  const nodeTone = (node: any) => node?.role === 'clarification' ? 'rose' : node?.role === 'official' ? 'indigo' : node?.role === 'rumor' ? 'amber' : 'slate';
  return <section className="rounded-xl border border-slate-200 bg-white p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-[11px] font-bold text-slate-800">事件事实链</h3><p className="mt-1 text-[9px] leading-relaxed text-slate-600">将传闻、媒体、公告、澄清和进展串为一条链；同源重复不会重复计入。</p></div><span className="text-[9px] text-slate-500">重点 {nonRoutine.length} 条 · 例行 {routine.length} 条</span></div>{visible.length ? <ol className="mt-3 space-y-3">{visible.map((chain: any) => { const chainNodes = nodes.filter((node) => node?.chainId === chain?.chainId).slice().sort((left, right) => String(left?.publishedAt || '').localeCompare(String(right?.publishedAt || ''))); const materiality = chain?.materiality || {}; return <li className="rounded-lg border border-slate-200 bg-slate-50/70 p-3" key={chain.chainId}><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0 flex-1"><p className="text-[10px] font-semibold leading-relaxed text-slate-900">{chain.headline || '未命名事件链'}</p><p className="mt-1 text-[9px] text-slate-600">{dateText(chain.firstPublishedAt)} 至 {dateText(chain.lastPublishedAt)} · {chain.nodeCount || chainNodes.length} 个节点 · {chain.sourceCount || 0} 个来源</p></div><div className="flex flex-wrap gap-1"><EventBadge tone={materiality.level === 'high' ? 'rose' : materiality.level === 'medium' ? 'amber' : 'slate'}>重要性：{text(materiality.level, '低')} {materiality.score ?? '--'}</EventBadge><EventBadge tone={chain.factStatus?.startsWith('official') ? 'indigo' : 'amber'}>{text(chain.factStatus, '未核验')}</EventBadge></div></div><div className="mt-2 flex flex-wrap gap-1.5"><EventBadge>{text(chain.lifecycleState, '未标注')}</EventBadge>{chain.propagation?.sameSourceRepeatCount > 0 && <EventBadge tone="amber">已合并同源重复 {chain.propagation.sameSourceRepeatCount} 条</EventBadge>}{(chain.isRoutine || materiality.isRoutine) && <EventBadge>例行公告，已降权</EventBadge>}</div><ol className="mt-3 space-y-2 border-l border-slate-200 pl-3">{chainNodes.slice(0, 6).map((node: any, index: number) => <li className="relative" key={node.nodeId || index}><span className="absolute -left-[17px] top-1.5 h-2 w-2 rounded-full bg-slate-400" /><div className="flex flex-wrap items-start gap-x-2 gap-y-1"><span className="text-[9px] text-slate-500">{dateText(node.publishedAt)}</span><EventBadge tone={nodeTone(node)}>{text(node.relationType, '来源')}</EventBadge><span className={`text-[9px] leading-relaxed ${node.superseded ? 'line-through text-slate-400' : 'text-slate-700'}`}>{node.title}</span></div></li>)}</ol></li>; })}</ol> : <Empty>暂无可串联的事件事实链。</Empty>}{routine.length > 0 && <button type="button" aria-expanded={showRoutine} onClick={() => setShowRoutine((value) => !value)} className="mt-3 min-h-9 rounded-lg border border-slate-300 bg-white px-3 py-2 text-[10px] font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600">{showRoutine ? '收起例行公告' : `查看已降权例行公告（${routine.length}）`}</button>}</section>;
}

function Events({ data, gaps, evidence, counter, agentMeta }: any) {
  const events = asList(data?.events).sort((a, b) => String(b?.publishedAt || b?.date || '').localeCompare(String(a?.publishedAt || a?.date || '')));
  const positive = events.filter((item) => item?.direction === 'positive'); const negative = events.filter((item) => item?.direction === 'negative');
  const officialCount = events.filter((item) => ['official_verified', 'official_document_only'].includes(item?.verification)).length;
  const activeCount = events.filter((item) => !['expired', 'settled'].includes(item?.status)).length;
  const conclusion = deterministicConclusion('事件面', positive, negative, '当前窗口内没有可展示的有效事件。');
  const directionTone = (value: any) => value === 'positive' ? 'emerald' : value === 'negative' ? 'rose' : value === 'mixed' || value === 'unknown' ? 'amber' : 'slate';
  return <ModuleFrame conclusion={conclusion} why={events} support={positive} counter={negative} gaps={gaps} data={data} evidence={evidence} agentMeta={agentMeta}><section className="space-y-3"><div className="flex flex-wrap items-end justify-between gap-2"><div><h3 className="text-[11px] font-bold text-slate-800">事件时间线</h3><p className="mt-1 text-[10px] leading-relaxed text-slate-600">按重大性优先、披露日期次之排序；例行公告降权但仍可展开核对。</p></div><span className="text-[10px] text-slate-500">近窗口 {events.length} 项</span></div>{events.length ? <><div className="grid grid-cols-3 overflow-hidden rounded-xl border border-slate-200 bg-slate-200"><div className="bg-white p-2.5"><p className="text-[9px] text-slate-500">官方核验</p><p className="mt-1 font-mono text-sm font-bold text-slate-900">{officialCount}</p></div><div className="bg-white p-2.5"><p className="text-[9px] text-slate-500">仍在跟踪</p><p className="mt-1 font-mono text-sm font-bold text-slate-900">{activeCount}</p></div><div className="bg-white p-2.5"><p className="text-[9px] text-slate-500">高重要性</p><p className="mt-1 font-mono text-sm font-bold text-slate-900">{events.filter((item) => item?.materiality?.level === 'high').length}</p></div></div><ol className="relative ml-2 border-l border-slate-200">{events.slice(0, 10).map((event, index) => { const pathways = asList(event?.pathways); const verificationPlan = asList(event?.verificationPlan); const counterEvidence = asList(event?.counterEvidence); const hasSecondStage = pathways.length || verificationPlan.length || counterEvidence.length || event?.materiality; return <li className="relative pb-4 pl-4 last:pb-0" key={event?.eventId || index}><span className={`absolute -left-[5px] top-4 h-2 w-2 rounded-full ${event?.direction === 'positive' ? 'bg-emerald-500' : event?.direction === 'negative' ? 'bg-rose-500' : 'bg-amber-500'}`} /><article className="rounded-xl border border-slate-200 bg-white p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0 flex-1"><p className="text-[10px] text-slate-500">{dateText(event?.publishedAt || event?.date)}</p><h4 className="mt-1 text-[11px] font-semibold leading-relaxed text-slate-900">{researchItemText(event)}</h4></div>{event?.sourceUrl && <a className="min-h-8 shrink-0 rounded-lg bg-slate-100 px-2.5 py-2 text-[10px] font-semibold text-slate-700 hover:bg-slate-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600" href={event.sourceUrl} target="_blank" rel="noreferrer">查看原文</a>}</div><div className="mt-2 flex flex-wrap gap-1.5"><EventBadge tone={directionTone(event?.direction)}>方向：{text(event?.direction, '待评估')}</EventBadge><EventBadge tone={event?.verification?.startsWith('official') ? 'indigo' : 'amber'}>核验：{text(event?.verification, '未标注')}</EventBadge><EventBadge>范围：{text(event?.impactScope, '未标注')}</EventBadge><EventBadge>期限：{text(event?.impactHorizon, '未标注')}</EventBadge><EventBadge tone="slate">状态：{text(event?.status, '未标注')}</EventBadge><EventBadge tone={event?.materiality?.level === 'high' ? 'rose' : event?.materiality?.level === 'medium' ? 'amber' : 'slate'}>重要性：{text(event?.materiality?.level, '低')} {event?.materiality?.score ?? '--'}</EventBadge>{event?.isRoutine && <EventBadge>例行已降权</EventBadge>}</div>{event?.summary && event.summary !== event.title && <p className="mt-2 text-[10px] leading-relaxed text-slate-600">{event.summary}</p>}{event?.materiality?.reasons?.length > 0 && <p className="mt-2 text-[9px] leading-relaxed text-slate-500">评分依据：{event.materiality.reasons.join('；')}</p>}{pathways.length > 0 && <div className="mt-3 border-t border-slate-100 pt-2"><p className="text-[10px] font-bold text-slate-700">影响路径</p><ul className="mt-1.5 space-y-1">{pathways.slice(0, 3).map((pathway, pathwayIndex) => <li className="text-[10px] leading-relaxed text-slate-700" key={`${pathway?.dimension}-${pathwayIndex}`}>{text(pathway?.dimension)}：{pathway?.mechanism || text(pathway?.direction)}</li>)}</ul></div>}{verificationPlan.length > 0 && <div className="mt-3 border-t border-slate-100 pt-2"><p className="text-[10px] font-bold text-slate-700">待验证指标</p><ul className="mt-1.5 space-y-1">{verificationPlan.slice(0, 3).map((item, planIndex) => <li className="text-[10px] leading-relaxed text-slate-700" key={`${item?.metric}-${planIndex}`}>{item?.metric || researchItemText(item)}{item?.expectedWindow ? ` · ${item.expectedWindow}` : ''}</li>)}</ul></div>}{counterEvidence.length > 0 && <div className="mt-3 border-t border-slate-100 pt-2"><p className="text-[10px] font-bold text-rose-800">反方与失效条件</p><BulletList items={counterEvidence.slice(0, 3)} tone="negative" empty="" /></div>}{!hasSecondStage && <p className="mt-3 border-t border-slate-100 pt-2 text-[9px] leading-relaxed text-slate-500">当前仅展示可核验的事件事实与其确定性评分。</p>}</article></li>; })}</ol><FactChainTimeline chains={asList(data?.factChains)} nodes={asList(data?.factNodes)} /></> : <Empty>没有事件，因此没有绘制时间线。</Empty>}</section></ModuleFrame>;
}

function Industry({ data, gaps, evidence, counter, agentMeta }: any) {
  const industry = data?.industry || {};
  const financial = data?.financialPosition || {};
  const metrics = asList(financial?.metrics).filter((item) => item?.status === 'available').slice(0, 6);
  const mappings = asList(data?.chain?.mappings);
  const events = asList(data?.events).slice(0, 4);
  const positive = metrics.filter((item) => item?.position === 'upper_quartile').map((item) => ({ text: `${item.label}处于行业较高分位`, evidenceIds: [] }));
  const negative = metrics.filter((item) => item?.position === 'lower_quartile').map((item) => ({ text: `${item.label}处于行业较低分位`, evidenceIds: [] }));
  const conclusion = industry?.name ? `${industry.name}：行业位置、产业链映射与事件线索按冻结快照展示。` : '尚未形成可核验的行业归属与产业链快照。';
  const metricText = (metric: any) => hasNumber(metric?.percentile) ? `${(Number(metric.percentile) * 100).toFixed(0)}%` : '--';
  return <ModuleFrame conclusion={conclusion} why={metrics.map((item) => ({ text: `${item.label}：行业分位 ${metricText(item)}，样本 ${item.sampleSize || '--'} 家` }))} support={positive} counter={[...negative, ...counter]} gaps={gaps} data={data} evidence={evidence} agentMeta={agentMeta}>
    <section className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-[11px] font-bold text-slate-800">行业位置</h3><p className="mt-1 text-[10px] leading-relaxed text-slate-600">报告期 {financial?.period || '未标注'} · 行业成员 {industry?.memberCount || '--'} 家</p></div><span className="rounded-md bg-slate-100 px-2 py-1 text-[9px] font-medium text-slate-700">财务样本：{text(data?.dataQuality?.financialSample, '未标注')}</span></div>
      {metrics.length ? <div className="mt-3 space-y-3">{metrics.map((metric) => { const percentile = Math.max(0, Math.min(100, Number(metric.percentile) * 100)); return <div key={metric.key}><div className="flex items-baseline justify-between gap-2 text-[10px]"><span className="font-semibold text-slate-800">{metric.label}</span><span className="font-mono text-slate-900">{metricText(metric)} · {text(metric.position)}</span></div><div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${metric.position === 'upper_quartile' ? 'bg-emerald-600' : metric.position === 'lower_quartile' ? 'bg-rose-500' : 'bg-indigo-600'}`} style={{ width: `${percentile}%` }} /></div><p className="mt-1 text-[9px] text-slate-500">公司 {hasNumber(metric.value) ? (Number(metric.value) * 100).toFixed(1) + '%' : '--'} · 行业中位数 {hasNumber(metric.median) ? (Number(metric.median) * 100).toFixed(1) + '%' : '--'} · 样本 {metric.sampleSize || '--'} 家</p></div>; })}</div> : <Empty>行业财务分位样本不足，暂不展示分位刻度。</Empty>}
    </section>
    <section className="rounded-xl border border-slate-200 bg-white p-3"><div><h3 className="text-[11px] font-bold text-slate-800">产业链传导</h3><p className="mt-1 text-[10px] leading-relaxed text-slate-600">上游、公司和下游是业务映射，不等同于已验证的收入或成本变化。</p></div>{mappings.length ? <div className="mt-3 space-y-3">{mappings.map((mapping) => <article className="rounded-lg bg-slate-50 p-3" key={mapping.ruleId}><p className="text-[10px] font-bold text-slate-900">{mapping.label}</p><div className="mt-3 grid gap-2 sm:grid-cols-3"><div className="rounded-md bg-white p-2"><p className="text-[9px] font-bold text-slate-500">上游</p><p className="mt-1 text-[10px] leading-relaxed text-slate-800">{asList(mapping.upstream).map((item) => item?.name).filter(Boolean).join('、') || '--'}</p></div><div className="rounded-md border border-indigo-200 bg-indigo-50 p-2"><p className="text-[9px] font-bold text-indigo-700">本公司业务映射</p><p className="mt-1 text-[10px] font-semibold leading-relaxed text-indigo-950">{asList(mapping.matchedKeywords).join('、') || mapping.label}</p></div><div className="rounded-md bg-white p-2"><p className="text-[9px] font-bold text-slate-500">下游</p><p className="mt-1 text-[10px] leading-relaxed text-slate-800">{asList(mapping.downstream).map((item) => item?.name).filter(Boolean).join('、') || '--'}</p></div></div>{asList(mapping?.chainData?.indicators).length ? <div className="mt-2 flex flex-wrap gap-1.5">{asList(mapping.chainData.indicators).slice(0, 4).map((item) => <span className="rounded-md bg-white px-2 py-1 text-[9px] text-slate-700" key={item.key || item.label}>{item.label}：{item.value ?? '--'} {item.unit || ''}</span>)}</div> : <p className="mt-2 text-[9px] leading-relaxed text-amber-800">该链条尚无稳定、口径明确的实时指标，当前只展示业务映射。</p>}</article>)}</div> : <Empty>未命中高置信业务映射，暂不绘制产业链关系。</Empty>}</section>
    <section className="rounded-xl border border-slate-200 bg-white p-3"><div className="flex items-baseline justify-between gap-2"><div><h3 className="text-[11px] font-bold text-slate-800">行业与政策事件</h3><p className="mt-1 text-[9px] leading-relaxed text-slate-600">仅显示已匹配行业或业务关键词的事件簇；第三方消息需进一步核验传导路径。</p></div><span className="text-[9px] text-slate-500">{events.length} 个事件簇</span></div>{events.length ? <ol className="mt-3 space-y-2">{events.map((event) => <li className="rounded-lg bg-slate-50 px-3 py-2" key={event.eventId}><p className="text-[10px] font-semibold leading-relaxed text-slate-800">{event.title}</p><p className="mt-1 text-[9px] text-slate-600">{dateText(event.publishedAt)} · {text(event.impactScope)} · {text(event.direction)} · 聚合 {event.clusterSize || 1} 条</p></li>)}</ol> : <Empty>当前窗口没有命中行业或政策事件簇。</Empty>}</section>
  </ModuleFrame>;
}

function Sentiment({ data, gaps, evidence, counter, agentMeta }: any) {
  const metrics = data?.metrics || {};
  const viewpoint = data?.viewpoint || {};
  const community = viewpoint?.community || {};
  const media = viewpoint?.media || {};
  const clusters = asList(data?.contentClusters);
  const hotTopics = asList(data?.hotTopics);
  const marketContextTopics = asList(data?.marketContextHotTopics);
  const reactions = asList(data?.eventReactions);
  const viewpoints = asList(data?.viewpoints);
  const sourceItems = asList(data?.items);
  const directionalSources = sourceItems.filter((item: any) => ['positive', 'negative', 'mixed', 'neutral'].includes(String(item?.stance))).slice(0, 3);
  const evidenceById = new Map(asList(data?.items).map((item: any) => [String(item?.evidenceId || ''), item]));
  const viewpointLabels: Record<string, string> = { media: '媒体 / 研报', community: '社区讨论', policy: '政策口径', official: '官方披露' };
  const stanceTone: Record<string, string> = { positive: 'bg-emerald-50 text-emerald-800', negative: 'bg-rose-50 text-rose-800', mixed: 'bg-amber-50 text-amber-900', neutral: 'bg-slate-100 text-slate-700', unavailable: 'bg-slate-100 text-slate-600' };
  const viewpointStance = (value: any) => text(value, '暂不可判断');
  const overview = [
    ['关注度', text(data?.attention, '暂不可判断')],
    ['事实方向', text(data?.tone, '暂不可判断')],
    ['观点分歧', text(data?.communityViewpointDisagreement || data?.disagreement, '暂不可判断')],
    ['传播结构', text(data?.propagationQuality, '暂不可判断')],
  ];
  const percent = (value: any) => hasNumber(value) ? `${(Number(value) * 100).toFixed(0)}%` : '--';
  const disagreementDescription = (level: any) => ({
    high: '分歧较大：正负观点接近，不能把热度当成单一方向。',
    medium: '存在分歧：正负观点均有，需要继续观察新增内容。',
    low: '方向相对集中：不等于看多或看空，也不代表后续走势。',
    unavailable: '样本不足：可判方向内容不足，暂不下分歧结论。',
  }[String(level)] || '暂未取得足够样本。');
  const ViewpointPanel = ({ item, title }: { item: any; title: string }) => {
    const level = item?.level || 'unavailable';
    const levelTone = level === 'high' ? 'bg-amber-50 text-amber-900' : level === 'low' ? 'bg-emerald-50 text-emerald-900' : level === 'medium' ? 'bg-indigo-50 text-indigo-900' : 'bg-slate-100 text-slate-700';
    return <article className="rounded-lg bg-slate-50 px-3 py-2.5"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[10px] font-bold text-slate-800">{title}</p><span className={`rounded px-1.5 py-1 text-[9px] font-semibold ${levelTone}`}>分歧{text(level, '样本不足')}</span></div><p className="mt-1 text-[9px] leading-relaxed text-slate-600">{disagreementDescription(level)}</p><div className="mt-2 grid grid-cols-3 gap-2 text-center"><p className="rounded bg-white px-1 py-1.5 text-[9px] text-slate-700"><span className="block text-slate-500">正向</span><b className="font-mono text-slate-900">{percent(item?.directionalShares?.positive)}</b></p><p className="rounded bg-white px-1 py-1.5 text-[9px] text-slate-700"><span className="block text-slate-500">负向</span><b className="font-mono text-slate-900">{percent(item?.directionalShares?.negative)}</b></p><p className="rounded bg-white px-1 py-1.5 text-[9px] text-slate-700"><span className="block text-slate-500">可判样本</span><b className="font-mono text-slate-900">{item?.directionalSampleCount || 0} 条</b></p></div></article>;
  };
  const ViewpointCard = ({ item }: { item: any }) => {
    const source = evidenceById.get(String(item?.sourceEvidenceIds?.[0] || '')) || {};
    const sourceName = source?.platform || source?.source || viewpointLabels[item?.sourceLayer] || '来源未标注';
    return <article className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="rounded-md bg-indigo-50 px-2 py-1 text-[9px] font-semibold text-indigo-700">{viewpointLabels[item?.sourceLayer] || '来源观点'}</span><span className={`rounded-md px-2 py-1 text-[9px] font-semibold ${stanceTone[item?.stance] || stanceTone.unavailable}`}>{viewpointStance(item?.stance)}</span></div>
      <p className="mt-2 text-[11px] font-bold leading-relaxed text-slate-900">{item?.summary}</p>
      <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2"><p className="text-[9px] font-semibold text-slate-500">观点逻辑</p><p className="mt-1 text-[10px] leading-relaxed text-slate-700">{item?.mechanism || '来源未说明明确机制'}</p></div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] text-slate-500"><span>{sourceName}</span><span>·</span><span>{dateText(source?.publishedAt || source?.period)}</span>{source?.originalUrl || source?.sourceUrl ? <a className="text-indigo-700 underline underline-offset-2" href={source.originalUrl || source.sourceUrl} rel="noreferrer" target="_blank">查看原文</a> : null}</div>
      {item?.counterpoint && <p className="mt-2 text-[9px] leading-relaxed text-amber-800">边界：{item.counterpoint}</p>}
      <p className="mt-1 text-[9px] text-slate-500">{text(item?.verification, '来源状态未标注')} · {text(item?.timeHorizon, '时间范围未知')}</p>
    </article>;
  };
  const why = [
    { text: `已纳入 ${metrics.contentCount || 0} 条匹配内容、${metrics.contentClusterCount || 0} 个话题簇；独立来源 ${metrics.sourceCount || 0} 个。` },
    { text: `市场反应：${text(data?.eventReaction, '暂不可判断')}；当前可评估事件 ${metrics.eventReactionCount || 0} 项。` },
  ];
  const conclusion = data?.tone === 'unavailable'
    ? '当前没有足够的已匹配内容，暂不对市场讨论方向作判断。'
    : `当前市场讨论的事实方向为${text(data?.tone)}，社区观点分歧为${text(data?.communityViewpointDisagreement || data?.disagreement)}；需结合来源结构理解其可靠性。`;
  const aiInterpretation = data?.aiInterpretation || {};
  const aiStatus = aiInterpretation?.status || data?.sentimentAgentMeta?.aiStatus || 'pending';
  const aiCall = data?.sentimentAgentMeta?.ai || {};
  const aiNotice = aiInterpretation?.notice
    || (aiStatus === 'pending' ? 'AI 正在基于已完成的舆情事实生成摘要；方向、热度、聚类和分歧统计已可先查看。' : '');
  const aiTone = aiStatus === 'failed' || aiStatus === 'fallback'
    ? 'border-amber-200 bg-amber-50 text-amber-900'
    : aiStatus === 'partial'
      ? 'border-indigo-200 bg-indigo-50 text-indigo-900'
      : 'border-slate-200 bg-slate-50 text-slate-700';
  return <ModuleFrame conclusion={conclusion} why={why} support={[]} counter={counter} gaps={gaps} data={data} evidence={evidence} agentMeta={agentMeta}>
    <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">{overview.map(([name, value]) => <article className="rounded-lg border border-slate-200 bg-white p-3" key={name}><p className="text-[9px] font-medium text-slate-500">{name}</p><p className="mt-1 text-[11px] font-bold leading-snug text-slate-900">{value}</p></article>)}</section>
    {aiNotice && <section role="status" className={`rounded-xl border p-3 ${aiTone}`}><div className="flex flex-wrap items-baseline justify-between gap-2"><p className="text-[10px] font-bold">AI 观点摘要：{aiStatus === 'failed' || aiStatus === 'fallback' ? '本次未生成' : aiStatus === 'partial' ? '部分字段已由程序回退' : aiStatus === 'pending' ? '生成中' : '已生成'}</p>{Number.isFinite(Number(aiCall?.durationMs)) && <span className="text-[9px] opacity-75">模型 {aiCall.model || '--'} · {(Number(aiCall.durationMs) / 1000).toFixed(1)} 秒 · 第 {aiCall.attempts || 1} 次</span>}</div><p className="mt-1 text-[10px] leading-relaxed">{aiNotice}</p>{aiInterpretation?.failure?.stage && <p className="mt-1 text-[9px] opacity-75">失败阶段：{text(aiInterpretation.failure.stage, String(aiInterpretation.failure.stage))}</p>}</section>}
    <section className="rounded-xl border border-slate-200 bg-white p-3"><h3 className="text-[11px] font-bold text-slate-800">观点分歧怎么读？</h3><p className="mt-1 text-[9px] leading-relaxed text-slate-600">“高/中/低”描述正负观点是否一致，不是涨跌预测：高代表意见相左，低代表现有样本方向较集中。媒体观点和社区观点分别统计；公告事实不会被当作社区态度。</p><div className="mt-3 grid gap-2 sm:grid-cols-2"><ViewpointPanel item={media} title="媒体观点" /><ViewpointPanel item={community} title="社区观点" /></div></section>
    <section className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-3"><div className="flex flex-wrap items-baseline justify-between gap-2"><div><h3 className="text-[11px] font-bold text-slate-900">核心观点</h3><p className="mt-1 text-[9px] leading-relaxed text-slate-600">把来源的方向判断还原为可复述的观点和逻辑链；这不是系统对股价的预测。</p></div><span className="text-[9px] text-slate-500">{viewpoints.length} 条</span></div>{viewpoints.length ? <div className="mt-3 grid gap-2 lg:grid-cols-2">{viewpoints.slice(0, 8).map((item: any, index: number) => <ViewpointCard item={item} key={item.viewpointId || `${item.summary}-${index}`} />)}</div> : <div className="mt-3 space-y-2"><p className="rounded-lg bg-white/70 px-3 py-2 text-[10px] leading-relaxed text-slate-700">方向统计已有样本，但当前 AI 没有返回可核验的观点摘要；下面先列出方向判断所依据的原始内容，避免把“暂无摘要”误解为“没有观点”。</p>{directionalSources.length ? <ul className="divide-y divide-slate-100 rounded-lg bg-white/70 px-3">{directionalSources.map((item: any, index: number) => <li className="py-2 first:pt-0 last:pb-0" key={item.evidenceId || index}><p className="text-[10px] font-semibold leading-relaxed text-slate-800">{item.title || item.summary || '未命名来源'}</p><p className="mt-1 text-[9px] text-slate-500">方向：{text(item.stance, '待判断')} · {dateText(item.publishedAt)} · 来源原文可在下方话题区查看</p></li>)}</ul> : <Empty>当前暂无带有效证据的核心观点；可查看下方原始话题和来源。</Empty>}</div>}</section>
    <section className="rounded-xl border border-slate-200 bg-white p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-[11px] font-bold text-slate-800">跨平台热点</h3><p className="mt-1 max-w-2xl text-[9px] leading-relaxed text-slate-600">“本股命中”只显示直接提及股票名称或代码的内容；“市场背景”仅供理解当前财经环境，不能视为该股票的消息。</p></div><span className="rounded-md bg-slate-100 px-2 py-1 text-[9px] font-semibold text-slate-700">全网热榜来源：{metrics.healthyHotlistSourceCount || 0}/6 正常</span></div><div className="mt-3 grid gap-3 sm:grid-cols-2"><section><div className="flex items-baseline justify-between gap-2"><h4 className="text-[10px] font-bold text-slate-800">本股直接命中</h4><span className="text-[9px] text-slate-500">{metrics.hotTopicMatchCount || 0} 条</span></div>{hotTopics.length ? <ol className="mt-2 divide-y divide-slate-100">{hotTopics.slice(0, 4).map((topic: any, index: number) => <li className="py-2 first:pt-0 last:pb-0" key={topic.topicId || `${topic.source}-${index}`}><p className="break-words text-[10px] font-semibold leading-relaxed text-slate-800">{topic.url ? <a className="underline decoration-slate-300 underline-offset-2 hover:text-indigo-700 focus-visible:outline-2 focus-visible:outline-indigo-600" href={topic.url} rel="noreferrer" target="_blank">{topic.title}</a> : topic.title}</p><p className="mt-1 text-[9px] text-slate-500">{text(topic.source)}{topic.rank ? ` · 第 ${topic.rank} 位` : ''}{hasNumber(topic.heat) ? ` · 热度 ${Number(topic.heat).toLocaleString('zh-CN')}` : ''} · 待核验</p></li>)}</ol> : <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-[9px] leading-relaxed text-slate-600">当前热榜没有直接提到该股票；这不代表市场没有讨论，只是不把模糊关联硬算到本股。</p>}</section><section className="border-t border-slate-100 pt-3 sm:border-l sm:border-t-0 sm:pl-3 sm:pt-0"><div className="flex items-baseline justify-between gap-2"><h4 className="text-[10px] font-bold text-slate-800">财经市场背景</h4><span className="text-[9px] text-slate-500">{metrics.marketContextHotTopicCount || 0} 条</span></div>{marketContextTopics.length ? <ol className="mt-2 divide-y divide-slate-100">{marketContextTopics.slice(0, 4).map((topic: any, index: number) => <li className="py-2 first:pt-0 last:pb-0" key={topic.topicId || `${topic.source}-${index}`}><p className="break-words text-[10px] font-semibold leading-relaxed text-slate-800">{topic.url ? <a className="underline decoration-slate-300 underline-offset-2 hover:text-indigo-700 focus-visible:outline-2 focus-visible:outline-indigo-600" href={topic.url} rel="noreferrer" target="_blank">{topic.title}</a> : topic.title}</p><p className="mt-1 text-[9px] text-slate-500">{text(topic.source)}{topic.rank ? ` · 第 ${topic.rank} 位` : ''}{hasNumber(topic.heat) ? ` · 热度 ${Number(topic.heat).toLocaleString('zh-CN')}` : ''} · 非本股消息</p></li>)}</ol> : <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-[9px] leading-relaxed text-slate-600">本时段未筛到财经、行业或政策相关热榜。</p>}</section></div></section>
    <section className="rounded-xl border border-slate-200 bg-white p-3"><div className="flex items-baseline justify-between gap-2"><div><h3 className="text-[11px] font-bold text-slate-800">讨论话题</h3><p className="mt-1 text-[9px] leading-relaxed text-slate-600">按标题、类别与时间窗聚合；重复内容不会被当作多个独立事件。</p></div><span className="text-[9px] text-slate-500">{clusters.length} 个话题簇</span></div>{clusters.length ? <ol className="mt-3 space-y-2">{clusters.slice(0, 4).map((cluster: any) => <li className="rounded-lg bg-slate-50 px-3 py-2" key={cluster.clusterId}><p className="text-[10px] font-semibold leading-relaxed text-slate-800">{cluster.representativeTitle || '未命名话题'}</p><p className="mt-1 text-[9px] text-slate-600">{cluster.itemCount || 0} 条内容 · {cluster.sourceCount || 0} 个来源 · {text(cluster.verification, '未核验')}</p></li>)}</ol> : <Empty>暂无可通过实体匹配阈值的讨论话题。</Empty>}</section>
    <section className="rounded-xl border border-slate-200 bg-white p-3"><h3 className="text-[11px] font-bold text-slate-800">事件后反应</h3><p className="mt-1 text-[9px] leading-relaxed text-slate-600">只描述事件窗口内的行情状态；多个重叠事件时不能归因给某一条消息。</p>{reactions.length ? <ul className="mt-3 space-y-2">{reactions.slice(0, 4).map((reaction: any, index: number) => <li className="rounded-lg bg-slate-50 px-3 py-2" key={reaction.eventId || index}><p className="text-[10px] font-semibold leading-relaxed text-slate-800">{reaction.title || reaction.eventTitle || '事件窗口'}</p><p className="mt-1 text-[9px] text-slate-600">{text(reaction.reaction, '暂不可评估')} · {reaction.return3d == null ? '3 日表现未取得' : `3 日收益 ${(Number(reaction.return3d) * 100).toFixed(1)}%`}</p></li>)}</ul> : <Empty>尚无可归因的事件后行情窗口。</Empty>}</section>
  </ModuleFrame>;
}

function DcfScenarioVisual({ dcf, marketPrice }: { dcf: any; marketPrice: any }) {
  const scenarios = asList(dcf?.scenarios);
  const inputs = dcf?.inputs || {};
  const sensitivity = dcf?.sensitivity || null;
  const amount = (value: any) => !hasNumber(value) ? '--' : `${Number(value) < 0 ? '-' : ''}${(Math.abs(Number(value)) / 1e8).toFixed(2)} 亿`;
  const price = (value: any) => !hasNumber(value) ? '--' : `${Number(value).toFixed(2)} 元`;
  const percent = (value: any) => hasNumber(value) ? `${(Number(value) * 100).toFixed(1)}%` : '--';
  if (!scenarios.length) return <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-[11px] font-bold text-slate-800">DCF 情景分析</h3><p className="mt-1 text-[9px] leading-relaxed text-slate-600">需要正的完整年报自由现金流与净债务，才会计算内在价值情景。</p></div><span className="rounded-md bg-slate-200 px-2 py-1 text-[9px] font-semibold text-slate-700">暂不可用</span></div><p className="mt-3 rounded-lg bg-white px-3 py-2 text-[10px] leading-relaxed text-slate-700">{dcf?.reason || '当前现金流输入不足，避免用不完整数据推测价值。'}</p></section>;
  const validPerShare = scenarios.map((item) => Number(item?.perShare)).filter(Number.isFinite);
  const maxPerShare = Math.max(...validPerShare, Number(marketPrice) || 0, 1);
  const base = scenarios.find((item) => item?.id === 'base') || scenarios[1] || scenarios[0];
  const allCells = asList(sensitivity?.cells).flatMap((row) => asList(row?.values)).filter((item) => hasNumber(item?.perShare));
  const minCell = Math.min(...allCells.map((item) => Number(item.perShare)), 0); const maxCell = Math.max(...allCells.map((item) => Number(item.perShare)), 1);
  const cellTone = (value: any) => { if (!hasNumber(value)) return 'bg-slate-100 text-slate-500'; const ratio = (Number(value) - minCell) / Math.max(maxCell - minCell, 0.0001); return ratio > 0.68 ? 'bg-emerald-100 text-emerald-950' : ratio < 0.32 ? 'bg-rose-100 text-rose-950' : 'bg-amber-100 text-amber-950'; };
  const tones: Record<string, string> = { bear: 'border-rose-200 bg-rose-50/60', base: 'border-indigo-300 bg-indigo-50/70', bull: 'border-emerald-200 bg-emerald-50/60' };
  const scenarioLabels: Record<string, string> = { bear: '保守', base: '基准', bull: '乐观' };
  return <section className="rounded-xl border border-slate-200 bg-white p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-[11px] font-bold text-slate-800">DCF 情景分析</h3><p className="mt-1 text-[9px] leading-relaxed text-slate-600">基于完整年报自由现金流的假设检验；模型值不是目标价或交易建议。</p></div><span className="rounded-md bg-amber-50 px-2 py-1 text-[9px] font-semibold text-amber-900">有限可用</span></div><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4"><div className="rounded-lg bg-slate-50 p-2"><p className="text-[9px] text-slate-500">自由现金流</p><p className="mt-1 font-mono text-[11px] font-bold text-slate-900">{amount(inputs.freeCashFlow)}</p><p className="mt-1 text-[8px] text-slate-500">完整年报 {inputs.freeCashFlowPeriod || '--'}</p></div><div className="rounded-lg bg-slate-50 p-2"><p className="text-[9px] text-slate-500">净债务</p><p className="mt-1 font-mono text-[11px] font-bold text-slate-900">{amount(inputs.netDebt)}</p><p className="mt-1 text-[8px] text-slate-500">缺失时不计算股东价值</p></div><div className="rounded-lg bg-slate-50 p-2"><p className="text-[9px] text-slate-500">折现率</p><p className="mt-1 font-mono text-[11px] font-bold text-slate-900">{percent(inputs.discountRate)}</p><p className="mt-1 text-[8px] text-slate-500">固定基准假设</p></div><div className="rounded-lg bg-slate-50 p-2"><p className="text-[9px] text-slate-500">永续增长率</p><p className="mt-1 font-mono text-[11px] font-bold text-slate-900">{percent(inputs.terminalGrowthRate)}</p><p className="mt-1 text-[8px] text-slate-500">固定基准假设</p></div></div><section className="mt-3"><div className="flex items-center justify-between gap-2"><div><h4 className="text-[10px] font-bold text-slate-800">三种增长情景</h4><p className="mt-1 text-[9px] text-slate-600">柱高仅用于比较模型每股值，不代表价格预测。</p></div><span className="text-[9px] text-slate-500">现价 {price(marketPrice)}</span></div><div className="mt-3 grid gap-2 sm:grid-cols-3">{scenarios.map((scenario) => { const perShare = Number(scenario?.perShare); const sharePercent = Number.isFinite(perShare) ? Math.max(4, Math.min(100, Math.abs(perShare) / maxPerShare * 100)) : 0; return <article className={`rounded-lg border p-3 ${tones[scenario?.id] || 'border-slate-200 bg-slate-50'}`} key={scenario?.id}><div className="flex items-baseline justify-between gap-2"><p className="text-[10px] font-bold text-slate-800">{scenarioLabels[scenario?.id] || scenario?.label || '情景'}</p><span className="font-mono text-[9px] text-slate-700">增长 {percent(scenario?.growthRate)}</span></div><p className="mt-2 font-mono text-lg font-bold text-slate-950">{price(scenario?.perShare)}</p><div className="mt-2 h-2 overflow-hidden rounded-full bg-white/80"><div className="h-full rounded-full bg-slate-800" style={{ width: `${sharePercent}%` }} /></div><p className="mt-2 text-[9px] leading-relaxed text-slate-600">企业价值 {amount(scenario?.enterpriseValue)} → 股东价值 {amount(scenario?.equityValue)}</p></article>; })}</div></section><section className="mt-3 border-t border-slate-100 pt-3"><h4 className="text-[10px] font-bold text-slate-800">基准情景价值桥</h4><div className="mt-2 flex flex-wrap items-center gap-1.5 text-[9px] leading-relaxed text-slate-700"><span className="rounded bg-slate-100 px-2 py-1">5 年现金流现值 {amount(base?.pvExplicit)}</span><span aria-hidden="true">＋</span><span className="rounded bg-slate-100 px-2 py-1">终值现值 {amount(base?.terminalValue)}</span><span aria-hidden="true">＝</span><span className="rounded bg-indigo-50 px-2 py-1 font-semibold text-indigo-900">企业价值 {amount(base?.enterpriseValue)}</span><span aria-hidden="true">→</span><span className="rounded bg-emerald-50 px-2 py-1 font-semibold text-emerald-900">股东价值 {amount(base?.equityValue)}</span></div></section>{sensitivity && <section className="mt-3 border-t border-slate-100 pt-3"><div className="flex flex-wrap items-baseline justify-between gap-2"><div><h4 className="text-[10px] font-bold text-slate-800">敏感性矩阵</h4><p className="mt-1 text-[9px] text-slate-600">基准增长不变时，模型每股值随折现率与永续增长率变化。</p></div><span className="text-[9px] text-slate-500">单位：元/股</span></div><div className="mt-3 overflow-x-auto"><table className="min-w-full border-separate border-spacing-1 text-center text-[9px]"><caption className="sr-only">DCF 模型每股价值敏感性矩阵</caption><thead><tr><th className="px-1 text-left font-medium text-slate-500">永续增长率 \ 折现率</th>{asList(sensitivity.discountRates).map((rate) => <th className="px-1 font-medium text-slate-600" key={rate}>{percent(rate)}</th>)}</tr></thead><tbody>{asList(sensitivity.cells).map((row) => <tr key={row?.terminalGrowthRate}><th className="px-1 text-left font-medium text-slate-600">{percent(row?.terminalGrowthRate)}</th>{asList(row?.values).map((cell) => <td className={`min-w-12 rounded px-1 py-2 font-mono font-semibold ${cellTone(cell?.perShare)}`} key={cell?.discountRate}>{hasNumber(cell?.perShare) ? Number(cell.perShare).toFixed(2) : '--'}</td>)}</tr>)}</tbody></table></div><p className="mt-2 text-[8px] leading-relaxed text-slate-500">绿色/黄色/红色仅表示矩阵内部的相对高、中、低模型值；不代表看多、看空或风险等级。</p></section>}<p className="mt-3 text-[9px] leading-relaxed text-slate-500">限制：增长率由最新利润同比派生；自由现金流采用最近完整年报；折现率和永续增长率当前为公开固定假设，后续可按行业与公司风险特征校准。</p></section>;
}

function Valuation({ data, gaps, evidence, counter, agentMeta }: any) {
  const multiples = data?.multiples || {};
  const comparison = data?.comparison || {};
  const history = comparison?.historyPercentile || {};
  const peers = comparison?.peerComparison || {};
  const framework = data?.valuationFramework || {};
  const scenarioModel = data?.scenarioModel || {};
  const status = data?.valuationStatus || 'unavailable';
  const metricRows = [
    { key: 'peDynamic', name: '动态 PE', value: multiples.peDynamic, status: multiples.peDynamicStatus },
    { key: 'peStatic', name: '静态 PE', value: multiples.peStatic, status: multiples.peStaticStatus },
    { key: 'ps', name: 'PS', value: multiples.ps, status: multiples.psStatus },
  ];
  const historyRows = ['pe', 'pb', 'ps'].map((key) => ({ key, name: key.toUpperCase(), ...history?.[key] })).filter((item) => hasNumber(item.percentile));
  const peerRows = ['pe', 'pb', 'ps'].map((key) => ({ key, name: key.toUpperCase(), ...peers?.[key] })).filter((item) => hasNumber(item.peerMedian) || hasNumber(item.peerPercentile) || Number(item.peerCount) > 0);
  const scenarioRows = [
    { key: 'earnings', name: '盈利变化情景', item: scenarioModel.earnings, description: '只展示盈利变化假设，不是估值或目标价。' },
    { key: 'residualIncome', name: '剩余收益情景', item: scenarioModel.residualIncome, description: '仅适用于银行的权益与 ROE 情景。' },
  ];
  const formatMetric = (item: any) => item.status === 'not_meaningful' ? '亏损期无意义' : hasNumber(item.value) ? Number(item.value).toFixed(2) : '--';
  const pbHistory = history?.pb || {};
  const pbPercentile = hasNumber(pbHistory.percentile) ? (Number(pbHistory.percentile) <= 1 ? Number(pbHistory.percentile) * 100 : Number(pbHistory.percentile)) : null;
  const financialBasis = data?.financialBasis || {};
  const formatYuan = (value: any) => !hasNumber(value) ? '--' : `${Number(value) < 0 ? '-' : ''}${(Math.abs(Number(value)) / 1e8).toFixed(2)} 亿`;
  const formatPercent = (value: any) => hasNumber(value) ? `${(Number(value) * 100).toFixed(1)}%` : '--';
  const conclusion = status === 'available' ? (comparison?.reason || '估值快照可用，但仍须区分历史位置与同行比较。') : '估值输入受限；当前只展示可核验的倍数、历史位置与数据缺口，不判断高估或低估。';
  const valuationGaps = status === 'available' && historyRows.length ? [] : ['历史估值分位或同行可比样本不完整，不能据此判断相对高低。'];
  return <ModuleFrame conclusion={conclusion} why={comparison?.reason ? [{ text: comparison.reason }] : []} support={status === 'available' ? [{ text: '历史或可比估值证据可用。' }] : []} counter={counter} gaps={[...gaps, ...valuationGaps]} data={data} evidence={evidence} agentMeta={agentMeta}><section className="rounded-xl border border-slate-200 bg-white p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-[11px] font-bold text-slate-800">估值状态</h3><p className="mt-1 text-[10px] leading-relaxed text-slate-600">{framework?.reason || '估值口径尚未完整返回。'}</p></div><span className={`rounded-md px-2 py-1 text-[9px] font-semibold ${status === 'available' ? 'bg-emerald-50 text-emerald-800' : status === 'limited' ? 'bg-amber-50 text-amber-900' : 'bg-slate-100 text-slate-700'}`}>{text(status)}</span></div><section className={`mt-3 rounded-lg border p-3 ${multiples.pbStatus === 'meaningful' ? 'border-indigo-200 bg-indigo-50/60' : 'border-amber-200 bg-amber-50/60'}`}><div className="flex items-baseline justify-between gap-3"><div><p className="text-[10px] font-bold text-slate-800">当前优先观察：PB</p><p className="mt-1 text-[9px] leading-relaxed text-slate-600">{framework?.template === 'bank' ? '银行优先用 PB 配合 ROE、息差与资产质量。' : '亏损期 PE 无意义，PB 仅作为账面价值观察尺度。'}</p></div><b className="font-mono text-2xl tracking-tight text-slate-950">{multiples.pbStatus === 'meaningful' && hasNumber(multiples.pb) ? Number(multiples.pb).toFixed(2) : '--'}</b></div><div className="mt-3 grid grid-cols-3 gap-2"><div className="rounded-md bg-white/80 p-2"><p className="text-[9px] text-slate-500">PB 历史分位</p><p className="mt-1 font-mono text-[11px] font-bold text-slate-900">{pbPercentile === null ? '--' : `${pbPercentile.toFixed(1)}%`}</p></div><div className="rounded-md bg-white/80 p-2"><p className="text-[9px] text-slate-500">ROE（近似）</p><p className="mt-1 font-mono text-[11px] font-bold text-slate-900">{formatPercent(financialBasis.roeApprox)}</p></div><div className="rounded-md bg-white/80 p-2"><p className="text-[9px] text-slate-500">报告期</p><p className="mt-1 font-mono text-[11px] font-bold text-slate-900">{financialBasis.period || '--'}</p></div></div><p className="mt-3 text-[9px] leading-relaxed text-indigo-900">低 PB 历史分位不等于低估：需同时观察盈利 {formatYuan(financialBasis.netProfit)}、经营现金流 {formatYuan(financialBasis.operatingCashFlow)} 及后续修复证据。</p></section><div className="mt-3 grid grid-cols-2 gap-2">{metricRows.map((item) => <article className={`rounded-lg border p-3 ${item.status === 'not_meaningful' ? 'border-amber-200 bg-amber-50/60' : 'border-slate-200 bg-slate-50/60'}`} key={item.key}><p className="text-[10px] font-medium text-slate-600">{item.name}</p><p className={`mt-1 font-mono font-bold tracking-tight ${item.status === 'not_meaningful' ? 'text-sm text-amber-900' : 'text-lg text-slate-950'}`}>{formatMetric(item)}</p><p className="mt-1 text-[9px] leading-relaxed text-slate-600">{item.status === 'not_meaningful' ? '最新盈利为负，PE 不能用于判断贵或便宜。' : item.status === 'meaningful' ? '当前倍数可展示，但仍需比较基准。' : '当前口径未取得。'}</p></article>)}</div>{hasNumber(data?.market?.price) && <p className="mt-3 text-[9px] text-slate-500">现价 {Number(data.market.price).toFixed(2)} · 市值 {hasNumber(data?.market?.marketCap) ? `${(Number(data.market.marketCap) / 1e8).toFixed(1)} 亿` : '--'} · 数据截至 {dateText(data?.market?.asOf)}</p>}</section><section className="rounded-xl border border-slate-200 bg-white p-3"><div className="flex flex-wrap items-baseline justify-between gap-2"><div><h3 className="text-[11px] font-bold text-slate-800">历史估值位置</h3><p className="mt-1 text-[9px] leading-relaxed text-slate-600">与自身历史相比的位置，不等同于同行比较或高低估结论。</p></div><span className="text-[9px] text-slate-500">{comparison?.industry?.name || '行业未标注'}</span></div>{historyRows.length ? <div className="mt-3 space-y-3">{historyRows.map((item) => { const percentile = Number(item.percentile) <= 1 ? Number(item.percentile) * 100 : Number(item.percentile); return <div key={item.key}><div className="flex items-baseline justify-between gap-2 text-[10px]"><span className="font-semibold text-slate-800">{item.name}</span><span className="font-mono text-slate-900">{percentile.toFixed(1)}%</span></div><div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-600" style={{ width: `${Math.max(0, Math.min(100, percentile))}%` }} /></div><p className="mt-1 text-[9px] text-slate-500">{item.sampleCount || '--'} 个交易日样本 · 最近日期 {item.lastDate || '--'}</p></div>; })}</div> : <Empty>没有可核验的历史估值分位，不绘制推测位置。</Empty>}</section><section className="rounded-xl border border-slate-200 bg-white p-3"><h3 className="text-[11px] font-bold text-slate-800">同行业可比</h3><p className="mt-1 text-[9px] leading-relaxed text-slate-600">只在同报告期、同口径的同行样本充分时展示。</p>{peerRows.length ? <div className="mt-3 space-y-2">{peerRows.map((item) => <div className="flex items-baseline justify-between rounded-lg bg-slate-50 px-3 py-2 text-[10px]" key={item.key}><span className="font-semibold text-slate-800">{item.name}</span><span className="font-mono text-slate-900">同行中位数 {hasNumber(item.peerMedian) ? Number(item.peerMedian).toFixed(2) : '--'} · 分位 {hasNumber(item.peerPercentile) ? `${(Number(item.peerPercentile) <= 1 ? Number(item.peerPercentile) * 100 : Number(item.peerPercentile)).toFixed(1)}%` : '--'} · {item.peerCount || 0} 家</span></div>)}</div> : <Empty>当前没有足够的同行业可比样本；不会把历史分位冒充为行业分位。</Empty>}</section><DcfScenarioVisual dcf={scenarioModel.dcf} marketPrice={data?.market?.price} /><section className="rounded-xl border border-slate-200 bg-white p-3"><div className="flex items-baseline justify-between gap-2"><div><h3 className="text-[11px] font-bold text-slate-800">模型情景</h3><p className="mt-1 text-[9px] leading-relaxed text-slate-600">模型只用于检验假设，不构成目标价或交易建议。</p></div><span className="text-[9px] text-slate-500">程序情景</span></div><div className="mt-3 space-y-2">{scenarioRows.map((row) => { const item = row.item || {}; const base = asList(item?.scenarios).find((scenario) => scenario?.id === 'base'); return <article className={`rounded-lg border p-3 ${item.status === 'available' || item.status === 'limited' ? 'border-slate-200 bg-slate-50/60' : 'border-slate-200 bg-slate-100/70'}`} key={row.key}><div className="flex items-baseline justify-between gap-2"><p className="text-[10px] font-semibold text-slate-800">{row.name}</p><span className="rounded bg-white px-1.5 py-0.5 text-[9px] text-slate-700">{text(item.status)}</span></div><p className="mt-1 text-[9px] leading-relaxed text-slate-600">{item.reason || row.description}</p>{row.key === 'earnings' && hasNumber(base?.growthRate) && <p className="mt-2 font-mono text-[10px] text-slate-800">基准增长假设 {(Number(base.growthRate) * 100).toFixed(1)}% / 年</p>}</article>; })}</div></section></ModuleFrame>;
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
  if (sectionKey === 'industry') return <Industry {...common} />;
  if (sectionKey === 'sentiment') return <Sentiment {...common} />;
  if (sectionKey === 'valuation') return <Valuation {...common} />;
  if (sectionKey === 'risk') return <Risk {...common} />;
  return <Evidence evidence={evidence} gaps={dataGaps} agentMeta={agentMeta} />;
}
