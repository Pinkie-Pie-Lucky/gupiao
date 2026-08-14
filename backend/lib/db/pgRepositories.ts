/**
 * PostgreSQL 仓储实现（生产 / 有 DATABASE_URL 时使用）。
 * 表结构见 backend/db/schema.sql。
 */
import type { Pool } from 'pg';
import type {
  UserRepo, BlacklistRepo, FeedbackRepo, WatchlistRepo,
  ContentRepo, ChatRepo,
  UserRecord, BlacklistEntry, FeedbackRecord, FeedbackStats, WatchlistItem,
  MorningReportRecord, MarketReportRecord, BubbleSelectionRecord, ChatMessageRecord,
  MarketOverviewRecord, SectorSnapshotRecord, StockAgentOutputRecord,
} from './repositories.js';

export class PgUserRepo implements UserRepo {
  constructor(private pool: Pool) {}

  async create(user: UserRecord): Promise<UserRecord> {
    await this.pool.query(
      `INSERT INTO users (id, phone, password_hash, nickname, created_at) VALUES ($1, $2, $3, $4, $5)`,
      [user.id, user.phone, user.passwordHash, user.nickname, user.createdAt],
    );
    return user;
  }

  async findByPhone(phone: string): Promise<UserRecord | null> {
    const { rows } = await this.pool.query(
      `SELECT id, phone, password_hash AS "passwordHash", nickname, created_at AS "createdAt" FROM users WHERE phone = $1 LIMIT 1`,
      [phone],
    );
    return rows[0] ?? null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    const { rows } = await this.pool.query(
      `SELECT id, phone, password_hash AS "passwordHash", nickname, created_at AS "createdAt" FROM users WHERE id = $1 LIMIT 1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async updateNickname(id: string, nickname: string): Promise<UserRecord | null> {
    const { rows } = await this.pool.query(
      `UPDATE users SET nickname = $2 WHERE id = $1
       RETURNING id, phone, password_hash AS "passwordHash", nickname, created_at AS "createdAt"`,
      [id, nickname],
    );
    return rows[0] ?? null;
  }
}

export class PgBlacklistRepo implements BlacklistRepo {
  constructor(private pool: Pool) {}

  async add(entry: BlacklistEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO token_blacklist (jti, user_id, expires_at, created_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (jti) DO NOTHING`,
      [entry.jti, entry.userId, entry.expiresAt],
    );
  }

