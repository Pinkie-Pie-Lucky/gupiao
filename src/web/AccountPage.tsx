/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AccountPage —— Web 端「个人中心」页面。
 *
 * 设计约束（与产品定位一致）：
 *  - 产品不接入用户真实资产 / 持仓数据，因此本页【绝不】展示总资产、持仓、盈亏等
 *    需要真实仓位才能得出的字段；这些内容要么无法获取，要么已在「我的关注」中体现。
 *  - 本页定位为「我是谁 + 我的 AI 权益 + 基础设置」三件事，保持轻量。
 *  - 设置项为本离线演示环境，所有改动仅保存在本地组件状态（刷新即重置），不写后端。
 *
 * 结构：
 *  A. 身份头部（头像 / 昵称 / 会员等级）——「编辑资料」可改昵称与头像首字
 *  D. AI 智能服务 · 会员权益（差异化核心位，indigo 渐变卡）
 *  F. 设置与安全（列表式，低调）—— 当前可点击：个人资料 / 安全登录
 *     （通知偏好、关于泡泡看市按节奏暂未开放，代码预留）
 */

import { useState, type ReactNode } from 'react';
import {
  User,
  Bell,
  Shield,
  Info,
  ChevronRight,
  Sparkles,
  ArrowUpRight,
  X,
  LogOut,
  Smartphone,
  KeyRound,
} from 'lucide-react';
import {
  accountProfile,
  aiService,
  accountSettings,
  accountSecurity,
  type AccountSetting,
} from './mockWebData';
import { useAuth } from './AuthContext';

const INDIGO = '#4f46e5';

const SETTING_ICON: Record<AccountSetting['icon'], ReactNode> = {
  user: <User size={17} />,
  bell: <Bell size={17} />,
  shield: <Shield size={17} />,
  info: <Info size={17} />,
};

