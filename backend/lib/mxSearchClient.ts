export type MxSearchClientOptions = {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  cacheTtlMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

type CachedValue = { expiresAt: number; value: unknown };

export class MxSearchUnavailableError extends Error {
  constructor(message: string, public readonly code: 'provider_disabled' | 'upstream_error' | 'rate_limited') {
    super(message);
    this.name = 'MxSearchUnavailableError';
  }
}

/** 东方财富妙想金融资讯搜索客户端。API Key 仅从服务端环境变量注入。 */
export function createMxSearchClient(options: MxSearchClientOptions = {}) {
  const apiKey = String(options.apiKey || '').trim();
  const baseUrl = String(options.baseUrl || 'https://mkapi2.dfcfs.com/finskillshub/api/claw/news-search');
  const timeoutMs = Math.max(1_000, Number(options.timeoutMs) || 30_000);
  const cacheTtlMs = Math.max(0, Number(options.cacheTtlMs) || 15 * 60_000);
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || Date.now;
  const cache = new Map<string, CachedValue>();
  const inFlight = new Map<string, Promise<any>>();
  let health = { status: 'unknown' as 'unknown' | 'healthy' | 'degraded' | 'disabled', lastAttemptAt: null as string | null, lastSuccessAt: null as string | null, lastError: null as string | null, consecutiveFailures: 0 };

  function metadata(source: 'mx_search' | 'mx_search_cache', freshness: 'live' | 'cache') {
    return { source, provider: 'eastmoney_mx', fetchedAt: new Date(now()).toISOString(), freshness, confidence: 'financial_search', fallbackLevel: source === 'mx_search' ? 0 : 1 };
  }

  function cleanQuery(query: unknown) {
    const value = String(query || '').trim().replace(/\s+/g, ' ');
    if (!value || value.length > 180) throw new Error('query 必须为 1 至 180 个字符');
    return value;
  }

  async function search(query: unknown) {
    const cleaned = cleanQuery(query);
    if (!apiKey) {
      health = { ...health, status: 'disabled', lastError: 'MX_APIKEY 未配置' };
      throw new MxSearchUnavailableError('妙想资讯搜索尚未配置 MX_APIKEY。', 'provider_disabled');
    }
    const cacheKey = cleaned.toLowerCase();
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > now()) return { data: cached.value, sourceMeta: metadata('mx_search_cache', 'cache'), health: { ...health } };
    const pending = inFlight.get(cacheKey);
    if (pending) return pending;

    const work = (async () => {
      const attemptedAt = new Date(now()).toISOString();
      health = { ...health, lastAttemptAt: attemptedAt };
      let response: Response;
      try {
        response = await fetchImpl(baseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=UTF-8', apikey: apiKey },
          body: JSON.stringify({ query: cleaned }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error: any) {
        const message = String(error?.message || '网络错误').slice(0, 160);
        health = { ...health, status: 'degraded', lastError: message, consecutiveFailures: health.consecutiveFailures + 1 };
        throw new MxSearchUnavailableError(`妙想资讯搜索请求失败：${message}`, 'upstream_error');
      }
      const payload = await response.json().catch(() => null) as any;
      const businessCode = Number(payload?.code ?? payload?.status);
      const rateLimited = businessCode === 113;
      if (!response.ok || payload?.status !== 0) {
        const message = String(payload?.message || response.statusText || '未知错误').slice(0, 160);
        health = { ...health, status: 'degraded', lastError: message, consecutiveFailures: health.consecutiveFailures + 1 };
        throw new MxSearchUnavailableError(`妙想资讯搜索返回异常：${message}`, rateLimited ? 'rate_limited' : 'upstream_error');
      }
      const succeededAt = new Date(now()).toISOString();
      health = { status: 'healthy', lastAttemptAt: attemptedAt, lastSuccessAt: succeededAt, lastError: null, consecutiveFailures: 0 };
      cache.set(cacheKey, { expiresAt: now() + cacheTtlMs, value: payload });
      return { data: payload, sourceMeta: metadata('mx_search', 'live'), health: { ...health } };
    })();
    inFlight.set(cacheKey, work);
    try { return await work; } finally { if (inFlight.get(cacheKey) === work) inFlight.delete(cacheKey); }
  }

  return {
    isConfigured: () => Boolean(apiKey),
    search,
    health: () => ({ ...health }),
    clearCache: () => cache.clear(),
  };
}
