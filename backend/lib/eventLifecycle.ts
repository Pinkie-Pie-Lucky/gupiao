import { createHash } from 'node:crypto';

export type EventLifecycleState = 'rumor' | 'announced' | 'executing' | 'verified' | 'weakened' | 'invalidated';
export type FactStatus = 'official_verified' | 'credible_media_only' | 'community_unverified' | 'officially_clarified' | 'disputed';
export type EventRelationType = 'origin' | 'media_report' | 'official_confirmation' | 'official_clarification' | 'regulatory_response' | 'follow_up';

export type EventLifecycleCandidate = {
  nodeId: string;
  evidenceId: string;
  title: string;
  summary?: string;
  source: string;
  sourceUrl?: string | null;
  publishedAt: string | null;
  category: string;
  direction: string;
  verification: string;
  contentType?: string;
};

export type EventFactChain = {
  chainId: string;
  symbol: string;
  topicKey: string;
  category: string;
  headline: string;
  lifecycleState: EventLifecycleState;
  factStatus: FactStatus;
  firstPublishedAt: string | null;
  lastPublishedAt: string | null;
  officialNodeId: string | null;
  clarificationNodeId: string | null;
  sourceCount: number;
  nodeCount: number;
  propagation: { mediaReportCount: number; communityRumorCount: number; officialCount: number; sameSourceRepeatCount: number };
  nodeIds: string[];
  updatedAt: string;
};

export type EventFactNode = EventLifecycleCandidate & {
  chainId: string;
  parentNodeId: string | null;
  relationType: EventRelationType;
  role: 'official' | 'clarification' | 'regulatory' | 'media' | 'rumor' | 'follow_up';
  factStatus: FactStatus;
  lifecycleState: EventLifecycleState;
  superseded: boolean;
  linkConfidence: 'high' | 'medium' | 'limited';
};

function hash(value: string, length = 24) {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, length);
}

function itemTime(item: EventLifecycleCandidate) {
  const value = Date.parse(item.publishedAt || '');
  return Number.isFinite(value) ? value : 0;
}

function cleanTitle(value: string, companyName = '') {
  return String(value || '').toLowerCase().replaceAll(companyName.toLowerCase(), '').replace(/\d{6}/g, '').replace(/[^\p{Script=Han}a-z0-9]+/gu, '');
}

function titleTokens(value: string, companyName = '') {
  const normalized = cleanTitle(value, companyName);
  const chinese = normalized.replace(/[^\p{Script=Han}]/gu, '');
  const output = new Set<string>();
  for (let index = 0; index < chinese.length - 1; index += 1) output.add(chinese.slice(index, index + 2));
  for (const word of normalized.match(/[a-z][a-z0-9]{2,}/g) || []) output.add(word);
  return output;
}

function similarity(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const token of left) if (right.has(token)) overlap += 1;
  return overlap / (left.size + right.size - overlap);
}

function roleOf(item: EventLifecycleCandidate): EventFactNode['role'] {
  const text = `${item.title} ${item.summary || ''}`;
  if (item.category === 'clarification' || /澄清|辟谣|更正|不属实|否认/.test(text)) return 'clarification';
  if (item.category === 'regulatory' || /监管|处罚|问询|立案/.test(text)) return 'regulatory';
  if (item.verification === 'official_verified' || item.verification === 'official_document_only') return 'official';
  if (item.verification === 'community_unverified' || /传闻|网传|市场消息|爆料/.test(text)) return 'rumor';
  if (/进展|完成|实施|落地|执行/.test(text)) return 'follow_up';
  return 'media';
}

function relationFor(role: EventFactNode['role']): EventRelationType {
  if (role === 'clarification') return 'official_clarification';
  if (role === 'regulatory') return 'regulatory_response';
  if (role === 'official') return 'official_confirmation';
  if (role === 'rumor') return 'origin';
  if (role === 'follow_up') return 'follow_up';
  return 'media_report';
}

function initialState(role: EventFactNode['role']): EventLifecycleState {
  if (role === 'rumor') return 'rumor';
  if (role === 'follow_up') return 'executing';
  if (role === 'clarification') return 'invalidated';
  return 'announced';
}

function isOfficial(item: EventLifecycleCandidate) {
  return item.verification === 'official_verified' || item.verification === 'official_document_only';
}

function isExplicitInvalidation(item: EventLifecycleCandidate) {
  return /不属实|不存在|未发生|未签署|未中标|取消|终止|辟谣|虚假|澄清/.test(`${item.title} ${item.summary || ''}`);
}

function chooseFactStatus(nodes: EventFactNode[]): FactStatus {
  if (nodes.some((node) => node.role === 'clarification' && isOfficial(node))) return 'officially_clarified';
  const officialDirections = new Set(nodes.filter((node) => isOfficial(node) && node.direction !== 'unknown').map((node) => node.direction));
  if (officialDirections.has('positive') && officialDirections.has('negative')) return 'disputed';
  if (nodes.some((node) => isOfficial(node))) return 'official_verified';
  if (nodes.some((node) => node.role === 'media')) return 'credible_media_only';
  return 'community_unverified';
}

function chooseLifecycleState(nodes: EventFactNode[]): EventLifecycleState {
  const clarification = nodes.filter((node) => node.role === 'clarification' && isOfficial(node));
  if (clarification.some(isExplicitInvalidation)) return 'invalidated';
  if (nodes.some((node) => node.role === 'follow_up' && isOfficial(node))) return 'verified';
  if (nodes.some((node) => node.role === 'follow_up')) return 'executing';
  if (nodes.some((node) => isOfficial(node))) return 'announced';
  return 'rumor';
}

