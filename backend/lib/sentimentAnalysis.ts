import { createHash } from 'node:crypto';
import type { SentimentRawItem } from './sentimentRaw.js';

export type SentimentStance = 'positive' | 'negative' | 'neutral' | 'mixed' | 'unavailable';

export type SentimentEventCluster = {
  clusterId: string;
  symbol: string;
  category: string;
  representativeTitle: string;
  representativeContentId: string;
  startedAt: string | null;
  endedAt: string | null;
  itemCount: number;
  sourceCount: number;
  sourceBreakdown: Record<string, number>;
  stanceMetrics: ReturnType<typeof calculateViewpointDisagreement>;
  verification: string;
  itemIds: string[];
  updatedAt: string;
};

const POSITIVE_TERMS = ['增长', '上升', '增加', '扭亏', '中标', '签约', '回购', '增持', '获批', '突破', '创新高', '超预期', '盈利', '改善', '利好', '上调', '领先'];
const NEGATIVE_TERMS = ['下降', '下滑', '减少', '亏损', '减持', '处罚', '立案', '诉讼', '违约', '终止', '暴跌', '下跌', '跌', '风险', '质疑', '低于预期', '净流出', '调低', '警示'];
const NEGATIONS = ['未', '没有', '并非', '不再', '否认'];

function hash(value: string, length = 24) {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, length);
}

function termScore(text: string, terms: string[]) {
  return terms.reduce((score, term) => {
    let index = text.indexOf(term);
    let total = score;
    while (index >= 0) {
      const prefix = text.slice(Math.max(0, index - 3), index);
      total += NEGATIONS.some((negation) => prefix.includes(negation)) ? -1 : 1;
      index = text.indexOf(term, index + term.length);
    }
    return total;
  }, 0);
}

export function classifySentimentStance(item: Pick<SentimentRawItem, 'title' | 'summary'>): SentimentStance {
  const corpus = `${item.title} ${item.summary.slice(0, 800)}`;
  const positive = termScore(corpus, POSITIVE_TERMS);
  const negative = termScore(corpus, NEGATIVE_TERMS);
  if (positive > 0 && negative > 0) return 'mixed';
  if (positive > 0) return 'positive';
  if (negative > 0) return 'negative';
  return 'neutral';
}

function eventCategory(item: SentimentRawItem) {
  const corpus = `${item.title} ${item.summary.slice(0, 300)}`;
  if (/业绩|营收|净利润|财报|年报|半年报|季报|预告/.test(corpus)) return 'earnings';
  if (/中标|订单|合同|签约|项目/.test(corpus)) return 'order';
  if (/监管|处罚|立案|问询|警示|调查/.test(corpus)) return 'regulatory';
  if (/诉讼|仲裁|纠纷|判决/.test(corpus)) return 'litigation';
  if (/融资|定增|可转债|回购|增持|减持|质押/.test(corpus)) return 'capital';
  if (/产品|发布|模型|平台|技术|研发/.test(corpus)) return 'product';
  if (/政策|规划|补贴|办法|条例|意见/.test(corpus)) return 'policy';
  if (/涨|跌|成交额|资金流入|资金流出|换手率/.test(corpus)) return 'market_move';
  if (item.contentType === 'announcement') return 'announcement';
  return 'other';
}

function tokens(value: string, companyName = '') {
  const cleaned = value.toLowerCase().replaceAll(companyName.toLowerCase(), '').replace(/\d{6}/g, '').replace(/[^\p{Script=Han}a-z0-9]+/gu, '');
  const result = new Set<string>();
  const chinese = cleaned.replace(/[^\p{Script=Han}]/gu, '');
  for (let index = 0; index < chinese.length - 1; index += 1) result.add(chinese.slice(index, index + 2));
  for (const word of cleaned.match(/[a-z][a-z0-9]{2,}/g) || []) result.add(word);
  return result;
}

