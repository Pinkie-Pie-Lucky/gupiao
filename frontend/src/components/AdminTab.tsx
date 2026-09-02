/**
 * 管理后台（仅 admin 角色可见入口；权限闸门在后端 /api/admin/* 的 403）。
 * 数据：访问概览（UV/PV/DAU/新增注册）、30 天趋势、来源/设备/平台分布、用户管理与封禁。
 */
import { useCallback, useEffect, useState } from 'react';
import { Ban, ChevronLeft, ChevronRight, Clock, Globe, MonitorSmartphone, RefreshCw, Search, ShieldCheck, Timer, Undo2 } from 'lucide-react';
import {
  apiAdminOverview, apiAdminTraffic, apiAdminUsers, apiAdminUpdateUserStatus, apiAdminPages,
  ApiError, type AdminOverview, type AdminTraffic, type AdminUserRow, type AdminPageStats,
} from '../lib/api';

interface AdminTabProps {
  currentUserId: string;
}

const PAGE_SIZE = 20;

function maskPhone(phone: string): string {
  return phone.length === 11 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : phone;
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** 毫秒 → 「x 分 x 秒 / x 秒 / x 小时 x 分」 */
function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '--';
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds} 秒`;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return seconds ? `${hours} 时 ${minutes} 分 ${seconds} 秒` : `${hours} 时 ${minutes} 分`;
  return seconds ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`;
}

const PLATFORM_LABELS: Record<string, string> = { web: '网页', app: 'App', miniprogram: '小程序' };
const DEVICE_LABELS: Record<string, string> = { mobile: '手机', tablet: '平板', desktop: '桌面' };
const PAGE_LABELS: Record<string, string> = {
  home: '首页', 'market-map': '市场地图', watchlist: '我的关注', 'stock-screener': '条件选股',
  'stock-research': '个股分析', 'ai-teacher': 'AI 泡泡', mine: '个人中心', admin: '管理后台',
};

