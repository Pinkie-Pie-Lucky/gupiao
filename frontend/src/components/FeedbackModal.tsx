/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';

interface FeedbackModalProps {
  contentType: string;
  contentId: string;
  promptVersion: string;
  onClose: () => void;
}

const REASONS = [
  { key: 'inaccurate', label: '不准确' },
  { key: 'too_complex', label: '太复杂' },
  { key: 'unclear', label: '看不懂' },
  { key: 'too_long', label: '解释太长' },
];

export function FeedbackModal({ contentType, contentId, promptVersion, onClose }: FeedbackModalProps) {
  const [selectedReasons, setSelectedReasons] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);

  const toggleReason = (key: string) => {
    setSelectedReasons(prev =>
      prev.includes(key) ? prev.filter(r => r !== key) : [...prev, key]
    );
  };

  const handleSubmit = async () => {
    setSending(true);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentType,
          contentId,
          promptVersion,
          rating: 'negative',
          reasons: selectedReasons,
          comment: comment.trim(),
          timestamp: new Date().toISOString(),
        }),
      });
      if (!res.ok) {
        console.error('Feedback submit failed:', res.status);
      }
    } catch (e) {
      console.error('Feedback submit error:', e);
    }
    setSending(false);
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
        <div className="bg-white rounded-3xl p-6 max-w-xs w-full shadow-2xl text-center" onClick={e => e.stopPropagation()}>
          <div className="text-3xl mb-3">🙏</div>
          <p className="text-sm font-bold text-gray-900 mb-1">感谢你的反馈</p>
          <p className="text-[11px] text-gray-500">泡泡老师会认真参考，继续优化内容~</p>
          <button onClick={onClose} className="mt-4 text-xs font-bold text-indigo-600 bg-indigo-50 px-4 py-2 rounded-xl w-full">
            关闭
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl p-6 max-w-xs w-full shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-gray-900">这个解释哪里需要改进？</h3>
          <button onClick={onClose} className="text-gray-400 text-lg leading-none">&times;</button>
        </div>

        <div className="space-y-2.5 mb-4">
          {REASONS.map(r => (
            <button
              key={r.key}
              onClick={() => toggleReason(r.key)}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-medium border transition-all ${
                selectedReasons.includes(r.key)
                  ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                  : 'bg-white border-gray-100 text-gray-600 hover:border-gray-200'
              }`}
            >
              {selectedReasons.includes(r.key) ? '✓ ' : ''}{r.label}
            </button>
          ))}
        </div>

        <textarea
          placeholder="补充建议（选填）..."
          value={comment}
          onChange={e => setComment(e.target.value)}
          rows={2}
          className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-gray-100 bg-gray-50 resize-none mb-4 focus:outline-none focus:border-indigo-200"
        />

        <button
          onClick={handleSubmit}
          disabled={sending}
          className="w-full bg-indigo-600 text-white text-xs font-bold py-2.5 rounded-xl hover:bg-indigo-700 transition-colors disabled:opacity-50"
        >
          {sending ? '提交中...' : '提交反馈'}
        </button>
      </div>
    </div>
  );
}