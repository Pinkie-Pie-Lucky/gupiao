export type Direction = 'bullish' | 'lean_bullish' | 'neutral' | 'lean_bearish' | 'bearish' | 'unknown';
export type HoldAssessment = 'hold' | 'conditional_hold' | 'observe' | 'avoid' | 'unknown';
export type ResearchScoreBand = 'strong' | 'positive' | 'mixed' | 'cautious' | 'risk' | 'insufficient';

export interface HorizonView {
  direction: Direction;
  holdAssessment: HoldAssessment;
  /** 由确定性信号归一化得到，不受 AI 文本生成结果影响。 */
  researchScore: number | null;
  scoreBand: ResearchScoreBand;
  evidenceCoverage: number;
  confidence: number | null;
  rationale: string[];
  evidenceIds: string[];
  invalidationConditions: string[];
}

const positiveStatuses = new Set(['positive', 'stable', 'improving']);
const negativeStatuses = new Set(['negative', 'risk', 'deteriorating']);

function signalScore(items: any[] = []) {
  return items.reduce((score, item) => {
    const status = String(item?.status || item?.direction || '').toLowerCase();
    return score + (positiveStatuses.has(status) ? 1 : negativeStatuses.has(status) ? -1 : 0);
  }, 0);
}

function evidenceFrom(...items: any[]) {
  return [...new Set(items.flatMap((item) => Array.isArray(item) ? item.flatMap((entry: any) => entry?.evidenceIds || []) : item?.evidenceIds || []).map(String).filter(Boolean))].slice(0, 12);
}

function textFrom(...items: any[]) {
  return items.flatMap((item) => Array.isArray(item) ? item.map((entry: any) => entry?.summary || entry?.claim || entry?.description || entry?.text).filter(Boolean) : []).map(String).slice(0, 3);
}

function directionFor(score: number, available: boolean, riskDecision: string) : Direction {
  if (!available || riskDecision === 'blocked') return 'unknown';
  if (riskDecision === 'veto') return 'bearish';
  if (score >= 2.5) return 'bullish';
  if (score >= 1) return 'lean_bullish';
  if (score <= -2.5) return 'bearish';
  if (score <= -1) return 'lean_bearish';
  return 'neutral';
}