function StatCard({ label, items }: { label: string; items: Array<{ key: string; value: number }> }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
        {items.map((item) => (
          <div key={item.key}>
            <dt className="text-[11px] text-slate-400">{item.key}</dt>
            <dd className="text-lg font-bold tabular-nums text-slate-900">{item.value.toLocaleString()}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** 纯 CSS 柱状趋势图（不引图表库）；hover 显示日期与数值 */
function DailyTrend({ daily }: { daily: AdminTraffic['daily'] }) {
  const max = Math.max(1, ...daily.map((item) => item.pv));
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold text-slate-500">近 {daily.length} 天访问趋势</p>
      <div className="mt-3 flex h-32 items-end gap-[3px]" role="img" aria-label="按天访问量柱状图">
        {daily.map((item) => (
          <div key={item.date} className="group relative flex h-full flex-1 items-end" title={`${item.date}：PV ${item.pv} / UV ${item.uv}`}>
            <div className="w-full rounded-t bg-indigo-500/80 transition group-hover:bg-indigo-600" style={{ height: `${Math.max(3, (item.pv / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-slate-400">
        <span>{daily[0]?.date.slice(5) ?? ''}</span>
        <span>今日</span>
      </div>
    </div>
  );
}

function DistributionBars({ title, icon, rows, labels }: { title: string; icon: React.ReactNode; rows: Array<{ name: string; count: number }>; labels?: Record<string, string> }) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">{icon}{title}</p>
      {rows.length === 0 ? (
        <p className="mt-3 text-xs text-slate-400">暂无数据</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((row) => (
            <li key={row.name} className="text-xs">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-slate-700">{labels?.[row.name] ?? row.name}</span>
                <span className="shrink-0 tabular-nums text-slate-500">{row.count.toLocaleString()}（{total > 0 ? Math.round((row.count / total) * 100) : 0}%）</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded bg-slate-100">
                <div className="h-full rounded bg-indigo-500/80" style={{ width: `${total > 0 ? Math.max(2, (row.count / total) * 100) : 0}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AdminTab({ currentUserId }: AdminTabProps) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [traffic, setTraffic] = useState<AdminTraffic | null>(null);
  const [pages, setPages] = useState<AdminPageStats[]>([]);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [userTotal, setUserTotal] = useState(0);
  const [page, setPage] = useState(1);            // 用户列表页码（1 起）
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [nextOverview, nextTraffic, nextPages, nextUsers] = await Promise.all([
        apiAdminOverview(),
        apiAdminTraffic(30),
        apiAdminPages(30),
        apiAdminUsers(search, (page - 1) * PAGE_SIZE, PAGE_SIZE),
      ]);
      setOverview(nextOverview);
      setTraffic(nextTraffic);
      setPages(nextPages.pages);
      setUsers(nextUsers.rows);
      setUserTotal(nextUsers.total);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载失败，请稍后重试。');
    } finally {
      setLoading(false);
    }
  }, [search, page]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  const totalPages = Math.max(1, Math.ceil(userTotal / PAGE_SIZE));
  const gotoPage = (next: number) => setPage(Math.min(Math.max(1, next), totalPages));

  const toggleStatus = async (user: AdminUserRow) => {
    if (user.id === currentUserId) return;
    setPendingUserId(user.id);
    try {
      const next = user.status === 'banned' ? 'active' : 'banned';
      await apiAdminUpdateUserStatus(user.id, next);
      setUsers((prev) => prev.map((row) => (row.id === user.id ? { ...row, status: next } : row)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '操作失败，请稍后重试。');
    } finally {
      setPendingUserId(null);
    }
  };

  return (
    <main className="px-4 pb-24 pt-3">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-medium text-indigo-600"><ShieldCheck className="h-3.5 w-3.5" />管理后台</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">运营概览</h1>
        </div>
        <button type="button" onClick={() => void loadAll()} disabled={loading} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />刷新
        </button>
      </header>

      {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}

      <section className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="访问概览">
        {overview ? (
          <>
            <StatCard label="今日" items={[
              { key: '访问人数(UV)', value: overview.today.uv },
              { key: '浏览量(PV)', value: overview.today.pv },
              { key: '登录用户(DAU)', value: overview.today.dau },
              { key: '新增注册', value: overview.today.newUsers },
            ]} />
            <StatCard label="近 7 天" items={[
              { key: '访问人数(UV)', value: overview.recent7d.uv },
              { key: '浏览量(PV)', value: overview.recent7d.pv },
              { key: '登录用户(DAU)', value: overview.recent7d.dau },
              { key: '新增注册', value: overview.recent7d.newUsers },
            ]} />
            <StatCard label="近 30 天" items={[
              { key: '访问人数(UV)', value: overview.recent30d.uv },
              { key: '浏览量(PV)', value: overview.recent30d.pv },
              { key: '登录用户(DAU)', value: overview.recent30d.dau },
              { key: '新增注册', value: overview.recent30d.newUsers },
            ]} />
          </>
        ) : (
          <div className="grid h-28 place-items-center rounded-xl border border-slate-200 bg-white text-xs text-slate-400 sm:col-span-3">加载中…</div>
        )}
      </section>

      <section className="mt-3" aria-label="平均使用时长">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-500"><Clock className="h-3.5 w-3.5" />今日平均使用时长</p>
          {overview ? (
            <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="text-2xl font-bold tabular-nums text-slate-900">{formatDuration(overview.sessionDuration.avgSessionDurationMs)}</span>
              {overview.sessionDuration.byPlatform.length > 0 && (
                <span className="flex flex-wrap gap-x-3 text-xs text-slate-500">
                  {overview.sessionDuration.byPlatform.map((item) => (
                    <span key={item.platform}>{PLATFORM_LABELS[item.platform] ?? item.platform}：{formatDuration(item.avgSessionDurationMs)}（{item.sessions} 次）</span>
                  ))}
                </span>
              )}
              {overview.sessionDuration.avgSessionDurationMs == null && <span className="text-xs text-slate-400">今日暂无页面浏览数据</span>}
            </div>
          ) : (
            <div className="mt-2 h-7 animate-pulse rounded bg-slate-100" />
          )}
          <p className="mt-1.5 text-[11px] text-slate-400">按每次访问（session）汇总页面停留时长后取平均；细分到网页 / App / 小程序。</p>
        </div>
      </section>

      <section className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2" aria-label="访问趋势与来源">
        {traffic && <DailyTrend daily={traffic.daily} />}
        {traffic && <DistributionBars title="访问来源（近 30 天）" icon={<Globe className="h-3.5 w-3.5" />} rows={traffic.referers.map((row) => ({ name: row.referer === 'direct' ? '直接访问' : row.referer, count: row.count }))} />}
        {traffic && <DistributionBars title="设备分布" icon={<MonitorSmartphone className="h-3.5 w-3.5" />} rows={traffic.devices.map((row) => ({ name: row.device, count: row.count }))} labels={DEVICE_LABELS} />}
        {traffic && <DistributionBars title="访问平台" icon={<ShieldCheck className="h-3.5 w-3.5" />} rows={traffic.platforms.map((row) => ({ name: row.platform, count: row.count }))} labels={PLATFORM_LABELS} />}
      </section>

      <section className="mt-4" aria-label="页面浏览时长">
        <h2 className="text-xs font-semibold text-slate-500">页面浏览与停留时长（近 30 天）</h2>
        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[480px] text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] text-slate-400">
                <th className="px-4 py-2.5 font-semibold">页面</th>
                <th className="px-4 py-2.5 font-semibold text-right">浏览次数</th>
                <th className="px-4 py-2.5 font-semibold text-right">平均停留</th>
                <th className="px-4 py-2.5 font-semibold text-right">累计停留</th>
              </tr>
            </thead>
            <tbody>
              {pages.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-400">{loading ? '加载中…' : '暂无页面浏览数据（用户访问页面后才会有记录）'}</td></tr>
              )}
              {pages.map((row) => {
                const maxViews = Math.max(1, ...pages.map((item) => item.views));
                return (
                  <tr key={row.path} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-900">{PAGE_LABELS[row.path] ?? row.path}</span>
                        <span className="hidden h-1.5 w-20 overflow-hidden rounded bg-slate-100 sm:block">
                          <span className="block h-full rounded bg-indigo-500/70" style={{ width: `${Math.max(4, (row.views / maxViews) * 100)}%` }} />
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{row.views.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-700"><span className="inline-flex items-center gap-1"><Timer className="h-3 w-3 text-slate-400" />{formatDuration(row.avgDurationMs)}</span></td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{formatDuration(row.totalDurationMs)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-6" aria-label="用户管理">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xs font-semibold text-slate-500">用户管理（共 {userTotal.toLocaleString()} 人）</h2>
          <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); setPage(1); setSearch(searchInput.trim()); }}>
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value.slice(0, 40))}
              placeholder="搜索昵称 / 手机号"
              className="min-h-10 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100 sm:w-48"
            />
            <button type="submit" className="grid h-10 w-10 place-items-center rounded-lg bg-indigo-600 text-white hover:bg-indigo-700" aria-label="搜索"><Search className="h-4 w-4" /></button>
          </form>
        </div>

        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[560px] text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] text-slate-400">
                <th className="px-4 py-2.5 font-semibold">昵称</th>
                <th className="px-4 py-2.5 font-semibold">手机号</th>
                <th className="px-4 py-2.5 font-semibold">角色</th>
                <th className="px-4 py-2.5 font-semibold">状态</th>
                <th className="px-4 py-2.5 font-semibold">注册时间</th>
                <th className="px-4 py-2.5 font-semibold text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">{loading ? '加载中…' : '没有匹配的用户'}</td></tr>
              )}
              {users.map((user) => {
                const isSelf = user.id === currentUserId;
                return (
                  <tr key={user.id} className="border-b border-slate-50 last:border-0">
                    <td className="max-w-32 truncate px-4 py-2.5 font-semibold text-slate-900">{user.nickname}</td>
                    <td className="px-4 py-2.5 tabular-nums text-slate-600">{maskPhone(user.phone)}</td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${user.role === 'admin' ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-600'}`}>{user.role === 'admin' ? '管理员' : '用户'}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${user.status === 'banned' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>{user.status === 'banned' ? '已封禁' : '正常'}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">{formatDateTime(user.createdAt)}</td>
                    <td className="px-4 py-2.5 text-right">
                      {isSelf ? (
                        <span className="text-[11px] text-slate-300">当前账号</span>
                      ) : (
                        <button
                          type="button"
                          disabled={pendingUserId === user.id}
                          onClick={() => void toggleStatus(user)}
                          className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition disabled:opacity-50 ${user.status === 'banned' ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-rose-50 text-rose-700 hover:bg-rose-100'}`}
                        >
                          {user.status === 'banned' ? <Undo2 className="h-3 w-3" /> : <Ban className="h-3 w-3" />}
                          {user.status === 'banned' ? '解封' : '封禁'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-[11px] leading-5 text-slate-400">封禁后该用户全部登录态即时失效；不能操作自己的账号。</p>
          <nav className="flex items-center gap-1" aria-label="用户列表分页">
            <button type="button" onClick={() => gotoPage(page - 1)} disabled={page <= 1 || loading} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40" aria-label="上一页"><ChevronLeft className="h-4 w-4" /></button>
            <span className="min-w-16 text-center text-xs tabular-nums text-slate-600">第 {page} / {totalPages} 页</span>
            <button type="button" onClick={() => gotoPage(page + 1)} disabled={page >= totalPages || loading} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40" aria-label="下一页"><ChevronRight className="h-4 w-4" /></button>
          </nav>
        </div>
      </section>
    </main>
  );
}
