import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createResearchViewModel, normalizeResearchSymbol, researchDataGapText, researchSectionItems } from '../frontend/src/lib/stockResearch';
import { uniqueResearchStocks } from '../frontend/src/components/StockResearchPicker';

test('normalizes A-share symbols before calling the manager endpoint', () => {
  assert.equal(normalizeResearchSymbol('002230.SZ'), '002230');
  assert.equal(normalizeResearchSymbol('600519.SH'), '600519');
  assert.equal(normalizeResearchSymbol('SH600519'), '600519');
  assert.equal(normalizeResearchSymbol('688981'), '688981');
  assert.throws(() => normalizeResearchSymbol('002230.SZ.extra'), /6 位数字/);
});

test('keeps available research modules visible when one Agent output is unavailable', () => {
  const view = createResearchViewModel({
    managerSnapshot: {
      dataGaps: ['舆情不可用：服务暂时无响应'],
      agentOutputs: {
        fundamental: { signals: [{ claim: '营收改善' }] },
        technical: { signals: [{ claim: '趋势仍需确认' }] },
        sentiment: null,
        risk: { risks: [{ claim: '波动率偏高' }] },
      },
    },
  });
  assert.equal(researchSectionItems(view.outputs, 'fundamental')[0].claim, '营收改善');
  assert.equal(researchSectionItems(view.outputs, 'technical')[0].claim, '趋势仍需确认');
  assert.equal(researchSectionItems(view.outputs, 'risk')[0].claim, '波动率偏高');
  assert.deepEqual(view.dataGaps, ['舆情不可用：服务暂时无响应']);
});

test('maps all deterministic agent outputs and scalar sentiment fields', () => {
  const outputs = {
    fundamental: { signals: [{ claim: '盈利改善' }], vetoes: [{ description: '现金流缺失' }] },
    sentiment: { attention: 'rising', tone: 'positive', disagreement: 'medium', propagationQuality: 'insufficient' },
    risk: { vetoes: [{ claim: '重大风险' }], risks: [{ claim: '估值风险' }], watchConditions: [{ claim: '等待财报' }] },
  };
  assert.deepEqual(researchSectionItems(outputs, 'fundamental').map((item) => item.claim || item.description), ['盈利改善', '现金流缺失']);
  assert.deepEqual(researchSectionItems(outputs, 'sentiment'), ['关注度：rising', '情绪倾向：positive', '观点分歧：medium', '传播质量：insufficient']);
  assert.equal(researchSectionItems(outputs, 'risk').length, 3);
});

test('creates a stable view model with opinion priority and deterministic fallback', () => {
  const view = createResearchViewModel({
    opinion: { supportingCase: [{ claim: 'AI 支持观点' }], counterCase: [], dataGaps: ['估值数据缺失'] },
    managerSnapshot: {
      supportingCase: [{ claim: '确定性支持观点' }],
      counterCase: [{ claim: '确定性反方观点' }],
      requiredConditions: [{ claim: '等待正式财报' }],
      dataGaps: ['财务数据缺失'],
      evidence: [{ evidenceId: 'market:1' }],
      agentOutputs: { technical: { signals: [{ claim: '趋势稳定' }] } },
    },
  });
  assert.equal(view.supporting[0].claim, 'AI 支持观点');
  assert.equal(view.counter[0].claim, '确定性反方观点');
  assert.deepEqual(view.dataGaps, ['财务数据缺失', '估值数据缺失']);
  assert.equal(view.evidence.length, 1);
});

test('turns internal data-source failures into user-facing data gaps', () => {
  const text = researchDataGapText('Command failed: py -3.14 U:\\project\\scripts\\financial_summary.py 002230 No suitable Python runtime found');
  assert.equal(text, '财务数据服务暂不可用，请稍后刷新。');
  assert.ok(!text.includes('Command failed'));
  assert.ok(!text.includes('U:\\'));
});

test('keeps critical stock research copy as valid UTF-8 Chinese', () => {
  const tab = fs.readFileSync(path.resolve('frontend/src/components/StockResearchTab.tsx'), 'utf8');
  const overview = fs.readFileSync(path.resolve('frontend/src/components/StockResearchOverview.tsx'), 'utf8');
  const workspace = fs.readFileSync(path.resolve('frontend/src/components/StockResearchWorkspace.tsx'), 'utf8');
  const source = `${tab}\n${overview}\n${workspace}`;
  for (const text of ['个股分析', '研究材料完整', '支持与反方', '下一步核验', '数据缺口']) assert.ok(source.includes(text), `missing copy: ${text}`);
  for (const mojibake of ['鐮旂┒', '涓偂', '璇佹嵁']) assert.ok(!source.includes(mojibake), `mojibake found: ${mojibake}`);
});

