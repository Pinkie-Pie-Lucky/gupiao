import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateViewpointDisagreement, classifySentimentStance, clusterSentimentItems } from '../backend/lib/sentimentAnalysis.js';
import type { SentimentRawItem } from '../backend/lib/sentimentRaw.js';

function item(overrides: Partial<SentimentRawItem> & Pick<SentimentRawItem, 'contentId' | 'title'>): SentimentRawItem {
  return {
    platform: 'eastmoney_mx', contentType: 'news', summary: '', originalUrl: null,
    publishedAt: '2026-08-18T02:00:00.000Z', fetchedAt: '2026-08-19T00:00:00.000Z',
    authorIdHash: null, engagement: null, relatedSymbols: ['002230'], entityMatchScore: 0.95,
    sourceQuality: 'financial_media', verification: 'credible_media_only', contentHash: overrides.contentId,
    clusterId: null, evidenceId: `e:${overrides.contentId}`, requiresReview: false,
    ...overrides,
  };
}

test('同一订单事件的公告与新闻被聚合，其他事件保持独立', () => {
  const result = clusterSentimentItems([
    item({ contentId: 'a1', title: '科大讯飞中标智慧教育重大项目', contentType: 'announcement', verification: 'official_document_only' }),
    item({ contentId: 'a2', title: '科大讯飞智慧教育项目中标金额披露', publishedAt: '2026-08-19T01:00:00.000Z' }),
    item({ contentId: 'a3', title: '科大讯飞发布新一代星火大模型', publishedAt: '2026-08-19T01:00:00.000Z' }),
  ], { symbol: '002230', companyName: '科大讯飞', now: '2026-08-19T02:00:00.000Z' });
  assert.equal(result.clusters.length, 2);
  const order = result.clusters.find((cluster) => cluster.category === 'order');
  assert.equal(order?.itemCount, 2);
  assert.equal(order?.verification, 'official_document_only');
  assert.ok(result.items.every((entry) => entry.clusterId));
});

test('官方公告不被当作社区观点，样本不足保持 unavailable', () => {
  const result = calculateViewpointDisagreement([
    item({ contentId: 'o1', title: '公司公告业绩增长', contentType: 'announcement', verification: 'official_document_only' }),
    item({ contentId: 'z1', title: '我认为产品前景很好', platform: 'zhihu', sourceQuality: 'community', verification: 'community_unverified' }),
  ]);
  assert.equal(result.overall.sampleCount, 1);
  assert.equal(result.community.sampleCount, 1);
  assert.equal(result.community.level, 'unavailable');
});

test('社区正反观点同时达到阈值时输出高分歧', () => {
  const result = calculateViewpointDisagreement([
    item({ contentId: 'z1', title: '业务增长明显前景改善', platform: 'zhihu', sourceQuality: 'community', verification: 'community_unverified' }),
    item({ contentId: 'z2', title: '新产品领先行业发展', platform: 'zhihu', sourceQuality: 'community', verification: 'community_unverified' }),
    item({ contentId: 'z3', title: '利润下滑存在亏损风险', platform: 'zhihu', sourceQuality: 'community', verification: 'community_unverified' }),
    item({ contentId: 'z4', title: '市场质疑订单减少', platform: 'zhihu', sourceQuality: 'community', verification: 'community_unverified' }),
  ]);
  assert.equal(result.community.level, 'high');
  assert.equal(result.community.counts.positive, 2);
  assert.equal(result.community.counts.negative, 2);
});

test('否定词不会把“未出现亏损”机械判为负面', () => {
  assert.notEqual(classifySentimentStance(item({ contentId: 'n1', title: '公司未出现亏损风险' })), 'negative');
});
