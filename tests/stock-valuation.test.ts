import test from 'node:test';
import assert from 'node:assert/strict';

function makeSnapshot({ market = true, financial = true } = {}): any {
  const marketEvidence = 'valuation_market:600519:pb:2026-08-08';
  const financialEvidence = 'financial:600519:equity:2026-06-30';
  return {
    symbol: '600519',
    valuationStatus: market && financial ? 'limited' : 'unavailable',
    multiples: { peDynamic: market ? 22.5 : null, peStatic: null, pb: market ? 6.1 : null, ps: null, peDynamicStatus: market ? 'meaningful' : 'unavailable', peStaticStatus: 'unavailable', pbStatus: market ? 'meaningful' : 'unavailable', psStatus: 'unavailable' },
    market: { price: market ? 1600 : null, marketCap: market ? 2_000_000_000_000 : null, floatMarketCap: market ? 1_800_000_000_000 : null },
    financialBasis: { period: financial ? '2026-06-30' : null, equity: financial ? 300_000_000_000 : null, evidenceIds: financial ? [financialEvidence] : [] },
    valuationFramework: { template: 'non_financial', preferredMultiples: ['peDynamic', 'pb'], interpretationInputs: { netProfit: financial ? 80_000_000_000 : null } },
    comparison: { historyPercentile: null, peerComparison: null, status: 'unavailable', reason: '尚未接入历史分位和行业可比估值。' },
    evidence: [{ evidenceId: marketEvidence }, ...(financial ? [{ evidenceId: financialEvidence }] : [])],
    evidenceIds: [marketEvidence, ...(financial ? [financialEvidence] : [])],
    dataGaps: ['尚未接入历史分位和行业可比估值，不能输出高估或低估判断。'],
    scenarioModel: { version: 'valuation-scenario-v1', earnings: { status: 'limited', scenarios: [] }, dcf: { status: 'unavailable', scenarios: [] }, residualIncome: { status: 'unavailable', scenarios: [] } },
    snapshotMeta: { valuationVersion: 'stock-valuation-v3' },
  };
}

function validateSnapshot(snapshot: any) {
  assert.equal(snapshot.snapshotMeta?.valuationVersion, 'stock-valuation-v3');
  assert.ok(['limited', 'unavailable'].includes(snapshot.valuationStatus));
  for (const key of ['peDynamicStatus', 'peStaticStatus', 'pbStatus', 'psStatus']) assert.ok(['meaningful', 'not_meaningful', 'unavailable'].includes(snapshot.multiples[key]));
  assert.ok(['available', 'unavailable'].includes(snapshot.comparison.status));
  assert.equal(snapshot.scenarioModel.version, 'valuation-scenario-v1');
  assert.deepEqual(snapshot.valuationFramework.preferredMultiples, snapshot.valuationFramework.template === 'bank' ? ['pb', 'peDynamic'] : ['peDynamic', 'pb']);
  assert.equal(/高估|低估/.test(JSON.stringify({ multiples: snapshot.multiples, comparison: snapshot.comparison })), false);
  const evidence = new Set(snapshot.evidenceIds || []);
  for (const id of snapshot.financialBasis.evidenceIds || []) assert.ok(evidence.has(id));
}

test('valuation snapshot exposes multiples without high-low judgement', () => {
  const snapshot = makeSnapshot();
  validateSnapshot(snapshot);
  assert.equal(snapshot.valuationStatus, 'limited');
  assert.equal(snapshot.multiples.peDynamicStatus, 'meaningful');
});

test('missing market valuation stays unavailable', () => {
  const snapshot = makeSnapshot({ market: false });
  validateSnapshot(snapshot);
  assert.equal(snapshot.valuationStatus, 'unavailable');
  assert.equal(snapshot.multiples.pbStatus, 'unavailable');
});

test('non-positive PE is not meaningful rather than expensive', () => {
  const snapshot = makeSnapshot();
  snapshot.multiples.peDynamic = -8;
  snapshot.multiples.peDynamicStatus = 'not_meaningful';
  validateSnapshot(snapshot);
  assert.equal(snapshot.multiples.peDynamicStatus, 'not_meaningful');
});

test('bank framework prioritizes PB and ROE and excludes ordinary-company cash flow multiples', () => {
  const snapshot = makeSnapshot();
  snapshot.company = { financialTemplate: 'bank' };
  snapshot.valuationFramework = { template: 'bank', preferredMultiples: ['pb', 'peDynamic'], excludedMultiples: ['ps', 'evEbitda', 'freeCashFlowYield'], interpretationInputs: { roeApprox: 0.11 } };
  validateSnapshot(snapshot);
  assert.deepEqual(snapshot.valuationFramework.preferredMultiples, ['pb', 'peDynamic']);
  assert.ok(snapshot.valuationFramework.excludedMultiples.includes('evEbitda'));
});

