import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AuthService } from '../backend/lib/authService.js';
import { FeedbackService } from '../backend/lib/feedbackService.js';
import { WatchlistService } from '../backend/lib/watchlistService.js';
import { InMemoryUserRepo, InMemoryBlacklistRepo, InMemoryFeedbackRepo, InMemoryWatchlistRepo } from '../backend/lib/db/inMemoryRepositories.js';
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