import test from 'node:test';
import assert from 'node:assert/strict';

const priority = ['blocked', 'rejected', 'deferred', 'watch', 'research_ready'];

function deriveStatus({ riskDecision = 'clear', riskVeto = false, highConflict = false, criticalGap = false, requiredConditions = 0, coreAvailable = true } = {}) {
  if (!coreAvailable && riskDecision === 'blocked') return 'blocked';
  if (riskVeto || riskDecision === 'veto') return 'rejected';
  if (riskDecision === 'downgrade' || highConflict || criticalGap) return 'deferred';
  if (riskDecision === 'watch' || requiredConditions > 0) return 'watch';
  return 'research_ready';
}

function validateSnapshot(snapshot: any) {
  assert.equal(snapshot.snapshotMeta?.managerVersion, 'stock-manager-v1');
  assert.ok(priority.includes(snapshot.researchStatus));
  assert.ok(['clear', 'watch', 'downgrade', 'veto', 'blocked'].includes(snapshot.riskDecision));
  const evidence = new Set(snapshot.evidenceIds || []);
  for (const item of [...(snapshot.supportingCase || []), ...(snapshot.counterCase || []), ...(snapshot.researchPriorities || [])]) for (const id of item.evidenceIds || []) assert.ok(evidence.has(id));
  for (const conflict of snapshot.conflicts || []) for (const id of conflict.evidenceIds || []) assert.ok(evidence.has(id));
}

test('risk veto has priority over positive supporting evidence', () => {
  assert.equal(deriveStatus({ riskDecision: 'veto', riskVeto: true, requiredConditions: 1 }), 'rejected');
});

test('blocked core inputs remain blocked', () => {
  assert.equal(deriveStatus({ riskDecision: 'blocked', coreAvailable: false }), 'blocked');
});

test('high cross-agent conflict defers research', () => {
  assert.equal(deriveStatus({ riskDecision: 'clear', highConflict: true }), 'deferred');
});

test('watch conditions do not become rejection', () => {
  assert.equal(deriveStatus({ riskDecision: 'watch', requiredConditions: 2 }), 'watch');
});

test('complete and consistent inputs can be research-ready', () => {
  assert.equal(deriveStatus({ riskDecision: 'clear', coreAvailable: true }), 'research_ready');
});

test('manager snapshot evidence IDs remain auditable', () => {
  const evidenceId = 'technical:600519:trend:2026-08-08';
  const snapshot = {
    snapshotMeta: { managerVersion: 'stock-manager-v1' },
    researchStatus: 'deferred', riskDecision: 'downgrade', evidenceIds: [evidenceId],
    supportingCase: [{ text: '基本面稳定', evidenceIds: [evidenceId] }], counterCase: [], conflicts: [], researchPriorities: [{ text: '核验风险', evidenceIds: [evidenceId] }],
  };
  validateSnapshot(snapshot);
});

