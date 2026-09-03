/**
 * 泡泡看市 - MCP Server（Streamable HTTP）
 *
 * 基于官方 MCP SDK（@modelcontextprotocol/sdk）实现，
 * 提供 A 股实时行情 / 市场概览等工具。
 * 数据源全部为 Node 原生 HTTP（腾讯/新浪/东财），不依赖 Python，
 * 因此在 Vercel / Railway / 本机均可运行。
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';

const MAX_STOCK_IDENTIFIER_LENGTH = 16;
const MAX_STOCK_SEARCH_LENGTH = 64;
const MAX_UPSTREAM_RESPONSE_BYTES = 1024 * 1024;

class UpstreamResponseTooLargeError extends Error {
  constructor() {
    super('上游响应超过安全大小限制');
    this.name = 'UpstreamResponseTooLargeError';
  }
}

function httpGetText(urlStr: string, referer = 'https://gu.qq.com/', encoding = 'utf-8'): Promise<string> {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === 'http:' ? import('node:http').then((m) => m.default) : import('node:https').then((m) => m.default);
    mod.then((httpMod) => {
      const req = httpMod.get(
        {
          hostname: u.hostname,
          path: u.pathname + u.search,
          headers: { 'User-Agent': 'Mozilla/5.0', Referer: referer },
        },
        (res: any) => {
          const chunks: Buffer[] = [];
          let receivedBytes = 0;
          res.on('data', (chunk: Buffer) => {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            receivedBytes += buffer.length;
            if (receivedBytes > MAX_UPSTREAM_RESPONSE_BYTES) {
              req.destroy(new UpstreamResponseTooLargeError());
              return;
            }
            chunks.push(buffer);
          });
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`HTTP ${res.statusCode}`));
              return;
            }
            resolve(new TextDecoder(encoding).decode(Buffer.concat(chunks)));
          });
        },
      );
      req.on('error', reject);
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('Timeout'));
      });
    });
  });
}

function httpGetJSON(urlStr: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === 'http:' ? import('node:http').then((m) => m.default) : import('node:https').then((m) => m.default);
    mod.then((httpMod) => {
      const req = httpMod.get(
        {
          hostname: u.hostname,
          family: 4,
          path: u.pathname + u.search,
          headers: { 'User-Agent': 'Mozilla/5.0' },
        },
        (res: any) => {
          let data = '';
          let receivedBytes = 0;
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            receivedBytes += Buffer.byteLength(chunk, 'utf8');
            if (receivedBytes > MAX_UPSTREAM_RESPONSE_BYTES) {
              req.destroy(new UpstreamResponseTooLargeError());
              return;
            }
            data += chunk;
          });
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`HTTP ${res.statusCode}`));
              return;
            }
            try {
              resolve(JSON.parse(data));
            } catch {
              reject(new Error('JSON parse failed'));
            }
          });
        },
      );
      req.on('error', reject);
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('Timeout'));
      });
    });
  });
}

function normalizeSymbol(input: string): string {
  return String(input || '').trim().toUpperCase().replace(/\.(SH|SZ|BJ)$|^(SH|SZ|BJ)/, '');
}

class InvalidStockIdentifierError extends Error {
  constructor(input: string) {
    const raw = String(input || '').trim();
    const preview = raw.length > 32 ? `${raw.slice(0, 32)}…` : raw || '空值';
    super(`请提供具体 A 股代码或股票名称，例如“002230”或“科大讯飞”。“${preview}”不是可查询的证券标识。`);
    this.name = 'InvalidStockIdentifierError';
  }
}

function toMcpError(error: unknown) {
  const message = String((error as Error)?.message || '未知错误');
  if (error instanceof InvalidStockIdentifierError) return { error: 'invalid_argument', message, retryable: false };
  return { error: 'upstream_error', trace_id: randomUUID(), message, retryable: true };
}

function isValidStockCode(input: string) {
  return /^\d{6}$/.test(normalizeSymbol(input));
}

export type McpDataProviders = {
  /** 由宿主应用注入的完整市场观察数据；未注入时使用轻量行情源。 */
  getMarketObservation?: () => Promise<unknown>;
  /** 由宿主应用注入的个股事实快照；不得包含 AI 结论。 */
  getStockFactSnapshot?: (symbol: string) => Promise<unknown>;
};

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** 将指数与板块原始行情转换为可复核、无预测性的市场观察。 */
export function buildMarketObservation(overview: any) {
  const indices = Array.isArray(overview?.indices) ? overview.indices : [];
  const usableIndices = indices.filter((item: any) => Number.isFinite(Number(item?.changePercent)));
  const upCount = usableIndices.filter((item: any) => Number(item.changePercent) > 0).length;
  const downCount = usableIndices.filter((item: any) => Number(item.changePercent) < 0).length;
  const averageChange = usableIndices.length
    ? usableIndices.reduce((sum: number, item: any) => sum + Number(item.changePercent), 0) / usableIndices.length
    : null;
  const marketState = !usableIndices.length
    ? '数据有限'
    : upCount === usableIndices.length && Number(averageChange) >= 0.5
      ? '指数普遍走强'
      : downCount === usableIndices.length && Number(averageChange) <= -0.5
        ? '指数普遍走弱'
        : upCount > 0 && downCount > 0
          ? '指数表现分歧'
          : Number(averageChange) > 0
            ? '指数偏强'
            : Number(averageChange) < 0
              ? '指数偏弱'
              : '指数平稳';
  const topSectors = Array.isArray(overview?.topSectors) ? overview.topSectors : [];
  const sourceMeta = overview?.sourceMeta || null;
  const dataGaps: string[] = [];
  if (usableIndices.length < 3) dataGaps.push(`三大指数仅取得 ${usableIndices.length}/3 条有效涨跌数据。`);
  if (!topSectors.length) dataGaps.push('未取得当日领涨板块数据。');

  return {
    observation: {
      marketState,
      indexBreadth: { up: upCount, down: downCount, flat: Math.max(0, usableIndices.length - upCount - downCount), total: usableIndices.length },
      averageIndexChangePercent: averageChange === null ? null : round(averageChange),
      indices,
      topSectors,
      bottomSectors: Array.isArray(overview?.bottomSectors) ? overview.bottomSectors : [],
      marketBreadth: overview?.marketBreath || overview?.marketBreadth || null,
      marketTemperature: overview?.marketTemperature ?? null,
      marketStatus: overview?.marketStatus || null,
    },
    dataAsOf: overview?.timestamp || overview?.fetchedAt || new Date().toISOString(),
    sourceMeta,
    dataGaps,
    scope: '仅反映当前已取得的市场事实，不预测后续涨跌，也不构成交易建议。',
  };
}

