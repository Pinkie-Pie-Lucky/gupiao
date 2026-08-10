import { FormEvent, useMemo, useState } from 'react';
import { ArrowRight, BookOpen, Smartphone } from 'lucide-react';
import type { LocalAccount } from '../lib/localAccount';

interface LoginScreenProps {
  existingPhone: string | null;
  onRegister: (phone: string, nickname: string) => void;
  onSignIn: (phone: string) => boolean;
}

const phonePattern = /^1[3-9]\d{9}$/;

export function LoginScreen({ existingPhone, onRegister, onSignIn }: LoginScreenProps) {
  const [phone, setPhone] = useState(existingPhone || '');
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');
  const isExistingAccount = Boolean(existingPhone && phone === existingPhone);
  const buttonText = isExistingAccount ? '登录' : '注册并登录';

  const helperText = useMemo(() => (
    isExistingAccount ? '此设备已保存该账号，登录后可继续使用。' : '首次使用请填写昵称，昵称可在个人中心随时修改。'
  ), [isExistingAccount]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedPhone = phone.trim();
    const normalizedNickname = nickname.trim();
    if (!phonePattern.test(normalizedPhone)) {
      setError('请输入正确的 11 位手机号。');
      return;
    }
    if (isExistingAccount) {
      if (!onSignIn(normalizedPhone)) setError('该手机号尚未在此设备注册。');
      return;
    }
    if (existingPhone) {
      setError('此设备已保存其他手机号，请输入已注册手机号登录。');
      return;
    }
    if (normalizedNickname.length < 2 || normalizedNickname.length > 16) {
      setError('昵称长度为 2–16 个字符。');
      return;
    }
    onRegister(normalizedPhone, normalizedNickname);
  };

  return (
    <main className="min-h-screen bg-slate-50 px-5 pb-10 pt-16 text-slate-900">
      <div className="mx-auto max-w-md">
        <div className="grid h-11 w-11 place-items-center rounded-xl bg-indigo-600 text-white"><BookOpen className="h-5 w-5" /></div>
        <h1 className="mt-6 text-2xl font-bold tracking-tight">和泡泡一起学看盘</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">从看懂市场开始，慢慢建立自己的判断。</p>

        <form onSubmit={submit} className="mt-10 space-y-5" noValidate>
          <label className="block">
            <span className="text-xs font-semibold text-slate-700">手机号</span>
            <span className="relative mt-2 block">
              <Smartphone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={phone} onChange={(event) => { setPhone(event.target.value.replace(/\D/g, '').slice(0, 11)); setError(''); }} inputMode="numeric" autoComplete="tel" placeholder="请输入手机号" className="min-h-12 w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-3 text-sm outline-none transition focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100" />
            </span>
          </label>

          {!isExistingAccount && <label className="block">
            <span className="text-xs font-semibold text-slate-700">给自己起个昵称</span>
            <input value={nickname} onChange={(event) => { setNickname(event.target.value.slice(0, 16)); setError(''); }} autoComplete="nickname" placeholder="例如：刚学看盘的小陈" className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none transition focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100" />
          </label>}

          <p className="text-xs leading-5 text-slate-500">{helperText}</p>
          {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
          <button type="submit" className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white transition hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600">
            {buttonText}<ArrowRight className="h-4 w-4" />
          </button>
        </form>

        <p className="mt-6 text-center text-[11px] leading-5 text-slate-500">本机体验账户：不发送短信验证码，账号信息仅保存在当前浏览器。</p>
      </div>
    </main>
  );
}
