import test from 'node:test';
import assert from 'node:assert/strict';

type RiskItem = { disposition: 'veto' | 'downgrade' | 'watch'; severity: 'high' | 'medium' | 'low'; evidenceIds: string[] };

function decide({ available = true, risks = [] as RiskItem[] } = {}) {
  const vetoes = risks.filter((item) => item.disposition === 'veto');
  const downgrades = risks.filter((item) => item.disposition === 'downgrade');
  const watches = risks.filter((item) => item.disposition === 'watch');
  const decision = !available ? 'blocked' : vetoes.length ? 'veto' : downgrades.length ? 'downgrade' : watches.length ? 'watch' : 'clear';
  const riskLevel = !available ? 'unavailable' : vetoes.length || downgrades.some((item) => item.severity === 'high') ? 'high' : downgrades.length || watches.length ? 'medium' : 'low';
  return { decision, riskLevel, vetoes, downgrades, watches };
}

test('official regulatory or confirmed structural break is a high-risk veto', () => {
  const result = decide({ risks: [{ disposition: 'veto', severity: 'high', evidenceIds: ['event:600519:regulatory:1'] }] });
  assert.equal(result.decision, 'veto');
  assert.equal(result.riskLevel, 'high');
  assert.equal(result.vetoes.length, 1);
});

test('market or technical risk downgrades without becoming a veto', () => {
  const result = decide({ risks: [{ disposition: 'downgrade', severity: 'medium', evidenceIds: ['technical:600519:risk:1'] }] });
  assert.equal(result.decision, 'downgrade');
  assert.equal(result.riskLevel, 'medium');
});

test('unconfirmed events and sentiment divergence remain watch conditions', () => {
  const result = decide({ risks: [{ disposition: 'watch', severity: 'low', evidenceIds: ['sentiment:600519:structure:1'] }] });
  assert.equal(result.decision, 'watch');
  assert.equal(result.riskLevel, 'medium');
});

test('all required inputs unavailable blocks the risk conclusion', () => {
  const result = decide({ available: false });
  assert.equal(result.decision, 'blocked');
  assert.equal(result.riskLevel, 'unavailable');
});

test('risk items require snapshot evidence ids', () => {
  const item: RiskItem = { disposition: 'downgrade', severity: 'medium', evidenceIds: ['technical:600519:risk:1'] };
  assert.ok(item.evidenceIds.length > 0);
});

test('fundamental hard veto takes precedence over other risk states', () => {
  const result = decide({ risks: [
    { disposition: 'downgrade', severity: 'medium', evidenceIds: ['financial:600519:cashConversion:2026-06-30'] },
    { disposition: 'veto', severity: 'high', evidenceIds: ['financial:600519:equity:2026-06-30'] },
  ] });
  assert.equal(result.decision, 'veto');
  assert.equal(result.riskLevel, 'high');
});

test('valuation unavailable is an explicit data gap, not a fabricated valuation risk', () => {
  const valuation = { status: 'unavailable', reason: '缺少可复现的市值和估值倍数快照。' };
  assert.equal(valuation.status, 'unavailable');
  assert.match(valuation.reason, /估值倍数/);
});

test('clean inputs remain clear and low risk', () => {
  const result = decide({ risks: [] });
  assert.equal(result.decision, 'clear');
  assert.equal(result.riskLevel, 'low');
});

test('volume-confirmed support break is a hard structural veto', () => {
  const result = decide({ risks: [{ disposition: 'veto', severity: 'high', evidenceIds: ['technical:600519:support_break:2026-08-08'] }] });
  assert.equal(result.decision, 'veto');
  assert.equal(result.riskLevel, 'high');
});

test('risk-off market regime and relative weakness are downgrade conditions', () => {
  const result = decide({ risks: [
    { disposition: 'downgrade', severity: 'medium', evidenceIds: ['market_environment:risk_off:2026-08-08'] },
    { disposition: 'downgrade', severity: 'medium', evidenceIds: ['relative_strength:600519:weak:2026-08-08'] },
  ] });
  assert.equal(result.decision, 'downgrade');
  assert.equal(result.riskLevel, 'medium');
  assert.equal(result.downgrades.length, 2);
});

test('unconfirmed event and divergent market reaction remain watch-only', () => {
  const result = decide({ risks: [
    { disposition: 'watch', severity: 'low', evidenceIds: ['event:600519:unconfirmed:1'] },
    { disposition: 'watch', severity: 'medium', evidenceIds: ['sentiment_reaction:600519:divergent:1'] },
  ] });
  assert.equal(result.decision, 'watch');
  assert.equal(result.riskLevel, 'medium');
  assert.equal(result.watches.length, 2);
});

test('a high-severity fundamental deterioration is downgrade rather than a hard veto', () => {
  const result = decide({ risks: [{ disposition: 'downgrade', severity: 'high', evidenceIds: ['financial:600519:adjustedNetProfit:2026-06-30'] }] });
  assert.equal(result.decision, 'downgrade');
  assert.equal(result.riskLevel, 'high');
  assert.equal(result.vetoes.length, 0);
});