/** MCP 只输出研究底座所需的紧凑字段，避免内部缓存、原文和 AI 输出泄露。 */
export function compactStockFactSnapshot(raw: any) {
  const reports = Array.isArray(raw?.facts?.financialReports) ? raw.facts.financialReports.slice(0, 4) : [];
  const announcements = Array.isArray(raw?.facts?.announcements) ? raw.facts.announcements.slice(0, 10) : [];
  const evidence = Array.isArray(raw?.evidence) ? raw.evidence.slice(0, 80) : [];
  const quote = raw?.facts?.quote || null;
  const profile = raw?.company?.profile || {};
  const technical = raw?.facts?.technical || null;
  const financialTrends = raw?.facts?.financialTrends || null;

  return {
    symbol: String(raw?.symbol || quote?.code || ''),
    company: {
      name: String(raw?.company?.name || quote?.name || ''),
      financialTemplate: raw?.company?.financialTemplate || null,
      industry: profile?.industry || profile?.industry_name || null,
      mainBusiness: profile?.main_operation_business || profile?.business_scope || null,
    },
    facts: {
      quote,
      financialReports: reports,
      financialCalculations: raw?.facts?.financialCalculations || null,
      financialTrends: financialTrends ? {
        annual: Array.isArray(financialTrends.annual) ? financialTrends.annual.slice(0, 6) : [],
        annualSummary: financialTrends.annualSummary || null,
        quality: financialTrends.quality || null,
        dataGaps: Array.isArray(financialTrends.dataGaps) ? financialTrends.dataGaps.slice(0, 12) : [],
      } : null,
      technical: technical ? {
        latestBar: technical.latestBar || null,
        period: technical.period || null,
        metrics: technical.metrics || null,
        sourceMeta: technical.sourceMeta || null,
      } : null,
      announcements: announcements.map((item: any) => ({
        title: item?.title || null,
        publishedAt: item?.publishedAt || null,
        url: item?.url || null,
        category: item?.category || null,
      })),
    },
    evidence: evidence.map((item: any) => ({
      evidenceId: item?.evidenceId || null,
      type: item?.type || null,
      title: item?.title || null,
      value: item?.value ?? null,
      period: item?.period || null,
      source: item?.source || null,
      sourceUrl: item?.sourceUrl || null,
      fetchedAt: item?.fetchedAt || null,
      publishedAt: item?.publishedAt || null,
      freshness: item?.freshness || null,
      verification: item?.verification || null,
    })),
    dataGaps: Array.isArray(raw?.dataGaps) ? raw.dataGaps.slice(0, 30) : [],
    snapshotMeta: raw?.snapshotMeta || { generatedAt: new Date().toISOString(), source: 'mcp-quote-fallback', freshness: 'realtime' },
    scope: '为后续研究提供可核验事实、来源与证据 ID；不包含 AI 结论、估值判断或交易建议。',
  };
}

