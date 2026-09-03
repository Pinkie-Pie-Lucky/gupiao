/** 命令行入口：面向本地研究、脚本和定时任务，默认只输出 JSON。 */
import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { resultEnvelope } from './core/contracts.js';
import { buildQuoteFactSnapshot } from './core/factSnapshotFallback.js';
import { buildMarketObservation } from './core/marketObservation.js';
import { fetchMarketOverview, fetchStockQuote, searchStocks } from './dataSources/publicMarket.js';
import { createMxScreenerClient } from './lib/mxScreenerClient.js';

// CLI stdout 是机器可解析 JSON，dotenv 的提示必须静默，避免污染管道输出。
dotenv.config({ quiet: true });

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const usage = `泡泡看市 CLI

用法：
  npm run cli -- market [--offline]
  npm run cli -- quote <6位股票代码> [--offline]
  npm run cli -- search <股票名称或代码>
  npm run cli -- snapshot <6位股票代码> [--offline]
  npm run cli -- screen <自然语言条件>

所有输出均为带 schemaVersion、来源、数据缺口和范围说明的 JSON。`;

async function fixture(name: string) {
  const file = path.join(root, 'examples', 'fixtures', name);
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const offline = args.includes('--offline');
  const values = args.filter((item) => item !== '--offline');
  let output: unknown;

  if (command === 'market') {
    output = offline
      ? await fixture('market-observation.json')
      : resultEnvelope('market_observation', buildMarketObservation(await fetchMarketOverview()), {
        sourceMeta: { source: 'public_market_adapters', fetchedAt: new Date().toISOString(), freshness: 'live', provider: 'tencent_sina_eastmoney' },
        scope: '仅反映已取得的市场事实，不构成交易建议。',
      });
  } else if (command === 'quote') {
    const symbol = values[0];
    if (!symbol) throw new Error('quote 需要 6 位股票代码。');
    output = offline
      ? await fixture('stock-fact-snapshot.json')
      : resultEnvelope('stock_quote', await fetchStockQuote(symbol), {
        sourceMeta: { source: 'public_quote_adapters', fetchedAt: new Date().toISOString(), freshness: 'live', provider: 'tencent_sina' },
        scope: '仅为实时行情事实，不构成交易建议。',
      });
  } else if (command === 'search') {
    const query = values.join(' ').trim();
    if (!query) throw new Error('search 需要股票名称或代码。');
    output = resultEnvelope('stock_search', { query, results: await searchStocks(query) }, {
      sourceMeta: { source: 'public_search_adapters', fetchedAt: new Date().toISOString(), freshness: 'live', provider: 'eastmoney_sina' },
      scope: '仅返回证券身份匹配，不构成交易建议。',
    });
  } else if (command === 'snapshot') {
    const symbol = values[0];
    if (!symbol) throw new Error('snapshot 需要 6 位股票代码。');
    output = offline
      ? await fixture('stock-fact-snapshot.json')
      : resultEnvelope('stock_fact_snapshot', await buildQuoteFactSnapshot(symbol), {
        sourceMeta: { source: 'mcp_quote_fallback', fetchedAt: new Date().toISOString(), freshness: 'live', provider: 'tencent_sina' },
        scope: '此独立 CLI 快照含行情与证据；完整财务、公告、技术快照请使用 HTTP MCP 或产品 API。',
      });
  } else if (command === 'screen') {
    const query = values.join(' ').trim();
    if (!query) throw new Error('screen 需要自然语言筛选条件。');
    const result = await createMxScreenerClient({ apiKey: process.env.MX_APIKEY }).screen(query);
    output = resultEnvelope('stock_screening', result, {
      sourceMeta: { ...result.sourceMeta, freshness: result.sourceMeta.freshness as 'live' | 'cache' },
      scope: '结果是条件命中的研究候选池，不构成买卖推荐或收益承诺。',
    });
  } else {
    process.stdout.write(`${usage}\n`);
    process.exitCode = command ? 1 : 0;
    return;
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
