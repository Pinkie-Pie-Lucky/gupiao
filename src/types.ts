/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface MarketIndex {
  name: string;
  code: string;
  value: number;
  changeValue: number;
  changePercent: number;
  history: Array<{ time: string; value: number; volume: number }>;
}

export interface StockSector {
  id: string;
  name: string;
  changePercent: number;
  color: string;
  description: string;
  stocks: StockItem[];
}

export interface StockItem {
  code: string;
  name: string;
  price: number;
  changePercent: number;
  volume: string;
  turnover: string;
  history: Array<{ time: string; value: number }>;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: Date;
  suggestedPrompts?: string[];
  attachedStock?: {
    name: string;
    code: string;
    price: number;
    changePercent: number;
  };
}

export interface PersonalizedAlert {
  id: string;
  title: string;
  content: string;
  sectorId: string;
  type: 'warning' | 'info' | 'success';
  time: string;
  fullAnalysis: string;
}

export interface UserProfile {
  name: string;
  avatar: string;
  riskTolerance: '稳健型' | '平衡型' | '进取型';
  followedSectors: string[];
  virtualBalance: number;
}

export type MarketStoryType = 'sector_driver' | 'price_anomaly' | 'company_event' | 'geo_event' | 'policy_driver' | 'macro_event';
export type EvidenceStatus = 'confirmed' | 'related' | 'market_only';
export type ReasoningStepKind = 'fact' | 'knowledge' | 'inference';
export type ConfidenceLevel = 'high' | 'medium' | 'limited';

export interface MarketSource {
  id: string;
  title: string;
  sourceName: string;
  publishedAt?: string;
  url?: string;
  kind: 'market_data' | 'news' | 'policy' | 'announcement';
}

export interface MarketMetric {
  label: string;
  value: string;
}

export interface StoryScore {
  total: number;
  importance: number;
  impactScope: number;
  infoIncrement: number;
  evidenceStrength: number;
}

export interface StorySelectionBasis {
  importance: 'high' | 'medium' | 'low';
  importanceReason: string;
  impactScope: '单板块' | '多板块联动' | '全市场' | '政策面' | '宏观';
  infoIncrement: string;
  evidenceStrength: 'strong' | 'medium' | 'weak';
}

export interface MarketStoryDraft {
  storyId: string;
  type: MarketStoryType;
  title: string;
  what: string;
  metrics: MarketMetric[];
  evidenceIds: string[];
  relatedSectors: string[];
  primaryCompany?: { name: string; symbol?: string };
  storyScore?: StoryScore;
  selectionBasis?: StorySelectionBasis;
  storyQualityScore?: number;
  whySelected?: string;
}

export interface ReasoningStep {
  id: string;
  text: string;
  evidenceIds: string[];
  kind: ReasoningStepKind;
  stepType?: 'event' | 'market' | 'mechanism';
  relationshipConfidence?: 'strong' | 'medium' | 'weak';
}

export interface ReasoningChain {
  storyId: string;
  steps: ReasoningStep[];
  facts: string[];
  changedVariables: string[];
  mechanism: string[];
  marketValidation: string[];
  observationIndicators: string[];
  uncertainty: string;
  confidenceLevel: ConfidenceLevel;
  validationStatus: 'passed' | 'limited' | 'rejected';
  beginnerSummary?: string;
  professionalSummary?: string;
  supportingEvidence?: string[];
  counterEvidence?: string[];
}

export interface TeacherStoryContent {
  storyId: string;
  summary: string;
  uncertaintyText: string;
  simpleChain?: string[];
}

export interface ProfessionalDriver {
  role: 'primary' | 'secondary' | 'diffusion';
  title: string;
  explanation: string;
  evidenceIds: string[];
}

export interface ProfessionalStoryContent {
  storyId: string;
  conclusion: string;
  drivers: ProfessionalDriver[];
  supportingEvidence: string[];
  evidenceGaps: string[];
  alternativeExplanations: string[];
  counterLogic: string[];
  observationIndicators: string[];
  confidence: {
    score: number;
    level: ConfidenceLevel;
    explanation: string;
  };
}

export interface MarketStory extends MarketStoryDraft {
  reasoning: ReasoningChain;
  teacher: TeacherStoryContent;
  professional: ProfessionalStoryContent;
  evidence: MarketSource[];
  evidencePack?: EventEvidencePack;
  /**
   * 新一代“事件影响路径”。保留 reasoning 以便通过功能开关随时回退。
   */
  impactAnalysis?: ImpactAnalysis;
}