  async has(jti: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM token_blacklist WHERE jti = $1 AND expires_at > now() LIMIT 1`,
      [jti],
    );
    return rows.length > 0;
  }

  async sweep(): Promise<void> {
    await this.pool.query(`DELETE FROM token_blacklist WHERE expires_at <= now()`);
  }
}

export class PgFeedbackRepo implements FeedbackRepo {
  constructor(private pool: Pool) {}

  async create(record: FeedbackRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO feedback (id, user_id, content_type, content_id, prompt_version, rating, reasons, comment, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
      [
        record.id, record.userId, record.contentType, record.contentId,
        record.promptVersion, record.rating, JSON.stringify(record.reasons),
        record.comment, record.createdAt,
      ],
    );
  }

  async stats(): Promise<FeedbackStats> {
    const { rows } = await this.pool.query(
      `SELECT
         prompt_version AS "promptVersion",
         rating,
         reasons
       FROM feedback`,
    );
    const stats: FeedbackStats['stats'] = {};
    let total = 0;
    for (const row of rows) {
      const pv: string = row.promptVersion || 'unknown';
      if (!stats[pv]) stats[pv] = { positive: 0, negative: 0, total: 0, reasons: {} };
      const s = stats[pv];
      s.total++;
      if (row.rating === 'positive') s.positive++;
      if (row.rating === 'negative') s.negative++;
      const reasons: unknown[] = Array.isArray(row.reasons) ? row.reasons : [];
      for (const r of reasons) {
        const key = String(r);
        s.reasons[key] = (s.reasons[key] || 0) + 1;
      }
      total++;
    }
    return { stats, total };
  }
}

export class PgWatchlistRepo implements WatchlistRepo {
  constructor(private pool: Pool) {}

  async list(userId: string): Promise<WatchlistItem[]> {
    const { rows } = await this.pool.query(
      `SELECT symbol, name, added_at AS "addedAt" FROM watchlist WHERE user_id = $1 ORDER BY added_at ASC`,
      [userId],
    );
    return rows.map((r) => ({ symbol: r.symbol, name: r.name, addedAt: r.addedAt instanceof Date ? r.addedAt.toISOString() : String(r.addedAt) }));
  }

  async add(userId: string, item: { symbol: string; name: string }): Promise<void> {
    await this.pool.query(
      `INSERT INTO watchlist (user_id, symbol, name) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, symbol) DO UPDATE SET name = EXCLUDED.name`,
      [userId, item.symbol, item.name],
    );
  }

  async remove(userId: string, symbol: string): Promise<void> {
    await this.pool.query(`DELETE FROM watchlist WHERE user_id = $1 AND symbol = $2`, [userId, symbol]);
  }
}

export class PgContentRepo implements ContentRepo {
  constructor(private pool: Pool) {}

  async saveMorningReport(record: MorningReportRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO morning_reports (market_date, payload, created_at)
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (market_date) DO UPDATE SET payload = EXCLUDED.payload, created_at = EXCLUDED.created_at`,
      [record.marketDate, JSON.stringify(record.payload), record.createdAt],
    );
  }

  async saveMarketReport(record: MarketReportRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO market_reports (id, market_date, report, fallback, prompt_version, input_snapshot, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [
        record.id, record.marketDate, record.report, record.fallback,
        record.promptVersion, JSON.stringify(record.inputSnapshot ?? {}), record.createdAt,
      ],
    );
  }

  async saveBubbleSelection(record: BubbleSelectionRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO bubble_selections (id, market_date, payload, prompt_version, fallback, created_at)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6)`,
      [
        record.id, record.marketDate, JSON.stringify(record.payload),
        record.promptVersion, record.fallback, record.createdAt,
      ],
    );
  }

  async getMorningReport(marketDate: string): Promise<MorningReportRecord | null> {
    const { rows } = await this.pool.query(
      `SELECT market_date AS "marketDate", payload, created_at AS "createdAt"
       FROM morning_reports WHERE market_date = $1 LIMIT 1`,
      [marketDate],
    );
    const row = rows[0];
    if (!row) return null;
    return { marketDate: row.marketDate, payload: row.payload, createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt) };
  }

  async getBubbleSelection(marketDate: string): Promise<BubbleSelectionRecord | null> {
    const { rows } = await this.pool.query(
      `SELECT id, market_date AS "marketDate", payload, prompt_version AS "promptVersion", fallback, created_at AS "createdAt"
       FROM bubble_selections WHERE market_date = $1 ORDER BY created_at DESC LIMIT 1`,
      [marketDate],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id, marketDate: row.marketDate, payload: row.payload,
      promptVersion: row.promptVersion, fallback: row.fallback,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    };
  }

  async saveMarketOverview(record: MarketOverviewRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO market_overviews (market_date, payload, updated_at, created_at)
       VALUES ($1, $2::jsonb, $3, now())
       ON CONFLICT (market_date) DO UPDATE SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at`,
      [record.marketDate, JSON.stringify(record.payload), record.updatedAt],
    );
  }

  async getMarketOverview(marketDate: string): Promise<MarketOverviewRecord | null> {
    const { rows } = await this.pool.query(
      `SELECT market_date AS "marketDate", payload, updated_at AS "updatedAt"
       FROM market_overviews WHERE market_date = $1 LIMIT 1`,
      [marketDate],
    );
    const row = rows[0];
    if (!row) return null;
    return { marketDate: row.marketDate, payload: row.payload, updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt) };
  }

  async saveSectorSnapshot(record: SectorSnapshotRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO sector_snapshots (market_date, payload, updated_at, created_at)
       VALUES ($1, $2::jsonb, $3, now())
       ON CONFLICT (market_date) DO UPDATE SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at`,
      [record.marketDate, JSON.stringify(record.payload), record.updatedAt],
    );
  }

  async getSectorSnapshot(marketDate: string): Promise<SectorSnapshotRecord | null> {
    const { rows } = await this.pool.query(
      `SELECT market_date AS "marketDate", payload, updated_at AS "updatedAt"
       FROM sector_snapshots WHERE market_date = $1 LIMIT 1`,
      [marketDate],
    );
    const row = rows[0];
    if (!row) return null;
    return { marketDate: row.marketDate, payload: row.payload, updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt) };
  }

  async saveStockAgentOutput(record: StockAgentOutputRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO stock_agent_outputs (symbol, agent, payload, updated_at, created_at)
       VALUES ($1, $2, $3::jsonb, $4, now())
       ON CONFLICT (symbol, agent) DO UPDATE SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at`,
      [record.symbol, record.agent, JSON.stringify(record.payload), record.updatedAt],
    );
  }

  async getStockAgentOutput(symbol: string, agent: string): Promise<StockAgentOutputRecord | null> {
    const { rows } = await this.pool.query(
      `SELECT symbol, agent, payload, updated_at AS "updatedAt"
       FROM stock_agent_outputs WHERE symbol = $1 AND agent = $2 LIMIT 1`,
      [symbol, agent],
    );
    const row = rows[0];
    if (!row) return null;
    return { symbol: row.symbol, agent: row.agent, payload: row.payload, updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt) };
  }
}

export class PgChatRepo implements ChatRepo {
  constructor(private pool: Pool) {}

  async addMessage(record: ChatMessageRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO chat_messages (id, user_id, session_id, role, content, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [record.id, record.userId, record.sessionId, record.role, record.content, record.createdAt],
    );
  }
}