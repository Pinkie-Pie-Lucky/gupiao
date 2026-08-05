/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AI泡泡（Web 端 / 桌面）—— 智能投研问答页
 *  - 左侧：对话流（用户气泡 / AI 气泡 + 结构化分析卡片 + 领涨股 + 追问建议 + 来源标注）
 *  - 右侧：上下文栏（当前板块速览 / 市场概览 + 相关板块 / 监控点 / 相关新闻）
 *  - 底部：输入框（支持追问、回车发送、打字态）
 *
 * 说明：AI 应答由本地离线 mock（askBubble）生成，复用 heatSectors / getSectorDetail /
 * webStories 等数据，不依赖任何外部大模型接口，预览环境可直接运行。
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  MessageSquare,
  Send,
  Paperclip,
  Mic,
  Sparkles,
  TrendingUp,
  TrendingDown,
  Activity,
  Shield,
  BarChart3,
  Newspaper,
  Clock,
  Network,
  Lightbulb,
  Plus,
  CornerDownLeft,
} from 'lucide-react';
import { BrainMark } from './BrainMark';
import {
  heatSectors,
  getSectorDetail,
  getRankedStocks,
  marketTemperature,
  marketHeadline,
  askBubble,
  type BubbleReply,
} from './mockWebData';

const UP = '#e5484d';
const DOWN = '#0ca678';

const colorOf = (v: number) => (v >= 0 ? UP : DOWN);
const pct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;

/* ----------------------------- 轻量 Markdown 渲染 ----------------------------- */

