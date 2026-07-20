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
