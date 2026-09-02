/**
 * 内存仓储实现：无 PostgreSQL 环境时作为回退（本机未装 Docker/PG 时的开发模式），
 * 也用于认证/反馈业务逻辑的单测。
 */
import type {
  UserRepo, BlacklistRepo, FeedbackRepo, WatchlistRepo, ScreenerRepo,
  ContentRepo, ChatRepo,
  UserRecord, BlacklistEntry, FeedbackRecord, FeedbackStats, WatchlistItem,
  MorningReportRecord, MarketReportRecord, BubbleSelectionRecord, ChatMessageRecord,
  MarketOverviewRecord, SectorSnapshotRecord, StockAgentOutputRecord,
  SentimentRepo, SentimentRawRecord, SentimentSourceHealthRecord, SentimentClusterRecord,
  EventFactChainRecord, EventFactNodeRecord, SavedScreenerRecord,
  UserListQuery, UserListResult, AccessEventRecord, AccessStatsRepo, AdminTraffic,
} from './repositories.js';

/** 统一按上海时区（UTC+8，无夏令时）切自然日，与 PG 版 `AT TIME ZONE 'Asia/Shanghai'` 口径一致 */
export function shanghaiDateKey(iso: string): string {
  return new Date(Date.parse(iso) + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

export class InMemoryUserRepo implements UserRepo {
  private users = new Map<string, UserRecord>();

  async create(user: UserRecord): Promise<UserRecord> {
    this.users.set(user.id, user);
    return user;
  }

  async findByPhone(phone: string): Promise<UserRecord | null> {
    for (const user of this.users.values()) {
      if (user.phone === phone) return user;
    }
    return null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    return this.users.get(id) ?? null;
  }

  async updateNickname(id: string, nickname: string): Promise<UserRecord | null> {
    const user = this.users.get(id);
    if (!user) return null;
    const updated = { ...user, nickname };
    this.users.set(id, updated);
    return updated;
  }

  async updateRole(id: string, role: UserRecord['role']): Promise<UserRecord | null> {
    const user = this.users.get(id);
    if (!user) return null;
    const updated = { ...user, role };
    this.users.set(id, updated);
    return updated;
  }

  async updateStatus(id: string, status: UserRecord['status']): Promise<UserRecord | null> {
    const user = this.users.get(id);
    if (!user) return null;
    const updated = { ...user, status };
    this.users.set(id, updated);
    return updated;
  }

  async list(query: UserListQuery = {}): Promise<UserListResult> {
    const search = String(query.search || '').trim().toLowerCase();
    const all = [...this.users.values()]
      .filter((user) => !search || user.nickname.toLowerCase().includes(search) || user.phone.includes(search))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const offset = Math.max(0, Number(query.offset) || 0);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    return {
      rows: all.slice(offset, offset + limit).map((user) => ({
        id: user.id, phone: user.phone, nickname: user.nickname, role: user.role, status: user.status, createdAt: user.createdAt,
      })),
      total: all.length,
    };
  }

  async countCreatedSince(since: Date): Promise<number> {
    const boundary = since.getTime();
    let count = 0;
    for (const user of this.users.values()) {
      if (Date.parse(user.createdAt) >= boundary) count++;
    }
    return count;
  }
}

export class InMemoryBlacklistRepo implements BlacklistRepo {
  private entries = new Map<string, BlacklistEntry>();

  async add(entry: BlacklistEntry): Promise<void> {
    this.entries.set(entry.jti, entry);
  }

  async has(jti: string): Promise<boolean> {
    const entry = this.entries.get(jti);
    if (!entry) return false;
    return Date.parse(entry.expiresAt) > Date.now();
  }

  async sweep(): Promise<void> {
    const now = Date.now();
    for (const [jti, entry] of this.entries) {
      if (Date.parse(entry.expiresAt) <= now) this.entries.delete(jti);
    }
  }
}

export class InMemoryFeedbackRepo implements FeedbackRepo {
  private rows: FeedbackRecord[] = [];

  async create(record: FeedbackRecord): Promise<void> {
    this.rows.push(record);
  }

  async stats(): Promise<FeedbackStats> {
    const stats: FeedbackStats['stats'] = {};
    for (const entry of this.rows) {
      const pv = entry.promptVersion || 'unknown';
      if (!stats[pv]) stats[pv] = { positive: 0, negative: 0, total: 0, reasons: {} };
      stats[pv].total++;
      if (entry.rating === 'positive') stats[pv].positive++;
      if (entry.rating === 'negative') stats[pv].negative++;
      for (const r of entry.reasons) {
        stats[pv].reasons[r] = (stats[pv].reasons[r] || 0) + 1;
      }
    }
    return { stats, total: this.rows.length };
  }
}

export class InMemoryWatchlistRepo implements WatchlistRepo {
  private rows = new Map<string, Map<string, WatchlistItem>>(); // userId -> symbol -> item

  async list(userId: string): Promise<WatchlistItem[]> {
    const items = [...(this.rows.get(userId)?.values() ?? [])];
    return items.sort((a, b) => a.addedAt.localeCompare(b.addedAt));
  }

  async add(userId: string, item: { symbol: string; name: string }): Promise<void> {
    if (!this.rows.has(userId)) this.rows.set(userId, new Map());
    const map = this.rows.get(userId)!;
    if (!map.has(item.symbol)) {
      map.set(item.symbol, { ...item, addedAt: new Date().toISOString() });
    }
  }

  async remove(userId: string, symbol: string): Promise<void> {
    this.rows.get(userId)?.delete(symbol);
  }
}

export class InMemoryContentRepo implements ContentRepo {
  private morning = new Map<string, MorningReportRecord>();   // marketDate -> record
  private market: MarketReportRecord[] = [];
  private bubble: BubbleSelectionRecord[] = [];
  private overviews = new Map<string, MarketOverviewRecord>();
  private sectors = new Map<string, SectorSnapshotRecord>();
  private agents = new Map<string, StockAgentOutputRecord>();  // `${symbol}:${agent}` -> record

  async saveMorningReport(record: MorningReportRecord): Promise<void> {
    this.morning.set(record.marketDate, record);
  }

  async saveMarketReport(record: MarketReportRecord): Promise<void> {
    this.market.push(record);
  }

  async saveBubbleSelection(record: BubbleSelectionRecord): Promise<void> {
    this.bubble.push(record);
  }

  async saveMarketOverview(record: MarketOverviewRecord): Promise<void> {
    this.overviews.set(record.marketDate, record);
  }

  async saveSectorSnapshot(record: SectorSnapshotRecord): Promise<void> {
    this.sectors.set(record.marketDate, record);
  }

  async saveStockAgentOutput(record: StockAgentOutputRecord): Promise<void> {
    this.agents.set(`${record.symbol}:${record.agent}`, record);
  }

  async getMorningReport(marketDate: string): Promise<MorningReportRecord | null> {
    return this.morning.get(marketDate) ?? null;
  }

  async getBubbleSelection(marketDate: string): Promise<BubbleSelectionRecord | null> {
    const matches = this.bubble.filter((record) => record.marketDate === marketDate);
    if (!matches.length) return null;
    return matches.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  }

  async getMarketOverview(marketDate: string): Promise<MarketOverviewRecord | null> {
    return this.overviews.get(marketDate) ?? null;
  }

  async getSectorSnapshot(marketDate: string): Promise<SectorSnapshotRecord | null> {
    return this.sectors.get(marketDate) ?? null;
  }

  async getStockAgentOutput(symbol: string, agent: string): Promise<StockAgentOutputRecord | null> {
    return this.agents.get(`${symbol}:${agent}`) ?? null;
  }
}

export class InMemoryChatRepo implements ChatRepo {
  private rows: ChatMessageRecord[] = [];

  async addMessage(record: ChatMessageRecord): Promise<void> {
    this.rows.push(record);
  }
}

export class InMemoryScreenerRepo implements ScreenerRepo {
  private rows = new Map<string, SavedScreenerRecord>();

  async list(userId: string): Promise<SavedScreenerRecord[]> {
    return [...this.rows.values()].filter((row) => row.userId === userId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async create(record: SavedScreenerRecord): Promise<void> { this.rows.set(record.id, record); }

  async remove(userId: string, id: string): Promise<void> {
    const row = this.rows.get(id);
    if (row?.userId === userId) this.rows.delete(id);
  }

  async find(userId: string, id: string): Promise<SavedScreenerRecord | null> {
    const row = this.rows.get(id);
    return row?.userId === userId ? row : null;
  }

  async listEnabled(limit: number): Promise<SavedScreenerRecord[]> {
    return [...this.rows.values()].filter((row) => row.enabled).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).slice(0, limit);
  }

  async saveRun(userId: string, id: string, run: { lastRunAt: string; lastResult: unknown; lastDiff: unknown; updatedAt: string }): Promise<SavedScreenerRecord | null> {
    const current = await this.find(userId, id);
    if (!current) return null;
    const updated = { ...current, ...run };
    this.rows.set(id, updated);
    return updated;
  }
}

export class InMemorySentimentRepo implements SentimentRepo {
  private items = new Map<string, SentimentRawRecord>();
  private health = new Map<string, SentimentSourceHealthRecord>();
  private clusters = new Map<string, SentimentClusterRecord>();
  private memberships = new Map<string, string>();
  private eventChains = new Map<string, EventFactChainRecord>();
  private eventNodes = new Map<string, EventFactNodeRecord>();

  async saveRawItems(items: SentimentRawRecord[]): Promise<void> {
    for (const item of items) {
      const existing = this.items.get(item.contentId);
      this.items.set(item.contentId, { ...existing, ...item, relatedSymbols: [...new Set([...(existing?.relatedSymbols || []), ...item.relatedSymbols])] });
    }
  }

  async listRawItems(symbol: string, since: string, limit = 500): Promise<SentimentRawRecord[]> {
    const sinceMs = Date.parse(since);
    return [...this.items.values()]
      .filter((item) => item.relatedSymbols.includes(symbol) && (!item.publishedAt || Date.parse(item.publishedAt) >= sinceMs))
      .sort((left, right) => String(right.publishedAt || right.fetchedAt).localeCompare(String(left.publishedAt || left.fetchedAt)))
      .slice(0, limit)
      .map((item) => ({ ...item, clusterId: this.memberships.get(`${symbol}:${item.contentId}`) || null }));
  }

  async saveSourceHealth(records: SentimentSourceHealthRecord[]): Promise<void> {
    for (const record of records) this.health.set(record.source, record);
  }

  async listSourceHealth(): Promise<SentimentSourceHealthRecord[]> {
    return [...this.health.values()];
  }

  async saveClusters(symbol: string, clusters: SentimentClusterRecord[]): Promise<void> {
    for (const cluster of clusters) {
      this.clusters.set(cluster.clusterId, cluster);
      for (const itemId of cluster.itemIds) {
        this.memberships.set(`${symbol}:${itemId}`, cluster.clusterId);
      }
    }
  }

  async saveEventFactChains(chains: EventFactChainRecord[], nodes: EventFactNodeRecord[]): Promise<void> {
    for (const chain of chains) this.eventChains.set(chain.chainId, chain);
    for (const node of nodes) this.eventNodes.set(node.nodeId, node);
  }

  async listEventFactChains(symbol: string, since: string, limit = 100): Promise<{ chains: EventFactChainRecord[]; nodes: EventFactNodeRecord[] }> {
    const sinceMs = Date.parse(since);
    const chains = [...this.eventChains.values()]
      .filter((chain) => chain.symbol === symbol && (!chain.lastPublishedAt || Date.parse(chain.lastPublishedAt) >= sinceMs))
      .sort((left, right) => String(right.lastPublishedAt || '').localeCompare(String(left.lastPublishedAt || '')))
      .slice(0, limit);
    const allowed = new Set(chains.map((chain) => chain.chainId));
    return { chains, nodes: [...this.eventNodes.values()].filter((node) => allowed.has(node.chainId)) };
  }
}

export class InMemoryAccessStatsRepo implements AccessStatsRepo {
  private events: AccessEventRecord[] = [];

  async recordAccess(event: AccessEventRecord): Promise<void> {
    this.events.push(event);
  }

  async periodStats(since: Date): Promise<{ pv: number; uv: number; dau: number }> {
    const boundary = since.getTime();
    const rows = this.events.filter((event) => Date.parse(event.createdAt) >= boundary);
    return {
      pv: rows.filter((row) => row.eventKind === 'pageview').length,
      uv: new Set(rows.map((row) => row.sessionKey)).size,
      dau: new Set(rows.filter((row) => row.userId).map((row) => row.userId as string)).size,
    };
  }

  async sessionDurations(since: Date): Promise<{ avgSessionDurationMs: number | null; byPlatform: Array<{ platform: string; sessions: number; avgSessionDurationMs: number | null }> }> {
    const boundary = since.getTime();
    // 按 session 汇总页面停留时长（跨平台同 session 时 platform 取最近一条）
    const sessions = new Map<string, { platform: string; totalMs: number }>();
    for (const event of this.events) {
      if (event.eventKind !== 'pageview' || Date.parse(event.createdAt) < boundary) continue;
      const existing = sessions.get(event.sessionKey);
      sessions.set(event.sessionKey, {
        platform: event.platform,
        totalMs: (existing?.totalMs ?? 0) + (event.durationMs ?? 0),
      });
    }
    const totals = [...sessions.values()];
    const average = (values: number[]) => (values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null);

    const byPlatformMap = new Map<string, number[]>();
    for (const session of totals) {
      const list = byPlatformMap.get(session.platform) ?? [];
      list.push(session.totalMs);
      byPlatformMap.set(session.platform, list);
    }
    return {
      avgSessionDurationMs: average(totals.map((session) => session.totalMs)),
      byPlatform: [...byPlatformMap.entries()]
        .map(([platform, list]) => ({ platform, sessions: list.length, avgSessionDurationMs: average(list) }))
        .sort((a, b) => b.sessions - a.sessions),
    };
  }

  async pageStats(days: number): Promise<Array<{ path: string; views: number; avgDurationMs: number | null; totalDurationMs: number }>> {
    const span = Math.min(90, Math.max(1, days));
    const boundary = Date.now() - span * 24 * 3600 * 1000 - 8 * 3600 * 1000; // 上海自然日边界，与 PG 版一致
    const rows = this.events.filter((event) => event.eventKind === 'pageview' && Date.parse(event.createdAt) >= boundary);
    const grouped = new Map<string, { views: number; durations: number[] }>();
    for (const row of rows) {
      const entry = grouped.get(row.path) ?? { views: 0, durations: [] };
      entry.views++;
      if (typeof row.durationMs === 'number') entry.durations.push(row.durationMs);
      grouped.set(row.path, entry);
    }
    return [...grouped.entries()]
      .map(([path, entry]) => ({
        path,
        views: entry.views,
        avgDurationMs: entry.durations.length ? Math.round(entry.durations.reduce((sum, value) => sum + value, 0) / entry.durations.length) : null,
        totalDurationMs: entry.durations.reduce((sum, value) => sum + value, 0),
      }))
      .sort((a, b) => b.views - a.views);
  }

  async traffic(days: number): Promise<AdminTraffic> {
    const span = Math.min(90, Math.max(1, days));
    const since = new Date(Date.now() - (span - 1) * 24 * 3600 * 1000 - 8 * 3600 * 1000); // 上海自然日边界
    const rows = this.events.filter((event) => Date.parse(event.createdAt) >= since.getTime());

    const dailyMap = new Map<string, { pv: number; sessions: Set<string> }>();
    for (let i = span - 1; i >= 0; i--) {
      const key = shanghaiDateKey(new Date(Date.now() - i * 24 * 3600 * 1000).toISOString());
      dailyMap.set(key, { pv: 0, sessions: new Set() });
    }
    const refererMap = new Map<string, number>();
    const deviceMap = new Map<string, number>();
    const platformMap = new Map<string, number>();
    for (const row of rows) {
      const key = shanghaiDateKey(row.createdAt);
      const daily = dailyMap.get(key);
      if (daily) {
        if (row.eventKind === 'pageview') daily.pv++;
        daily.sessions.add(row.sessionKey);
      }
      const refererKey = row.referer ? row.referer.slice(0, 120) : 'direct';
      refererMap.set(refererKey, (refererMap.get(refererKey) || 0) + 1);
      deviceMap.set(row.device, (deviceMap.get(row.device) || 0) + 1);
      platformMap.set(row.platform, (platformMap.get(row.platform) || 0) + 1);
    }
    return {
      daily: [...dailyMap.entries()].map(([date, value]) => ({ date, pv: value.pv, uv: value.sessions.size })),
      referers: [...refererMap.entries()].map(([referer, count]) => ({ referer, count })).sort((a, b) => b.count - a.count).slice(0, 10),
      devices: [...deviceMap.entries()].map(([device, count]) => ({ device, count })).sort((a, b) => b.count - a.count),
      platforms: [...platformMap.entries()].map(([platform, count]) => ({ platform, count })).sort((a, b) => b.count - a.count),
    };
  }

  async purgeBefore(date: Date): Promise<number> {
    const boundary = date.getTime();
    const kept = this.events.filter((event) => Date.parse(event.createdAt) >= boundary);
    const removed = this.events.length - kept.length;
    this.events = kept;
    return removed;
  }
}