function holdFor(direction: Direction, riskDecision: string): HoldAssessment {
  if (riskDecision === 'blocked') return 'unknown';
  if (riskDecision === 'veto') return 'avoid';
  if (riskDecision === 'downgrade') return 'conditional_hold';
  if (direction === 'bullish' || direction === 'lean_bullish') return 'hold';
  if (direction === 'bearish') return 'avoid';
  if (direction === 'lean_bearish' || direction === 'neutral') return 'observe';
  return 'unknown';
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function evidenceCoverage(available: boolean, evidenceCount: number, dataGapCount: number) {
  if (!available) return 0;
  return Math.round(clamp(45 + Math.min(35, evidenceCount * 4) - Math.min(30, dataGapCount * 6), 0, 100));
}

function researchScoreFor(rawScore: number, available: boolean, riskDecision: string, coverage: number) {
  if (!available || coverage < 35) return null;
  // 50 是证据均衡时的中位，不用“看多/看空”替代风险与证据本身。
  let score = 50 + clamp(rawScore, -5, 5) * 8;
  // 证据越少，分数越靠近中位；避免少量输入产生过强结论。
  score = 50 + (score - 50) * (coverage / 100);
  if (riskDecision === 'veto') score = Math.min(score, 35);
  if (riskDecision === 'downgrade') score = Math.min(score, 49);
  return Math.round(clamp(score, 0, 100));
}

function scoreBandFor(score: number | null): ResearchScoreBand {
  if (score == null) return 'insufficient';
  if (score >= 66) return 'strong';
  if (score >= 56) return 'positive';
  if (score >= 45) return 'mixed';
  if (score >= 35) return 'cautious';
  return 'risk';
}

function buildView(score: number, available: boolean, riskDecision: string, evidenceIds: string[], rationale: string[], invalidationConditions: string[], evidenceCount: number, dataGapCount: number): HorizonView {
  const direction = directionFor(score, available, riskDecision);
  const coverage = evidenceCoverage(available, evidenceCount, dataGapCount);
  const researchScore = researchScoreFor(score, available, riskDecision, coverage);
  const confidence = direction === 'unknown' ? Math.min(40, 20 + evidenceCount * 2) : Math.max(20, Math.min(90, 45 + evidenceCount * 3 - dataGapCount * 7 - (riskDecision === 'downgrade' ? 10 : 0)));
  return { direction, holdAssessment: holdFor(direction, riskDecision), researchScore, scoreBand: scoreBandFor(researchScore), evidenceCoverage: coverage, confidence, rationale: rationale.slice(0, 4), evidenceIds, invalidationConditions: invalidationConditions.slice(0, 4) };
}

export function buildManagerStance(snapshot: any) {
  const outputs = snapshot?.agentOutputs || {};
  const fundamental = outputs.fundamental || {};
  const technical = outputs.technical || {};
  const events = outputs.events || {};
  const sentiment = outputs.sentiment || {};
  const valuation = outputs.valuation || {};
  const risk = outputs.risk || {};
  const riskDecision = String(snapshot?.riskDecision || risk.decision || 'blocked');
  const dataGapCount = Array.isArray(snapshot?.dataGaps) ? snapshot.dataGaps.length : 0;
  const evidenceCount = Array.isArray(snapshot?.evidenceIds) ? snapshot.evidenceIds.length : 0;
  const fundamentalScore = signalScore(fundamental.signals) + signalScore(fundamental.vetoes) * 1.5;
  const technicalScore = signalScore(technical.signals) + signalScore(technical.vetoes);
  const eventScore = signalScore(events.events);
  const sentimentScore = String(sentiment.tone).toLowerCase() === 'positive' ? 1 : String(sentiment.tone).toLowerCase() === 'negative' ? -1 : 0;
  const valuationScore = valuation.valuationStatus === 'available' || valuation.status === 'available' ? 0.5 : 0;
  const riskPenalty = riskDecision === 'veto' ? -4 : riskDecision === 'downgrade' ? -2 : riskDecision === 'watch' ? -1 : 0;
  const invalidation: string[] = [...new Set<string>((snapshot?.requiredConditions || [])
    .map((item: any) => item?.text || item?.claim || item?.description)
    .map((item: unknown) => String(item || '').trim())
    .filter(Boolean))];
  const allRationale = [...textFrom(fundamental.signals), ...textFrom(technical.signals), ...textFrom(events.events), ...textFrom(risk.vetoes, risk.risks)];
  const shortAvailable = Boolean(technical.signals || events.events || outputs.sentiment);
  const mediumAvailable = Boolean(outputs.fundamental || outputs.technical || outputs.events);
  const longAvailable = Boolean(outputs.fundamental || outputs.valuation);
  const short = buildView(technicalScore * 2 + eventScore + sentimentScore + riskPenalty, shortAvailable, riskDecision, evidenceFrom(technical.signals, events.events, risk.vetoes, risk.risks), [...textFrom(technical.signals), ...textFrom(events.events)], invalidation, evidenceCount, dataGapCount);
  const medium = buildView(fundamentalScore * 1.5 + technicalScore + eventScore * 0.75 + valuationScore + riskPenalty, mediumAvailable, riskDecision, evidenceFrom(fundamental.signals, technical.signals, events.events, valuation, risk.vetoes), [...textFrom(fundamental.signals), ...textFrom(technical.signals), ...textFrom(events.events)], invalidation, evidenceCount, dataGapCount);
  const long = buildView(fundamentalScore * 2 + valuationScore * 2 + eventScore * 0.25 + riskPenalty, longAvailable, riskDecision, evidenceFrom(fundamental.signals, valuation, risk.vetoes), [...textFrom(fundamental.signals), ...textFrom(valuation.comparison?.reason ? [{ summary: valuation.comparison.reason }] : []), ...allRationale], invalidation, evidenceCount, dataGapCount);
  const overall = medium.direction === 'unknown' ? medium : medium;
  return { direction: overall.direction, holdAssessment: overall.holdAssessment, researchScore: overall.researchScore, scoreBand: overall.scoreBand, evidenceCoverage: overall.evidenceCoverage, riskLevel: snapshot?.riskLevel || risk.riskLevel || 'unavailable', confidence: overall.confidence, rationale: overall.rationale, evidenceIds: overall.evidenceIds, invalidationConditions: overall.invalidationConditions, horizons: { short, medium, long } };
}
