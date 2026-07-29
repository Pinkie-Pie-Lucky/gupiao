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

export type MarketStoryType = 'sector_driver' | 'geo_event' | 'policy_driver' | 'macro_event';
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

export interface MarketStoryDraft {
  storyId: string;
  type: MarketStoryType;
  title: string;
  what: string;
  metrics: MarketMetric[];
  evidenceIds: string[];
  relatedSectors: string[];
}

export interface ReasoningStep {
  id: string;
  text: string;
  evidenceIds: string[];
  kind: ReasoningStepKind;
}

export interface ReasoningChain {
  storyId: string;
  steps: ReasoningStep[];
  uncertainty: string;
  confidenceLevel: ConfidenceLevel;
  validationStatus: 'passed' | 'limited' | 'rejected';
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
}
