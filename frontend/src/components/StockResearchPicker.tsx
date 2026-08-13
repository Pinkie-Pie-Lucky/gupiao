import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, Search, Star, X } from 'lucide-react';
import { initialSectors } from '../data';
import type { StockItem } from '../types';

interface Props {
  selectedStock?: StockItem | null;
  followedStocks: StockItem[];
  onSelectStock: (stock: StockItem) => void;
  initiallyOpen?: boolean;
}

export function uniqueResearchStocks(stocks: StockItem[]) {
  const result = new Map<string, StockItem>();
  for (const stock of stocks) if (!result.has(stock.code)) result.set(stock.code, stock);
  return [...result.values()];
}

export function StockResearchPicker({ selectedStock, followedStocks, onSelectStock, initiallyOpen = false }: Props) {
  const [open, setOpen] = useState(initiallyOpen);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [remoteResults, setRemoteResults] = useState<StockItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchSource, setSearchSource] = useState<string | null>(null);
  const allStocks = useMemo(() => uniqueResearchStocks([...followedStocks, ...initialSectors.flatMap((sector) => sector.stocks)]), [followedStocks]);
  const normalizedQuery = useMemo(() => deferredQuery.trim().toLowerCase().replace(/\s+/g, ''), [deferredQuery]);

  useEffect(() => {
    if (!normalizedQuery) {
      setRemoteResults([]); setSearching(false); setSearchError(null); setSearchSource(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true); setSearchError(null);
      try {
        const response = await fetch(`/api/stock-search?q=${encodeURIComponent(normalizedQuery)}`, { signal: controller.signal });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || '全市场搜索暂不可用');
        if (!controller.signal.aborted) {
          setRemoteResults(uniqueResearchStocks(Array.isArray(payload?.results) ? payload.results : []));
          setSearchSource(payload?.sourceMeta?.source || null);
        }
      } catch (error: any) {
        if (!controller.signal.aborted) { setRemoteResults([]); setSearchSource(null); setSearchError(error?.message || '全市场搜索暂不可用'); }
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 250);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [normalizedQuery]);
  const results = useMemo(() => {
    const localResults = normalizedQuery ? allStocks.filter((stock) => stock.name.toLowerCase().includes(normalizedQuery) || stock.code.toLowerCase().includes(normalizedQuery)) : followedStocks;
    return uniqueResearchStocks([...localResults, ...remoteResults]).slice(0, 8);
  }, [allStocks, followedStocks, normalizedQuery, remoteResults]);
  const select = (stock: StockItem) => { onSelectStock(stock); setQuery(''); setOpen(false); };

  return <section className="rounded-xl border border-slate-200 bg-white">
    <button type="button" onClick={() => setOpen((value) => !value)} className="flex min-h-12 w-full items-center gap-3 px-3 text-left" aria-expanded={open}>
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-50 text-indigo-700"><Search className="h-4 w-4" /></span>
      <span className="min-w-0 flex-1"><span className="block text-[10px] font-semibold text-slate-500">当前研究股票</span><span className="block truncate text-xs font-bold text-slate-900">{selectedStock ? `${selectedStock.name} · ${selectedStock.code}` : '选择一只股票开始分析'}</span></span>
      <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && <div className="border-t border-slate-100 p-3">
      <label className="relative block"><span className="sr-only">搜索股票名称或代码</span><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /><input value={query} onChange={(event) => setQuery(event.target.value)} autoFocus placeholder="输入股票名称或代码" className="h-11 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-10 text-xs text-slate-900 outline-none placeholder:text-slate-500 focus:border-indigo-400 focus:bg-white" />{query && <button type="button" onClick={() => setQuery('')} aria-label="清空搜索" className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center text-slate-500"><X className="h-4 w-4" /></button>}</label>
      {!query && followedStocks.length > 0 && <div className="mt-3 flex items-center gap-1.5 text-[10px] font-bold text-slate-600"><Star className="h-3.5 w-3.5 text-amber-500" />我的自选</div>}
      {!query && followedStocks.length === 0 && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-600">暂无自选股，可以直接输入股票名称或 6 位代码搜索。</p>}
      {normalizedQuery && <p role="status" className="mt-2 text-[10px] text-slate-500">{searching ? '正在搜索全市场股票…' : searchSource ? `全市场结果 · ${searchSource === 'sina_suggest' ? '新浪财经' : searchSource === 'eastmoney_search' ? '东方财富' : '缓存'}` : '本地匹配结果'}</p>}
      <div className="mt-2 space-y-1">{results.map((stock) => { const active = selectedStock?.code === stock.code; const hasQuote = Number.isFinite(stock.changePercent) && stock.price > 0; return <button type="button" key={stock.code} onClick={() => select(stock)} className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left ${active ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}><span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold text-slate-900">{stock.name}</span><span className="font-mono text-[10px] text-slate-500">{stock.code}</span></span>{hasQuote && <span className={`font-mono text-[10px] font-bold ${stock.changePercent >= 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{stock.changePercent >= 0 ? '+' : ''}{stock.changePercent.toFixed(2)}%</span>}{active && <Check className="h-4 w-4 text-indigo-700" />}</button>; })}</div>
      {normalizedQuery && !searching && searchError && <p role="alert" className="mt-3 rounded-lg bg-amber-50 p-2 text-[10px] leading-relaxed text-amber-900">全市场搜索暂不可用，当前仅显示本地匹配结果。</p>}
      {normalizedQuery && !searching && results.length === 0 && <div className="py-6 text-center"><p className="text-xs font-bold text-slate-700">未找到匹配股票</p><p className="mt-1 text-[10px] text-slate-500">请检查名称或 6 位股票代码</p></div>}
    </div>}
  </section>;
}
