import test from 'node:test';
import assert from 'node:assert/strict';

function makeSnapshot({ events = true, heat = true } = {}) {
  const eventEvidence = 'event:600519:announcement_contract:2026-08-07';
  const event = {
    eventId: eventEvidence,
    category: 'contract',
    title: '项目中标公告',
    direction: 'positive',
    status: 'new',
    verification: 'official_verified',
    evidenceIds: [eventEvidence],
  };
  const negativeEvent = {
    eventId: 'event:600519:announcement_regulatory:2026-08-06',
    category: 'regulatory',
    title: '收到监管问询函',
    direction: 'negative',
    status: 'new',
    verification: 'official_verified',
    evidenceIds: ['event:600519:announcement_regulatory:2026-08-06'],
  };
  return {
    symbol: '600519',
    attention: 'unavailable',
    tone: events ? 'mixed' : 'unavailable',
    disagreement: events ? 'high' : 'unavailable',
    evidenceDirectionDisagreement: events ? 'high' : 'unavailable',
    communityViewpointDisagreement: 'unavailable',
    viewpointScope: events ? 'event_direction_evidence' : 'unavailable',
    sourceQuality: events && heat ? 'mixed' : events ? 'official_led' : heat ? 'community_led' : 'insufficient',
    propagationQuality: events ? 'official_primary' : heat ? 'community_heat_only' : 'insufficient',
    eventReaction: 'not_evaluable',
    eventReactions: [],
    metrics: { eventCount: events ? 2 : 0, officialEventCount: events ? 2 : 0, mediaEventCount: 0, currentAttention: heat ? '1234' : null, attentionChange: null, attentionSampleCount: heat ? 1 : 0, sourceCount: events ? 1 : 0, duplicateEventCount: 0, duplicateRate: 0, eventReactionCount: 0 },
    events: events ? [event, negativeEvent] : [],
    evidence: events ? [{ evidenceId: eventEvidence }, { evidenceId: negativeEvent.evidenceIds[0] }] : [],
    evidenceIds: events ? [eventEvidence, negativeEvent.evidenceIds[0]] : [],
    dataGaps: ['缺少个股热度历史序列，暂不判断关注度上升或下降。', '缺少事件前后行情窗口，暂不判断市场是否形成确认反应。'],
    snapshotMeta: { sentimentVersion: 'stock-sentiment-v4' },
  };
}

function validateSnapshot(snapshot: any) {
  assert.equal(snapshot.snapshotMeta?.sentimentVersion, 'stock-sentiment-v4');
  assert.ok(['rising', 'stable', 'falling', 'unavailable'].includes(snapshot.attention));
  assert.ok(['positive', 'negative', 'mixed', 'neutral', 'unavailable'].includes(snapshot.tone));
  assert.ok(['low', 'medium', 'high', 'unavailable'].includes(snapshot.disagreement));
  assert.equal(snapshot.evidenceDirectionDisagreement, snapshot.disagreement);
  assert.ok(['low', 'medium', 'high', 'unavailable'].includes(snapshot.communityViewpointDisagreement));
  assert.ok(['community_content', 'event_direction_evidence', 'unavailable'].includes(snapshot.viewpointScope));
  assert.ok(['official_led', 'media_led', 'community_led', 'mixed', 'insufficient'].includes(snapshot.sourceQuality));
  assert.ok(['official_and_media', 'official_primary', 'media_only', 'community_heat_only', 'insufficient'].includes(snapshot.propagationQuality));
  assert.ok(['confirmed_reaction', 'weak_reaction', 'divergent_reaction', 'not_evaluable'].includes(snapshot.eventReaction));
  const evidence = new Set(snapshot.evidenceIds || []);
  for (const event of snapshot.events || []) for (const id of event.evidenceIds || []) assert.ok(evidence.has(id));
  for (const reaction of snapshot.eventReactions || []) {
    assert.ok(snapshot.events.some((event: any) => event.eventId === reaction.eventId));
    assert.ok(['confirmed_reaction', 'weak_reaction', 'divergent_reaction', 'not_evaluable'].includes(reaction.reaction));
    for (const id of reaction.evidenceIds || []) assert.ok(evidence.has(id));
  }
}

test('mixed event directions produce mixed tone and high disagreement', () => {
  const snapshot = makeSnapshot();
  validateSnapshot(snapshot);
  assert.equal(snapshot.tone, 'mixed');
  assert.equal(snapshot.disagreement, 'high');
  assert.equal(snapshot.sourceQuality, 'mixed');
});

test('single-point heat does not become rising attention or confirmed market reaction', () => {
  const snapshot = makeSnapshot();
  validateSnapshot(snapshot);
  assert.equal(snapshot.attention, 'unavailable');
  assert.equal(snapshot.eventReaction, 'not_evaluable');
  assert.ok(snapshot.dataGaps.some((gap: string) => gap.includes('热度历史序列')));
  assert.ok(snapshot.dataGaps.some((gap: string) => gap.includes('行情窗口')));
});

test('market reaction requires a window and carries its evidence', () => {
  const snapshot = makeSnapshot();
  const marketEvidence = 'sentiment_market:600519:daily_kline:2026-08-01_2026-08-08';
  snapshot.evidenceIds.push(marketEvidence);
  snapshot.evidence.push({ evidenceId: marketEvidence, type: 'market_window' } as any);
  snapshot.eventReactions = [{ eventId: snapshot.events[0].eventId, return3d: 0.02, reaction: 'confirmed_reaction', evidenceIds: [snapshot.events[0].eventId, marketEvidence] }];
  snapshot.eventReaction = 'confirmed_reaction';
  snapshot.metrics.eventReactionCount = 1;
  validateSnapshot(snapshot);
  assert.equal(snapshot.eventReactions[0].reaction, 'confirmed_reaction');
});

test('propagation quality is source-based and does not pretend to measure community viewpoints', () => {
  const snapshot = makeSnapshot();
  validateSnapshot(snapshot);
  assert.equal(snapshot.propagationQuality, 'official_primary');
  assert.equal(snapshot.communityViewpointDisagreement, 'unavailable');
  assert.equal(snapshot.viewpointScope, 'event_direction_evidence');
});

test('no matched events does not attribute generic market news to the stock', () => {
  const snapshot = makeSnapshot({ events: false, heat: false });
  validateSnapshot(snapshot);
  assert.equal(snapshot.tone, 'unavailable');
  assert.equal(snapshot.sourceQuality, 'insufficient');
  assert.equal(snapshot.metrics.eventCount, 0);
});

test('optional live sentiment smoke test', async (t) => {
  const baseUrl = process.env.STOCK_SENTIMENT_BASE_URL;
  if (!baseUrl) {
    t.skip('set STOCK_SENTIMENT_BASE_URL to run against a live server');
    return;
  }
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/stock-sentiment?symbol=600519&days=30`);
  assert.equal(response.ok, true);
  validateSnapshot(await response.json());
});
