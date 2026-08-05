/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AuthCallback —— InfiniSynapse SSO 登录回调页。
 *
 * 流程（与 InfiniSynapse Partner SSO Integration Guide 第 3 步一致）：
 *  - InfiniSynapse 登录完成后，浏览器带 ?code=xxx&state=xxx 跳回 returnUrl。
 *  - 本页校验 state（防 CSRF），调用 AuthContext.exchangeCode(code) 兑换用户信息，
 *    写登录态成功后跳转回首页 / 个人中心。
 */

import { useEffect, useRef, useState } from 'react';
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { AuthProvider, useAuth } from './AuthContext';

const STATE_KEY = 'paopao_sso_state_v1';
const REDIRECT_KEY = 'paopao_sso_redirect_v1';

export function AuthCallback() {
  return (
    <AuthProvider>
      <AuthCallbackInner />
    </AuthProvider>
  );
}

function AuthCallbackInner() {
  const auth = useAuth();
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');
  const [error, setError] = useState<string | null>(null);
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const errorParam = params.get('error');

    const finishAndRedirect = (target: string) => {
      window.setTimeout(() => {
        window.location.replace(target);
      }, 1200);
    };

    (async () => {
      try {
        // 用户取消登录或 InfiniSynapse 返回错误
        if (errorParam || !code) {
          setStatus('error');
          setError(errorParam ? '登录被取消或失败，请重试' : '缺少授权码（code）');
          finishAndRedirect('/');
          return;
        }

        // 校验 state（防 CSRF）
        const savedState = localStorage.getItem(STATE_KEY);
        const redirectTo = localStorage.getItem(REDIRECT_KEY) || '/';
        localStorage.removeItem(STATE_KEY);
        localStorage.removeItem(REDIRECT_KEY);

        if (!savedState || !state || savedState !== state) {
          setStatus('error');
          setError('登录校验失败（state 不匹配），请重新登录');
          finishAndRedirect('/');
          return;
        }

        // 用 code 兑换用户信息并写登录态
        const r = await auth.exchangeCode(code);
        if (!r.ok) {
          setStatus('error');
          setError(r.error ?? '登录失败');
          finishAndRedirect('/');
          return;
        }

        setStatus('success');
        finishAndRedirect(redirectTo);
      } catch (e: any) {
        console.error('[AuthCallback] unexpected error:', e?.message);
        setStatus('error');
        setError('登录处理异常，请重试');
        finishAndRedirect('/');
      }
    })();
  }, [auth]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f5f6f8] p-4 font-sans">
      <div className="w-full max-w-sm rounded-2xl border border-[#eef0f3] bg-white p-8 text-center shadow-sm">
        {status === 'processing' && (
          <>
            <Loader2 size={36} className="mx-auto animate-spin text-indigo-600" />
            <h1 className="mt-4 text-base font-bold text-gray-900">正在登录…</h1>
            <p className="mt-1 text-xs text-gray-400">正在通过 InfiniSynapse 验证身份</p>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle2 size={36} className="mx-auto text-emerald-500" />
            <h1 className="mt-4 text-base font-bold text-gray-900">登录成功</h1>
            <p className="mt-1 text-xs text-gray-400">即将为你跳转…</p>
          </>
        )}
        {status === 'error' && (
          <>
            <AlertCircle size={36} className="mx-auto text-rose-500" />
            <h1 className="mt-4 text-base font-bold text-gray-900">登录失败</h1>
            <p className="mt-1 text-xs text-gray-500">{error || '未知错误'}</p>
            <a
              href="/"
              className="mt-4 inline-block rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
            >
              返回首页
            </a>
          </>
        )}
      </div>
    </div>
  );
}