/** 行内粗体 / 代码：**x** → <strong> */
function renderInline(line: string): ReactNode[] {
  const parts = line.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-bold text-gray-900">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}

/** 解析 Markdown 文本为 React 块（标题 / 表格 / 列表 / 段落） */
function MarkdownText({ text }: { text: string }) {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // 表格：连续行以 | 开头且偶数行成分隔线
    if (trimmed.startsWith('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1].trim()) && lines[i + 1].includes('-')) {
      const headerCells = trimmed
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((c) => c.trim());
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(
          lines[i]
            .trim()
            .replace(/^\|/, '')
            .replace(/\|$/, '')
            .split('|')
            .map((c) => c.trim()),
        );
        i++;
      }
      blocks.push(
        <div key={`t-${blocks.length}`} className="my-2 overflow-x-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr>
                {headerCells.map((c, idx) => (
                  <th key={idx} className="bg-gray-50 px-2 py-1.5 text-left font-bold text-gray-700 border border-gray-100">
                    {renderInline(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-2 py-1.5 border border-gray-100 text-gray-700">
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // 标题
    const heading = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const Tag = (level <= 2 ? 'h3' : 'h4') as 'h3' | 'h4';
      blocks.push(
        <Tag key={`h-${blocks.length}`} className="mt-3 mb-1 font-bold text-gray-900 first:mt-0 text-[14px]">
          {renderInline(heading[2])}
        </Tag>,
      );
      i++;
      continue;
    }

    // 列表（- 开头）
    if (/^\s*[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\s*[-*]\s+/, ''));
        i++;
      }
      blocks.push(
        <ul key={`l-${blocks.length}`} className="my-1.5 space-y-0.5 pl-4 list-disc text-[13px] text-gray-700">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // 空行 → 段落间隔
    if (!trimmed) {
      i++;
      continue;
    }

    // 普通段落
    blocks.push(
      <p key={`p-${blocks.length}`} className="my-1.5 text-[13px] leading-6 text-gray-700 first:mt-0">
        {renderInline(trimmed)}
      </p>,
    );
    i++;
  }

  return <div className="space-y-0.5">{blocks}</div>;
}

function findStockSector(code: string) {
  return heatSectors.find((s) => s.stocks.some((st) => st.code === code));
}

interface Msg {
  id: string;
  role: 'user' | 'ai';
  text?: string;
  reply?: BubbleReply;
  pending?: boolean;
}

/* ----------------------------- 初始化对话 ----------------------------- */

function greeting(prefillName?: string, ctxName?: string): string {
  if (prefillName && ctxName) {
    return `AI泡泡已读取你关注的「${prefillName}」及其所属板块「${ctxName}」作为上下文，可以开始追问了。`;
  }
  if (ctxName) {
    return `AI泡泡已读取当前浏览的「${ctxName}」板块作为上下文，你可以继续追问任何市场问题。`;
  }
  return '你好，我是 AI泡泡，你的智能投研助手。问我任意板块或个股的问题，我会结合实时行情与资讯，给你结构化的解读。';
}

function buildInitial(prefill?: { name: string; code: string } | null): { msgs: Msg[]; ctxId?: string } {
  const msgs: Msg[] = [];
  let ctxId: string | undefined;
  let ctxName: string | undefined;
  let prefillName: string | undefined;

  if (prefill) {
    prefillName = prefill.name;
    if (heatSectors.some((s) => s.id === prefill.code)) {
      ctxId = prefill.code;
      ctxName = heatSectors.find((s) => s.id === prefill.code)?.name;
    } else {
      const sec = findStockSector(prefill.code);
      if (sec) {
        ctxId = sec.id;
        ctxName = sec.name;
      }
    }
  }

  msgs.push({ id: 'g', role: 'ai', text: greeting(prefillName, ctxName) });

  if (prefill && ctxId) {
    const q = `为什么「${prefill.name}」今天表现这么突出？`;
    const reply = askBubble(q, ctxId);
    msgs.push({ id: 'u1', role: 'user', text: q }, { id: 'a1', role: 'ai', reply });
  } else if (!prefill) {
    // 无上下文时，预置一段半导体示例对话，让页面首屏即有内容
    ctxId = 'semiconductor';
    const q = '半导体今天为什么涨？资金面怎么样，能不能追？';
    const reply = askBubble(q, 'semiconductor');
    msgs.push({ id: 'u1', role: 'user', text: q }, { id: 'a1', role: 'ai', reply });
  }

  return { msgs, ctxId };
}

/* ----------------------------- 卡片 / 列表样式 ----------------------------- */

const CARD_TONE: Record<string, string> = {
  up: 'text-rose-600',
  down: 'text-emerald-600',
  neutral: 'text-gray-800',
};

/* ----------------------------- 组件 ----------------------------- */

interface AiBubblePageProps {
  prefill?: { name: string; code: string } | null;
  onAskTeacherAboutStock?: (name: string, code: string) => void;
}

export function AiBubblePage({ prefill, onAskTeacherAboutStock }: AiBubblePageProps) {
  const initial = useMemo(() => buildInitial(prefill), [prefill]);
  const [messages, setMessages] = useState<Msg[]>(initial.msgs);
  const [input, setInput] = useState('');
  const [contextId, setContextId] = useState<string | undefined>(initial.ctxId);
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

const handleSend = async (raw?: string) => {
    const text = (raw ?? input).trim();
    if (!text) return;
    const uid = `u-${Date.now()}`;
    const aid = `a-${Date.now()}`;
    setMessages((prev) => [...prev, { id: uid, role: 'user', text }, { id: aid, role: 'ai', pending: true }]);
    setInput('');

    try {
      // 尝试通过 InfiniSynapse API 获取回答
      const response = await fetch('/api/infini/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: contextId ? `关于「${heatSectors.find(s => s.id === contextId)?.name || ''}」板块：${text}` : text,
          taskId: undefined,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        // 把纯文本回复包装成 BubbleReply 格式以兼容现有 UI
        const mockReply: BubbleReply = {
          text: data.reply || data.answer || '',
          cards: [],
          leaders: [],
          closing: '泡泡老师提醒：股市有风险，投资需谨慎！以上研判仅供泡泡模拟盘练习参考，不构成实盘买入建议哦。',
          followups: data.suggestedPrompts || [
            '再详细分析一下',
            '有什么风险需要注意？',
            '对比历史走势怎么看？',
          ],
          sources: ['InfiniSynapse AI', '联网检索'],
        };
        setMessages((prev) => prev.map((m) => (m.id === aid ? { ...m, pending: false, reply: mockReply } : m)));
        return;
      }
    } catch {
      // API 不可用，降级到本地 mock
    }

    // 降级：使用本地 mock 数据
    window.setTimeout(() => {
      const reply = askBubble(text, contextId);
      if (reply.sectorId) setContextId(reply.sectorId);
      setMessages((prev) => prev.map((m) => (m.id === aid ? { ...m, pending: false, reply } : m)));
    }, 520 + Math.random() * 360);
  };

  const handleNewChat = () => {
    setMessages([{ id: 'g', role: 'ai', text: greeting() }]);
    setContextId(undefined);
  };

  const handlePickSector = (id: string) => {
    const s = heatSectors.find((x) => x.id === id);
    if (!s) return;
    setContextId(id);
    handleSend(`帮我分析一下「${s.name}」板块`);
  };

  const detail = contextId ? getSectorDetail(contextId) : null;

  return (
    <div className="flex h-full min-h-0">
      {/* ---------------- 对话区 ---------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 会话子头部 */}
        <div className="flex items-center gap-3 border-b border-[#e8eaed] bg-white/70 px-6 py-3 backdrop-blur">
          <BrainMark size={36} />
          <div className="leading-tight">
            <p className="flex items-center gap-1.5 text-[15px] font-bold text-gray-900">
              AI泡泡
              <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-600">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />在线
              </span>
            </p>
            <p className="text-[11px] text-gray-400">智能投研助手 · 基于实时行情与资讯</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-xl border border-[#e8eaed] bg-white px-3 py-1.5 text-xs font-medium text-gray-500 sm:flex">
              泡泡·深度版
            </span>
            <button
              type="button"
              onClick={handleNewChat}
              className="flex items-center gap-1.5 rounded-xl bg-[#0b1120] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#1a2236]"
            >
              <Plus size={14} /> 新建对话
            </button>
          </div>
        </div>

        {/* 对话流 */}
        <div ref={threadRef} className="custom-scrollbar flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {messages.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[78%] rounded-2xl rounded-br-md bg-[#0b1120] px-4 py-2.5 text-sm leading-relaxed text-white">
                  {m.text}
                </div>
              </div>
            ) : (
              <AiMessage key={m.id} msg={m} onFollow={handleSend} onAsk={onAskTeacherAboutStock} />
            )
          )}
        </div>

        {/* 输入区 */}
        <div className="border-t border-[#e8eaed] bg-white px-6 py-4">
          <div className="flex items-end gap-2 rounded-2xl border border-[#e8eaed] bg-white px-3 py-2 shadow-sm focus-within:border-indigo-300">
            <button type="button" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-gray-400 transition-colors hover:bg-[#f5f6f8] hover:text-indigo-600" title="附件">
              <Paperclip size={17} />
            </button>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              rows={1}
              placeholder="问泡泡任何关于市场、板块、个股的问题…"
              className="max-h-32 flex-1 resize-none bg-transparent py-2 text-sm text-gray-800 outline-none placeholder:text-gray-400"
            />
            <button type="button" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-gray-400 transition-colors hover:bg-[#f5f6f8] hover:text-indigo-600" title="语音">
              <Mic size={17} />
            </button>
            <button
              type="button"
              onClick={() => handleSend()}
              disabled={!input.trim()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
              title="发送"
            >
              <Send size={16} />
            </button>
          </div>
          <p className="mt-2 flex items-center justify-center gap-1 text-[10px] text-gray-400">
            <Sparkles size={11} className="text-indigo-400" />
            AI泡泡可能产生不准确信息 · 投资有风险，决策需谨慎
          </p>
        </div>
      </div>

      {/* ---------------- 上下文栏 ---------------- */}
      <ContextRail detail={detail} contextId={contextId} onPickSector={handlePickSector} />
    </div>
  );
}

/* ----------------------------- AI 消息气泡 ----------------------------- */

function AiMessage({
  msg,
  onFollow,
  onAsk,
}: {
  msg: Msg;
  onFollow: (text: string) => void;
  onAsk?: (name: string, code: string) => void;
}) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 shrink-0">
        <BrainMark size={32} />
      </div>
      <div className="min-w-0 max-w-[82%]">
        {msg.pending ? (
          <div className="inline-flex items-center gap-1 rounded-2xl rounded-tl-md border border-[#e8eaed] bg-white px-4 py-3 shadow-sm">
            <Dot delay="0ms" />
            <Dot delay="150ms" />
            <Dot delay="300ms" />
          </div>
        ) : msg.reply ? (
          <ReplyCard reply={msg.reply} onFollow={onFollow} onAsk={onAsk} />
        ) : (
          <div className="rounded-2xl rounded-tl-md border border-[#e8eaed] bg-white px-4 py-2.5 text-sm leading-relaxed text-gray-800 shadow-sm">
            {msg.text}
          </div>
        )}
      </div>
    </div>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="h-2 w-2 animate-bounce rounded-full bg-indigo-300"
      style={{ animationDelay: delay }}
    />
  );
}

function ReplyCard({
  reply,
  onFollow,
  onAsk,
}: {
  reply: BubbleReply;
  onFollow: (text: string) => void;
  onAsk?: (name: string, code: string) => void;
}) {
  return (
    <div className="rounded-2xl rounded-tl-md border border-[#e8eaed] bg-white px-4 py-3 text-sm leading-relaxed text-gray-800 shadow-sm">
      {reply.text && <MarkdownText text={reply.text} />}

      {/* 结构化卡片 */}
      {reply.cards.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {reply.cards.map((c, i) => (
            <div key={i} className="rounded-xl border border-slate-100 bg-[#f7f8fa] p-2.5">
              <p className="flex items-center gap-1 text-[11px] text-gray-400">
                <Lightbulb size={11} className="text-indigo-500" />
                {c.k}
              </p>
              <p className={`mt-0.5 font-mono text-[13px] font-bold ${CARD_TONE[c.tone ?? 'neutral']}`}>{c.v}</p>
            </div>
          ))}
        </div>
      )}

      {/* 领涨公司 */}
      {reply.leaders.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-bold text-gray-700">
            <Activity size={13} className="text-emerald-600" />
            今日领涨公司
          </p>
          <div className="space-y-1.5">
            {reply.leaders.map((s, i) => (
              <button
                key={s.code}
                type="button"
                onClick={() => onAsk?.(s.name, s.code)}
                className="flex w-full items-center justify-between rounded-xl border border-slate-100 bg-white p-2.5 text-left transition-colors hover:border-indigo-200"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-[10px] font-bold text-gray-400">{i + 1}</span>
                    <span className="truncate text-[13px] font-bold text-gray-900">{s.name}</span>
                    {s.isLeader && <span className="rounded bg-indigo-50 px-1 text-[8px] font-bold text-indigo-600">龙头</span>}
                  </div>
                  {s.reason && <p className="mt-0.5 truncate text-[10px] text-gray-400">{s.reason}</p>}
                </div>
                <span className="ml-2 shrink-0 font-mono text-[12px] font-bold" style={{ color: colorOf(s.pct) }}>
                  {pct(s.pct)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 收尾提示 */}
      {reply.closing && <p className="mt-3 text-[12px] leading-5 text-gray-500">{reply.closing}</p>}

      {/* 追问建议 */}
      {reply.followups.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {reply.followups.map((f, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onFollow(f)}
              className="flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-[11px] font-medium text-indigo-700 transition-colors hover:bg-indigo-100"
            >
              <CornerDownLeft size={11} />
              {f}
            </button>
          ))}
        </div>
      )}

      {/* 来源标注 */}
      {reply.sources.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-gray-100 pt-2.5 text-[10px] text-gray-400">
          <span className="rounded-full bg-sky-50 px-1.5 py-0.5 font-mono text-sky-600">联网检索</span>
          {reply.sources.map((s, i) => (
            <span key={i}>{s}</span>
          ))}
          <span>· 仅供参考，不构成投资建议</span>
        </div>
      )}
    </div>
  );
}

/* ----------------------------- 右侧上下文栏 ----------------------------- */

function ContextRail({
  detail,
  contextId,
  onPickSector,
}: {
  detail: ReturnType<typeof getSectorDetail>;
  contextId?: string;
  onPickSector: (id: string) => void;
}) {
  return (
    <aside className="hidden w-[320px] shrink-0 flex-col border-l border-[#e8eaed] bg-white xl:flex">
      <div className="flex items-center gap-2 border-b border-[#e8eaed] px-5 py-3.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
        <Clock size={14} className="text-indigo-600" />
        当前上下文
      </div>

      <div className="custom-scrollbar flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {detail ? (
          <>
            {/* 板块速览 */}
            <div className="rounded-2xl border border-[#e8eaed] bg-gradient-to-b from-white to-[#fcfcfd] p-4">
              <div className="flex items-baseline justify-between">
                <h3 className="text-[15px] font-bold text-gray-900">{detail.sectorName}</h3>
                <span className="font-mono text-[15px] font-bold" style={{ color: colorOf(detail.todayChangePercent) }}>
                  {pct(detail.todayChangePercent)}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-[#f7f8fa] py-2">
                  <p className="font-mono text-sm font-bold text-emerald-600">{detail.healthMetrics.upCount}</p>
                  <p className="text-[10px] text-gray-400">上涨</p>
                </div>
                <div className="rounded-lg bg-[#f7f8fa] py-2">
                  <p className="font-mono text-sm font-bold text-gray-800">{detail.healthMetrics.totalCount}</p>
                  <p className="text-[10px] text-gray-400">成分股</p>
                </div>
                <div className="rounded-lg bg-[#f7f8fa] py-2">
                  <p className="font-mono text-sm font-bold text-gray-800">{detail.healthMetrics.upRatio}%</p>
                  <p className="text-[10px] text-gray-400">上涨比</p>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px]">
                <span className="text-gray-400">板块龙头</span>
                <span className="font-medium text-gray-800">{detail.leadingStocks[0]?.name ?? '—'}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px]">
                <span className="text-gray-400">近5日</span>
                <span className="font-mono font-semibold" style={{ color: colorOf(detail.change5d ?? 0) }}>
                  {detail.change5d != null ? pct(detail.change5d) : '—'}
                </span>
              </div>
            </div>

            {/* 相关板块（产业链） */}
            {detail.relatedChain.length > 0 && (
              <Section icon={<Network size={14} className="text-cyan-600" />} title="相关板块">
                <div className="flex flex-wrap gap-1.5">
                  {detail.relatedChain.map((c) => (
                    <span key={c} className="rounded-md bg-cyan-50 px-2 py-1 text-[11px] font-medium text-cyan-700">
                      {c}
                    </span>
                  ))}
                </div>
              </Section>
            )}

            {/* 监控点 */}
            {detail.watchPoints.length > 0 && (
              <Section icon={<Shield size={14} className="text-amber-600" />} title="后续观察">
                <ul className="space-y-1.5">
                  {detail.watchPoints.map((p, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-[11px] leading-5 text-gray-600">
                      <span className="mt-1 text-amber-400">•</span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {/* 相关新闻 */}
            {detail.news.length > 0 && (
              <Section icon={<Newspaper size={14} className="text-sky-600" />} title="相关新闻">
                <div className="space-y-2">
                  {detail.news.map((n) => {
                    const cat =
                      n.category === '直接催化'
                        ? 'bg-violet-50 text-violet-700'
                        : n.category === '风险信息'
                          ? 'bg-rose-50 text-rose-600'
                          : n.category === '市场动态'
                            ? 'bg-sky-50 text-sky-700'
                            : 'bg-slate-50 text-slate-600';
                    return (
                      <div key={n.id} className="rounded-lg border border-slate-100 p-2">
                        <p className="text-[11px] font-medium leading-5 text-gray-800">{n.title}</p>
                        <span className={`mt-1 inline-block rounded-full px-1.5 py-0.5 text-[9px] font-medium ${cat}`}>
                          {n.category}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </Section>
            )}
          </>
        ) : (
          <>
            {/* 无上下文：市场概览 + 快速选板块 */}
            <div className="rounded-2xl border border-[#e8eaed] bg-gradient-to-b from-white to-[#fcfcfd] p-4">
              <div className="flex items-center gap-2">
                <span className="text-xl leading-none">{marketTemperature.temp >= 60 ? '🔥' : marketTemperature.temp >= 40 ? '☀️' : '🌧️'}</span>
                <div>
                  <p className="font-mono text-lg font-bold text-gray-900">{marketTemperature.temp}℃</p>
                  <p className="text-[11px] text-rose-500">{marketTemperature.label}</p>
                </div>
              </div>
              <p className="mt-2 text-[11px] leading-5 text-gray-500">{marketHeadline}</p>
            </div>

            <Section icon={<Sparkles size={14} className="text-indigo-600" />} title="快速上下文">
              <div className="flex flex-col gap-1.5">
                {heatSectors.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onPickSector(s.id)}
                    className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2 text-left transition-colors hover:border-indigo-200 hover:bg-indigo-50/40"
                  >
                    <span className="text-[12px] font-medium text-gray-800">{s.name}</span>
                    <span className="font-mono text-[12px] font-semibold" style={{ color: colorOf(s.changePercent) }}>
                      {pct(s.changePercent)}
                    </span>
                  </button>
                ))}
              </div>
            </Section>
          </>
        )}
      </div>
    </aside>
  );
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-[12px] font-bold text-gray-700">
        {icon}
        {title}
      </p>
      {children}
    </div>
  );
}