test('puts the Manager hold assessment and switchable three horizons in the first-screen component', () => {
  const source = fs.readFileSync(path.resolve('frontend/src/components/StockResearchOverview.tsx'), 'utf8');
  for (const text of ['持有评估', '综合倾向', '周期结论', '短期', '中期', '长期', '置信度']) assert.ok(source.includes(text), `missing overview copy: ${text}`);
  for (const field of ['holdAssessment', 'direction', 'horizons?.short', 'horizons?.medium', 'horizons?.long', 'role="tablist"', 'aria-selected']) assert.ok(source.includes(field), `missing Manager field: ${field}`);
});

test('deduplicates the research stock universe and keeps watchlist priority', () => {
  const watch = { name: '自选名称', code: '002230.SZ', price: 1, changePercent: 0, volume: '--', turnover: '--', history: [] };
  const market = { ...watch, name: '市场名称' };
  const result = uniqueResearchStocks([watch, market]);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, '自选名称');
});

test('keeps stock switching and empty-state entry in the research flow', () => {
  const app = fs.readFileSync(path.resolve('frontend/src/App.tsx'), 'utf8');
  const picker = fs.readFileSync(path.resolve('frontend/src/components/StockResearchPicker.tsx'), 'utf8');
  assert.ok(app.includes('StockResearchEmptyState'));
  assert.ok(app.includes('onSelectStock={setResearchStock}'));
  for (const text of ['输入股票名称或代码', '我的自选', '未找到匹配股票']) assert.ok(picker.includes(text), `missing picker state: ${text}`);
});

test('uses domain-specific structures for every research module', () => {
  const source = fs.readFileSync(path.resolve('frontend/src/components/StockResearchModules.tsx'), 'utf8');
  for (const component of ['Fundamental', 'Technical', 'Events', 'Industry', 'Sentiment', 'Valuation', 'Risk', 'Evidence']) {
    assert.ok(source.includes(`function ${component}`), `missing module: ${component}`);
  }
  for (const text of ['基本面否决项', '结构失效条件', '事件后反应', '行业位置', '产业链传导', '行业与政策事件', '历史估值位置', '同行业可比', '模型情景', '观察与解除条件', '核验：']) {
    assert.ok(source.includes(text), `missing module copy: ${text}`);
  }
});

test('keeps annual reports and derived single-quarter values separate in the fundamental UI', () => {
  const modules = fs.readFileSync(path.resolve('frontend/src/components/StockResearchModules.tsx'), 'utf8');
  const server = fs.readFileSync(path.resolve('backend/server.ts'), 'utf8');
  const adapter = fs.readFileSync(path.resolve('scripts/python/ths_financial_statements.py'), 'utf8');
  for (const text of ['function FinancialTrend', '完整年报', '拆分为单季度值', '年度趋势质量', 'FinancialTrendQuality']) assert.ok(modules.includes(text), `missing fundamental trend UI: ${text}`);
  for (const text of ['function buildFinancialTrendSnapshot', 'isDerivedSingleQuarter', 'annualSummary', 'self_history_trend_v1', 'financialTrends']) assert.ok(server.includes(text), `missing financial trend contract: ${text}`);
  assert.ok(adapter.includes('[:24]'), 'financial adapter must retain enough periods for five-year annual history');
});

test('renders scored annual dimensions, five-year charts and readable financial cards', () => {
  const modules = fs.readFileSync(path.resolve('frontend/src/components/StockResearchModules.tsx'), 'utf8');
  const server = fs.readFileSync(path.resolve('backend/server.ts'), 'utf8');
  const adapter = fs.readFileSync(path.resolve('scripts/python/ths_financial_statements.py'), 'utf8');
  for (const text of ['FinancialFiveYearTrends', '近 5 年关键财务趋势', 'ROE', '净利率', '营收增速', 'role="progressbar"', '这个指标怎么看？', '趋势改善', '趋势走弱', '信号分歧', '流动比率']) {
    assert.ok(modules.includes(text), `missing readable fundamental feature: ${text}`);
  }
  for (const text of ['scoredDimensions', 'dimensions: scoredDimensions', 'currentRatio']) assert.ok(server.includes(text), `missing financial contract: ${text}`);
  for (const text of ['currentAssets', 'currentLiabilities']) assert.ok(adapter.includes(text), `missing balance-sheet field mapping: ${text}`);
});

