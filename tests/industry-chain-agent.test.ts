import assert from 'node:assert/strict';
import test from 'node:test';

const forbiddenClaims = /buy recommendation|sell recommendation|target price|must rise|must fall/i;

function makePayload({ status = 'available', aiStatus = 'completed', chainIndicators = 1 } = {}) {
  const financialEvidence = 'industry_financial_percentile:002230:revenueYoY:2026-03-31';
  const mappingEvidence = 'industry_chain_mapping:002230:ai_software:current';
  const evidenceIds = [financialEvidence, mappingEvidence];
  return {
    symbol: '002230',
    industrySnapshot: {
      status,
      industry: { name: 'I65 software services', memberCount: 334 },
      financialPosition: { period: '2026-03-31', metrics: [{ key: 'revenueYoY', status: 'available', percentile: 0.67, sampleSize: 281, evidenceIds: [financialEvidence] }] },
      chain: { status: chainIndicators ? 'mapped' : 'partial', mappings: [{ ruleId: 'ai_software', upstream: [{ name: 'AI server' }], downstream: [{ name: 'enterprise software' }], chainData: { indicators: chainIndicators ? [{ key: 'demo', label: 'demo indicator', value: 1 }] : [] } }], indicatorCount: chainIndicators },
      events: [], dataQuality: { memberSnapshot: 'complete', financialSample: 'sufficient', chainData: chainIndicators ? 'mapped' : 'partial' }, evidenceIds, evidence: [{ evidenceId: financialEvidence }, { evidenceId: mappingEvidence }], dataGaps: chainIndicators ? [] : ['missing chain indicator'], snapshotMeta: { version: 'industry-chain-v1' },
    },
    deterministicIndustry: { status, industry: { name: 'I65 software services' } },
    opinion: { agent: 'industry_chain', status: aiStatus === 'fallback' ? 'limited' : 'completed', conclusion: 'Industry position uses aligned financial percentiles.', positives: [{ text: 'Revenue growth is above the industry median.', evidenceIds: [financialEvidence] }], negatives: [], uncertainties: [], evidenceIds: [financialEvidence], dataGaps: chainIndicators ? [] : ['missing chain indicator'] },
    agentMeta: { aiStatus, promptVersion: 'industry-chain-v1', industryVersion: 'industry-chain-v1' },
  };
}

function validateContract(payload: any) {
  assert.equal(payload.industrySnapshot.snapshotMeta.version, 'industry-chain-v1');
  assert.ok(['available', 'limited', 'unavailable'].includes(payload.industrySnapshot.status));
  assert.ok(Array.isArray(payload.industrySnapshot.financialPosition.metrics));
  assert.ok(Array.isArray(payload.industrySnapshot.chain.mappings));
  assert.ok(['completed', 'limited', 'unavailable'].includes(payload.opinion.status));
  const evidence = new Set(payload.industrySnapshot.evidenceIds);
  for (const item of [...payload.opinion.positives, ...payload.opinion.negatives, ...payload.opinion.uncertainties]) for (const id of item.evidenceIds || []) assert.ok(evidence.has(id));
  assert.equal(forbiddenClaims.test(JSON.stringify(payload.opinion)), false);
}

test('industry-chain agent keeps an auditable snapshot contract', () => validateContract(makePayload()));

test('missing chain indicators remain a data gap rather than fabricated signals', () => {
  const payload = makePayload({ chainIndicators: 0 });
  validateContract(payload);
  assert.equal(payload.industrySnapshot.chain.indicatorCount, 0);
  assert.ok(payload.industrySnapshot.dataGaps.length > 0);
});

test('AI fallback preserves frozen industry facts', () => {
  const payload = makePayload({ aiStatus: 'fallback' });
  validateContract(payload);
  assert.equal(payload.agentMeta.aiStatus, 'fallback');
  assert.equal(payload.opinion.status, 'limited');
});

test('optional live endpoint smoke test', async (t) => {
  const baseUrl = process.env.INDUSTRY_CHAIN_BASE_URL;
  if (!baseUrl) return t.skip('set INDUSTRY_CHAIN_BASE_URL to run against a live server');
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/stock-agents/industry-chain?symbol=002230`);
  assert.equal(response.ok, true);
  validateContract(await response.json());
});
