/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BrainMark —— Web 端品牌标识 / 泡泡老师头像。
 * 按 v3 设计要求，用更「严肃、专业」的 Brain（大脑）图标替代原本的 🎈 气球形象。
 */

import { Brain } from 'lucide-react';

interface BrainMarkProps {
  /** 容器边长（px），图标按 56% 自适应 */
  size?: number;
  className?: string;
  /** 是否使用浅色描边风格（用于深底） */
  variant?: 'dark' | 'light';
}

export function BrainMark({ size = 40, className = '', variant = 'dark' }: BrainMarkProps) {
  const isLight = variant === 'light';
  return (
    <div
      className={`flex items-center justify-center rounded-xl border shadow-inner ${className} ${
        isLight
          ? 'bg-white/10 border-white/15 text-indigo-200'
          : 'bg-gradient-to-br from-[#1e293b] to-[#0b1120] border-white/10 text-indigo-300'
      }`}
      style={{ width: size, height: size }}
    >
      <Brain size={Math.round(size * 0.56)} strokeWidth={1.8} />
    </div>
  );
}
