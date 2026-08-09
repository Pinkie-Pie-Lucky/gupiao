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
  positive: '正向', negative: '负向', stable: '稳定', mixed: '分歧', risk: '风险', data_insufficient: '数据不足',
  triggered: '已触发', watch: '观察中', clear: '未触发', veto: '否决', downgrade: '降级',
  new: '最新披露', ongoing: '持续跟踪', settled: '已披露', expired: '已过期', unconfirmed: '待核验', unknown: '待评估', other: '其他公告',
  high: '高', medium: '中', low: '低', bullish: '偏多', bearish: '偏空', neutral: '中性', uncertain: '待确认',
  immediate: '即时', short: '短期', long: '长期', short_term: '短期', medium_term: '中期', long_term: '长期',
  company: '公司', industry: '行业', market: '市场', revenue: '收入', profit: '利润', cash_flow: '现金流', valuation: '估值',
  official_verified: '官方已核验', official_document_only: '仅官方文件', unverified: '未核验',
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

function ModuleFrame({ conclusion, why, support, counter, data, children }: { conclusion: string; why: any[]; support: any[]; counter: any[]; gaps?: string[]; evidence?: any[]; agentMeta?: any; data: any; children: React.ReactNode }) {
  const ai = data?.aiExplanation || {};
  const aiWhy = asList(ai?.why); const aiSupport = asList(ai?.supporting); const aiCounter = asList(ai?.counter);
  const displayConclusion = ai?.conclusion || conclusion;
  return <div className="space-y-4 pt-3">
    <section className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-3"><p className="flex items-center gap-1.5 text-[10px] font-bold text-indigo-800"><Sparkles className="h-3.5 w-3.5" />一句话结论{ai?.conclusion && <span className="rounded bg-white px-1.5 py-0.5 text-[9px] text-indigo-700">AI 解读</span>}</p><p className="mt-1.5 text-xs font-semibold leading-relaxed text-slate-900">{displayConclusion}</p></section>
    <section><h3 className="mb-2 text-[11px] font-bold text-slate-800">为什么{aiWhy.length > 0 && <span className="ml-1.5 text-[9px] font-medium text-indigo-700">AI 解读</span>}</h3><BulletList items={aiWhy.length ? aiWhy : why} empty="暂未形成可解释的确定性原因。" /></section>
    {children}
    <div className="grid gap-4 sm:grid-cols-2"><section><h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-bold text-emerald-800"><CheckCircle2 className="h-3.5 w-3.5" />支持证据</h3><BulletList items={aiSupport.length ? aiSupport : support} tone="positive" empty="暂无足够的正向证据。" /></section><section><h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-bold text-rose-800"><XCircle className="h-3.5 w-3.5" />反方证据</h3><BulletList items={aiCounter.length ? aiCounter : counter} tone="negative" empty="暂未发现本模块的反方证据。" /></section></div>
  </div>;
}

