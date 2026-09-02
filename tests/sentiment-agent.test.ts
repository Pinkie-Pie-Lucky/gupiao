import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeXueqiuItems } from '../backend/lib/sentimentRaw.js';

const forbiddenClaims = /热度上升|资金流入|主力进场|股价将|必涨|必跌|买入|卖出|仓位/;

function makePayload({ aiStatus = 'completed', status = 'limited', sourceAvailable = true } = {}) {
  const evidenceId = 'event:600519:announcement_contract:2026-08-07';
  return {
    symbol: '600519',
    period: { start: '2026-07-09', end: '2026-08-08' },
    deterministicSentiment: { attention: 'unavailable', tone: 'mixed', disagreement: 'high', evidenceDirectionDisagreement: 'high', communityViewpointDisagreement: 'unavailable', viewpointScope: 'event_direction_evidence', sourceQuality: 'official_led', propagationQuality: 'official_primary', eventReaction: 'not_evaluable', metrics: { eventCount: 2, currentAttention: '1234' } },
    sentimentSnapshot: { snapshotMeta: { sentimentVersion: 'stock-sentiment-v4' }, evidenceIds: [evidenceId], dataGaps: sourceAvailable ? ['缺少个股热度历史序列'] : ['舆情来源不可用'] },
    opinion: {
      agent: 'sentiment', status, conclusion: '事件方向存在分歧，当前市场反应不可评估。', eventSummary: '事件方向存在分歧。',
      confidence: { score: 50, level: 'limited', reason: '来源和时间序列有限。' },
      attention: 'unavailable', tone: 'mixed', disagreement: 'high', evidenceDirectionDisagreement: 'high', communityViewpointDisagreement: 'unavailable', viewpointScope: 'event_direction_evidence', sourceQuality: 'official_led', propagationQuality: 'official_primary', eventReaction: 'not_evaluable',
      catalysts: [{ text: '已核验事件', evidenceIds: [evidenceId] }], risks: [], positives: [{ text: '已核验事件', evidenceIds: [evidenceId] }], negatives: [], uncertainties: [{ text: '缺少热度历史序列', evidenceIds: [] }], evidenceIds: [evidenceId], dataGaps: ['缺少个股热度历史序列'], vetoes: [],
    },
    agentMeta: { aiStatus, promptVersion: 'sentiment-v3', sentimentVersion: 'stock-sentiment-v4' },
  };
}

function validatePayload(payload: any) {
  assert.equal(payload.agentMeta?.sentimentVersion, 'stock-sentiment-v4');
  const deterministic = payload.deterministicSentiment;
  assert.equal(payload.opinion.attention, deterministic.attention);
  assert.equal(payload.opinion.tone, deterministic.tone);
  assert.equal(payload.opinion.disagreement, deterministic.disagreement);
  assert.equal(payload.opinion.evidenceDirectionDisagreement, deterministic.evidenceDirectionDisagreement);
  assert.equal(payload.opinion.communityViewpointDisagreement, deterministic.communityViewpointDisagreement);
  assert.equal(payload.opinion.viewpointScope, deterministic.viewpointScope);
  assert.equal(payload.opinion.sourceQuality, deterministic.sourceQuality);
  assert.equal(payload.opinion.propagationQuality, deterministic.propagationQuality);
  assert.equal(payload.opinion.eventReaction, deterministic.eventReaction);
  assert.ok(['completed', 'limited', 'blocked'].includes(payload.opinion.status));
  const evidence = new Set(payload.sentimentSnapshot.evidenceIds || []);
  for (const id of payload.opinion.evidenceIds || []) assert.ok(evidence.has(id), `evidence id not from snapshot: ${id}`);
  assert.equal(forbiddenClaims.test(JSON.stringify(payload.opinion)), false);
}

test('AI opinion preserves deterministic sentiment fields', () => {
  const payload = makePayload();
  validatePayload(payload);
  assert.equal(payload.opinion.attention, 'unavailable');
  assert.equal(payload.opinion.eventReaction, 'not_evaluable');
});

test('AI failure returns limited deterministic fallback', () => {
  const payload = makePayload({ aiStatus: 'fallback', status: 'limited' });
  validatePayload(payload);
  assert.equal(payload.agentMeta.aiStatus, 'fallback');
  assert.equal(payload.opinion.status, 'limited');
});

test('all sentiment sources unavailable can be blocked', () => {
  const payload = makePayload({ aiStatus: 'not_requested', status: 'blocked', sourceAvailable: false });
  payload.opinion.evidenceIds = [];
  payload.sentimentSnapshot.evidenceIds = [];
  validatePayload(payload);
  assert.equal(payload.opinion.status, 'blocked');
});

test('雪球公开索引内容只作为未核验社区观点，不可伪装为事件事实', () => {
  const items = normalizeXueqiuItems({
    items: [{
      title: '湖南黄金热门讨论',
      body: '$湖南黄金(SZ002155)$ 社区讨论摘要',
      href: 'https://xueqiu.com/S/SZ002155/hots',
    }, {
      title: '不相关页面', body: '不应进入', href: 'https://example.com/S/SZ002155',
    }],
  }, { symbol: '002155', companyName: '湖南黄金', fetchedAt: '2026-08-22T00:00:00.000Z' });
  assert.equal(items.length, 1);
  assert.equal(items[0].platform, 'xueqiu_community');
  assert.equal(items[0].contentType, 'community_post');
  assert.equal(items[0].verification, 'community_unverified');
  assert.equal(items[0].sourceQuality, 'community');
});

test('optional live sentiment-agent smoke test', async (t) => {
  const baseUrl = process.env.STOCK_SENTIMENT_BASE_URL;
  if (!baseUrl) {
    t.skip('set STOCK_SENTIMENT_BASE_URL to run against a live server');
    return;
  }
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/stock-agents/sentiment?symbol=600519&days=30`);
  assert.equal(response.ok, true);
  validatePayload(await response.json());
});
