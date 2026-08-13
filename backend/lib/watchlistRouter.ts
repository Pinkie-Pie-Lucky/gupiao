/**
 * 自选股 HTTP 路由：/api/watchlist（需登录，Bearer JWT）。
 * GET    /api/watchlist          → 列表
 * POST   /api/watchlist          → 添加 { symbol, name }
 * DELETE /api/watchlist/:symbol  → 移除
 */
import { Router, type Request, type Response } from 'express';
import type { AuthService } from './authService.js';
import type { WatchlistService } from './watchlistService.js';
import { bearerToken } from './authRouter.js';
import { ApiError } from './errors.js';

function sendApiError(res: Response, e: unknown): void {
  if (e instanceof ApiError) {
    res.status(e.status).json({ error: e.message });
    return;
  }
  console.error('[api] unexpected error:', e instanceof Error ? e.message : e);
  res.status(500).json({ error: '服务内部错误，请稍后重试。' });
}

export function createWatchlistRouter(auth: AuthService, watchlist: WatchlistService): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    try {
      const { user } = await auth.authenticate(bearerToken(req));
      const items = await watchlist.list(user.id);
      res.json({ items });
    } catch (e) {
      sendApiError(res, e);
    }
  });

  router.post('/', async (req, res) => {
    try {
      const { user } = await auth.authenticate(bearerToken(req));
      const body = (req.body || {}) as Record<string, unknown>;
      const item = await watchlist.add(user.id, { symbol: body.symbol, name: body.name });
      res.json({ ok: true, item });
    } catch (e) {
      sendApiError(res, e);
    }
  });

  router.delete('/:symbol', async (req, res) => {
    try {
      const { user } = await auth.authenticate(bearerToken(req));
      await watchlist.remove(user.id, req.params.symbol);
      res.json({ ok: true });
    } catch (e) {
      sendApiError(res, e);
    }
  });

  return router;
}