/**
 * 数据库仓储：接口 + 内存实现（无 PG 环境时回退 / 单测用）
 * 生产环境走 backend/lib/db/pgRepositories.ts（PostgreSQL 实现）。
 */

export interface UserRecord {
  id: string;
  phone: string;
  passwordHash: string;
  nickname: string;
  createdAt: string; // ISO
}

export interface PublicUser {
  id: string;
  phone: string;
  nickname: string;
}

export interface BlacklistEntry {
  jti: string;
  userId: string;
  expiresAt: string; // ISO
}

export interface FeedbackRecord {
  id: string;
  userId: string | null;
  contentType: string;
  contentId: string;
  promptVersion: string;
  rating: 'positive' | 'negative';
  reasons: string[];
  comment: string;
  createdAt: string; // ISO
}

export interface FeedbackStats {
  stats: Record<string, { positive: number; negative: number; total: number; reasons: Record<string, number> }>;
  total: number;
}

export interface WatchlistItem {
  symbol: string;   // 6 位数字证券代码
  name: string;
  addedAt: string;  // ISO
}

export interface WatchlistRepo {
  list(userId: string): Promise<WatchlistItem[]>;
  add(userId: string, item: { symbol: string; name: string }): Promise<void>;
  remove(userId: string, symbol: string): Promise<void>;
}

// ---- 内容落库（早报 / 市场动态 / 泡泡精选，全局数据，不区分用户） ----

export interface MorningReportRecord {
  marketDate: string;  // 'YYYY-MM-DD'
  payload: unknown;    // GET /api/morning-report 的完整响应
  createdAt: string;   // ISO
}

export interface MarketReportRecord {
  id: string;
  marketDate: string;  // 'YYYY-MM-DD'
  report: string;
  fallback: boolean;
  promptVersion: string;
  inputSnapshot: unknown; // 生成时使用的指数/板块输入快照
  createdAt: string;   // ISO
}

export interface BubbleSelectionRecord {
  id: string;
  marketDate: string;  // 'YYYY-MM-DD'
  payload: unknown;    // GET /api/bubble-selection 的完整响应
  promptVersion: string;
  fallback: boolean;
  createdAt: string;   // ISO
}

export interface MarketOverviewRecord {
  marketDate: string;  // 'YYYY-MM-DD'
  payload: unknown;    // GET /api/market-overview 的完整响应
  updatedAt: string;   // ISO
}

export interface SectorSnapshotRecord {
  marketDate: string;  // 'YYYY-MM-DD'
  payload: unknown;    // { sectors, timestamp }
  updatedAt: string;   // ISO
}

export interface StockAgentOutputRecord {
  symbol: string;
  agent: string;       // 'cio-manager' | 'industry-chain' | ...
  payload: unknown;
  updatedAt: string;   // ISO
}

export interface ContentRepo {
  saveMorningReport(record: MorningReportRecord): Promise<void>;
  saveMarketReport(record: MarketReportRecord): Promise<void>;
  saveBubbleSelection(record: BubbleSelectionRecord): Promise<void>;
  saveMarketOverview(record: MarketOverviewRecord): Promise<void>;
  saveSectorSnapshot(record: SectorSnapshotRecord): Promise<void>;
  saveStockAgentOutput(record: StockAgentOutputRecord): Promise<void>;
  /** 读取当日早报（无则返回 null） */
  getMorningReport(marketDate: string): Promise<MorningReportRecord | null>;
  /** 读取当日最新一条泡泡精选（无则返回 null） */
  getBubbleSelection(marketDate: string): Promise<BubbleSelectionRecord | null>;
  /** 读取当日市场概览（无则返回 null） */
  getMarketOverview(marketDate: string): Promise<MarketOverviewRecord | null>;
  /** 读取当日领涨领跌板块快照（无则返回 null） */
  getSectorSnapshot(marketDate: string): Promise<SectorSnapshotRecord | null>;
  /** 读取指定个股的 Agent 输出（无则返回 null） */
  getStockAgentOutput(symbol: string, agent: string): Promise<StockAgentOutputRecord | null>;
}

// ---- AI 泡泡聊天记录（按 session 隔离，登录时关联 user_id） ----

export interface ChatMessageRecord {
  id: string;
  userId: string | null;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;   // ISO
}

export interface ChatRepo {
  addMessage(record: ChatMessageRecord): Promise<void>;
}

export interface UserRepo {
  create(user: UserRecord): Promise<UserRecord>;
  findByPhone(phone: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  updateNickname(id: string, nickname: string): Promise<UserRecord | null>;
}

export interface BlacklistRepo {
  add(entry: BlacklistEntry): Promise<void>;
  has(jti: string): Promise<boolean>;
  /** 清理已过期条目（可选实现） */
  sweep?(): Promise<void>;
}

export interface FeedbackRepo {
  create(record: FeedbackRecord): Promise<void>;
  /** 统计：按 prompt_version 聚合 positive/negative/total/reasons */
  stats(): Promise<FeedbackStats>;
}

export function toPublicUser(user: UserRecord): PublicUser {
  return { id: user.id, phone: user.phone, nickname: user.nickname };
}
