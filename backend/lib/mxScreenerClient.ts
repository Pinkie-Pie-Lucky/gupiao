import { withRetry } from './resilience.js';

export type MxScreenerClientOptions = {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  cacheTtlMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

type CachedValue = { expiresAt: number; value: MxScreenerResponse };

export type MxScreenerColumn = { key: string; label: string; dateMsg?: string };
export type MxScreenerRow = Record<string, unknown>;
export type MxScreenerResponse = {
  query: string;
  title: string;
  conditions: Array<{ description: string; stockCount: number | null }>;
  totalCondition: string | null;
  selectLogic: string | null;
  total: number;
  columns: MxScreenerColumn[];
  rows: MxScreenerRow[];
  dataSource: 'dataList' | 'partialResults' | 'empty';
  sourceMeta: {
    source: 'eastmoney_mx_screener' | 'eastmoney_mx_screener_cache';
    provider: 'eastmoney_mx';
    fetchedAt: string;
    freshness: 'live' | 'cache';
    confidence: 'financial_screening';
  };
};

export class MxScreenerUnavailableError extends Error {
  constructor(message: string, public readonly code: 'provider_disabled' | 'upstream_error' | 'rate_limited' | 'invalid_query') {
    super(message);
    this.name = 'MxScreenerUnavailableError';
  }
}

function cleanQuery(query: unknown) {
  const value = String(query || '').trim().replace(/\s+/g, ' ');
  if (!value || value.length > 180) throw new MxScreenerUnavailableError('选股条件需为 1 至 180 个字符。', 'invalid_query');
  return value;
}

function parsePartialRows(markdown: unknown): MxScreenerRow[] {
  const lines = String(markdown || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 3 || !lines[0].includes('|')) return [];
  const cells = (line: string) => line.split('|').map((cell) => cell.trim()).filter((cell, index, all) => cell || (index > 0 && index < all.length - 1));
  const headers = cells(lines[0]);
  const rows: MxScreenerRow[] = [];
  for (const line of lines.slice(2)) {
    const values = cells(line);
    if (!values.length) continue;
    rows.push(Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
  }
  return rows;
}

function normalizeColumns(columns: unknown): MxScreenerColumn[] {
  if (!Array.isArray(columns)) return [];
  return columns.map((column: any) => {
    const key = String(column?.field || column?.name || column?.key || '').trim();
    const baseLabel = String(column?.displayName || column?.title || column?.label || key).trim();
    const dateMsg = String(column?.dateMsg || '').trim();
    return { key, label: dateMsg && !baseLabel.includes(dateMsg) ? `${baseLabel} ${dateMsg}` : baseLabel, ...(dateMsg ? { dateMsg } : {}) };
  }).filter((column) => column.key);
}

function normalizeResponse(payload: any, query: string, source: MxScreenerResponse['sourceMeta']['source'], freshness: 'live' | 'cache', now: () => number): MxScreenerResponse {
  const inner = payload?.data?.data || {};
  const result = inner?.allResults?.result || {};
  const columns = normalizeColumns(result?.columns);
  const rawRows = Array.isArray(result?.dataList) ? result.dataList.slice(0, 200) : [];
  const rows = rawRows.length ? rawRows : parsePartialRows(inner?.partialResults).slice(0, 200);
  const conditions = Array.isArray(inner?.responseConditionList)
    ? inner.responseConditionList.slice(0, 12).map((item: any) => ({ description: String(item?.describe || item?.description || '').trim(), stockCount: Number.isFinite(Number(item?.stockCount)) ? Number(item.stockCount) : null })).filter((item: any) => item.description)
    : [];
  return {
    query,
    title: String(inner?.title || '智能条件选股').trim() || '智能条件选股',
    conditions,
    totalCondition: inner?.totalCondition ? String(inner.totalCondition) : null,
    selectLogic: inner?.selectLogic ? String(inner.selectLogic) : null,
    total: Number.isFinite(Number(inner?.securityCount)) ? Number(inner.securityCount) : rows.length,
    columns: columns.length ? columns : Object.keys(rows[0] || {}).map((key) => ({ key, label: key })),
    rows,
    dataSource: rawRows.length ? 'dataList' : rows.length ? 'partialResults' : 'empty',
    sourceMeta: { source, provider: 'eastmoney_mx', fetchedAt: new Date(now()).toISOString(), freshness, confidence: 'financial_screening' },
  };
}

/** 东方财富妙想智能选股客户端。密钥仅在 Node 服务端读取。 */
export function createMxScreenerClient(options: MxScreenerClientOptions = {}) {
  const apiKey = String(options.apiKey || '').trim();
  const baseUrl = String(options.baseUrl || 'https://mkapi2.dfcfs.com/finskillshub/api/claw/stock-screen');
  const timeoutMs = Math.max(1_000, Number(options.timeoutMs) || 30_000);
  const cacheTtlMs = Math.max(0, Number(options.cacheTtlMs) || 10 * 60_000);
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || Date.now;
  const cache = new Map<string, CachedValue>();
  const inFlight = new Map<string, Promise<MxScreenerResponse>>();
  let health = { status: 'unknown' as 'unknown' | 'healthy' | 'degraded' | 'disabled', lastAttemptAt: null as string | null, lastSuccessAt: null as string | null, lastError: null as string | null, consecutiveFailures: 0 };

  async function screen(queryInput: unknown, forceRefresh = false) {
    const query = cleanQuery(queryInput);
    if (!apiKey) {
      health = { ...health, status: 'disabled', lastError: 'MX_APIKEY 未配置' };
      throw new MxScreenerUnavailableError('条件选股尚未配置 MX_APIKEY。', 'provider_disabled');
    }
    const key = query.toLowerCase();
    const cached = cache.get(key);
    if (!forceRefresh && cached && cached.expiresAt > now()) {
      return {
        ...cached.value,
        query,
        sourceMeta: { ...cached.value.sourceMeta, source: 'eastmoney_mx_screener_cache', fetchedAt: new Date(now()).toISOString(), freshness: 'cache' },
      };
    }
    const pending = inFlight.get(key);
    if (pending) return pending;
    const work = (async () => {
      const attemptedAt = new Date(now()).toISOString();
      health = { ...health, lastAttemptAt: attemptedAt };
      let response: Response;
      try {
        response = await withRetry(() => fetchImpl(baseUrl, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8', apikey: apiKey }, body: JSON.stringify({ keyword: query }), signal: AbortSignal.timeout(timeoutMs) }), { attempts: Number(process.env.UPSTREAM_RETRY_ATTEMPTS) || 2 });
      } catch (error: any) {
        const message = String(error?.message || '网络错误').slice(0, 160);
        health = { ...health, status: 'degraded', lastError: message, consecutiveFailures: health.consecutiveFailures + 1 };
        throw new MxScreenerUnavailableError(`妙想选股请求失败：${message}`, 'upstream_error');
      }
      const payload = await response.json().catch(() => null) as any;
      const businessCode = Number(payload?.code ?? payload?.status);
      const rateLimited = businessCode === 113;
      if (!response.ok || payload?.status !== 0) {
        const message = String(payload?.message || response.statusText || '未知错误').slice(0, 160);
        health = { ...health, status: 'degraded', lastError: message, consecutiveFailures: health.consecutiveFailures + 1 };
        throw new MxScreenerUnavailableError(`妙想选股返回异常：${message}`, rateLimited ? 'rate_limited' : 'upstream_error');
      }
      health = { status: 'healthy', lastAttemptAt: attemptedAt, lastSuccessAt: new Date(now()).toISOString(), lastError: null, consecutiveFailures: 0 };
      const value = normalizeResponse(payload, query, 'eastmoney_mx_screener', 'live', now);
      cache.set(key, { expiresAt: now() + cacheTtlMs, value });
      return value;
    })();
    inFlight.set(key, work);
    try { return await work; } finally { if (inFlight.get(key) === work) inFlight.delete(key); }
  }

  return { isConfigured: () => Boolean(apiKey), screen, health: () => ({ ...health }), clearCache: () => cache.clear() };
}