test('prevents module conclusions from silently repeating their rationale or evidence', () => {
  const server = fs.readFileSync(path.resolve('backend/server.ts'), 'utf8');
  for (const text of ['researchTextIsNearDuplicate', '不以重复的单条事实替代总括结论', '模块四段必须严格分工', '支持与反方不得重复同一事实']) assert.ok(server.includes(text), `missing explanation separation guard: ${text}`);
});

test('keeps the no-AI research mode usable and collapses module evidence by default', () => {
  const tab = fs.readFileSync(path.resolve('frontend/src/components/StockResearchTab.tsx'), 'utf8');
  const modules = fs.readFileSync(path.resolve('frontend/src/components/StockResearchModules.tsx'), 'utf8');
  for (const text of ['/api/stock-manager-snapshot', "aiStatus: 'pending'", 'industryPromise', '不再阻塞首屏']) assert.ok(tab.includes(text), `missing resilient research loading behavior: ${text}`);
  for (const text of ["improving: '改善'", "deteriorating: '走弱'", 'const [evidenceOpen, setEvidenceOpen]', '支持与反方证据', 'deterministicConclusion', 'aiInterpretation', 'AI 观点摘要']) assert.ok(modules.includes(text), `missing readable four-part module behavior: ${text}`);
});

test('keeps loading, retry, refresh-error and narrow-screen states actionable', () => {
  const tab = fs.readFileSync(path.resolve('frontend/src/components/StockResearchTab.tsx'), 'utf8');
  const overview = fs.readFileSync(path.resolve('frontend/src/components/StockResearchOverview.tsx'), 'utf8');
  for (const text of ['研究数据加载失败', '重新加载', '刷新失败，当前仍显示上一次结果', '正在加载研究模块']) assert.ok(tab.includes(text), `missing state: ${text}`);
  assert.ok(tab.includes('requestSequence'), 'stock switching must reject stale responses');
  assert.ok(overview.includes('grid-cols-3') && overview.includes('min-h-11'), 'horizon controls must remain usable on narrow screens');
});

test('keeps deterministic holding and horizon results visible when only the AI explanation falls back', () => {
  const tab = fs.readFileSync(path.resolve('frontend/src/components/StockResearchTab.tsx'), 'utf8');
  const overview = fs.readFileSync(path.resolve('frontend/src/components/StockResearchOverview.tsx'), 'utf8');
  assert.ok(tab.includes('const aiFallback'), 'AI fallback state should be passed separately');
  assert.ok(overview.includes('AI 解读暂不可用'), 'fallback must explain the degraded AI layer');
  assert.ok(!overview.includes('暂不展示持有评估与周期结论'), 'AI fallback must not hide deterministic conclusions');
});

test('loads the industry Agent independently so its AI explanation cannot block CIO research', () => {
  const tab = fs.readFileSync(path.resolve('frontend/src/components/StockResearchTab.tsx'), 'utf8');
  assert.ok(tab.includes('/api/stock-agents/industry-chain?symbol='));
  assert.ok(tab.includes('industryPromise'));
  assert.ok(tab.includes('moduleExplanations'));
});

test('keeps the restored sentiment section in the research flow with domain-specific panels', () => {
  const tab = fs.readFileSync(path.resolve('frontend/src/components/StockResearchTab.tsx'), 'utf8');
  const workspace = fs.readFileSync(path.resolve('frontend/src/components/StockResearchWorkspace.tsx'), 'utf8');
  const modules = fs.readFileSync(path.resolve('frontend/src/components/StockResearchModules.tsx'), 'utf8');
  assert.ok(workspace.includes('const sectionKeys'));
  assert.ok(workspace.includes("'sentiment',"));
  assert.ok(workspace.includes('sectionKeys.map'));
  for (const text of ['观点分歧怎么读？', '分歧较大：正负观点接近', '本股直接命中', '财经市场背景', '非本股消息', '讨论话题', '事件后反应']) assert.ok(modules.includes(text), `missing sentiment panel: ${text}`);
});

test('条件选股使用统一自选状态并移除研究按钮', () => {
  const screener = fs.readFileSync(path.resolve('frontend/src/components/StockScreenerTab.tsx'), 'utf8');
  const app = fs.readFileSync(path.resolve('frontend/src/App.tsx'), 'utf8');
  assert.ok(screener.includes('followedStocks: StockItem[]'), 'screener must receive global watchlist state');
  assert.ok(screener.includes('加入自选') && screener.includes('已在自选'), 'screener must expose add/watchlist state');
  assert.ok(!screener.includes('>研究</button>'), 'legacy research action must be removed');
  assert.ok(app.includes('<StockScreenerTab followedStocks={followedStocks}'), 'App must pass the global watchlist into screener');
});
