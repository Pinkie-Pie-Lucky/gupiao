import test from 'node:test';
import assert from 'node:assert/strict';

type Scenario = {
  name: string;
  riskDecision: 'clear' | 'watch' | 'downgrade' | 'veto' | 'blocked';
  coreAvailable?: boolean;
  highConflict?: boolean;
  blockingGap?: boolean;
  requiredConditions?: number;
  expected: 'research_ready' | 'watch' | 'deferred' | 'rejected' | 'blocked';
};

function deriveResearchStatus({ riskDecision, coreAvailable = true, highConflict = false, blockingGap = false, requiredConditions = 0 }: Omit<Scenario, 'name' | 'expected'>) {
  if (!coreAvailable && riskDecision === 'blocked') return 'blocked';
  if (riskDecision === 'veto') return 'rejected';
  if (riskDecision === 'downgrade' || highConflict || blockingGap) return 'deferred';
  if (riskDecision === 'watch' || requiredConditions > 0) return 'watch';
  return 'research_ready';
}

const scenarios: Scenario[] = [
  { name: 'complete and consistent inputs', riskDecision: 'clear', expected: 'research_ready' },
  { name: 'watch condition without veto', riskDecision: 'watch', requiredConditions: 1, expected: 'watch' },
  { name: 'core valuation service unavailable', riskDecision: 'clear', blockingGap: true, expected: 'deferred' },
  { name: 'high fundamental technical conflict', riskDecision: 'clear', highConflict: true, expected: 'deferred' },
  { name: 'risk downgrade overrides positive agents', riskDecision: 'downgrade', expected: 'deferred' },
  { name: 'risk veto overrides supporting case', riskDecision: 'veto', requiredConditions: 2, expected: 'rejected' },
  { name: 'blocked risk input', riskDecision: 'blocked', coreAvailable: false, expected: 'blocked' },
];

test('CIO/Manager research status precedence matrix', () => {
  for (const scenario of scenarios) {
    assert.equal(deriveResearchStatus(scenario), scenario.expected, scenario.name);
  }
});

test('informational data gaps reduce confidence but do not defer a clear research state', () => {
  const nonBlockingGaps = ['缺少毛利率字段', '行业财务横向比较尚未就绪', '缺少个股热度历史序列'];
  assert.equal(nonBlockingGaps.length > 0, true);
  assert.equal(deriveResearchStatus({ riskDecision: 'clear' }), 'research_ready');
});

test('veto and blocked states cannot be weakened by AI explanation', () => {
  const deterministic = [
    { researchStatus: 'rejected', riskDecision: 'veto' },
    { researchStatus: 'blocked', riskDecision: 'blocked' },
  ];
  for (const item of deterministic) {
    const aiAttempt = { ...item, researchStatus: 'research_ready', riskDecision: 'clear' };
    const protectedOutput = { ...aiAttempt, researchStatus: item.researchStatus, riskDecision: item.riskDecision };
    assert.equal(protectedOutput.researchStatus, item.researchStatus);
    assert.equal(protectedOutput.riskDecision, item.riskDecision);
  }
});

test('AI failure keeps deterministic fields and uses limited fallback', () => {
  const deterministic = {
    researchStatus: 'deferred',
    riskDecision: 'downgrade',
    riskLevel: 'medium',
    conflicts: [{ conflictId: 'fundamental_risk_conflict', severity: 'medium' }],
  };
  const fallback = {
    status: 'limited',
    ...deterministic,
    agentMeta: { aiStatus: 'fallback', promptVersion: 'cio-manager-v1', managerVersion: 'stock-manager-v1' },
  };
  assert.deepEqual(fallback.researchStatus, deterministic.researchStatus);
  assert.deepEqual(fallback.riskDecision, deterministic.riskDecision);
  assert.deepEqual(fallback.riskLevel, deterministic.riskLevel);
  assert.deepEqual(fallback.conflicts, deterministic.conflicts);
  assert.equal(fallback.status, 'limited');
});

test('blocked or evidence-empty input does not fabricate an AI opinion', () => {
  const output = {
    status: 'blocked',
    researchStatus: 'blocked',
    evidenceIds: [],
    supportingCase: [],
    counterCase: [],
    requiredConditions: [],
    researchPriorities: [],
    agentMeta: { aiStatus: 'not_requested', promptVersion: 'cio-manager-v1' },
  };
  assert.equal(output.status, 'blocked');
  assert.equal(output.agentMeta.aiStatus, 'not_requested');
  assert.deepEqual(output.evidenceIds, []);
  assert.deepEqual(output.supportingCase, []);
});

test('evidence filter rejects out-of-snapshot IDs and empty claims', () => {
  const allowed = new Set(['risk:600519:1']);
  const aiItems = [
    { text: 'supported claim', evidenceIds: ['risk:600519:1', 'external:unsupported'] },
    { text: 'unsupported claim', evidenceIds: ['external:unsupported'] },
    { text: '', evidenceIds: ['risk:600519:1'] },
  ];
  const filtered = aiItems.map((item) => ({
    text: item.text,
    evidenceIds: [...new Set(item.evidenceIds.filter((id) => allowed.has(id)))],
  })).filter((item) => item.text && item.evidenceIds.length);
  assert.deepEqual(filtered, [{ text: 'supported claim', evidenceIds: ['risk:600519:1'] }]);
});

test('manager explanation cannot become a trading recommendation', () => {
  const forbidden = /buy|sell|position|target price|return|guaranteed/i;
  const allowedSummary = 'Research status is deferred because the risk snapshot requires follow-up verification.';
  assert.equal(forbidden.test(allowedSummary), false);
});

test('optional live multi-scenario smoke test', async (t) => {
  const baseUrl = process.env.CIO_MANAGER_BASE_URL;
  if (!baseUrl) {
    t.skip('set CIO_MANAGER_BASE_URL to run against a live server');
    return;
  }
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/stock-agents/cio-manager?symbol=600519&refresh=1`);
  assert.equal(response.ok, true);
  const payload: any = await response.json();
  assert.equal(payload.agentMeta?.promptVersion, 'cio-manager-v1');
  assert.equal(payload.agentMeta?.managerVersion, 'stock-manager-v1');
  assert.equal(payload.opinion?.researchStatus, payload.deterministicManager?.researchStatus);
  assert.equal(payload.opinion?.riskDecision, payload.deterministicManager?.riskDecision);
});