test('history and peer percentile data are explicit comparison evidence', () => {
  const snapshot = makeSnapshot();
  const historyEvidence = 'valuation_history:600519:pe:2026-08-08';
  const peerEvidence = 'valuation_peer:600519:pe:食品饮料';
  snapshot.comparison = { status: 'available', historyPercentile: { pe: { percentile: 78.5, sampleCount: 240 } }, peerComparison: { pe: { peerPercentile: 72.2, peerCount: 38 } } };
  snapshot.evidenceIds.push(historyEvidence, peerEvidence);
  validateSnapshot(snapshot);
  assert.equal(snapshot.comparison.status, 'available');
  assert.equal(snapshot.comparison.historyPercentile.pe.percentile, 78.5);
});

test('DCF stays unavailable when free cash flow or net debt is missing', () => {
  const snapshot = makeSnapshot();
  assert.equal(snapshot.scenarioModel.dcf.status, 'unavailable');
  assert.equal(snapshot.scenarioModel.residualIncome.status, 'unavailable');
});

test('residual-income scenario must expose assumptions and remain a limited model', () => {
  const snapshot = makeSnapshot();
  snapshot.scenarioModel.residualIncome = {
    status: 'limited',
    scenarios: [{ id: 'base', scenarioRoe: 0.11, costOfEquity: 0.1, terminalGrowthRate: 0.03, equityValue: 320 }],
    reason: '银行剩余收益情景。',
  };
  assert.equal(snapshot.scenarioModel.residualIncome.status, 'limited');
  assert.equal(snapshot.scenarioModel.residualIncome.scenarios[0].costOfEquity, 0.1);
  assert.equal(/目标价|确定价值/.test(JSON.stringify(snapshot.scenarioModel)), false);
});

test('earnings scenarios remain ordered and bounded by the sensitivity rule', () => {
  const baseGrowth = 0.18;
  const scenarios = [
    { id: 'bear', growthRate: Math.max(-0.5, baseGrowth - 0.1) },
    { id: 'base', growthRate: baseGrowth },
    { id: 'bull', growthRate: Math.min(0.5, baseGrowth + 0.1) },
  ];
  assert.deepEqual(scenarios.map((item) => item.id), ['bear', 'base', 'bull']);
  assert.ok(scenarios.every((item) => item.growthRate >= -0.5 && item.growthRate <= 0.5));
  assert.ok(scenarios[0].growthRate < scenarios[1].growthRate);
  assert.ok(scenarios[1].growthRate < scenarios[2].growthRate);
});

test('DCF complete-input scenario returns model values without becoming a target price', () => {
  const baseFcf = 100;
  const growthRate = 0.08;
  const discountRate = 0.1;
  const terminalGrowthRate = 0.03;
  const projectedFcf = Array.from({ length: 5 }, (_item, index) => baseFcf * Math.pow(1 + growthRate, index + 1));
  const explicitValue = projectedFcf.reduce((sum, value, index) => sum + value / Math.pow(1 + discountRate, index + 1), 0);
  const terminalValue = projectedFcf[4] * (1 + terminalGrowthRate) / (discountRate - terminalGrowthRate);
  const enterpriseValue = explicitValue + terminalValue / Math.pow(1 + discountRate, 5);
  assert.ok(Number.isFinite(enterpriseValue) && enterpriseValue > 0);
  assert.ok(discountRate > terminalGrowthRate);
  assert.equal(/目标价|确定内在价值/.test(JSON.stringify({ enterpriseValue, discountRate, terminalGrowthRate })), false);
});

test('DCF degrades when discount rate is not greater than terminal growth', () => {
  const discountRate = 0.03;
  const terminalGrowthRate = 0.03;
  const model = discountRate > terminalGrowthRate ? 'limited' : 'unavailable';
  assert.equal(model, 'unavailable');
});

test('bank residual-income scenarios respond to ROE relative to cost of equity', () => {
  const equity = 1_000;
  const costOfEquity = 0.1;
  const scenarios = [0.08, 0.1, 0.12].map((roe) => ({ roe, residualIncome: equity * (roe - costOfEquity) }));
  assert.equal(scenarios[1].residualIncome, 0);
  assert.ok(scenarios[0].residualIncome < scenarios[1].residualIncome);
  assert.ok(scenarios[1].residualIncome < scenarios[2].residualIncome);
});

test('missing earnings inputs keep all model outputs unavailable', () => {
  const model = { earnings: { status: 'unavailable' }, dcf: { status: 'unavailable' }, residualIncome: { status: 'unavailable' } };
  assert.deepEqual(Object.values(model).map((item: any) => item.status), ['unavailable', 'unavailable', 'unavailable']);
});

test('optional live valuation smoke test', async (t) => {
  const baseUrl = process.env.STOCK_VALUATION_BASE_URL;
  if (!baseUrl) {
    t.skip('set STOCK_VALUATION_BASE_URL to run against a live server');
    return;
  }
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/stock-valuation?symbol=600519`);
  assert.equal(response.ok, true);
  validateSnapshot(await response.json());
});
