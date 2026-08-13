/**
 * 泡泡看市 - MCP Server（Streamable HTTP）
 *
 * 基于官方 MCP SDK（@modelcontextprotocol/sdk）实现，
 * 提供 A 股实时行情 / 市场概览等工具。
 * 数据源全部为 Node 原生 HTTP（腾讯/新浪/东财），不依赖 Python，
 * 因此在 Vercel / Railway / 本机均可运行。
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';

function httpGetText(urlStr: string, referer = 'https://gu.qq.com/', encoding = 'utf-8'): Promise<string> {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === 'http:' ? import('node:http').then((m) => m.default) : import('node:https').then((m) => m.default);
    mod.then((httpMod) => {
      const req = httpMod.get(
        {
          hostname: u.hostname,
          path: u.pathname + u.search,
          headers: { 'User-Agent': 'Mozilla/5.0', Referer: referer },
        },
        (res: any) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`HTTP ${res.statusCode}`));
              return;
            }
            resolve(new TextDecoder(encoding).decode(Buffer.concat(chunks)));
          });
        },
      );
      req.on('error', reject);
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('Timeout'));
      });
    });
  });
}

function httpGetJSON(urlStr: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === 'http:' ? import('node:http').then((m) => m.default) : import('node:https').then((m) => m.default);
    mod.then((httpMod) => {
      const req = httpMod.get(
        {
          hostname: u.hostname,
          family: 4,
          path: u.pathname + u.search,
          headers: { 'User-Agent': 'Mozilla/5.0' },
        },
        (res: any) => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => (data += chunk));
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`HTTP ${res.statusCode}`));
              return;
            }
            try {
              resolve(JSON.parse(data));
            } catch {
              reject(new Error('JSON parse failed'));
            }
          });
        },
      );
      req.on('error', reject);
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('Timeout'));
      });
    });
  });
}

function normalizeSymbol(input: string): string {
  return String(input || '').trim().toUpperCase().replace(/\.(SH|SZ|BJ)$|^(SH|SZ|BJ)/, '');
}

/** 查询 A 股实时行情（腾讯为主，新浪兜底） */
async function fetchStockQuote(symbol: string) {
  const code = normalizeSymbol(symbol);
  if (!/^\d{6}$/.test(code)) throw new Error('股票代码应为 6 位数字');
  const market = code.startsWith('6') || code.startsWith('5') || code.startsWith('9') ? 'sh' : 'sz';

  // 腾讯
  const tencentText = await httpGetText(`https://qt.gtimg.cn/q=${market}${code}`, 'https://gu.qq.com/', 'gb18030');
  const tMatch = tencentText.match(new RegExp(`v_${market}${code}="([^"]*)"`));
  const t = tMatch?.[1]?.split('~') || [];
  const tPrice = Number(t[3]);
  if (Number.isFinite(tPrice) && tPrice > 0) {
    return {
      code,
      name: t[1] || code,
      price: Math.round(tPrice * 100) / 100,
      change: Math.round((Number(t[31]) || 0) * 100) / 100,
      changePercent: Math.round((Number(t[32]) || 0) * 100) / 100,
      high: Number(t[33]) || null,
      low: Number(t[34]) || null,
      open: Number(t[5]) || null,
      previousClose: Number(t[4]) || null,
      volume: Number(t[6]) || 0,
      amount: Number(t[37]) || 0,
      source: 'tencent',
    };
  }

  // 新浪兜底
  const sinaSymbol = `${market === 'sh' ? 'sh' : 'sz'}${code}`;
  const sinaText = await httpGetText(`https://hq.sinajs.cn/list=${sinaSymbol}`, 'https://finance.sina.com.cn/', 'gb18030');
  const sMatch = sinaText.match(new RegExp(`hq_str_${sinaSymbol}="([^"]*)"`));
  const s = sMatch?.[1]?.split(',') || [];
  const sPrice = Number(s[3]);
  if (!Number.isFinite(sPrice) || sPrice <= 0) throw new Error('行情源均不可用');
  const prevClose = Number(s[2]);
  return {
    code,
    name: s[0] || code,
    price: Math.round(sPrice * 100) / 100,
    change: Math.round((sPrice - prevClose) * 100) / 100,
    changePercent: prevClose ? Math.round(((sPrice - prevClose) / prevClose) * 10000) / 100 : 0,
    high: Number(s[4]) || null,
    low: Number(s[5]) || null,
    open: Number(s[1]) || null,
    previousClose: prevClose || null,
    volume: Number(s[8]) || 0,
    amount: Number(s[9]) || 0,
    source: 'sina',
  };
}


/** 市场概览（指数 + 领涨板块） */
async function fetchMarketOverview() {
  const indexDefs = [
    { secid: '1.000001', name: '上证指数' },
    { secid: '0.399001', name: '深证成指' },
    { secid: '0.399006', name: '创业板指' },
  ];
  const indices = await Promise.all(
    indexDefs.map(async (item) => {
      try {
        const d = await httpGetJSON(`https://push2.eastmoney.com/api/qt/stock/get?secid=${item.secid}&fields=f43,f44,f45,f46,f47,f48,f60,f170,f100`);
        const q = d?.data || {};
        const price = Number(q.f43) / 100;
        return {
          name: item.name,
          price: Number.isFinite(price) ? Math.round(price * 100) / 100 : null,
          changePercent: Math.round((Number(q.f170) || 0) * 100) / 100,
        };
      } catch {
        return { name: item.name, price: null, changePercent: null };
      }
    }),
  );

  let sectors: { name: string; changePercent: number }[] = [];
  try {
    const sectorData = await httpGetJSON(
      'https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=5&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:90+t:2&fields=f2,f3,f12,f14',
    );
    sectors = (sectorData?.data?.diff || []).map((row: any) => ({
      name: String(row.f14 || ''),
      changePercent: Math.round(Number(row.f3 || 0) * 100) / 100,
    }));
  } catch {
    // 板块源失败不影响整体返回
  }

  return { indices, topSectors: sectors, fetchedAt: new Date().toISOString() };
}

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'gupiao-market-data',
    version: '1.0.0',
  });

  server.registerTool(
    'get_stock_quote',
    {
      title: '查询 A 股实时行情',
      description:
        '查询任意 A 股股票的实时行情，包括现价、涨跌、涨跌幅、开盘/最高/最低、成交量、成交额等。输入 6 位股票代码即可。数据来源腾讯/新浪，实时更新。',
      inputSchema: {
        symbol: z.string().describe('6 位 A 股股票代码，如 600519（贵州茅台）、000001（平安银行）'),
      },
    },
    async ({ symbol }) => {
      try {
        const quote = await fetchStockQuote(symbol);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(quote, null, 2) }],
        };
      } catch (error: any) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'upstream_error', trace_id: randomUUID(), message: String(error?.message || '未知错误') }) }],
        };
      }
    },
  );

  server.registerTool(
    'get_market_overview',
    {
      title: '获取 A 股市场概览',
      description:
        '获取当前 A 股大盘概览：上证/深证/创业板三大指数行情，以及当日领涨板块 Top5。可用于了解整体市场强弱和热点方向。',
      inputSchema: {},
    },
    async () => {
      try {
        const overview = await fetchMarketOverview();
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(overview, null, 2) }],
        };
      } catch (error: any) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'upstream_error', trace_id: randomUUID(), message: String(error?.message || '未知错误') }) }],
        };
      }
    },
  );

  return server;
}
