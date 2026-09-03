import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMarketObservation, compactStockFactSnapshot, compactStockScreeningResult } from '../backend/mcp/server.js';

test('市场观察只依据已返回的行情计算当前状态，并标注缺口', () => {
  const result = buildMarketObservation({
    indices: [
      { name: '上证指数', changePercent: 1.1 },
      { name: '深证成指', changePercent: 0.8 },
      { name: '创业板指', changePercent: 0.6 },
    ],
    topSectors: [{ name: '半导体', changePercent: 3.2 }],
    fetchedAt: '2026-09-03T01:30:00.000Z',
  });

  assert.equal(result.observation.marketState, '指数普遍走强');
  assert.equal(result.observation.indexBreadth.up, 3);
  assert.equal(result.dataGaps.length, 0);
  assert.match(result.scope, /不预测/);
});

test('个股事实快照保留证据和数据缺口，但不暴露内部 AI 输出', () => {
  const snapshot = compactStockFactSnapshot({
    symbol: '002230',
    company: { name: '科大讯飞', profile: { industry: '软件服务' }, financialTemplate: 'non_financial' },
    facts: {
      quote: { code: '002230', name: '科大讯飞', price: 42.1 },
      financialReports: [{ period: '2025-12-31', metrics: { revenue: 100 } }],
      financialCalculations: { period: '2025-12-31', metrics: { grossMargin: 0.4 } },
      financialTrends: { annual: [{ period: '2025-12-31' }], annualSummary: { revenueTrend: 'improving' } },
      technical: { latestBar: { date: '2026-09-02', close: 42.1 }, metrics: { ma20: 40 } },
      announcements: [{ title: '2025 年年度报告', publishedAt: '2026-03-01', url: 'https://example.test/report.pdf' }],
    },
    evidence: [{ evidenceId: 'financial:002230:revenue:2025-12-31', type: 'financial', source: 'ths', value: 100 }],
    dataGaps: [{ source: 'cninfo', reason: '文档尚未核验' }],
    opinion: { conclusion: '不应出现在 MCP 事实快照中' },
  });

  assert.equal(snapshot.company.industry, '软件服务');
  assert.equal(snapshot.evidence[0].evidenceId, 'financial:002230:revenue:2025-12-31');
  assert.equal('opinion' in snapshot, false);
  assert.equal(snapshot.dataGaps[0].source, 'cninfo');
});

test('条件筛选快照保留查询、条件和来源，并限制 MCP 返回行数', () => {
  const result = compactStockScreeningResult({
    query: 'ROE 大于 15%', title: '高 ROE 候选', total: 156,
    conditions: [{ description: 'ROE 大于 15%', stockCount: 156 }],
    columns: [{ key: 'code', label: '代码' }],
    rows: Array.from({ length: 120 }, (_, index) => ({ code: String(index).padStart(6, '0') })),
    sourceMeta: { source: 'eastmoney_mx_screener', freshness: 'live' },
  });

  assert.equal(result.displayedRows, 100);
  assert.equal(result.total, 156);
  assert.match(result.dataGaps[0], /100/);
  assert.match(result.scope, /不构成买卖推荐/);
});
