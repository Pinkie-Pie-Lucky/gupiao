/**
 * A 股交易日主动数据刷新调度器。
 *
 * 仅在上海时区交易时段内工作，每分钟 tick 一次：
 *   - 每 5 分钟刷新三大指数（refreshIndices）
 *   - 每 15 分钟刷新全量行情 + AI 报告（refreshAll，早报 / 市场动态 / 泡泡精选）
 * 上午 9:30-11:30、下午 13:00-15:00 执行；午休 11:30-13:00 与收盘后、周末不执行。
 * 每次触发的数据都会由调用方写入数据库，页面展示数据库中的最新数据。
 */
export interface ShanghaiClock {
  dayOfWeek: number; // 0=Sun, 6=Sat
  minutes: number;   // 当日 0-1439
}

export interface MarketRefreshPlan {
  active: boolean;
  refreshIndices: boolean;
  refreshAll: boolean;
}

// A-share market closures published by SSE for 2026. Future years can be
// supplied through CN_MARKET_HOLIDAYS as a comma-separated YYYY-MM-DD list.
const DEFAULT_CN_MARKET_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-02', '2026-01-03',
  '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
  '2026-04-04', '2026-04-05', '2026-04-06',
  '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
  '2026-06-19', '2026-06-20', '2026-06-21',
  '2026-09-25', '2026-09-26', '2026-09-27',
  '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07',
]);

function configuredMarketHolidays(): Set<string> {
  const configured = String(process.env.CN_MARKET_HOLIDAYS || '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
  return configured.length ? new Set(configured) : DEFAULT_CN_MARKET_HOLIDAYS;
}

export function getShanghaiDate(now: Date): string {
  return now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

export function isChinaMarketHoliday(date: string): boolean {
  return configuredMarketHolidays().has(date);
}

/** 由具体时间点推导上海时区钟点（便于注入测试）。 */
export function getShanghaiClock(now: Date): ShanghaiClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value || 0);
  const weekday = parts.find((item) => item.type === 'weekday')?.value || 'Sun';
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayOfWeek = dayNames.indexOf(weekday);
  const hour = part('hour');
  const minute = part('minute');
  return { dayOfWeek: dayOfWeek < 0 ? 0 : dayOfWeek, minutes: hour * 60 + minute };
}

/** 纯函数：根据星期与分钟数给出本 tick 应执行的刷新计划。 */
export function planMarketRefresh(dayOfWeek: number, minutes: number): MarketRefreshPlan {
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return { active: false, refreshIndices: false, refreshAll: false };
  }
  // 上午盘 9:30(570) - 11:30(690)；下午盘 13:00(780) - 15:00(900)
  let sessionStart = -1;
  if (minutes >= 570 && minutes < 690) sessionStart = 570;
  else if (minutes >= 780 && minutes < 900) sessionStart = 780;
  if (sessionStart < 0) {
    return { active: false, refreshIndices: false, refreshAll: false };
  }
  const elapsed = minutes - sessionStart;
  return {
    active: true,
    refreshIndices: elapsed % 5 === 0,
    refreshAll: elapsed % 15 === 0,
  };
}

export function isAshareTradingTime(now: Date): boolean {
  const clock = getShanghaiClock(now);
  if (clock.dayOfWeek === 0 || clock.dayOfWeek === 6 || isChinaMarketHoliday(getShanghaiDate(now))) return false;
  return (clock.minutes >= 570 && clock.minutes < 690) || (clock.minutes >= 780 && clock.minutes < 900);
}

export interface MarketSchedulerCallbacks {
  refreshIndices(): Promise<void>;
  refreshAll(): Promise<void>;
  log(message: string): void;
}

/**
 * 启动调度器，返回 stop 函数。
 * 立即执行一次 tick（避免服务启动恰好错过整点），之后每分钟一次。
 */
export function startMarketScheduler(callbacks: MarketSchedulerCallbacks): () => void {
  let running = false;
  let lastIndicesMinute = -1;
  let lastAllMinute = -1;
  let lastNonTradingRefreshDate = '';

  const tick = async () => {
    if (running) return;
    const now = new Date();
    const clock = getShanghaiClock(now);
    const marketDate = getShanghaiDate(now);
    const nonTradingDay = clock.dayOfWeek === 0 || clock.dayOfWeek === 6 || isChinaMarketHoliday(marketDate);
    if (nonTradingDay) {
      if (lastNonTradingRefreshDate === marketDate) return;
      lastNonTradingRefreshDate = marketDate;
      running = true;
      try {
        callbacks.log(`[scheduler] ${marketDate} non-trading daily refreshAll`);
        await callbacks.refreshAll();
      } catch (error: any) {
        callbacks.log(`[scheduler] non-trading refresh failed: ${error?.message}`);
      } finally {
        running = false;
      }
      return;
    }
    const plan = planMarketRefresh(clock.dayOfWeek, clock.minutes);
    if (!plan.active || (!plan.refreshIndices && !plan.refreshAll)) return;
    if (plan.refreshIndices && lastIndicesMinute === clock.minutes) return;
    if (plan.refreshAll && lastAllMinute === clock.minutes) return;

    const shouldIndices = plan.refreshIndices;
    const shouldAll = plan.refreshAll;
    if (shouldIndices) lastIndicesMinute = clock.minutes;
    if (shouldAll) lastAllMinute = clock.minutes;

    running = true;
    try {
      if (shouldIndices) {
        callbacks.log(`[scheduler] ${String(clock.minutes)} refreshIndices`);
        await callbacks.refreshIndices();
      }
      if (shouldAll) {
        callbacks.log(`[scheduler] ${String(clock.minutes)} refreshAll`);
        await callbacks.refreshAll();
      }
    } catch (error: any) {
      callbacks.log(`[scheduler] tick failed: ${error?.message}`);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, 60_000);
  // 避免定时器在 Node 测试/退出时阻塞进程
  if (typeof timer.unref === 'function') timer.unref();
  void tick();
  return () => clearInterval(timer);
}
