import { createHash } from 'node:crypto';

export type PublicHotlistSource = 'weibo_hot' | 'zhihu_hot' | 'baidu_hot' | 'douyin_hot' | 'toutiao_hot' | 'bilibili_hot';

export type PublicHotTopic = {
  topicId: string;
  source: PublicHotlistSource;
  title: string;
  summary: string | null;
  url: string | null;
  rank: number | null;
  heat: number | null;
  label: string | null;
  observedAt: string;
  verification: 'hotlist_discovery_only';
};

type SourceHealth = {
  source: PublicHotlistSource;
  status: 'healthy' | 'degraded';
  itemCount: number;
  latencyMs: number;
  lastAttemptAt: string;
  lastSuccessAt: string | null;
  lastError: string | null;
};

export type PublicHotlistSnapshot = {
  items: PublicHotTopic[];
  sourceHealth: SourceHealth[];
  sourceMeta: { fetchedAt: string; freshness: 'live' | 'cache'; version: 'public-hotlists-v1'; discoveryOnly: true };
};

type Options = { fetchImpl?: typeof fetch; timeoutMs?: number; cacheTtlMs?: number; now?: () => number };

const SOURCE_CONFIG: Record<PublicHotlistSource, { url: string; referer: string }> = {
  weibo_hot: { url: 'https://weibo.com/ajax/side/hotSearch', referer: 'https://weibo.com/' },
  zhihu_hot: { url: 'https://www.zhihu.com/api/v3/feed/topstory/hot-list-web?limit=50&desktop=true', referer: 'https://www.zhihu.com/hot' },
  baidu_hot: { url: 'https://top.baidu.com/api/board?platform=wise&tab=realtime', referer: 'https://top.baidu.com/board?tab=realtime' },
  douyin_hot: { url: 'https://www.douyin.com/aweme/v1/web/hot/search/list/', referer: 'https://www.douyin.com/' },
  toutiao_hot: { url: 'https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc', referer: 'https://www.toutiao.com/' },
  bilibili_hot: { url: 'https://s.search.bilibili.com/main/hotword', referer: 'https://search.bilibili.com/' },
};