/** 当前可打开的设置弹窗 */
type ModalId = 'profile' | 'notify' | 'security' | 'about' | null;

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-[#eef0f3] bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-[15px] font-bold text-gray-900">{title}</h2>
        {hint && <span className="text-xs text-gray-400">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

/** 通用开关 */
function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
        checked ? 'bg-indigo-600' : 'bg-gray-300'
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-[22px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

/** 通用弹窗：遮罩 + 居中卡片，点击遮罩或 X 关闭 */
function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-900">{title}</h3>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </div>
        {children}
        {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

const inputCls =
  'w-full rounded-xl border border-[#eef0f3] bg-white px-3 py-2 text-sm text-gray-800 outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100';

export function AccountPage({ onOpenAi }: { onOpenAi?: () => void }) {
  const auth = useAuth();
  const ai = aiService;
  const remain = Math.max(0, ai.diagnosisQuota - ai.diagnosisUsed);
  const usedPct = Math.round((ai.diagnosisUsed / ai.diagnosisQuota) * 100);

  // ---- 设置弹窗状态 ----
  const [modal, setModal] = useState<ModalId>(null);

  // ---- 个人资料（可编辑，保存后同步头部） ----
  const [profile, setProfile] = useState(accountProfile);
  const [draft, setDraft] = useState(accountProfile);

  // ---- 安全登录：退出登录流程 ----
  const [logoutStep, setLogoutStep] = useState<'idle' | 'confirm' | 'done'>('idle');

  const openModal = (id: string) => {
    if (id === 'profile') setDraft(profile);
    if (id === 'security') setLogoutStep('idle');
    setModal(id as ModalId);
  };
  const closeModal = () => setModal(null);

  const saveProfile = () => {
    setProfile(draft);
    closeModal();
  };

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-6">
      {/* ===== A. 身份头部 ===== */}
      <div className="flex items-center gap-4 rounded-2xl border border-[#eef0f3] bg-white p-5 shadow-sm">
        <div
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-2xl font-bold text-white"
          style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}
        >
          {profile.avatarText}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <h1 className="truncate text-xl font-bold text-gray-900">{profile.nickname}</h1>
            <span
              className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
              style={{ background: '#eef2ff', color: INDIGO }}
            >
              {profile.plan}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-gray-400">加入于 {profile.joinedAt}</p>
        </div>
        <button
          onClick={() => openModal('profile')}
          className="rounded-xl border border-[#eef0f3] px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:border-indigo-300 hover:text-indigo-600"
        >
          编辑资料
        </button>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[1.4fr_1fr]">
        {/* ===== D. AI 智能服务 · 会员权益（核心位） ===== */}
        <Section title="AI 智能服务 · 会员权益" hint="差异化核心位">
          <div
            className="rounded-xl p-5 text-white"
            style={{ background: 'linear-gradient(135deg,#4f46e5 0%,#6d28d9 100%)' }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles size={18} />
                <span className="text-sm font-semibold">当前套餐</span>
              </div>
              <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-semibold">
                {ai.plan}
              </span>
            </div>

            <div className="mt-4">
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-white/80">本月 AI 诊股额度</span>
                <span className="font-semibold">
                  剩 {remain} / {ai.diagnosisQuota} 次
                </span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/25">
                <div className="h-full rounded-full bg-white" style={{ width: `${usedPct}%` }} />
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-white/10 p-3">
                <p className="text-xs text-white/70">已订阅板块情报</p>
                <p className="mt-0.5 text-lg font-bold">{ai.subscribedSectors.length} 个</p>
              </div>
              <div className="rounded-lg bg-white/10 p-3">
                <p className="text-xs text-white/70">AI泡泡 对话</p>
                <p className="mt-0.5 text-lg font-bold">{ai.questionCount} 条</p>
              </div>
            </div>

            <button
              onClick={onOpenAi}
              className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-lg bg-white py-2.5 text-sm font-semibold text-indigo-700 transition-transform hover:scale-[1.01]"
            >
              去 AI泡泡 提问 <ArrowUpRight size={15} />
            </button>
          </div>

          {/* 已订阅板块情报 */}
          <div className="mt-4">
            <p className="mb-2 text-xs font-medium text-gray-500">已订阅板块情报</p>
            <div className="flex flex-wrap gap-2">
              {ai.subscribedSectors.map((s) => (
                <span
                  key={s}
                  className="rounded-full border border-[#eef0f3] bg-[#f7f8fa] px-3 py-1 text-xs font-medium text-gray-600"
                >
                  {s}
                </span>
              ))}
            </div>
          </div>
        </Section>

        {/* ===== F. 设置与安全（列表式，低调） ===== */}
        <Section title="设置与安全" hint="基础功能">
          <ul className="divide-y divide-[#f3f4f6]">
            {accountSettings.map((s) => (
              <li
                key={s.id}
                onClick={() => openModal(s.id)}
                className="flex cursor-pointer items-center gap-3 py-3 transition-colors hover:bg-[#fafbff]"
              >
                <span
                  className="flex h-9 w-9 items-center justify-center rounded-xl"
                  style={{ background: '#eef2ff', color: INDIGO }}
                >
                  {SETTING_ICON[s.icon]}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-800">{s.label}</p>
                  <p className="truncate text-xs text-gray-400">{s.desc}</p>
                </div>
                <ChevronRight size={16} className="text-gray-300" />
              </li>
            ))}
          </ul>

          <div className="mt-3 rounded-xl border border-dashed border-[#e5e7eb] bg-[#fafbfc] p-3 text-xs leading-relaxed text-gray-400">
            泡泡看市不接入您的真实持仓与资产数据，所有自选与预警均由您本地维护，隐私安全可控。
          </div>
        </Section>
      </div>

      {/* ===================== 弹窗区 ===================== */}

      {/* 个人资料 */}
      {modal === 'profile' && (
        <Modal
          title="个人资料"
          onClose={closeModal}
          footer={
            <>
              <button
                onClick={closeModal}
                className="rounded-xl border border-[#eef0f3] px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={saveProfile}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
              >
                保存
              </button>
            </>
          }
        >
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">昵称</label>
              <input
                className={inputCls}
                value={draft.nickname}
                maxLength={20}
                onChange={(e) => setDraft({ ...draft, nickname: e.target.value })}
                placeholder="给自己起个名字"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">头像首字</label>
              <input
                className={`${inputCls} w-16 text-center text-lg font-bold`}
                value={draft.avatarText}
                maxLength={1}
                onChange={(e) => setDraft({ ...draft, avatarText: e.target.value.slice(0, 1) })}
                placeholder="泡"
              />
              <p className="mt-1 text-[11px] text-gray-400">用单个字代替真实头像，保护隐私。</p>
            </div>
          </div>
        </Modal>
      )}

      {/*
      // 通知偏好（暂未开放，模块预留；待推送能力就绪后取消注释即可启用）
      {modal === 'notify' && (
        <Modal title="通知偏好" onClose={closeModal}>
          <div className="divide-y divide-[#f3f4f6]">
            {(
              [
                { key: 'priceAlert', label: '价格预警推送', desc: '自选股触发预警条件时通知我' },
                { key: 'sectorAlert', label: '板块异动推送', desc: '关注板块出现明显异动时通知' },
                { key: 'dailyBrief', label: '每日盘前简报', desc: '每个交易日开盘前推送市场速览' },
                { key: 'aiNews', label: 'AI 情报速递', desc: '新研报 / 情报生成时提醒我' },
              ] as { key: keyof AccountNotify; label: string; desc: string }[]
            ).map((row) => (
              <div key={row.key} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800">{row.label}</p>
                  <p className="text-xs text-gray-400">{row.desc}</p>
                </div>
                <Toggle checked={notify[row.key]} onChange={() => toggleNotify(row.key)} />
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-gray-400">设置仅保存在本机，离线演示环境不写后端。</p>
        </Modal>
      )}
      */}

      {/* 安全登录 */}
      {modal === 'security' && (
        <Modal
          title="安全登录"
          onClose={closeModal}
          footer={
            logoutStep !== 'done' ? (
              <button
                onClick={() => setLogoutStep('confirm')}
                className="flex items-center gap-1.5 rounded-xl border border-rose-200 px-4 py-2 text-sm font-medium text-rose-600 transition-colors hover:bg-rose-50"
              >
                <LogOut size={15} /> 退出登录
              </button>
            ) : (
              <button
                onClick={() => setLogoutStep('idle')}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
              >
                重新登录（演示）
              </button>
            )
          }
        >
          {logoutStep === 'done' ? (
            <div className="rounded-xl bg-gray-50 p-4 text-center text-sm text-gray-500">
              您已退出登录（由 InfiniSynapse 账号登录）。
            </div>
          ) : (
            <>
              <p className="mb-2 text-xs font-medium text-gray-500">账号绑定</p>
              <ul className="space-y-2">
                <li className="flex items-center gap-3 rounded-xl border border-[#eef0f3] px-3 py-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#eef2ff] text-indigo-600">
                    <User size={17} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-800">InfiniSynapse 账号</p>
                    <p className="text-xs text-gray-400">用于登录本应用</p>
                  </div>
                  <span className="text-sm font-medium text-gray-700">
                    {auth.isLoggedIn && auth.session
                      ? auth.session.user.nickname || auth.session.user.username || auth.session.user.email || '已绑定'
                      : '未登录'}
                  </span>
                </li>
                <li className="flex items-center gap-3 rounded-xl border border-[#eef0f3] px-3 py-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#eef2ff] text-indigo-600">
                    <Smartphone size={17} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-800">绑定手机号</p>
                    <p className="text-xs text-gray-400">由 InfiniSynapse 账号提供</p>
                  </div>
                  <span className="text-sm font-medium text-gray-700">
                    {auth.isLoggedIn && auth.session ? (auth.session.user.phone || '未绑定') : '未绑定'}
                  </span>
                </li>
                {/*
                // 微信绑定（暂未开放，模块预留）
                <li className="flex items-center gap-3 rounded-xl border border-[#eef0f3] px-3 py-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#eef2ff] text-indigo-600">
                    <MessageCircle size={17} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-800">微信绑定</p>
                    <p className="text-xs text-gray-400">扫码快捷登录</p>
                  </div>
                  <span className={`text-sm font-medium ${accountSecurity.wechatBound ? 'text-emerald-600' : 'text-gray-400'}`}>
                    {accountSecurity.wechatBound ? '已绑定' : '未绑定'}
                  </span>
                </li>
                // 绑定邮箱（暂未开放，模块预留）
                <li className="flex items-center gap-3 rounded-xl border border-[#eef0f3] px-3 py-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#eef2ff] text-indigo-600">
                    <Mail size={17} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-800">绑定邮箱</p>
                    <p className="text-xs text-gray-400">接收重要通知</p>
                  </div>
                  <span className="truncate text-sm font-medium text-gray-700">{accountSecurity.email}</span>
                </li>
                */}
                <li className="flex items-center gap-3 rounded-xl border border-[#eef0f3] px-3 py-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#eef2ff] text-indigo-600">
                    <KeyRound size={17} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-800">登录密码</p>
                    <p className="text-xs text-gray-400">由 InfiniSynapse 托管，修改请在 InfiniSynapse 中操作</p>
                  </div>
                  <span className={`text-sm font-medium ${auth.isLoggedIn ? 'text-emerald-600' : 'text-gray-400'}`}>
                    {auth.isLoggedIn ? '已设置' : '未设置'}
                  </span>
                </li>
              </ul>

              {logoutStep === 'confirm' && (
                <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                  确认退出登录？
                  <div className="mt-2 flex justify-end gap-2">
                    <button
                      onClick={() => setLogoutStep('idle')}
                      className="rounded-lg border border-[#eef0f3] bg-white px-3 py-1.5 text-xs font-medium text-gray-600"
                    >
                      取消
                    </button>
                    <button
                      onClick={() => {
                        auth.logout();
                        setLogoutStep('done');
                      }}
                      className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white"
                    >
                      确认退出
                    </button>
                  </div>
                </div>
              )}
              <p className="mt-3 text-[11px] text-gray-400">账号由 InfiniSynapse 托管，不展示任何真实持仓或资产。</p>
            </>
          )}
        </Modal>
      )}

      {/*
      // 关于泡泡看市（暂未开放，模块预留；后续版本补充协议/版本信息后取消注释即可）
      {modal === 'about' && (
        <Modal title="关于泡泡看市" onClose={closeModal}>
          <div className="space-y-3 text-sm text-gray-600">
            <div className="flex items-center gap-3">
              <div
                className="flex h-12 w-12 items-center justify-center rounded-2xl text-lg font-bold text-white"
                style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}
              >
                泡
              </div>
              <div>
                <p className="font-bold text-gray-900">泡泡看市 · Web 端</p>
                <p className="text-xs text-gray-400">版本 v1.0.0 · 内部演示构建</p>
              </div>
            </div>
            <p className="leading-relaxed">
              泡泡看市是一款面向 A 股投资者的轻量看盘与 AI 投研工具，帮助你用 AI 看懂市场、跟踪自选与板块动态。
            </p>
            <div className="rounded-xl bg-[#f7f8fa] p-3 text-xs leading-relaxed text-gray-500">
              <p>· 用户协议（演示）</p>
              <p>· 隐私政策（演示）</p>
              <p>· 本产品不接入真实持仓与资产数据，所有自选与预警均由你本地维护。</p>
            </div>
            <p className="text-xs text-gray-400">© 2024 泡泡看市 · 仅供演示，不构成任何投资建议。</p>
          </div>
        </Modal>
      )}
      */}
    </div>
  );
}
