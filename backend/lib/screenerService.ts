import { randomUUID } from 'node:crypto';
import type { SavedScreenerRecord, ScreenerRepo } from './db/repositories.js';
import { ApiError } from './errors.js';

export const MAX_SAVED_SCREENERS_PER_USER = 12;

function cleanQuery(value: unknown) {
  const query = String(value || '').trim().replace(/\s+/g, ' ');
  if (!query || query.length > 180) throw new ApiError('选股条件需为 1 至 180 个字符。', 400);
  return query;
}

function cleanName(value: unknown, query: string) {
  const name = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 30);
  return name || query.slice(0, 18);
}

export class ScreenerService {
  constructor(private repo: ScreenerRepo) {}

  async list(userId: string) { return this.repo.list(userId); }

  async create(userId: string, input: { name?: unknown; query?: unknown }) {
    const query = cleanQuery(input.query);
    const existing = await this.repo.list(userId);
    if (existing.length >= MAX_SAVED_SCREENERS_PER_USER) throw new ApiError(`最多保存 ${MAX_SAVED_SCREENERS_PER_USER} 条选股条件，请先删除不再使用的条件。`, 400);
    const now = new Date().toISOString();
    const record: SavedScreenerRecord = { id: randomUUID(), userId, name: cleanName(input.name, query), query, enabled: true, lastRunAt: null, lastResult: null, lastDiff: null, createdAt: now, updatedAt: now };
    await this.repo.create(record);
    return record;
  }

  async remove(userId: string, id: unknown) {
    const value = String(id || '').trim();
    if (!/^[\w-]{20,64}$/.test(value)) throw new ApiError('保存条件标识不正确。', 400);
    await this.repo.remove(userId, value);
  }

  async find(userId: string, id: unknown) {
    const value = String(id || '').trim();
    const saved = await this.repo.find(userId, value);
    if (!saved) throw new ApiError('未找到该保存条件。', 404);
    return saved;
  }

  async saveRun(saved: SavedScreenerRecord, result: unknown, diff: unknown) {
    const now = new Date().toISOString();
    return this.repo.saveRun(saved.userId, saved.id, { lastRunAt: now, lastResult: result, lastDiff: diff, updatedAt: now });
  }

  async enabled(limit = 60) { return this.repo.listEnabled(Math.max(1, Math.min(60, limit))); }
}
