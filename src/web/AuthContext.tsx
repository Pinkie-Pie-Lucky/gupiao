/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AuthContext —— InfiniSynapse Partner SSO 登录。
 *
 * 说明（与 InfiniSynapse Partner SSO Integration Guide 一致）：
 *  - 用户点击「使用 InfiniSynapse 登录」后，服务端创建登录会话并返回 entryUrl，
 *    浏览器跳转到 app.infinisynapse.cn 完成登录（扫码 / 邮箱 / 手机号等方式）。
 *  - 登录成功后浏览器带一次性 code 跳回 returnUrl(/auth/callback)，
 *    由 AuthCallback 页调用本 Context 的 exchangeCode 完成登录态写入。
 *  - clientSecret 只保存在服务端（server.ts + .env），前端永远不接触。
 *
 * 原手机号 mock 注册 / 登录实现已按需求注释保留在文件末尾。
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';

const SESSION_KEY = 'paopao_session_v1'; // Session | null
// 与 AuthCallback.tsx 中的 key 保持一致（SSO 防 CSRF state 校验）
const SSO_STATE_KEY = 'paopao_sso_state_v1';
const SSO_REDIRECT_KEY = 'paopao_sso_redirect_v1';

export interface InfiniUser {
  /** InfiniSynapse 用户唯一 ID（建议用作绑定键） */
  id: string;
  email?: string;
  username?: string;
  nickname?: string;
  avatar?: string;
  /** 脱敏手机号，例如 138****0000 */
  phone?: string;
}

interface Session {
  user: InfiniUser;
  /** 登录时间 */
  loggedInAt: number;
}

export interface AuthResult {
  ok: boolean;
  error?: string;
}