function cleanText(value: unknown, maxLength = 500) {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function chineseHeat(value: unknown) {
  const raw = cleanText(value, 80).replace(/,/g, '');
  const number = Number.parseFloat(raw.replace(/[^\d.]/g, ''));
  if (!Number.isFinite(number)) return null;
  if (raw.includes('亿')) return number * 100_000_000;
  if (raw.includes('万')) return number * 10_000;
  return number;
}

function safeHttpUrl(value: unknown) {
  const raw = cleanText(value, 2_000);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function topicId(source: PublicHotlistSource, title: string, rawId: unknown) {
  return `hot:${source}:${createHash('sha256').update(`${rawId || ''}|${title}`, 'utf8').digest('hex').slice(0, 20)}`;
}

function normalizedTopic(source: PublicHotlistSource, raw: any, observedAt: string, index: number): PublicHotTopic | null {
  let title = ''; let summary: string | null = null; let url: string | null = null; let rank: number | null = index + 1; let heat: number | null = null; let label: string | null = null; let rawId: unknown = index;
  if (source === 'weibo_hot') {
    title = cleanText(raw?.word || raw?.note); rawId = raw?.word_scheme || raw?.word; rank = finiteNumber(raw?.realpos ?? raw?.rank) || index + 1; heat = finiteNumber(raw?.num); label = cleanText(raw?.label_name || raw?.icon_desc, 40) || null;
    url = title ? `https://s.weibo.com/weibo?q=${encodeURIComponent(`#${title}#`)}&Refer=top` : null;
  } else if (source === 'zhihu_hot') {
    title = cleanText(raw?.target?.title_area?.text); summary = cleanText(raw?.target?.excerpt_area?.text, 1_200) || null; url = safeHttpUrl(raw?.target?.link?.url); rawId = raw?.card_id || raw?.id; heat = chineseHeat(raw?.target?.metrics_area?.text);
  } else if (source === 'baidu_hot') {
    title = cleanText(raw?.word); url = safeHttpUrl(raw?.url); rank = finiteNumber(raw?.index) ?? index + 1; rawId = raw?.word; label = cleanText(raw?.labelTagName || raw?.newHotName, 40) || null;
  } else if (source === 'douyin_hot') {
    title = cleanText(raw?.word); rawId = raw?.sentence_id || raw?.group_id; rank = finiteNumber(raw?.position) ?? index + 1; heat = finiteNumber(raw?.hot_value); label = raw?.label ? String(raw.label) : null; url = title ? `https://www.douyin.com/search/${encodeURIComponent(title)}` : null;
  } else if (source === 'toutiao_hot') {
    title = cleanText(raw?.Title || raw?.QueryWord); rawId = raw?.ClusterIdStr || raw?.ClusterId; heat = finiteNumber(raw?.HotValue); label = cleanText(raw?.Label, 40) || null; url = safeHttpUrl(raw?.Url);
  } else {
    title = cleanText(raw?.show_name || raw?.keyword); rawId = raw?.hot_id || raw?.id; rank = finiteNumber(raw?.pos) ?? index + 1; heat = finiteNumber(raw?.heat_score); label = cleanText(raw?.status, 40) || null; url = title ? `https://search.bilibili.com/all?keyword=${encodeURIComponent(title)}` : null;
  }
  if (!title) return null;
  return { topicId: topicId(source, title, rawId), source, title, summary, url, rank, heat, label, observedAt, verification: 'hotlist_discovery_only' };
}

function rowsFor(source: PublicHotlistSource, payload: any) {
  if (source === 'weibo_hot') return Array.isArray(payload?.data?.realtime) ? payload.data.realtime.slice(0, 50) : [];
  if (source === 'zhihu_hot') return Array.isArray(payload?.data) ? payload.data.slice(0, 50) : [];
  if (source === 'baidu_hot') {
    const cards = Array.isArray(payload?.data?.cards) ? payload.data.cards : [];
    const rows = cards.flatMap((card: any) => Array.isArray(card?.content) ? card.content.flatMap((group: any) => Array.isArray(group?.content) ? group.content : []) : []);
    return rows.slice(0, 50);
  }
  if (source === 'douyin_hot') return Array.isArray(payload?.data?.word_list) ? payload.data.word_list.slice(0, 50) : [];
  if (source === 'toutiao_hot') return Array.isArray(payload?.data) ? payload.data.slice(0, 50) : [];
  return Array.isArray(payload?.list) ? payload.list.slice(0, 50) : [];
}

function directMatchTerms(symbol: string, companyName: string) {
  const shortName = companyName.replace(/股份有限公司|有限责任公司|有限公司|股份/g, '').trim();
  return [...new Set([symbol, companyName, shortName].map((item) => cleanText(item, 80)).filter((item) => item.length >= 2))];
}

export function matchHotTopicsForStock(items: PublicHotTopic[], symbol: string, companyName: string) {
  const terms = directMatchTerms(symbol, companyName);
  return items.filter((item) => terms.some((term) => `${item.title} ${item.summary || ''}`.includes(term))).slice(0, 30);
}

// 只用于个股页的市场背景，不把泛娱乐热榜错误地包装成个股舆情。
const MARKET_CONTEXT_TERMS = /财经|金融|A股|股市|股票|证券|基金|上市公司|监管|证监|银行|黄金|金价|原油|铜|煤炭|电力|能源|芯片|半导体|人工智能|机器人|汽车|地产|房地产|医药|光伏|消费|电商|贸易|关税|政策|利率|汇率|稀土|财报|业绩|营收|利润|订单|融资|产能|供应链/i;

export function selectMarketContextHotTopics(items: PublicHotTopic[], limit = 8) {
  const perSource = new Set<PublicHotlistSource>();
  const selected: PublicHotTopic[] = [];
  const ranked = [...items]
    .filter((item) => MARKET_CONTEXT_TERMS.test(`${item.title} ${item.summary || ''}`))
    .sort((left, right) => (left.rank || 999) - (right.rank || 999));
  // 先保证来源多样性，再用剩余席位补足，避免一个平台占满背景区。
  for (const item of ranked) {
    if (!perSource.has(item.source)) {
      perSource.add(item.source);
      selected.push(item);
      if (selected.length >= limit) return selected;
    }
  }
  for (const item of ranked) {
    if (!selected.some((picked) => picked.topicId === item.topicId)) {
      selected.push(item);
      if (selected.length >= limit) break;
    }
  }
  return selected;
}

export function createPublicHotlistClient(options: Options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = Math.max(1_000, Number(options.timeoutMs) || 12_000);
  const cacheTtlMs = Math.max(0, Number(options.cacheTtlMs) || 15 * 60_000);
  const now = options.now || Date.now;
  let cache: { expiresAt: number; value: PublicHotlistSnapshot } | null = null;
  let inFlight: Promise<PublicHotlistSnapshot> | null = null;

  async function fetchSource(source: PublicHotlistSource) {
    const attemptedAt = new Date(now()).toISOString(); const startedAt = now(); const config = SOURCE_CONFIG[source];
    try {
      const response = await fetchImpl(config.url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', Referer: config.referer, Accept: 'application/json,text/plain,*/*' }, signal: AbortSignal.timeout(timeoutMs) });
      const rawText = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = JSON.parse(rawText);
      const observedAt = new Date(now()).toISOString();
      const items = rowsFor(source, payload).map((row: any, index: number) => normalizedTopic(source, row, observedAt, index)).filter(Boolean) as PublicHotTopic[];
      if (!items.length) throw new Error('未返回可解析热点');
      return { items, health: { source, status: 'healthy', itemCount: items.length, latencyMs: Math.max(0, now() - startedAt), lastAttemptAt: attemptedAt, lastSuccessAt: observedAt, lastError: null } satisfies SourceHealth };
    } catch (error: any) {
      return { items: [] as PublicHotTopic[], health: { source, status: 'degraded', itemCount: 0, latencyMs: Math.max(0, now() - startedAt), lastAttemptAt: attemptedAt, lastSuccessAt: null, lastError: cleanText(error?.message || '未知错误', 180) } satisfies SourceHealth };
    }
  }

  async function fetchAll(forceRefresh = false): Promise<PublicHotlistSnapshot> {
    if (forceRefresh) cache = null;
    if (cache && cache.expiresAt > now()) return { ...cache.value, sourceMeta: { ...cache.value.sourceMeta, freshness: 'cache' } };
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const sources = Object.keys(SOURCE_CONFIG) as PublicHotlistSource[];
      const results = await Promise.all(sources.map(fetchSource));
      const fetchedAt = new Date(now()).toISOString();
      const value: PublicHotlistSnapshot = { items: results.flatMap((result) => result.items), sourceHealth: results.map((result) => result.health), sourceMeta: { fetchedAt, freshness: 'live', version: 'public-hotlists-v1', discoveryOnly: true } };
      cache = { expiresAt: now() + cacheTtlMs, value };
      return value;
    })();
    try { return await inFlight; } finally { inFlight = null; }
  }

  return { fetchAll, clearCache: () => { cache = null; } };
}
