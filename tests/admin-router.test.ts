/**
 * 管理端路由集成测试：权限闸门（401/403/200）与统计接口行为。
 * 用内存仓储 + 临时 HTTP server 起真实 Express 栈，fetch 断言。
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { AuthService } from '../backend/lib/authService.js';
import { createAdminRouter } from '../backend/lib/adminRouter.js';
import { createPageViewHandler } from '../backend/lib/accessTracking.js';
import {
  InMemoryUserRepo, InMemoryBlacklistRepo, InMemoryAccessStatsRepo,
} from '../backend/lib/db/inMemoryRepositories.js';
import { createRuntime, resetRuntime, type DbRuntime } from '../backend/lib/db/runtime.js';
import { randomUUID } from 'node:crypto';

async function jsonFetch(url: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(url, init);
  let body: any = null;
  try { body = await res.json(); } catch { /* non-json */ }
  return { status: res.status, body };
}

describe('管理端路由权限闸门', () => {
  let server: import('node:http').Server;
  let baseUrl = '';
  let dbRuntime: DbRuntime;
  const adminToken = { value: '' };
  const userToken = { value: '' };
  const bannedToken = { value: '' };
  const adminPhone = '13911110000';

  before(async () => {
    await resetRuntime();
    delete process.env.DATABASE_URL; // 强制内存仓储，避免本地 PG 状态影响测试
    dbRuntime = await createRuntime();
    const auth = new AuthService({
      users: dbRuntime.users,
      blacklist: dbRuntime.blacklist,
      jwtConfig: { secret: 'test-secret', expiresInSeconds: 3600 },
    });

    const app = express();
    app.use(express.json());
    app.use('/api/admin', createAdminRouter(auth, dbRuntime));
    app.post('/api/track/view', createPageViewHandler(dbRuntime.accessStats));
    // 辅助注册/登录端点（仅为测试供给 token，不引入完整 authRouter）
    app.post('/test/register', async (req, res) => {
      try {
        const result = await auth.register(req.body.phone, req.body.nickname, 'secret123');
        res.json(result);
      } catch (e: any) { res.status(e.status || 500).json({ error: e.message }); }
    });
    app.post('/test/login', async (req, res) => {
      try {
        const result = await auth.login(req.body.phone, 'secret123');
        res.json(result);
      } catch (e: any) { res.status(e.status || 500).json({ error: e.message }); }
    });

    // 白名单管理员 + 普通用户
    process.env.ADMIN_PHONES = adminPhone;
    const admin = await auth.register(adminPhone, '管理员', 'secret123');
    adminToken.value = admin.token;
    const user = await auth.register('13811112222', '普通用户', 'secret123');
    userToken.value = user.token;
    const bannedUser = await auth.register('13811113333', '被封禁用户', 'secret123');
    bannedToken.value = bannedUser.token;
    await dbRuntime.users.updateStatus(bannedUser.user.id, 'banned');
    delete process.env.ADMIN_PHONES;

    // 造访问数据：管理员 2 次（不同 sessionKey）+ 普通用户 1 次登录访问（api 事件）
    await dbRuntime.accessStats.recordAccess({
      id: randomUUID(), userId: admin.user.id, sessionKey: 's-admin-1', platform: 'web',
      path: '/', method: 'GET', statusCode: 200, referer: 'https://example.com', utmSource: null,
      device: 'desktop', ipHash: null, durationMs: 5, eventKind: 'api', createdAt: new Date().toISOString(),
    });
    await dbRuntime.accessStats.recordAccess({
      id: randomUUID(), userId: admin.user.id, sessionKey: 's-admin-2', platform: 'miniprogram',
      path: '/api/sectors', method: 'GET', statusCode: 200, referer: null, utmSource: 'share',
      device: 'mobile', ipHash: null, durationMs: 8, eventKind: 'api', createdAt: new Date().toISOString(),
    });
    await dbRuntime.accessStats.recordAccess({
      id: randomUUID(), userId: user.user.id, sessionKey: 's-user-1', platform: 'web',
      path: '/api/chat', method: 'POST', statusCode: 200, referer: null, utmSource: null,
      device: 'desktop', ipHash: null, durationMs: 100, eventKind: 'api', createdAt: new Date().toISOString(),
    });
    // 页面浏览（PV 口径 + 停留时长）：user session 60s、另一个匿名 web session 30s
    await dbRuntime.accessStats.recordAccess({
      id: randomUUID(), userId: user.user.id, sessionKey: 's-user-1', platform: 'web',
      path: 'home', method: 'POST', statusCode: 200, referer: null, utmSource: null,
      device: 'desktop', ipHash: null, durationMs: 60_000, eventKind: 'pageview', createdAt: new Date().toISOString(),
    });
    await dbRuntime.accessStats.recordAccess({
      id: randomUUID(), userId: null, sessionKey: 's-anon-9', platform: 'web',
      path: 'ai-teacher', method: 'POST', statusCode: 200, referer: null, utmSource: null,
      device: 'desktop', ipHash: null, durationMs: 30_000, eventKind: 'pageview', createdAt: new Date().toISOString(),
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await resetRuntime();
  });

  it('未登录访问管理接口返回 401', async () => {
    const res = await jsonFetch(`${baseUrl}/api/admin/stats/overview`);
    assert.equal(res.status, 401);
  });

  it('普通用户访问管理接口返回 403', async () => {
    for (const path of ['/api/admin/stats/overview', '/api/admin/stats/traffic', '/api/admin/users']) {
      const res = await jsonFetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${userToken.value}` } });
      assert.equal(res.status, 403, `${path} 应返回 403`);
    }
  });

  it('被封禁用户即使持有有效签名 token 也返回 403', async () => {
    const res = await jsonFetch(`${baseUrl}/api/admin/stats/overview`, { headers: { Authorization: `Bearer ${bannedToken.value}` } });
    assert.equal(res.status, 403);
  });

  it('管理员访问 overview：UV/PV/DAU/新增注册口径正确，含平均使用时长', async () => {
    const res = await jsonFetch(`${baseUrl}/api/admin/stats/overview`, { headers: { Authorization: `Bearer ${adminToken.value}` } });
    assert.equal(res.status, 200);
    const { today } = res.body;
    assert.equal(today.pv, 2);            // 只算 pageview
    assert.equal(today.uv, 4);            // s-admin-1/2 + s-user-1 + s-anon-9
    assert.equal(today.dau, 2);
    assert.equal(today.newUsers, 3);
    assert.ok(res.body.recent7d && res.body.recent30d);
    // 平均使用时长：(60s + 30s) / 2 = 45s；均为 web 平台
    assert.equal(res.body.sessionDuration.avgSessionDurationMs, 45_000);
    const web = res.body.sessionDuration.byPlatform.find((row: any) => row.platform === 'web');
    assert.equal(web.sessions, 2);
    assert.equal(web.avgSessionDurationMs, 45_000);
  });

  it('管理员访问 pages：页面浏览与停留时长排行', async () => {
    const res = await jsonFetch(`${baseUrl}/api/admin/stats/pages?days=7`, { headers: { Authorization: `Bearer ${adminToken.value}` } });
    assert.equal(res.status, 200);
    const home = res.body.pages.find((row: any) => row.path === 'home');
    assert.equal(home.views, 1);
    assert.equal(home.avgDurationMs, 60_000);
    const teacher = res.body.pages.find((row: any) => row.path === 'ai-teacher');
    assert.equal(teacher.avgDurationMs, 30_000);
  });

  it('页面浏览上报：合法 path 记为 pageview，未知 path 被忽略', async () => {
    const before = await jsonFetch(`${baseUrl}/api/admin/stats/overview`, { headers: { Authorization: `Bearer ${adminToken.value}` } });
    const pvBefore = before.body.today.pv;

    const ok = await jsonFetch(`${baseUrl}/api/track/view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'home', durationMs: 12_345, sessionKey: 's-report-1', platform: 'web' }),
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.ok, true);

    // 未知 path：返回 ok 但不落库
    const ignored = await jsonFetch(`${baseUrl}/api/track/view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'javascript:evil', durationMs: 100 }),
    });
    assert.equal(ignored.status, 200);

    await new Promise((resolve) => setTimeout(resolve, 100)); // handler 先响应后落库
    const after = await jsonFetch(`${baseUrl}/api/admin/stats/overview`, { headers: { Authorization: `Bearer ${adminToken.value}` } });
    assert.equal(after.body.today.pv, pvBefore + 1);

    const pages = await jsonFetch(`${baseUrl}/api/admin/stats/pages?days=1`, { headers: { Authorization: `Bearer ${adminToken.value}` } });
    const home = pages.body.pages.find((row: any) => row.path === 'home');
    // home 平均时长包含新上报的 12.345s：(60s + 12.345s) / 2
    assert.equal(home.avgDurationMs, 36_173);
  });

  it('管理员访问 traffic：来源/平台分布包含埋点数据', async () => {
    const res = await jsonFetch(`${baseUrl}/api/admin/stats/traffic?days=7`, { headers: { Authorization: `Bearer ${adminToken.value}` } });
    assert.equal(res.status, 200);
    assert.equal(res.body.daily.length, 7);
    assert.equal(res.body.daily[6].pv, 3);
    assert.ok(res.body.referers.some((row: any) => row.referer === 'https://example.com'));
    assert.ok(res.body.referers.some((row: any) => row.referer === 'direct'));
    assert.ok(res.body.platforms.some((row: any) => row.platform === 'miniprogram' && row.count === 1));
  });

  it('用户列表返回全部用户；封禁/解封操作生效且不能操作自己', async () => {
    const listRes = await jsonFetch(`${baseUrl}/api/admin/users?limit=10`, { headers: { Authorization: `Bearer ${adminToken.value}` } });
    assert.equal(listRes.status, 200);
    assert.equal(listRes.body.total, 3);
    const target = listRes.body.rows.find((row: any) => row.phone === '13811112222');
    assert.ok(target);

    const banRes = await jsonFetch(`${baseUrl}/api/admin/users/${target.id}/status`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken.value}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'banned' }),
    });
    assert.equal(banRes.status, 200);
    assert.equal(banRes.body.user.status, 'banned');

    // 被封禁用户立即失去所有访问能力
    const denied = await jsonFetch(`${baseUrl}/api/admin/users`, { headers: { Authorization: `Bearer ${userToken.value}` } });
    assert.equal(denied.status, 403);

    // 解封恢复
    const unbanRes = await jsonFetch(`${baseUrl}/api/admin/users/${target.id}/status`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken.value}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    });
    assert.equal(unbanRes.status, 200);
    assert.equal(unbanRes.body.user.status, 'active');

    // 不能操作自己
    const selfList = await jsonFetch(`${baseUrl}/api/admin/users?search=13911110000`, { headers: { Authorization: `Bearer ${adminToken.value}` } });
    const selfId = selfList.body.rows[0].id;
    const selfBan = await jsonFetch(`${baseUrl}/api/admin/users/${selfId}/status`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken.value}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'banned' }),
    });
    assert.equal(selfBan.status, 400);
  });

  it('非法 status 值返回 400', async () => {
    const listRes = await jsonFetch(`${baseUrl}/api/admin/users?search=13811112222`, { headers: { Authorization: `Bearer ${adminToken.value}` } });
    const target = listRes.body.rows[0];
    const res = await jsonFetch(`${baseUrl}/api/admin/users/${target.id}/status`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken.value}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'hacked' }),
    });
    assert.equal(res.status, 400);
  });
});
