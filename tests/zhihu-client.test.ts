import test from 'node:test';
import assert from 'node:assert/strict';
import { createZhihuClient, ZhihuApiUnavailableError } from '../backend/lib/zhihuClient.js';

test('未配置 Secret 时不发起网络请求', async () => {
  let called = false;
  const client = createZhihuClient({ fetchImpl: async () => { called = true; throw new Error('should not be called'); } });
  await assert.rejects(() => client.search('科大讯飞'), (error: any) => error instanceof ZhihuApiUnavailableError && error.code === 'provider_disabled');
  assert.equal(called, false);
});

test('知乎搜索遵循 Bearer、时间戳与 Query 参数格式，并复用缓存', async () => {
  let now = 1_700_000_000_000;
  let calls = 0;
  let captured: { url?: URL; init?: RequestInit } = {};
  const client = createZhihuClient({ accessSecret: 'secret-for-test', now: () => now, fetchImpl: async (url, init) => {
    calls += 1; captured = { url: new URL(String(url)), init };
    return new Response(JSON.stringify({ data: [{ title: '测试' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  const first = await client.search('  科大   讯飞  ');
  const second = await client.search('科大 讯飞');
  assert.equal(calls, 1);
  assert.equal(captured.url?.pathname, '/api/v1/content/zhihu_search');
  assert.equal(captured.url?.searchParams.get('Query'), '科大 讯飞');
  assert.equal((captured.init?.headers as Record<string, string>).Authorization, 'Bearer secret-for-test');
  assert.equal((captured.init?.headers as Record<string, string>)['X-Request-Timestamp'], '1700000000');
  assert.equal((first as any).sourceMeta.freshness, 'live');
  assert.equal((second as any).sourceMeta.freshness, 'cache');
  now += 11 * 60_000;
  await client.search('科大 讯飞');
  assert.equal(calls, 2);
});

test('全网搜索和热榜使用各自的官方路径', async () => {
  const paths: string[] = [];
  const client = createZhihuClient({ accessSecret: 'secret-for-test', fetchImpl: async (url) => {
    paths.push(new URL(String(url)).pathname);
    return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  await client.search('人工智能', 'global');
  await client.hotList();
  assert.deepEqual(paths, ['/api/v1/content/global_search', '/api/v1/content/hot_list']);
});