async function buildQuoteFactSnapshot(symbol: string) {
  const quote = await fetchStockQuote(symbol);
  const fetchedAt = new Date().toISOString();
  return compactStockFactSnapshot({
    symbol: quote.code,
    company: { name: quote.name, profile: {}, financialTemplate: null },
    facts: { quote, financialReports: [], financialCalculations: null, financialTrends: null, technical: null, announcements: [] },
    evidence: Object.entries(quote)
      .filter(([key, value]) => !['code', 'name', 'source'].includes(key) && value !== null && value !== undefined)
      .map(([key, value]) => ({
        evidenceId: `market:${quote.code}:${key}:${fetchedAt.replace(/[^0-9]/g, '')}`,
        type: 'market', title: `${quote.name} ${key}`, value, source: quote.source,
        fetchedAt, freshness: 'realtime', verification: 'third_party',
      })),
    dataGaps: ['当前 MCP 实例未注入应用的财务、技术与公告快照提供器，仅返回实时行情事实。'],
    snapshotMeta: { generatedAt: fetchedAt, source: 'mcp-quote-fallback', freshness: 'realtime' },
  });
}

/** 查询 A 股实时行情（腾讯为主，新浪兜底） */
async function fetchStockQuote(symbol: string) {
  const code = normalizeSymbol(symbol);
  if (!/^\d{6}$/.test(code)) throw new InvalidStockIdentifierError(symbol);
  const market = code.startsWith('6') || code.startsWith('5') || code.startsWith('9') ? 'sh' : 'sz';

  // 腾讯
  const tencentText = await httpGetText(`https://qt.gtimg.cn/q=${market}${code}`, 'https://gu.qq.com/', 'gb18030');
  const tMatch = tencentText.match(new RegExp(`v_${market}${code}="([^"]*)"`));
  const t = tMatch?.[1]?.split('~') || [];
  const tPrice = Number(t[3]);
  if (Number.isFinite(tPrice) && tPrice > 0) {
    return {
      code,
      name: t[1] || code,
      price: Math.round(tPrice * 100) / 100,
      change: Math.round((Number(t[31]) || 0) * 100) / 100,
      changePercent: Math.round((Number(t[32]) || 0) * 100) / 100,
      high: Number(t[33]) || null,
      low: Number(t[34]) || null,
      open: Number(t[5]) || null,
      previousClose: Number(t[4]) || null,
      volume: Number(t[6]) || 0,
      amount: Number(t[37]) || 0,
      source: 'tencent',
    };
  }

  // 新浪兜底
  const sinaSymbol = `${market === 'sh' ? 'sh' : 'sz'}${code}`;
  const sinaText = await httpGetText(`https://hq.sinajs.cn/list=${sinaSymbol}`, 'https://finance.sina.com.cn/', 'gb18030');
  const sMatch = sinaText.match(new RegExp(`hq_str_${sinaSymbol}="([^"]*)"`));
  const s = sMatch?.[1]?.split(',') || [];
  const sPrice = Number(s[3]);
  if (!Number.isFinite(sPrice) || sPrice <= 0) throw new Error('行情源均不可用');
  const prevClose = Number(s[2]);
  return {
    code,
    name: s[0] || code,
    price: Math.round(sPrice * 100) / 100,
    change: Math.round((sPrice - prevClose) * 100) / 100,
    changePercent: prevClose ? Math.round(((sPrice - prevClose) / prevClose) * 10000) / 100 : 0,
    high: Number(s[4]) || null,
    low: Number(s[5]) || null,
    open: Number(s[1]) || null,
    previousClose: prevClose || null,
    volume: Number(s[8]) || 0,
    amount: Number(s[9]) || 0,
    source: 'sina',
  };
}

type StockSearchResult = { code: string; name: string; exchange: 'SH' | 'SZ' | 'BJ' };

