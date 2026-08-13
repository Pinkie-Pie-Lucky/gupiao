export type Direction = 'bullish' | 'lean_bullish' | 'neutral' | 'lean_bearish' | 'bearish' | 'unknown';
export type HoldAssessment = 'hold' | 'conditional_hold' | 'observe' | 'avoid' | 'unknown';

export interface HorizonView {
  direction: Direction;
  holdAssessment: HoldAssessment;
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

function buildView(score: number, available: boolean, riskDecision: string, evidenceIds: string[], rationale: string[], invalidationConditions: string[], evidenceCount: number, dataGapCount: number): HorizonView {
  const direction = directionFor(score, available, riskDecision);
  const confidence = direction === 'unknown' ? Math.min(40, 20 + evidenceCount * 2) : Math.max(20, Math.min(90, 45 + evidenceCount * 3 - dataGapCount * 7 - (riskDecision === 'downgrade' ? 10 : 0)));
  return { direction, holdAssessment: holdFor(direction, riskDecision), confidence, rationale: rationale.slice(0, 4), evidenceIds, invalidationConditions: invalidationConditions.slice(0, 4) };
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
  return { direction: overall.direction, holdAssessment: overall.holdAssessment, riskLevel: snapshot?.riskLevel || risk.riskLevel || 'unavailable', confidence: overall.confidence, rationale: overall.rationale, evidenceIds: overall.evidenceIds, invalidationConditions: overall.invalidationConditions, horizons: { short, medium, long } };
}
