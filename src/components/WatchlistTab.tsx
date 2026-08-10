/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Star, MessageSquare, Trash2, Bell, ArrowUpRight, X } from 'lucide-react';
import { StockItem, PersonalizedAlert } from '../types';
import { initialAlerts } from '../data';

interface WatchlistTabProps {
  followedStocks: StockItem[];
  setFollowedStocks: React.Dispatch<React.SetStateAction<StockItem[]>>;
  onAskTeacherAboutStock: (stockName: string, stockCode: string) => void;
  onNavigateToTab: (tabId: string) => void;
  onOpenResearch: (stock: StockItem) => void;
}

// 暂时隐藏 AI 盯盘预警，保留原有展示代码，后续改为 true 即可恢复。
const SHOW_AI_ALERTS = false;

export function WatchlistTab({
  followedStocks,
  setFollowedStocks,
  onAskTeacherAboutStock,
  onNavigateToTab,
  onOpenResearch,
}: WatchlistTabProps) {
  const [selectedAlert, setSelectedAlert] = useState<PersonalizedAlert | null>(null);

  const handleRemoveStock = (code: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFollowedStocks((prev) => prev.filter((s) => s.code !== code));
  };

  return (
    <div id="watchlist-tab-view" className="space-y-6 pb-24">
      {/* Header */}
      <div id="watchlist-header" className="px-4 pt-2">
        <h2 id="watchlist-title" className="text-2xl font-bold text-gray-950 flex items-center gap-2">
          <Star className="w-6 h-6 text-indigo-600 fill-indigo-100" />
          我的关注
        </h2>
      </div>

      {/* Followed Stocks List */}
      <div id="followed-stocks-section" className="px-4 space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-xs font-bold text-gray-400">已关注的股票 ({followedStocks.length})</span>
          {followedStocks.length > 0 && (
            <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full font-semibold">
              点击卡片快速查看或向AI提问
            </span>
          )}
        </div>

        {followedStocks.length === 0 ? (
          <div id="empty-watchlist-state" className="bg-white border border-dashed border-gray-200 rounded-3xl p-8 text-center space-y-4">
            <div className="w-12 h-12 bg-gray-50 rounded-2xl flex items-center justify-center mx-auto text-gray-400">
              <Star className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <p className="text-xs font-bold text-gray-800">暂无关注股票</p>
              <p className="text-[10px] text-gray-400 max-w-[200px] mx-auto leading-relaxed">
                您可以前往“市场地图”寻找潜力板块，将中意个股加入关注清单
              </p>
            </div>
            <button
              onClick={() => onNavigateToTab('market-map')}
              className="bg-indigo-50 hover:bg-indigo-100 text-indigo-600 text-xs font-bold px-4 py-2 rounded-xl transition-all"
            >
              前往市场地图
            </button>
          </div>
        ) : (
          <div id="watchlist-cards-grid" className="space-y-2.5">
            {followedStocks.map((stock) => {
              const isUp = stock.changePercent >= 0;
              return (
                <div
                  key={stock.code}
                  id={`watchlist-card-${stock.code}`}
                  className="bg-white border border-gray-100 rounded-2xl p-4 hover:border-indigo-100 transition-all shadow-sm hover:shadow-md space-y-3"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-bold text-sm text-gray-900 flex items-center gap-1.5">
                        {stock.name}
                        <span className="text-[10px] text-gray-400 font-mono font-medium">{stock.code}</span>
                      </div>
                      <div className="flex gap-4 text-[10px] text-gray-400 mt-1 font-medium">
                        <span>量: {stock.volume}</span>
                        <span>额: {stock.turnover}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="font-mono font-bold text-sm text-gray-900 leading-none">
                          ¥{stock.price.toFixed(2)}
                        </div>
                        <div className={`text-[10px] font-bold font-mono mt-1 ${isUp ? 'text-red-500' : 'text-emerald-500'}`}>
                          {isUp ? '+' : ''}{stock.changePercent}%
                        </div>
                      </div>

                      <button
                        onClick={(e) => handleRemoveStock(stock.code, e)}
                        className="p-1.5 text-gray-300 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors"
                        title="取消关注"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Actions Bar */}
                  <div className="flex gap-2 pt-2 border-t border-gray-50">
                    <button
                      onClick={() => {
                        onAskTeacherAboutStock(stock.name, stock.code);
                        onNavigateToTab('ai-teacher');
                      }}
                      className="flex-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 font-bold text-[10px] py-1.5 rounded-xl transition-all flex items-center justify-center gap-1"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      向泡泡提问此股
                    </button>
                    <button
                      onClick={() => {
                        onOpenResearch(stock);
                      }}
                      className="flex-1 bg-gray-50 hover:bg-gray-100 text-gray-600 font-bold text-[10px] py-1.5 rounded-xl transition-all flex items-center justify-center gap-1"
                    >
                      <ArrowUpRight className="w-3.5 h-3.5" />
                      查看研究报告
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* AI Smart Monitor Alerts */}
      {SHOW_AI_ALERTS && <div id="ai-alerts-section" className="px-4 space-y-3">
        <h4 className="text-xs font-bold text-gray-400 flex items-center gap-1">
          <Bell className="w-3.5 h-3.5 text-indigo-600" />
          AI智能盯盘预警
        </h4>

        <div className="space-y-2.5">
          {initialAlerts.map((alert) => {
            const isWarning = alert.type === 'warning';
            return (
              <div
                key={alert.id}
                id={`alert-card-${alert.id}`}
                className={`p-4 rounded-2xl border transition-all ${
                  isWarning
                    ? 'bg-rose-50/40 border-rose-100 text-rose-900'
                    : 'bg-emerald-50/40 border-emerald-100 text-emerald-900'
                }`}
              >
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${isWarning ? 'bg-rose-500' : 'bg-emerald-500'}`}></span>
                    <span className="text-[10px] font-bold tracking-wider uppercase opacity-60">
                      {isWarning ? '风控预警' : '热点提示'} · {alert.time}
                    </span>
                  </div>
                </div>

                <p className="text-xs font-semibold mt-2 leading-relaxed text-gray-800">
                  {alert.content}
                </p>

                <div className="flex justify-end mt-3">
                  <button
                    onClick={() => setSelectedAlert(alert)}
                    className={`text-[10px] font-bold px-3 py-1 rounded-lg border transition-all ${
                      isWarning
                        ? 'border-rose-200 hover:bg-rose-100/50 text-rose-700'
                        : 'border-emerald-200 hover:bg-emerald-100/50 text-emerald-700'
                    }`}
                  >
                    查看深度决策分析
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>}

      {/* Advisory Modal Panel */}
      <AnimatePresence>
        {selectedAlert && (
          <div id="alert-modal-overlay" className="fixed inset-0 bg-slate-950/40 backdrop-blur-sm z-50 flex items-end justify-center">
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 220 }}
              id="alert-modal-content"
              className="bg-white rounded-t-[32px] w-full max-w-md p-6 pb-8 border-t border-gray-100 shadow-2xl space-y-6 max-h-[85vh] overflow-y-auto"
            >
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <div className={`p-1.5 rounded-xl ${selectedAlert.type === 'warning' ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'}`}>
                    <Bell className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-bold text-gray-400">泡泡解盘 · 独家决策件</span>
                </div>
                <button
                  id="close-alert-modal"
                  onClick={() => setSelectedAlert(null)}
                  className="p-1.5 bg-gray-50 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-700 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-4">
                <h4 className="text-sm font-bold text-gray-950 border-l-4 border-indigo-600 pl-2">
                  泡泡老师独家投资决策分析
                </h4>
                <div
                  id="sheet-alert-markdown"
                  className="text-xs text-gray-700 leading-relaxed whitespace-pre-line bg-gray-50 rounded-2xl p-4 border border-gray-100 font-medium"
                >
                  {selectedAlert.fullAnalysis.split('**').map((chunk, index) => {
                    if (index % 2 === 1) {
                      return <strong key={index} className="text-indigo-600 font-bold">{chunk}</strong>;
                    }
                    return chunk;
                  })}
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => {
                    setSelectedAlert(null);
                    onNavigateToTab('market-map');
                  }}
                  className="flex-1 bg-indigo-600 text-white font-semibold text-xs py-3 rounded-xl hover:bg-indigo-700 transition-colors shadow-sm"
                >
                  前往研判板块
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
