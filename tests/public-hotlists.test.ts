import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicHotlistClient, matchHotTopicsForStock, selectMarketContextHotTopics } from '../backend/lib/publicHotlists.js';

const payloads: Record<string, any> = {
  'weibo.com': { ok: 1, data: { realtime: [{ word: '湖南黄金重组进展', realpos: 1, num: 1000 }] } },
  'zhihu.com': { data: [{ card_id: 'q1', target: { title_area: { text: '如何看待湖南黄金？' }, excerpt_area: { text: '讨论公司重组' }, metrics_area: { text: '100 万热度' }, link: { url: 'https://www.zhihu.com/question/1' } } }] },
  'top.baidu.com': { data: { cards: [{ content: [{ content: [{ word: '机器人行业动态', index: 1, url: 'https://m.baidu.com/s?word=x' }] }] }] } },
  'douyin.com': { data: { word_list: [{ word: '黄金价格', sentence_id: '1', position: 1, hot_value: 900 }] } },
  'toutiao.com': { data: [{ Title: '上市公司公告', ClusterIdStr: '1', HotValue: '800', Url: 'https://www.toutiao.com/trending/1' }] },
  'bilibili.com': { code: 0, list: [{ hot_id: 1, show_name: '财经知识', pos: 1, heat_score: 700 }] },
};

test('六个平台热点统一为发现候选，只有直接匹配股票的热点进入个股候选', async () => {
  const fetchImpl = (async (input: any) => {
    const host = new URL(String(input)).hostname;
    const key = Object.keys(payloads).find((item) => host.includes(item));
    return new Response(JSON.stringify(payloads[key || '']), { status: key ? 200 : 404 });
  }) as typeof fetch;
  const snapshot = await createPublicHotlistClient({ fetchImpl, cacheTtlMs: 10_000 }).fetchAll();
  assert.equal(snapshot.sourceHealth.length, 6);
  assert.equal(snapshot.sourceHealth.every((item) => item.status === 'healthy'), true);
  assert.equal(snapshot.items.every((item) => item.verification === 'hotlist_discovery_only'), true);
  assert.equal(snapshot.items.find((item) => item.source === 'zhihu_hot')?.heat, 1_000_000);
  const matched = matchHotTopicsForStock(snapshot.items, '002155', '湖南黄金');
  assert.equal(matched.length, 2);
  assert.equal(matched.every((item) => /湖南黄金/.test(`${item.title} ${item.summary || ''}`)), true);
});

test('单个平台失败只降低该来源健康，不阻断其他热点来源', async () => {
  const fetchImpl = (async (input: any) => {
    const host = new URL(String(input)).hostname;
    if (host.includes('weibo.com')) throw new Error('blocked');
    const key = Object.keys(payloads).find((item) => host.includes(item));
    return new Response(JSON.stringify(payloads[key || '']), { status: key ? 200 : 404 });
  }) as typeof fetch;
  const snapshot = await createPublicHotlistClient({ fetchImpl }).fetchAll();
  assert.equal(snapshot.sourceHealth.find((item) => item.source === 'weibo_hot')?.status, 'degraded');
  assert.ok(snapshot.items.length >= 5);
});

test('市场背景热点只保留财经、行业或政策相关标题，并优先分散来源', async () => {
  const fetchImpl = (async (input: any) => {
    const host = new URL(String(input)).hostname;
    const key = Object.keys(payloads).find((item) => host.includes(item));
    return new Response(JSON.stringify(payloads[key || '']), { status: key ? 200 : 404 });
  }) as typeof fetch;
  const snapshot = await createPublicHotlistClient({ fetchImpl }).fetchAll();
  const topics = selectMarketContextHotTopics(snapshot.items);
  assert.ok(topics.some((item) => item.title.includes('机器人')));
  assert.ok(topics.every((item) => !item.title.includes('湖南黄金') || item.verification === 'hotlist_discovery_only'));
});