function normalizeSearchResult(code: unknown, name: unknown, exchange?: unknown): StockSearchResult | null {
  const normalizedCode = String(code || '').replace(/\D/g, '');
  const normalizedName = String(name || '').trim();
  if (!/^\d{6}$/.test(normalizedCode) || !normalizedName) return null;
  const rawExchange = String(exchange || '').toUpperCase();
  const market: 'SH' | 'SZ' | 'BJ' = rawExchange === 'BJ' || /^[48]/.test(normalizedCode)
    ? 'BJ' : rawExchange === 'SH' || /^(5|6|9)/.test(normalizedCode) ? 'SH' : 'SZ';
  return { code: normalizedCode, name: normalizedName, exchange: market };
}

async function searchStocks(query: string): Promise<StockSearchResult[]> {
  const keyword = String(query || '').trim();
  if (!keyword || /^股票行情$|^行情$|^股市$/.test(keyword)) throw new InvalidStockIdentifierError(keyword);
  const matches = new Map<string, StockSearchResult>();
  try {
    const payload = await httpGetJSON(`https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(keyword)}&type=14&token=D43BF722C1B2D6D0F3513D2F4B09D208&count=10`);
    const rows = Array.isArray(payload?.QuotationCodeTable?.Data) ? payload.QuotationCodeTable.Data : [];
    for (const item of rows) {
      const kind = String(item?.Classify || item?.SecurityTypeName || '');
      if (kind && !/AStock|A股|沪A|深A|北交/.test(kind)) continue;
      const quoteId = String(item?.QuoteID || '');
      const result = normalizeSearchResult(item?.Code || item?.UnifiedCode, item?.Name, quoteId.startsWith('1.') ? 'SH' : quoteId.startsWith('0.') ? 'SZ' : undefined);
      if (result) matches.set(result.code, result);
    }
  } catch {
    // Fall through to the Sina suggestion endpoint.
  }
  if (!matches.size) {
    try {
      const text = await httpGetText(`https://suggest3.sinajs.cn/suggest/type=11,12,13,14,15/&key=${encodeURIComponent(keyword)}`, 'https://finance.sina.com.cn/', 'gb18030');
      for (const item of text.matchAll(/"([a-z]{2})(\d{6}),[^,]*,([^,]+),/gi)) {
        const result = normalizeSearchResult(item[2], item[3], item[1].toUpperCase());
        if (result) matches.set(result.code, result);
      }
    } catch {
      // Error is normalized below.
    }
  }
  if (!matches.size) throw new Error('股票搜索数据源暂不可用或未找到匹配证券');
  return [...matches.values()].slice(0, 10);
}


/** 市场概览（指数 + 领涨板块） */
async function fetchMarketOverview() {
  const indexDefs = [
    { secid: '1.000001', name: '上证指数' },
    { secid: '0.399001', name: '深证成指' },
    { secid: '0.399006', name: '创业板指' },
  ];
  const indices = await Promise.all(
    indexDefs.map(async (item) => {
      try {
        const d = await httpGetJSON(`https://push2.eastmoney.com/api/qt/stock/get?secid=${item.secid}&fields=f43,f44,f45,f46,f47,f48,f60,f170,f100`);
        const q = d?.data || {};
        const price = Number(q.f43) / 100;
        return {
          name: item.name,
          price: Number.isFinite(price) ? Math.round(price * 100) / 100 : null,
          changePercent: Math.round((Number(q.f170) || 0) * 100) / 100,
        };
      } catch {
        return { name: item.name, price: null, changePercent: null };
      }
    }),
  );

  let sectors: { name: string; changePercent: number }[] = [];
  try {
    const sectorData = await httpGetJSON(
      'https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=5&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:90+t:2&fields=f2,f3,f12,f14',
    );
    sectors = (sectorData?.data?.diff || []).map((row: any) => ({
      name: String(row.f14 || ''),
      changePercent: Math.round(Number(row.f3 || 0) * 100) / 100,
    }));
  } catch {
    // 板块源失败不影响整体返回
  }

  return { indices, topSectors: sectors, fetchedAt: new Date().toISOString() };
}

export function createMcpServer(providers: McpDataProviders = {}): McpServer {
  const server = new McpServer({
    name: 'gupiao-market-data',
    version: '1.0.0',
  });

  server.registerTool(
    'get_stock_quote',
    {
      title: '查询 A 股实时行情',
      description:
        '查询单只 A 股实时行情。仅在已知明确股票代码时调用：symbol 必须为 6 位代码或交易所前后缀代码（如 002230、002230.SZ、SH600519）。若用户只说股票名称，先调用 search_stock；若只说“股票行情”“看行情”等泛化意图，不得调用本工具，应追问具体股票。',
      inputSchema: {
        symbol: z.string().trim().min(1).max(MAX_STOCK_IDENTIFIER_LENGTH).regex(/^(?:(?:SH|SZ|BJ)?\d{6}|\d{6}\.(?:SH|SZ|BJ))$/i, 'symbol 必须是 6 位 A 股代码，可带 SH/SZ/BJ 前后缀').describe('单只股票的明确代码：002230、002230.SZ 或 SH600519；不能填写“股票行情”、股票名称或市场泛称。'),
      },
    },
    async ({ symbol }) => {
      try {
        const quote = await fetchStockQuote(symbol);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(quote, null, 2) }],
        };
      } catch (error: any) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: JSON.stringify(toMcpError(error)) }],
        };
      }
    },
  );

  server.registerTool(
    'search_stock',
    {
      title: '搜索 A 股证券',
      description: '按股票名称、6 位代码或代码片段搜索 A 股证券。用户只提供名称时先调用本工具，得到明确代码后再调用 get_stock_quote；用户只说“股票行情”时应追问，不调用行情工具。',
      inputSchema: {
        query: z.string().trim().min(1).max(MAX_STOCK_SEARCH_LENGTH).describe('股票名称、6 位代码或代码片段，例如“科大讯飞”“002230”；最长 64 个字符。'),
      },
    },
    async ({ query }) => {
      try {
        const results = isValidStockCode(query)
          ? [{ code: normalizeSymbol(query), name: '代码已识别，可调用 get_stock_quote 查询实时行情', exchange: /^(5|6|9)/.test(normalizeSymbol(query)) ? 'SH' as const : 'SZ' as const }]
          : await searchStocks(query);
        return { content: [{ type: 'text' as const, text: JSON.stringify({ query, results }, null, 2) }] };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(toMcpError(error)) }] };
      }
    },
  );

  server.registerTool(
    'get_market_overview',
    {
      title: '获取 A 股市场概览',
      description:
        '获取当前 A 股大盘概览：上证/深证/创业板三大指数行情，以及当日领涨板块 Top5。可用于了解整体市场强弱和热点方向。',
      inputSchema: {},
    },
    async () => {
      try {
        const overview = await fetchMarketOverview();
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(overview, null, 2) }],
        };
      } catch (error: any) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: JSON.stringify(toMcpError(error)) }],
        };
      }
    },
  );

  server.registerTool(
    'get_market_observation',
    {
      title: '获取 A 股市场观察快照',
      description: '获取可核验的 A 股市场观察快照：三大指数、板块广度、领涨/领跌板块、市场温度、数据时间、来源和数据缺口。仅陈述当前市场事实，不预测涨跌、不提供交易建议。适合首页、早晚报和日常市场观察。',
      inputSchema: {},
    },
    async () => {
      try {
        const raw = providers.getMarketObservation
          ? await providers.getMarketObservation()
          : await fetchMarketOverview();
        const observation = buildMarketObservation(raw);
        return { content: [{ type: 'text' as const, text: JSON.stringify(observation, null, 2) }] };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(toMcpError(error)) }] };
      }
    },
  );

  server.registerTool(
    'get_stock_fact_snapshot',
    {
      title: '获取 A 股个股事实快照',
      description: '获取单只 A 股的可核验研究底座：身份、实时行情、财务报告与趋势、技术输入、公告、来源、证据 ID 和数据缺口。symbol 必须为明确的 6 位代码；若只有名称，先调用 search_stock。结果只包含事实，不包含 AI 结论、估值判断或交易建议。',
      inputSchema: {
        symbol: z.string().trim().min(1).max(MAX_STOCK_IDENTIFIER_LENGTH).regex(/^(?:(?:SH|SZ|BJ)?\d{6}|\d{6}\.(?:SH|SZ|BJ))$/i, 'symbol 必须是 6 位 A 股代码，可带 SH/SZ/BJ 前后缀').describe('明确的股票代码，例如 002230、002230.SZ 或 SH600519；若只有名称，请先用 search_stock。'),
      },
    },
    async ({ symbol }) => {
      try {
        const code = normalizeSymbol(symbol);
        const raw = providers.getStockFactSnapshot
          ? await providers.getStockFactSnapshot(code)
          : await buildQuoteFactSnapshot(code);
        const snapshot = compactStockFactSnapshot(raw);
        return { content: [{ type: 'text' as const, text: JSON.stringify(snapshot, null, 2) }] };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(toMcpError(error)) }] };
      }
    },
  );

  return server;
}
