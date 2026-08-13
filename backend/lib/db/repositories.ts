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
