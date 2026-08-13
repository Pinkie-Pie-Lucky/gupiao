import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, ChevronRight, CircleAlert, ExternalLink, Eye, Scale, X } from 'lucide-react';
import { ImpactAnalysis, ImpactNode } from '../types';

interface ImpactAnalysisModalProps {
  analysis: ImpactAnalysis | null;
  open: boolean;
  onClose: () => void;
}

const NODE_STYLE: Record<ImpactNode['type'], { dot: string; border: string; text: string; label: string }> = {
  event: { dot: 'bg-indigo-500', border: 'border-indigo-200 bg-indigo-50/70', text: 'text-indigo-900', label: '事件事实' },
  candidate_cause: { dot: 'bg-amber-500', border: 'border-amber-200 bg-amber-50/70', text: 'text-amber-900', label: '候选原因' },
  changed_variable: { dot: 'bg-sky-500', border: 'border-sky-200 bg-sky-50/70', text: 'text-sky-900', label: '变化变量' },
  mechanism: { dot: 'bg-violet-500', border: 'border-violet-200 bg-violet-50/70', text: 'text-violet-900', label: '传导机制' },
  commodity: { dot: 'bg-orange-500', border: 'border-orange-200 bg-orange-50/70', text: 'text-orange-900', label: '商品变量' },
  sector: { dot: 'bg-emerald-500', border: 'border-emerald-200 bg-emerald-50/70', text: 'text-emerald-900', label: '影响方向' },
  company: { dot: 'bg-teal-500', border: 'border-teal-200 bg-teal-50/70', text: 'text-teal-900', label: '公司影响' },
  market_validation: { dot: 'bg-slate-500', border: 'border-slate-200 bg-slate-50', text: 'text-slate-800', label: '市场验证' },
  counter_factor: { dot: 'bg-rose-500', border: 'border-rose-200 bg-rose-50/70', text: 'text-rose-900', label: '反向因素' },
};

const KNOWLEDGE_LABEL: Record<ImpactNode['knowledgeType'], string> = {
  fact: '事实',
  theory: '机制常识',
  inference: '推导',
  hypothesis: '待验证',
};

const LEVEL_LABEL: Record<ImpactAnalysis['summary']['conclusionLevel'], string> = {
  confirmed: '已确认',
  high_probability: '高概率',
  possible: '可能相关',
  unknown: '驱动待确认',
};

function nodeLevels(analysis: ImpactAnalysis) {
  const children = new Map<string, ImpactNode[]>();
  analysis.edges.forEach((edge) => {
    const child = analysis.nodes.find((node) => node.id === edge.to);
    if (!child) return;
    children.set(edge.from, [...(children.get(edge.from) || []), child]);
  });
  const levels: ImpactNode[][] = [];
  const visited = new Set<string>();
  let current = [analysis.trigger];
  for (let depth = 0; current.length && depth < 4; depth += 1) {
    const unique = current.filter((node) => !visited.has(node.id));
    unique.forEach((node) => visited.add(node.id));
    if (unique.length) levels.push(unique);
    current = unique.flatMap((node) => children.get(node.id) || []);
  }
  const detached = analysis.nodes.filter((node) => !visited.has(node.id) && node.type === 'market_validation');
  if (detached.length) levels.push(detached);
  return levels;
}

