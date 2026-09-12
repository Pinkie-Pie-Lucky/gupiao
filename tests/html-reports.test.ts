import assert from 'node:assert/strict';
import test from 'node:test';
import { renderMarketHotspotsReportHtml, renderStockAnalysisReportHtml } from '../backend/core/htmlReports.js';

test('个股 HTML 报告保留研究状态、年度趋势和数据缺口，并转义不可信文本', () => {
  const html = renderStockAnalysisReportHtml({
    symbol: '002230',
    company: { name: '科大讯飞<script>alert(1)</script>', industry: '软件服务' },
    quote: { price: 42.1, changePercent: 0.0285 },
    managerSnapshot: {
      symbol: '002230', researchStatus: 'watch', riskLevel: 'medium', evidence: [{ evidenceId: 'e-1' }],
      supportingCase: [{ text: '收入同比增长', evidenceIds: ['e-1'] }],
      counterCase: [{ text: '估值样本不足', evidenceIds: [] }],
      dataGaps: ['公告正文尚未核验'],
      agentOutputs: {
        fundamental: { financialTrends: { annual: [{ year: 2023, revenue: 10 }, { year: 2024, revenue: 12 }] }, signals: [{ summary: '财务信号稳定', status: 'stable' }] },
      },
    },
  });
  assert.match(html, /个股分析报告/);
  assert.match(html, /年度财务趋势/);
  assert.match(html, /公告正文尚未核验/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});

test('市场 HTML 报告同时展示首页概览、板块精选与市场地图', () => {
  const html = renderMarketHotspotsReportHtml({
    overview: {
      indices: [{ name: '上证指数', price: 3200, changePercent: 0.5 }],
      marketBreath: { up: 120, down: 65 }, marketTemperature: { temperature: 62 },
    },
    marketMap: { sectors: [{ sector: '半导体', changePercent: 3.1, signalTags: ['今日主线'], beginnerExplanation: '半导体今日上涨 3.10%' }] },
    dailyPicks: [{ sectorName: '半导体', rankReason: '涨幅与排行靠前' }],
    dataGaps: ['新闻关联尚未完全核验'],
  });
  assert.match(html, /上证指数/);
  assert.match(html, /每日板块精选/);
  assert.match(html, /市场地图/);
  assert.match(html, /新闻关联尚未完全核验/);
});

test('MCP 注册 HTML 报告工具，且条件筛选 Skill 提供统一命令写法', async () => {
  const fs = await import('node:fs/promises');
  const mcpSource = await fs.readFile(new URL('../backend/mcp/server.ts', import.meta.url), 'utf8');
  const skill = await fs.readFile(new URL('../skills/condition-screener/SKILL.md', import.meta.url), 'utf8');
  assert.match(mcpSource, /generate_stock_analysis_html_report/);
  assert.match(mcpSource, /generate_market_hotspots_html_report/);
  assert.match(skill, /使用 stock_analyze 条件选股/);
});

test('公开市场报告复用首页早报 Top 3，而不是把板块精选全部当作市场事件', async () => {
  const fs = await import('node:fs/promises');
  const home = await fs.readFile(new URL('../frontend/src/components/HomeTab.tsx', import.meta.url), 'utf8');
  const publicReport = await fs.readFile(new URL('../frontend/src/components/PublicMarketHotspotsReport.tsx', import.meta.url), 'utf8');
  const server = await fs.readFile(new URL('../backend/server.ts', import.meta.url), 'utf8');
  assert.match(home, /MARKET_STORY_DISPLAY_LIMIT = 3/);
  assert.match(home, /morningReport\?: Partial<Omit<MorningReportState, 'loading'>>/);
  assert.match(home, /SHOW_HOME_LEARNING_CARDS = false/);
  assert.match(publicReport, /morningReport: report\.payload\.morningReport/);
  assert.match(server, /generateMorningReport\(\)/);
  assert.match(server, /morningReport,/);
});
