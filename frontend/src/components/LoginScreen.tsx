import { FormEvent, useState } from 'react';
import { ArrowRight, BookOpen, Smartphone, Lock, UserRound } from 'lucide-react';
import { apiLogin, apiRegister, ApiError, type User } from '../lib/api';

interface LoginScreenProps {
  onAuthenticated: (user: User) => void;
}

const phonePattern = /^1[3-9]\d{9}$/;

export function LoginScreen({ onAuthenticated }: LoginScreenProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [phone, setPhone] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const switchMode = (next: 'login' | 'register') => {
    setMode(next);
    setError('');
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    const normalizedPhone = phone.trim();
    if (!phonePattern.test(normalizedPhone)) {
      setError('请输入正确的 11 位手机号。');
      return;
    }
    if (password.length < 6) {
      setError('密码至少 6 位。');
      return;
    }
    if (mode === 'register') {
      const normalizedNickname = nickname.trim();
      if (normalizedNickname.length < 2 || normalizedNickname.length > 16) {
        setError('昵称长度为 2–16 个字符。');
        return;
      }
    }

    setSubmitting(true);
    try {
      const user = mode === 'register'
        ? await apiRegister(normalizedPhone, nickname.trim(), password)
        : await apiLogin(normalizedPhone, password);
      onAuthenticated(user);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '网络异常，请稍后重试。');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 px-5 pb-10 pt-16 text-slate-900">
      <div className="mx-auto max-w-md">
        <div className="grid h-11 w-11 place-items-center rounded-xl bg-indigo-600 text-white"><BookOpen className="h-5 w-5" /></div>
        <h1 className="mt-6 text-2xl font-bold tracking-tight">和泡泡一起学看盘</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">从看懂市场开始，慢慢建立自己的判断。</p>

        <div className="mt-8 grid grid-cols-2 rounded-xl bg-slate-100 p-1 text-sm font-semibold">
          <button type="button" onClick={() => switchMode('login')} className={`min-h-10 rounded-lg transition ${mode === 'login' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500'}`}>登录</button>
          <button type="button" onClick={() => switchMode('register')} className={`min-h-10 rounded-lg transition ${mode === 'register' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500'}`}>注册</button>
        </div>

        <form onSubmit={submit} className="mt-6 space-y-5" noValidate>
          <label className="block">
            <span className="text-xs font-semibold text-slate-700">手机号</span>
            <span className="relative mt-2 block">
              <Smartphone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={phone} onChange={(event) => { setPhone(event.target.value.replace(/\D/g, '').slice(0, 11)); setError(''); }} inputMode="numeric" autoComplete="tel" placeholder="请输入手机号" className="min-h-12 w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-3 text-sm outline-none transition focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100" />
            </span>
          </label>

          {mode === 'register' && <label className="block">
            <span className="text-xs font-semibold text-slate-700">给自己起个昵称</span>
            <span className="relative mt-2 block">
              <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={nickname} onChange={(event) => { setNickname(event.target.value.slice(0, 16)); setError(''); }} autoComplete="nickname" placeholder="例如：刚学看盘的小陈" className="min-h-12 w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-3 text-sm outline-none transition focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100" />
            </span>
          </label>}

          <label className="block">
            <span className="text-xs font-semibold text-slate-700">密码</span>
            <span className="relative mt-2 block">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={password} onChange={(event) => { setPassword(event.target.value); setError(''); }} type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} placeholder={mode === 'register' ? '设置密码（至少 6 位）' : '请输入密码'} className="min-h-12 w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-3 text-sm outline-none transition focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100" />
            </span>
          </label>

          {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
          <button type="submit" disabled={submitting} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white transition hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-60">
            {submitting ? '请稍候…' : mode === 'register' ? '注册并登录' : '登录'}<ArrowRight className="h-4 w-4" />
          </button>
        </form>

        <p className="mt-6 text-center text-[11px] leading-5 text-slate-500">账号信息保存在服务端，密码加密存储。</p>
      </div>
    </main>
  );
}