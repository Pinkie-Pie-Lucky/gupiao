/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { User, Shield, Bell, BookOpen, ChevronRight } from 'lucide-react';
import { UserProfile, StockItem } from '../types';
import { mockUserProfile } from '../data';

interface MineTabProps {
  followedStocks: StockItem[];
  onAskTeacherAboutStock: (stockName: string, stockCode: string) => void;
  onNavigateToTab: (tabId: string) => void;
}

export function MineTab({ followedStocks, onAskTeacherAboutStock, onNavigateToTab }: MineTabProps) {
  const [profile, setProfile] = useState<UserProfile>(mockUserProfile);
  const [isQuizOpen, setIsQuizOpen] = useState(false);
  const [quizAnswers, setQuizAnswers] = useState<number[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);

  // Quiz questions for Risk Assessment
  const quizQuestions = [
    {
      text: '您计划持有一只股票或基金的平均周期是？',
      options: ['1个月以内 (超短线攻守)', '1-6个月 (波段滚动)', '6个月以上 (中长线价值投资)'],
    },
    {
      text: '当持仓标的出现 15% 以上的技术性深度回调时，您的心态是？',
      options: ['极度焦虑，选择割肉离场避险', '静观其变，寻找支撑位做差价拉低成本', '兴奋不已，这正是千载难逢的加仓好时机'],
    },
    {
      text: '您心目中理想的年化投资预期回报率是？',
      options: ['5% - 10% (稳健增值)', '10% - 25% (跑赢大盘)', '25% 以上 (博取高弹性超额收益)'],
    }
  ];



  const handleQuizAnswer = (optionIndex: number) => {
    const nextAnswers = [...quizAnswers, optionIndex];
    setQuizAnswers(nextAnswers);

    if (currentQuestionIndex < quizQuestions.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
    } else {
      // Calculate final risk profile based on answers
      const sum = nextAnswers.reduce((a, b) => a + b, 0);
      let tolerance: '稳健型' | '平衡型' | '进取型' = '平衡型';
      if (sum <= 2) tolerance = '稳健型';
      else if (sum >= 5) tolerance = '进取型';

      setProfile((prev) => ({ ...prev, riskTolerance: tolerance }));
      setIsQuizOpen(false);
      // Reset quiz
      setCurrentQuestionIndex(0);
      setQuizAnswers([]);
    }
  };

  return (
    <div id="mine-tab-view" className="space-y-6 pb-24">
      {/* Profile Card */}
      <div id="profile-card" className="mx-4 bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 rounded-3xl p-5 text-white shadow-lg border border-slate-800/80">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-white/20 border-2 border-white/40 flex items-center justify-center text-xl font-bold uppercase overflow-hidden">
            <User className="w-8 h-8 text-white" />
          </div>
          <div>
            <h3 id="profile-name" className="text-lg font-bold">{profile.name}</h3>
            <div className="flex items-center gap-2 mt-1">
              <span id="risk-badge" className="text-[10px] font-bold bg-white/20 px-2 py-0.5 rounded-full border border-white/20 flex items-center gap-1">
                <Shield className="w-3 h-3 text-yellow-300" />
                评估结果：{profile.riskTolerance}
              </span>
            </div>
          </div>
        </div>

        {/* Assets Row */}
        <div className="grid grid-cols-2 gap-4 mt-6 pt-4 border-t border-white/15">
          <div>
            <p className="text-[10px] text-indigo-200/90 font-medium">我的虚拟总资产 (CNY)</p>
            <p id="total-assets-value" className="text-xl font-bold font-mono tracking-tight mt-1">
              ¥{(profile.virtualBalance + followedStocks.length * 4500).toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-indigo-200/90 font-medium">模拟账户可用余额</p>
            <p id="available-assets-value" className="text-xl font-bold font-mono tracking-tight mt-1">
              ¥{profile.virtualBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </p>
          </div>
        </div>
      </div>



      {/* Profile Settings and Tools List */}
      <div id="settings-menu-list" className="mx-4 bg-white border border-gray-100 rounded-3xl p-4 space-y-1.5 shadow-sm">
        <button
          id="btn-reassess-risk"
          onClick={() => {
            setIsQuizOpen(true);
            setCurrentQuestionIndex(0);
            setQuizAnswers([]);
          }}
          className="w-full flex items-center justify-between p-3.5 hover:bg-gray-50 rounded-2xl transition-colors text-left"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-50 rounded-xl text-indigo-600">
              <Shield className="w-4.5 h-4.5" />
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-900">重新评定投资偏好</p>
              <p className="text-[10px] text-gray-400">目前为“{profile.riskTolerance}”，测定可匹配专属AI话术</p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-gray-400" />
        </button>

        <div className="w-full flex items-center justify-between p-3.5 hover:bg-gray-50 rounded-2xl transition-colors text-left">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-yellow-50 rounded-xl text-yellow-600">
              <Bell className="w-4.5 h-4.5" />
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-900">智能主力异常异动预警</p>
              <p className="text-[10px] text-gray-400">当自选板块流入放缓时泡泡主动提示</p>
            </div>
          </div>
          <div className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" defaultChecked className="sr-only peer" />
            <div className="w-8 h-4 bg-gray-200 rounded-full peer peer-focus:ring-2 peer-focus:ring-indigo-300 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-indigo-600"></div>
          </div>
        </div>

        <div className="w-full flex items-center justify-between p-3.5 hover:bg-gray-50 rounded-2xl transition-colors text-left">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-50 rounded-xl text-purple-600">
              <BookOpen className="w-4.5 h-4.5" />
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-900">智能金融投研大百科</p>
              <p className="text-[10px] text-gray-400">KDJ、布林线、主力净额及技术战法讲解</p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-gray-400" />
        </div>
      </div>

      {/* Quiz Modal Popup */}
      <AnimatePresence>
        {isQuizOpen && (
          <div id="quiz-overlay" className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl p-6 w-full max-w-sm space-y-6 shadow-2xl"
            >
              <div className="flex justify-between items-center">
                <h3 className="text-base font-bold text-gray-950">
                  投资偏好测定 ({currentQuestionIndex + 1}/{quizQuestions.length})
                </h3>
                <button
                  onClick={() => setIsQuizOpen(false)}
                  className="text-gray-400 hover:text-gray-800 text-sm font-semibold"
                >
                  取消
                </button>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-gray-100 h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-indigo-600 h-full transition-all"
                  style={{ width: `${((currentQuestionIndex + 1) / quizQuestions.length) * 100}%` }}
                ></div>
              </div>

              {/* Question Text */}
              <div className="space-y-4">
                <p className="text-xs font-bold text-gray-800 leading-relaxed">
                  {quizQuestions[currentQuestionIndex].text}
                </p>

                {/* Options List */}
                <div className="space-y-2">
                  {quizQuestions[currentQuestionIndex].options.map((opt, i) => (
                    <button
                      key={i}
                      onClick={() => handleQuizAnswer(i)}
                      className="w-full text-left p-3.5 border border-gray-100 hover:border-indigo-400 hover:bg-indigo-50 rounded-2xl text-xs font-medium transition-all duration-150 active:scale-[0.98]"
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
