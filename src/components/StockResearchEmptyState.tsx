import { ArrowLeft, BarChart3 } from 'lucide-react';
import type { StockItem } from '../types';
import { StockResearchPicker } from './StockResearchPicker';

interface Props { followedStocks: StockItem[]; onSelectStock: (stock: StockItem) => void; onBack: () => void; }

export function StockResearchEmptyState({ followedStocks, onSelectStock, onBack }: Props) {
  return <div className="space-y-4 px-3 pb-24 pt-2"><header className="flex items-center justify-between"><button onClick={onBack} aria-label="返回自选列表" className="grid h-11 w-11 place-items-center rounded-xl bg-white text-slate-600 shadow-sm"><ArrowLeft className="h-4 w-4" /></button><div className="text-center"><p className="text-sm font-bold text-slate-900">个股分析</p><p className="text-[10px] text-slate-500">选择研究标的</p></div><span className="h-11 w-11" /></header><section className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-center"><span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-white text-indigo-700"><BarChart3 className="h-5 w-5" /></span><h1 className="mt-3 text-base font-bold text-slate-900">选择一只股票开始分析</h1><p className="mx-auto mt-2 max-w-xs text-xs leading-relaxed text-slate-600">可以从自选股中选择，也可以按股票名称或代码搜索。</p></section><StockResearchPicker followedStocks={followedStocks} onSelectStock={onSelectStock} initiallyOpen /></div>;
}