function jaccard(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function timeOf(item: SentimentRawItem) {
  const parsed = Date.parse(item.publishedAt || item.fetchedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function verificationFor(items: SentimentRawItem[]) {
  if (items.some((item) => item.verification === 'official_document_only')) return 'official_document_only';
  if (items.some((item) => item.verification === 'credible_media_only')) return 'credible_media_only';
  return 'community_unverified';
}

type ViewpointItem = SentimentRawItem & { stance?: SentimentStance };

function viewpointSlice(items: ViewpointItem[], layer: 'all' | 'media' | 'community') {
  return items.filter((item) => {
    if (item.contentType === 'announcement') return false;
    if (layer === 'community') return item.platform === 'zhihu' || item.platform === 'xueqiu_community';
    if (layer === 'media') return item.platform !== 'zhihu' && item.platform !== 'xueqiu_community';
    return true;
  });
}

function disagreementFor(items: ViewpointItem[]) {
  const counts = { positive: 0, negative: 0, neutral: 0, mixed: 0 };
  const weighted = { positive: 0, negative: 0, neutral: 0, mixed: 0 };
  for (const item of items) {
    const stance = item.stance || classifySentimentStance(item);
    if (stance === 'unavailable') continue;
    counts[stance] += 1;
    const engagement = item.engagement || {};
    const interactions = Number(engagement.likes || 0) + Number(engagement.comments || 0) + Number(engagement.shares || 0);
    const sourceWeight = item.platform === 'eastmoney_mx' ? 1.2 : 1;
    weighted[stance] += sourceWeight * (1 + Math.min(0.5, Math.log1p(Math.max(0, interactions)) / 20));
  }
  const totalWeight = Object.values(weighted).reduce((sum, value) => sum + value, 0);
  const shares = Object.fromEntries(Object.entries(weighted).map(([key, value]) => [key, totalWeight ? value / totalWeight : 0])) as Record<keyof typeof weighted, number>;
  const directionalPositive = weighted.positive + weighted.mixed / 2;
  const directionalNegative = weighted.negative + weighted.mixed / 2;
  const directionalWeight = directionalPositive + directionalNegative;
  const directionalShares = { positive: directionalWeight ? directionalPositive / directionalWeight : 0, negative: directionalWeight ? directionalNegative / directionalWeight : 0 };
  const entropyParts = [directionalShares.positive, directionalShares.negative].filter((value) => value > 0);
  const entropy = entropyParts.length > 1 ? -entropyParts.reduce((sum, value) => sum + value * Math.log(value), 0) / Math.log(2) : 0;
  const directionalSampleCount = counts.positive + counts.negative + counts.mixed;
  const evaluable = directionalSampleCount >= 3;
  const minorityShare = Math.min(directionalShares.positive, directionalShares.negative);
  const level = !evaluable ? 'unavailable' : minorityShare >= 0.3 || entropy >= 0.88 ? 'high' : minorityShare >= 0.15 || entropy >= 0.55 ? 'medium' : 'low';
  const dominant = !totalWeight ? 'unavailable' : (Object.entries(shares).sort((left, right) => right[1] - left[1])[0]?.[0] || 'unavailable');
  return { level, sampleCount: items.length, directionalSampleCount, stanceCoverage: items.length ? directionalSampleCount / items.length : 0, counts, weightedShares: shares, directionalShares, entropy, dominantStance: dominant, confidence: directionalSampleCount >= 10 ? 'medium' : directionalSampleCount >= 3 ? 'limited' : 'insufficient' };
}

export function calculateViewpointDisagreement(items: ViewpointItem[]) {
  const enriched = items.map((item) => ({ ...item, stance: item.stance || classifySentimentStance(item) }));
  return {
    overall: disagreementFor(viewpointSlice(enriched, 'all')),
    media: disagreementFor(viewpointSlice(enriched, 'media')),
    community: disagreementFor(viewpointSlice(enriched, 'community')),
    method: 'deterministic_lexicon_weighted_v1',
  };
}

export function clusterSentimentItems(items: SentimentRawItem[], context: { symbol: string; companyName?: string; now?: string }) {
  const ordered = [...items].sort((left, right) => timeOf(left) - timeOf(right));
  const drafts: Array<{ category: string; items: SentimentRawItem[]; tokens: Set<string>; lastAt: number }> = [];
  for (const item of ordered) {
    const category = eventCategory(item);
    const itemTokens = tokens(item.title, context.companyName || '');
    const itemAt = timeOf(item);
    let best: { draft: typeof drafts[number]; score: number } | null = null;
    for (const draft of drafts) {
      const maxWindow = category === 'market_move' ? 36 * 60 * 60_000 : 7 * 24 * 60 * 60_000;
      if (Math.abs(itemAt - draft.lastAt) > maxWindow) continue;
      const similarity = jaccard(itemTokens, draft.tokens);
      const categoryCompatible = category === draft.category && category !== 'other';
      const threshold = categoryCompatible ? 0.18 : 0.42;
      if (similarity >= threshold && (!best || similarity > best.score)) best = { draft, score: similarity };
    }
    if (best) {
      best.draft.items.push(item);
      best.draft.lastAt = Math.max(best.draft.lastAt, itemAt);
      for (const token of itemTokens) best.draft.tokens.add(token);
    } else {
      drafts.push({ category, items: [item], tokens: itemTokens, lastAt: itemAt });
    }
  }

  const updatedAt = context.now || new Date().toISOString();
  const clusters: SentimentEventCluster[] = drafts.map((draft) => {
    const representative = [...draft.items].sort((left, right) => {
      const quality = (item: SentimentRawItem) => item.verification === 'official_document_only' ? 3 : item.verification === 'credible_media_only' ? 2 : 1;
      return quality(right) - quality(left) || right.title.length - left.title.length;
    })[0];
    const times = draft.items.map(timeOf).filter(Boolean).sort((a, b) => a - b);
    const sourceBreakdown = draft.items.reduce<Record<string, number>>((counts, item) => ({ ...counts, [item.platform]: (counts[item.platform] || 0) + 1 }), {});
    return {
      clusterId: `sentiment_cluster:${context.symbol}:${hash(`${context.symbol}|${draft.category}|${draft.items[0].contentId}`)}`,
      symbol: context.symbol,
      category: draft.category,
      representativeTitle: representative.title,
      representativeContentId: representative.contentId,
      startedAt: times.length ? new Date(times[0]).toISOString() : null,
      endedAt: times.length ? new Date(times.at(-1)!).toISOString() : null,
      itemCount: draft.items.length,
      sourceCount: Object.keys(sourceBreakdown).length,
      sourceBreakdown,
      stanceMetrics: calculateViewpointDisagreement(draft.items),
      verification: verificationFor(draft.items),
      itemIds: draft.items.map((item) => item.contentId),
      updatedAt,
    };
  }).sort((left, right) => String(right.endedAt || '').localeCompare(String(left.endedAt || '')));
  const clusterByItem = new Map(clusters.flatMap((cluster) => cluster.itemIds.map((itemId) => [itemId, cluster.clusterId] as const)));
  return { items: items.map((item) => ({ ...item, clusterId: clusterByItem.get(item.contentId) || null, stance: classifySentimentStance(item) })), clusters, viewpoint: calculateViewpointDisagreement(items) };
}
