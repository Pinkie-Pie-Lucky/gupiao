/**
 * 前端 API 客户端：封装认证相关请求，管理 JWT token。
 * Token 存 localStorage，请求时以 Authorization: Bearer 发送。
 */

export interface User {
  id: string;
  phone: string;
  nickname: string;
  role?: 'user' | 'admin';
  status?: 'active' | 'banned';
}

export interface AuthResponse {
  ok: boolean;
  token: string;
  user: User;
}

const TOKEN_KEY = 'paopao.jwt.token';
const USER_KEY = 'paopao.jwt.user';
const SESSION_KEY = 'paopao.analytics.session';
const UTM_KEY = 'paopao.analytics.utm';

/** 访问统计口径：首次访问生成匿名 UUID（localStorage 持久化），随请求经 X-Session-Key 上报 */
function getAnalyticsSessionKey(): string {
  try {
    const existing = window.localStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const generated = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(SESSION_KEY, generated);
    return generated;
  } catch {
    return 'anonymous';
  }
}

/** 落地页渠道参数（utm_source / from）首跳捕获，持久化随请求上报 */
function getUtmSource(): string | null {
  try {
    const fromQuery = new URLSearchParams(window.location.search).get('utm_source')
      || new URLSearchParams(window.location.search).get('from');
    if (fromQuery) {
      window.localStorage.setItem(UTM_KEY, fromQuery.slice(0, 60));
      return fromQuery.slice(0, 60);
    }
    return window.localStorage.getItem(UTM_KEY);
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  constructor(message: string, public readonly status: number = 400) {
    super(message);
    this.name = 'ApiError';
  }
}

export function getToken(): string | null {
  try { return window.localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function getSessionUser(): User | null {
  try {
    const raw = window.localStorage.getItem(USER_KEY);
    if (!raw) return null;
    const u = JSON.parse(raw);
    if (typeof u?.id !== 'string' || typeof u?.phone !== 'string' || typeof u?.nickname !== 'string') return null;
    return u;
  } catch { return null; }
}

export function setSession(token: string, user: User): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
    window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch { /* ignore */ }
}

export function clearSession(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USER_KEY);
  } catch { /* ignore */ }
}

async function request<T>(path: string, method: string = 'GET', body?: unknown): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Session-Key': getAnalyticsSessionKey(),
    'X-Client-Platform': 'web',
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const utmSource = getUtmSource();
  if (utmSource) headers['X-UTM-Source'] = utmSource;

  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let data: any = null;
  try { data = await res.json(); } catch { /* non-json */ }

  if (!res.ok) {
    throw new ApiError(data?.error || `请求失败(${res.status})`, res.status);
  }
  return data as T;
}

function extractUser(res: AuthResponse): User {
  if (!res?.ok || !res.user) throw new ApiError('服务响应异常。', 500);
  return res.user;
}

export function apiRegister(phone: string, nickname: string, password: string): Promise<User> {
  return request<AuthResponse>('/api/auth/register', 'POST', { phone, nickname, password })
    .then((res) => {
      const user = extractUser(res);
      setSession(res.token, user);
      return user;
    });
}

export function apiLogin(phone: string, password: string): Promise<User> {
  return request<AuthResponse>('/api/auth/login', 'POST', { phone, password })
    .then((res) => {
      const user = extractUser(res);
      setSession(res.token, user);
      return user;
    });
}

export function apiLogout(): Promise<void> {
  return request<void>('/api/auth/logout', 'POST').finally(() => clearSession());
}

export function apiMe(): Promise<User> {
  return request<{ user: User }>('/api/auth/me').then((res) => {
    if (!res?.user) throw new ApiError('未登录。', 401);
    setSession(getToken() || '', res.user);
    return res.user;
  });
}

export function apiUpdateNickname(nickname: string): Promise<User> {
  return request<{ user: User }>('/api/auth/me', 'PATCH', { nickname }).then((res) => {
    if (!res?.user) throw new ApiError('服务响应异常。', 500);
    setSession(getToken() || '', res.user);
    return res.user;
  });
}

// ---- 自选股 ----

export interface WatchlistEntry {
  symbol: string; // 6 位数字代码
  name: string;
  price?: number;
  changePercent?: number;
  volume?: number | null;
  amount?: number | null;
  asOf?: string | null;
  source?: string;
  freshness?: 'realtime' | 'stale';
}

export function apiWatchlist(): Promise<WatchlistEntry[]> {
  return request<{ items: WatchlistEntry[] }>('/api/watchlist').then((res) => res?.items ?? []);
}

export function apiWatchlistAdd(symbol: string, name: string): Promise<WatchlistEntry> {
  return request<{ ok: boolean; item: WatchlistEntry }>('/api/watchlist', 'POST', { symbol, name }).then((res) => {
    if (!res?.item) throw new ApiError('添加自选失败。', 500);
    return res.item;
  });
}

export function apiWatchlistRemove(symbol: string): Promise<void> {
  return request<void>(`/api/watchlist/${encodeURIComponent(symbol)}`, 'DELETE');
}

export interface MarketRefreshResult {
  ok: boolean;
  marketDate: string;
  refreshedAt: string;
  ai: { marketReport: boolean; morningReport: boolean; bubbleSelection: boolean; failed: string[] };
}

