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
import { OPEN_SOURCE_SCHEMA_VERSION, resultEnvelope } from '../core/contracts.js';
import { buildQuoteFactSnapshot as buildQuoteFactSnapshotCore } from '../core/factSnapshotFallback.js';
import { buildMarketObservation as buildMarketObservationCore } from '../core/marketObservation.js';
import { fetchMarketOverview as fetchMarketOverviewAdapter, fetchStockQuote as fetchStockQuoteAdapter, InvalidStockIdentifierError, isValidStockCode, normalizeSymbol, searchStocks as searchStocksAdapter } from '../dataSources/publicMarket.js';

const MAX_STOCK_IDENTIFIER_LENGTH = 16;
const MAX_STOCK_SEARCH_LENGTH = 64;

function toMcpError(error: unknown) {
  const message = String((error as Error)?.message || '未知错误');
  if (error instanceof InvalidStockIdentifierError) return { error: 'invalid_argument', message, retryable: false };
  if (error instanceof McpFeatureUnavailableError) return { error: 'feature_unavailable', message, retryable: false };
  return { error: 'upstream_error', trace_id: randomUUID(), message, retryable: true };
}

export type McpDataProviders = {
  /** 由宿主应用注入的完整市场观察数据；未注入时使用轻量行情源。 */
  getMarketObservation?: () => Promise<unknown>;
  /** 由宿主应用注入的个股事实快照；不得包含 AI 结论。 */
  getStockFactSnapshot?: (symbol: string) => Promise<unknown>;
  /** 由宿主应用注入的妙想条件筛选能力；密钥只保留在宿主服务端。 */
  screenStocks?: (query: string, forceRefresh: boolean) => Promise<unknown>;
};

class McpFeatureUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpFeatureUnavailableError';
  }
}

export function buildMarketObservation(overview: any) {
  return buildMarketObservationCore(overview);
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
    schemaVersion: OPEN_SOURCE_SCHEMA_VERSION,
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

/** 条件筛选输出只保留研究候选与数据口径，不把服务端配置暴露给 MCP 调用方。 */
export function compactStockScreeningResult(raw: any) {
  const columns = Array.isArray(raw?.columns) ? raw.columns.slice(0, 30) : [];
  const rows = Array.isArray(raw?.rows) ? raw.rows.slice(0, 100) : [];
  return {
    schemaVersion: OPEN_SOURCE_SCHEMA_VERSION,
    query: String(raw?.query || ''),
    title: String(raw?.title || '条件筛选候选池'),
    conditions: Array.isArray(raw?.conditions) ? raw.conditions.slice(0, 12) : [],
    totalCondition: raw?.totalCondition || null,
    selectLogic: raw?.selectLogic || null,
    total: Number.isFinite(Number(raw?.total)) ? Number(raw.total) : rows.length,
    columns,
    rows,
    displayedRows: rows.length,
    dataSource: raw?.dataSource || 'empty',
    sourceMeta: raw?.sourceMeta || null,
    dataGaps: rows.length >= 100 ? ['MCP 响应最多展示前 100 条候选；总命中数见 total。'] : [],
    scope: '结果仅表示条件命中形成的研究候选池，不构成买卖推荐、收益承诺或自动交易指令。',
  };
}

export async function buildQuoteFactSnapshot(symbol: string) {
  return buildQuoteFactSnapshotCore(symbol);
}

/** 查询 A 股实时行情（腾讯为主，新浪兜底） */
export async function fetchStockQuote(symbol: string) {
  return fetchStockQuoteAdapter(symbol);
}

export async function searchStocks(query: string) {
  return searchStocksAdapter(query);
}


/** 市场概览（指数 + 领涨板块） */
export async function fetchMarketOverview() {
  return fetchMarketOverviewAdapter();
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
          content: [{ type: 'text' as const, text: JSON.stringify(resultEnvelope('stock_quote', quote, {
            sourceMeta: { source: String(quote.source || 'unknown'), fetchedAt: new Date().toISOString(), freshness: 'live' },
            scope: '仅为当前已取得的行情事实，不构成交易建议。',
          }), null, 2) }],
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
        return { content: [{ type: 'text' as const, text: JSON.stringify(resultEnvelope('stock_search', { query, results }, {
          sourceMeta: { source: 'eastmoney_sina_search', fetchedAt: new Date().toISOString(), freshness: 'live' },
          scope: '仅返回证券身份匹配，不构成交易建议。',
        }), null, 2) }] };
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
          content: [{ type: 'text' as const, text: JSON.stringify(resultEnvelope('market_overview', overview, {
            sourceMeta: { source: 'eastmoney_public_market', fetchedAt: String(overview.fetchedAt || new Date().toISOString()), freshness: 'live' },
            scope: '仅反映已取得的市场事实，不预测涨跌，也不构成交易建议。',
          }), null, 2) }],
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
        return { content: [{ type: 'text' as const, text: JSON.stringify(resultEnvelope('market_observation', observation, {
          sourceMeta: observation.sourceMeta || { source: 'public_market', fetchedAt: observation.dataAsOf, freshness: 'unknown' },
          dataGaps: observation.dataGaps,
          scope: observation.scope,
          generatedAt: observation.dataAsOf,
        }), null, 2) }] };
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
        return { content: [{ type: 'text' as const, text: JSON.stringify(resultEnvelope('stock_fact_snapshot', snapshot, {
          sourceMeta: snapshot.snapshotMeta ? { source: String(snapshot.snapshotMeta.source || 'unknown'), fetchedAt: String(snapshot.snapshotMeta.generatedAt || new Date().toISOString()), freshness: snapshot.snapshotMeta.freshness === 'realtime' ? 'live' : 'unknown' } : null,
          dataGaps: snapshot.dataGaps,
          scope: snapshot.scope,
        }), null, 2) }] };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(toMcpError(error)) }] };
      }
    },
  );

  server.registerTool(
    'screen_stocks',
    {
      title: '按自然语言筛选 A 股候选池',
      description: '使用服务端配置的东方财富妙想能力，根据行情、估值、财务、行业或指数成分等自然语言条件筛选 A 股研究候选池。仅返回条件命中、字段、数据时点和来源；不把候选池表述为买入推荐。',
      inputSchema: {
        query: z.string().trim().min(1).max(180).describe('自然语言筛选条件，例如“ROE 大于 15%，净利润持续增长的 A 股”；长度 1 至 180 字符。'),
        refresh: z.boolean().optional().default(false).describe('是否绕过服务端缓存并回源请求；仅在用户明确要求刷新时设为 true。'),
      },
    },
    async ({ query, refresh }) => {
      try {
        if (!providers.screenStocks) {
          throw new McpFeatureUnavailableError('当前 MCP 实例未配置条件筛选提供器。请在产品服务中配置 MX_APIKEY 后调用。');
        }
        const raw = await providers.screenStocks(query, refresh);
        const result = compactStockScreeningResult(raw);
        return { content: [{ type: 'text' as const, text: JSON.stringify(resultEnvelope('stock_screening', result, {
          sourceMeta: result.sourceMeta ? { ...result.sourceMeta, freshness: result.sourceMeta.freshness as 'live' | 'cache' } : null,
          dataGaps: result.dataGaps,
          scope: result.scope,
        }), null, 2) }] };
      } catch (error: any) {
        return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(toMcpError(error)) }] };
      }
    },
  );

  return server;
}