interface AuthContextValue {
  session: Session | null;
  isLoggedIn: boolean;
  /**
   * 发起 InfiniSynapse 登录：
   * 1. 调用后端 /api/auth/sso/initiate 创建登录会话，拿到 entryUrl
   * 2. 跳转到 entryUrl
   */
  initiateLogin: () => Promise<AuthResult>;
  /**
   * 用回调拿到的 code 兑换用户信息（后端代兑，secret 不落前端）
   */
  exchangeCode: (code: string) => Promise<AuthResult>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 忽略隐私模式等写入失败 */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() =>
    readJSON<Session | null>(SESSION_KEY, null),
  );

  useEffect(() => {
    writeJSON(SESSION_KEY, session);
  }, [session]);

  /** 发起登录：后端创建 InfiniSynapse 登录会话，前端跳转 */
  const initiateLogin = useCallback(async (): Promise<AuthResult> => {
    try {
      const res = await fetch('/api/auth/sso/initiate', { method: 'GET' });
      const body = await res.json();
      if (!res.ok || !body?.entryUrl) {
        return { ok: false, error: body?.error || '无法发起 InfiniSynapse 登录，请稍后再试' };
      }
      // 保存 state（防 CSRF）与跳回路径，供 /auth/callback 校验；否则跳回时报「state 不匹配」
      if (body.state) {
        localStorage.setItem(SSO_STATE_KEY, String(body.state));
      }
      localStorage.setItem(SSO_REDIRECT_KEY, window.location.pathname + window.location.search);
      // 跳转到 InfiniSynapse 登录页；用户完成后会自动跳回 returnUrl(/auth/callback)
      window.location.href = body.entryUrl;
      return { ok: true };
    } catch (e: any) {
      console.error('[AuthContext] initiateLogin failed:', e?.message);
      return { ok: false, error: '网络异常，无法发起登录，请稍后再试' };
    }
  }, []);

  /** 用一次性 code 兑换用户信息并写入登录态 */
  const exchangeCode = useCallback(async (code: string): Promise<AuthResult> => {
    if (!code) return { ok: false, error: '缺少授权码（code）' };
    try {
      const res = await fetch('/api/auth/sso/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const body = await res.json();
      if (!res.ok || !body?.user?.id) {
        return { ok: false, error: body?.error || '登录失败，授权码无效或已过期' };
      }
      setSession({ user: body.user as InfiniUser, loggedInAt: Date.now() });
      return { ok: true };
    } catch (e: any) {
      console.error('[AuthContext] exchangeCode failed:', e?.message);
      return { ok: false, error: '网络异常，登录失败，请稍后再试' };
    }
  }, []);

  const logout = useCallback(() => setSession(null), []);

  const value: AuthContextValue = {
    session,
    isLoggedIn: !!session,
    initiateLogin,
    exchangeCode,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 <AuthProvider> 内使用');
  return ctx;
}

/* =====================================================================
 * 原离线 mock 手机号注册 / 登录实现（已注释保留，后续不再使用）
 * =====================================================================
 * 原实现概要：
 *  - 账号信息仅保存在本机 localStorage；
 *  - 「发送验证码」在前端模拟生成 6 位码并暂存（5 分钟过期），
 *    演示时直接把验证码回显给用户，不真正下发短信。
 * =====================================================================
 * 
 * const USERS_KEY = 'paopao_users_v1'; // StoredUser[]
 * const CODE_KEY = 'paopao_smscode_v1'; // SmsRecord | null
 * const CODE_TTL = 5 * 60 * 1000; // 验证码有效期 5 分钟
 *
 * interface StoredUser {
 *   phone: string;
 *   password: string;
 * }
 *
 * interface SmsRecord {
 *   phone: string;
 *   code: string;
 *   expiresAt: number;
 * }
 *
 * const PHONE_RE = /^1[3-9]\d{9}$/;
 *
 * function readJSON<T>(key: string, fallback: T): T { ... }
 * function writeJSON(key: string, value: unknown) { ... }
 *
 * /** 手机号脱敏：13800008888 → 138****8888 * /
 * export function maskPhone(phone: string): string {
 *   return phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
 * }
 *
 * const sendCode = useCallback((phone: string) => {
 *   if (!PHONE_RE.test(phone)) return { ok: false, error: '请输入有效的手机号' };
 *   const code = String(Math.floor(100000 + Math.random() * 900000));
 *   const record: SmsRecord = { phone, code, expiresAt: Date.now() + CODE_TTL };
 *   writeJSON(CODE_KEY, record);
 *   // 离线模拟：直接回传验证码，便于演示完成注册
 *   return { ok: true, code };
 * }, []);
 *
 * const register = useCallback(
 *   (phone: string, password: string, code: string): AuthResult => {
 *     if (!PHONE_RE.test(phone)) return { ok: false, error: '请输入有效的手机号' };
 *     if (!password || password.length < 6) return { ok: false, error: '密码至少 6 位' };
 *     const record = readJSON<SmsRecord | null>(CODE_KEY, null);
 *     if (!record || record.phone !== phone) return { ok: false, error: '请先获取验证码' };
 *     if (Date.now() > record.expiresAt) return { ok: false, error: '验证码已过期，请重新获取' };
 *     if (record.code !== code) return { ok: false, error: '验证码不正确' };
 *     const users = readJSON<StoredUser[]>(USERS_KEY, []);
 *     if (users.some((u) => u.phone === phone))
 *       return { ok: false, error: '该手机号已注册，请直接登录' };
 *     users.push({ phone, password });
 *     writeJSON(USERS_KEY, users);
 *     writeJSON(CODE_KEY, null);
 *     setSession({ phone });
 *     return { ok: true };
 *   },
 *   [],
 * );
 *
 * const login = useCallback((phone: string, password: string): AuthResult => {
 *   if (!PHONE_RE.test(phone)) return { ok: false, error: '请输入有效的手机号' };
 *   const users = readJSON<StoredUser[]>(USERS_KEY, []);
 *   const user = users.find((u) => u.phone === phone);
 *   if (!user) return { ok: false, error: '该手机号尚未注册' };
 *   if (user.password !== password) return { ok: false, error: '密码错误' };
 *   setSession({ phone });
 *   return { ok: true };
 * }, []);
 */