export function ImpactAnalysisModal({ analysis, open, onClose }: ImpactAnalysisModalProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [tab, setTab] = useState<'path' | 'evidence' | 'observe'>('path');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const levels = useMemo(() => analysis ? nodeLevels(analysis) : [], [analysis]);
  const selectedNode = analysis?.nodes.find((node) => node.id === selectedNodeId) || analysis?.trigger;

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (analysis) {
      setSelectedNodeId(analysis.trigger.id);
      setTab('path');
    }
  }, [analysis]);

  if (!open || !analysis || !selectedNode) return null;
  const selectedStyle = NODE_STYLE[selectedNode.type];

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-slate-950/45 p-0 sm:p-5" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="impact-analysis-title"
        className="w-full max-h-[94dvh] sm:max-w-5xl sm:max-h-[88vh] overflow-hidden rounded-t-[28px] sm:rounded-[28px] bg-white shadow-2xl flex flex-col"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="shrink-0 border-b border-slate-100 px-4 py-4 sm:px-6 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[10px] font-bold text-indigo-600">
              <span>事件影响路径</span>
              <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-indigo-700">{LEVEL_LABEL[analysis.summary.conclusionLevel]}</span>
            </div>
            <h2 id="impact-analysis-title" className="mt-1 text-base sm:text-lg font-bold text-slate-950 truncate">{analysis.title}</h2>
            <p className="mt-1 text-xs leading-5 text-slate-600">{analysis.summary.eventFact}</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} className="shrink-0 rounded-xl p-2 text-slate-500 hover:bg-slate-100" aria-label="关闭影响路径">
            <X className="h-5 w-5" />
          </button>
        </header>

        <nav className="shrink-0 px-4 sm:px-6 pt-3 flex gap-2 border-b border-slate-100" aria-label="影响路径内容">
          {([
            ['path', '影响路径'],
            ['evidence', '依据与反证'],
            ['observe', '后续观察'],
          ] as const).map(([id, label]) => (
            <button key={id} type="button" onClick={() => setTab(id)} className={`px-3 py-2.5 text-xs font-bold border-b-2 transition-colors ${tab === id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              {label}
            </button>
          ))}
        </nav>

        <div className="min-h-0 overflow-y-auto p-4 sm:p-6">
          {tab === 'path' && (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
              <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3 sm:p-5">
                <p className="mb-4 text-xs font-bold text-slate-700">从“发生了什么”到“可能影响谁”</p>
                <div className="space-y-1">
                  {levels.map((level, index) => (
                    <div key={`level-${index}`}>
                      {index > 0 && <div className="ml-5 flex h-6 items-center text-indigo-300"><ArrowRight className="h-4 w-4 rotate-90" /></div>}
                      <div className={`grid gap-2 ${level.length > 1 ? 'sm:grid-cols-2 xl:grid-cols-3' : ''}`}>
                        {level.map((node) => {
                          const style = NODE_STYLE[node.type];
                          return (
                            <button key={node.id} type="button" onClick={() => setSelectedNodeId(node.id)} className={`text-left rounded-2xl border p-3 transition-shadow hover:shadow-sm ${style.border} ${selectedNode.id === node.id ? 'ring-2 ring-indigo-300' : ''}`}>
                              <div className="flex items-center gap-1.5">
                                <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
                                <span className="text-[9px] font-bold text-slate-500">{style.label} · {KNOWLEDGE_LABEL[node.knowledgeType]}</span>
                              </div>
                              <p className={`mt-1 text-xs font-bold leading-5 ${style.text}`}>{node.title}</p>
                              {node.direction && node.direction !== 'uncertain' && <span className="mt-2 inline-flex rounded-md bg-white/70 px-1.5 py-0.5 text-[9px] font-semibold text-slate-600">{node.direction === 'positive' ? '可能受益' : node.direction === 'negative' ? '可能承压' : '影响分化'}</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <aside className={`rounded-2xl border p-4 ${selectedStyle.border}`}>
                <p className="text-[10px] font-bold text-slate-500">{selectedStyle.label} · {KNOWLEDGE_LABEL[selectedNode.knowledgeType]}</p>
                <h3 className={`mt-1 text-sm font-bold ${selectedStyle.text}`}>{selectedNode.title}</h3>
                <p className="mt-2 text-xs leading-5 text-slate-700">{selectedNode.explanation}</p>
                {selectedNode.knowledgeType === 'hypothesis' && <p className="mt-3 flex gap-1.5 text-[11px] leading-4 text-amber-800"><CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />这是待验证路径，不代表已经确认的驱动关系。</p>}
              </aside>
            </div>
          )}

          {tab === 'evidence' && (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4">
                <p className="text-xs font-bold text-emerald-800">支持依据</p>
                <div className="mt-3 space-y-2">
                  {analysis.evidence.length ? analysis.evidence.map((item) => (
                    <div key={item.id} className="rounded-xl bg-white p-3 border border-emerald-100">
                      <p className="text-xs font-semibold text-slate-800">{item.statement}</p>
                      <p className="mt-1 text-[10px] text-slate-500">{item.sourceName} · {item.reliability === 'primary' ? '一手来源' : item.reliability === 'authoritative' ? '权威数据' : '二手来源'}</p>
                      {item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold text-indigo-600 hover:underline">查看来源 <ExternalLink className="h-3 w-3" /></a>}
                    </div>
                  )) : <p className="text-xs leading-5 text-slate-600">当前没有可展示的来源，结论应维持待验证。</p>}
                </div>
              </div>
              <div className="rounded-2xl border border-rose-100 bg-rose-50/40 p-4">
                <p className="flex items-center gap-1.5 text-xs font-bold text-rose-800"><Scale className="h-3.5 w-3.5" />反证与数据缺口</p>
                <ul className="mt-3 space-y-2">
                  {[...analysis.counterEvidence.map((item) => item.statement), ...analysis.missingEvidence].filter(Boolean).length
                    ? [...analysis.counterEvidence.map((item) => item.statement), ...analysis.missingEvidence].filter(Boolean).map((item) => <li key={item} className="rounded-xl bg-white border border-rose-100 p-3 text-xs leading-5 text-slate-700">{item}</li>)
                    : <li className="text-xs leading-5 text-slate-600">暂无已识别的反证；这不等于路径已经成立。</li>}
                </ul>
              </div>
            </div>
          )}

          {tab === 'observe' && (
            <div className="max-w-2xl rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4">
              <p className="flex items-center gap-1.5 text-xs font-bold text-indigo-800"><Eye className="h-3.5 w-3.5" />接下来观察什么</p>
              <p className="mt-1 text-xs leading-5 text-slate-600">这些指标用于核验路径是否持续成立，不构成交易建议。</p>
              <div className="mt-3 space-y-2">
                {analysis.observationIndicators.length ? analysis.observationIndicators.map((item, index) => <div key={item} className="flex gap-2 rounded-xl bg-white border border-indigo-100 p-3 text-xs leading-5 text-slate-700"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[10px] font-bold text-indigo-700">{index + 1}</span>{item}</div>) : <p className="text-xs text-slate-600">当前没有足够的后续观察指标。</p>}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
