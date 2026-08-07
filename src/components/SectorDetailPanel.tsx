/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { TrendingUp, BarChart3, Activity, Newspaper, Clock, MessageCircle, ChevronDown, ChevronUp, Heart, ArrowUpRight, Shield } from 'lucide-react';
import { SectorIntelligence } from '../types';

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

interface SectorDetailPanelProps {
  sectorId: string;
  sectorName: string;
  onClose: () => void;
  onAskTeacher?: (name: string, question: string) => void;
  initialSector?: SectorIntelligence | null;
  isFollowed?: boolean;
  onToggleFollowed?: (sectorId: string) => void;
}

export function SectorDetailPanel({ sectorId, sectorName, onClose, onAskTeacher, initialSector, isFollowed, onToggleFollowed }: SectorDetailPanelProps) {
  const [data, setData] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(true);
  const [showLagging, setShowLagging] = useState(false);
  const [sections, setSections] = useState(new Set(['structure']));
  const toggle = (k) => setSections(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });

  useEffect(() => {
    let live = true;
    fetch(`/api/sector-detail?sectorId=${encodeURIComponent(sectorId)}&sectorName=${encodeURIComponent(sectorName)}`)
      .then(r => r.json()).then(d => { if (live) setData(d); })
      .catch(() => {})
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [sectorId, sectorName]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  if (loading) return <div className="fixed inset-0 bg-black/40 z-50 flex items-end justify-center"><div className="bg-white rounded-t-[32px] w-full max-w-md p-4 animate-pulse"><div className="h-6 bg-slate-100 rounded w-1/3"/></div></div>;
  if (!data) return null;

  const isUp = (data.todayChangePercent || 0) >= 0;
  const Card = ({ label, icon, ibg, id, children }) => (
    <>
      <button onClick={() => toggle(id)} className="w-full flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-7 h-7 ${ibg||'bg-gray-50'} rounded-lg flex items-center justify-center`}>{icon}</div>
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
        role="dialog" aria-modal="true" aria-labelledby="sector-detail-title"
        className="bg-white rounded-t-[28px] w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 pt-5 pb-8 space-y-4">
          <div className="flex justify-end"><button onClick={onClose} aria-label="关闭板块详情" className="min-w-11 min-h-11 flex items-center justify-center bg-gray-50 rounded-full"><ChevronDown className="w-5 h-5 text-gray-500"/></button></div>

          <div className="space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <h2 id="sector-detail-title" className="text-xl font-bold text-slate-950 flex items-center gap-2">
                  {data.sector || sectorName}
                  {data.stage && data.stage !== 'no_clear_trend' && <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-bold ${stageStyles[data.stage]?.cls || ''}`}>{stageStyles[data.stage]?.label || ''}</span>}
                </h2>
                <span className={`text-3xl font-bold font-mono ${isUp ? 'text-red-600' : 'text-emerald-600'}`}>{data.todayChange ?? '--'}</span>
              </div>
              <button
                onClick={() => onToggleFollowed?.(sectorId)}
                className={`min-w-11 min-h-11 flex items-center justify-center rounded-full transition ${isFollowed ? 'bg-rose-50 text-rose-500' : 'bg-rose-50 text-rose-500'}`}
                aria-label={isFollowed ? '取消关注' : '关注板块'}
              >
                <Heart className={`w-4 h-4 ${isFollowed ? 'fill-rose-500 text-rose-500' : ''}`} />
              </button>
            </div>

            <div className="flex gap-3 text-[11px] bg-slate-50 rounded-2xl p-3">
              {['今日','近5日','近20日','3个月'].map((l,i) => {
                const vals = [data.todayChangePercent,data.change5d,data.change20d,data.change3m];
                const v = vals[i];
                const display = v!==null&&v!==undefined ? (v>=0?'+':'')+v.toFixed(2)+'%' : '--';
                return <div key={l}><span className="text-slate-400">{l}</span><span className={`ml-1.5 font-mono font-bold ${v>0?'text-red-500':v<0?'text-emerald-500':'text-slate-400'}`}>{display}</span></div>;
              })}
            </div>

            <div className="flex flex-wrap gap-1.5">
              {(data.signalTags||[]).slice(0,4).map((t) => <span key={t} className={`rounded-full px-2 py-1 text-[10px] font-bold ${tagStyles[t]||'bg-slate-100 text-slate-600'}`}>{t}</span>)}
            </div>
          </div>

          <section className="rounded-2xl bg-indigo-50/70 p-4 space-y-3" aria-label="板块结论">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-indigo-950">今天发生了什么</h3>
              <span className={`rounded-full px-2 py-1 text-[9px] font-bold ${data.insight?.evidenceStatus === 'confirmed' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>
                {data.insight?.evidenceStatus === 'confirmed' ? '有证据支持' : data.insight?.evidenceStatus === 'market_only' ? '仅行情事实' : '证据不足'}
              </span>
            </div>
            <p className="text-xs leading-5 text-indigo-950">{data.insight?.whatHappened || data.bubbleConclusion}</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div><p className="text-[9px] text-indigo-700">板块状态</p><p className="text-[11px] font-bold text-indigo-950">{data.health?.presentation === 'broad_rise' ? '普涨扩散' : data.health?.presentation === 'leader_driven' ? '龙头带动' : data.health?.presentation === 'broad_fall' ? '多数回落' : '内部分化'}</p></div>
              <div><p className="text-[9px] text-indigo-700">上涨覆盖</p><p className="text-[11px] font-bold text-indigo-950">{data.health?.upRatio == null ? '样本不足' : `${data.health.upRatio}%`}</p></div>
              <div><p className="text-[9px] text-indigo-700">样本覆盖</p><p className="text-[11px] font-bold text-indigo-950">{data.health?.sampleCoverage == null ? '--' : `${data.health.sampleCoverage}%`}</p></div>
            </div>
            {data.health?.sampleCoverage != null && data.health.sampleCoverage < 90 && <p className="text-[10px] text-amber-900">样本不完整，内部广度仅供参考。</p>}
            {data.insight?.observationIndicators?.[0] && <p className="text-[10px] leading-4 text-indigo-900"><span className="font-bold">后续观察：</span>{data.insight.observationIndicators[0]}</p>}
            <p className="text-[9px] text-indigo-700">行情更新：{data.health?.dataAsOf ? new Date(data.health.dataAsOf).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '待更新'} · 匹配：{data.insight?.matchQuality || 'none'}</p>
          </section>

          <Card label="板块近期走势" icon={<TrendingUp className="w-3.5 h-3.5 text-indigo-600"/>} ibg="bg-indigo-50" id="trend">
            <div><span className="text-slate-400 text-[11px]">行情阶段</span><span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded-full border font-bold ${stageStyles[data.stage]?.cls || ''}`}>{stageStyles[data.stage]?.label || '暂无'}</span></div>
          </Card>

          <Card label="发生与结构" icon={<Shield className="w-3.5 h-3.5 text-indigo-700"/>} ibg="bg-indigo-50" id="structure">
            <div className="grid grid-cols-3 gap-3 text-[11px] text-center">
              <div className="bg-white rounded-xl p-2.5 border border-slate-100">
                <div className="text-green-600 font-bold text-lg">{(data.healthMetrics?.upCount||0)}</div>
                <div className="text-slate-400">上涨</div>
              </div>
              <div className="bg-white rounded-xl p-2.5 border border-slate-100">
                <div className="text-slate-700 font-bold text-lg">{(data.healthMetrics?.totalCount||0)}</div>
                <div className="text-slate-400">成分股</div>
              </div>
              <div className="bg-white rounded-xl p-2.5 border border-slate-100">
                <div className={'font-bold text-lg '+(data.heatMetrics?.upRatio>=60?'text-green-600':data.heatMetrics?.upRatio>=40?'text-amber-600':'text-red-500')}>{data.heatMetrics?.upRatio??'--'}%</div>
                <div className="text-slate-400">上涨比</div>
              </div>
            </div>
            {data.healthMetrics?.leaderContribution ? <p className="text-[9px] text-slate-400 text-center mt-2">龙头贡献度：{data.healthMetrics.leaderContribution}</p> : null}
          </Card>

          <Card label="证据与反证" icon={<Shield className="w-3.5 h-3.5 text-violet-700"/>} ibg="bg-violet-50" id="evidence">
            <div className="space-y-3 text-[11px]">
              <div>
                <p className="font-bold text-slate-800 mb-1.5">支持线索</p>
                {(data.insight?.supportingEvidence || []).length ? (
                  <ul className="space-y-1 text-slate-600">
                    {data.insight.supportingEvidence.map((item, index) => <li key={index} className="leading-4">• {item}</li>)}
                  </ul>
                ) : <p className="leading-4 text-slate-500">暂无可核验的直接催化线索，当前结论以行情结构为主。</p>}
              </div>
              {(data.insight?.counterEvidence || []).length ? <div>
                <p className="font-bold text-rose-700 mb-1.5">需要留意的反证</p>
                <ul className="space-y-1 text-slate-600">
                  {data.insight.counterEvidence.map((item, index) => <li key={index} className="leading-4">• {item}</li>)}
                </ul>
              </div> : null}
              {data.insight?.confidence?.explanation ? <p className="pt-2 border-t border-slate-200 text-slate-500 leading-4">置信说明：{data.insight.confidence.explanation}</p> : null}
            </div>
          </Card>

          <Card label="板块内部表现" icon={<BarChart3 className="w-3.5 h-3.5 text-amber-600"/>} ibg="bg-amber-50" id="internal">
            {(data.subdivisions||[]).length > 0 ? (data.subdivisions||[]).map((s,i) => (
              <div key={i} className="flex justify-between py-1 text-xs border-b border-slate-100/60 last:border-0">
                <span>{s.name}</span>
                <span className={`font-mono font-bold ${s.changePercent>=0?'text-red-500':'text-emerald-500'}`}>{s.changePercent>=0?'+':''}{s.changePercent?.toFixed(2)}%</span>
              </div>
            )) : <p className="text-[10px] text-slate-400 text-center py-2">暂无内部细分数据</p>}
          </Card>

          {(data.relatedChain||[]).length > 0 ? <Card label="产业链图谱" icon={<ArrowUpRight className="w-3.5 h-3.5 text-cyan-600"/>} ibg="bg-cyan-50" id="chain">
            <div className="space-y-1.5">
              {(data.relatedChain||[]).map(function(step,i){return <div key={i} className="flex items-center gap-2 text-[10px]"><span className="w-5 h-5 rounded-full bg-cyan-100 text-cyan-700 flex items-center justify-center font-bold text-[9px]">{i+1}</span><button onClick={function(){onAskTeacher?.(step+'板块分析','看一下'+step+'板块现在是什么情况？')}} className="text-cyan-700 hover:text-cyan-900 hover:underline font-medium cursor-pointer">{step}</button></div>;})}
            </div>
          </Card> : null}

          <Card label="代表股票" icon={<Activity className="w-3.5 h-3.5 text-emerald-600"/>} ibg="bg-emerald-50" id="stocks">
            {(data.representativeStocks?.strength || data.leadingStocks || []).length > 0 ? (
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-slate-700">综合强势</p>
                {(data.representativeStocks?.strength || data.leadingStocks || []).slice(0,3).map(function(s,i) {
                  return <div key={s.code||i} className="bg-white rounded-2xl border border-slate-100 p-3 flex items-center justify-between hover:border-indigo-100 transition-all">
                    <div>
                      <span className="text-xs font-bold text-slate-900">{s.name||'加载中'}</span>
                      {s.isLeader ? <span className="ml-1 text-[8px] bg-indigo-50 text-indigo-600 px-1 rounded font-bold">龙头</span> : null}
                      <p className="text-[9px] text-slate-400 mt-0.5">{s.reason||''}</p>
                      {s.totalMarketCap ? <p className="text-[9px] text-slate-400">市值 {s.totalMarketCap}亿</p> : null}
                    </div>
                    <span className={'font-mono font-bold '+(s.changePercent>=0?'text-red-500':'text-emerald-500')}>{s.changePercent>=0?'+':''}{s.changePercent.toFixed(2)+'%'}</span>
                  </div>;
                })}
                {(data.representativeStocks?.leaders || []).length ? <div className="pt-2 border-t border-slate-200"><p className="text-[10px] font-bold text-slate-700 mb-1.5">板块龙头</p><div className="flex flex-wrap gap-1.5">{data.representativeStocks.leaders.slice(0,3).map((s,i) => <span key={s.code||i} className="rounded-full bg-indigo-50 px-2 py-1 text-[10px] text-indigo-800">{s.name} {s.changePercent >= 0 ? '+' : ''}{s.changePercent?.toFixed(2)}%</span>)}</div></div> : null}
                {(data.representativeStocks?.unusual || []).length ? <div className="pt-2 border-t border-slate-200"><p className="text-[10px] font-bold text-slate-700 mb-1.5">异动放量</p><div className="flex flex-wrap gap-1.5">{data.representativeStocks.unusual.slice(0,3).map((s,i) => <span key={s.code||i} className="rounded-full bg-amber-50 px-2 py-1 text-[10px] text-amber-800">{s.name} 量比 {s.volumeRatio?.toFixed(1) || '--'}</span>)}</div></div> : null}
                {(data.laggingStocks||[]).length > 0 ? <><button onClick={function(){setShowLagging(v => !v)}} className="text-[10px] text-slate-400 font-medium">查看表现较弱的公司 <ChevronDown className="w-3 h-3 inline"/></button>
                {showLagging ? (data.laggingStocks||[]).slice(0,3).map(function(s,i) {
                  return <div key={s.code||i} className="bg-white rounded-2xl border border-slate-100 p-3 flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-700">{s.name}</span>
                    <span className={'font-mono font-bold '+(s.changePercent>=0?'text-red-500':'text-emerald-500')}>{s.changePercent>=0?'+':''}{s.changePercent.toFixed(2)+'%'}</span>
                  </div>;
                }) : null}</> : null}
                <p className="text-[9px] text-slate-400 pt-1">领涨仅代表当前表现，不构成投资建议。</p>
              </div>
            ) : <p className="text-[10px] text-slate-400 text-center py-2">代表股票数据加载中...</p>}
          </Card>

          <Card label="相关新闻" icon={<Newspaper className="w-3.5 h-3.5 text-sky-600"/>} ibg="bg-sky-50" id="news">
            {(data.news||[]).length > 0 ? (data.news||[]).slice(0,6).map(function(n,i) {
              var catStyles = { '直接催化':'bg-violet-50 text-violet-700', '风险信息':'bg-rose-50 text-rose-600', '行业背景':'bg-sky-50 text-sky-700', '市场动态':'bg-slate-50 text-slate-600' };
              return <div key={n.id||i} className="border-b border-slate-100/60 last:border-0 py-2 space-y-1">
                <div className="text-xs font-medium text-slate-800 leading-relaxed">{n.title||''}</div>
                <div className="flex items-center gap-2">
                  <span className={'text-[9px] px-1.5 py-0.5 rounded-full font-medium '+(catStyles[n.category]||'bg-slate-50 text-slate-500')}>{n.category||'一般'}</span>
                  {n.summary ? <span className="text-[9px] text-slate-400">{n.summary}</span> : null}
                </div>
              </div>;
            }) : <p className="text-[10px] text-slate-400 text-center py-2">暂无关联新闻</p>}
          </Card>

          <Card label="后续观察" icon={<Clock className="w-3.5 h-3.5 text-amber-600"/>} ibg="bg-amber-50" id="watch">
            {(data.watchPoints||[]).length > 0 ? (data.watchPoints||[]).map((p,i) => (
              <div key={i} className="flex items-start gap-2 text-[10px] text-slate-600"><span className="text-amber-400">•</span><span>{p}</span></div>
            )) : <p className="text-[10px] text-slate-400">等待更多数据</p>}
          </Card>

          <div className="space-y-2 pt-2">
            <div className="flex items-center gap-2"><div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center"><MessageCircle className="w-3.5 h-3.5 text-white"/></div><h3 className="text-sm font-bold">问泡泡</h3></div>
            <div className="flex flex-wrap gap-2">
              {[`为什么${sectorName}今天表现这么突出？`, `${sectorName}现在处于什么阶段？`].map((q,i) => (
                <button key={i} onClick={() => onAskTeacher?.(sectorName,q)} className="text-[10px] bg-indigo-50 text-indigo-700 border border-indigo-200 px-3 py-2 rounded-xl">{q}</button>
              ))}
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
