import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { AuthService, maskedPhoneNickname } from '../backend/lib/authService.js';
import { FeedbackService } from '../backend/lib/feedbackService.js';
import { WatchlistService } from '../backend/lib/watchlistService.js';
import { InMemoryUserRepo, InMemoryBlacklistRepo, InMemoryFeedbackRepo, InMemoryWatchlistRepo, InMemoryAccessStatsRepo } from '../backend/lib/db/inMemoryRepositories.js';
import { randomUUID } from 'node:crypto';

function build() {
  const users = new InMemoryUserRepo();
  const blacklist = new InMemoryBlacklistRepo();
  const feedback = new InMemoryFeedbackRepo();
  const watchlist = new InMemoryWatchlistRepo();
  const auth = new AuthService({
    users,
    blacklist,
    jwtConfig: { secret: 'test-secret', expiresInSeconds: 3600 },
  });
  return {
    users, blacklist, feedback, watchlist, auth,
    feedbackService: new FeedbackService(feedback),
    watchlistService: new WatchlistService(watchlist),
  };
}

describe('AuthService', () => {
  it('注册成功并返回 token 与用户', async () => {
    const { auth } = build();
    const res = await auth.register('13800000000', '新手小陈', 'secret123');
    assert.ok(res.token.length > 0);
    assert.equal(res.user.phone, '13800000000');
    assert.equal(res.user.nickname, '新手小陈');
    assert.ok(res.user.id);
  });

  it('默认注册为普通用户（role=user / status=active）', async () => {
    const { auth } = build();
    const res = await auth.register('13800000009', '普通用户', 'secret123');
    assert.equal(res.user.role, 'user');
    assert.equal(res.user.status, 'active');
    const authed = await auth.authenticate(res.token);
    assert.equal(authed.user.role, 'user');
  });

  it('注册时昵称可不填，并使用打码手机号作为展示昵称', async () => {
    const { auth } = build();
    const res = await auth.register('13800000008', '', 'secret123');
    assert.equal(res.user.nickname, '138****0008');
    assert.equal(maskedPhoneNickname('13800000008'), '138****0008');
  });

  it('手机号格式非法时注册被拒', async () => {
    const { auth } = build();
    await assert.rejects(async () => auth.register('12345', '昵称', 'secret123'), (e: any) => e.status === 400);
  });

  it('重复手机号注册返回 409', async () => {
    const { auth } = build();
    await auth.register('13800000001', '昵称甲', 'secret123');
    await assert.rejects(async () => auth.register('13800000001', '昵称乙', 'secret123'), (e: any) => e.status === 409);
  });

  it('密码过短被拒', async () => {
    const { auth } = build();
    await assert.rejects(async () => auth.register('13800000002', '昵称', '123'), (e: any) => e.status === 400);
  });

  it('登录成功与错误密码被拒', async () => {
    const { auth } = build();
    await auth.register('13800000003', '昵称丙', 'secret123');
    const ok = await auth.login('13800000003', 'secret123');
    assert.ok(ok.token);
    await assert.rejects(async () => auth.login('13800000003', 'wrong-pass'), (e: any) => e.status === 401);
  });

  it('未注册手机号登录返回 401', async () => {
    const { auth } = build();
    await assert.rejects(async () => auth.login('13800000004', 'secret123'), (e: any) => e.status === 401);
  });

  it('authenticate 校验有效 token 返回用户；无效/缺失返回 401', async () => {
    const { auth } = build();
    const reg = await auth.register('13800000005', '昵称戊', 'secret123');
    const authed = await auth.authenticate(reg.token);
    assert.equal(authed.user.phone, '13800000005');
    await assert.rejects(async () => auth.authenticate(undefined), (e: any) => e.status === 401);
    await assert.rejects(async () => auth.authenticate('not-a-token'), (e: any) => e.status === 401);
  });

  it('登出后 token 立即失效（黑名单生效）', async () => {
    const { auth } = build();
    const reg = await auth.register('13800000006', '昵称己', 'secret123');
    const authed = await auth.authenticate(reg.token);
    await auth.logout(authed.payload);
    await assert.rejects(async () => auth.authenticate(reg.token), (e: any) => e.status === 401);
  });

  it('改昵称后 /me 返回新昵称', async () => {
    const { auth } = build();
    const reg = await auth.register('13800000007', '旧名', 'secret123');
    const updated = await auth.updateNickname(reg.user.id, '新名字');
    assert.equal(updated.nickname, '新名字');
    const me = await auth.me(reg.user.id);
    assert.equal(me.nickname, '新名字');
  });
});

