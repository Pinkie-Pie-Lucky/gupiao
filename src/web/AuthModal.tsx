/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AuthModal —— 使用 InfiniSynapse 登录弹窗。
 *
 *  - 按照 InfiniSynapse Partner SSO Integration Guide，登录流程为：
 *    1. 点击「使用 InfiniSynapse 登录」→ AuthContext.initiateLogin()
 *    2. 后端创建登录会话并返回 entryUrl → 浏览器跳转到 app.infinisynapse.cn
 *    3. 用户完成登录后，浏览器带 code 跳回 /auth/callback
 *    4. AuthCallback 页调用 exchangeCode 完成登录
 *
 * 原手机号 + 密码 + 短信验证码注册 / 登录表单已按需求注释保留在文件末尾。
 */

import { useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { useAuth } from './AuthContext';

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
}

export function AuthModal({ open, onClose }: AuthModalProps) {
  const auth = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleInfiniLogin = async () => {
    setLoading(true);
    setError(null);
    const r = await auth.initiateLogin();
    if (!r.ok) {
      setError(r.error ?? '登录发起失败');
      setLoading(false);
    }
    // 成功时浏览器即将跳转，不关闭弹窗
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-900">账号登录</h3>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3">
          <button
            onClick={handleInfiniLogin}
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                正在跳转到 InfiniSynapse…
              </>
            ) : (
              <>使用 InfiniSynapse 登录</>
            )}
          </button>

          {error && <p className="text-xs text-rose-500">{error}</p>}

          <p className="text-center text-[11px] leading-relaxed text-gray-400">
            登录将由 InfiniSynapse 完成（支持扫码 / 邮箱 / 手机号等方式），
            登录成功后自动跳回本应用。
          </p>
        </div>
      </div>
    </div>
  );
}

