import test from 'node:test';
import assert from 'node:assert/strict';

const forbiddenClaims = /股价将|必涨|必跌|买入|卖出|仓位|资金流入/;

function makeAgentPayload({ aiStatus = 'completed', status = 'completed', sourceAvailable = true, events = true } = {}) {
  const event = {
    eventId: 'event:600519:announcement_contract:2026-08-07',
    category: 'contract',
    title: '签署项目合作协议公告',
    publishedAt: '2026-08-07T08:00:00.000Z',
    source: 'cninfo',
    verification: 'official_verified',
    direction: 'positive',
    impactScope: 'company',
    impactHorizon: 'short_term',
    status: 'new',
    evidenceIds: ['event:600519:announcement_contract:2026-08-07'],
  };
  const snapshot = {
    events: events ? [event] : [],
    dataGaps: sourceAvailable ? [] : ['CNINFO 公告不可用'],
    snapshotMeta: { eventVersion: 'stock-event-v1', generatedAt: '2026-08-08T00:00:00.000Z' },
  };
  return {
    symbol: '600519',
    period: { start: '2026-02-10', end: '2026-08-08' },
    eventSnapshot: snapshot,
    deterministicEvents: snapshot.events,
    opinion: {
      agent: 'event',
      status,
      conclusion: events ? '存在一项已核验事件，影响期限仍需后续披露验证。' : '当前时间窗口内未发现可核验的个股事件。',
      confidence: { score: status === 'completed' ? 78 : 35, level: status === 'completed' ? 'medium' : 'limited', reason: '由来源核验与证据完整度约束。' },
      eventSummary: events ? '存在一项已核验事件。' : '无可核验事件。',
      activeEvents: events ? [{ eventId: event.eventId, conclusion: '事件已由官方公告确认。', direction: event.direction, impactHorizon: event.impactHorizon, catalysts: ['跟踪合同执行进展。'], risks: [], watchConditions: ['关注后续执行披露。'], evidenceIds: event.evidenceIds }] : [],
      catalysts: events ? [{ text: '签署项目合作协议公告', evidenceIds: event.evidenceIds }] : [],
      risks: [], positives: events ? [{ text: '签署项目合作协议公告', evidenceIds: event.evidenceIds }] : [], negatives: [], uncertainties: [],
      eventGaps: snapshot.dataGaps,
      evidenceIds: events ? event.evidenceIds : [], dataGaps: snapshot.dataGaps, vetoes: [],
    },
    agentMeta: { aiStatus, promptVersion: 'event-v1', eventVersion: 'stock-event-v1' },
  };
}

function validateAgentPayload(payload: any) {
  assert.equal(payload.agentMeta?.eventVersion, 'stock-event-v1');
  assert.ok(Array.isArray(payload.deterministicEvents));
  assert.ok(['completed', 'limited', 'blocked'].includes(payload.opinion?.status));
  assert.ok(Array.isArray(payload.opinion?.activeEvents));
  assert.ok(Array.isArray(payload.opinion?.eventGaps));
  const snapshotIds = new Set(payload.deterministicEvents.flatMap((event: any) => event.evidenceIds || []));
  for (const id of payload.opinion.evidenceIds || []) assert.ok(snapshotIds.has(id), `evidence id not in frozen snapshot: ${id}`);
  assert.equal(forbiddenClaims.test(JSON.stringify(payload.opinion)), false);
}

test('AI-completed event opinion preserves frozen event identity', () => {
  const payload = makeAgentPayload();
  validateAgentPayload(payload);
  assert.equal(payload.opinion.activeEvents[0].eventId, payload.deterministicEvents[0].eventId);
  assert.equal(payload.opinion.activeEvents[0].direction, payload.deterministicEvents[0].direction);
});

test('AI fallback keeps deterministic events and limited status', () => {
  const payload = makeAgentPayload({ aiStatus: 'fallback', status: 'limited' });
  validateAgentPayload(payload);
  assert.equal(payload.agentMeta.aiStatus, 'fallback');
  assert.equal(payload.opinion.status, 'limited');
  assert.ok(payload.deterministicEvents.length > 0);
});

test('no verified event is an explicit empty result, not a negative conclusion', () => {
  const payload = makeAgentPayload({ events: false, status: 'limited' });
  validateAgentPayload(payload);
  assert.equal(payload.opinion.activeEvents.length, 0);
  assert.match(payload.opinion.conclusion, /未发现可核验/);
});

test('all event sources unavailable can be blocked', () => {
  const payload = makeAgentPayload({ events: false, sourceAvailable: false, status: 'blocked', aiStatus: 'not_requested' });
  validateAgentPayload(payload);
  assert.equal(payload.opinion.status, 'blocked');
  assert.ok(payload.opinion.eventGaps.length > 0);
});

test('optional live event-agent smoke test', async (t) => {
  const baseUrl = process.env.STOCK_EVENTS_BASE_URL;
  if (!baseUrl) {
    t.skip('set STOCK_EVENTS_BASE_URL to run against a live server');
    return;
  }
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/stock-agents/event?symbol=600519&days=30`);
  assert.equal(response.ok, true);
  validateAgentPayload(await response.json());
});
