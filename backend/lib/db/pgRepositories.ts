/**
 * PostgreSQL 仓储实现（生产 / 有 DATABASE_URL 时使用）。
 * 表结构见 backend/db/schema.sql。
 */
import type { Pool } from 'pg';
import type {
  UserRepo, BlacklistRepo, FeedbackRepo, WatchlistRepo, ScreenerRepo,
  ContentRepo, ChatRepo,
  UserRecord, BlacklistEntry, FeedbackRecord, FeedbackStats, WatchlistItem,
  MorningReportRecord, MarketReportRecord, BubbleSelectionRecord, ChatMessageRecord,
  MarketOverviewRecord, SectorSnapshotRecord, StockAgentOutputRecord,
  SentimentRepo, SentimentRawRecord, SentimentSourceHealthRecord, SentimentClusterRecord,
  EventFactChainRecord, EventFactNodeRecord, SavedScreenerRecord,
  UserListQuery, UserListResult, UserRole, UserStatus, AccessEventRecord, AccessStatsRepo, AdminTraffic,
} from './repositories.js';

const USER_COLUMNS = `id, phone, password_hash AS "passwordHash", nickname, role, status, created_at AS "createdAt"`;

export class PgUserRepo implements UserRepo {
  constructor(private pool: Pool) {}