/* =====================================================================
 * 原手机号注册 / 登录弹窗实现（已注释保留，后续不再使用）
 * =====================================================================
 *
 * import { useState, type ReactNode } from 'react';
 * import { X, Smartphone, Lock, ShieldCheck } from 'lucide-react';
 * import { useAuth } from './AuthContext';
 *
 * export function AuthModal({ open, onClose }: AuthModalProps) {
 *   const auth = useAuth();
 *   const [tab, setTab] = useState<'login' | 'register'>('login');
 *   const [phone, setPhone] = useState('');
 *   const [password, setPassword] = useState('');
 *   const [code, setCode] = useState('');
 *   const [error, setError] = useState<string | null>(null);
 *   const [demoCode, setDemoCode] = useState<string | null>(null);
 *   const [cooldown, setCooldown] = useState(0);
 *
 *   if (!open) return null;
 *
 *   const resetForm = () => {
 *     setError(null);
 *     setDemoCode(null);
 *     setCode('');
 *   };
 *
 *   const switchTab = (t: 'login' | 'register') => {
 *     setTab(t);
 *     resetForm();
 *   };
 *
 *   const handleSend = () => {
 *     const r = auth.sendCode(phone);
 *     if (!r.ok) {
 *       setError(r.error ?? '发送失败');
 *       return;
 *     }
 *     setDemoCode(r.code ?? '');
 *     setError(null);
 *     let n = 60;
 *     setCooldown(n);
 *     const timer = window.setInterval(() => {
 *       n -= 1;
 *       setCooldown(n);
 *       if (n <= 0) window.clearInterval(timer);
 *     }, 1000);
 *   };
 *
 *   const handleSubmit = () => {
 *     setError(null);
 *     const r =
 *       tab === 'login'
 *         ? auth.login(phone, password)
 *         : auth.register(phone, password, code);
 *     if (!r.ok) {
 *       setError(r.error ?? '操作失败');
 *       return;
 *     }
 *     resetForm();
 *     onClose();
 *   };
 *
 *   return (
 *     <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
 *       <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
 *       <div
 *         className="relative w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
 *         onClick={(e) => e.stopPropagation()}
 *       >
 *         <div className="mb-4 flex items-center justify-between">
 *           <h3 className="text-base font-bold text-gray-900">
 *             账号 · {tab === 'login' ? '登录' : '注册'}
 *           </h3>
 *           <button
 *             onClick={onClose}
 *             className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
 *             aria-label="关闭"
 *           >
 *             <X size={18} />
 *           </button>
 *         </div>
 *
 *         {/* Tab 切换 * /}
 *         <div className="mb-4 flex rounded-xl bg-[#f3f4f6] p-1">
 *           <button
 *             onClick={() => switchTab('login')}
 *             className={`flex-1 rounded-lg py-1.5 text-sm font-medium transition-colors ${
 *               tab === 'login' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500'
 *             }`}
 *           >
 *             登录
 *           </button>
 *           <button
 *             onClick={() => switchTab('register')}
 *             className={`flex-1 rounded-lg py-1.5 text-sm font-medium transition-colors ${
 *               tab === 'register' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500'
 *             }`}
 *           >
 *             注册
 *           </button>
 *         </div>
 *
 *         <div className="space-y-3">
 *           <Field
 *             icon={<Smartphone size={16} />}
 *             value={phone}
 *             onChange={setPhone}
 *             placeholder="手机号"
 *             inputMode="numeric"
 *             maxLength={11}
 *           />
 *           <Field
 *             icon={<Lock size={16} />}
 *             value={password}
 *             onChange={setPassword}
 *             placeholder="密码（至少 6 位）"
 *             type="password"
 *           />
 *
 *           {tab === 'register' && (
 *             <div>
 *               <div className="flex gap-2">
 *                 <Field
 *                   icon={<ShieldCheck size={16} />}
 *                   value={code}
 *                   onChange={setCode}
 *                   placeholder="短信验证码"
 *                   inputMode="numeric"
 *                   maxLength={6}
 *                 />
 *                 <button
 *                   onClick={handleSend}
 *                   disabled={cooldown > 0}
 *                   className="shrink-0 rounded-xl border border-indigo-200 px-3 text-sm font-medium text-indigo-600 transition-colors hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
 *                 >
 *                   {cooldown > 0 ? `${cooldown}s` : '发送验证码'}
 *                 </button>
 *               </div>
 *               {demoCode && (
 *                 <p className="mt-1.5 rounded-lg bg-indigo-50 px-3 py-2 text-[11px] leading-relaxed text-indigo-600">
 *                   离线模拟：验证码为 <b className="font-semibold">{demoCode}</b>（演示环境不会真实发送短信）
 *                 </p>
 *               )}
 *             </div>
 *           )}
 *
 *           {error && <p className="text-xs text-rose-500">{error}</p>}
 *
 *           <button
 *             onClick={handleSubmit}
 *             className="w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
 *           >
 *             {tab === 'login' ? '登录' : '注册并登录'}
 *           </button>
 *           <p className="text-center text-[11px] leading-relaxed text-gray-400">
 *             演示环境：账号仅保存在本机浏览器，不涉及真实短信或后端。
 *           </p>
 *         </div>
 *       </div>
 *     </div>
 *   );
 * }
 *
 * interface FieldProps {
 *   icon: ReactNode;
 *   value: string;
 *   onChange: (v: string) => void;
 *   placeholder: string;
 *   type?: string;
 *   inputMode?: 'text' | 'numeric';
 *   maxLength?: number;
 * }
 *
 * function Field({ icon, value, onChange, placeholder, type = 'text', inputMode = 'text', maxLength }: FieldProps) {
 *   return (
 *     <div className="flex items-center gap-2 rounded-xl border border-[#eef0f3] bg-white px-3 py-2.5 transition-colors focus-within:border-indigo-300">
 *       <span className="text-gray-400">{icon}</span>
 *       <input
 *         className="w-full bg-transparent text-sm text-gray-800 outline-none placeholder:text-gray-400"
 *         value={value}
 *         onChange={(e) => onChange(e.target.value)}
 *         placeholder={placeholder}
 *         type={type}
 *         inputMode={inputMode}
 *         maxLength={maxLength}
 *       />
 *     </div>
 *   );
 * }
 */
