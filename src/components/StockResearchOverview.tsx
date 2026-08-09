import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Database, ShieldAlert } from 'lucide-react';
import type { Direction, HoldAssessment, HorizonView } from '../lib/managerStance';

interface Props {
  stock: { name: string; code: string; price: number; changePercent: number };
  stance?: { direction: Direction; holdAssessment: HoldAssessment; confidence: number | null; horizons?: { short?: HorizonView; medium?: HorizonView; long?: HorizonView } };
  researchStatus?: string;
  riskLevel?: string;
  conclusion?: string;
  evidenceCount: number;
  loading: boolean;
  error?: string | null;
}

const directions: Record<Direction, { label: string; tone: string }> = {
  bullish: { label: '看多', tone: 'text-rose-700' }, lean_bullish: { label: '偏多', tone: 'text-rose-700' },
  neutral: { label: '中性', tone: 'text-slate-800' }, lean_bearish: { label: '偏空', tone: 'text-emerald-700' },
  bearish: { label: '看空', tone: 'text-emerald-700' }, unknown: { label: '暂不可判断', tone: 'text-slate-600' },
};
const holds: Record<HoldAssessment, { label: string; tone: string; surface: string }> = {
  hold: { label: '可继续持有', tone: 'text-rose-700', surface: 'border-rose-100 bg-rose-50' },
  conditional_hold: { label: '条件持有', tone: 'text-amber-800', surface: 'border-amber-100 bg-amber-50' },
  observe: { label: '观察后再决定', tone: 'text-slate-800', surface: 'border-slate-200 bg-slate-50' },
  avoid: { label: '不建议继续持有', tone: 'text-emerald-700', surface: 'border-emerald-100 bg-emerald-50' },
  unknown: { label: '暂不可判断', tone: 'text-slate-700', surface: 'border-slate-200 bg-slate-50' },
};
const statuses: Record<string, { label: string; tone: string; icon: typeof CheckCircle2 }> = {
  research_ready: { label: '研究材料完整', tone: 'text-emerald-700', icon: CheckCircle2 },
  watch: { label: '继续观察', tone: 'text-amber-800', icon: Clock3 }, deferred: { label: '暂缓推进', tone: 'text-orange-800', icon: AlertTriangle },
  rejected: { label: '风险否决', tone: 'text-rose-800', icon: ShieldAlert }, blocked: { label: '输入阻断', tone: 'text-slate-700', icon: Database },
};
const riskLevels: Record<string, string> = { high: '高', medium: '中', low: '低', clear: '未触发' };

function Horizon({ name, range, value }: { name: string; range: string; value?: HorizonView }) {
  const direction = directions[value?.direction || 'unknown']; const hold = holds[value?.holdAssessment || 'unknown'];
  return <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-3"><div className="flex flex-wrap items-center justify-between gap-1"><span className="text-[11px] font-bold text-slate-800">{name}</span><span className="text-[9px] text-slate-500">{range}</span></div><div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1"><p className={`text-lg font-bold ${direction.tone}`}>倾向：{direction.label}</p><p className={`text-[11px] font-semibold ${hold.tone}`}>持有评估：{hold.label}</p></div><div className="mt-2 flex items-center justify-between text-[10px] text-slate-500"><span>置信度</span><span className="font-mono font-semibold text-slate-700">{value?.confidence == null ? '--' : `${value.confidence}%`}</span></div>{(value?.rationale || []).length > 0 && <div className="mt-3 border-t border-slate-100 pt-2"><p className="text-[10px] font-bold text-slate-600">依据</p><ul className="mt-1 space-y-1">{value!.rationale.slice(0, 3).map((item, index) => <li className="flex gap-1.5 text-[10px] leading-relaxed text-slate-700" key={`${item}-${index}`}><span aria-hidden="true">•</span><span className="min-w-0 break-words">{item}</span></li>)}</ul></div>}{(value?.invalidationConditions || []).length > 0 && <div className="mt-3 rounded-lg bg-amber-50 p-2"><p className="text-[10px] font-bold text-amber-900">失效条件</p><ul className="mt-1 space-y-1">{value!.invalidationConditions.slice(0, 2).map((item, index) => <li className="flex gap-1.5 text-[10px] leading-relaxed text-amber-900" key={`${item}-${index}`}><span aria-hidden="true">•</span><span className="min-w-0 break-words">{item}</span></li>)}</ul></div>}</div>;
}

