/**
 * 管理端路由：/api/admin/*（全部要求 admin 角色）。
 * 权限闸门在这里：前端隐藏入口只是体验，403 才是真闸门。
 * 统计口径：上海时区自然日；UV 按 session_key 去重（含匿名），DAU 按登录 user_id 去重。
 */
import { Router, type Request, type Response } from 'express';
import type { AuthService } from './authService.js';
import type { DbRuntime } from './db/runtime.js';
import type { PublicUser } from './db/repositories.js';
import { ApiError } from './errors.js';
import { bearerToken } from './authRouter.js';

/** 上海时区某自然日零点对应的 UTC 时刻（daysAgo=0 即今日） */
function shanghaiDayStart(daysAgo = 0): Date {
  const shifted = new Date(Date.now() + 8 * 3600 * 1000 - daysAgo * 24 * 3600 * 1000);
  const dateKey = shifted.toISOString().slice(0, 10);
  return new Date(`${dateKey}T00:00:00+08:00`);
}

function sendApiError(res: Response, e: unknown): void {
  if (e instanceof ApiError) {
    res.status(e.status).json({ error: e.message });
    return;
  }
  console.error('[admin] unexpected error:', e instanceof Error ? e.message : e);
  res.status(500).json({ error: '服务内部错误，请稍后重试。' });
}

async function requireAdmin(auth: AuthService, req: Request): Promise<PublicUser> {
  const { user } = await auth.authenticate(bearerToken(req)); // 401/封禁 403 逻辑复用 authenticate
  if (user.role !== 'admin') throw new ApiError('无权限访问。', 403);
  return user;
}

function intQuery(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function createAdminRouter(auth: AuthService, dbRuntime: DbRuntime): Router {
  const router = Router();

  // GET /api/admin/stats/overview → 今日 / 近7天 / 近30天 访问概览 + 今日平均使用时长（按平台细分）
  router.get('/stats/overview', async (req, res) => {
    try {
      await requireAdmin(auth, req);
      const buildPeriod = async (daysAgo: number) => {
        const since = shanghaiDayStart(daysAgo);
        const [traffic, newUsers] = await Promise.all([
          dbRuntime.accessStats.periodStats(since),
          dbRuntime.users.countCreatedSince(since),
        ]);
        return { pv: traffic.pv, uv: traffic.uv, dau: traffic.dau, newUsers };
      };
      const [today, recent7d, recent30d, sessionDuration] = await Promise.all([
        buildPeriod(0),
        buildPeriod(6),
        buildPeriod(29),
        dbRuntime.accessStats.sessionDurations(shanghaiDayStart(0)),
      ]);
      res.json({ today, recent7d, recent30d, sessionDuration });
    } catch (e) {
      sendApiError(res, e);
    }
  });

  // GET /api/admin/stats/pages?days=30 → 各页面浏览次数与平均停留时长
  router.get('/stats/pages', async (req, res) => {
    try {
      await requireAdmin(auth, req);
      const days = intQuery(req.query.days, 30, 1, 90);
      const pages = await dbRuntime.accessStats.pageStats(days);
      res.json({ days, pages });
    } catch (e) {
      sendApiError(res, e);
    }
  });

  // GET /api/admin/stats/traffic?days=30 → 按天曲线、来源/设备/平台分布
  router.get('/stats/traffic', async (req, res) => {
    try {
      await requireAdmin(auth, req);
      const days = intQuery(req.query.days, 30, 1, 90);
      const traffic = await dbRuntime.accessStats.traffic(days);
      res.json(traffic);
    } catch (e) {
      sendApiError(res, e);
    }
  });

  // GET /api/admin/users?search=&offset=&limit= → 用户列表（分页 + 搜索）
  router.get('/users', async (req, res) => {
    try {
      await requireAdmin(auth, req);
      const search = typeof req.query.search === 'string' ? req.query.search.slice(0, 40) : '';
      const result = await dbRuntime.users.list({
        search,
        offset: intQuery(req.query.offset, 0, 0, 1_000_000),
        limit: intQuery(req.query.limit, 20, 1, 100),
      });
      res.json(result);
    } catch (e) {
      sendApiError(res, e);
    }
  });

  // PATCH /api/admin/users/:id/status { status: 'active' | 'banned' } → 封禁 / 解封
  router.patch('/users/:id/status', async (req, res) => {
    try {
      const me = await requireAdmin(auth, req);
      const { id } = req.params;
      const status = req.body?.status;
      if (status !== 'active' && status !== 'banned') {
        throw new ApiError('status 仅支持 active / banned。', 400);
      }
      if (id === me.id) throw new ApiError('不能操作自己的账号状态。', 400);
      const updated = await dbRuntime.users.updateStatus(id, status);
      if (!updated) throw new ApiError('用户不存在。', 404);
      // 封禁后该用户全部存量 token 因 authenticate 每次查库而即时失效，无需逐个拉黑
      res.json({ user: { id: updated.id, phone: updated.phone, nickname: updated.nickname, role: updated.role, status: updated.status } });
    } catch (e) {
      sendApiError(res, e);
    }
  });

  return router;
}
