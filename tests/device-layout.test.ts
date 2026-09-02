import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyDeviceLayout } from '../frontend/src/lib/deviceLayout';

test('手机或窄屏使用移动端布局', () => {
  assert.equal(classifyDeviceLayout({ width: 375, coarsePointer: true, canHover: false, mobileUserAgent: true }), 'mobile');
  assert.equal(classifyDeviceLayout({ width: 640, coarsePointer: false, canHover: true, mobileUserAgent: false }), 'mobile');
});

test('窄窗口电脑保留 compact Web 布局', () => {
  assert.equal(classifyDeviceLayout({ width: 1024, coarsePointer: false, canHover: true, mobileUserAgent: false }), 'compact');
});

test('大屏电脑使用完整 Web 布局', () => {
  assert.equal(classifyDeviceLayout({ width: 1440, coarsePointer: false, canHover: true, mobileUserAgent: false }), 'desktop');
});
