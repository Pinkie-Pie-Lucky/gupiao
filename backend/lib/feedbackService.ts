/**
 * 反馈服务：校验并写入 / 统计。
 * 用户反馈始终允许匿名提交；登录时关联 user_id。
 */
import { randomUUID } from 'node:crypto';
import type { FeedbackRepo, FeedbackRecord, FeedbackStats } from './db/repositories.js';
import { ApiError } from './errors.js';

export class FeedbackService {
  constructor(private repo: FeedbackRepo) {}

  async submit(input: {
    contentType: unknown;
    contentId: unknown;
    promptVersion: unknown;
    rating: unknown;
    reasons?: unknown;
    comment?: unknown;
    userId: string | null;
  }): Promise<{ ok: true }> {
    const contentType = String(input.contentType ?? '').trim().slice(0, 100);
    const contentId = String(input.contentId ?? '').trim().slice(0, 200);
    const promptVersion = String(input.promptVersion ?? '').trim().slice(0, 100);
    const rating = input.rating === 'positive' || input.rating === 'negative' ? input.rating : '';
    const reasons = Array.isArray(input.reasons)
      ? input.reasons.map((r) => String(r).trim().slice(0, 100)).filter(Boolean).slice(0, 10)
      : [];
    const comment = String(input.comment ?? '').trim().slice(0, 2000);

    if (!contentType || !contentId || !rating) {
      throw new ApiError('missing required fields', 400);
    }

    const record: FeedbackRecord = {
      id: randomUUID(),
      userId: input.userId,
      contentType,
      contentId,
      promptVersion,
      rating,
      reasons,
      comment,
      createdAt: new Date().toISOString(),
    };
    await this.repo.create(record);
    return { ok: true };
  }

  async stats(): Promise<FeedbackStats> {
    return this.repo.stats();
  }
}