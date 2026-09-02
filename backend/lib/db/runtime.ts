/**
 * 运行时仓储选择：配置了 DATABASE_URL 用 PostgreSQL；否则回退内存实现。
 * 这让本机未装 Docker/PG 时服务仍可启动、单测可独立运行。
 */
import type { UserRepo, BlacklistRepo, FeedbackRepo, WatchlistRepo, ScreenerRepo, ContentRepo, ChatRepo, SentimentRepo, AccessStatsRepo } from './repositories.js';
import {
  InMemoryUserRepo, InMemoryBlacklistRepo, InMemoryFeedbackRepo, InMemoryWatchlistRepo,
  InMemoryContentRepo, InMemoryChatRepo, InMemorySentimentRepo, InMemoryScreenerRepo,
  InMemoryAccessStatsRepo,
} from './inMemoryRepositories.js';
import {
  PgUserRepo, PgBlacklistRepo, PgFeedbackRepo, PgWatchlistRepo,
  PgContentRepo, PgChatRepo, PgSentimentRepo, PgScreenerRepo,
  PgAccessStatsRepo,
} from './pgRepositories.js';
import { getPool, assertDbConnection } from './pool.js';

export interface DbRuntime {
  mode: 'postgres' | 'memory';
  users: UserRepo;
  blacklist: BlacklistRepo;
  feedback: FeedbackRepo;
  watchlist: WatchlistRepo;
  screeners: ScreenerRepo;
  content: ContentRepo;
  chat: ChatRepo;
  sentiment: SentimentRepo;
  accessStats: AccessStatsRepo;
}

let cached: DbRuntime | null = null;

export async function createRuntime(): Promise<DbRuntime> {
  if (cached) return cached;

  const pool = getPool();
  if (pool && (await assertDbConnection())) {
    cached = {
      mode: 'postgres',
      users: new PgUserRepo(pool),
      blacklist: new PgBlacklistRepo(pool),
      feedback: new PgFeedbackRepo(pool),
      watchlist: new PgWatchlistRepo(pool),
      screeners: new PgScreenerRepo(pool),
      content: new PgContentRepo(pool),
      chat: new PgChatRepo(pool),
      sentiment: new PgSentimentRepo(pool),
      accessStats: new PgAccessStatsRepo(pool),
    };
    console.log('[db] runtime: postgres');
    return cached;
  }

  cached = {
    mode: 'memory',
    users: new InMemoryUserRepo(),
    blacklist: new InMemoryBlacklistRepo(),
    feedback: new InMemoryFeedbackRepo(),
    watchlist: new InMemoryWatchlistRepo(),
    screeners: new InMemoryScreenerRepo(),
    content: new InMemoryContentRepo(),
    chat: new InMemoryChatRepo(),
    sentiment: new InMemorySentimentRepo(),
    accessStats: new InMemoryAccessStatsRepo(),
  };
  if (pool) console.warn('[db] DATABASE_URL 已配置但连接失败，回退到内存仓储（数据不持久化）。');
  else console.warn('[db] 未配置 DATABASE_URL，使用内存仓储（数据不持久化）。生产环境请设置 DATABASE_URL。');
  return cached;
}

export async function resetRuntime(): Promise<void> {
  cached = null;
}