function compatible(candidate: EventLifecycleCandidate, draft: { category: string; lastAt: number; tokens: Set<string>; nodes: EventFactNode[] }, companyName: string) {
  const role = roleOf(candidate);
  const candidateTokens = titleTokens(`${candidate.title} ${candidate.summary || ''}`, companyName);
  const age = Math.abs(itemTime(candidate) - draft.lastAt);
  if (age > 30 * 24 * 60 * 60_000) return { matched: false, score: 0 };
  const score = similarity(candidateTokens, draft.tokens);
  const hasRumor = draft.nodes.some((node) => node.role === 'rumor' || node.verification === 'credible_media_only');
  if (role === 'clarification') return { matched: score >= 0.1 || (hasRumor && age <= 7 * 24 * 60 * 60_000), score };
  if (role === 'regulatory') return { matched: score >= 0.16, score };
  const sameCategory = candidate.category === draft.category && candidate.category !== 'other';
  return { matched: sameCategory ? score >= 0.18 : score >= 0.42, score };
}

export function buildEventLifecycle(candidates: EventLifecycleCandidate[], context: { symbol: string; companyName?: string; now?: string }) {
  const unique = new Map<string, EventLifecycleCandidate>();
  for (const candidate of candidates) if (candidate.nodeId && !unique.has(candidate.nodeId)) unique.set(candidate.nodeId, candidate);
  const ordered = [...unique.values()].sort((left, right) => itemTime(left) - itemTime(right));
  const drafts: Array<{ category: string; tokens: Set<string>; lastAt: number; nodes: EventFactNode[] }> = [];
  for (const candidate of ordered) {
    let chosen: { draft: typeof drafts[number]; score: number } | null = null;
    for (const draft of drafts) {
      const result = compatible(candidate, draft, context.companyName || '');
      if (result.matched && (!chosen || result.score > chosen.score)) chosen = { draft, score: result.score };
    }
    const role = roleOf(candidate);
    if (chosen) {
      const parent = chosen.draft.nodes.at(-1) || null;
      const node: EventFactNode = { ...candidate, chainId: '', parentNodeId: parent?.nodeId || null, relationType: relationFor(role), role, factStatus: 'community_unverified', lifecycleState: initialState(role), superseded: false, linkConfidence: chosen.score >= 0.35 ? 'high' : chosen.score >= 0.18 ? 'medium' : 'limited' };
      chosen.draft.nodes.push(node);
      chosen.draft.lastAt = Math.max(chosen.draft.lastAt, itemTime(candidate));
      for (const token of titleTokens(`${candidate.title} ${candidate.summary || ''}`, context.companyName || '')) chosen.draft.tokens.add(token);
    } else {
      const node: EventFactNode = { ...candidate, chainId: '', parentNodeId: null, relationType: 'origin', role, factStatus: 'community_unverified', lifecycleState: initialState(role), superseded: false, linkConfidence: 'high' };
      drafts.push({ category: candidate.category, tokens: titleTokens(`${candidate.title} ${candidate.summary || ''}`, context.companyName || ''), lastAt: itemTime(candidate), nodes: [node] });
    }
  }
  const updatedAt = context.now || new Date().toISOString();
  const chains: EventFactChain[] = [];
  const nodes: EventFactNode[] = [];
  for (const draft of drafts) {
    const first = draft.nodes[0];
    const chainId = `event_chain:${context.symbol}:${hash(`${context.symbol}|${draft.category}|${first.nodeId}`)}`;
    const lifecycleState = chooseLifecycleState(draft.nodes);
    const factStatus = chooseFactStatus(draft.nodes);
    const clarification = draft.nodes.find((node) => node.role === 'clarification' && isOfficial(node)) || null;
    const official = draft.nodes.find((node) => isOfficial(node) && node.role !== 'clarification') || null;
    const sources = new Set(draft.nodes.map((node) => node.source).filter(Boolean));
    const repeats = draft.nodes.length - sources.size;
    for (const node of draft.nodes) {
      node.chainId = chainId;
      node.factStatus = factStatus;
      node.lifecycleState = lifecycleState;
      node.superseded = lifecycleState === 'invalidated' && node.role !== 'clarification';
    }
    chains.push({
      chainId, symbol: context.symbol, topicKey: [...draft.tokens].sort().slice(0, 12).join('|') || draft.category,
      category: draft.category, headline: clarification?.title || official?.title || first.title,
      lifecycleState, factStatus, firstPublishedAt: first.publishedAt,
      lastPublishedAt: draft.nodes.at(-1)?.publishedAt || null, officialNodeId: official?.nodeId || null,
      clarificationNodeId: clarification?.nodeId || null, sourceCount: sources.size, nodeCount: draft.nodes.length,
      propagation: { mediaReportCount: draft.nodes.filter((node) => node.role === 'media').length, communityRumorCount: draft.nodes.filter((node) => node.role === 'rumor').length, officialCount: draft.nodes.filter(isOfficial).length, sameSourceRepeatCount: Math.max(0, repeats) },
      nodeIds: draft.nodes.map((node) => node.nodeId), updatedAt,
    });
    nodes.push(...draft.nodes);
  }
  return { chains: chains.sort((left, right) => String(right.lastPublishedAt || '').localeCompare(String(left.lastPublishedAt || ''))), nodes };
}
