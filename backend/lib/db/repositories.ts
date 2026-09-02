/**
 * 数据库仓储：接口 + 内存实现（无 PG 环境时回退 / 单测用）
 * 生产环境走 backend/lib/db/pgRepositories.ts（PostgreSQL 实现）。
 */

export type UserRole = 'user' | 'admin';
export type UserStatus = 'active' | 'banned';
export type ClientPlatform = 'web' | 'app' | 'miniprogram';

export interface UserRecord {
  id: string;
  phone: string;
  passwordHash: string;
  nickname: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string; // ISO
}

export interface PublicUser {
  id: string;
  phone: string;
  nickname: string;
  role: UserRole;
  status: UserStatus;
}

export interface UserListQuery {
  search?: string;      // 昵称 / 手机号模糊匹配
  offset?: number;
  limit?: number;
}

export interface UserListResult {
  rows: Array<PublicUser & { createdAt: string }>;
  total: number;
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

// ---- 用户保存的条件选股（结果快照仅用于候选池变化追踪，不构成投资建议） ----
export interface SavedScreenerRecord {
  id: string;
  userId: string;
  name: string;
  query: string;
  enabled: boolean;
  lastRunAt: string | null;
  lastResult: unknown | null;
  lastDiff: unknown | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScreenerRepo {
  list(userId: string): Promise<SavedScreenerRecord[]>;
  create(record: SavedScreenerRecord): Promise<void>;
  remove(userId: string, id: string): Promise<void>;
  find(userId: string, id: string): Promise<SavedScreenerRecord | null>;
  listEnabled(limit: number): Promise<SavedScreenerRecord[]>;
  saveRun(userId: string, id: string, run: { lastRunAt: string; lastResult: unknown; lastDiff: unknown; updatedAt: string }): Promise<SavedScreenerRecord | null>;
}

export interface SentimentRawRecord {
  contentId: string;
  platform: string;
  contentType: string;
  title: string;
  summary: string;
  originalUrl: string | null;
  publishedAt: string | null;
  fetchedAt: string;
  authorIdHash: string | null;
  engagement: unknown;
  relatedSymbols: string[];
  entityMatchScore: number;
  sourceQuality: string;
  verification: string;
  contentHash: string;
  clusterId: string | null;
  evidenceId: string;
  requiresReview: boolean;
}

export interface SentimentSourceHealthRecord {
  source: string;
  status: string;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  metadata: unknown;
  updatedAt: string;
}

export interface SentimentClusterRecord {
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
  stanceMetrics: unknown;
  verification: string;
  itemIds: string[];
  updatedAt: string;
}

export interface EventFactChainRecord {
  chainId: string;
  symbol: string;
  topicKey: string;
  category: string;
  headline: string;
  lifecycleState: string;
  factStatus: string;
  firstPublishedAt: string | null;
  lastPublishedAt: string | null;
  officialNodeId: string | null;
  clarificationNodeId: string | null;
  sourceCount: number;
  nodeCount: number;
  propagation: unknown;
  updatedAt: string;
}

export interface EventFactNodeRecord {
  nodeId: string;
  chainId: string;
  symbol: string;
  evidenceId: string;
  title: string;
  summary: string;
  source: string;
  sourceUrl: string | null;
  publishedAt: string | null;
  category: string;
  direction: string;
  verification: string;
  role: string;
  parentNodeId: string | null;
  relationType: string;
  linkConfidence: string;
  superseded: boolean;
  updatedAt: string;
}

export interface SentimentRepo {
  saveRawItems(items: SentimentRawRecord[]): Promise<void>;
  listRawItems(symbol: string, since: string, limit?: number): Promise<SentimentRawRecord[]>;
  saveSourceHealth(records: SentimentSourceHealthRecord[]): Promise<void>;
  listSourceHealth(): Promise<SentimentSourceHealthRecord[]>;
  saveClusters(symbol: string, clusters: SentimentClusterRecord[]): Promise<void>;
  saveEventFactChains(chains: EventFactChainRecord[], nodes: EventFactNodeRecord[]): Promise<void>;
  listEventFactChains(symbol: string, since: string, limit?: number): Promise<{ chains: EventFactChainRecord[]; nodes: EventFactNodeRecord[] }>;
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
  /** 管理端：角色调整（白名单提权 / 手动降权） */
  updateRole(id: string, role: UserRole): Promise<UserRecord | null>;
  /** 管理端：封禁 / 解封；已发 token 因每次鉴权查库而即时失效 */
  updateStatus(id: string, status: UserStatus): Promise<UserRecord | null>;
  /** 管理端：用户列表（分页 + 搜索） */
  list(query?: UserListQuery): Promise<UserListResult>;
  /** 管理端：某时间点之后注册的用户数（新增注册统计） */
  countCreatedSince(since: Date): Promise<number>;
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
  return { id: user.id, phone: user.phone, nickname: user.nickname, role: user.role, status: user.status };
}

// ---------- 访问统计（管理端） ----------

export interface AccessEventRecord {
  id: string;
  userId: string | null;
  sessionKey: string;              // 前端 localStorage 匿名 UUID，UV 去重口径
  platform: ClientPlatform;        // web | app | miniprogram
  path: string;
  method: string;
  statusCode: number;
  referer: string | null;          // 来源
  utmSource: string | null;        // 渠道参数
  device: 'mobile' | 'tablet' | 'desktop';
  ipHash: string | null;           // HMAC-SHA256，不落明文 IP
  durationMs: number | null;       // pageview：页面停留毫秒数
  eventKind: 'api' | 'pageview';   // api=服务端中间件埋点；pageview=前端页面浏览上报（PV 口径）
  createdAt: string;               // ISO
}

export interface PeriodStats {
  pv: number;          // 页面浏览量（仅 event_kind='pageview'）
  uv: number;          // sessionKey 去重（含匿名，任何活动均计入）
  dau: number;         // 登录用户去重
  newUsers: number;    // 新增注册
}

export interface PlatformSessionDuration {
  platform: string;
  sessions: number;
  avgSessionDurationMs: number | null;
}

export interface SessionDurationStats {
  avgSessionDurationMs: number | null;   // 平均使用时长：按 session 汇总 pageview 时长后取均值
  byPlatform: PlatformSessionDuration[];
}

export interface AdminOverview {
  today: PeriodStats;
  recent7d: PeriodStats;
  recent30d: PeriodStats;
  /** 今日平均使用时长（按平台细分） */
  sessionDuration: SessionDurationStats;
}

export interface AdminPageStats {
  path: string;                 // 页面标识（TabId）
  views: number;                // 浏览次数
  avgDurationMs: number | null; // 平均停留时长
  totalDurationMs: number;      // 总停留时长
}

export interface AdminTraffic {
  daily: Array<{ date: string; pv: number; uv: number }>;
  referers: Array<{ referer: string; count: number }>;
  devices: Array<{ device: string; count: number }>;
  platforms: Array<{ platform: string; count: number }>;
}

export interface AccessStatsRepo {
  /** 埋点写入：失败只告警，不影响业务响应（fire-and-forget） */
  recordAccess(event: AccessEventRecord): Promise<void>;
  /** 时间段访问统计（PV 只算页面浏览 / UV / DAU）；newUsers 由 UserRepo.countCreatedSince 另行查询 */
  periodStats(since: Date): Promise<Omit<PeriodStats, 'newUsers'>>;
  /** 平均使用时长：按 session 汇总页面停留时长再取均值，含平台细分 */
  sessionDurations(since: Date): Promise<SessionDurationStats>;
  /** 页面浏览时长排行（近 N 天） */
  pageStats(days: number): Promise<AdminPageStats[]>;
  traffic(days: number): Promise<AdminTraffic>;
  /** 清理保留期（180 天）之前的明细，返回删除行数 */
  purgeBefore(date: Date): Promise<number>;
}
