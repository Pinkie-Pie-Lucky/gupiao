/**
 * 访问埋点中间件：页面入口与 /api/* 各记一行 access_events。
 * 写入为 fire-and-forget（失败只告警），永不影响业务响应。
 * 注意：该模式依赖常驻进程（ECS/Docker）；若将来回到 Vercel serverless，
 * 响应返回后函数可能被冻结导致写入丢失，需改为 await 落库。
 */
import { createHmac, randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { AccessEventRecord, AccessStatsRepo, ClientPlatform } from './db/repositories.js';
import { verifyAuthToken, buildAuthConfig } from './jwt.js';

const SKIP_PREFIXES = ['/assets/', '/health'];
const SKIP_EXTENSIONS = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|map|txt|webp|mp4)$/i;

function headerString(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  const text = String(value || '').trim();
  return text || null;
}

function clientIp(req: Request): string | null {
  const forwarded = headerString(req.headers['x-forwarded-for']);
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress || null;
}

/** IP 指纹：HMAC-SHA256(JWT_SECRET, ip) 截断——同 IP 稳定可去重，不落明文 */
function ipHash(req: Request): string | null {
  const ip = clientIp(req);
  if (!ip) return null;
  const secret = process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me';
  return createHmac('sha256', secret).update(ip).digest('hex').slice(0, 32);
}

function parseDevice(userAgent: string): 'mobile' | 'tablet' | 'desktop' {
  if (/iPad|Tablet|PlayBook|Silk/i.test(userAgent)) return 'tablet';
  if (/Mobi|Android|iPhone|iPod/i.test(userAgent)) return 'mobile';
  return 'desktop';
}

function parsePlatform(req: Request, userAgent: string): ClientPlatform {
  const header = headerString(req.headers['x-client-platform']);
  if (header === 'app' || header === 'miniprogram' || header === 'web') return header;
  if (/miniProgram|MicroMessenger/i.test(userAgent)) return 'miniprogram';
  return 'web';
}

export function createAccessTracker(accessStats: AccessStatsRepo) {
  const jwtConfig = buildAuthConfig();

  const resolveUserId = (req: Request): string | null => {
    const authHeader = headerString(req.headers.authorization);
    if (!authHeader) return null;
    const token = authHeader.trim().split(/\s+/)[1];
    if (!token) return null;
    const verified = verifyAuthToken(token, jwtConfig);
    return verified.ok ? verified.payload.sub : null;
  };

  return (req: Request, res: Response, next: NextFunction): void => {
    const startedAt = Date.now();
    res.on('finish', () => {
      try {
        const path = req.path || '/';
        if (SKIP_PREFIXES.some((prefix) => path.startsWith(prefix)) || SKIP_EXTENSIONS.test(path)) return;

        const userAgent = headerString(req.headers['user-agent']) || '';
        const event: AccessEventRecord = {
          id: randomUUID(),
          userId: resolveUserId(req),
          sessionKey: headerString(req.headers['x-session-key'])?.slice(0, 64) || ipHash(req) || 'anonymous',
          platform: parsePlatform(req, userAgent),
          path: path.slice(0, 200),
          method: req.method,
          statusCode: res.statusCode,
          referer: headerString(req.headers.referer)?.slice(0, 200) || null,
          utmSource: headerString(req.headers['x-utm-source'])?.slice(0, 60) || null,
          device: parseDevice(userAgent),
          ipHash: ipHash(req),
          durationMs: Date.now() - startedAt,
          eventKind: 'api',
          createdAt: new Date().toISOString(),
        };
        accessStats.recordAccess(event).catch((error: any) => {
          console.warn('[access] record failed:', error?.message);
        });
      } catch {
        /* 埋点自身异常静默，不影响任何响应 */
      }
    });
    next();
  };
}

/** 前端页面浏览上报白名单（TabId）；防止脏 path 刷统计 */
const TRACKABLE_PAGES = new Set(['home', 'market-map', 'watchlist', 'stock-screener', 'stock-research', 'ai-teacher', 'mine', 'admin']);
const PAGEVIEW_MAX_DURATION_MS = 2 * 3600 * 1000;

/**
 * POST /api/track/view —— 前端页面浏览上报（PV 口径 + 停留时长）。
 * body: { path: TabId, durationMs: number, sessionKey?: string, platform?: 'web'|'app'|'miniprogram' }
 * 匿名可调；sendBeacon 无法带自定义 header，因此 sessionKey/platform 允许放 body。
 * 恶意/未知 path 静默忽略；写入失败不影响响应。
 */
export function createPageViewHandler(accessStats: AccessStatsRepo) {
  const jwtConfig = buildAuthConfig();
  return async (req: Request, res: Response): Promise<void> => {
    res.json({ ok: true }); // 先响应再落库，浏览器关页（sendBeacon）也不丢响应
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      const path = String(body.path || '').trim();
      if (!TRACKABLE_PAGES.has(path)) return;

      const rawDuration = Number(body.durationMs);
      const durationMs = Number.isFinite(rawDuration)
        ? Math.min(Math.max(0, Math.trunc(rawDuration)), PAGEVIEW_MAX_DURATION_MS)
        : null;

      const userAgent = headerString(req.headers['user-agent']) || '';
      const bodyPlatform = String(body.platform || '').trim();
      const platform: ClientPlatform = bodyPlatform === 'app' || bodyPlatform === 'miniprogram' || bodyPlatform === 'web'
        ? bodyPlatform
        : parsePlatform(req, userAgent);

      const authHeader = headerString(req.headers.authorization);
      let userId: string | null = null;
      if (authHeader) {
        const token = authHeader.trim().split(/\s+/)[1];
        if (token) {
          const verified = verifyAuthToken(token, jwtConfig);
          if (verified.ok) userId = verified.payload.sub;
        }
      }

      await accessStats.recordAccess({
        id: randomUUID(),
        userId,
        sessionKey: String(body.sessionKey || '').trim().slice(0, 64) || headerString(req.headers['x-session-key'])?.slice(0, 64) || ipHash(req) || 'anonymous',
        platform,
        path,
        method: req.method,
        statusCode: 200,
        referer: headerString(req.headers.referer)?.slice(0, 200) || null,
        utmSource: headerString(req.headers['x-utm-source'])?.slice(0, 60) || null,
        device: parseDevice(userAgent),
        ipHash: ipHash(req),
        durationMs,
        eventKind: 'pageview',
        createdAt: new Date().toISOString(),
      });
    } catch {
      /* 上报失败静默 */
    }
  };
}

/** 保留期（天）：定时任务按此清理明细 */
export const ACCESS_RETENTION_DAYS = 180;
