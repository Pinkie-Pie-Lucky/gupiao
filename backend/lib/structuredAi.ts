export type AiFailureStage = 'completed' | 'timeout' | 'empty_content' | 'invalid_json' | 'schema_validation' | 'upstream_error' | 'unknown';

/**
 * 兼容 GLM 的 think/answer 包裹、Markdown 围栏和回答末尾附加文字，只取首个完整 JSON 对象。
 * 这里不做“猜测式”修复；格式不完整应由上层的 JSON 修复模型处理。
 */
export function parseStructuredAiJson(raw: unknown): any {
  const rawText = String(raw || '').trim();
  if (!rawText) throw new Error('AI returned empty content');
  const withoutThinking = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const answer = withoutThinking.match(/<answer>\s*([\s\S]*?)\s*<\/answer>/i)?.[1] || withoutThinking;
  const normalized = answer.replace(/```json\s*/gi, '').replace(/```/g, '').replace(/[\u0000-\u001F]/g, ' ').trim();
  if (!normalized) throw new Error('AI returned empty content');
  const start = normalized.indexOf('{');
  if (start < 0) return JSON.parse(normalized);
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return JSON.parse(normalized.slice(start, index + 1));
    }
  }
  return JSON.parse(normalized);
}

/** AI 只能引用本次冻结快照内存在的证据，未知 ID 必须丢弃。 */
export function filterEvidenceIds(value: unknown, evidenceSet: Set<string>, limit = 8): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(String).filter((id) => evidenceSet.has(id)))].slice(0, limit);
}

export function classifyStructuredAiFailure(error: unknown): AiFailureStage {
  const message = String((error as any)?.message || error || '').toLowerCase();
  if (/abort|timeout|timed out|etimedout/.test(message)) return 'timeout';
  if (/empty ai content|empty content|returned empty/.test(message)) return 'empty_content';
  if (/json|unexpected token|expected ','|expected ':'|unterminated/.test(message)) return 'invalid_json';
  if (/evidence|schema|validation/.test(message)) return 'schema_validation';
  if (/http|network|fetch|api request failed|rate limit|429|5\d\d/.test(message)) return 'upstream_error';
  return 'unknown';
}