function Trend({ reports }: { reports: any[] }) {
  const series = reports.slice(0, 5).reverse().map((report) => ({ period: report?.period, revenue: Number(report?.metrics?.revenue), profit: Number(report?.metrics?.netProfit) })).filter((item) => item.period && Number.isFinite(item.revenue));
  if (series.length < 2) return <Empty>历史财务趋势需要至少两个报告期；当前序列不足，未绘制图形。</Empty>;
  const max = Math.max(...series.flatMap((item) => [Math.abs(item.revenue), Number.isFinite(item.profit) ? Math.abs(item.profit) : 0]), 1);
  return <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="flex items-center justify-between"><h3 className="text-[11px] font-bold text-slate-800">财务历史趋势</h3><span className="text-[10px] text-slate-500">营收 / 归母净利润</span></div><div className="mt-3 flex h-28 items-end gap-2" aria-label="基于报告期真实数值的财务趋势图">{series.map((item) => <div className="flex min-w-0 flex-1 flex-col items-center gap-1" key={item.period}><div className="flex h-20 w-full items-end justify-center gap-1"><i className="w-2 rounded-t bg-indigo-500" style={{ height: `${Math.max(8, Math.abs(item.revenue) / max * 100)}%` }} title={`营收 ${item.revenue}`} />{Number.isFinite(item.profit) && <i className={`w-2 rounded-t ${item.profit >= 0 ? 'bg-emerald-500' : 'bg-rose-500'}`} style={{ height: `${Math.max(5, Math.abs(item.profit) / max * 100)}%` }} title={`归母净利润 ${item.profit}`} />}</div><span className="w-full truncate text-center text-[9px] text-slate-500">{String(item.period).slice(0, 7)}</span></div>)}</div><p className="mt-2 text-[9px] text-slate-500">蓝色：营收；绿色/红色：归母净利润。柱高仅比较本图内报告期。</p></div>;
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

function FinancialQuality({ calculations, template }: { calculations: any; template: string }) {
  const [showAll, setShowAll] = useState(false);
  const metrics = calculations?.metrics || {};
  const details = calculations?.metricDetails || {};
  const bank = template === 'bank' || calculations?.template === 'bank';
  const loanDepositGap = hasNumber(metrics.loanYoY) && hasNumber(metrics.depositYoY) ? Number(metrics.loanYoY) - Number(metrics.depositYoY) : null;
  const primary = bank
    ? [
      { key: 'roeApprox', label: 'ROE（近似）', unit: 'fraction', note: '净利润 / 平均权益' },
      { key: 'loanDepositGap', label: '贷款-存款增速差', unit: 'fraction', value: loanDepositGap, note: '正值表示贷款增速快于存款' },
      { key: 'interestNetIncomeYoY', label: '净利息收入同比', unit: 'fraction', note: '银行核心利息收入变化' },
      { key: 'creditImpairmentToRevenue', label: '信用减值/营收', unit: 'fraction', note: '需结合资产质量进一步判断' },
    ]
    : [
      { key: 'grossMargin', label: '毛利率', unit: 'fraction', note: '收入扣除营业成本后的比例' },
      { key: 'roeApprox', label: 'ROE（近似）', unit: 'fraction', note: '净利润 / 平均权益' },
      { key: 'cashConversion', label: '经营现金流/净利润', unit: 'fraction', note: '利润的现金回收质量' },
      { key: 'freeCashFlow', label: '自由现金流', unit: 'CNY', note: '经营现金流 - 资本开支' },
    ];
  const all = bank
    ? [
      ...primary,
      { key: 'assetYoY', label: '资产同比', unit: 'fraction' }, { key: 'loanYoY', label: '贷款同比', unit: 'fraction' }, { key: 'depositYoY', label: '存款同比', unit: 'fraction' }, { key: 'feeNetIncomeYoY', label: '手续费及佣金净收入同比', unit: 'fraction' },
    ]
    : [
      ...primary,
      { key: 'netMargin', label: '净利率', unit: 'fraction' }, { key: 'adjustedNetMargin', label: '扣非净利率', unit: 'fraction' }, { key: 'accountsReceivableDays', label: '应收周转天数', unit: 'days' }, { key: 'inventoryDays', label: '存货周转天数', unit: 'days' }, { key: 'interestBearingDebt', label: '有息负债', unit: 'CNY' }, { key: 'netDebt', label: '净负债', unit: 'CNY' }, { key: 'interestCoverage', label: '利息保障倍数', unit: 'times' }, { key: 'capex', label: '资本开支', unit: 'CNY' }, { key: 'roic', label: 'ROIC（代理）', unit: 'fraction' },
    ];
  const sourcePeriod = calculations?.period || '报告期未标注';
  const card = (item: any, primaryCard = false) => {
    const value = item.value === undefined ? metrics?.[item.key] : item.value;
    const detail = details?.[item.key];
    const available = hasNumber(value);
    const unavailableReason = detail?.dataGap || '当前报告期缺少计算所需字段。';
    return <article className={`rounded-lg border p-3 ${available ? 'border-slate-200 bg-white' : 'border-amber-200 bg-amber-50/60'}`} key={item.key}><p className="text-[10px] font-medium text-slate-600">{item.label}</p><p className={`mt-1 font-mono font-bold tracking-tight ${primaryCard ? 'text-lg' : 'text-sm'} ${available ? 'text-slate-950' : 'text-amber-900'}`}>{formatFinancialValue(value, item.unit)}</p><p className="mt-1 text-[9px] leading-relaxed text-slate-500">{available ? item.note || detail?.formula || '基于当前报告期结构化财务数据。' : unavailableReason}</p></article>;
  };
  if (!calculations) return <Empty>财务质量指标尚未随事实快照返回，不能用估算值代替。</Empty>;
  return <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-[11px] font-bold text-slate-800">财务质量</h3><p className="mt-1 text-[10px] leading-relaxed text-slate-600">{bank ? '银行口径：盈利、资金匹配和减值压力。' : '普通企业口径：盈利、现金回收与资本效率。'} 指标来自 {sourcePeriod}。</p></div><span className="rounded-md bg-white px-2 py-1 text-[9px] font-medium text-slate-700">{bank ? '银行模板' : '普通企业模板'}</span></div><div className="mt-3 grid grid-cols-2 gap-2">{primary.map((item) => card(item, true))}</div><div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2"><p className="text-[10px] font-semibold text-slate-800">读法</p><p className="mt-1 text-[9px] leading-relaxed text-slate-600">上方数字用于快速判断；营收与净利润的跨期变化见“财务历史趋势”。未取到的数据会在页面底部“数据缺口”统一列出，不以 0 替代。</p></div>{showAll && <div className="mt-3 border-t border-slate-200 pt-3"><p className="mb-2 text-[10px] font-bold text-slate-800">完整财务口径</p><div className="grid gap-2 sm:grid-cols-2">{all.slice(primary.length).map((item) => card(item))}</div></div>}<button type="button" className="mt-3 min-h-9 rounded-lg border border-slate-300 bg-white px-3 py-2 text-[10px] font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600" aria-expanded={showAll} onClick={() => setShowAll((value) => !value)}>{showAll ? '收起完整指标' : '查看完整指标'}</button></section>;
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
  const conclusion = positive[0] ? researchItemText(positive[0]) : negative[0] ? researchItemText(negative[0]) : '基本面尚未形成足够的确定性结论。';
  return <ModuleFrame conclusion={conclusion} why={signals} support={positive} counter={negative} gaps={gaps} data={data} evidence={evidence} agentMeta={agentMeta}><Trend reports={asList(data?.reports)} /><FinancialQuality calculations={data?.financialCalculations} template={data?.template} /><BusinessSegments snapshot={data?.businessSegments} />{asList(data?.vetoes).filter((item) => item?.triggered).length > 0 && <section><h3 className="mb-2 text-[11px] font-bold text-rose-900">基本面否决项</h3><BulletList items={asList(data?.vetoes).filter((item) => item?.triggered)} tone="negative" empty="" /></section>}</ModuleFrame>;
}

function Technical({ data, gaps, evidence, counter, agentMeta }: any) {
  const signals = asList(data?.signals); const invalidations = asList(data?.structureInvalidation?.rules).filter((item) => item?.triggered); const riskSignal = signals.find((item) => item?.signalId === 'risk'); const latestClose = asList(data?.chartBars).at(-1)?.close; const positive = signals.filter((item) => item?.status === 'positive'); const negative = [...signals.filter((item) => ['negative', 'risk', 'deteriorating', 'mixed'].includes(item?.status)), ...invalidations];
  const conclusion = positive[0] ? researchItemText(positive[0]) : negative[0] ? researchItemText(negative[0]) : '技术与市场信号暂未形成明确方向。';
  return <ModuleFrame conclusion={conclusion} why={signals} support={positive} counter={negative} gaps={gaps} data={data} evidence={evidence} agentMeta={agentMeta}><><CandleChart bars={data?.chartBars} keyLevels={data?.keyLevels} /><TechnicalRiskMetrics riskSignal={riskSignal} thresholds={data?.riskThresholds} /><TechnicalLevels keyLevels={data?.keyLevels} rules={asList(data?.structureInvalidation?.rules)} latestClose={latestClose} />{invalidations.length > 0 && <section className="rounded-xl border border-rose-200 bg-rose-50 p-3"><h3 className="flex items-center gap-1.5 text-[11px] font-bold text-rose-900"><CircleAlert className="h-3.5 w-3.5" />已触发的结构失效条件</h3><BulletList items={invalidations} tone="negative" empty="" /></section>}</></ModuleFrame>;
}

function EventBadge({ children, tone = 'slate' }: { children: React.ReactNode; tone?: 'slate' | 'emerald' | 'rose' | 'amber' | 'indigo' }) {
  const tones = { slate: 'bg-slate-100 text-slate-700', emerald: 'bg-emerald-50 text-emerald-800', rose: 'bg-rose-50 text-rose-800', amber: 'bg-amber-50 text-amber-900', indigo: 'bg-indigo-50 text-indigo-800' };
  return <span className={`rounded-md px-1.5 py-1 text-[9px] font-medium ${tones[tone]}`}>{children}</span>;
}

function Events({ data, gaps, evidence, counter, agentMeta }: any) {
  const events = asList(data?.events).sort((a, b) => String(b?.publishedAt || b?.date || '').localeCompare(String(a?.publishedAt || a?.date || '')));
  const positive = events.filter((item) => item?.direction === 'positive'); const negative = events.filter((item) => item?.direction === 'negative');
  const officialCount = events.filter((item) => ['official_verified', 'official_document_only'].includes(item?.verification)).length;
  const activeCount = events.filter((item) => !['expired', 'settled'].includes(item?.status)).length;
  const conclusion = events[0] ? `${text(events[0]?.direction, '待评估')}事件：${researchItemText(events[0])}` : '当前窗口内没有可展示的有效事件。';
  const directionTone = (value: any) => value === 'positive' ? 'emerald' : value === 'negative' ? 'rose' : value === 'mixed' || value === 'unknown' ? 'amber' : 'slate';
  return <ModuleFrame conclusion={conclusion} why={events} support={positive} counter={negative} gaps={gaps} data={data} evidence={evidence} agentMeta={agentMeta}><section className="space-y-3"><div className="flex flex-wrap items-end justify-between gap-2"><div><h3 className="text-[11px] font-bold text-slate-800">事件时间线</h3><p className="mt-1 text-[10px] leading-relaxed text-slate-600">按披露日期展示。方向、期限和状态来自程序规则；不将标题直接解释为经营结论。</p></div><span className="text-[10px] text-slate-500">近窗口 {events.length} 项</span></div>{events.length ? <><div className="grid grid-cols-3 overflow-hidden rounded-xl border border-slate-200 bg-slate-200"><div className="bg-white p-2.5"><p className="text-[9px] text-slate-500">官方核验</p><p className="mt-1 font-mono text-sm font-bold text-slate-900">{officialCount}</p></div><div className="bg-white p-2.5"><p className="text-[9px] text-slate-500">仍在跟踪</p><p className="mt-1 font-mono text-sm font-bold text-slate-900">{activeCount}</p></div><div className="bg-white p-2.5"><p className="text-[9px] text-slate-500">待评估方向</p><p className="mt-1 font-mono text-sm font-bold text-slate-900">{events.filter((item) => ['unknown', 'mixed'].includes(item?.direction)).length}</p></div></div><ol className="relative ml-2 border-l border-slate-200">{events.slice(0, 10).map((event, index) => { const pathways = asList(event?.pathways); const verificationPlan = asList(event?.verificationPlan); const counterEvidence = asList(event?.counterEvidence); const hasSecondStage = pathways.length || verificationPlan.length || counterEvidence.length || event?.materiality; return <li className="relative pb-4 pl-4 last:pb-0" key={event?.eventId || index}><span className={`absolute -left-[5px] top-4 h-2 w-2 rounded-full ${event?.direction === 'positive' ? 'bg-emerald-500' : event?.direction === 'negative' ? 'bg-rose-500' : 'bg-amber-500'}`} /><article className="rounded-xl border border-slate-200 bg-white p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0 flex-1"><p className="text-[10px] text-slate-500">{dateText(event?.publishedAt || event?.date)}</p><h4 className="mt-1 text-[11px] font-semibold leading-relaxed text-slate-900">{researchItemText(event)}</h4></div>{event?.sourceUrl && <a className="min-h-8 shrink-0 rounded-lg bg-slate-100 px-2.5 py-2 text-[10px] font-semibold text-slate-700 hover:bg-slate-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600" href={event.sourceUrl} target="_blank" rel="noreferrer">查看原文</a>}</div><div className="mt-2 flex flex-wrap gap-1.5"><EventBadge tone={directionTone(event?.direction)}>方向：{text(event?.direction, '待评估')}</EventBadge><EventBadge tone={event?.verification?.startsWith('official') ? 'indigo' : 'amber'}>核验：{text(event?.verification, '未标注')}</EventBadge><EventBadge>范围：{text(event?.impactScope, '未标注')}</EventBadge><EventBadge>期限：{text(event?.impactHorizon, '未标注')}</EventBadge><EventBadge tone={event?.status === 'unconfirmed' ? 'amber' : 'slate'}>状态：{text(event?.status, '未标注')}</EventBadge></div>{event?.summary && event.summary !== event.title && <p className="mt-2 text-[10px] leading-relaxed text-slate-600">{event.summary}</p>}{event?.materiality && <p className="mt-2 text-[10px] leading-relaxed text-slate-700">重要性：{text(event.materiality?.level, '待计算')} {event.materiality?.score != null ? `（${event.materiality.score}）` : ''}</p>}{pathways.length > 0 && <div className="mt-3 border-t border-slate-100 pt-2"><p className="text-[10px] font-bold text-slate-700">影响路径</p><ul className="mt-1.5 space-y-1">{pathways.slice(0, 3).map((pathway, pathwayIndex) => <li className="text-[10px] leading-relaxed text-slate-700" key={`${pathway?.dimension}-${pathwayIndex}`}>{text(pathway?.dimension)}：{pathway?.mechanism || text(pathway?.direction)}</li>)}</ul></div>}{verificationPlan.length > 0 && <div className="mt-3 border-t border-slate-100 pt-2"><p className="text-[10px] font-bold text-slate-700">待验证指标</p><ul className="mt-1.5 space-y-1">{verificationPlan.slice(0, 3).map((item, planIndex) => <li className="text-[10px] leading-relaxed text-slate-700" key={`${item?.metric}-${planIndex}`}>{item?.metric || researchItemText(item)}{item?.expectedWindow ? ` · ${item.expectedWindow}` : ''}</li>)}</ul></div>}{counterEvidence.length > 0 && <div className="mt-3 border-t border-slate-100 pt-2"><p className="text-[10px] font-bold text-rose-800">反方与失效条件</p><BulletList items={counterEvidence.slice(0, 3)} tone="negative" empty="" /></div>}{!hasSecondStage && <p className="mt-3 border-t border-slate-100 pt-2 text-[9px] leading-relaxed text-slate-500">当前后端尚未返回影响路径、重要性或验证计划；此处仅展示已核验的事件事实。</p>}</article></li>; })}</ol></> : <Empty>没有事件，因此没有绘制时间线。</Empty>}</section></ModuleFrame>;
}

function Sentiment({ data, gaps, evidence, counter, agentMeta }: any) {
  const metrics = [['关注度', data?.attention], ['情绪倾向', data?.tone], ['观点分歧', data?.disagreement], ['事件后反应', data?.eventReaction], ['传播质量', data?.propagationQuality]].filter(([, value]) => value != null).map(([name, value]) => ({ text: `${name}：${text(value)}` }));
  return <ModuleFrame conclusion={metrics[0] ? researchItemText(metrics[0]) : '当前未获得足够的舆情与市场反应数据。'} why={metrics} support={[]} counter={counter} gaps={gaps} data={data} evidence={evidence} agentMeta={agentMeta}><div className="grid grid-cols-2 overflow-hidden rounded-xl border border-slate-200 bg-slate-200 sm:grid-cols-3">{metrics.map((item) => <div className="min-h-16 bg-white p-3" key={item.text}><p className="text-[10px] leading-relaxed text-slate-700">{item.text}</p></div>)}</div></ModuleFrame>;
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
    { key: 'dcf', name: 'DCF 情景', item: scenarioModel.dcf, description: '仅在现金流输入满足时展示模型情景。' },
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
  return <ModuleFrame conclusion={conclusion} why={comparison?.reason ? [{ text: comparison.reason }] : []} support={status === 'available' ? [{ text: '历史或可比估值证据可用。' }] : []} counter={counter} gaps={[...gaps, ...valuationGaps]} data={data} evidence={evidence} agentMeta={agentMeta}><section className="rounded-xl border border-slate-200 bg-white p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-[11px] font-bold text-slate-800">估值状态</h3><p className="mt-1 text-[10px] leading-relaxed text-slate-600">{framework?.reason || '估值口径尚未完整返回。'}</p></div><span className={`rounded-md px-2 py-1 text-[9px] font-semibold ${status === 'available' ? 'bg-emerald-50 text-emerald-800' : status === 'limited' ? 'bg-amber-50 text-amber-900' : 'bg-slate-100 text-slate-700'}`}>{text(status)}</span></div><section className={`mt-3 rounded-lg border p-3 ${multiples.pbStatus === 'meaningful' ? 'border-indigo-200 bg-indigo-50/60' : 'border-amber-200 bg-amber-50/60'}`}><div className="flex items-baseline justify-between gap-3"><div><p className="text-[10px] font-bold text-slate-800">当前优先观察：PB</p><p className="mt-1 text-[9px] leading-relaxed text-slate-600">{framework?.template === 'bank' ? '银行优先用 PB 配合 ROE、息差与资产质量。' : '亏损期 PE 无意义，PB 仅作为账面价值观察尺度。'}</p></div><b className="font-mono text-2xl tracking-tight text-slate-950">{multiples.pbStatus === 'meaningful' && hasNumber(multiples.pb) ? Number(multiples.pb).toFixed(2) : '--'}</b></div><div className="mt-3 grid grid-cols-3 gap-2"><div className="rounded-md bg-white/80 p-2"><p className="text-[9px] text-slate-500">PB 历史分位</p><p className="mt-1 font-mono text-[11px] font-bold text-slate-900">{pbPercentile === null ? '--' : `${pbPercentile.toFixed(1)}%`}</p></div><div className="rounded-md bg-white/80 p-2"><p className="text-[9px] text-slate-500">ROE（近似）</p><p className="mt-1 font-mono text-[11px] font-bold text-slate-900">{formatPercent(financialBasis.roeApprox)}</p></div><div className="rounded-md bg-white/80 p-2"><p className="text-[9px] text-slate-500">报告期</p><p className="mt-1 font-mono text-[11px] font-bold text-slate-900">{financialBasis.period || '--'}</p></div></div><p className="mt-3 text-[9px] leading-relaxed text-indigo-900">低 PB 历史分位不等于低估：需同时观察盈利 {formatYuan(financialBasis.netProfit)}、经营现金流 {formatYuan(financialBasis.operatingCashFlow)} 及后续修复证据。</p></section><div className="mt-3 grid grid-cols-2 gap-2">{metricRows.map((item) => <article className={`rounded-lg border p-3 ${item.status === 'not_meaningful' ? 'border-amber-200 bg-amber-50/60' : 'border-slate-200 bg-slate-50/60'}`} key={item.key}><p className="text-[10px] font-medium text-slate-600">{item.name}</p><p className={`mt-1 font-mono font-bold tracking-tight ${item.status === 'not_meaningful' ? 'text-sm text-amber-900' : 'text-lg text-slate-950'}`}>{formatMetric(item)}</p><p className="mt-1 text-[9px] leading-relaxed text-slate-600">{item.status === 'not_meaningful' ? '最新盈利为负，PE 不能用于判断贵或便宜。' : item.status === 'meaningful' ? '当前倍数可展示，但仍需比较基准。' : '当前口径未取得。'}</p></article>)}</div>{hasNumber(data?.market?.price) && <p className="mt-3 text-[9px] text-slate-500">现价 {Number(data.market.price).toFixed(2)} · 市值 {hasNumber(data?.market?.marketCap) ? `${(Number(data.market.marketCap) / 1e8).toFixed(1)} 亿` : '--'} · 数据截至 {dateText(data?.market?.asOf)}</p>}</section><section className="rounded-xl border border-slate-200 bg-white p-3"><div className="flex flex-wrap items-baseline justify-between gap-2"><div><h3 className="text-[11px] font-bold text-slate-800">历史估值位置</h3><p className="mt-1 text-[9px] leading-relaxed text-slate-600">与自身历史相比的位置，不等同于同行比较或高低估结论。</p></div><span className="text-[9px] text-slate-500">{comparison?.industry?.name || '行业未标注'}</span></div>{historyRows.length ? <div className="mt-3 space-y-3">{historyRows.map((item) => { const percentile = Number(item.percentile) <= 1 ? Number(item.percentile) * 100 : Number(item.percentile); return <div key={item.key}><div className="flex items-baseline justify-between gap-2 text-[10px]"><span className="font-semibold text-slate-800">{item.name}</span><span className="font-mono text-slate-900">{percentile.toFixed(1)}%</span></div><div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-600" style={{ width: `${Math.max(0, Math.min(100, percentile))}%` }} /></div><p className="mt-1 text-[9px] text-slate-500">{item.sampleCount || '--'} 个交易日样本 · 最近日期 {item.lastDate || '--'}</p></div>; })}</div> : <Empty>没有可核验的历史估值分位，不绘制推测位置。</Empty>}</section><section className="rounded-xl border border-slate-200 bg-white p-3"><h3 className="text-[11px] font-bold text-slate-800">同行业可比</h3><p className="mt-1 text-[9px] leading-relaxed text-slate-600">只在同报告期、同口径的同行样本充分时展示。</p>{peerRows.length ? <div className="mt-3 space-y-2">{peerRows.map((item) => <div className="flex items-baseline justify-between rounded-lg bg-slate-50 px-3 py-2 text-[10px]" key={item.key}><span className="font-semibold text-slate-800">{item.name}</span><span className="font-mono text-slate-900">同行中位数 {hasNumber(item.peerMedian) ? Number(item.peerMedian).toFixed(2) : '--'} · 分位 {hasNumber(item.peerPercentile) ? `${(Number(item.peerPercentile) <= 1 ? Number(item.peerPercentile) * 100 : Number(item.peerPercentile)).toFixed(1)}%` : '--'} · {item.peerCount || 0} 家</span></div>)}</div> : <Empty>当前没有足够的同行业可比样本；不会把历史分位冒充为行业分位。</Empty>}</section><section className="rounded-xl border border-slate-200 bg-white p-3"><div className="flex items-baseline justify-between gap-2"><div><h3 className="text-[11px] font-bold text-slate-800">模型情景</h3><p className="mt-1 text-[9px] leading-relaxed text-slate-600">模型只用于检验假设，不构成目标价或交易建议。</p></div><span className="text-[9px] text-slate-500">程序情景</span></div><div className="mt-3 space-y-2">{scenarioRows.map((row) => { const item = row.item || {}; const base = asList(item?.scenarios).find((scenario) => scenario?.id === 'base'); return <article className={`rounded-lg border p-3 ${item.status === 'available' || item.status === 'limited' ? 'border-slate-200 bg-slate-50/60' : 'border-slate-200 bg-slate-100/70'}`} key={row.key}><div className="flex items-baseline justify-between gap-2"><p className="text-[10px] font-semibold text-slate-800">{row.name}</p><span className="rounded bg-white px-1.5 py-0.5 text-[9px] text-slate-700">{text(item.status)}</span></div><p className="mt-1 text-[9px] leading-relaxed text-slate-600">{item.reason || row.description}</p>{row.key === 'earnings' && hasNumber(base?.growthRate) && <p className="mt-2 font-mono text-[10px] text-slate-800">基准增长假设 {(Number(base.growthRate) * 100).toFixed(1)}% / 年</p>}</article>; })}</div></section></ModuleFrame>;
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