  async create(user: UserRecord): Promise<UserRecord> {
    await this.pool.query(
      `INSERT INTO users (id, phone, password_hash, nickname, role, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [user.id, user.phone, user.passwordHash, user.nickname, user.role, user.status, user.createdAt],
    );
    return user;
  }

  async findByPhone(phone: string): Promise<UserRecord | null> {
    const { rows } = await this.pool.query(
      `SELECT ${USER_COLUMNS} FROM users WHERE phone = $1 LIMIT 1`,
      [phone],
    );
    return rows[0] ?? null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    const { rows } = await this.pool.query(
      `SELECT ${USER_COLUMNS} FROM users WHERE id = $1 LIMIT 1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async updateNickname(id: string, nickname: string): Promise<UserRecord | null> {
    const { rows } = await this.pool.query(
      `UPDATE users SET nickname = $2 WHERE id = $1 RETURNING ${USER_COLUMNS}`,
      [id, nickname],
    );
    return rows[0] ?? null;
  }

  async updateRole(id: string, role: UserRole): Promise<UserRecord | null> {
    const { rows } = await this.pool.query(
      `UPDATE users SET role = $2 WHERE id = $1 RETURNING ${USER_COLUMNS}`,
      [id, role],
    );
    return rows[0] ?? null;
  }

  async updateStatus(id: string, status: UserStatus): Promise<UserRecord | null> {
    const { rows } = await this.pool.query(
      `UPDATE users SET status = $2 WHERE id = $1 RETURNING ${USER_COLUMNS}`,
      [id, status],
    );
    return rows[0] ?? null;
  }

  async list(query: UserListQuery = {}): Promise<UserListResult> {
    const search = String(query.search || '').trim();
    const offset = Math.max(0, Number(query.offset) || 0);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const like = `%${search}%`;
    const where = search ? `WHERE nickname ILIKE $1 OR phone LIKE $1` : '';
    const params = search ? [like, limit, offset] : [limit, offset];
    const paramOffset = search ? 1 : 0;
    const { rows } = await this.pool.query(
      `SELECT ${USER_COLUMNS} FROM users ${where}
       ORDER BY created_at DESC LIMIT $${paramOffset + 1} OFFSET $${paramOffset + 2}`,
      params,
    );
    const { rows: counted } = await this.pool.query(
      `SELECT count(*)::int AS total FROM users ${where}`,
      search ? [like] : [],
    );
    return {
      rows: rows.map((row) => ({
        id: row.id, phone: row.phone, nickname: row.nickname, role: row.role, status: row.status, createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
      })),
      total: counted[0]?.total ?? rows.length,
    };
  }

  async countCreatedSince(since: Date): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT count(*)::int AS total FROM users WHERE created_at >= $1`,
      [since.toISOString()],
    );
    return rows[0]?.total ?? 0;
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

function mapSavedScreener(row: any): SavedScreenerRecord {
  return {
    id: String(row.id), userId: String(row.userId), name: String(row.name), query: String(row.query), enabled: Boolean(row.enabled),
    lastRunAt: row.lastRunAt ? new Date(row.lastRunAt).toISOString() : null,
    lastResult: row.lastResult ?? null, lastDiff: row.lastDiff ?? null,
    createdAt: new Date(row.createdAt).toISOString(), updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

export class PgScreenerRepo implements ScreenerRepo {
  constructor(private pool: Pool) {}

  async list(userId: string): Promise<SavedScreenerRecord[]> {
    const { rows } = await this.pool.query(`SELECT id, user_id AS "userId", name, query, enabled, last_run_at AS "lastRunAt", last_result AS "lastResult", last_diff AS "lastDiff", created_at AS "createdAt", updated_at AS "updatedAt" FROM saved_screeners WHERE user_id = $1 ORDER BY updated_at DESC`, [userId]);
    return rows.map(mapSavedScreener);
  }

  async create(record: SavedScreenerRecord): Promise<void> {
    await this.pool.query(`INSERT INTO saved_screeners (id, user_id, name, query, enabled, last_run_at, last_result, last_diff, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10)`, [record.id, record.userId, record.name, record.query, record.enabled, record.lastRunAt, JSON.stringify(record.lastResult), JSON.stringify(record.lastDiff), record.createdAt, record.updatedAt]);
  }

  async remove(userId: string, id: string): Promise<void> { await this.pool.query(`DELETE FROM saved_screeners WHERE user_id = $1 AND id = $2`, [userId, id]); }

  async find(userId: string, id: string): Promise<SavedScreenerRecord | null> {
    const { rows } = await this.pool.query(`SELECT id, user_id AS "userId", name, query, enabled, last_run_at AS "lastRunAt", last_result AS "lastResult", last_diff AS "lastDiff", created_at AS "createdAt", updated_at AS "updatedAt" FROM saved_screeners WHERE user_id = $1 AND id = $2 LIMIT 1`, [userId, id]);
    return rows[0] ? mapSavedScreener(rows[0]) : null;
  }

  async listEnabled(limit: number): Promise<SavedScreenerRecord[]> {
    const { rows } = await this.pool.query(`SELECT id, user_id AS "userId", name, query, enabled, last_run_at AS "lastRunAt", last_result AS "lastResult", last_diff AS "lastDiff", created_at AS "createdAt", updated_at AS "updatedAt" FROM saved_screeners WHERE enabled = true ORDER BY updated_at ASC LIMIT $1`, [limit]);
    return rows.map(mapSavedScreener);
  }

  async saveRun(userId: string, id: string, run: { lastRunAt: string; lastResult: unknown; lastDiff: unknown; updatedAt: string }): Promise<SavedScreenerRecord | null> {
    const { rows } = await this.pool.query(`UPDATE saved_screeners SET last_run_at = $3, last_result = $4::jsonb, last_diff = $5::jsonb, updated_at = $6 WHERE user_id = $1 AND id = $2 RETURNING id, user_id AS "userId", name, query, enabled, last_run_at AS "lastRunAt", last_result AS "lastResult", last_diff AS "lastDiff", created_at AS "createdAt", updated_at AS "updatedAt"`, [userId, id, run.lastRunAt, JSON.stringify(run.lastResult), JSON.stringify(run.lastDiff), run.updatedAt]);
    return rows[0] ? mapSavedScreener(rows[0]) : null;
  }
}

export class PgSentimentRepo implements SentimentRepo {
  constructor(private pool: Pool) {}

  async saveRawItems(items: SentimentRawRecord[]): Promise<void> {
    if (!items.length) return;
    const payload = JSON.stringify(items);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO sentiment_raw_items (
           content_id, platform, content_type, title, summary, original_url, published_at, fetched_at,
           author_id_hash, engagement, entity_match_score, source_quality, verification, content_hash,
           evidence_id, requires_review, first_seen_at, last_seen_at
         )
         SELECT x."contentId", x.platform, x."contentType", x.title, x.summary, x."originalUrl",
                x."publishedAt", x."fetchedAt", x."authorIdHash", COALESCE(x.engagement, '{}'::jsonb),
                x."entityMatchScore", x."sourceQuality", x.verification, x."contentHash", x."evidenceId",
                x."requiresReview", x."fetchedAt", x."fetchedAt"
         FROM jsonb_to_recordset($1::jsonb) AS x(
           "contentId" text, platform text, "contentType" text, title text, summary text, "originalUrl" text,
           "publishedAt" timestamptz, "fetchedAt" timestamptz, "authorIdHash" text, engagement jsonb,
           "entityMatchScore" double precision, "sourceQuality" text, verification text, "contentHash" text,
           "evidenceId" text, "requiresReview" boolean
         )
         ON CONFLICT (content_id) DO UPDATE SET
           title = EXCLUDED.title, summary = EXCLUDED.summary, original_url = EXCLUDED.original_url,
           published_at = COALESCE(EXCLUDED.published_at, sentiment_raw_items.published_at),
           fetched_at = EXCLUDED.fetched_at, engagement = EXCLUDED.engagement,
           entity_match_score = GREATEST(sentiment_raw_items.entity_match_score, EXCLUDED.entity_match_score),
           source_quality = EXCLUDED.source_quality, verification = EXCLUDED.verification,
           requires_review = EXCLUDED.requires_review, last_seen_at = EXCLUDED.last_seen_at`,
        [payload],
      );
      await client.query(
        `INSERT INTO sentiment_content_symbols (content_id, symbol, observed_at)
         SELECT x."contentId", symbol, COALESCE(x."publishedAt", x."fetchedAt")
         FROM jsonb_to_recordset($1::jsonb) AS x(
           "contentId" text, "relatedSymbols" text[], "publishedAt" timestamptz, "fetchedAt" timestamptz
         )
         CROSS JOIN LATERAL unnest(x."relatedSymbols") AS symbol
         ON CONFLICT (content_id, symbol) DO UPDATE SET observed_at = EXCLUDED.observed_at`,
        [payload],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listRawItems(symbol: string, since: string, limit = 500): Promise<SentimentRawRecord[]> {
    const safeLimit = Math.min(2_000, Math.max(1, Math.trunc(limit)));
    const { rows } = await this.pool.query(
      `SELECT i.content_id AS "contentId", i.platform, i.content_type AS "contentType", i.title, i.summary,
              i.original_url AS "originalUrl", i.published_at AS "publishedAt", i.fetched_at AS "fetchedAt",
              i.author_id_hash AS "authorIdHash", i.engagement, ARRAY_AGG(DISTINCT symbols.symbol) AS "relatedSymbols",
              i.entity_match_score AS "entityMatchScore", i.source_quality AS "sourceQuality", i.verification,
              i.content_hash AS "contentHash", memberships.cluster_id AS "clusterId", i.evidence_id AS "evidenceId",
              i.requires_review AS "requiresReview"
       FROM sentiment_content_symbols target
       JOIN sentiment_raw_items i ON i.content_id = target.content_id
       JOIN sentiment_content_symbols symbols ON symbols.content_id = i.content_id
       LEFT JOIN sentiment_cluster_items memberships ON memberships.content_id = i.content_id AND memberships.symbol = target.symbol
       WHERE target.symbol = $1 AND target.observed_at >= $2
       GROUP BY i.content_id, memberships.cluster_id
       ORDER BY COALESCE(i.published_at, i.fetched_at) DESC
       LIMIT $3`,
      [symbol, since, safeLimit],
    );
    return rows.map((row) => ({
      ...row,
      publishedAt: row.publishedAt instanceof Date ? row.publishedAt.toISOString() : row.publishedAt ? String(row.publishedAt) : null,
      fetchedAt: row.fetchedAt instanceof Date ? row.fetchedAt.toISOString() : String(row.fetchedAt),
      entityMatchScore: Number(row.entityMatchScore),
    }));
  }

  async saveSourceHealth(records: SentimentSourceHealthRecord[]): Promise<void> {
    if (!records.length) return;
    await this.pool.query(
      `INSERT INTO sentiment_source_health (
         source, status, last_attempt_at, last_success_at, last_error, consecutive_failures, metadata, updated_at
       )
       SELECT x.source, x.status, x."lastAttemptAt", x."lastSuccessAt", x."lastError",
              x."consecutiveFailures", COALESCE(x.metadata, '{}'::jsonb), x."updatedAt"
       FROM jsonb_to_recordset($1::jsonb) AS x(
         source text, status text, "lastAttemptAt" timestamptz, "lastSuccessAt" timestamptz,
         "lastError" text, "consecutiveFailures" integer, metadata jsonb, "updatedAt" timestamptz
       )
       ON CONFLICT (source) DO UPDATE SET status = EXCLUDED.status, last_attempt_at = EXCLUDED.last_attempt_at,
         last_success_at = COALESCE(EXCLUDED.last_success_at, sentiment_source_health.last_success_at),
         last_error = EXCLUDED.last_error, consecutive_failures = EXCLUDED.consecutive_failures,
         metadata = EXCLUDED.metadata, updated_at = EXCLUDED.updated_at`,
      [JSON.stringify(records)],
    );
  }

  async listSourceHealth(): Promise<SentimentSourceHealthRecord[]> {
    const { rows } = await this.pool.query(
      `SELECT source, status, last_attempt_at AS "lastAttemptAt", last_success_at AS "lastSuccessAt",
              last_error AS "lastError", consecutive_failures AS "consecutiveFailures", metadata,
              updated_at AS "updatedAt"
       FROM sentiment_source_health ORDER BY source`,
    );
    return rows.map((row) => ({
      ...row,
      lastAttemptAt: row.lastAttemptAt instanceof Date ? row.lastAttemptAt.toISOString() : row.lastAttemptAt ? String(row.lastAttemptAt) : null,
      lastSuccessAt: row.lastSuccessAt instanceof Date ? row.lastSuccessAt.toISOString() : row.lastSuccessAt ? String(row.lastSuccessAt) : null,
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
      consecutiveFailures: Number(row.consecutiveFailures),
    }));
  }

  async saveClusters(_symbol: string, clusters: SentimentClusterRecord[]): Promise<void> {
    if (!clusters.length) return;
    const payload = JSON.stringify(clusters);
    const itemIds = [...new Set(clusters.flatMap((cluster) => cluster.itemIds))];
    const memberships = clusters.flatMap((cluster) => cluster.itemIds.map((contentId) => ({ contentId, symbol: cluster.symbol, clusterId: cluster.clusterId, assignedAt: cluster.updatedAt })));
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO sentiment_event_clusters (
           cluster_id, symbol, category, representative_title, representative_content_id, started_at, ended_at,
           item_count, source_count, source_breakdown, stance_metrics, verification, updated_at
         )
         SELECT x."clusterId", x.symbol, x.category, x."representativeTitle", x."representativeContentId",
                x."startedAt", x."endedAt", x."itemCount", x."sourceCount", x."sourceBreakdown",
                x."stanceMetrics", x.verification, x."updatedAt"
         FROM jsonb_to_recordset($1::jsonb) AS x(
           "clusterId" text, symbol text, category text, "representativeTitle" text, "representativeContentId" text,
           "startedAt" timestamptz, "endedAt" timestamptz, "itemCount" integer, "sourceCount" integer,
           "sourceBreakdown" jsonb, "stanceMetrics" jsonb, verification text, "updatedAt" timestamptz
         )
         ON CONFLICT (cluster_id) DO UPDATE SET representative_title = EXCLUDED.representative_title,
           representative_content_id = EXCLUDED.representative_content_id, started_at = EXCLUDED.started_at,
           ended_at = EXCLUDED.ended_at, item_count = EXCLUDED.item_count, source_count = EXCLUDED.source_count,
           source_breakdown = EXCLUDED.source_breakdown, stance_metrics = EXCLUDED.stance_metrics,
           verification = EXCLUDED.verification, updated_at = EXCLUDED.updated_at`,
        [payload],
      );
      await client.query(`DELETE FROM sentiment_cluster_items WHERE symbol = $1 AND content_id = ANY($2::text[])`, [_symbol, itemIds]);
      await client.query(
        `INSERT INTO sentiment_cluster_items (content_id, symbol, cluster_id, assigned_at)
         SELECT x."contentId", x.symbol, x."clusterId", x."assignedAt"
         FROM jsonb_to_recordset($1::jsonb) AS x("contentId" text, symbol text, "clusterId" text, "assignedAt" timestamptz)
         ON CONFLICT (content_id, symbol) DO UPDATE SET cluster_id = EXCLUDED.cluster_id, assigned_at = EXCLUDED.assigned_at`,
        [JSON.stringify(memberships)],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async saveEventFactChains(chains: EventFactChainRecord[], nodes: EventFactNodeRecord[]): Promise<void> {
    if (!chains.length) return;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO event_fact_chains (
           chain_id, symbol, topic_key, category, headline, lifecycle_state, fact_status,
           first_published_at, last_published_at, official_node_id, clarification_node_id,
           source_count, node_count, propagation, updated_at
         )
         SELECT x."chainId", x.symbol, x."topicKey", x.category, x.headline, x."lifecycleState", x."factStatus",
                x."firstPublishedAt", x."lastPublishedAt", x."officialNodeId", x."clarificationNodeId",
                x."sourceCount", x."nodeCount", COALESCE(x.propagation, '{}'::jsonb), x."updatedAt"
         FROM jsonb_to_recordset($1::jsonb) AS x(
           "chainId" text, symbol text, "topicKey" text, category text, headline text, "lifecycleState" text, "factStatus" text,
           "firstPublishedAt" timestamptz, "lastPublishedAt" timestamptz, "officialNodeId" text, "clarificationNodeId" text,
           "sourceCount" integer, "nodeCount" integer, propagation jsonb, "updatedAt" timestamptz
         )
         ON CONFLICT (chain_id) DO UPDATE SET topic_key = EXCLUDED.topic_key, headline = EXCLUDED.headline,
           lifecycle_state = EXCLUDED.lifecycle_state, fact_status = EXCLUDED.fact_status,
           first_published_at = EXCLUDED.first_published_at, last_published_at = EXCLUDED.last_published_at,
           official_node_id = EXCLUDED.official_node_id, clarification_node_id = EXCLUDED.clarification_node_id,
           source_count = EXCLUDED.source_count, node_count = EXCLUDED.node_count, propagation = EXCLUDED.propagation,
           updated_at = EXCLUDED.updated_at`,
        [JSON.stringify(chains)],
      );
      if (nodes.length) {
        await client.query(
          `INSERT INTO event_fact_nodes (
             node_id, chain_id, symbol, evidence_id, title, summary, source, source_url, published_at,
             category, direction, verification, role, parent_node_id, relation_type, link_confidence, superseded, updated_at
           )
           SELECT x."nodeId", x."chainId", x.symbol, x."evidenceId", x.title, x.summary, x.source, x."sourceUrl", x."publishedAt",
                  x.category, x.direction, x.verification, x.role, x."parentNodeId", x."relationType", x."linkConfidence", x.superseded, x."updatedAt"
           FROM jsonb_to_recordset($1::jsonb) AS x(
             "nodeId" text, "chainId" text, symbol text, "evidenceId" text, title text, summary text, source text, "sourceUrl" text,
             "publishedAt" timestamptz, category text, direction text, verification text, role text, "parentNodeId" text,
             "relationType" text, "linkConfidence" text, superseded boolean, "updatedAt" timestamptz
           )
           ON CONFLICT (node_id) DO UPDATE SET chain_id = EXCLUDED.chain_id, title = EXCLUDED.title,
             summary = EXCLUDED.summary, source = EXCLUDED.source, source_url = EXCLUDED.source_url,
             published_at = EXCLUDED.published_at, category = EXCLUDED.category, direction = EXCLUDED.direction,
             verification = EXCLUDED.verification, role = EXCLUDED.role, parent_node_id = EXCLUDED.parent_node_id,
             relation_type = EXCLUDED.relation_type, link_confidence = EXCLUDED.link_confidence,
             superseded = EXCLUDED.superseded, updated_at = EXCLUDED.updated_at`,
          [JSON.stringify(nodes)],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listEventFactChains(symbol: string, since: string, limit = 100): Promise<{ chains: EventFactChainRecord[]; nodes: EventFactNodeRecord[] }> {
    const safeLimit = Math.min(500, Math.max(1, Math.trunc(limit)));
    const { rows: chains } = await this.pool.query(
      `SELECT chain_id AS "chainId", symbol, topic_key AS "topicKey", category, headline,
              lifecycle_state AS "lifecycleState", fact_status AS "factStatus",
              first_published_at AS "firstPublishedAt", last_published_at AS "lastPublishedAt",
              official_node_id AS "officialNodeId", clarification_node_id AS "clarificationNodeId",
              source_count AS "sourceCount", node_count AS "nodeCount", propagation, updated_at AS "updatedAt"
       FROM event_fact_chains WHERE symbol = $1 AND COALESCE(last_published_at, updated_at) >= $2
       ORDER BY last_published_at DESC NULLS LAST LIMIT $3`, [symbol, since, safeLimit],
    );
    if (!chains.length) return { chains: [], nodes: [] };
    const ids = chains.map((chain) => chain.chainId);
    const { rows: nodes } = await this.pool.query(
      `SELECT node_id AS "nodeId", chain_id AS "chainId", symbol, evidence_id AS "evidenceId", title, summary,
              source, source_url AS "sourceUrl", published_at AS "publishedAt", category, direction, verification,
              role, parent_node_id AS "parentNodeId", relation_type AS "relationType", link_confidence AS "linkConfidence",
              superseded, updated_at AS "updatedAt"
       FROM event_fact_nodes WHERE chain_id = ANY($1::text[]) ORDER BY published_at ASC NULLS LAST, node_id`, [ids],
    );
    const iso = (value: any) => value instanceof Date ? value.toISOString() : value ? String(value) : null;
    return {
      chains: chains.map((chain) => ({ ...chain, firstPublishedAt: iso(chain.firstPublishedAt), lastPublishedAt: iso(chain.lastPublishedAt), updatedAt: iso(chain.updatedAt)! })),
      nodes: nodes.map((node) => ({ ...node, publishedAt: iso(node.publishedAt), updatedAt: iso(node.updatedAt)! })),
    };
  }
}

export class PgAccessStatsRepo implements AccessStatsRepo {
  constructor(private pool: Pool) {}

  async recordAccess(event: AccessEventRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO access_events (
         id, user_id, session_key, platform, path, method, status_code,
         referer, utm_source, device, ip_hash, duration_ms, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [event.id, event.userId, event.sessionKey, event.platform, event.path, event.method, event.statusCode,
        event.referer, event.utmSource, event.device, event.ipHash, event.durationMs, event.createdAt],
    );
  }

  async periodStats(since: Date): Promise<{ pv: number; uv: number; dau: number }> {
    const { rows } = await this.pool.query(
      `SELECT count(*) FILTER (WHERE event_kind = 'pageview')::int AS pv,
              count(DISTINCT session_key)::int AS uv,
              count(DISTINCT user_id)::int AS dau
       FROM access_events WHERE created_at >= $1`,
      [since.toISOString()],
    );
    return rows[0] ?? { pv: 0, uv: 0, dau: 0 };
  }

  async sessionDurations(since: Date): Promise<{ avgSessionDurationMs: number | null; byPlatform: Array<{ platform: string; sessions: number; avgSessionDurationMs: number | null }> }> {
    // 按 session 汇总页面停留时长再取均值（跨平台同 session 时 platform 取最近一条）
    const { rows } = await this.pool.query(
      `SELECT avg(total_ms)::float AS "avgSessionDurationMs" FROM (
         SELECT session_key, sum(duration_ms) AS total_ms
         FROM access_events
         WHERE event_kind = 'pageview' AND created_at >= $1 AND duration_ms IS NOT NULL
         GROUP BY session_key
       ) sessions`,
      [since.toISOString()],
    );
    const { rows: platformRows } = await this.pool.query(
      `SELECT platform, count(*)::int AS sessions, avg(total_ms)::float AS "avgSessionDurationMs" FROM (
         SELECT session_key, (array_agg(platform ORDER BY created_at DESC))[1] AS platform, sum(duration_ms) AS total_ms
         FROM access_events
         WHERE event_kind = 'pageview' AND created_at >= $1 AND duration_ms IS NOT NULL
         GROUP BY session_key
       ) sessions
       GROUP BY platform ORDER BY sessions DESC`,
      [since.toISOString()],
    );
    return {
      avgSessionDurationMs: rows[0]?.avgSessionDurationMs != null ? Math.round(rows[0].avgSessionDurationMs) : null,
      byPlatform: platformRows.map((row) => ({
        platform: row.platform,
        sessions: row.sessions,
        avgSessionDurationMs: row.avgSessionDurationMs != null ? Math.round(row.avgSessionDurationMs) : null,
      })),
    };
  }

  async pageStats(days: number): Promise<Array<{ path: string; views: number; avgDurationMs: number | null; totalDurationMs: number }>> {
    const span = Math.min(90, Math.max(1, days));
    const { rows } = await this.pool.query(
      `SELECT path,
              count(*)::int AS views,
              avg(duration_ms)::float AS "avgDurationMs",
              COALESCE(sum(duration_ms), 0)::bigint AS "totalDurationMs"
       FROM access_events
       WHERE event_kind = 'pageview'
         AND created_at >= ((now() AT TIME ZONE 'Asia/Shanghai')::date - make_interval(days => $1 - 1)) AT TIME ZONE 'Asia/Shanghai'
       GROUP BY path ORDER BY views DESC`,
      [span],
    );
    return rows.map((row) => ({
      path: row.path,
      views: row.views,
      avgDurationMs: row.avgDurationMs != null ? Math.round(row.avgDurationMs) : null,
      totalDurationMs: Number(row.totalDurationMs),
    }));
  }

  async traffic(days: number): Promise<AdminTraffic> {
    const span = Math.min(90, Math.max(1, days));
    // 统一按上海时区自然日切分，与内存实现口径一致
    const dailyRows = await this.pool.query(
      `SELECT to_char((created_at AT TIME ZONE 'Asia/Shanghai')::date, 'YYYY-MM-DD') AS date,
              count(*) FILTER (WHERE event_kind = 'pageview')::int AS pv,
              count(DISTINCT session_key)::int AS uv
       FROM access_events
       WHERE created_at >= ((now() AT TIME ZONE 'Asia/Shanghai')::date - make_interval(days => $1 - 1)) AT TIME ZONE 'Asia/Shanghai'
       GROUP BY 1 ORDER BY 1`,
      [span],
    );
    // 无访问的日期补零，前端曲线不缺天
    const dailyMap = new Map<string, { pv: number; uv: number }>();
    for (let i = span - 1; i >= 0; i--) {
      const key = new Date(Date.now() + 8 * 3600 * 1000 - i * 24 * 3600 * 1000).toISOString().slice(0, 10);
      dailyMap.set(key, { pv: 0, uv: 0 });
    }
    for (const row of dailyRows.rows) {
      if (dailyMap.has(row.date)) dailyMap.set(row.date, { pv: row.pv, uv: row.uv });
    }

    const { rows: refererRows } = await this.pool.query(
      `SELECT COALESCE(NULLIF(referer, ''), 'direct') AS referer, count(*)::int AS count
       FROM access_events
       WHERE created_at >= ((now() AT TIME ZONE 'Asia/Shanghai')::date - make_interval(days => $1 - 1)) AT TIME ZONE 'Asia/Shanghai'
       GROUP BY 1 ORDER BY count DESC LIMIT 10`,
      [span],
    );
    const { rows: deviceRows } = await this.pool.query(
      `SELECT device, count(*)::int AS count FROM access_events
       WHERE created_at >= ((now() AT TIME ZONE 'Asia/Shanghai')::date - make_interval(days => $1 - 1)) AT TIME ZONE 'Asia/Shanghai'
       GROUP BY 1 ORDER BY count DESC`,
      [span],
    );
    const { rows: platformRows } = await this.pool.query(
      `SELECT platform, count(*)::int AS count FROM access_events
       WHERE created_at >= ((now() AT TIME ZONE 'Asia/Shanghai')::date - make_interval(days => $1 - 1)) AT TIME ZONE 'Asia/Shanghai'
       GROUP BY 1 ORDER BY count DESC`,
      [span],
    );

    return {
      daily: [...dailyMap.entries()].map(([date, value]) => ({ date, pv: value.pv, uv: value.uv })),
      referers: refererRows,
      devices: deviceRows,
      platforms: platformRows,
    };
  }

  async purgeBefore(date: Date): Promise<number> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM access_events WHERE created_at < $1`,
      [date.toISOString()],
    );
    return rowCount ?? 0;
  }
}
