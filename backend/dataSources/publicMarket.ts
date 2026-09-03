/**
 * 公共行情/证券搜索适配器。
 *
 * 只负责第三方协议、输入校验与原始事实，不做 AI 解读、不拼装 MCP/HTTP 响应。
 */
const MAX_UPSTREAM_RESPONSE_BYTES = 1024 * 1024;

class UpstreamResponseTooLargeError extends Error {
  constructor() {
    super('上游响应超过安全大小限制');
    this.name = 'UpstreamResponseTooLargeError';
  }
}

export class InvalidStockIdentifierError extends Error {
  constructor(input: string) {
    const raw = String(input || '').trim();
    const preview = raw.length > 32 ? `${raw.slice(0, 32)}…` : raw || '空值';
    super(`请提供具体 A 股代码或股票名称，例如“002230”或“科大讯飞”。“${preview}”不是可查询的证券标识。`);
    this.name = 'InvalidStockIdentifierError';
  }
}

export type StockQuote = {
  code: string; name: string; price: number; change: number; changePercent: number;
  high: number | null; low: number | null; open: number | null; previousClose: number | null;
  volume: number; amount: number; source: 'tencent' | 'sina';
};
export type StockSearchResult = { code: string; name: string; exchange: 'SH' | 'SZ' | 'BJ' };

export function normalizeSymbol(input: string): string {
  return String(input || '').trim().toUpperCase().replace(/\.(SH|SZ|BJ)$|^(SH|SZ|BJ)/, '');
}

export function isValidStockCode(input: string) {
  return /^\d{6}$/.test(normalizeSymbol(input));
}

function httpGetText(urlStr: string, referer = 'https://gu.qq.com/', encoding = 'utf-8'): Promise<string> {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === 'http:' ? import('node:http').then((m) => m.default) : import('node:https').then((m) => m.default);
    mod.then((httpMod) => {
      const req = httpMod.get({ hostname: u.hostname, path: u.pathname + u.search, headers: { 'User-Agent': 'Mozilla/5.0', Referer: referer } }, (res: any) => {
        const chunks: Buffer[] = [];
        let receivedBytes = 0;
        res.on('data', (chunk: Buffer) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          receivedBytes += buffer.length;
          if (receivedBytes > MAX_UPSTREAM_RESPONSE_BYTES) { req.destroy(new UpstreamResponseTooLargeError()); return; }
          chunks.push(buffer);
        });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
          resolve(new TextDecoder(encoding).decode(Buffer.concat(chunks)));
        });
      });
      req.on('error', reject);
      req.setTimeout(10_000, () => { req.destroy(new Error('Timeout')); });
    });
  });
}

function httpGetJSON(urlStr: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === 'http:' ? import('node:http').then((m) => m.default) : import('node:https').then((m) => m.default);
    mod.then((httpMod) => {
      const req = httpMod.get({ hostname: u.hostname, family: 4, path: u.pathname + u.search, headers: { 'User-Agent': 'Mozilla/5.0' } }, (res: any) => {
        let data = '';
        let receivedBytes = 0;
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          receivedBytes += Buffer.byteLength(chunk, 'utf8');
          if (receivedBytes > MAX_UPSTREAM_RESPONSE_BYTES) { req.destroy(new UpstreamResponseTooLargeError()); return; }
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
          try { resolve(JSON.parse(data)); } catch { reject(new Error('JSON parse failed')); }
        });
      });
      req.on('error', reject);
      req.setTimeout(10_000, () => { req.destroy(new Error('Timeout')); });
    });
  });
}

/** 腾讯主源、新浪兜底；适配器不缓存，缓存策略属于调用侧。 */
export async function fetchStockQuote(symbol: string): Promise<StockQuote> {
  const code = normalizeSymbol(symbol);
  if (!/^\d{6}$/.test(code)) throw new InvalidStockIdentifierError(symbol);
  const market = code.startsWith('6') || code.startsWith('5') || code.startsWith('9') ? 'sh' : 'sz';
  try {
    const tencentText = await httpGetText(`https://qt.gtimg.cn/q=${market}${code}`, 'https://gu.qq.com/', 'gb18030');
    const values = tencentText.match(new RegExp(`v_${market}${code}="([^"]*)"`))?.[1]?.split('~') || [];
    const price = Number(values[3]);
    if (Number.isFinite(price) && price > 0) return {
      code, name: values[1] || code, price: Math.round(price * 100) / 100, change: Math.round((Number(values[31]) || 0) * 100) / 100,
      changePercent: Math.round((Number(values[32]) || 0) * 100) / 100, high: Number(values[33]) || null, low: Number(values[34]) || null,
      open: Number(values[5]) || null, previousClose: Number(values[4]) || null, volume: Number(values[6]) || 0, amount: Number(values[37]) || 0, source: 'tencent',
    };
  } catch {
    // 腾讯异常后继续用新浪，避免单个源阻断实时行情。
  }
  const sinaSymbol = `${market === 'sh' ? 'sh' : 'sz'}${code}`;
  const sinaText = await httpGetText(`https://hq.sinajs.cn/list=${sinaSymbol}`, 'https://finance.sina.com.cn/', 'gb18030');
  const values = sinaText.match(new RegExp(`hq_str_${sinaSymbol}="([^"]*)"`))?.[1]?.split(',') || [];
  const price = Number(values[3]);
  if (!Number.isFinite(price) || price <= 0) throw new Error('行情源均不可用');
  const previousClose = Number(values[2]);
  return {
    code, name: values[0] || code, price: Math.round(price * 100) / 100, change: Math.round((price - previousClose) * 100) / 100,
    changePercent: previousClose ? Math.round(((price - previousClose) / previousClose) * 10_000) / 100 : 0,
    high: Number(values[4]) || null, low: Number(values[5]) || null, open: Number(values[1]) || null, previousClose: previousClose || null,
    volume: Number(values[8]) || 0, amount: Number(values[9]) || 0, source: 'sina',
  };
}