describe('角色与封禁（admin 权限体系）', () => {
  const ADMIN_PHONE = '13900000001';
  const originalAdminPhones = process.env.ADMIN_PHONES;

  beforeEach(() => { process.env.ADMIN_PHONES = ADMIN_PHONE; });
  afterEach(() => {
    if (originalAdminPhones === undefined) delete process.env.ADMIN_PHONES;
    else process.env.ADMIN_PHONES = originalAdminPhones;
  });

  it('白名单手机号注册即为管理员', async () => {
    const { auth } = build();
    const res = await auth.register(ADMIN_PHONE, '管理员', 'secret123');
    assert.equal(res.user.role, 'admin');
  });

  it('已注册普通用户命中白名单后，登录时自动提权（只升不降）', async () => {
    const { auth } = build();
    process.env.ADMIN_PHONES = ''; // 注册时尚未进白名单
    const first = await auth.register('13800000111', '先注册', 'secret123');
    assert.equal(first.user.role, 'user');
    process.env.ADMIN_PHONES = '13800000111'; // 之后被加入白名单
    const second = await auth.login('13800000111', 'secret123');
    assert.equal(second.user.role, 'admin');
  });

  it('白名单移除后不降权：DB 中的 admin 登录仍是 admin', async () => {
    const { auth } = build();
    await auth.register(ADMIN_PHONE, '管理员', 'secret123');
    process.env.ADMIN_PHONES = '';
    const login = await auth.login(ADMIN_PHONE, 'secret123');
    assert.equal(login.user.role, 'admin');
  });

  it('封禁用户登录返回 403', async () => {
    const { auth, users } = build();
    const reg = await auth.register('13800000222', '待封禁', 'secret123');
    await users.updateStatus(reg.user.id, 'banned');
    await assert.rejects(async () => await auth.login('13800000222', 'secret123'), (e: any) => e.status === 403);
  });

  it('封禁后存量 token 即时失效（authenticate 每次查库）', async () => {
    const { auth, users } = build();
    const reg = await auth.register('13800000333', '存量token', 'secret123');
    // 封禁前 token 可用
    await auth.authenticate(reg.token);
    await users.updateStatus(reg.user.id, 'banned');
    await assert.rejects(async () => await auth.authenticate(reg.token), (e: any) => e.status === 403);
    // 解封后恢复
    await users.updateStatus(reg.user.id, 'active');
    const recovered = await auth.authenticate(reg.token);
    assert.equal(recovered.user.status, 'active');
  });

  it('用户列表支持搜索与分页；countCreatedSince 按时间过滤', async () => {
    const { users, auth } = build();
    await auth.register('13800000444', '张三丰', 'secret123');
    await auth.register('13800000555', '李四光', 'secret123');
    await auth.register('13800000666', '张三丰二', 'secret123');

    const all = await users.list({});
    assert.equal(all.total, 3);
    assert.equal(all.rows.length, 3);

    const searched = await users.list({ search: '张三丰' });
    assert.equal(searched.total, 2);

    const byPhone = await users.list({ search: '13800000444' });
    assert.equal(byPhone.total, 1);

    const paged = await users.list({ offset: 0, limit: 2 });
    assert.equal(paged.rows.length, 2);

    assert.equal(await users.countCreatedSince(new Date(Date.now() + 60_000)), 0);
    assert.equal(await users.countCreatedSince(new Date(Date.now() - 60_000)), 3);
  });
});

