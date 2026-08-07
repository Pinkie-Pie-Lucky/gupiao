const fs = require('fs');

const content = `/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { TrendingUp, BarChart3, Activity, Newspaper, Clock, MessageCircle, ChevronDown, ChevronUp, Sparkles, Heart, X, ArrowUpRight } from 'lucide-react';

const tagStyles = {
  '今日主线':'bg-violet-100 text-violet-700','异动上涨':'bg-amber-100 text-amber-800',
  '异动放量':'bg-amber-100 text-amber-800','新闻驱动':'bg-sky-100 text-sky-700',
  '资金扩散':'bg-cyan-100 text-cyan-800','值得观察':'bg-slate-100 text-slate-700','与我有关':'bg-rose-100 text-rose-700',
};
const stageStyles = {
  just_starting:{label:'刚刚启动',cls:'bg-green-100 text-green-700 border-green-200'},
  strengthening:{label:'持续走强',cls:'bg-indigo-100 text-indigo-700 border-indigo-200'},
  high_volatility:{label:'高位震荡',cls:'bg-amber-100 text-amber-700 border-amber-200'},
  pullback:{label:'冲高回落',cls:'bg-rose-100 text-rose-700 border-rose-200'},
  cooling_down:{label:'逐步降温',cls:'bg-slate-100 text-slate-700 border-slate-200'},
  no_clear_trend:{label:'暂无明确趋势',cls:'bg-gray-100 text-gray-600 border-gray-200'},
};

export function SectorDetailPanel({ sectorId, sectorName, onClose, onAskTeacher, initialSector }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sections, setSections] = useState(new Set(['overview']));
  const toggle = (k) => setSections(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });

  useEffect(() => {
    let live = true;
    fetch(\`/api/sector-detail?sectorId=\${encodeURIComponent(sectorId)}&sectorName=\${encodeURIComponent(sectorName)}\`)
      .then(r => r.json()).then(d => { if (live) setData(d); })
      .catch(() => {})
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [sectorId, sectorName]);

  if (loading) return <div className="fixed inset-0 bg-black/40 z-50 flex items-end justify-center"><div className="bg-white rounded-t-[32px] w-full max-w-md p-4 animate-pulse"><div className="h-6 bg-slate-100 rounded w-1/3"/>lo</div></div>;
  if (!data) return null;

  const isUp = (data.todayChangePercent || 0) >= 0;
  const Card = ({ label, icon, ibg, id, children }) => (
    <>
      <button onClick={() => toggle(id)} className="w-full flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={\`w-7 h-7 \${ibg||'bg-gray-50'} rounded-lg flex items-center justify-center\`}>{icon}</div>
          <h3 className="text-sm font-bold text-slate-950">{label}</h3>
        </div>
        {sections.has(id) ? <ChevronUp className="w-4 h-4 text-slate-300"/> : <ChevronDown className="w-4 h-4 text-slate-300"/>}
      </button>
      {sections.has(id) && <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 space-y-2">{children}</div>}
    </>
  );

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end justify-center" onClick={onClose}>
      <motion.div initial={{y:'100%'}} animate={{y:0}} exit={{y:'100%'}} transition={{type:'spring',damping:28,stiffness:220}}
        className="bg-white rounded-t-[32px] w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 pt-5 pb-8 space-y-4">
          <div className="flex justify-end"><button onClick={onClose} className="p-1.5 bg-gray-50 rounded-full"><ChevronDown className="w-5 h-5 text-gray-400"/></button></div>

          <div className="space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-950 flex items-center gap-2">
                  {data.sector || sectorName}
                  {data.stage && data.stage !== 'no_clear_trend' && <span className={\`text-[9px] px-1.5 py-0.5 rounded-full border font-bold \${stageStyles[data.stage]?.cls || ''}\`}>{stageStyles[data.stage]?.label || ''}</span>}
                </h2>
                <span className={\`text-3xl font-bold font-mono \${isUp ? 'text-red-600' : 'text-emerald-600'}\`}>{data.todayChange || '--'}</span>
              </div>
              <button className="p-1.5 bg-rose-50 rounded-full text-rose-400"><Heart className="w-4 h-4"/></button>
            </div>

            <div className="flex gap-3 text-[11px] bg-slate-50 rounded-2xl p-3">
              {['今日','近5日','近20日','3个月'].map((l,i) => {
                const v = [data.todayChange,data.change5d,data.change20d,data.change3m][i];
                return <div key={l}><span className="text-slate-400">{l}</span><span className={\`ml-1.5 font-mono font-bold \${v?.startsWith('+')?'text-red-500':v?.startsWith('-')?'text-emerald-500':'text-slate-400'}\`}>{v||'--'}</span></div>;
              })}
            </div>

            <div className="flex flex-wrap gap-1.5">
              {(data.signalTags||[]).slice(0,4).map((t) => <span key={t} className={\`rounded-full px-2 py-1 text-[10px] font-bold \${tagStyles[t]||'bg-slate-100 text-slate-600'}\`}>{t}</span>)}
            </div>
          </div>

          <Card label="板块近期走势" icon={<TrendingUp className="w-3.5 h-3.5 text-indigo-600"/>} ibg="bg-indigo-50" id="trend">
            <div><span className="text-slate-400 text-[11px]">行情阶段</span><span className={\`ml-2 text-[10px] px-1.5 py-0.5 rounded-full border font-bold \${stageStyles[data.stage]?.cls || ''}\`}>{stageStyles[data.stage]?.label || '暂无'}</span></div>
          </Card>

          <Card label="板块内部表现" icon={<BarChart3 className="w-3.5 h-3.5 text-amber-600"/>} ibg="bg-amber-50" id="internal">
            {(data.subdivisions||[]).length > 0 ? (data.subdivisions||[]).map((s,i) => (
              <div key={i} className="flex justify-between py-1 text-xs border-b border-slate-100/60 last:border-0">
                <span>{s.name}</span>
                <span className={\`font-mono font-bold \${s.changePercent>=0?'text-red-500':'text-emerald-500'}\`}>{s.changePercent>=0?'+':''}{s.changePercent?.toFixed(2)}%</span>
              </div>
            )) : <p className="text-[10px] text-slate-400 text-center py-2">暂无内部细分数据</p>}
          </Card>

          <Card label="相关新闻" icon={<Newspaper className="w-3.5 h-3.5 text-sky-600"/>} ibg="bg-sky-50" id="news">
            {(data.news||[]).length > 0 ? (data.news||[]).slice(0,3).map((n,i) => (
              <div key={n.id||i} className="text-xs border-b border-slate-100/60 last:border-0 py-1.5">{n.title||''}</div>
            )) : <p className="text-[10px] text-slate-400 text-center py-2">暂无关联新闻</p>}
          </Card>

          <Card label="后续观察" icon={<Clock className="w-3.5 h-3.5 text-amber-600"/>} ibg="bg-amber-50" id="watch">
            {(data.watchPoints||[]).length > 0 ? (data.watchPoints||[]).map((p,i) => (
              <div key={i} className="flex items-start gap-2 text-[10px] text-slate-600"><span className="text-amber-400">•</span><span>{p}</span></div>
            )) : <p className="text-[10px] text-slate-400">等待更多数据</p>}
          </Card>

          <div className="space-y-2 pt-2">
            <div className="flex items-center gap-2"><div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center"><MessageCircle className="w-3.5 h-3.5 text-white"/></div><h3 className="text-sm font-bold">问泡泡</h3></div>
            <div className="flex flex-wrap gap-2">
              {[\`为什么\${sectorName}今天表现这么突出？\`, \`\${sectorName}现在处于什么阶段？\`].map((q,i) => (
                <button key={i} onClick={() => onAskTeacher?.(sectorName,q)} className="text-[10px] bg-indigo-50 text-indigo-700 border border-indigo-200 px-3 py-2 rounded-xl">{q}</button>
              ))}
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
`;

fs.writeFileSync('l:/原本是c盘的文档/泡泡看市/gupiao-repo/src/components/SectorDetailPanel.tsx', content);
console.log('Written:', content.length, 'bytes');