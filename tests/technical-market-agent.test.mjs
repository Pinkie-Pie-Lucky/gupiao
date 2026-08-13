import test from 'node:test';
import assert from 'node:assert/strict';

const allowedStances = new Set(['observe', 'wait_for_confirmation', 'trend_following_candidate', 'avoid']);
const forbiddenClaims = /资金流|主力资金|必涨|必跌|明日上涨概率|明日下跌概率|买入|卖出|仓位/;

function makePayload({
  trend = 'bullish',
  duration = 12,
  marketRegime = 'neutral',
  industryState = 'strong',
  dataGaps = [],
  aiStatus = 'completed',
  source = 'live',
  fallbackLevel = 0,
} = {}) {
  const evidenceIds = ['technical:trend', 'technical:key-levels', 'technical:structure'];
  const signals = [
    { signalId: 'trend', status: trend === 'bullish' ? 'positive' : trend === 'bearish' ? 'risk' : 'mixed', values: { trend, trendDurationDays: duration }, evidenceIds: ['technical:trend'] },
    { signalId: 'confirmation', status: trend === 'bullish' ? 'positive' : 'mixed', values: {}, evidenceIds: ['technical:trend'] },
    { signalId: 'environment', status: 'mixed', values: { marketRegime }, evidenceIds: ['technical:trend'] },
    { signalId: 'relative_strength', status: industryState === 'unavailable' ? 'data_insufficient' : 'positive', values: { relativeToMarket: 'strong', relativeToIndustry: industryState }, evidenceIds: ['technical:trend'] },
  ];
  const structureRules = [{ ruleId: 'ma50_two_day_volume_break', description: 'MA50 buffered break with two high-volume closes', triggered: false, evidenceIds: ['technical:structure'] }];
  const keyLevels = { movingAverages: { ma20: 100, ma50: 98, ma200: 90 }, range: { low20d: 95, high60d: 110 }, atrBuffer: { multiplier: 0.5, value: 1.2 }, evidenceIds: ['technical:key-levels'] };
  const opinion = {
    agent: 'technical_market',
    status: dataGaps.length || aiStatus === 'fallback' ? 'limited' : 'completed',
    conclusion: trend === 'bullish' && duration >= 2 ? 'Trend structure remains observable with confirmation conditions.' : 'A single-day change is insufficient to establish a trend.',
    confidence: { score: dataGaps.length ? 50 : 78, level: dataGaps.length ? 'limited' : 'medium', reason: 'Bounded by data quality and signal consistency.' },
    trend: { state: trend === 'bullish' && duration >= 2 ? 'uptrend' : trend === 'bearish' && duration >= 2 ? 'downtrend' : trend === 'neutral' ? 'range' : 'unclear', durationTradingDays: duration, evidenceIds: ['technical:trend'] },
    marketRegime,
    relativeStrength: { vsMarket: 'strong', vsIndustry: industryState },
    keyLevels,
    execution: { stance: trend === 'bearish' ? 'avoid' : trend === 'bullish' && duration >= 2 ? 'trend_following_candidate' : 'observe', entryConditions: ['Signals remain aligned.'], invalidationConditions: structureRules.map((rule) => rule.description) },
    positives: [{ text: 'Deterministic trend signal is available.', evidenceIds: ['technical:trend'] }],
    negatives: [],
    uncertainties: dataGaps.map((text) => ({ text, evidenceIds: [] })),
    evidenceIds,
    dataGaps,
    vetoes: [],
  };
  return {
    symbol: '600519',
    period: '2026-08-07',
    deterministicSignals: signals,
    keyLevels,
    structureInvalidation: { ruleVersion: 'technical-market-structure-v1', triggered: false, rules: structureRules, evidenceIds: ['technical:structure'] },
    opinion,
    agentMeta: { source, aiStatus, promptVersion: 'technical-market-v1', signalVersion: 'technical-market-v1' },
    inputMeta: { technical: { sourceMeta: { source: source === 'cache' ? 'cache' : 'akshare', fallbackLevel, adjust: 'qfq' } } },
  };
}

