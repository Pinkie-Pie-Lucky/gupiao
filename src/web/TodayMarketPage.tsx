/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 今日大盘（Web 端 / 桌面）
 * 设计基线：v3 高保真稿
 *  - 左侧深底侧边栏 + 顶栏（在 WebApp 中）
 *  - 内容区：泡泡老师 Banner → 3 张紧凑横排指数卡 → 单栏今天发生了什么
 *      · 今天发生了什么（小白/专业切换 · 为什么会这样展开 · 有用/改进反馈）
 *      · 板块热力 / 涨跌榜 / 我的自选 暂隐藏
 *  - A股配色：涨 #e5484d / 跌 #0ca678；边框 #eef0f3；侧边栏 #0b1120
 */

import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Activity,
  ChevronDown,
  ShieldCheck,
  ThumbsUp,
  ThumbsDown,
  MessageSquare,
  TrendingUp,
  TrendingDown,
  Grid3x3,
  ListOrdered,
  Star,
} from 'lucide-react';
import { MarketStory, StockItem } from '../types';
import { formatChineseDate, mockUserProfile } from '../data';
import { BrainMark } from './BrainMark';
import { useLiveIndices } from './useLiveIndices';
import {
  webStories,
  heatSectors,
  getRankedStocks,
  marketTemperature,
  marketHeadline,
} from './mockWebData';

const UP = '#e5484d';
const DOWN = '#0ca678';
const BORDER = '#eef0f3';

type StoryMode = 'beginner' | 'professional';

interface TodayMarketPageProps {
  followedStocks: StockItem[];
  onAskTeacherAboutStock: (name: string, code: string) => void;
}

/* ----------------------------- 颜色工具 ----------------------------- */

function heatStyle(pct: number) {
  const mag = Math.min(Math.abs(pct), 5) / 5; // 0..1
  const alpha = 0.12 + mag * 0.6; // 0.12..0.72
  const base = pct >= 0 ? '229,72,77' : '12,166,120';
  const textDark = alpha < 0.5;
  return {
    background: `rgba(${base}, ${alpha.toFixed(2)})`,
    color: textDark ? (pct >= 0 ? '#9f1239' : '#047857') : '#ffffff',
    border: `rgba(${base}, ${(alpha * 0.7).toFixed(2)})`,
  };
}

/* ----------------------------- 故事渲染辅助 ----------------------------- */

const TYPE_LABELS: Record<string, string> = {
  sector_driver: '市场热点',
  geo_event: '地缘事件',
  policy_driver: '政策驱动',
  macro_event: '宏观事件',
};

const DRIVER_LABELS: Record<string, string> = {
  primary: '主驱动',
  secondary: '次驱动',
  diffusion: '扩散逻辑',
};

function visibleReasoningSteps(story: MarketStory) {
  const steps = story.reasoning?.steps || [];
  const withoutRepeatedOpening = steps.filter((step, index) => !(index === 0 && step.kind === 'fact'));
  return withoutRepeatedOpening.length > 0 ? withoutRepeatedOpening : steps;
}

/* ===================================================================== */

