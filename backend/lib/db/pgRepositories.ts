/**
 * PostgreSQL 仓储实现（生产 / 有 DATABASE_URL 时使用）。
 * 表结构见 backend/db/schema.sql。
 */
import type { Pool } from 'pg';
import type {
  UserRepo, BlacklistRepo, FeedbackRepo, WatchlistRepo,
  UserRecord, BlacklistEntry, FeedbackRecord, FeedbackStats, WatchlistItem,
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