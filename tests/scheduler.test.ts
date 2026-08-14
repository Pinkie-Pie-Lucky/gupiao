import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { planMarketRefresh, getShanghaiClock } from '../backend/lib/scheduler.js';

describe('planMarketRefresh', () => {
  it('周末不执行任何刷新', () => {
    assert.deepEqual(planMarketRefresh(0, 600), { active: false, refreshIndices: false, refreshAll: false });
    assert.deepEqual(planMarketRefresh(6, 600), { active: false, refreshIndices: false, refreshAll: false });
  });

  it('交易时段外（午休 / 盘前 / 收盘后）不执行', () => {
    assert.deepEqual(planMarketRefresh(3, 700), { active: false, refreshIndices: false, refreshAll: false });
    assert.deepEqual(planMarketRefresh(3, 569), { active: false, refreshIndices: false, refreshAll: false });
    assert.deepEqual(planMarketRefresh(3, 900), { active: false, refreshIndices: false, refreshAll: false });
  });

  it('上午盘 9:30 起每 5 分钟刷新指数、每 15 分钟刷新全量', () => {
    // 9:30 = 570，elapsed 0
    assert.deepEqual(planMarketRefresh(1, 570), { active: true, refreshIndices: true, refreshAll: true });
    // 9:31 = 571，elapsed 1
    assert.deepEqual(planMarketRefresh(1, 571), { active: true, refreshIndices: false, refreshAll: false });
    // 9:35 = 575，elapsed 5
    assert.deepEqual(planMarketRefresh(1, 575), { active: true, refreshIndices: true, refreshAll: false });
    // 9:45 = 585，elapsed 15
    assert.deepEqual(planMarketRefresh(1, 585), { active: true, refreshIndices: true, refreshAll: true });
  });

  it('下午盘 13:00 起重新对齐整点', () => {
    // 13:00 = 780，elapsed 0
    assert.deepEqual(planMarketRefresh(2, 780), { active: true, refreshIndices: true, refreshAll: true });
    // 13:15 = 795，elapsed 15
    assert.deepEqual(planMarketRefresh(2, 795), { active: true, refreshIndices: true, refreshAll: true });
    // 14:59 = 899，elapsed 119
    assert.deepEqual(planMarketRefresh(2, 899), { active: true, refreshIndices: false, refreshAll: false });
  });

  it('11:30(690) 收盘时刻不执行（含 690 起始点）', () => {
    assert.deepEqual(planMarketRefresh(1, 690), { active: false, refreshIndices: false, refreshAll: false });
  });
});

describe('getShanghaiClock', () => {
  it('返回上海时区星期与分钟数', () => {
    // 2026-08-14 是周五；用明确的 UTC 时间验证 Asia/Shanghai 偏移
    const clock = getShanghaiClock(new Date('2026-08-14T01:30:00Z'));
    assert.equal(clock.dayOfWeek, 5);
    // UTC 01:30 = 上海 09:30
    assert.equal(clock.minutes, 9 * 60 + 30);
  });
});
