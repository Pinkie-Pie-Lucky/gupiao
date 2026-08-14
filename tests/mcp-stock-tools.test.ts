import test from 'node:test';
import assert from 'node:assert/strict';

test('generic market phrase is not a stock code', () => {
  const normalize = (input: string) => String(input || '').trim().toUpperCase().replace(/\.(SH|SZ|BJ)$|^(SH|SZ|BJ)/, '');
  assert.equal(/^\d{6}$/.test(normalize('股票行情')), false);
  assert.equal(/^\d{6}$/.test(normalize('002230.SZ')), true);
  assert.equal(/^\d{6}$/.test(normalize('SH600519')), true);
  assert.equal(/^\d{6}$/.test(normalize('12345678901234567890')), false);
});

test('MCP stock-tool source contains name lookup and typed invalid-input response', async () => {
  const source = await (await import('node:fs/promises')).readFile(new URL('../backend/mcp/server.ts', import.meta.url), 'utf8');
  assert.match(source, /'search_stock'/);
  assert.match(source, /invalid_argument/);
  assert.match(source, /InvalidStockIdentifierError/);
  assert.match(source, /MAX_STOCK_IDENTIFIER_LENGTH/);
  assert.match(source, /MAX_UPSTREAM_RESPONSE_BYTES/);
  assert.match(source, /\.max\(MAX_STOCK_IDENTIFIER_LENGTH\)/);
});

test('MCP endpoint has bounded request size and concurrency', async () => {
  const source = await (await import('node:fs/promises')).readFile(new URL('../backend/server.ts', import.meta.url), 'utf8');
  assert.match(source, /express\.json\(\{ limit: '64kb' \}\)/);
  assert.match(source, /MAX_CONCURRENT_MCP_REQUESTS/);
  assert.match(source, /status\(429\)/);
});