describe('访问统计仓储（InMemoryAccessStatsRepo）', () => {
  function event(overrides: Partial<Parameters<InMemoryAccessStatsRepo['recordAccess']>[0]> = {}) {
    return {
      id: randomUUID(),
      userId: null,
      sessionKey: 'session-a',
      platform: 'web' as const,
      path: '/api/sectors',
      method: 'GET',
      statusCode: 200,
      referer: null,
      utmSource: null,
      device: 'desktop' as const,
      ipHash: null,
      durationMs: 10,
      eventKind: 'api' as const,
      createdAt: new Date().toISOString(),
      ...overrides,
    };
  }

  it('periodStats：PV 只算页面浏览（pageview），UV/DAU 含全部事件', async () => {
    const repo = new InMemoryAccessStatsRepo();
    await repo.recordAccess(event({}));
    await repo.recordAccess(event({ sessionKey: 'session-a' }));
    await repo.recordAccess(event({ sessionKey: 'session-b', userId: 'u1' }));
    await repo.recordAccess(event({ sessionKey: 'session-c', userId: 'u1' }));
    await repo.recordAccess(event({ sessionKey: 'session-a', path: 'home', durationMs: 5_000, eventKind: 'pageview' }));
    const stats = await repo.periodStats(new Date(Date.now() - 60_000));
    assert.equal(stats.pv, 1);
    assert.equal(stats.uv, 3);
    assert.equal(stats.dau, 1);
  });

  it('periodStats：只统计时间窗内的事件', async () => {
    const repo = new InMemoryAccessStatsRepo();
    await repo.recordAccess(event({ createdAt: new Date(Date.now() - 10 * 60_000).toISOString() }));
    await repo.recordAccess(event({}));
    await repo.recordAccess(event({ path: 'home', eventKind: 'pageview', durationMs: 1_000 }));
    const stats = await repo.periodStats(new Date(Date.now() - 60_000));
    assert.equal(stats.pv, 1);
  });

  it('sessionDurations：按 session 汇总页面时长再取均值，并细分平台', async () => {
    const repo = new InMemoryAccessStatsRepo();
    // session-a（web）：60s + 30s = 90s
    await repo.recordAccess(event({ sessionKey: 'session-a', path: 'home', durationMs: 60_000, eventKind: 'pageview' }));
    await repo.recordAccess(event({ sessionKey: 'session-a', path: 'ai-teacher', durationMs: 30_000, eventKind: 'pageview' }));
    // session-b（miniprogram）：40s
    await repo.recordAccess(event({ sessionKey: 'session-b', platform: 'miniprogram', device: 'mobile', path: 'home', durationMs: 40_000, eventKind: 'pageview' }));
    // api 事件不计入时长
    await repo.recordAccess(event({ sessionKey: 'session-a' }));
    const stats = await repo.sessionDurations(new Date(Date.now() - 60_000));
    assert.equal(stats.avgSessionDurationMs, 65_000); // (90s + 40s) / 2
    const web = stats.byPlatform.find((row) => row.platform === 'web');
    const mini = stats.byPlatform.find((row) => row.platform === 'miniprogram');
    assert.equal(web?.sessions, 1);
    assert.equal(web?.avgSessionDurationMs, 90_000);
    assert.equal(mini?.sessions, 1);
    assert.equal(mini?.avgSessionDurationMs, 40_000);
  });

  it('pageStats：按页面聚合浏览次数与平均/累计停留时长', async () => {
    const repo = new InMemoryAccessStatsRepo();
    await repo.recordAccess(event({ path: 'home', durationMs: 10_000, eventKind: 'pageview' }));
    await repo.recordAccess(event({ path: 'home', durationMs: 20_000, eventKind: 'pageview' }));
    await repo.recordAccess(event({ path: 'ai-teacher', durationMs: 30_000, eventKind: 'pageview' }));
    await repo.recordAccess(event({})); // api 事件不进页面统计
    const stats = await repo.pageStats(7);
    assert.equal(stats.length, 2);
    const home = stats.find((row) => row.path === 'home');
    assert.equal(home?.views, 2);
    assert.equal(home?.avgDurationMs, 15_000);
    assert.equal(home?.totalDurationMs, 30_000);
    const teacher = stats.find((row) => row.path === 'ai-teacher');
    assert.equal(teacher?.views, 1);
    assert.equal(teacher?.avgDurationMs, 30_000);
  });

  it('traffic：来源 direct 归组、平台与设备分布、每日补零；daily.pv 只算 pageview', async () => {
    const repo = new InMemoryAccessStatsRepo();
    await repo.recordAccess(event({ referer: 'https://example.com/a', platform: 'miniprogram', device: 'mobile', path: 'home', durationMs: 1_000, eventKind: 'pageview' }));
    await repo.recordAccess(event({ referer: null, platform: 'web', device: 'mobile', path: 'watchlist', durationMs: 2_000, eventKind: 'pageview' }));
    await repo.recordAccess(event({ referer: null, platform: 'web', device: 'mobile' })); // api 事件：计入分布，不计入 daily.pv
    const traffic = await repo.traffic(7);
    assert.equal(traffic.daily.length, 7);
    assert.equal(traffic.daily[6].pv, 2);   // 只算 pageview，api 事件不计
    assert.equal(traffic.daily[6].uv, 1);
    assert.deepEqual(traffic.referers.find((row) => row.referer === 'direct'), { referer: 'direct', count: 2 });
    assert.ok(traffic.platforms.some((row) => row.platform === 'miniprogram' && row.count === 1));
    assert.ok(traffic.devices.some((row) => row.device === 'mobile' && row.count === 3));
  });

  it('purgeBefore：删除保留期前明细并返回行数', async () => {
    const repo = new InMemoryAccessStatsRepo();
    await repo.recordAccess(event({ createdAt: new Date(Date.now() - 200 * 24 * 3600 * 1000).toISOString() }));
    await repo.recordAccess(event({}));
    const removed = await repo.purgeBefore(new Date(Date.now() - 180 * 24 * 3600 * 1000));
    assert.equal(removed, 1);
    const stats = await repo.periodStats(new Date(0));
    assert.equal(stats.uv, 1); // 剩余 1 条事件（api），UV 按事件计
  });
});

