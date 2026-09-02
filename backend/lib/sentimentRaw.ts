import { createHash } from 'node:crypto';

export type SentimentPlatform = 'eastmoney_mx' | 'zhihu' | 'xueqiu_community';
export type SentimentContentType = 'announcement' | 'news' | 'report' | 'policy' | 'community_post' | 'other';

export type SentimentRawItem = {
  contentId: string;
  platform: SentimentPlatform;
  contentType: SentimentContentType;
  title: string;
  summary: string;
  originalUrl: string | null;
  publishedAt: string | null;
  fetchedAt: string;
  authorIdHash: string | null;
  engagement: { likes?: number | null; comments?: number | null; shares?: number | null } | null;
  relatedSymbols: string[];
  entityMatchScore: number;
  sourceQuality: 'official_document' | 'financial_media' | 'community';
  verification: 'official_document_only' | 'credible_media_only' | 'community_unverified';
  contentHash: string;
  clusterId: string | null;
  evidenceId: string;
  requiresReview: boolean;
};

function text(value: unknown, maxLength = 4_000) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function hash(value: string, length = 24) {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, length);
}

function isoDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  const date = Number.isFinite(numeric) && numeric > 1_000_000_000
    ? new Date(numeric > 10_000_000_000 ? numeric : numeric * 1_000)
    : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeSymbol(value: unknown) {
  const matched = String(value || '').toUpperCase().match(/\b(\d{6})(?:\.(?:SH|SZ|BJ))?\b/);
  return matched?.[1] || null;
}

function collectSymbols(item: any) {
  const candidates = [item?.symbol, item?.stockCode, item?.securityCode, item?.secuCode, ...(Array.isArray(item?.secuList) ? item.secuList.flatMap((entry: any) => [entry?.secuCode, entry?.code, entry?.symbol]) : [])];
  return [...new Set(candidates.map(normalizeSymbol).filter(Boolean))] as string[];
}

function entityScore(symbol: string, companyName: string, title: string, summary: string, relatedSymbols: string[]) {
  if (relatedSymbols.includes(symbol)) return 1;
  const corpus = `${title} ${summary}`.toLowerCase();
  if (companyName && companyName.length >= 2 && corpus.includes(companyName.toLowerCase())) return 0.95;
  if (corpus.includes(symbol)) return 0.9;
  return 0.45;
}

function makeRawItem(input: Omit<SentimentRawItem, 'contentId' | 'contentHash' | 'clusterId' | 'evidenceId' | 'requiresReview'> & { externalId?: string }) {
  const { externalId, ...item } = input;
  const normalized = `${input.platform}|${input.originalUrl || ''}|${input.title}|${input.publishedAt || ''}`;
  const contentId = hash(externalId ? `${input.platform}|${externalId}` : normalized);
  const contentHash = hash(`${input.title.toLowerCase()}|${input.summary.toLowerCase().slice(0, 2_000)}`, 32);
  const symbol = input.relatedSymbols[0] || 'unknown';
  return {
    ...item,
    contentId,
    contentHash,
    clusterId: null,
    evidenceId: `sentiment_raw:${symbol}:${input.platform}:${contentId}`,
    requiresReview: input.entityMatchScore < 0.8,
  } satisfies SentimentRawItem;
}

function mxItems(payload: any): any[] {
  const items = payload?.data?.data?.llmSearchResponse?.data;
  return Array.isArray(items) ? items : [];
}

function mxType(value: unknown): SentimentContentType {
  const type = String(value || '').toUpperCase();
  if (/NOTICE|ANNOUNCEMENT/.test(type)) return 'announcement';
  if (/REPORT|RESEARCH/.test(type)) return 'report';
  if (/POLICY/.test(type)) return 'policy';
  if (/NEWS|ARTICLE/.test(type)) return 'news';
  return 'other';
}

export function normalizeMxSearchItems(payload: any, context: { symbol: string; companyName: string; fetchedAt: string }) {
  return mxItems(payload).map((item: any) => {
    const title = text(item?.title, 400);
    const summary = text(item?.content ?? item?.trunk ?? item?.summary, 4_000);
    const relatedSymbols = collectSymbols(item);
    if (!relatedSymbols.length) relatedSymbols.push(context.symbol);
    const score = entityScore(context.symbol, context.companyName, title, summary, collectSymbols(item));
    const contentType = mxType(item?.informationType ?? item?.infoType);
    return makeRawItem({
      externalId: text(item?.code ?? item?.id, 200),
      platform: 'eastmoney_mx',
      contentType,
      title,
      summary,
      originalUrl: text(item?.jumpUrl ?? item?.url, 2_000) || null,
      publishedAt: isoDate(item?.publishDate ?? item?.date),
      fetchedAt: context.fetchedAt,
      authorIdHash: item?.insName ? hash(String(item.insName)) : null,
      engagement: null,
      relatedSymbols,
      entityMatchScore: score,
      sourceQuality: contentType === 'announcement' ? 'official_document' : 'financial_media',
      verification: contentType === 'announcement' ? 'official_document_only' : 'credible_media_only',
    });
  }).filter((item: SentimentRawItem) => item.title || item.summary);
}

