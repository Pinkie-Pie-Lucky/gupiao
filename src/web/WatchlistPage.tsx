/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WatchlistPage —— Web 端「我的关注」页面（真实组件）。
 *
 * 设计约束（与产品定位一致）：
 *  - 产品不接入用户真实资产 / 持仓数据，因此本页【绝不】展示总资产、持仓、
 *    盈亏等需要真实仓位才能得出的字段；顶部统计只用「关注维度」的公开行情。
 *  - 右侧栏原本的「账户概览」卡片（自选总市值 / 持仓收益）已按约束移除，
 *    改为只保留用户自定义的「近期预警」与「快捷操作」。
 *
 * 结构：
 *  - 顶部 4 张概览卡（关注个股 / 今日平均涨跌幅 / 价格预警 / 板块关注）
 *  - 主面板：标签页（自选股 / 价格预警 / 板块关注）+ 工具栏 + 内容
 *  - 右侧栏：近期预警 + 快捷操作
 */

import { useState, type ReactNode } from 'react';
import { Plus, Star, Bell, Trash2, MessageSquare, ChevronDown, Search } from 'lucide-react';
import {
  watchlistStocks,
  watchlistAlerts,
  watchlistSectors,
  watchlistStats,
  type WatchlistStock,
} from './mockWebData';

const UP = '#e5484d';
const DOWN = '#0ca678';
const BORDER = '#eef0f3';