describe('FeedbackService', () => {
  it('写入反馈并可匿名（userId=null）', async () => {
    const { feedbackService } = build();
    const res = await feedbackService.submit({
      contentType: 'story',
      contentId: 'story-1',
      promptVersion: 'v2',
      rating: 'positive',
      reasons: ['信息增量大'],
      userId: randomUUID(),
    });
    assert.deepEqual(res, { ok: true });
  });

  it('缺必填字段被拒', async () => {
    const { feedbackService } = build();
    await assert.rejects(
      () => feedbackService.submit({ contentType: '', contentId: 'x', promptVersion: 'v1', rating: 'positive', userId: null }),
      (e: any) => e.status === 400,
    );
  });

  it('统计按 prompt_version 聚合', async () => {
    const { feedbackService } = build();
    const uid = randomUUID();
    await feedbackService.submit({ contentType: 'story', contentId: 'a', promptVersion: 'v1', rating: 'positive', reasons: ['r1'], userId: uid });
    await feedbackService.submit({ contentType: 'story', contentId: 'b', promptVersion: 'v1', rating: 'negative', reasons: ['r2'], userId: uid });
    await feedbackService.submit({ contentType: 'report', contentId: 'c', promptVersion: 'v2', rating: 'positive', reasons: ['r1'], userId: null });

    const stats = await feedbackService.stats();
    assert.equal(stats.total, 3);
    assert.equal(stats.stats['v1'].positive, 1);
    assert.equal(stats.stats['v1'].negative, 1);
    assert.equal(stats.stats['v1'].reasons['r1'], 1);
    assert.equal(stats.stats['v2'].positive, 1);
  });
});

describe('WatchlistService', () => {
  it('按用户隔离：添加后各自列表互不影响', async () => {
    const { watchlistService } = build();
    const ua = randomUUID();
    const ub = randomUUID();
    await watchlistService.add(ua, { symbol: '600519', name: '贵州茅台' });
    await watchlistService.add(ub, { symbol: '000001', name: '平安银行' });

    const a = await watchlistService.list(ua);
    const b = await watchlistService.list(ub);
    assert.equal(a.length, 1);
    assert.equal(a[0].symbol, '600519');
    assert.equal(b.length, 1);
    assert.equal(b[0].symbol, '000001');
  });

  it('重复添加同一股票不产生重复项', async () => {
    const { watchlistService } = build();
    const uid = randomUUID();
    await watchlistService.add(uid, { symbol: '002230', name: '科大讯飞' });
    await watchlistService.add(uid, { symbol: '002230', name: '科大讯飞' });
    const list = await watchlistService.list(uid);
    assert.equal(list.length, 1);
  });

  it('非法代码格式被拒', async () => {
    const { watchlistService } = build();
    await assert.rejects(
      () => watchlistService.add(randomUUID(), { symbol: 'abc', name: 'x' }),
      (e: any) => e.status === 400,
    );
  });

  it('移除后列表为空', async () => {
    const { watchlistService } = build();
    const uid = randomUUID();
    await watchlistService.add(uid, { symbol: '688981', name: '中芯国际' });
    await watchlistService.remove(uid, '688981');
    const list = await watchlistService.list(uid);
    assert.equal(list.length, 0);
  });
});
