import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEventLifecycle } from '../backend/lib/eventLifecycle.js';

function candidate(overrides: Partial<any> & { nodeId: string; title: string }) {
  return {
    evidenceId: `e:${overrides.nodeId}`, summary: '', source: 'media-a', sourceUrl: null,
    publishedAt: '2026-08-18T01:00:00.000Z', category: 'contract', direction: 'positive',
    verification: 'credible_media_only', contentType: 'news', ...overrides,
  };
}

test('传闻、媒体与官方确认形成同一事实链，官方确认提升事实状态', () => {
  const result = buildEventLifecycle([
    candidate({ nodeId: 'r1', title: '网传公司签署重大订单', verification: 'community_unverified', source: 'zhihu' }),
    candidate({ nodeId: 'm1', title: '媒体称公司签署重大订单', publishedAt: '2026-08-18T03:00:00.000Z' }),
    candidate({ nodeId: 'o1', title: '关于签署重大订单的公告', publishedAt: '2026-08-19T02:00:00.000Z', verification: 'official_verified', source: 'cninfo' }),
  ], { symbol: '002230', companyName: '测试公司' });
  assert.equal(result.chains.length, 1);
  assert.equal(result.chains[0].factStatus, 'official_verified');
  assert.equal(result.chains[0].lifecycleState, 'announced');
  assert.equal(result.nodes.find((node) => node.nodeId === 'o1')?.relationType, 'official_confirmation');
});

test('官方澄清会令先前传闻失效，但澄清节点仍然保留', () => {
  const result = buildEventLifecycle([
    candidate({ nodeId: 'r1', title: '网传公司签署重大订单', verification: 'community_unverified', source: 'zhihu' }),
    candidate({ nodeId: 'c1', title: '关于重大订单传闻的澄清公告', summary: '公司未签署相关重大订单，相关传闻不属实。', category: 'clarification', direction: 'mixed', verification: 'official_verified', source: 'cninfo', publishedAt: '2026-08-19T02:00:00.000Z' }),
  ], { symbol: '002230', companyName: '测试公司' });
  assert.equal(result.chains.length, 1);
  assert.equal(result.chains[0].factStatus, 'officially_clarified');
  assert.equal(result.chains[0].lifecycleState, 'invalidated');
  assert.equal(result.nodes.find((node) => node.nodeId === 'r1')?.superseded, true);
  assert.equal(result.nodes.find((node) => node.nodeId === 'c1')?.superseded, false);
});

test('无官方证据的媒体报道保持 credible_media_only，不升级为事实', () => {
  const result = buildEventLifecycle([
    candidate({ nodeId: 'm1', title: '媒体称公司获得重大订单' }),
    candidate({ nodeId: 'm2', title: '公司重大订单消息引发关注', publishedAt: '2026-08-18T03:00:00.000Z', source: 'media-b' }),
  ], { symbol: '002230', companyName: '测试公司' });
  assert.equal(result.chains[0].factStatus, 'credible_media_only');
  assert.equal(result.nodes.every((node) => node.superseded === false), true);
});
