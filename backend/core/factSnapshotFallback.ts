import { fetchStockQuote } from '../dataSources/publicMarket.js';

/**
 * 不运行完整研究服务时的最小事实快照。
 * 该层只组合适配器事实和证据 ID；MCP/API 层再决定如何裁剪和包装。
 */
export async function buildQuoteFactSnapshot(symbol: string) {
  const quote = await fetchStockQuote(symbol);
  const fetchedAt = new Date().toISOString();
  return {
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
    dataGaps: ['当前入口未注入完整财务、技术与公告快照提供器，仅返回实时行情事实。'],
    snapshotMeta: { generatedAt: fetchedAt, source: 'quote_fallback', freshness: 'realtime' },
  };
}