/** 强制回源行情并生成当日 AI 内容；仅由页面右上角“刷新”按钮触发。 */
export function apiRefreshMarketContent(): Promise<MarketRefreshResult> {
  return request<MarketRefreshResult>('/api/market-refresh', 'POST');
}

export interface StockScreenerResult {
  query: string;
  title: string;
  conditions: Array<{ description: string; stockCount: number | null }>;
  totalCondition: string | null;
  selectLogic: string | null;
  total: number;
  columns: Array<{ key: string; label: string; dateMsg?: string }>;
  rows: Array<Record<string, unknown>>;
  dataSource: 'dataList' | 'partialResults' | 'empty';
  sourceMeta: { source: string; provider: string; fetchedAt: string; freshness: 'live' | 'cache'; confidence: string };
}

export interface SavedScreener {
  id: string;
  userId: string;
  name: string;
  query: string;
  enabled: boolean;
  lastRunAt: string | null;
  lastResult: StockScreenerResult | null;
  lastDiff: { initial?: boolean; candidateCount?: number; added?: string[]; removed?: string[]; rankChanges?: Array<{ code: string; from: number; to: number; change: number }> } | null;
  createdAt: string;
  updatedAt: string;
}

/** 条件选股只在用户提交或手动刷新时请求，API Key 不会离开服务端。 */
export function apiScreenStocks(query: string, refresh = false): Promise<StockScreenerResult> {
  return request<StockScreenerResult>('/api/stock-screeners', 'POST', { query, refresh });
}

export function apiSavedScreeners(): Promise<SavedScreener[]> {
  return request<{ items: SavedScreener[] }>('/api/saved-screeners').then((response) => response.items || []);
}

export function apiSaveScreener(name: string, query: string): Promise<SavedScreener> {
  return request<{ item: SavedScreener }>('/api/saved-screeners', 'POST', { name, query }).then((response) => response.item);
}

export function apiRefreshSavedScreener(id: string): Promise<SavedScreener> {
  return request<{ item: SavedScreener }>(`/api/saved-screeners/${encodeURIComponent(id)}/refresh`, 'POST').then((response) => response.item);
}

export function apiRemoveSavedScreener(id: string): Promise<void> {
  return request<void>(`/api/saved-screeners/${encodeURIComponent(id)}`, 'DELETE');
}

// ---- 管理端（/api/admin/*，非 admin 由后端返回 403） ----

export interface AdminPeriodStats {
  pv: number;
  uv: number;
  dau: number;
  newUsers: number;
}

export interface AdminSessionDuration {
  avgSessionDurationMs: number | null;
  byPlatform: Array<{ platform: string; sessions: number; avgSessionDurationMs: number | null }>;
}

export interface AdminOverview {
  today: AdminPeriodStats;
  recent7d: AdminPeriodStats;
  recent30d: AdminPeriodStats;
  sessionDuration: AdminSessionDuration;
}

export interface AdminPageStats {
  path: string;
  views: number;
  avgDurationMs: number | null;
  totalDurationMs: number;
}

/**
 * 页面浏览上报（PV 口径 + 停留时长）：tab 切换 / 关页时调用。
 * sendBeacon 在关页时仍可送达（无自定义 header，sessionKey/platform 放 body）；失败静默。
 */
export function reportPageView(path: string, durationMs: number): void {
  try {
    const payload = {
      path,
      durationMs: Math.max(0, Math.min(Math.trunc(durationMs), 2 * 3600 * 1000)),
      sessionKey: getAnalyticsSessionKey(),
      platform: 'web' as const,
    };
    const body = JSON.stringify(payload);
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon('/api/track/view', new Blob([body], { type: 'application/json' }));
    } else {
      void fetch('/api/track/view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => undefined);
    }
  } catch {
    /* 埋点失败静默 */
  }
}

export interface AdminTraffic {
  daily: Array<{ date: string; pv: number; uv: number }>;
  referers: Array<{ referer: string; count: number }>;
  devices: Array<{ device: string; count: number }>;
  platforms: Array<{ platform: string; count: number }>;
}

export interface AdminUserRow {
  id: string;
  phone: string;
  nickname: string;
  role: 'user' | 'admin';
  status: 'active' | 'banned';
  createdAt: string;
}

export function apiAdminOverview(): Promise<AdminOverview> {
  return request<AdminOverview>('/api/admin/stats/overview');
}

export function apiAdminTraffic(days = 30): Promise<AdminTraffic> {
  return request<AdminTraffic>(`/api/admin/stats/traffic?days=${days}`);
}

export function apiAdminPages(days = 30): Promise<{ days: number; pages: AdminPageStats[] }> {
  return request<{ days: number; pages: AdminPageStats[] }>(`/api/admin/stats/pages?days=${days}`);
}

export function apiAdminUsers(search = '', offset = 0, limit = 20): Promise<{ rows: AdminUserRow[]; total: number }> {
  const params = new URLSearchParams({ search, offset: String(offset), limit: String(limit) });
  return request<{ rows: AdminUserRow[]; total: number }>(`/api/admin/users?${params.toString()}`);
}

export function apiAdminUpdateUserStatus(id: string, status: 'active' | 'banned'): Promise<{ user: AdminUserRow }> {
  return request<{ user: AdminUserRow }>(`/api/admin/users/${encodeURIComponent(id)}/status`, 'PATCH', { status });
}
