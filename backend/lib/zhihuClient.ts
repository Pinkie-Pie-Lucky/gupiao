import { withRetry } from './resilience.js';

export type ZhihuSearchScope = 'zhihu' | 'global';

export type ZhihuClientOptions = {
  accessSecret?: string;
  baseUrl?: string;
  timeoutMs?: number;
  cacheTtlMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

type CachedValue = { expiresAt: number; value: unknown };

export class ZhihuApiUnavailableError extends Error {
  constructor(message: string, public readonly code: 'provider_disabled' | 'upstream_error') {
    super(message);
    this.name = 'ZhihuApiUnavailableError';
  }
}

/** 知乎开发者 API 的服务端客户端。密钥只从环境变量注入。 */
export function createZhihuClient(options: ZhihuClientOptions = {}) {
  const accessSecret = String(options.accessSecret || '').trim();
  const baseUrl = String(options.baseUrl || 'https://developer.zhihu.com/api/v1/content').replace(/\/$/, '');
  const timeoutMs = Math.max(1_000, Number(options.timeoutMs) || 15_000);
  const cacheTtlMs = Math.max(0, Number(options.cacheTtlMs) || 10 * 60_000);
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || Date.now;
  const cache = new Map<string, CachedValue>();
  const inFlight = new Map<string, Promise<any>>();
  let health = { status: 'unknown' as 'unknown' | 'healthy' | 'degraded' | 'disabled', lastAttemptAt: null as string | null, lastSuccessAt: null as string | null, lastError: null as string | null, consecutiveFailures: 0 };

  function metadata(source: string, freshness: 'live' | 'cache' = 'live') {
    return { source, fetchedAt: new Date(now()).toISOString(), freshness, confidence: 'third_party', provider: 'zhihu' };
  }

  async function request(pathname: string, params: URLSearchParams, cacheKey: string) {
    if (!accessSecret) {
      health = { ...health, status: 'disabled', lastError: 'ZHIHU_ACCESS_SECRET 未配置' };
      throw new ZhihuApiUnavailableError('知乎数据源尚未配置 ZHIHU_ACCESS_SECRET。', 'provider_disabled');
    }
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > now()) return { data: cached.value, sourceMeta: metadata('zhihu_cache', 'cache') };
    const pending = inFlight.get(cacheKey);
    if (pending) return pending;
    const work = (async () => {
      const attemptedAt = new Date(now()).toISOString();
      health = { ...health, lastAttemptAt: attemptedAt };
      const url = new URL(`${baseUrl}/${pathname}`);
      params.forEach((value, key) => url.searchParams.set(key, value));
      let response: Response;
      try {
        response = await withRetry(() => fetchImpl(url, { headers: { Authorization: `Bearer ${accessSecret}`, 'X-Request-Timestamp': String(Math.floor(now() / 1000)), 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(timeoutMs) }), { attempts: Number(process.env.UPSTREAM_RETRY_ATTEMPTS) || 2 });
      } catch (error: any) {
        const message = String(error?.message || '网络错误').slice(0, 160);
        health = { ...health, status: 'degraded', lastError: message, consecutiveFailures: health.consecutiveFailures + 1 };
        throw new ZhihuApiUnavailableError(`知乎接口请求失败：${message}`, 'upstream_error');
      }
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = String((payload as any)?.message || (payload as any)?.error?.message || response.statusText || '未知错误').slice(0, 160);
        health = { ...health, status: 'degraded', lastError: detail, consecutiveFailures: health.consecutiveFailures + 1 };
        throw new ZhihuApiUnavailableError(`知乎接口返回 HTTP ${response.status}：${detail}`, 'upstream_error');
      }
      cache.set(cacheKey, { expiresAt: now() + cacheTtlMs, value: payload });
      health = { status: 'healthy', lastAttemptAt: attemptedAt, lastSuccessAt: new Date(now()).toISOString(), lastError: null, consecutiveFailures: 0 };
      return { data: payload, sourceMeta: metadata('zhihu_api') };
    })();
    inFlight.set(cacheKey, work);
    try { return await work; } finally { if (inFlight.get(cacheKey) === work) inFlight.delete(cacheKey); }
  }

  function cleanQuery(query: unknown) {
    const value = String(query || '').trim().replace(/\s+/g, ' ');
    if (!value || value.length > 120) throw new Error('query 必须为 1 至 120 个字符');
    return value;
  }

  return {
    isConfigured: () => Boolean(accessSecret),
    search(query: unknown, scope: ZhihuSearchScope = 'zhihu') {
      const cleaned = cleanQuery(query);
      return request(scope === 'global' ? 'global_search' : 'zhihu_search', new URLSearchParams({ Query: cleaned }), `search:${scope}:${cleaned.toLowerCase()}`);
    },
    hotList() { return request('hot_list', new URLSearchParams(), 'hot-list'); },
    health: () => ({ ...health }),
    clearCache() { cache.clear(); },
  };
}
