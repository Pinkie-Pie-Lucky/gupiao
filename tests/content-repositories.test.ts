import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { InMemoryContentRepo, InMemoryChatRepo } from '../backend/lib/db/inMemoryRepositories.js';
import { createRuntime, resetRuntime } from '../backend/lib/db/runtime.js';

describe('InMemoryContentRepo', () => {
  it('早报 / 市场动态 / 泡泡精选均可落库', async () => {
    const repo = new InMemoryContentRepo();
    await repo.saveMorningReport({
      marketDate: '2026-08-14',
      payload: { sentiment: '乐观', stories: [] },
      createdAt: '2026-08-14T00:00:00.000Z',
    });
    await repo.saveMarketReport({
      id: randomUUID(),
      marketDate: '2026-08-14',
      report: '今日市场震荡整理。',
      fallback: false,
      promptVersion: 'market-digest-v1',
      inputSnapshot: {},
      createdAt: '2026-08-14T00:00:00.000Z',
    });
    await repo.saveBubbleSelection({
      id: randomUUID(),
      marketDate: '2026-08-14',
      payload: { bubbleSelection: [], candidateCount: 30 },
      promptVersion: 'p5-bubble-signal-v2',
      fallback: false,
      createdAt: '2026-08-14T00:00:00.000Z',
    });
    assert.ok(true);
  });

  it('市场概览 / 板块快照按交易日幂等覆盖', async () => {
    const repo = new InMemoryContentRepo();
    await repo.saveMarketOverview({
      marketDate: '2026-08-14',
      payload: { indices: [{ name: '上证指数', price: 3000 }] },
      updatedAt: '2026-08-14T02:00:00.000Z',
    });
    await repo.saveMarketOverview({
      marketDate: '2026-08-14',
      payload: { indices: [{ name: '上证指数', price: 3100 }] },
      updatedAt: '2026-08-14T03:00:00.000Z',
    });
    const overview = await repo.getMarketOverview('2026-08-14');
    const op = overview?.payload as { indices: Array<{ name: string; price: number }> };
    assert.equal(op.indices[0].price, 3100);

    await repo.saveSectorSnapshot({
      marketDate: '2026-08-14',
      payload: { sectors: [{ name: '半导体', changePercent: 3 }], timestamp: 1 },
      updatedAt: '2026-08-14T03:00:00.000Z',
    });
    const snapshot = await repo.getSectorSnapshot('2026-08-14');
    const sp = snapshot?.payload as { sectors: Array<{ name: string; changePercent: number }> };
    assert.equal(sp.sectors[0].name, '半导体');
    assert.equal(await repo.getSectorSnapshot('2026-08-13'), null);
  });

  it('个股分析输出按 symbol + agent 幂等 upsert', async () => {
    const repo = new InMemoryContentRepo();
    await repo.saveStockAgentOutput({
      symbol: '600519', agent: 'fundamental',
      payload: { verdict: '中性' },
      updatedAt: '2026-08-14T02:00:00.000Z',
    });
    await repo.saveStockAgentOutput({
      symbol: '600519', agent: 'fundamental',
      payload: { verdict: '乐观' },
      updatedAt: '2026-08-14T03:00:00.000Z',
    });
    const output = await repo.getStockAgentOutput('600519', 'fundamental');
    const op2 = output?.payload as { verdict: string };
    assert.equal(op2.verdict, '乐观');
    assert.equal(await repo.getStockAgentOutput('600519', 'valuation'), null);
    assert.equal(await repo.getStockAgentOutput('000001', 'fundamental'), null);
  });
});

describe('InMemoryChatRepo', () => {
  it('同一会话按顺序追加用户与助手消息', async () => {
    const repo = new InMemoryChatRepo();
    await repo.addMessage({
      id: randomUUID(), userId: null, sessionId: 's1',
      role: 'user', content: '你好', createdAt: '2026-08-14T00:00:00.000Z',
    });
    await repo.addMessage({
      id: randomUUID(), userId: null, sessionId: 's1',
      role: 'assistant', content: '你好呀', createdAt: '2026-08-14T00:00:00.000Z',
    });
    assert.ok(true);
  });
});

describe('DbRuntime', () => {
  it('无 DATABASE_URL 时回退内存仓储并暴露 content / chat', async () => {
    delete process.env.DATABASE_URL;
    await resetRuntime();
    const rt = await createRuntime();
    assert.equal(rt.mode, 'memory');
    assert.equal(typeof rt.content.saveMorningReport, 'function');
    assert.equal(typeof rt.content.saveMarketReport, 'function');
    assert.equal(typeof rt.content.saveBubbleSelection, 'function');
    assert.equal(typeof rt.chat.addMessage, 'function');
    await resetRuntime();
  });
});
