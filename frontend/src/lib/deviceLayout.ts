export type DeviceLayout = 'mobile' | 'compact' | 'desktop';

export interface DeviceLayoutSignals {
  width: number;
  coarsePointer: boolean;
  canHover: boolean;
  mobileUserAgent: boolean;
}

/**
 * 设备布局只影响视觉壳层，业务数据与接口在各端保持一致。
 *
 * 手机 UA 在触屏环境或窄屏时优先使用移动端；普通电脑即使窗口较窄，
 * 也会保留 compact Web 布局，避免误落入底部导航的手机界面。
 */
export function classifyDeviceLayout({ width, coarsePointer, canHover, mobileUserAgent }: DeviceLayoutSignals): DeviceLayout {
  if (mobileUserAgent && (coarsePointer || width < 1024)) return 'mobile';
  if (width < 768) return 'mobile';
  if (width < 1200) return 'compact';
  if (coarsePointer && !canHover && width < 1366) return 'compact';
  return 'desktop';
}
