type BasicHealth = {
  status?: string;
  lastAttemptAt?: string | null;
  lastSuccessAt?: string | null;
  lastError?: string | null;
  consecutiveFailures?: number;
};

function safeText(value: unknown) {
  return String(value || '').replace(/(?:Bearer|apikey|key)\s+[\w.-]+/gi, '[redacted]').slice(0, 180) || null;
}

function source(name: string, configured: boolean, health?: BasicHealth) {
  return {
    name,
    configured,
    status: configured ? health?.status || 'unknown' : 'disabled',
    lastAttemptAt: health?.lastAttemptAt || null,
    lastSuccessAt: health?.lastSuccessAt || null,
    lastError: safeText(health?.lastError),
    consecutiveFailures: Number(health?.consecutiveFailures || 0),
  };
}

/** 不主动调用第三方：只汇总已观测到的健康状态，避免健康检查本身消耗配额。 */
export function buildOperationalHealth(input: {
  database: 'postgres' | 'memory';
  aiProvider: string;
  aiConfigured: boolean;
  mxSearch: { configured: boolean; health: BasicHealth };
  mxScreener: { configured: boolean; health: BasicHealth };
  zhihu: { configured: boolean; health?: BasicHealth };
  publicHotlists?: Array<{ source: string; status: string; lastAttemptAt?: string | null; lastSuccessAt?: string | null; lastError?: string | null }>;
}) {
  const sources = [
    source('ai', input.aiConfigured, { status: input.aiConfigured ? 'configured' : 'disabled' }),
    source('eastmoney_mx_search', input.mxSearch.configured, input.mxSearch.health),
    source('eastmoney_mx_screener', input.mxScreener.configured, input.mxScreener.health),
    source('zhihu', input.zhihu.configured, input.zhihu.health),
    ...(input.publicHotlists || []).map((item) => source(`public_hotlist:${item.source}`, true, item)),
  ];
  return {
    schemaVersion: 'operational-health.v1',
    checkedAt: new Date().toISOString(),
    database: { mode: input.database, persistent: input.database === 'postgres' },
    ai: { provider: input.aiProvider, configured: input.aiConfigured },
    sources,
    scope: '仅汇总服务进程已观测的状态，不主动调用第三方，不包含密钥或完整请求内容。',
  };
}
