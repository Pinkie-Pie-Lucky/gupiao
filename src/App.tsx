/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 入口：Web 端（桌面）统一渲染 WebApp 外壳。
 *  - /auth/callback：InfiniSynapse SSO 登录回调页
 *  - 其余路径：渲染 WebApp 外壳
 * 移动端 H5 组件仍保留在 src/components/ 下，供后续响应式切换或回退使用。
 */

import { useEffect, useState } from 'react';
import { WebApp } from './web/WebApp';
import { AuthCallback } from './web/AuthCallback';

function useSsoCallbackPath(): boolean {
  const [isCallback, setIsCallback] = useState(false);

  useEffect(() => {
    const check = () => {
      const { pathname } = window.location;
      setIsCallback(pathname === '/auth/callback');
    };
    check();
    window.addEventListener('popstate', check);
    return () => window.removeEventListener('popstate', check);
  }, []);

  return isCallback;
}

export default function App() {
  const isCallback = useSsoCallbackPath();

  // InfiniSynapse 登录完成后带 code + state 跳回 /auth/callback
  if (isCallback) {
    return <AuthCallback />;
  }

  return <WebApp />;
}
