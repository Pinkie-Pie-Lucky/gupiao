import { Router, type Request, type Response } from 'express';
import type { AuthService } from './authService.js';
import { bearerToken } from './authRouter.js';
import type { ScreenerService } from './screenerService.js';
import { ApiError } from './errors.js';

type RefreshSaved = (userId: string, id: string) => Promise<unknown>;

function sendApiError(res: Response, error: unknown) {
  if (error instanceof ApiError) return res.status(error.status).json({ error: error.message });
  console.error('[saved-screeners] unexpected error:', error);
  return res.status(500).json({ error: '保存条件服务暂不可用。' });
}

export function createScreenerRouter(auth: AuthService, screeners: ScreenerService, refreshSaved: RefreshSaved) {
  const router = Router();
  const currentUser = async (req: Request) => (await auth.authenticate(bearerToken(req))).user;

  router.get('/', async (req, res) => {
    try { const user = await currentUser(req); res.json({ items: await screeners.list(user.id) }); } catch (error) { sendApiError(res, error); }
  });
  router.post('/', async (req, res) => {
    try { const user = await currentUser(req); res.json({ item: await screeners.create(user.id, req.body || {}) }); } catch (error) { sendApiError(res, error); }
  });
  router.delete('/:id', async (req, res) => {
    try { const user = await currentUser(req); await screeners.remove(user.id, req.params.id); res.json({ ok: true }); } catch (error) { sendApiError(res, error); }
  });
  router.post('/:id/refresh', async (req, res) => {
    try { const user = await currentUser(req); res.json({ item: await refreshSaved(user.id, req.params.id) }); } catch (error) { sendApiError(res, error); }
  });
  return router;
}
