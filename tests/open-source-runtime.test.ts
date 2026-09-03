import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import { createRequestRateLimiter, withRetry } from '../backend/lib/resilience.js';
import { OPEN_SOURCE_SCHEMA_VERSION, resultEnvelope } from '../backend/core/contracts.js';

const execFileAsync = promisify(execFile);

test('stable open-source envelope always includes source and data-gap fields', () => {
  const result = resultEnvelope('example', { value: 1 }, {
    sourceMeta: { source: 'fixture', fetchedAt: '2026-01-01T00:00:00.000Z', freshness: 'fixture' },
    dataGaps: ['缺少补充字段', '缺少补充字段'],
    scope: 'test scope',
    generatedAt: '2026-01-01T00:00:00.000Z',
  });
  assert.equal(result.schemaVersion, OPEN_SOURCE_SCHEMA_VERSION);
  assert.equal(result.dataGaps.length, 1);
  assert.equal(result.sourceMeta?.source, 'fixture');
});

test('read-only upstream retry retries once and then returns', async () => {
  let calls = 0;
  const value = await withRetry(async () => {
    calls += 1;
    if (calls === 1) throw new Error('temporary network error');
    return 'ok';
  }, { attempts: 2, minDelayMs: 0 });
  assert.equal(value, 'ok');
  assert.equal(calls, 2);
});

test('in-process rate limiter returns a retryable 429 after its budget', () => {
  let now = 1_000;
  const limiter = createRequestRateLimiter({ maxRequests: 1, windowMs: 1_000, now: () => now });
  const headers = new Map<string, string>();
  const response: any = { setHeader: (key: string, value: string) => headers.set(key, value), status(code: number) { this.statusCode = code; return this; }, json(body: unknown) { this.body = body; return this; } };
  let nextCalls = 0;
  limiter({ ip: '127.0.0.1', socket: {} } as any, response, () => { nextCalls += 1; });
  limiter({ ip: '127.0.0.1', socket: {} } as any, response, () => { nextCalls += 1; });
  assert.equal(nextCalls, 1);
  assert.equal(response.statusCode, 429);
  assert.equal(response.body.retryable, true);
  now += 1_000;
  limiter({ ip: '127.0.0.1', socket: {} } as any, response, () => { nextCalls += 1; });
  assert.equal(nextCalls, 2);
  assert.equal(headers.get('RateLimit-Limit'), '1');
});

test('open-source entrypoints, fixtures, compose and compliance docs are shipped', () => {
  const root = process.cwd();
  const packageJson = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const required = ['backend/cli.ts', 'backend/mcp/stdio.ts', 'docker-compose.open-source.yml', 'examples/fixtures/market-observation.json', 'examples/fixtures/stock-fact-snapshot.json', 'docs/开源运行与合规说明.md', '.github/workflows/ci.yml'];
  for (const file of required) assert.ok(fs.existsSync(path.join(root, file)), `missing ${file}`);
  for (const script of ['"cli"', '"mcp:stdio"', '"test:ci"']) assert.ok(packageJson.includes(script));
  assert.ok(readme.includes('开源运行与合规说明'));
});

test('offline CLI keeps stdout machine-readable JSON', async () => {
  const tsxCli = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const { stdout, stderr } = await execFileAsync(process.execPath, [tsxCli, 'backend/cli.ts', 'market', '--offline'], { cwd: process.cwd(), windowsHide: true });
  assert.equal(stderr.trim(), '');
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.schemaVersion, OPEN_SOURCE_SCHEMA_VERSION);
  assert.equal(parsed.sourceMeta.freshness, 'fixture');
});
