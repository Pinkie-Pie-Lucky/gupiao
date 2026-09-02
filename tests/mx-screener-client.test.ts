import test from 'node:test';
import assert from 'node:assert/strict';
import { createMxScreenerClient, MxScreenerUnavailableError } from '../backend/lib/mxScreenerClient.js';

const payload = { status: 0, data: { data: { title: '智能选股', securityCount: 2, responseConditionList: [{ describe: '证券类型包含A股', stockCount: 5559 }, { describe: '市盈率小于20', stockCount: 2408 }], allResults: { result: { columns: [{ field: 'SECURITY_CODE', displayName: '代码' }, { field: 'SECURITY_NAME_ABBR', displayName: '名称' }], dataList: [{ SECURITY_CODE: '600000', SECURITY_NAME_ABBR: '浦发银行' }, { SECURITY_CODE: '000001', SECURITY_NAME_ABBR: '平安银行' }] } } } } };

test('未配置密钥时不会请求妙想选股', async () => {
  let called = false;
  const client = createMxScreenerClient({ fetchImpl: async () => { called = true; throw new Error('should not call'); } });
  await assert.rejects(() => client.screen('PE 小于 20'), (error: any) => error instanceof MxScreenerUnavailableError && error.code === 'provider_disabled');
  assert.equal(called, false);
});

test('妙想选股解析条件、全量表格并命中缓存', async () => {
  let now = 1_700_000_000_000;
  let calls = 0;
  let captured: RequestInit | undefined;
  const client = createMxScreenerClient({ apiKey: 'test-key', now: () => now, fetchImpl: async (_url, init) => { calls += 1; captured = init; return new Response(JSON.stringify(payload), { status: 200 }); } });
  const first = await client.screen('  PE 小于 20  ');
  const second = await client.screen('PE 小于 20');
  assert.equal(calls, 1);
  assert.equal(JSON.parse(String(captured?.body)).keyword, 'PE 小于 20');
  assert.equal((captured?.headers as Record<string, string>).apikey, 'test-key');
  assert.equal(first.rows.length, 2);
  assert.equal(first.columns[0].label, '代码');
  assert.equal(first.conditions[1].stockCount, 2408);
  assert.equal(second.sourceMeta.freshness, 'cache');
  now += 11 * 60_000;
  await client.screen('PE 小于 20');
  assert.equal(calls, 2);
});
