/**
 * 自选股服务：按用户隔离的增删查。
 * symbol 存 6 位数字证券代码（如 '600519'），name 冗余存储便于列表展示。
 */
import type { WatchlistRepo, WatchlistItem } from './db/repositories.js';
import { ApiError } from './errors.js';

export const SYMBOL_PATTERN = /^\d{6}$/;

export class WatchlistService {
  constructor(private repo: WatchlistRepo) {}

  async list(userId: string): Promise<WatchlistItem[]> {
    return this.repo.list(userId);
  }

  async add(userId: string, input: { symbol: unknown; name: unknown }): Promise<WatchlistItem> {
    const symbol = String(input.symbol ?? '').trim();
    if (!SYMBOL_PATTERN.test(symbol)) throw new ApiError('股票代码格式不正确（应为 6 位数字）。', 400);
    const name = String(input.name ?? '').trim().slice(0, 30);
    if (!name) throw new ApiError('缺少股票名称。', 400);

    await this.repo.add(userId, { symbol, name });
    return { symbol, name, addedAt: new Date().toISOString() };
  }

  async remove(userId: string, symbol: unknown): Promise<void> {
    const value = String(symbol ?? '').trim();
    if (!SYMBOL_PATTERN.test(value)) throw new ApiError('股票代码格式不正确。', 400);
    await this.repo.remove(userId, value);
  }
}