export function StockResearchOverview({ stock, stance, researchStatus, riskLevel, conclusion, evidenceCount, loading, error }: Props) {
  const direction = directions[stance?.direction || 'unknown']; const hold = holds[stance?.holdAssessment || 'unknown']; const status = statuses[researchStatus || 'blocked'] || statuses.blocked; const StatusIcon = status.icon;
  const [selectedHorizon, setSelectedHorizon] = useState<'short' | 'medium' | 'long'>('short');
  const horizons = [
    { key: 'short' as const, name: '短期', range: '1-4周', value: stance?.horizons?.short },
    { key: 'medium' as const, name: '中期', range: '1-3月', value: stance?.horizons?.medium },
    { key: 'long' as const, name: '长期', range: '6-12月', value: stance?.horizons?.long },
  ];
  const activeHorizon = horizons.find((item) => item.key === selectedHorizon) || horizons[0];
  const conclusionText = conclusion
    ?.replace(/\brejected\b/g, '风险否决')
    .replace(/\bblocked\b/g, '输入阻断')
    .replace(/\bdeferred\b/g, '暂缓推进')
    .replace(/\bresearch_ready\b/g, '研究材料完整')
    .replace(/\bveto\b/g, '否决')
    .replace(/\bhigh\b/g, '高')
    .replace(/\bmedium\b/g, '中')
    .replace(/\blow\b/g, '低');
  return <section id="stock-research-overview" aria-busy={loading} className={`rounded-2xl border p-4 ${hold.surface}`}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold text-slate-900">{stock.name}</p><div className="mt-1 flex flex-wrap items-baseline gap-2"><span className="font-mono text-2xl font-bold text-slate-950">¥{Number(stock.price || 0).toFixed(2)}</span><span className={`font-mono text-xs font-bold ${stock.changePercent >= 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{stock.changePercent >= 0 ? '+' : ''}{Number(stock.changePercent || 0).toFixed(2)}%</span></div></div><span className={`inline-flex shrink-0 items-center gap-1 rounded-full bg-white/70 px-2.5 py-1 text-[10px] font-bold ${status.tone}`}><StatusIcon className="h-3.5 w-3.5" />{loading ? '正在加载' : status.label}</span></div><div className="mt-4 border-t border-black/5 pt-3"><p className="text-[10px] font-bold text-slate-600">持有评估</p><div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1"><h1 className={`text-2xl font-bold ${hold.tone}`}>{loading ? '正在评估' : hold.label}</h1><span className={`text-sm font-semibold ${direction.tone}`}>综合倾向：{loading ? '汇总中' : direction.label}</span></div><p className={`mt-2 break-words text-xs leading-relaxed ${error ? 'text-rose-800' : 'text-slate-700'}`}>{loading ? '正在汇总基本面、技术、事件和风险信号。' : error || conclusionText || '当前暂无确定性结论。'}</p></div><div className="mt-4"><div className="mb-2 flex items-center justify-between gap-2"><p className="text-[10px] font-bold text-slate-600">周期结论</p><span className="text-[10px] text-slate-500">可分别查看</span></div><div role="tablist" aria-label="结论周期" className="grid grid-cols-3 gap-1 rounded-xl bg-white/70 p-1">{horizons.map((item) => <button type="button" role="tab" aria-selected={selectedHorizon === item.key} key={item.key} onClick={() => setSelectedHorizon(item.key)} className={`min-h-11 rounded-lg px-2 text-[10px] font-bold transition-colors ${selectedHorizon === item.key ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-white'}`}><span className="block">{item.name}</span><span className="mt-0.5 block text-[9px] font-medium opacity-80">{item.range}</span></button>)}</div><div role="tabpanel" className="mt-2"><Horizon name={activeHorizon.name} range={activeHorizon.range} value={activeHorizon.value} /></div></div><div className="mt-3 flex flex-wrap gap-2 text-[10px] font-medium text-slate-600"><span className="rounded-md bg-white/70 px-2 py-1">风险：{riskLevel ? riskLevels[riskLevel] || riskLevel : '暂无'}</span><span className="rounded-md bg-white/70 px-2 py-1">证据：{evidenceCount} 条</span><span className="rounded-md bg-white/70 px-2 py-1">置信度：{stance?.confidence == null ? '--' : `${stance.confidence}%`}</span></div></section>;
}
