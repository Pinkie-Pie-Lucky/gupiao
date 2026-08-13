import assert from 'node:assert/strict';
import test from 'node:test';
import { buildManagerStance } from '../shared/managerStance';

const evidence = ['market:1', 'financial:1', 'technical:1'];

test('builds horizon-specific hold assessments from deterministic signals', () => {
  const stance = buildManagerStance({
    riskDecision: 'clear',
    riskLevel: 'low',
    evidenceIds: evidence,
    dataGaps: [],
    requiredConditions: [],
    agentOutputs: {
      fundamental: { signals: [{ status: 'improving', summary: '盈利改善', evidenceIds: ['financial:1'] }] },
      technical: { signals: [{ status: 'positive', summary: '趋势稳定', evidenceIds: ['technical:1'] }] },
      events: { events: [{ status: 'active', direction: 'positive', title: '订单增长', evidenceIds: ['market:1'] }] },
      sentiment: { tone: 'positive' },
      valuation: { valuationStatus: 'available' },
    },
  });
  assert.equal(stance.horizons.short.direction, 'bullish');
  assert.equal(stance.horizons.medium.holdAssessment, 'hold');
  assert.ok(stance.horizons.long.confidence !== null);
});

test('risk veto caps the stance at avoid across every horizon', () => {
  const stance = buildManagerStance({ riskDecision: 'veto', riskLevel: 'high', evidenceIds: evidence, dataGaps: [], agentOutputs: { technical: { signals: [{ status: 'positive' }] }, fundamental: { signals: [{ status: 'positive' }] } } });
  for (const horizon of Object.values(stance.horizons)) {
    assert.equal(horizon.direction, 'bearish');
    assert.equal(horizon.holdAssessment, 'avoid');
  }
});

test('blocked input never becomes a bullish or bearish guess', () => {
  const stance = buildManagerStance({ riskDecision: 'blocked', riskLevel: 'unavailable', evidenceIds: [], dataGaps: ['缺少行情'], agentOutputs: {} });
  assert.equal(stance.direction, 'unknown');
  assert.equal(stance.holdAssessment, 'unknown');
  assert.equal(stance.horizons.short.direction, 'unknown');
});

test('can present different conclusions for short, medium and long horizons', () => {
  const stance = buildManagerStance({
    riskDecision: 'clear', riskLevel: 'low', evidenceIds: evidence, dataGaps: [], requiredConditions: [],
    agentOutputs: {
      fundamental: { signals: [{ status: 'positive', summary: '盈利改善' }, { status: 'stable', summary: '现金流稳定' }] },
      technical: { signals: [{ status: 'risk', summary: '短线波动扩大' }, { status: 'deteriorating', summary: '动量走弱' }] },
      events: { events: [] }, sentiment: { tone: 'neutral' }, valuation: { valuationStatus: 'available' },
    },
  });
  assert.equal(stance.horizons.short.direction, 'bearish');
  assert.equal(stance.horizons.medium.direction, 'lean_bullish');
  assert.equal(stance.horizons.long.direction, 'bullish');
});
