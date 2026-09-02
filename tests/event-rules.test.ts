import assert from 'node:assert/strict';
import test from 'node:test';
import { eventMateriality } from '../backend/event-rules.js';

const publishedAt = '2026-08-20T01:30:00.000Z';

test('routine announcements are identified and downweighted below material company events', () => {
  const routine = eventMateriality('关于召开2026年第一次临时股东大会的通知', {
    category: 'other',
    publishedAt,
    verification: 'official_verified',
    impactScope: 'company',
    status: 'new',
  });
  const material = eventMateriality('关于签署重大订单的公告', {
    category: 'contract',
    publishedAt,
    verification: 'official_verified',
    impactScope: 'company',
    status: 'new',
  });

  assert.equal(routine.isRoutine, true);
  assert.ok(routine.reasons.includes('例行公告降权'));
  assert.ok(routine.score < material.score);
  assert.equal(material.isRoutine, false);
});

test('substantive board resolutions are not treated as routine notices', () => {
  const result = eventMateriality('董事会决议公告：审议通过重大资产重组事项', {
    category: 'm_and_a',
    publishedAt,
    verification: 'official_verified',
    impactScope: 'company',
    status: 'new',
  });

  assert.equal(result.isRoutine, false);
  assert.ok(result.score >= 70);
  assert.equal(result.level, 'high');
});

test('invalidated event chains receive a materiality penalty', () => {
  const active = eventMateriality('公司收到监管立案调查通知', {
    category: 'regulatory',
    publishedAt,
    verification: 'official_verified',
    impactScope: 'company',
    status: 'new',
  });
  const invalidated = eventMateriality('公司收到监管立案调查通知', {
    category: 'regulatory',
    publishedAt,
    verification: 'official_verified',
    impactScope: 'company',
    status: 'new',
    lifecycleState: 'invalidated',
  });

  assert.ok(invalidated.score < active.score);
});
