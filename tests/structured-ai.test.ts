import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyStructuredAiFailure, filterEvidenceIds, parseStructuredAiJson } from '../backend/lib/structuredAi.js';

test('解析 GLM <think>/<answer> 包裹的最终 JSON', () => {
  assert.deepEqual(parseStructuredAiJson('<think>内部推理</think><answer>{"summary":"可核验"}</answer>'), { summary: '可核验' });
});

test('解析 Markdown JSON 和 JSON 后附加说明', () => {
  assert.deepEqual(parseStructuredAiJson('```json\n{"summary":"可核验"}\n```\n以上为结果'), { summary: '可核验' });
});

test('缺逗号和截断 JSON 会保留为可识别的非法格式', () => {
  assert.throws(() => parseStructuredAiJson('{"summary":"a" "viewpoints":[]}'));
  assert.throws(() => parseStructuredAiJson('{"summary":"a"'));
  assert.equal(classifyStructuredAiFailure(new Error("Expected ',' or '}' after property value")), 'invalid_json');
});

test('空内容和超时各自得到明确失败类别', () => {
  assert.throws(() => parseStructuredAiJson(''), /empty content/);
  assert.equal(classifyStructuredAiFailure(new Error('The operation was aborted due to timeout')), 'timeout');
});

test('未知证据 ID 不会进入 AI 可展示字段', () => {
  const ids = filterEvidenceIds(['evidence-1', 'fabricated', 'evidence-1'], new Set(['evidence-1']));
  assert.deepEqual(ids, ['evidence-1']);
  assert.equal(classifyStructuredAiFailure(new Error('evidence validation failed')), 'schema_validation');
});