function zhihuItems(payload: any): any[] {
  const candidates = [payload?.Data?.Items, payload?.data?.items, payload?.data?.Items, payload?.Items, payload?.items, payload?.data];
  return candidates.find(Array.isArray) || [];
}

function nested(item: any, ...keys: string[]) {
  for (const key of keys) {
    const parts = key.split('.');
    let value = item;
    for (const part of parts) value = value?.[part];
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return null;
}

export function normalizeZhihuItems(payload: any, context: { symbol: string; companyName: string; fetchedAt: string }) {
  return zhihuItems(payload).map((item: any) => {
    const title = text(nested(item, 'Title', 'title', 'Question.Title', 'question.title', 'Content.Title', 'content.title'), 400);
    const summary = text(nested(item, 'Excerpt', 'excerpt', 'Summary', 'summary', 'Content', 'content', 'Description', 'description'), 4_000);
    const relatedSymbols = collectSymbols(item);
    if (!relatedSymbols.length) relatedSymbols.push(context.symbol);
    const score = entityScore(context.symbol, context.companyName, title, summary, collectSymbols(item));
    const author = nested(item, 'Author.Id', 'author.id', 'Author.Name', 'author.name', 'AuthorName', 'authorName');
    return makeRawItem({
      externalId: text(nested(item, 'Id', 'id', 'ContentId', 'contentId'), 200),
      platform: 'zhihu',
      contentType: 'community_post',
      title,
      summary,
      originalUrl: text(nested(item, 'Url', 'url', 'Link', 'link', 'TargetUrl', 'targetUrl'), 2_000) || null,
      publishedAt: isoDate(nested(item, 'PublishedAt', 'publishedAt', 'CreatedAt', 'createdAt', 'CreateTime', 'createTime')),
      fetchedAt: context.fetchedAt,
      authorIdHash: author ? hash(String(author)) : null,
      engagement: {
        likes: Number(nested(item, 'VoteupCount', 'voteupCount', 'LikeCount', 'likeCount')) || null,
        comments: Number(nested(item, 'CommentCount', 'commentCount')) || null,
        shares: Number(nested(item, 'ShareCount', 'shareCount')) || null,
      },
      relatedSymbols,
      entityMatchScore: score,
      sourceQuality: 'community',
      verification: 'community_unverified',
    });
  }).filter((item: SentimentRawItem) => item.title || item.summary);
}

function isXueqiuStockPage(url: string, symbol: string) {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)xueqiu\.com$/i.test(parsed.hostname)) return false;
    return new RegExp(`/S/(?:SZ|SH)${symbol}(?:/|$)`, 'i').test(parsed.pathname);
  } catch {
    return false;
  }
}

// 仅接收搜索引擎公开索引到的雪球个股页摘要。它们是社区线索，不能替代公告、
// 交易所披露或媒体原文，更不能直接转为事件 Agent 的事实输入。
export function normalizeXueqiuItems(payload: any, context: { symbol: string; companyName: string; fetchedAt: string }) {
  const candidates = Array.isArray(payload?.items) ? payload.items : [];
  return candidates.map((item: any) => {
    const title = text(item?.title, 400);
    const summary = text(item?.body ?? item?.summary ?? item?.description, 4_000);
    const originalUrl = text(item?.href ?? item?.url, 2_000) || null;
    if (!originalUrl || !isXueqiuStockPage(originalUrl, context.symbol)) return null;
    const relatedSymbols = [context.symbol];
    return makeRawItem({
      externalId: text(item?.id ?? item?.url, 300),
      platform: 'xueqiu_community',
      contentType: 'community_post',
      title,
      summary,
      originalUrl,
      publishedAt: isoDate(item?.date ?? item?.publishedAt),
      fetchedAt: context.fetchedAt,
      authorIdHash: null,
      engagement: null,
      relatedSymbols,
      entityMatchScore: entityScore(context.symbol, context.companyName, title, summary, relatedSymbols),
      sourceQuality: 'community',
      verification: 'community_unverified',
    });
  }).filter((item: SentimentRawItem | null): item is SentimentRawItem => Boolean(item?.title || item?.summary));
}

export function dedupeSentimentRawItems(items: SentimentRawItem[]) {
  const selected = new Map<string, SentimentRawItem>();
  for (const item of items) {
    const key = item.originalUrl || item.contentHash;
    const existing = selected.get(key);
    if (!existing || item.entityMatchScore > existing.entityMatchScore) selected.set(key, item);
  }
  return [...selected.values()].sort((left, right) => String(right.publishedAt || '').localeCompare(String(left.publishedAt || '')));
}