export function TodayMarketPage({ followedStocks, onAskTeacherAboutStock }: TodayMarketPageProps) {
  const [storyMode, setStoryMode] = useState<StoryMode>('beginner');
  const [expandedStories, setExpandedStories] = useState<Set<string>>(new Set());
  const [thumbsFeedback, setThumbsFeedback] = useState<Record<string, 'up' | 'down' | null>>({});
  // 今天发生了什么：直接请求后端 /api/morning-report 的真实热点（Agent 基于实时行情分析生成），等待期间显示 loading
  const [stories, setStories] = useState<MarketStory[]>(webStories);
  const [storiesLoading, setStoriesLoading] = useState(false);

  // 应用新故事：更新 state（不再写 localStorage，避免刷新后先显示旧缓存）
  const applyStories = (next: MarketStory[]) => {
    setStories(next);
  };

  const loadStories = async (force = false) => {
    try {
      setStoriesLoading(true);
      // cache: 'no-store' 禁止浏览器缓存，保证每次刷新都重新请求后端（否则 GET 会被浏览器拦截返回旧响应）
      const res = await fetch(`/api/morning-report${force ? '?refresh=1' : ''}`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (!Array.isArray(data?.stories) || data.stories.length === 0) return;
      applyStories(data.stories as MarketStory[]);
    } catch {
      // 保持 mock
    } finally {
      setStoriesLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 首次加载（刷新页面）：内容已在 state 初始化时秒显（缓存/上次真实故事），
      // 后台静默刷新；AI 完成后替换内容，不阻塞首屏
      try {
        setStoriesLoading(true);
        const res = await fetch('/api/morning-report?refresh=1', { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled || !Array.isArray(data?.stories) || data.stories.length === 0) return;
        applyStories(data.stories as MarketStory[]);
      } catch {
        // 保持 mock
      } finally {
        if (!cancelled) setStoriesLoading(false);
      }
    })();

    // 每 15 分钟自动刷新一次，仅交易时段（isOpen=true，排除午休/收盘/周末/节假日，由后端 getMarketStatus 统一判断）
    const timer = setInterval(async () => {
      if (cancelled) return;
      try {
        const statusRes = await fetch('/api/market-overview');
        if (!statusRes.ok || cancelled) return;
        const statusData = await statusRes.json();
        if (statusData?.marketStatus?.isOpen === true) {
          loadStories(true);
        }
      } catch {
        // 状态查询失败则不刷新
      }
    }, 15 * 60 * 1000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // 实时指数：与市场地图页共用同一份实时数据（模块级缓存保证两页一致）
  const { indices: liveIndices, isLive, marketStatus } = useLiveIndices();
  // 泡泡解读：加载中显示占位，实时数据到达后一次渲染
  const [liveHeadline, setLiveHeadline] = useState<string | null>(null);

  // 动态泡泡解读：优先用三大指数当前点位与涨跌；拉取失败回退静态口播
  useEffect(() => {
    if (!liveIndices) return;
    if (!isLive) {
      setLiveHeadline(marketHeadline);
      return;
    }
    const byName = (name: string) => liveIndices.find((i) => (i.name || '').includes(name));
    const sh = byName('上证');
    const sz = byName('深证');
    const cy = byName('创业板');
    if (!sh || !sz || !cy) return;
    const upCount = liveIndices.filter((i) => i.changePercent > 0).length;
    const pct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
    const move = upCount >= 2 ? '放量上行' : '分化整理';
    setLiveHeadline(
      `🎈 泡泡老师发现，今日大盘${move}，上证指数约${sh.value.toFixed(2)}点（${pct(sh.changePercent)}），深证成指约${sz.value.toFixed(2)}点，创业板指约${cy.value.toFixed(2)}点。指数普遍走强，关注热点能否持续、以及资金是否出现高位分歧，值得留意后续量能变化。`,
    );
  }, [liveIndices, isLive]);

  const hour = new Date().getHours();
  const greet =
    hour < 6 ? '凌晨好' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';

  const toggleStory = (storyId: string) => {
    setExpandedStories((prev) => {
      const next = new Set(prev);
      if (next.has(storyId)) next.delete(storyId);
      else next.add(storyId);
      return next;
    });
  };

  const handleThumbsUp = (story: MarketStory) => {
    const key = `${storyMode}:${story.storyId}`;
    setThumbsFeedback((prev) => ({ ...prev, [key]: prev[key] === 'up' ? null : 'up' }));
  };
  const handleThumbsDown = (story: MarketStory) => {
    const key = `${storyMode}:${story.storyId}`;
    setThumbsFeedback((prev) => ({ ...prev, [key]: prev[key] === 'down' ? null : 'down' }));
  };

  return (
    <div className="mx-auto max-w-[1320px] px-6 py-6 space-y-6">
      {/* ---------------- 泡泡老师 Banner ---------------- */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="flex flex-col gap-4 rounded-2xl border bg-white p-5 shadow-sm lg:flex-row lg:items-center"
        style={{ borderColor: BORDER }}
      >
        <BrainMark size={52} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900">
            {greet}，{mockUserProfile.name}
          </p>
          <div className="mt-2 rounded-xl border border-indigo-100 bg-indigo-50/60 p-3">
            <p className="text-[11px] font-bold text-indigo-500">泡泡解读</p>
            <p className="mt-1 text-[13px] leading-6 text-gray-700">
              {liveHeadline === null ? '泡泡正在连接实时行情…' : liveHeadline}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2 lg:flex-col">
          <div className="flex items-center gap-2 rounded-xl border border-rose-100 bg-rose-50 px-3 py-2">
            <span className="text-[10px] font-semibold text-rose-500">市场温度</span>
            <span className="font-mono text-sm font-bold text-rose-600">
              {marketTemperature.temp}℃
            </span>
            <span className="text-[10px] font-medium text-rose-400">{marketTemperature.label}</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: marketStatus?.isOpen ? '#10b981' : marketStatus?.isOpen === false ? '#f59e0b' : '#10b981' }} />
            <span className="text-[10px] font-semibold text-emerald-600">
              {marketStatus ? marketStatus.label.replace(/^—\s*/, '') : '盘中'}
            </span>
            <span className="text-[10px] text-emerald-500">{formatChineseDate(new Date())}</span>
          </div>
        </div>
      </motion.section>

      {/* ---------------- 3 张紧凑横排指数卡 ---------------- */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: 0.05 }}
        className="grid grid-cols-1 gap-4 sm:grid-cols-3"
      >
        {liveIndices === null ? (
          // 加载占位：避免先显示 mock 再跳到实时的闪烁
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between rounded-xl border bg-white px-4 py-3" style={{ borderColor: BORDER }}>
              <div className="h-6 w-24 animate-pulse rounded bg-gray-100" />
              <div className="h-5 w-20 animate-pulse rounded bg-gray-100" />
            </div>
          ))
        ) : liveIndices.map((idx) => {
          const up = idx.changePercent >= 0;
          const color = up ? UP : DOWN;
          return (
            <div
              key={idx.code}
              className="group flex items-center justify-between gap-3 rounded-xl border bg-white px-4 py-3 transition-all hover:-translate-y-0.5 hover:shadow-md"
              style={{ borderColor: BORDER }}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                  style={{ background: up ? 'rgba(229,72,77,0.1)' : 'rgba(12,166,120,0.1)', color }}
                >
                  {up ? <TrendingUp size={13} strokeWidth={2.4} /> : <TrendingDown size={13} strokeWidth={2.4} />}
                </span>
                <span className="truncate text-xs font-medium text-gray-500">{idx.name}</span>
              </div>
              <div className="flex shrink-0 items-baseline gap-2">
                <span className="font-mono text-lg font-bold tracking-tight text-gray-900">
                  {idx.value.toFixed(2)}
                </span>
                <span className="font-mono text-xs font-semibold" style={{ color }}>
                  {up ? '+' : ''}
                  {idx.changePercent.toFixed(2)}%
                </span>
              </div>
            </div>
          );
        })}
      </motion.section>

      {/* ---------------- 今天发生了什么（占满整行） ---------------- */}
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-base font-bold text-gray-900">
            <Activity size={18} className="text-indigo-600" />
            今天发生了什么
          </h2>
          <div className="flex items-center rounded-xl bg-[#f1f3f5] p-1" role="group" aria-label="故事阅读模式">
            {(['beginner', 'professional'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={storyMode === mode}
                onClick={() => {
                  setStoryMode(mode);
                  setExpandedStories(new Set());
                }}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                  storyMode === mode ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {mode === 'beginner' ? '小白模式' : '专业模式'}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs leading-5 text-gray-500">
          {storyMode === 'beginner' ? '用一屏看懂事件和最短逻辑' : '查看数据验证、多因素驱动与反向条件'}
        </p>

        <div className="space-y-4">
          {storiesLoading && stories === webStories ? (
            <div className="rounded-2xl border bg-white p-5 text-[12px] text-gray-400" style={{ borderColor: BORDER }}>
              泡泡正在基于实时行情分析今日热点…
            </div>
          ) : stories.map((story) => {
            const expanded = expandedStories.has(story.storyId);
            const reasoningSteps =
              storyMode === 'beginner' && story.teacher.simpleChain?.length
                ? story.teacher.simpleChain.map((text, index) => ({
                    id: `simple-${index + 1}`,
                    text,
                    kind: 'knowledge' as const,
                    evidenceIds: [],
                  }))
                : visibleReasoningSteps(story);
            const professional = story.professional;
            const feedbackKey = `${storyMode}:${story.storyId}`;
            return (
              <article
                key={story.storyId}
                className="rounded-2xl border bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
                style={{ borderColor: BORDER }}
              >
                {/* 标签行 */}
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-bold text-indigo-700">
                    {TYPE_LABELS[story.type] || '市场事件'}
                  </span>
                  {storyMode === 'professional' && (
                    <span className="flex items-center gap-1 text-[11px] text-gray-600">
                      <ShieldCheck size={13} className="text-indigo-500" />
                      证据评分 {professional.confidence.score}/100
                    </span>
                  )}
                </div>

                {/* 标题 + 指标 */}
                <h3 className="mt-3 text-[15px] font-bold leading-7 text-gray-900">{story.title}</h3>
                {story.metrics.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {story.metrics.map((metric) => (
                      <span
                        key={`${metric.label}-${metric.value}`}
                        className="rounded-lg bg-[#f7f8fa] px-2 py-1 text-[11px] font-medium text-gray-600"
                      >
                        {metric.label}：<span className="font-semibold text-gray-800">{metric.value}</span>
                      </span>
                    ))}
                  </div>
                )}

                {/* 正文：小白/专业 */}
                {storyMode === 'beginner' ? (
                  <div className="mt-3 flex gap-3 rounded-xl border border-indigo-100 bg-indigo-50/60 p-3">
                    <BrainMark size={32} className="shrink-0" />
                    <p className="text-[13px] leading-6 text-gray-700">
                      <strong className="text-indigo-800">泡泡解读：</strong>
                      {story.teacher.summary}
                    </p>
                  </div>
                ) : (
                  <div className="mt-3 space-y-3">
                    <div className="rounded-xl bg-indigo-50/60 p-3">
                      <p className="text-[10px] font-bold text-indigo-500">事件结论</p>
                      <p className="mt-0.5 text-[13px] font-medium leading-6 text-gray-800">
                        {professional.conclusion}
                      </p>
                    </div>
                    {professional.drivers.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-[10px] font-bold text-gray-400">核心驱动因素</p>
                        {professional.drivers.map((driver, index) => (
                          <div key={`${driver.role}-${index}`} className="flex items-start gap-2">
                            <span
                              className={`mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                                driver.role === 'primary'
                                  ? 'bg-indigo-100 text-indigo-700'
                                  : driver.role === 'secondary'
                                    ? 'bg-sky-100 text-sky-700'
                                    : 'bg-violet-100 text-violet-700'
                              }`}
                            >
                              {DRIVER_LABELS[driver.role]}
                            </span>
                            <div className="min-w-0">
                              <p className="text-[12px] font-bold text-gray-800">{driver.title}</p>
                              <p className="mt-0.5 text-[11px] leading-5 text-gray-600">{driver.explanation}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 为什么会这样？/ 查看完整逻辑 */}
                {reasoningSteps.length > 0 && (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => toggleStory(story.storyId)}
                      aria-expanded={expanded}
                      className="flex w-full items-center justify-between rounded-xl bg-[#f7f8fa] px-3 py-2.5 text-[13px] font-bold text-gray-700 transition-colors hover:bg-[#f0f1f4]"
                    >
                      <span>{storyMode === 'beginner' ? '为什么会这样？' : '查看完整逻辑'}</span>
                      <ChevronDown size={16} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
                    </button>
                    <AnimatePresence initial={false}>
                      {expanded && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.22 }}
                          className="overflow-hidden"
                        >
                          <div className="mt-2 space-y-3 rounded-2xl border bg-[#fafbfc] p-3" style={{ borderColor: BORDER }}>
                            {storyMode === 'professional' && (
                              <p className="text-[10px] font-bold text-gray-400">完整因果链</p>
                            )}
                            {reasoningSteps.map((step, index) => (
                              <div key={step.id} className="flex gap-2">
                                <div className="flex flex-col items-center">
                                  <span className="flex h-5 w-5 items-center justify-center rounded-full border border-indigo-200 bg-white text-[10px] font-bold text-indigo-700">
                                    {index + 1}
                                  </span>
                                  {index < reasoningSteps.length - 1 && <span className="h-5 w-px bg-indigo-200" />}
                                </div>
                                <div className="min-w-0 flex-1 pb-2">
                                  <p className="text-[12px] leading-6 text-gray-700">{step.text}</p>
                                  {storyMode === 'professional' && (
                                    <span className="text-[10px] text-gray-400">
                                      {step.kind === 'fact' ? '已确认事实' : step.kind === 'knowledge' ? '金融常识' : '合理推断'}
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))}

                            {storyMode === 'beginner' && (story.teacher.uncertaintyText || story.reasoning.uncertainty) && (
                              <p className="border-t border-amber-200/60 pt-2 text-[11px] leading-5 text-amber-800">
                                💭 {story.teacher.uncertaintyText || story.reasoning.uncertainty}
                              </p>
                            )}

                            {storyMode === 'professional' && (
                              <div className="space-y-2 border-t border-gray-200 pt-3">
                                <div>
                                  <p className="text-[10px] font-bold text-emerald-700">支持证据</p>
                                  <ul className="mt-1 space-y-1">
                                    {professional.supportingEvidence.length > 0 ? (
                                      professional.supportingEvidence.map((item) => (
                                        <li key={item} className="text-[11px] leading-5 text-gray-600">
                                          • {item}
                                        </li>
                                      ))
                                    ) : (
                                      <li className="text-[11px] text-gray-500">当前仅有行情事实，暂无额外支持证据。</li>
                                    )}
                                  </ul>
                                </div>
                                <div>
                                  <p className="text-[10px] font-bold text-amber-700">证据缺口</p>
                                  <ul className="mt-1 space-y-1">
                                    {(professional.evidenceGaps.length > 0 ? professional.evidenceGaps : [story.reasoning.uncertainty])
                                      .filter(Boolean)
                                      .map((item) => (
                                        <li key={item} className="text-[11px] leading-5 text-gray-600">
                                          • {item}
                                        </li>
                                      ))}
                                  </ul>
                                </div>
                                <div className="rounded-xl border border-gray-200 bg-white p-3">
                                  <div className="flex items-center justify-between gap-2">
                                    <p className="text-[11px] font-bold text-gray-800">
                                      证据评分 {professional.confidence.score}/100
                                    </p>
                                    <span className="text-[10px] text-gray-500">
                                      {professional.confidence.level === 'high'
                                        ? '较充分'
                                        : professional.confidence.level === 'medium'
                                          ? '中等'
                                          : '有限'}
                                    </span>
                                  </div>
                                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100">
                                    <div
                                      className="h-full rounded-full bg-indigo-500"
                                      style={{ width: `${professional.confidence.score}%` }}
                                    />
                                  </div>
                                  <p className="mt-2 text-[11px] leading-5 text-gray-600">
                                    {professional.confidence.explanation}
                                  </p>
                                </div>
                                {professional.alternativeExplanations.length > 0 && (
                                  <div>
                                    <p className="text-[10px] font-bold text-gray-700">替代解释</p>
                                    {professional.alternativeExplanations.map((item) => (
                                      <p key={item} className="mt-1 text-[11px] leading-5 text-gray-600">
                                        • {item}
                                      </p>
                                    ))}
                                  </div>
                                )}
                                {professional.counterLogic.length > 0 && (
                                  <div>
                                    <p className="text-[10px] font-bold text-rose-700">反向逻辑</p>
                                    {professional.counterLogic.map((item) => (
                                      <p key={item} className="mt-1 text-[11px] leading-5 text-gray-600">
                                        • {item}
                                      </p>
                                    ))}
                                  </div>
                                )}
                                {professional.observationIndicators.length > 0 && (
                                  <div>
                                    <p className="text-[10px] font-bold text-indigo-700">后续观察</p>
                                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                                      {professional.observationIndicators.map((item) => (
                                        <span
                                          key={item}
                                          className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-[10px] leading-4 text-gray-600"
                                        >
                                          {item}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}

                {/* 反馈 */}
                <div className="mt-3 flex items-center justify-end gap-1.5 border-t border-gray-50 pt-2">
                  <button
                    type="button"
                    onClick={() => handleThumbsUp(story)}
                    className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition-all ${
                      thumbsFeedback[feedbackKey] === 'up'
                        ? 'border border-indigo-200 bg-indigo-50 text-indigo-600'
                        : 'text-gray-400 hover:bg-gray-50 hover:text-indigo-500'
                    }`}
                  >
                    <ThumbsUp size={13} className={thumbsFeedback[feedbackKey] === 'up' ? 'fill-indigo-500' : ''} />
                    有用
                  </button>
                  <button
                    type="button"
                    onClick={() => handleThumbsDown(story)}
                    className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition-all ${
                      thumbsFeedback[feedbackKey] === 'down'
                        ? 'border border-rose-200 bg-rose-50 text-rose-600'
                        : 'text-gray-400 hover:bg-gray-50 hover:text-rose-500'
                    }`}
                  >
                    <ThumbsDown size={13} className={thumbsFeedback[feedbackKey] === 'down' ? 'fill-rose-500' : ''} />
                    改进
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* ===== 板块热力 / 涨跌榜 / 我的自选（暂隐藏） ===== */}
      {/* <aside className="space-y-6">
        // 板块热力
        <section>...</section>
        // 涨跌榜
        <section>...</section>
        // 我的自选
        <section>...</section>
      </aside> */}
    </div>
  );
}