export interface EventEvidencePack {
  storyId: string;
  storyType: MarketStoryType;
  evidenceStatus: EvidenceStatus;
  marketContext: {
    marketDate: string;
    indices: unknown[];
    totalTurnoverAmount: number;
    marketBreadth: { up: number; down: number; flat: number; breadthRatio: number };
  };
  sectorValidation: Array<{
    sectorName: string;
    sectorCode: string;
    todayChangePercent: number;
    change5d: number | null;
    change20d: number | null;
    turnoverChangePercent: number | null;
    upStockRatio: number | null;
    sampleSize: number;
    limitUpCount: number | null;
    leaderContribution: number | null;
    dispersion: number | null;
    leaders: Array<{ code: string; name: string; changePercent: number }>;
    dataStatus: 'available' | 'partial' | 'unavailable';
  }>;
  companyValidation?: {
    status: 'matched' | 'not_matched' | 'unavailable';
    name?: string;
    symbol?: string;
    changePercent?: number;
    eventCount?: number;
    officialAnnouncements: MarketSource[];
    officialEventMatched?: boolean;
  };
  sources: MarketSource[];
  dataGaps: string[];
}

export type ImpactStoryType = 'geopolitical_event' | 'commodity_anomaly' | 'sector_anomaly';
export type ImpactReasoningMode = 'forward' | 'reverse_then_forward';
export type ImpactNodeType =
  | 'event'
  | 'candidate_cause'
  | 'changed_variable'
  | 'mechanism'
  | 'commodity'
  | 'sector'
  | 'company'
  | 'market_validation'
  | 'counter_factor';
export type ImpactKnowledgeType = 'fact' | 'theory' | 'inference' | 'hypothesis';
export type ImpactDirection = 'positive' | 'negative' | 'mixed' | 'uncertain';

export interface ImpactNode {
  id: string;
  type: ImpactNodeType;
  title: string;
  explanation: string;
  knowledgeType: ImpactKnowledgeType;
  direction?: ImpactDirection;
  confidence?: number;
  evidenceIds?: string[];
}

export interface ImpactEdge {
  from: string;
  to: string;
  relation: 'causes' | 'raises' | 'reduces' | 'supports' | 'pressures' | 'offsets' | 'may_lead_to';
  explanation: string;
  timeHorizon?: 'immediate' | 'short_term' | 'medium_term';
  condition?: string;
}

export interface ImpactEvidence {
  id: string;
  category: 'news' | 'official_announcement' | 'market' | 'commodity' | 'macro' | 'industry' | 'company';
  statement: string;
  sourceName: string;
  sourceUrl?: string;
  publishedAt?: string;
  role: 'supports' | 'contradicts' | 'context';
  reliability: 'primary' | 'authoritative' | 'secondary';
}

export interface ImpactAnalysis {
  id: string;
  storyType: ImpactStoryType;
  reasoningMode: ImpactReasoningMode;
  title: string;
  trigger: ImpactNode;
  summary: {
    eventFact: string;
    coreMechanism: string;
    keyImpacts: string[];
    conclusionLevel: 'confirmed' | 'high_probability' | 'possible' | 'unknown';
  };
  nodes: ImpactNode[];
  edges: ImpactEdge[];
  evidence: ImpactEvidence[];
  counterEvidence: ImpactEvidence[];
  missingEvidence: string[];
  observationIndicators: string[];
  version: 'impact-path-v1';
}

export type BubbleSignalType = 'trend_start' | 'trend_continue' | 'leader_driven' | 'event_driven' | 'price_only';
export type BubbleHealthStatus = 'broad_rise' | 'leader_driven' | 'divergence';

export interface BubbleSignalItem {
  sectorName: string;
  bubbleScore: number;
  scoreBreakdown: {
    anomaly: number;
    health: number;
    capitalAttention: number;
    eventSupport: number;
  };
  todayChange: string;
  signalType: BubbleSignalType;
  healthStatus: BubbleHealthStatus;
  rankReason: string;
  metrics: {
    priceChange: string;
    upStockRatio: string;
    volumeChange: string;
  };
  supportingSignals: string[];
  riskSignals: string[];
  evidence: Array<{ id: string; title: string; sourceName: string }>;
  mergedSectors: string[];
  bubbleExplanation: string;
  confidence: ConfidenceLevel;
}

export interface BubbleSelectionResponse {
  bubbleSelection: BubbleSignalItem[];
  candidateCount: number;
  promptVersion: string;
  fallback: boolean;
  timestamp?: string;
}

export interface SectorIntelligence {
  sectorId: string;
  sector: string;
  category: 'industry' | 'concept';
  change: string;
  changePercent: number;
  turnoverAmount: number | null;
  turnoverChange: number | null;
  volumeChange: number | null;
  signalTags: string[];
  signalTypes: string[];
  isAnomaly: boolean;
  anomalyReason: string | null;
  analysisSource: string;
  evidenceStatus: string;
  importanceScore: number;
  shouldHighlight: boolean;
  beginnerExplanation: string;
  professionalSummary: string;
  relatedNews: Array<{ id: string; title: string; sourceName: string; url?: string }>;
  relatedChain: string[];
  dataNotes: string[];
}
