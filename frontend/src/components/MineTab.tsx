import { FormEvent, useEffect, useState } from 'react';
import { Check, LogOut, Pencil, Phone, UserRound } from 'lucide-react';
import type { LocalAccount } from '../lib/localAccount';

interface MineTabProps {
  account: LocalAccount;
  onUpdateNickname: (nickname: string) => void;
  onSignOut: () => void;
}

function maskPhone(phone: string): string {
  return phone.length === 11 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : phone;
}

export function MineTab({ account, onUpdateNickname, onSignOut }: MineTabProps) {
  const [editing, setEditing] = useState(false);
  const [nickname, setNickname] = useState(account.nickname);
  const [error, setError] = useState('');
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);

  useEffect(() => setNickname(account.nickname), [account.nickname]);

  const saveNickname = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = nickname.trim();
    if (next.length < 2 || next.length > 16) {
      setError('昵称长度为 2–16 个字符。');
      return;
    }
    onUpdateNickname(next);
    setEditing(false);
    setError('');
  };

  return (
    <main id="mine-tab-view" className="px-4 pb-24 pt-3">
      <header>
        <p className="text-xs font-medium text-indigo-600">个人中心</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">你好，{account.nickname}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">从看懂市场开始，慢慢建立自己的判断。</p>
      </header>

      <section className="mt-8" aria-labelledby="account-settings-title">
        <h2 id="account-settings-title" className="text-xs font-semibold text-slate-500">账户设置</h2>
        <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex min-h-16 items-center gap-3 px-4">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-indigo-50 text-indigo-700"><UserRound className="h-4 w-4" /></span>
            <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-slate-900">昵称</p><p className="mt-0.5 truncate text-xs text-slate-500">{account.nickname}</p></div>
            <button type="button" onClick={() => { setEditing(true); setError(''); }} className="grid h-10 w-10 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600" aria-label="修改昵称"><Pencil className="h-4 w-4" /></button>
          </div>

          {editing && <form onSubmit={saveNickname} className="border-t border-slate-100 bg-slate-50 p-3">
            <label className="block text-xs font-semibold text-slate-700" htmlFor="nickname-input">新昵称</label>
            <div className="mt-2 flex gap-2"><input id="nickname-input" value={nickname} onChange={(event) => { setNickname(event.target.value.slice(0, 16)); setError(''); }} autoFocus className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100" /><button type="submit" className="inline-flex min-h-11 items-center gap-1 rounded-lg bg-indigo-600 px-3 text-xs font-bold text-white hover:bg-indigo-700"><Check className="h-4 w-4" />保存</button></div>
            {error && <p role="alert" className="mt-2 text-xs text-rose-700">{error}</p>}
          </form>}

          <div className="flex min-h-16 items-center gap-3 border-t border-slate-100 px-4">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-slate-100 text-slate-600"><Phone className="h-4 w-4" /></span>
            <div><p className="text-sm font-semibold text-slate-900">手机号</p><p className="mt-0.5 text-xs text-slate-500">{maskPhone(account.phone)}</p></div>
          </div>
        </div>
      </section>

      <section className="mt-7" aria-labelledby="session-title">
        <h2 id="session-title" className="text-xs font-semibold text-slate-500">登录与安全</h2>
        <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
          <p className="px-1 text-xs leading-5 text-slate-500">退出后将回到登录页；本机保存的账号昵称不会被删除。</p>
          <button type="button" onClick={() => confirmingSignOut ? onSignOut() : setConfirmingSignOut(true)} className={`mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-4 text-xs font-bold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700 ${confirmingSignOut ? 'bg-rose-600 text-white hover:bg-rose-700' : 'bg-rose-50 text-rose-700 hover:bg-rose-100'}`}>
            <LogOut className="h-4 w-4" />{confirmingSignOut ? '确认退出登录' : '退出登录'}
          </button>
          {confirmingSignOut && <button type="button" onClick={() => setConfirmingSignOut(false)} className="mt-2 min-h-10 w-full text-xs font-semibold text-slate-600 hover:text-slate-900">取消</button>}
        </div>
      </section>

      <p className="mt-10 text-center text-[11px] text-slate-400">泡泡 · 本机体验版</p>
    </main>
  );
}