function fmtPct(v: number) {
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

/** 轻量走势迷你图：把数值序列归一化到 64×22 的 viewBox */
function Sparkline({ points, up }: { points: number[]; up: boolean }) {
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = 64 / (points.length - 1);
  const coords = points
    .map((p, i) => {
      const x = i * step;
      const y = 20 - ((p - min) / span) * 18;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width="64" height="22" viewBox="0 0 64 22" className="overflow-visible">
      <polyline points={coords} fill="none" stroke={up ? UP : DOWN} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function StatCard({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'up' | 'down' }) {
  const subColor = tone === 'up' ? UP : tone === 'down' ? DOWN : '#6b7280';
  return (
    <div className="rounded-2xl border border-[#eef0f3] bg-white p-4 shadow-sm">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1.5 text-2xl font-bold text-gray-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs font-medium" style={{ color: subColor }}>{sub}</p>}
    </div>
  );
}

type Tab = 'stocks' | 'alerts' | 'sectors';

export function WatchlistPage({ onAskTeacherAboutStock }: { onAskTeacherAboutStock?: (name: string, code: string) => void }) {
  const [tab, setTab] = useState<Tab>('stocks');
  const [filter, setFilter] = useState<'全部' | '持仓' | '自选' | '预警'>('全部');
  const [list, setList] = useState<WatchlistStock[]>(watchlistStocks);

  const removeStock = (code: string) => setList((prev) => prev.filter((s) => s.code !== code));

  return (
    <div className="mx-auto max-w-[1320px] px-6 py-6">
      {/* ===== 顶部概览卡（全部持有无关） ===== */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="关注个股" value={watchlistStats.followed} sub="自选 + 追踪" />
        <StatCard
          label="今日平均涨跌幅"
          value={fmtPct(watchlistStats.avgChange)}
          sub={`${list.filter((s) => s.changePercent >= 0).length} 涨 / ${list.filter((s) => s.changePercent < 0).length} 跌`}
          tone={watchlistStats.avgChange >= 0 ? 'up' : 'down'}
        />
        <StatCard label="价格预警" value={watchlistStats.alerts} sub="触发中 1" />
        <StatCard label="板块关注" value={watchlistStats.sectors} sub="半导体 · 新能源" />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_300px]">
        {/* ===== 主面板 ===== */}
        <div className="rounded-2xl border border-[#eef0f3] bg-white shadow-sm">
          {/* 标签页 */}
          <div className="flex border-b border-[#eef0f3] px-2">
            {([
              { id: 'stocks', label: '自选股' },
              { id: 'alerts', label: '价格预警' },
              { id: 'sectors', label: '板块关注' },
            ] as { id: Tab; label: string }[]).map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`relative px-4 py-3.5 text-sm font-medium transition-colors ${
                  tab === t.id ? 'text-indigo-600' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {t.label}
                {tab === t.id && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-indigo-600" />}
              </button>
            ))}
          </div>

          {/* 工具栏 */}
          <div className="flex flex-wrap items-center gap-3 border-b border-[#eef0f3] px-4 py-3">
            <button className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700">
              <Plus size={15} /> 添加自选
            </button>
            <div className="flex gap-1.5">
              {(['全部', '持仓', '自选', '预警'] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setFilter(c)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    filter === c ? 'bg-indigo-50 text-indigo-600' : 'border border-[#eef0f3] text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
            <button className="ml-auto flex items-center gap-1 rounded-lg border border-[#eef0f3] px-3 py-1.5 text-xs text-gray-500">
              涨跌幅排序 <ChevronDown size={13} />
            </button>
          </div>

          {/* 自选股 */}
          {tab === 'stocks' && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400">
                  <th className="px-4 py-2.5 text-left font-medium">名称 / 代码</th>
                  <th className="px-4 py-2.5 text-right font-medium">最新价</th>
                  <th className="px-4 py-2.5 text-right font-medium">涨跌幅</th>
                  <th className="px-4 py-2.5 text-right font-medium">涨跌额</th>
                  <th className="px-4 py-2.5 text-right font-medium">成交额</th>
                  <th className="px-4 py-2.5 text-right font-medium">换手</th>
                  <th className="px-4 py-2.5 text-center font-medium">走势</th>
                  <th className="px-4 py-2.5 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {list.map((s) => {
                  const up = s.changePercent >= 0;
                  return (
                    <tr key={s.code} className="border-t border-[#f3f4f6] transition-colors hover:bg-[#fafbff]">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-sm font-bold text-indigo-600">
                            {s.name.slice(0, 1)}
                          </div>
                          <div>
                            <div className="font-semibold text-gray-900">
                              {s.name}
                              {s.tag && (
                                <span
                                  className="ml-1.5 rounded px-1 py-0.5 text-[10px] font-semibold"
                                  style={s.tag === '龙头' ? { background: '#fff1f0', color: UP } : { background: '#fff7ed', color: '#ea580c' }}
                                >
                                  {s.tag}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-400">{s.shortCode}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900">¥{s.price.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right font-semibold" style={{ color: up ? UP : DOWN }}>{fmtPct(s.changePercent)}</td>
                      <td className="px-4 py-3 text-right" style={{ color: up ? UP : DOWN }}>{up ? '+' : ''}{s.change.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{s.turnover}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{s.turnoverRate}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-center">
                          <Sparkline points={s.spark} up={up} />
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => onAskTeacherAboutStock?.(s.name, s.code)}
                            title="问泡泡"
                            className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 transition-colors hover:bg-indigo-100"
                          >
                            <MessageSquare size={14} />
                          </button>
                          <button title="预警" className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#eef0f3] text-gray-400 transition-colors hover:text-indigo-600">
                            <Bell size={14} />
                          </button>
                          <button
                            onClick={() => removeStock(s.code)}
                            title="删除"
                            className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#eef0f3] text-gray-400 transition-colors hover:text-rose-500"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* 价格预警 */}
          {tab === 'alerts' && (
            <ul className="divide-y divide-[#f3f4f6]">
              {watchlistAlerts.map((a) => (
                <li key={a.name} className="px-4 py-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold text-gray-900">{a.name}</span>
                    <span className="text-gray-500">{a.condition}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#eef0f3]">
                      <div className="h-full rounded-full" style={{ width: `${a.progress}%`, background: a.dir === 'up' ? UP : DOWN }} />
                    </div>
                    <span className="text-xs text-gray-400">{a.current} · {a.progress}%</span>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* 板块关注 */}
          {tab === 'sectors' && (
            <ul className="divide-y divide-[#f3f4f6]">
              {watchlistSectors.map((sec) => {
                const up = sec.changePercent >= 0;
                return (
                  <li key={sec.name} className="flex items-center justify-between px-4 py-3.5">
                    <span className="flex items-center gap-2 font-medium text-gray-800">
                      <Star size={15} className="text-indigo-500" /> {sec.name}
                    </span>
                    <span className="font-semibold" style={{ color: up ? UP : DOWN }}>{fmtPct(sec.changePercent)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* ===== 右侧栏（已移除「账户概览」卡片） ===== */}
        <div className="flex flex-col gap-5">
          {/* 近期预警 */}
          <div className="rounded-2xl border border-[#eef0f3] bg-white p-4 shadow-sm">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-gray-900">
              <span className="h-2 w-2 rounded-full bg-indigo-600" /> 近期预警
            </h3>
            <div className="space-y-3">
              {watchlistAlerts.map((a) => (
                <div key={a.name}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-gray-800">{a.name}</span>
                    <span className="text-gray-400">{a.condition}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#eef0f3]">
                    <div className="h-full rounded-full" style={{ width: `${a.progress}%`, background: a.dir === 'up' ? UP : DOWN }} />
                  </div>
                  <p className="mt-1 text-[11px] text-gray-400">{a.current} · 进度 {a.progress}%</p>
                </div>
              ))}
            </div>
          </div>

          {/* 快捷操作 */}
          <div className="rounded-2xl border border-[#eef0f3] bg-white p-4 shadow-sm">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-gray-900">
              <span className="h-2 w-2 rounded-full bg-indigo-600" /> 快捷操作
            </h3>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => onAskTeacherAboutStock?.('中芯国际', '688981.SH')}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
              >
                <MessageSquare size={15} /> 问泡泡诊股 · 中芯国际
              </button>
              <button className="flex items-center justify-center gap-1.5 rounded-xl border border-[#eef0f3] py-2.5 text-sm font-medium text-gray-600 transition-colors hover:border-indigo-300 hover:text-indigo-600">
                <Plus size={15} /> 添加自选股
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-dashed border-[#e5e7eb] bg-[#fafbfc] p-3 text-[11px] leading-relaxed text-gray-400">
            泡泡看市不接入您的真实持仓与资产数据，所有自选与预警均由您本地维护。
          </div>
        </div>
      </div>
    </div>
  );
}
