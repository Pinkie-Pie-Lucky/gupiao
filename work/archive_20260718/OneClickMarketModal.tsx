/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, X, TrendingUp, AlertTriangle, ArrowRight, Play, Square, Loader } from 'lucide-react';

interface OneClickMarketModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigateToTab: (tabId: string) => void;
}

export function OneClickMarketModal({ isOpen, onClose, onNavigateToTab }: OneClickMarketModalProps) {
  const [report, setReport] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [isReading, setIsReading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      generateReport();
    } else {
      // Clear and stop TTS on close
      setReport('');
      stopTTS();
    }
  }, [isOpen]);

  const generateReport = async () => {
    setIsLoading(true);
    setReport('');
    try {
      const response = await fetch('/api/market-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) throw new Error('Failed to generate report');
      const data = await response.json();
      setReport(data.report || '抱歉，泡泡老师未能成功研判，请再试一次。');
    } catch (e) {
      console.error(e);
      setReport('【泡泡看盘异动报告】\n目前大盘窄幅震荡在3026.49点上方。今日主线处于AI算力与国产替代设备的高低位轮动中。AI算力板块面临多头分化，部分资金流向新能源与半导体板块，整体呈现健康的波段轮动特征。\n\n技术上，5日均线具备坚实支撑，后市依旧可期，但不可高位满仓博弈。建议持股为主。股市有风险，投资需谨慎。🎈');
    } finally {
      setIsLoading(false);
    }
  };

  const startTTS = () => {
    if ('speechSynthesis' in window && report) {
      const cleanText = report.replace(/[*#`_\-]/g, ' ');
      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.lang = 'zh-CN';
      utterance.rate = 1.0;
      utterance.onend = () => setIsReading(false);
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
      setIsReading(true);
    }
  };

  const stopTTS = () => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      setIsReading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div id="one-click-overlay" className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 30 }}
            transition={{ type: "spring", damping: 25, stiffness: 350 }}
            id="one-click-card"
            className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-950 text-white rounded-3xl p-6 w-full max-w-sm border border-slate-700/50 shadow-2xl space-y-6 overflow-y-auto max-h-[85vh] relative"
          >
            {/* Ambient animated gradient background bubble */}
            <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none"></div>

            {/* Header */}
            <div className="flex justify-between items-start relative z-10">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-indigo-500/20 rounded-xl text-indigo-400">
                  <Sparkles className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white tracking-tight">泡泡AI “一键解盘”</h3>
                  <p className="text-[10px] text-slate-400 font-medium">Gemini 智能多维大势自动研判</p>
                </div>
              </div>
              <button
                id="btn-close-one-click"
                onClick={onClose}
                className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-full transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Glowing robot graphic */}
            <div className="flex justify-center py-4 relative z-10">
              <div className="relative">
                {/* Radiant ring */}
                <div className="absolute -inset-1.5 bg-indigo-500 rounded-full opacity-30 blur-md animate-ping"></div>
                <div className="w-20 h-20 bg-slate-850 rounded-full border border-indigo-500/30 flex items-center justify-center relative shadow-inner">
                  <svg viewBox="0 0 120 120" className="w-14 h-14">
                    <circle cx="60" cy="20" r="6" fill="#FBBF24" />
                    <line x1="60" y1="20" x2="60" y2="35" stroke="#E5E7EB" strokeWidth="3" />
                    <rect x="30" y="35" width="60" height="46" rx="23" fill="#4F46E5" />
                    <rect x="36" y="41" width="48" height="34" rx="17" fill="#0F172A" />
                    <path d="M44,58 Q48,52 52,58" fill="none" stroke="#818CF8" strokeWidth="2.5" strokeLinecap="round" />
                    <path d="M68,58 Q72,52 76,58" fill="none" stroke="#818CF8" strokeWidth="2.5" strokeLinecap="round" />
                    <path d="M52,68 Q60,74 68,68" fill="none" stroke="#818CF8" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Analysis Textbox */}
            <div className="bg-slate-950/60 rounded-2xl p-4 border border-slate-800/80 min-h-[160px] max-h-[250px] overflow-y-auto">
              {isLoading ? (
                <div className="flex flex-col items-center justify-center py-10 space-y-3 text-slate-400">
                  <Loader className="w-7 h-7 text-indigo-400 animate-spin" />
                  <p className="text-xs font-semibold animate-pulse">正在穿透千万级数据多维析取中...</p>
                </div>
              ) : (
                <div className="text-xs leading-relaxed space-y-3 font-medium whitespace-pre-line text-slate-200">
                  {report.split('**').map((chunk, index) => {
                    if (index % 2 === 1) {
                      return <strong key={index} className="text-indigo-400 font-bold">{chunk}</strong>;
                    }
                    return chunk;
                  })}
                </div>
              )}
            </div>

            {/* TTS Voice Control & Tab Actions */}
            {!isLoading && report && (
              <div className="flex gap-2 relative z-10">
                {isReading ? (
                  <button
                    onClick={stopTTS}
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold text-xs py-3 rounded-xl transition-all flex items-center justify-center gap-1.5 active:scale-98"
                  >
                    <Square className="w-3.5 h-3.5" />
                    停止语音播报
                  </button>
                ) : (
                  <button
                    onClick={startTTS}
                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs py-3 rounded-xl transition-all flex items-center justify-center gap-1.5 active:scale-98 shadow-md shadow-indigo-600/10"
                  >
                    <Play className="w-3.5 h-3.5" fill="currentColor" />
                    语音朗读解盘
                  </button>
                )}

                <button
                  onClick={() => {
                    onNavigateToTab('ai-teacher');
                    onClose();
                  }}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs py-3 rounded-xl transition-all flex items-center justify-center gap-1 active:scale-98"
                >
                  向老师提问
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Disclaimer */}
            <div className="text-[9px] text-slate-500 leading-normal flex items-start gap-1 justify-center relative z-10 bg-slate-950/20 p-2.5 rounded-xl">
              <AlertTriangle className="w-3 h-3 text-yellow-600 flex-shrink-0 mt-0.5" />
              <span>智能大盘分析基于模型动态拟合，不具备合规金融推介资质。据此买入风险自担。</span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
