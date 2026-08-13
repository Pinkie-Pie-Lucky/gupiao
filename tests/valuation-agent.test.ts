import test from 'node:test';
import assert from 'node:assert/strict';

function makePayload({ aiStatus = 'completed', valuationStatus = 'limited' } = {}) {
  const evidenceId = 'valuation_market:600519:pb:2026-08-08';
  const deterministicValuation = {
    valuationStatus,
    valuationFramework: { template: 'non_financial', preferredMultiples: ['peDynamic', 'pb'] },
    multiples: { peDynamic: 22.5, peStatic: null, pb: 6.1, ps: null, peDynamicStatus: 'meaningful', peStaticStatus: 'unavailable', pbStatus: 'meaningful', psStatus: 'unavailable' },
    market: { price: 1600, marketCap: 2_000_000_000_000 },
    financialBasis: { period: '2026-06-30', netProfit: 80_000_000_000, equity: 300_000_000_000 },
    scenarioModel: { version: 'valuation-scenario-v1', earnings: { status: 'limited', scenarios: [] }, dcf: { status: 'unavailable', scenarios: [] }, residualIncome: { status: 'unavailable', scenarios: [] } },
    comparison: { status: 'unavailable', historyPercentile: null, peerComparison: null },
  };
  return {
    symbol: '600519', valuationSnapshot: { snapshotMeta: { valuationVersion: 'stock-valuation-v3' }, evidenceIds: [evidenceId], dataGaps: ['尚未接入历史分位和行业可比估值'] }, deterministicValuation,
    opinion: {
      agent: 'valuation', status: valuationStatus === 'unavailable' ? 'blocked' : 'limited', conclusion: '当前只能解释估值数值，不能判断相对高低。', confidence: { score: 45, level: 'limited', reason: '比较基准缺失。' },
      ...deterministicValuation,
      interpretations: valuationStatus === 'unavailable' ? [] : [{ metric: 'pb', statement: 'PB 当前为 6.1，比较基准不可用。', evidenceIds: [evidenceId] }],
      uncertainties: [{ text: '历史分位和同行比较不可用。', evidenceIds: [] }], evidenceIds: valuationStatus === 'unavailable' ? [] : [evidenceId], dataGaps: ['尚未接入历史分位和行业可比估值'],
    },
    agentMeta: { aiStatus, promptVersion: 'valuation-v1', valuationVersion: 'stock-valuation-v3' },
  };
}

function validatePayload(payload: any) {
  assert.equal(payload.agentMeta?.valuationVersion, 'stock-valuation-v3');
  assert.equal(payload.opinion.valuationStatus, payload.deterministicValuation.valuationStatus);
  assert.deepEqual(payload.opinion.valuationFramework, payload.deterministicValuation.valuationFramework);
  assert.deepEqual(payload.opinion.multiples, payload.deterministicValuation.multiples);
  assert.deepEqual(payload.opinion.scenarioModel, payload.deterministicValuation.scenarioModel);
  assert.deepEqual(payload.opinion.comparison, payload.deterministicValuation.comparison);
  const evidence = new Set(payload.valuationSnapshot.evidenceIds || []);
  for (const id of payload.opinion.evidenceIds || []) assert.ok(evidence.has(id));
  for (const item of payload.opinion.interpretations || []) for (const id of item.evidenceIds || []) assert.ok(evidence.has(id));
  assert.equal(/高估|低估|目标价|买入|卖出|仓位/.test(JSON.stringify(payload.opinion)), false);
}

test('valuation opinion preserves deterministic fields and evidence scope', () => {
  const payload = makePayload();
  validatePayload(payload);
  assert.equal(payload.opinion.comparison.status, 'unavailable');
});

test('valuation AI failure returns limited deterministic fallback', () => {
  const payload = makePayload({ aiStatus: 'fallback' });
  validatePayload(payload);
  assert.equal(payload.agentMeta.aiStatus, 'fallback');
  assert.equal(payload.opinion.status, 'limited');
});

test('unavailable valuation blocks explanation without unsupported evidence', () => {
  const payload = makePayload({ aiStatus: 'not_requested', valuationStatus: 'unavailable' });
  validatePayload(payload);
  assert.equal(payload.opinion.status, 'blocked');
  assert.equal(payload.opinion.evidenceIds.length, 0);
});

test('optional live valuation-agent smoke test', async (t) => {
  const baseUrl = process.env.VALUATION_AGENT_BASE_URL;
  if (!baseUrl) {
    t.skip('set VALUATION_AGENT_BASE_URL to run against a live server');
    return;
  }
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/stock-agents/valuation?symbol=600519`);
  assert.equal(response.ok, true);
  validatePayload(await response.json());
});