function validateContract(payload) {
  assert.equal(typeof payload.symbol, 'string');
  assert.ok(Array.isArray(payload.deterministicSignals));
  assert.ok(payload.keyLevels?.movingAverages);
  assert.ok(payload.keyLevels?.range);
  assert.equal(payload.keyLevels?.atrBuffer?.multiplier, 0.5);
  assert.equal(payload.structureInvalidation?.ruleVersion, 'technical-market-structure-v1');
  assert.ok(Array.isArray(payload.structureInvalidation?.rules));
  const evidence = new Set([
    ...payload.deterministicSignals.flatMap((signal) => signal.evidenceIds || []),
    ...(payload.keyLevels.evidenceIds || []),
    ...(payload.structureInvalidation.evidenceIds || []),
  ]);
  assert.ok(evidence.size > 0);
  assert.ok(['completed', 'limited'].includes(payload.opinion.status));
  assert.ok(allowedStances.has(payload.opinion.execution.stance));
  for (const evidenceId of payload.opinion.evidenceIds || []) assert.ok(evidence.has(evidenceId), `unknown evidence id: ${evidenceId}`);
  const text = JSON.stringify(payload.opinion);
  assert.equal(forbiddenClaims.test(text), false, `forbidden claim in opinion: ${text}`);
}

test('ordinary stock keeps the technical-market response contract', () => {
  validateContract(makePayload());
});

test('bank stock uses the same market contract without financial shortcuts', () => {
  const payload = makePayload({ marketRegime: 'risk_on' });
  payload.symbol = '600000';
  validateContract(payload);
  assert.equal(payload.opinion.relativeStrength.vsMarket, 'strong');
});

test('low-liquidity stock degrades confidence instead of inventing a direction', () => {
  const payload = makePayload({ dataGaps: ['成交量样本不足，量价确认不可用。'] });
  validateContract(payload);
  assert.equal(payload.opinion.status, 'limited');
  assert.equal(payload.opinion.confidence.level, 'limited');
});

test('source fallback and cache metadata remain observable', () => {
  const fallback = makePayload({ source: 'tickflow', fallbackLevel: 1 });
  validateContract(fallback);
  assert.equal(fallback.inputMeta.technical.sourceMeta.fallbackLevel, 1);
  const cached = makePayload({ source: 'cache', fallbackLevel: 1 });
  validateContract(cached);
  assert.equal(cached.agentMeta.source, 'cache');
});

test('missing industry benchmark is explicit and unavailable', () => {
  const payload = makePayload({ industryState: 'unavailable', dataGaps: ['行业基准缺失，不能输出相对行业强弱。'] });
  validateContract(payload);
  assert.equal(payload.opinion.relativeStrength.vsIndustry, 'unavailable');
  assert.equal(payload.opinion.status, 'limited');
});

test('AI failure preserves deterministic signals and limited status', () => {
  const payload = makePayload({ aiStatus: 'fallback', dataGaps: ['AI 解释层不可用。'] });
  validateContract(payload);
  assert.equal(payload.agentMeta.aiStatus, 'fallback');
  assert.equal(payload.opinion.status, 'limited');
  assert.ok(payload.deterministicSignals.length > 0);
});

test('order-book fields cannot become a capital-flow conclusion', () => {
  const payload = makePayload();
  payload.orderBook = { bids: [{ price: 100, volume: 999999 }], asks: [{ price: 101, volume: 999999 }] };
  validateContract(payload);
  assert.equal('moneyFlow' in payload.opinion, false);
  assert.equal('capitalFlow' in payload.opinion, false);
  assert.equal(forbiddenClaims.test(JSON.stringify(payload.opinion)), false);
});

test('a one-day move cannot be reported as an established trend', () => {
  const payload = makePayload({ duration: 1 });
  validateContract(payload);
  assert.equal(payload.opinion.trend.state, 'unclear');
  assert.equal(payload.opinion.execution.stance, 'observe');
  assert.match(payload.opinion.conclusion, /single-day|insufficient/i);
});

test('optional live endpoint smoke test', async (t) => {
  const baseUrl = process.env.TECHNICAL_MARKET_BASE_URL;
  if (!baseUrl) {
    t.skip('set TECHNICAL_MARKET_BASE_URL to run against a live server');
    return;
  }
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/stock-agents/technical-market?symbol=600519`);
  assert.equal(response.ok, true);
  validateContract(await response.json());
});
