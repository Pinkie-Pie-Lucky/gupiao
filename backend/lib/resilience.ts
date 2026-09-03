import type { NextFunction, Request, Response } from 'express';

export type RetryOptions = {
  attempts?: number;
  minDelayMs?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
};

const wait = (delayMs: number) => new Promise((resolve) => setTimeout(resolve, delayMs));

/** 只用于幂等的外部读取请求；写操作不得自动重试。 */
export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, Math.min(3, Number(options.attempts) || 2));
  const configuredDelay = Number(options.minDelayMs);
  const minDelayMs = Number.isFinite(configuredDelay) ? Math.max(0, configuredDelay) : 150;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || options.shouldRetry?.(error, attempt) === false) break;
      await wait(minDelayMs * attempt);
    }
  }
  throw lastError;
}

export type RateLimitOptions = { windowMs?: number; maxRequests?: number; now?: () => number };
type RateEntry = { startedAt: number; count: number };

/** 轻量进程内限流：适合单实例与本地部署；多实例应接 Redis 等共享限流器。 */
export function createRequestRateLimiter(options: RateLimitOptions = {}) {
  const windowMs = Math.max(1_000, Number(options.windowMs) || 60_000);
  const maxRequests = Math.max(1, Number(options.maxRequests) || 180);
  const now = options.now || Date.now;
  const entries = new Map<string, RateEntry>();

  return (req: Request, res: Response, next: NextFunction) => {
    const key = String(req.ip || req.socket.remoteAddress || 'unknown');
    const current = now();
    const previous = entries.get(key);
    const entry = !previous || current - previous.startedAt >= windowMs
      ? { startedAt: current, count: 0 }
      : previous;
    entry.count += 1;
    entries.set(key, entry);
    const remaining = Math.max(0, maxRequests - entry.count);
    res.setHeader('RateLimit-Limit', String(maxRequests));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(Math.ceil((entry.startedAt + windowMs) / 1000)));
    if (entry.count > maxRequests) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((entry.startedAt + windowMs - current) / 1000))));
      res.status(429).json({ error: '请求过于频繁，请稍后重试。', retryable: true });
      return;
    }
    next();
  };
}
