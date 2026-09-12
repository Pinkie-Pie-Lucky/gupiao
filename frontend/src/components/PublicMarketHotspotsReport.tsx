import { useCallback, useEffect, useMemo, useState } from 'react';
import { Compass, Database, Home, RefreshCw } from 'lucide-react';
import { ResponsiveAppShell, type AppNavigationItem } from './ResponsiveAppShell';
import { HomeTab, type FrozenHomeSnapshot } from './HomeTab';
import { MarketMapTab, type FrozenMarketMapSnapshot } from './MarketMapTab';
import { useDeviceLayout } from '../hooks/useDeviceLayout';
import type { BubbleSignalItem, SectorIntelligence } from '../types';

type MarketView = 'home' | 'market-map';

type ReportResponse = {
  reportId: string;
  kind: 'market-hotspots';
  generatedAt: string;
  expiresAt: string;
  dataGaps: string[];
  payload: {
    overview?: any;
    marketMap?: { sectors?: SectorIntelligence[]; timestamp?: string };
    morningReport?: FrozenHomeSnapshot['morningReport'];
    dailyPicks?: Array<{ sectorName?: string; rankReason?: string; bubbleExplanation?: string }>;
  };
};

function frozenBubbleItems(payload: ReportResponse['payload']): BubbleSignalItem[] {
  const sectors = payload.marketMap?.sectors || [];
  return (payload.dailyPicks || []).map((pick, index) => {
    const matched = sectors.find((sector) => sector.sector === pick.sectorName);
    return {
      sectorName: pick.sectorName || `板块 ${index + 1}`,
      bubbleScore: Number(matched?.importanceScore) || 50,
      scoreBreakdown: { anomaly: 0, health: 0, capitalAttention: 0, eventSupport: 0 },
      todayChange: matched?.change || '暂无数据',
      signalType: 'price_only',
      healthStatus: 'divergence',
      rankReason: pick.rankReason || pick.bubbleExplanation || matched?.beginnerExplanation || '基于当前市场快照入选。',
      metrics: { priceChange: matched?.change || '暂无数据', upStockRatio: '快照未提供', volumeChange: '快照未提供' },
      supportingSignals: matched?.signalTags || [],
      riskSignals: [],
      evidence: (matched?.relatedNews || []).map((item, relatedIndex) => ({ id: `${matched.sectorId || index}-${relatedIndex}`, title: item.title, sourceName: item.sourceName })),
      mergedSectors: [],
      bubbleExplanation: pick.bubbleExplanation || pick.rankReason || matched?.beginnerExplanation || '',
      confidence: 'limited',
    };
  });
}

function LoadingState({ message }: { message: string }) {
  return <section className="rounded-xl border border-slate-200 bg-white p-5 text-center shadow-sm"><RefreshCw className="mx-auto h-5 w-5 animate-spin text-indigo-600" /><p className="mt-3 text-sm font-semibold text-slate-800">{message}</p></section>;
}

export function PublicMarketHotspotsReport({ reportId }: { reportId: string }) {
  const layout = useDeviceLayout();
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<MarketView>('home');
  const [selectedSectorId, setSelectedSectorId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/reports/${encodeURIComponent(reportId)}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.kind !== 'market-hotspots') throw new Error(payload?.error || '市场报告暂时无法读取，请稍后重试。');
      setReport(payload as ReportResponse);
    } catch (loadError: any) {
      setError(loadError?.message || '市场报告暂时无法读取，请稍后重试。');
    } finally {
      setLoading(false);
    }
  }, [reportId]);

  useEffect(() => { void load(); }, [load]);

  const navigation = useMemo<AppNavigationItem[]>(() => [
    { id: 'home', label: '今日热点', icon: Home, onSelect: () => setActiveView('home') },
    { id: 'market-map', label: '市场地图', icon: Compass, onSelect: () => setActiveView('market-map') },
  ], []);

  const homeSnapshot = useMemo<FrozenHomeSnapshot | undefined>(() => report ? {
    overview: report.payload.overview || {},
    morningReport: report.payload.morningReport,
    dailyPicks: report.payload.dailyPicks || [],
  } : undefined, [report]);
  const marketSnapshot = useMemo<FrozenMarketMapSnapshot | undefined>(() => report ? { overview: report.payload.overview || {}, marketMap: report.payload.marketMap, dailyPicks: frozenBubbleItems(report.payload) } : undefined, [report]);

  let content: React.ReactNode;
  if (loading) content = <LoadingState message="正在读取已生成的市场报告" />;
  else if (error || !report) content = <section role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-center"><Database className="mx-auto h-5 w-5 text-rose-700" /><p className="mt-3 text-sm font-bold text-rose-900">报告读取失败</p><p className="mt-1 text-xs leading-relaxed text-rose-800">{error || '报告不存在或已过期。'}</p><button type="button" onClick={() => void load()} className="mt-4 min-h-10 rounded-lg bg-rose-700 px-4 text-xs font-bold text-white">重新读取</button></section>;
  else content = <>
    {activeView === 'home'
      ? <HomeTab frozenSnapshot={homeSnapshot} onSelectSector={(sectorId) => { setSelectedSectorId(sectorId); setActiveView('market-map'); }} onNavigateToTab={(tabId) => { if (tabId === 'market-map') setActiveView('market-map'); }} onAskTeacherAboutStock={() => undefined} />
      : <MarketMapTab frozenSnapshot={marketSnapshot} selectedSectorId={selectedSectorId} onSelectSectorId={setSelectedSectorId} onNavigateToTab={(tabId) => { if (tabId === 'home') setActiveView('home'); }} onAskTeacherAboutSector={() => undefined} />}
    <p className="px-4 pb-24 text-[10px] leading-relaxed text-slate-400">本公开报告使用生成时冻结的市场快照；不会在阅读、筛选或页面切换时请求实时行情、AI 或社区数据。仅用于信息研究与学习，不构成投资建议。</p>
  </>;

  return <ResponsiveAppShell layout={layout} activeId={activeView} navigation={navigation} title={activeView === 'home' ? '今日热点' : '市场地图'} onRefresh={() => void load()} refreshing={loading} refreshMessage={null} hideRefresh hideProductMeta darkMode={false} onToggleTheme={() => undefined}>{content}</ResponsiveAppShell>;
}
