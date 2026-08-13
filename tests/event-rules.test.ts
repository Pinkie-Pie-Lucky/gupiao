import test from 'node:test';
import assert from 'node:assert/strict';
import {
  eventCategory,
  eventDate,
  eventDirection,
  eventImpactHorizon,
  eventStatus,
  normalizedEventKey,
} from '../backend/event-rules.js';

const NOW = Date.parse('2026-08-08T00:00:00.000Z');

test('classifies the supported announcement categories', () => {
  const cases = [
    ['2026 年半年度报告', 'earnings'],
    ['2026 年半年度业绩预告', 'forecast'],
    ['关于项目中标的公告', 'contract'],
    ['关于收购资产的公告', 'm_and_a'],
    ['向特定对象发行股票预案', 'financing'],
    ['持股 5% 以上股东减持计划', 'shareholder'],
    ['董事长辞职公告', 'governance'],
    ['收到监管问询函', 'regulatory'],
    ['重大诉讼进展公告', 'litigation'],
    ['部分生产线停产公告', 'production'],
    ['年度利润分配方案公告', 'dividend'],
    ['关于媒体报道的澄清公告', 'clarification'],
  ] as const;
  for (const [title, expected] of cases) assert.equal(eventCategory(title), expected, title);
});

test('classifies direction and horizon without treating every event as positive', () => {
  assert.equal(eventDirection('项目中标并签署合同', 'contract'), 'positive');
  assert.equal(eventDirection('收到监管处罚决定书', 'regulatory'), 'negative');
  assert.equal(eventDirection('关于市场传闻的澄清公告', 'clarification'), 'mixed');
  assert.equal(eventDirection('召开股东大会通知', 'shareholder'), 'unknown');
  assert.equal(eventImpactHorizon('regulatory'), 'immediate');
  assert.equal(eventImpactHorizon('contract'), 'short_term');
  assert.equal(eventImpactHorizon('earnings'), 'medium_term');
  assert.equal(eventImpactHorizon('m_and_a'), 'long_term');
});

test('normalizes supported date formats and rejects invalid dates', () => {
  assert.equal(eventDate('20260808')?.slice(0, 10), '2026-08-08');
  assert.equal(eventDate('2026/08/08')?.slice(0, 10), '2026-08-08');
  assert.equal(eventDate('2026年08月08日')?.slice(0, 10), '2026-08-08');
  assert.equal(eventDate('not-a-date'), null);
});

test('deduplication key ignores title punctuation but keeps dates distinct', () => {
  assert.equal(
    normalizedEventKey('关于项目中标的公告', '2026-08-08T10:00:00.000Z'),
    normalizedEventKey('关于项目中标的公告。', '2026-08-08T11:00:00.000Z'),
  );
  assert.notEqual(
    normalizedEventKey('关于项目中标的公告', '2026-08-08T10:00:00.000Z'),
    normalizedEventKey('关于项目中标的公告', '2026-08-09T10:00:00.000Z'),
  );
});

test('lifecycle status honors recency, ongoing categories, expiry and rumors', () => {
  assert.equal(eventStatus('项目中标公告', '2026-08-05T00:00:00.000Z', 'contract', NOW), 'new');
  assert.equal(eventStatus('项目中标公告', '2026-06-20T00:00:00.000Z', 'contract', NOW), 'ongoing');
  assert.equal(eventStatus('收到监管问询函', '2026-07-20T00:00:00.000Z', 'regulatory', NOW), 'expired');
  assert.equal(eventStatus('市场传闻公司将被收购', '2026-01-01T00:00:00.000Z', 'm_and_a', NOW), 'unconfirmed');
  assert.equal(eventStatus('年度报告公告', '2026-07-01T00:00:00.000Z', 'earnings', NOW), 'settled');
});

test('optional live endpoint smoke test', async (t) => {
  const baseUrl = process.env.STOCK_EVENTS_BASE_URL;
  if (!baseUrl) {
    t.skip('set STOCK_EVENTS_BASE_URL to run against a live server');
    return;
  }
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/stock-events?symbol=600519&days=30`);
  assert.equal(response.ok, true);
  const payload = await response.json() as any;
  assert.equal(payload.snapshotMeta?.eventVersion, 'stock-event-v1');
  assert.ok(Array.isArray(payload.events));
  assert.ok(Array.isArray(payload.evidence));
  for (const event of payload.events) assert.ok(Array.isArray(event.evidenceIds) && event.evidenceIds.length > 0);
});
