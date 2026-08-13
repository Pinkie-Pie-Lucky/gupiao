/**
 * 前端 API 客户端：封装认证相关请求，管理 JWT token。
 * Token 存 localStorage，请求时以 Authorization: Bearer 发送。
 */

export interface User {
  id: string;
  phone: string;
  nickname: string;
}

export interface AuthResponse {
  ok: boolean;
  token: string;
  user: User;
}

const TOKEN_KEY = 'paopao.jwt.token';
const USER_KEY = 'paopao.jwt.user';

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
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

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