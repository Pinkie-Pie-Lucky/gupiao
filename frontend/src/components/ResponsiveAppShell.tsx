import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Moon, RefreshCw, Sun } from 'lucide-react';
import type { DeviceLayout } from '../lib/deviceLayout';

export type AppNavigationItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
};

interface ResponsiveAppShellProps {
  layout: DeviceLayout;
  activeId: string;
  navigation: AppNavigationItem[];
  title: string;
  children: ReactNode;
  onRefresh: () => void;
  refreshing: boolean;
  refreshMessage: string | null;
  hideRefresh?: boolean;
  /** Public reports use the shared shell but omit internal product chrome. */
  hideProductMeta?: boolean;
  darkMode: boolean;
  onToggleTheme: () => void;
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 text-slate-900">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-600 text-lg font-black text-white shadow-sm">泡</span>
      <span className="text-lg font-bold tracking-tight">泡泡看市</span>
    </div>
  );
}

export function ResponsiveAppShell({
  layout,
  activeId,
  navigation,
  title,
  children,
  onRefresh,
  refreshing,
  refreshMessage,
  hideRefresh = false,
  hideProductMeta = false,
  darkMode,
  onToggleTheme,
}: ResponsiveAppShellProps) {
  const isMobile = layout === 'mobile';
  const isCompact = layout === 'compact';
  const isDesktop = layout === 'desktop';
  const refreshButton = !hideRefresh && (
    <button
      id="global-refresh-button"
      type="button"
      onClick={onRefresh}
      disabled={refreshing}
      aria-label="刷新真实行情和 AI 内容"
      title="刷新真实行情和 AI 内容"
      className={isMobile
        ? 'absolute right-3 top-3 z-30 grid h-11 w-11 place-items-center rounded-xl bg-white text-slate-600 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50 hover:text-indigo-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-wait disabled:opacity-60'
        : 'inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 shadow-sm transition hover:border-indigo-200 hover:text-indigo-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-wait disabled:opacity-60'}
    >
      <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
      {!isMobile && <span>{refreshing ? '正在刷新' : '刷新数据'}</span>}
    </button>
  );
  const themeButton = <button type="button" onClick={onToggleTheme} aria-label={darkMode ? '切换到日间模式' : '切换到夜间模式'} title={darkMode ? '切换到日间模式' : '切换到夜间模式'} className={isMobile ? 'absolute right-16 top-3 z-30 grid h-11 w-11 place-items-center rounded-xl bg-white text-slate-600 shadow-sm ring-1 ring-slate-200 transition hover:text-indigo-600' : 'inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 shadow-sm transition hover:border-indigo-200 hover:text-indigo-600'}>{darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}<span className="hidden md:inline">{darkMode ? '日间' : '夜间'}</span></button>;

  if (isMobile) {
    return (
      <div id="app-root-container" className="min-h-screen bg-[#F8FAFC] text-gray-900 font-sans flex justify-center">
      <div id="app-device-frame" className={`w-full max-w-md min-h-screen shadow-2xl border-x flex flex-col justify-between relative overflow-hidden ${darkMode ? 'theme-dark' : ''}`}>
          {refreshButton}
          {themeButton}
          {refreshMessage && <div role="status" className="absolute left-4 right-4 top-16 z-30 rounded-lg bg-slate-900 px-3 py-2 text-center text-xs font-medium text-white shadow-lg">{refreshMessage}</div>}
          <main id="app-viewport" className="flex-grow overflow-y-auto no-scrollbar">{children}</main>
          <nav id="bottom-tab-bar" aria-label="主导航" className="fixed bottom-0 left-1/2 z-40 flex h-16 w-full max-w-md -translate-x-1/2 items-center justify-between border-t border-slate-100 bg-white/95 px-2 py-2 backdrop-blur-md">
            {navigation.map(({ id, label, icon: Icon, onSelect }) => {
              const active = activeId === id;
              return (
                <button key={id} id={`tab-btn-${id}`} type="button" onClick={onSelect} aria-current={active ? 'page' : undefined} className={`relative flex flex-1 flex-col items-center justify-center py-1 transition-all ${active ? 'scale-105 font-semibold text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}>
                  <Icon className="h-[18px] w-[18px] stroke-[2.2]" />
                  <span className="mt-1 text-[9px] tracking-tight">{label}</span>
                  {active && <span className="absolute -bottom-1 h-1 w-1 rounded-full bg-indigo-600" />}
                </button>
              );
            })}
          </nav>
        </div>
      </div>
    );
  }

  return (
    <div id="app-root-container" className={`min-h-screen font-sans ${darkMode ? 'theme-dark' : ''}`}>
      <div className="flex min-h-screen">
        <aside className={`${isCompact ? 'w-[88px]' : isDesktop ? 'w-[120px]' : 'w-[240px]'} sticky top-0 flex h-screen shrink-0 flex-col border-r border-slate-200/80 bg-white ${isDesktop ? 'px-2 py-5' : 'px-3 py-5'}`}>
          <div className={`mb-7 px-2 ${isCompact || isDesktop ? 'flex justify-center' : ''}`}>
            {isCompact || isDesktop ? <span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-600 text-lg font-black text-white shadow-sm">泡</span> : <Brand />}
          </div>
          <nav aria-label="主导航" className={isDesktop ? 'space-y-2' : 'space-y-1.5'}>
            {navigation.map(({ id, label, icon: Icon, onSelect }) => {
              const active = activeId === id;
              return (
                <button key={id} id={`tab-btn-${id}`} type="button" onClick={onSelect} aria-current={active ? 'page' : undefined} title={isCompact ? label : undefined} className={`flex w-full items-center rounded-xl text-sm transition ${isDesktop ? 'h-[68px] flex-col justify-center gap-1 px-1 text-xs' : 'h-11 px-3'} ${isCompact ? 'justify-center' : isDesktop ? '' : 'gap-3'} ${active ? 'bg-indigo-50 font-semibold text-indigo-700 shadow-sm ring-1 ring-indigo-100' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}>
                  <Icon className="h-5 w-5 shrink-0" />
                  {!isCompact && <span>{label}</span>}
                </button>
              );
            })}
          </nav>
          {!isCompact && !isDesktop && <p className="mt-auto px-3 text-xs leading-5 text-slate-400">数据与移动端共用，刷新后将回源真实行情与 AI 内容。</p>}
        </aside>
        <section className="min-w-0 flex-1">
          <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-slate-200/80 bg-white/90 px-6 backdrop-blur-md lg:px-8">
            <div>
              <p className="text-sm font-semibold text-slate-800">{title}</p>
              {!hideProductMeta && <p className="hidden text-xs text-slate-400 sm:block">泡泡看市 · Web 端</p>}
            </div>
            <div className="flex items-center gap-3">
              {!hideProductMeta && <span className="hidden rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 md:inline">数据与移动端同步</span>}
              {themeButton}
              {refreshButton}
            </div>
          </header>
          {refreshMessage && <div role="status" className="fixed right-6 top-20 z-40 max-w-sm rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white shadow-lg">{refreshMessage}</div>}
          <main id="app-viewport" className="min-h-[calc(100vh-4rem)] overflow-x-hidden">
            <div className={`${isCompact ? 'mx-auto max-w-5xl px-4 py-5' : isDesktop ? 'mx-auto max-w-[1440px] px-6 py-6 xl:px-7' : 'mx-auto max-w-7xl px-6 py-7 lg:px-8'}`}>{children}</div>
          </main>
        </section>
      </div>
    </div>
  );
}
