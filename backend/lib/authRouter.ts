/**
 * 认证 HTTP 路由：/api/auth/*
 * 安全注意：这些路由保持无状态，token 由客户端在 Authorization: Bearer 中携带。
 */
import { Router, type Request, type Response } from 'express';
import type { AuthService } from './authService.js';
import type { PublicUser } from './db/repositories.js';
import { ApiError } from './errors.js';

export function bearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (!header) return undefined;
  const [scheme, token] = header.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== 'bearer' || !token) return undefined;
  return token;
}

function sendApiError(res: Response, e: unknown): void {
  if (e instanceof ApiError) {
    res.status(e.status).json({ error: e.message });
    return;
  }
  console.error('[api] unexpected error:', e instanceof Error ? e.message : e);
  res.status(500).json({ error: '服务内部错误，请稍后重试。' });
}

export function createAuthRouter(auth: AuthService): Router {
  const router = Router();

  // POST /api/auth/register  { phone, nickname, password }
  router.post('/register', async (req, res) => {
    try {
      const { phone, nickname, password } = (req.body || {}) as Record<string, unknown>;
      const result = await auth.register(phone, nickname, password);
      res.json({ ok: true, token: result.token, user: result.user });
    } catch (e) {
      sendApiError(res, e);
    }
  });

  // POST /api/auth/login  { phone, password }
  router.post('/login', async (req, res) => {
    try {
      const { phone, password } = (req.body || {}) as Record<string, unknown>;
      const result = await auth.login(phone, password);
      res.json({ ok: true, token: result.token, user: result.user });
    } catch (e) {
      sendApiError(res, e);
    }
  });

  // GET /api/auth/me  → 当前登录用户
  router.get('/me', async (req, res) => {
    try {
      const { user } = await auth.authenticate(bearerToken(req));
      res.json({ user });
    } catch (e) {
      sendApiError(res, e);
    }
  });

  // PATCH /api/auth/me  { nickname }  → 改昵称
  router.patch('/me', async (req, res) => {
    try {
      const { user } = await auth.authenticate(bearerToken(req));
      const { nickname } = (req.body || {}) as Record<string, unknown>;
      const updated: PublicUser = await auth.updateNickname(user.id, nickname);
      res.json({ user: updated });
    } catch (e) {
      sendApiError(res, e);
    }
  });

  // POST /api/auth/logout  → 将当前 token 加入黑名单
  router.post('/logout', async (req, res) => {
    try {
      const { payload } = await auth.authenticate(bearerToken(req));
      await auth.logout(payload);
      res.json({ ok: true });
    } catch (e) {
      sendApiError(res, e);
    }
  });

  return router;
}