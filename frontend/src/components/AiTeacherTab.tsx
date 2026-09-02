/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Send, Sparkles, AlertTriangle, ArrowRight, Volume2, ShieldCheck } from 'lucide-react';
import { ChatMessage } from '../types';

interface AiTeacherTabProps {
  prefilledStock: { name: string; code: string } | null;
  onClearPrefilledStock: () => void;
  pendingPrompt?: string | null;
  onConsumePendingPrompt?: () => void;
}

export function AiTeacherTab({ prefilledStock, onClearPrefilledStock, pendingPrompt, onConsumePendingPrompt }: AiTeacherTabProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'greeting',
      sender: 'assistant',
      text: '你好！我是你的智能投研小助手**泡泡老师**。🎈\n\n今天大盘在3026点附近窄幅震荡，**AI算力**板块冲高回落主力获利流出，而**半导体设备**与**机器人**板块接力走强表现亮眼！\n\n你可以向我提问关于任何**板块分析、个股技术面研判、或者适合你的资产配置方案**，我会用专业的AI智能模型为你深入解答。快在下方打字或选择感兴趣的话题，跟泡泡聊聊吧！',
      timestamp: new Date(),
      suggestedPrompts: [
        '分析一下今日AI算力板块主力为何流出？',
        '半导体设备国产替代龙头有哪几个？',
        '分析 贵州茅台(600519) 的支撑位与买点',
        '为我做一份“平衡型”虚拟资产配置方案'
      ]
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // 会话唯一标识：每次进入 AI 泡泡页生成一次，用于聊天记录落库后的按会话归档。
  const sessionIdRef = useRef<string>(`bubble-chat-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

  // Auto-scroll to bottom of chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Handle prefilled stock triggers from parent components
  useEffect(() => {
    if (prefilledStock) {
      const prompt = `分析个股 ${prefilledStock.name} (${prefilledStock.code}) 的技术走势、支撑位及投资决策建议。`;
      setInputValue(prompt);
      // Automatically send the message after a tiny delay
      const timer = setTimeout(() => {
        handleSendMessage(prompt);
        onClearPrefilledStock();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [prefilledStock]);

  // Support global events triggered from search or home widgets
  useEffect(() => {
    const handleGlobalChatTrigger = (e: Event) => {
      const customEvent = e as CustomEvent<string>;
      if (customEvent.detail) {
        handleSendMessage(customEvent.detail);
      }
    };
    window.addEventListener('trigger-ai-chat', handleGlobalChatTrigger);
    return () => window.removeEventListener('trigger-ai-chat', handleGlobalChatTrigger);
  }, []);

  // Send a pending prompt (e.g. sector "问泡泡") when arriving from another tab
  useEffect(() => {
    if (pendingPrompt) {
      const prompt = pendingPrompt;
      setInputValue(prompt);
      const timer = setTimeout(() => {
        handleSendMessage(prompt);
        onConsumePendingPrompt?.();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [pendingPrompt]);

  const handleSendMessage = async (textToSend: string) => {
    const text = textToSend.trim();
    if (!text) return;

    // Append User Message
    const userMsgId = String(Date.now());
    const userMessage: ChatMessage = {
      id: userMsgId,
      sender: 'user',
      text: text,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    try {
      // Build simple context array from chat history (maximum last 4 messages to preserve tokens)
      const recentHistory = messages
        .slice(-4)
        .map(msg => ({
          role: msg.sender === 'user' ? 'user' : 'assistant',
          parts: [{ text: msg.text }]
        }));

      // Call server API route
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: recentHistory,
          sessionId: sessionIdRef.current,
        }),
      });

      if (!response.ok) {
        throw new Error('API request failed');
      }

      const data = await response.json();
      
      const assistantMessage: ChatMessage = {
        id: String(Date.now() + 1),
        sender: 'assistant',
        text: data.reply || '抱歉，泡泡老师正在看盘，请稍后再试一次。',
        timestamp: new Date(),
        suggestedPrompts: data.suggestedPrompts || [
          '这只股票的技术支撑位在多少？',
          '同行业还有哪些潜力龙头？',
          '该板块主力资金流向如何？'
        ]
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Chat error:', error);
      const errorMsg: ChatMessage = {
        id: String(Date.now() + 2),
        sender: 'assistant',
        text: '泡泡由于网络连接断开，暂时无法获得市场实时数据。请检查您的网络连接并重试。⚠️\n\n提示：股市波动剧烈，请注意规避高位题材股交易风险。',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSpeechFeedback = (text: string) => {
    // Basic browser tts utility or notify user
    if ('speechSynthesis' in window) {
      // Clean up markdown before reading
      const cleanText = text.replace(/[*#`_\-\n]/g, ' ');
      const utterance = new SpeechSynthesisUtterance(cleanText.substring(0, 200) + "...");
      utterance.lang = 'zh-CN';
      utterance.rate = 1.0;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    }
  };

  return (
    <div id="ai-teacher-tab-view" className="flex flex-col h-[calc(100vh-135px)] bg-gray-50/50">
      {/* Mini Title bar with disclaimer */}
      <div id="teacher-header-banner" className="bg-white border-b border-gray-100 p-3.5 pr-16 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 bg-indigo-100 rounded-xl flex items-center justify-center relative">
            <svg viewBox="0 0 120 120" className="w-7 h-7">
              <circle cx="60" cy="20" r="6" fill="#FBBF24" />
              <line x1="60" y1="20" x2="60" y2="35" stroke="#E5E7EB" strokeWidth="3" />
              <rect x="30" y="35" width="60" height="46" rx="23" fill="#3B82F6" />
              <rect x="36" y="41" width="48" height="34" rx="17" fill="#0F172A" />
              <path d="M44,58 Q48,52 52,58" fill="none" stroke="#38BDF8" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M68,58 Q72,52 76,58" fill="none" stroke="#38BDF8" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            <span className="absolute -right-0.5 -bottom-0.5 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white animate-pulse"></span>
          </div>
          <div>
            <h3 id="teacher-top-title" className="text-sm font-bold text-gray-900 flex items-center gap-1">
              泡泡老师 AI
              <span className="text-[9px] bg-indigo-50 text-indigo-600 font-bold px-1 rounded">PRO</span>
            </h3>
            <p className="text-[10px] text-gray-400 font-medium">百万量级智能金融投研大脑已在线</p>
          </div>
        </div>

        <div className="text-[10px] text-gray-400 flex items-center gap-1 bg-gray-50 px-2 py-1 rounded-lg">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
          <span>合规投顾过滤</span>
        </div>
      </div>

      {/* Messages Scroll Area */}
      <div id="chat-messages-scroll" className="flex-grow overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => {
          const isUser = msg.sender === 'user';
          return (
            <div
              key={msg.id}
              className={`flex gap-3 max-w-[90%] ${isUser ? 'ml-auto flex-row-reverse' : 'mr-auto'}`}
            >
              {/* Avatar */}
              {!isUser && (
                <div className="w-8 h-8 rounded-full bg-indigo-100 flex-shrink-0 flex items-center justify-center">
                  <svg viewBox="0 0 120 120" className="w-6 h-6">
                    <rect x="30" y="35" width="60" height="46" rx="23" fill="#3B82F6" />
                    <rect x="36" y="41" width="48" height="34" rx="17" fill="#0F172A" />
                    <path d="M44,58 Q48,52 52,58" fill="none" stroke="#38BDF8" strokeWidth="2.5" strokeLinecap="round" />
                    <path d="M68,58 Q72,52 76,58" fill="none" stroke="#38BDF8" strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                </div>
              )}

              {/* Message bubble */}
              <div className="space-y-2">
                <div
                  className={`p-3.5 rounded-2xl text-xs leading-relaxed border ${
                    isUser
                      ? 'bg-indigo-600 text-white border-indigo-600 rounded-tr-sm shadow-sm'
                      : 'bg-white text-gray-800 border-gray-100 shadow-sm rounded-tl-sm'
                  }`}
                >
                  <div className="whitespace-pre-line font-medium">
                    {/* Render basic bold highlighting for better stock reading */}
                    {msg.text.split('**').map((chunk, index) => {
                      if (index % 2 === 1) {
                        return <strong key={index} className={isUser ? 'text-yellow-200' : 'text-indigo-700 font-bold'}>{chunk}</strong>;
                      }
                      return chunk;
                    })}
                  </div>

                  {/* Speech playback & assistance buttons for AI assistant */}
                  {!isUser && (
                    <div className="flex justify-end items-center gap-2 mt-3 pt-2 border-t border-gray-50 text-[10px] text-gray-400">
                      <button
                        onClick={() => handleSpeechFeedback(msg.text)}
                        className="hover:text-indigo-500 flex items-center gap-1 py-0.5 px-1.5 rounded bg-gray-50"
                      >
                        <Volume2 className="w-3 h-3" />
                        语音播报
                      </button>
                    </div>
                  )}
                </div>

                {/* Suggestions / Prompt chips under assistant reply */}
                {!isUser && msg.suggestedPrompts && msg.suggestedPrompts.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1.5">
                    {msg.suggestedPrompts.map((promptText) => (
                      <button
                        key={promptText}
                        onClick={() => handleSendMessage(promptText)}
                        className="bg-white hover:bg-indigo-50 border border-gray-100 hover:border-indigo-200 text-gray-600 hover:text-indigo-600 text-[10px] font-semibold py-1.5 px-3 rounded-full transition-all text-left shadow-sm flex items-center gap-1 group"
                      >
                        <span>{promptText}</span>
                        <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Loading / Typing indicator */}
        {isLoading && (
          <div className="flex gap-3 max-w-[80%] mr-auto items-end">
            <div className="w-8 h-8 rounded-full bg-indigo-100 flex-shrink-0 flex items-center justify-center animate-bounce">
              <svg viewBox="0 0 120 120" className="w-6 h-6">
                <rect x="30" y="35" width="60" height="46" rx="23" fill="#4F46E5" />
                <rect x="36" y="41" width="48" height="34" rx="17" fill="#0F172A" />
              </svg>
            </div>
            <div className="bg-white border border-gray-100 p-3 rounded-2xl rounded-tl-sm shadow-sm flex items-center gap-2">
              <span className="text-[10px] text-gray-400 font-semibold">泡泡正在盯盘研判中</span>
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input box bottom bar */}
      <div id="chat-input-bar-container" className="bg-white border-t border-gray-100 p-3.5 flex-shrink-0 space-y-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage(inputValue);
          }}
          className="flex gap-2 items-center"
        >
          <div className="relative flex-grow">
            <input
              id="ai-chat-input-text"
              type="text"
              disabled={isLoading}
              placeholder={isLoading ? '分析研判中...' : '输入板块、个股(如：科大讯飞)或资产配置提问...'}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              className="w-full bg-gray-50 text-gray-900 placeholder-gray-400 pl-4 pr-10 py-2.5 rounded-2xl border border-gray-200 focus:outline-none focus:border-indigo-500 focus:bg-white text-xs font-semibold transition-all disabled:opacity-50"
            />
            <Sparkles className="absolute right-3.5 top-1/2 -translate-y-1/2 text-indigo-400 w-4 h-4 pointer-events-none" />
          </div>

          <button
            id="btn-submit-ai-chat"
            type="submit"
            disabled={isLoading || !inputValue.trim()}
            className="p-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-100 text-white disabled:text-gray-400 rounded-2xl active:scale-95 transition-all shadow-md shadow-indigo-600/10 flex items-center justify-center flex-shrink-0"
          >
            <Send className="w-4.5 h-4.5" />
          </button>
        </form>

        {/* Regulatory Risk warning statement */}
        <div className="text-[9px] text-gray-400 leading-normal flex items-start gap-1 justify-center bg-gray-50 p-2 rounded-xl border border-gray-100/50">
          <AlertTriangle className="w-3.5 h-3.5 text-yellow-500 flex-shrink-0 mt-0.5" />
          <span className="font-medium">
            AI投研回复仅供参考，不构成实质投资建议。股市有风险，投资需谨慎。泡泡理财师不保证任何本金收益。
          </span>
        </div>
      </div>
    </div>
  );
}
