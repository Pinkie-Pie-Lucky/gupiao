import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import 'dotenv/config';

const root = process.cwd();
const checks = [];
const record = (name, ok, detail) => checks.push({ name, ok, detail });

function pythonRuntime() {
  if (process.env.AKSHARE_PYTHON) return process.env.AKSHARE_PYTHON;
  const candidates = process.platform === 'win32'
    ? [path.join(root, '.venv', 'Scripts', 'python.exe')]
    : [path.join(root, '.venv', 'bin', 'python')];
  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

function runPython(script, args, timeout = 120_000) {
  const runtime = pythonRuntime();
  if (!runtime) return { ok: false, detail: '未找到项目 .venv Python 3' };
  const result = spawnSync(runtime, [path.join(root, 'scripts', script), ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout,
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, PYTHONUTF8: '1', OPENBLAS_NUM_THREADS: '1', OMP_NUM_THREADS: '1', MKL_NUM_THREADS: '1', NUMEXPR_NUM_THREADS: '1' },
  });
  if (result.status !== 0) return { ok: false, detail: String(result.stderr || result.error?.message || '执行失败').trim().slice(0, 180) };
  try { return { ok: true, value: JSON.parse(result.stdout) }; }
  catch { return { ok: false, detail: '脚本未返回有效 JSON' }; }
}

async function main() {
  const apiKey = process.env.DEEPSEEK_API_KEY || '';
  const baseUrl = (process.env.AI_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
  const model = process.env.AI_MODEL || 'deepseek-v4-flash';
  record('DeepSeek 配置', Boolean(apiKey && model), apiKey ? model : '缺少 DEEPSEEK_API_KEY');

  const runtime = pythonRuntime();
  record('Python 运行时', Boolean(runtime && fs.existsSync(runtime)), runtime || '未找到 .venv');
  if (runtime) {
    const imports = spawnSync(runtime, ['-c', 'import akshare,pandas,requests,baostock,pytdx,tickflow; print("ok")'], { encoding: 'utf8', env: { ...process.env, OPENBLAS_NUM_THREADS: '1', OMP_NUM_THREADS: '1' } });
    record('Python 数据依赖', imports.status === 0, imports.status === 0 ? '已安装' : String(imports.stderr).trim().slice(0, 180));
  }

  if (apiKey) {
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: '只回复 OK' }], max_tokens: 32, temperature: 0, thinking: { type: 'disabled' } }),
        signal: AbortSignal.timeout(30_000),
      });
      const payload = await response.json().catch(() => ({}));
      record('DeepSeek 实际调用', response.ok && Boolean(payload.choices?.[0]?.message?.content), response.ok ? `HTTP ${response.status}` : `HTTP ${response.status}: ${payload.error?.message || '请求失败'}`);
    } catch (error) {
      record('DeepSeek 实际调用', false, error instanceof Error ? error.message : String(error));
    }
  }

  const kline = runPython('market_daily_kline.py', ['stock', '002230']);
  record('真实日线数据', kline.ok && kline.value?.bars?.length >= 60, kline.ok ? `${kline.value.bars.length} 根，最新 ${kline.value.sourceMeta?.lastTradingDate || '未知'}` : kline.detail);
  const valuation = runPython('stock_valuation.py', ['002230'], 60_000);
  record('实时股票价格', valuation.ok && Number(valuation.value?.valuation?.price) > 0, valuation.ok ? `${valuation.value.valuation.name || '002230'} ${valuation.value.valuation.price}，来源 ${valuation.value.sourceMeta?.source}` : valuation.detail);

  for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}: ${check.detail}`);
  if (checks.some((check) => !check.ok)) process.exitCode = 1;
}

await main();
