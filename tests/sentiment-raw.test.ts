import test from 'node:test';
import assert from 'node:assert/strict';
import { dedupeSentimentRawItems, normalizeMxSearchItems, normalizeZhihuItems } from '../backend/lib/sentimentRaw.js';

const context = { symbol: '002230', companyName: '科大讯飞', fetchedAt: '2026-08-19T00:00:00.000Z' };

test('妙想公告被映射为可追溯原始证据', () => {
  const items = normalizeMxSearchItems({ data: { data: { llmSearchResponse: { data: [{ code: 'AN1', title: '科大讯飞关于项目进展的公告', content: '<p>项目按计划推进。</p>', informationType: 'NOTICE', jumpUrl: 'https://example.com/a', publishDate: '2026-08-18 12:00' }] } } } }, context);
  assert.equal(items.length, 1);
  assert.equal(items[0].contentType, 'announcement');
  assert.equal(items[0].verification, 'official_document_only');
  assert.equal(items[0].entityMatchScore, 0.95);
  assert.match(items[0].evidenceId, /^sentiment_raw:002230:eastmoney_mx:/);
  assert.equal(items[0].clusterId, null);
  assert.equal(items[0].summary, '项目按计划推进。');
});

test('知乎内容保留社区未核验边界和互动量', () => {
  const items = normalizeZhihuItems({ Data: { Items: [{ Id: 'z1', Title: '如何看待科大讯飞的新产品？', Excerpt: '讨论产品进展与竞争格局', Url: 'https://zhihu.com/question/1', Author: { Id: 'author-1' }, VoteupCount: 12, CommentCount: 3, CreatedAt: 1_776_000_000 }] } }, context);
  assert.equal(items.length, 1);
  assert.equal(items[0].verification, 'community_unverified');
  assert.equal(items[0].engagement?.likes, 12);
  assert.equal(items[0].requiresReview, false);
  assert.ok(items[0].authorIdHash && !items[0].authorIdHash.includes('author-1'));
});

test('弱实体匹配进入待复核且相同 URL 去重', () => {
  const first = normalizeZhihuItems({ data: [{ id: '1', title: '人工智能行业讨论', content: '未明确提及目标公司', url: 'https://zhihu.com/p/1' }] }, context)[0];
  const second = { ...first, entityMatchScore: 0.9, requiresReview: false };
  assert.equal(first.requiresReview, true);
  const deduped = dedupeSentimentRawItems([first, second]);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].entityMatchScore, 0.9);
});