function normalizeSearchResult(code: unknown, name: unknown, exchange?: unknown): StockSearchResult | null {
  const normalizedCode = String(code || '').replace(/\D/g, '');
  const normalizedName = String(name || '').trim();
  if (!/^\d{6}$/.test(normalizedCode) || !normalizedName) return null;
  const rawExchange = String(exchange || '').toUpperCase();
  const market: StockSearchResult['exchange'] = rawExchange === 'BJ' || /^[48]/.test(normalizedCode) ? 'BJ' : rawExchange === 'SH' || /^(5|6|9)/.test(normalizedCode) ? 'SH' : 'SZ';
  return { code: normalizedCode, name: normalizedName, exchange: market };
}

export async function searchStocks(query: string): Promise<StockSearchResult[]> {
  const keyword = String(query || '').trim();
  if (!keyword || /^股票行情$|^行情$|^股市$/.test(keyword)) throw new InvalidStockIdentifierError(keyword);
  const matches = new Map<string, StockSearchResult>();
  try {
    const payload = await httpGetJSON(`https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(keyword)}&type=14&token=D43BF722C1B2D6D0F3513D2F4B09D208&count=10`);
    for (const item of Array.isArray(payload?.QuotationCodeTable?.Data) ? payload.QuotationCodeTable.Data : []) {
      const kind = String(item?.Classify || item?.SecurityTypeName || '');
      if (kind && !/AStock|A股|沪A|深A|北交/.test(kind)) continue;
      const quoteId = String(item?.QuoteID || '');
      const result = normalizeSearchResult(item?.Code || item?.UnifiedCode, item?.Name, quoteId.startsWith('1.') ? 'SH' : quoteId.startsWith('0.') ? 'SZ' : undefined);
      if (result) matches.set(result.code, result);
    }
  } catch {
    // 东财异常后继续用新浪。
  }
  if (!matches.size) {
    try {
      const text = await httpGetText(`https://suggest3.sinajs.cn/suggest/type=11,12,13,14,15/&key=${encodeURIComponent(keyword)}`, 'https://finance.sina.com.cn/', 'gb18030');
      for (const item of text.matchAll(/"([a-z]{2})(\d{6}),[^,]*,([^,]+),/gi)) {
        const result = normalizeSearchResult(item[2], item[3], item[1].toUpperCase());
        if (result) matches.set(result.code, result);
      }
    } catch {
      // 统一在下方给出数据源不可用错误。
    }
  }
  if (!matches.size) throw new Error('股票搜索数据源暂不可用或未找到匹配证券');
  return [...matches.values()].slice(0, 10);
}

export async function fetchMarketOverview() {
  const indexDefs = [{ secid: '1.000001', name: '上证指数' }, { secid: '0.399001', name: '深证成指' }, { secid: '0.399006', name: '创业板指' }];
  const indices = await Promise.all(indexDefs.map(async (item) => {
    try {
      const quote = (await httpGetJSON(`https://push2.eastmoney.com/api/qt/stock/get?secid=${item.secid}&fields=f43,f44,f45,f46,f47,f48,f60,f170,f100`))?.data || {};
      const price = Number(quote.f43) / 100;
      return { name: item.name, price: Number.isFinite(price) ? Math.round(price * 100) / 100 : null, changePercent: Math.round((Number(quote.f170) || 0) * 100) / 100 };
    } catch { return { name: item.name, price: null, changePercent: null }; }
  }));
  let topSectors: Array<{ name: string; changePercent: number }> = [];
  try {
    const payload = await httpGetJSON('https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=5&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:90+t:2&fields=f2,f3,f12,f14');
    topSectors = (payload?.data?.diff || []).map((row: any) => ({ name: String(row.f14 || ''), changePercent: Math.round(Number(row.f3 || 0) * 100) / 100 }));
  } catch {
    // 板块数据缺失由事实层显式标注，不阻断指数结果。
  }
  return { indices, topSectors, fetchedAt: new Date().toISOString() };
}
