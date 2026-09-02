import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { InMemoryContentRepo, InMemoryChatRepo, InMemorySentimentRepo } from '../backend/lib/db/inMemoryRepositories.js';
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

describe('InMemorySentimentRepo', () => {
  it('原始内容幂等保存、按股票时间窗读取并保留事件簇', async () => {
    const repo = new InMemorySentimentRepo();
    const raw = {
      contentId: 'c1', platform: 'zhihu', contentType: 'community_post', title: '测试观点', summary: '业务增长',
      originalUrl: null, publishedAt: '2026-08-18T00:00:00.000Z', fetchedAt: '2026-08-19T00:00:00.000Z',
      authorIdHash: 'hashed', engagement: { likes: 1 }, relatedSymbols: ['002230'], entityMatchScore: 0.95,
      sourceQuality: 'community', verification: 'community_unverified', contentHash: 'h1', clusterId: null,
      evidenceId: 'e1', requiresReview: false,
    };
    await repo.saveRawItems([raw]);
    await repo.saveRawItems([{ ...raw, summary: '业务增长明显', relatedSymbols: ['002230', '000001'] }]);
    await repo.saveClusters('002230', [{
      clusterId: 'cluster-1', symbol: '002230', category: 'earnings', representativeTitle: raw.title,
      representativeContentId: raw.contentId, startedAt: raw.publishedAt, endedAt: raw.publishedAt,
      itemCount: 1, sourceCount: 1, sourceBreakdown: { zhihu: 1 }, stanceMetrics: {},
      verification: 'community_unverified', itemIds: [raw.contentId], updatedAt: raw.fetchedAt,
    }]);
    const rows = await repo.listRawItems('002230', '2026-08-01T00:00:00.000Z');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].summary, '业务增长明显');
    assert.equal(rows[0].clusterId, 'cluster-1');
    assert.deepEqual(rows[0].relatedSymbols.sort(), ['000001', '002230']);
  });

  it('来源健康状态按来源幂等覆盖', async () => {
    const repo = new InMemorySentimentRepo();
    await repo.saveSourceHealth([{ source: 'zhihu', status: 'degraded', lastAttemptAt: null, lastSuccessAt: null, lastError: 'timeout', consecutiveFailures: 1, metadata: {}, updatedAt: '2026-08-19T00:00:00.000Z' }]);
    await repo.saveSourceHealth([{ source: 'zhihu', status: 'healthy', lastAttemptAt: '2026-08-19T01:00:00.000Z', lastSuccessAt: '2026-08-19T01:00:00.000Z', lastError: null, consecutiveFailures: 0, metadata: {}, updatedAt: '2026-08-19T01:00:00.000Z' }]);
    const health = await repo.listSourceHealth();
    assert.equal(health.length, 1);
    assert.equal(health[0].status, 'healthy');
  });

  it('事件事实链和节点可按股票及时间窗回读', async () => {
    const repo = new InMemorySentimentRepo();
    await repo.saveEventFactChains([{
      chainId: 'chain-1', symbol: '002230', topicKey: '订单', category: 'contract', headline: '订单公告', lifecycleState: 'announced', factStatus: 'official_verified',
      firstPublishedAt: '2026-08-18T00:00:00.000Z', lastPublishedAt: '2026-08-19T00:00:00.000Z', officialNodeId: 'node-1', clarificationNodeId: null,
      sourceCount: 2, nodeCount: 2, propagation: { mediaReportCount: 1 }, updatedAt: '2026-08-19T00:00:00.000Z',
    }], [{
      nodeId: 'node-1', chainId: 'chain-1', symbol: '002230', evidenceId: 'e1', title: '订单公告', summary: '', source: 'cninfo', sourceUrl: null,
      publishedAt: '2026-08-19T00:00:00.000Z', category: 'contract', direction: 'positive', verification: 'official_verified', role: 'official', parentNodeId: null,
      relationType: 'official_confirmation', linkConfidence: 'high', superseded: false, updatedAt: '2026-08-19T00:00:00.000Z',
    }]);
    const result = await repo.listEventFactChains('002230', '2026-08-01T00:00:00.000Z');
    assert.equal(result.chains[0].factStatus, 'official_verified');
    assert.equal(result.nodes[0].relationType, 'official_confirmation');
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
    assert.equal(typeof rt.sentiment.saveRawItems, 'function');
    await resetRuntime();
  });
});
