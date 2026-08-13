/**
 * 内存仓储实现：无 PostgreSQL 环境时作为回退（本机未装 Docker/PG 时的开发模式），
 * 也用于认证/反馈业务逻辑的单测。
 */
import type {
  UserRepo, BlacklistRepo, FeedbackRepo, WatchlistRepo,
  UserRecord, BlacklistEntry, FeedbackRecord, FeedbackStats, WatchlistItem,
} from './repositories.js';

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