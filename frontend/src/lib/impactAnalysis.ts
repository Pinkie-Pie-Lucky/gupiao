import { ImpactAnalysis, ImpactEvidence, ImpactNode, MarketStory } from '../types';

const toImpactStoryType = (story: MarketStory): ImpactAnalysis['storyType'] => {
  if (story.type === 'geo_event') return 'geopolitical_event';
  if (story.type === 'price_anomaly') return 'commodity_anomaly';
  return 'sector_anomaly';
};

const conclusionLevel = (story: MarketStory): ImpactAnalysis['summary']['conclusionLevel'] => {
  if (story.evidencePack?.evidenceStatus === 'confirmed' && story.reasoning.confidenceLevel === 'high') return 'confirmed';
  if (story.reasoning.confidenceLevel === 'medium') return 'high_probability';
  if (story.evidencePack?.evidenceStatus === 'related') return 'possible';
  return 'unknown';
};

/**
 * 过渡适配器：新 Skill 上线前，只把现有结构化推理映射为影响树，
 * 不补造事实或具体的产业链关系。
 */
export function buildFallbackImpactAnalysis(story: MarketStory): ImpactAnalysis {
  const impactEvidence: ImpactEvidence[] = story.evidence.map((source) => ({
    id: source.id,
    category: source.kind === 'announcement' ? 'official_announcement' : source.kind === 'market_data' ? 'market' : source.kind === 'policy' ? 'macro' : 'news',
    statement: source.title,
    sourceName: source.sourceName,
    sourceUrl: source.url,
    publishedAt: source.publishedAt,
    role: 'supports',
    reliability: source.kind === 'announcement' || source.kind === 'policy' ? 'primary' : source.kind === 'market_data' ? 'authoritative' : 'secondary',
  }));
  const trigger: ImpactNode = {
    id: 'trigger',
    type: 'event',
    title: story.title,
    explanation: story.what,
    knowledgeType: 'fact',
    confidence: story.reasoning.confidenceLevel === 'high' ? 85 : story.reasoning.confidenceLevel === 'medium' ? 65 : 35,
    evidenceIds: story.evidenceIds,
  };
  const nodes: ImpactNode[] = [trigger];
  const edges: ImpactAnalysis['edges'] = [];
  let lastId = trigger.id;
  const append = (node: ImpactNode, relation: ImpactAnalysis['edges'][number]['relation']) => {
    nodes.push(node);
    edges.push({ from: lastId, to: node.id, relation, explanation: node.explanation, timeHorizon: 'short_term' });
    lastId = node.id;
  };

  story.reasoning.changedVariables.slice(0, 2).forEach((text, index) => append({
    id: `variable-${index}`,
    type: 'changed_variable',
    title: text,
    explanation: '已观测到的关键变化。',
    knowledgeType: 'fact',
    evidenceIds: story.evidenceIds,
  }, 'raises'));

  const mechanisms = story.reasoning.mechanism.length
    ? story.reasoning.mechanism.slice(0, 2)
    : ['暂未找到可验证的直接驱动，以下影响仅作为待核验路径。'];
  mechanisms.forEach((text, index) => append({
    id: `mechanism-${index}`,
    type: 'mechanism',
    title: text,
    explanation: story.reasoning.mechanism.length ? '基于已知机制的传导解释。' : '缺少直接驱动证据，不能视为已确认原因。',
    knowledgeType: story.reasoning.mechanism.length ? 'inference' : 'hypothesis',
    direction: story.reasoning.mechanism.length ? 'mixed' : 'uncertain',
  }, 'may_lead_to'));

  story.relatedSectors.slice(0, 3).forEach((sector, index) => {
    const node: ImpactNode = {
      id: `sector-${index}`,
      type: 'sector',
      title: sector,
      explanation: '关联板块，仍需用产业链数据确认实际受益或承压方向。',
      knowledgeType: 'hypothesis',
      direction: 'uncertain',
    };
    nodes.push(node);
    edges.push({ from: lastId, to: node.id, relation: 'may_lead_to', explanation: node.explanation, timeHorizon: 'short_term' });
  });

  story.reasoning.marketValidation.slice(0, 2).forEach((text, index) => {
    nodes.push({
      id: `validation-${index}`,
      type: 'market_validation',
      title: text,
      explanation: '这是市场验证，不等同于驱动原因。',
      knowledgeType: 'fact',
      evidenceIds: story.evidenceIds,
    });
  });

  const gaps = [...new Set([
    ...(story.evidencePack?.dataGaps || []),
    ...(story.reasoning.counterEvidence || []),
    story.reasoning.uncertainty,
  ])].filter(Boolean).slice(0, 4);

  return {
    id: `impact-${story.storyId}`,
    storyType: toImpactStoryType(story),
    reasoningMode: story.type === 'geo_event' ? 'forward' : 'reverse_then_forward',
    title: story.title,
    trigger,
    summary: {
      eventFact: story.what,
      coreMechanism: mechanisms[0],
      keyImpacts: story.relatedSectors.slice(0, 3),
      conclusionLevel: conclusionLevel(story),
    },
    nodes,
    edges,
    evidence: impactEvidence,
    counterEvidence: [],
    missingEvidence: gaps,
    observationIndicators: [...new Set([
      ...story.reasoning.observationIndicators,
      ...story.professional.observationIndicators,
    ])].slice(0, 4),
    version: 'impact-path-v1',
  };
}
