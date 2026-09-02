import test from 'node:test';
import assert from 'node:assert/strict';
import { createMxSearchClient, MxSearchUnavailableError } from '../backend/lib/mxSearchClient.js';

test('未配置妙想密钥时不发起请求', async () => {
  let called = false;
  const client = createMxSearchClient({ fetchImpl: async () => { called = true; throw new Error('should not call'); } });
  await assert.rejects(() => client.search('科大讯飞最新公告'), (error: any) => error instanceof MxSearchUnavailableError && error.code === 'provider_disabled');
  assert.equal(called, false);
  assert.equal(client.health().status, 'disabled');
});

test('妙想搜索使用服务端 apikey、复用缓存并记录健康状态', async () => {
  let now = 1_700_000_000_000;
  let calls = 0;
  let captured: RequestInit | undefined;
  const client = createMxSearchClient({ apiKey: 'test-key', now: () => now, fetchImpl: async (_url, init) => {
    calls += 1;
    captured = init;
    return new Response(JSON.stringify({ status: 0, code: 0, message: 'ok', data: { data: { llmSearchResponse: { data: [] } } } }), { status: 200 });
  } });
  const first = await client.search(' 科大讯飞   最新公告 ');
  const second = await client.search('科大讯飞 最新公告');
  assert.equal(calls, 1);
  assert.equal((captured?.headers as Record<string, string>).apikey, 'test-key');
  assert.equal(JSON.parse(String(captured?.body)).query, '科大讯飞 最新公告');
  assert.equal(first.sourceMeta.source, 'mx_search');
  assert.equal(second.sourceMeta.source, 'mx_search_cache');
  assert.equal(client.health().status, 'healthy');
  now += 16 * 60_000;
  await client.search('科大讯飞 最新公告');
  assert.equal(calls, 2);
});

test('业务限额错误被识别为 rate_limited', async () => {
  const client = createMxSearchClient({ apiKey: 'test-key', fetchImpl: async () => new Response(JSON.stringify({ status: 1, code: 113, message: '今日调用次数已达上限' }), { status: 200 }) });
  await assert.rejects(() => client.search('测试'), (error: any) => error instanceof MxSearchUnavailableError && error.code === 'rate_limited');
  assert.equal(client.health().status, 'degraded');
});
