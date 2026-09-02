import { useEffect, useState } from 'react';
import { classifyDeviceLayout, type DeviceLayout } from '../lib/deviceLayout';

const MOBILE_UA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;

function readDeviceLayout(): DeviceLayout {
  if (typeof window === 'undefined') return 'desktop';
  return classifyDeviceLayout({
    width: window.innerWidth,
    coarsePointer: window.matchMedia('(pointer: coarse)').matches,
    canHover: window.matchMedia('(hover: hover)').matches,
    mobileUserAgent: MOBILE_UA.test(navigator.userAgent),
  });
}

export function useDeviceLayout(): DeviceLayout {
  const [layout, setLayout] = useState<DeviceLayout>(readDeviceLayout);

  useEffect(() => {
    const syncLayout = () => setLayout(readDeviceLayout());
    const pointerQuery = window.matchMedia('(pointer: coarse)');
    const hoverQuery = window.matchMedia('(hover: hover)');
    window.addEventListener('resize', syncLayout);
    pointerQuery.addEventListener('change', syncLayout);
    hoverQuery.addEventListener('change', syncLayout);
    return () => {
      window.removeEventListener('resize', syncLayout);
      pointerQuery.removeEventListener('change', syncLayout);
      hoverQuery.removeEventListener('change', syncLayout);
    };
  }, []);

  return layout;
}
