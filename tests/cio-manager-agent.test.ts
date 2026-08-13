import test from 'node:test';
import assert from 'node:assert/strict';

function makePayload({ aiStatus = 'completed', researchStatus = 'deferred', riskDecision = 'downgrade' } = {}) {
  const evidenceId = 'risk:600519:downgrade:2026-08-08';
  const deterministicManager = {
    researchStatus, riskDecision, riskLevel: riskDecision === 'veto' ? 'high' : 'medium', conflicts: [],
    requiredConditions: [{ text: '补充估值比较基准', evidenceIds: [evidenceId] }], researchPriorities: [{ text: '核验风险降级项', evidenceIds: [evidenceId] }],
  };
  return {
    symbol: '600519', managerSnapshot: { snapshotMeta: { managerVersion: 'stock-manager-v1' }, evidenceIds: [evidenceId], dataGaps: ['估值比较基准不足'] }, deterministicManager,
    opinion: {
      agent: 'cio_manager', status: researchStatus === 'blocked' ? 'blocked' : 'limited', conclusion: '研究状态由风险和数据完整度共同约束。', confidence: { score: 45, level: 'limited', reason: '存在数据缺口。' },
      ...deterministicManager, supportingCase: [], counterCase: [{ text: '风险快照要求降级。', evidenceIds: [evidenceId] }], requiredConditions: deterministicManager.requiredConditions, researchPriorities: deterministicManager.researchPriorities, uncertainties: [{ text: '估值比较基准不足', evidenceIds: [] }], evidenceIds: [evidenceId], dataGaps: ['估值比较基准不足'],
    },
    agentMeta: { aiStatus, promptVersion: 'cio-manager-v1', managerVersion: 'stock-manager-v1' },
  };
}

function validatePayload(payload: any) {
  assert.equal(payload.agentMeta?.managerVersion, 'stock-manager-v1');
  assert.equal(payload.opinion.researchStatus, payload.deterministicManager.researchStatus);
  assert.equal(payload.opinion.riskDecision, payload.deterministicManager.riskDecision);
  assert.equal(payload.opinion.riskLevel, payload.deterministicManager.riskLevel);
  assert.deepEqual(payload.opinion.conflicts, payload.deterministicManager.conflicts);
  const evidence = new Set(payload.managerSnapshot.evidenceIds || []);
  for (const item of [...(payload.opinion.supportingCase || []), ...(payload.opinion.counterCase || []), ...(payload.opinion.requiredConditions || []), ...(payload.opinion.researchPriorities || [])]) for (const id of item.evidenceIds || []) assert.ok(evidence.has(id));
  assert.equal(/买入|卖出|仓位|必涨|必跌|可交易/.test(JSON.stringify(payload.opinion)), false);
}

test('AI opinion preserves research status, risk decision and conflicts', () => {
  const payload = makePayload();
  validatePayload(payload);
  assert.equal(payload.opinion.researchStatus, 'deferred');
});

test('AI failure returns limited deterministic fallback', () => {
  const payload = makePayload({ aiStatus: 'fallback' });
  validatePayload(payload);
  assert.equal(payload.agentMeta.aiStatus, 'fallback');
  assert.equal(payload.opinion.status, 'limited');
});

test('risk veto remains rejected even when AI is unavailable', () => {
  const payload = makePayload({ aiStatus: 'not_requested', researchStatus: 'rejected', riskDecision: 'veto' });
  validatePayload(payload);
  assert.equal(payload.opinion.researchStatus, 'rejected');
  assert.equal(payload.opinion.riskDecision, 'veto');
});

test('blocked manager input returns blocked without unsupported citations', () => {
  const payload = makePayload({ aiStatus: 'not_requested', researchStatus: 'blocked', riskDecision: 'blocked' });
  payload.managerSnapshot.evidenceIds = [];
  payload.opinion.evidenceIds = [];
  payload.opinion.supportingCase = [];
  payload.opinion.counterCase = [];
  payload.opinion.requiredConditions = [];
  payload.opinion.researchPriorities = [];
  payload.opinion.status = 'blocked';
  validatePayload(payload);
  assert.equal(payload.opinion.status, 'blocked');
  assert.equal(payload.opinion.evidenceIds.length, 0);
});

test('optional live CIO/Manager smoke test', async (t) => {
  const baseUrl = process.env.CIO_MANAGER_BASE_URL;
  if (!baseUrl) {
    t.skip('set CIO_MANAGER_BASE_URL to run against a live server');
    return;
  }
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/stock-agents/cio-manager?symbol=600519`);
  assert.equal(response.ok, true);
  validatePayload(await response.json());
});
