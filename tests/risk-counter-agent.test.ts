import test from 'node:test';
import assert from 'node:assert/strict';

function makePayload({ aiStatus = 'completed', decision = 'downgrade' } = {}) {
  const evidenceId = 'technical:600519:risk:2026-08-08';
  const deterministicRisk = {
    riskLevel: decision === 'blocked' ? 'unavailable' : decision === 'veto' ? 'high' : 'medium',
    decision,
    vetoes: decision === 'veto' ? [{ riskId: 'event:veto:1', evidenceIds: [evidenceId] }] : [],
    risks: decision === 'downgrade' ? [{ riskId: 'technical:downgrade:1', evidenceIds: [evidenceId] }] : [],
    watchConditions: [],
    valuation: { status: 'unavailable' },
  };
  return {
    symbol: '600519',
    riskSnapshot: { snapshotMeta: { riskVersion: 'stock-risk-v3' }, evidenceIds: [evidenceId], dataGaps: ['估值不可用'] },
    deterministicRisk,
    opinion: {
      agent: 'risk_counter', status: decision === 'blocked' ? 'blocked' : 'limited', conclusion: '确定性风险解释。',
      confidence: { score: 50, level: 'limited', reason: '数据存在缺口。' },
      ...deterministicRisk,
      counterThesis: decision === 'blocked' ? [] : [{ riskId: 'technical:downgrade:1', claim: '技术风险已触发。', trigger: '风险阈值触发。', resolutionCondition: '指标回落。', evidenceIds: [evidenceId] }],
      uncertainties: [{ text: '估值不可用。', evidenceIds: [] }], evidenceIds: decision === 'blocked' ? [] : [evidenceId], dataGaps: ['估值不可用'],
    },
    agentMeta: { aiStatus, promptVersion: 'risk-counter-v1', riskVersion: 'stock-risk-v3' },
  };
}

function validatePayload(payload: any) {
  assert.equal(payload.agentMeta?.riskVersion, 'stock-risk-v3');
  assert.equal(payload.opinion.riskLevel, payload.deterministicRisk.riskLevel);
  assert.equal(payload.opinion.decision, payload.deterministicRisk.decision);
  assert.deepEqual(payload.opinion.vetoes, payload.deterministicRisk.vetoes);
  assert.deepEqual(payload.opinion.risks, payload.deterministicRisk.risks);
  assert.deepEqual(payload.opinion.watchConditions, payload.deterministicRisk.watchConditions);
  const evidence = new Set(payload.riskSnapshot.evidenceIds || []);
  for (const id of payload.opinion.evidenceIds || []) assert.ok(evidence.has(id));
  for (const item of payload.opinion.counterThesis || []) for (const id of item.evidenceIds || []) assert.ok(evidence.has(id));
  assert.equal(/买入|卖出|仓位|必涨|必跌/.test(JSON.stringify(payload.opinion)), false);
}

test('AI opinion preserves deterministic risk fields and evidence scope', () => {
  const payload = makePayload();
  validatePayload(payload);
  assert.equal(payload.opinion.decision, 'downgrade');
});

test('AI failure returns deterministic limited fallback', () => {
  const payload = makePayload({ aiStatus: 'fallback' });
  validatePayload(payload);
  assert.equal(payload.agentMeta.aiStatus, 'fallback');
  assert.equal(payload.opinion.status, 'limited');
});

test('all inputs unavailable block the agent without unsupported evidence', () => {
  const payload = makePayload({ aiStatus: 'not_requested', decision: 'blocked' });
  validatePayload(payload);
  assert.equal(payload.opinion.status, 'blocked');
  assert.equal(payload.opinion.evidenceIds.length, 0);
});

test('partial source availability stays limited and preserves deterministic downgrade', () => {
  const payload = makePayload({ decision: 'downgrade' });
  payload.riskSnapshot.dataGaps.push('事件快照不可用。', '估值不可用。');
  payload.opinion.status = 'limited';
  validatePayload(payload);
  assert.equal(payload.opinion.decision, 'downgrade');
  assert.equal(payload.opinion.status, 'limited');
});

test('clear state with no citable risk evidence is deterministic and does not call AI', () => {
  const payload = makePayload({ aiStatus: 'not_requested', decision: 'clear' });
  payload.riskSnapshot.evidenceIds = [];
  payload.opinion.evidenceIds = [];
  payload.opinion.counterThesis = [];
  payload.opinion.status = 'limited';
  validatePayload(payload);
  assert.equal(payload.opinion.decision, 'clear');
  assert.equal(payload.agentMeta.aiStatus, 'not_requested');
});

test('contract rejects evidence not present in the frozen risk snapshot', () => {
  const payload = makePayload();
  payload.opinion.counterThesis[0].evidenceIds = ['external:unsupported:1'];
  assert.throws(() => validatePayload(payload));
});

test('optional live risk-counter-agent smoke test', async (t) => {
  const baseUrl = process.env.RISK_COUNTER_BASE_URL;
  if (!baseUrl) {
    t.skip('set RISK_COUNTER_BASE_URL to run against a live server');
    return;
  }
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/stock-agents/risk-counter?symbol=600519`);
  assert.equal(response.ok, true);
  validatePayload(await response.json());
});
