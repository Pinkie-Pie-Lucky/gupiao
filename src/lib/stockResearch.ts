export type ResearchSectionKey = 'fundamental' | 'technical' | 'events' | 'sentiment' | 'valuation' | 'risk' | 'evidence';

export function normalizeResearchSymbol(input: string) {
  const symbol = String(input || '').trim().toUpperCase().replace(/\.(SH|SZ|BJ)$|^(SH|SZ|BJ)/, '');
  if (!/^\d{6}$/.test(symbol)) throw new Error('股票代码应为 6 位数字');
  return symbol;
}

export function researchItemText(item: any) {
  if (typeof item === 'string' || typeof item === 'number') return String(item).trim();
  return String(item?.text || item?.claim || item?.description || item?.summary || item?.title || '').trim();
}

export function mergeResearchItems(...values: any[]) {
  return values.flatMap((value) => Array.isArray(value) ? value : value == null || value === '' ? [] : [value]).filter((item) => researchItemText(item));
}

export function researchDataGapText(value: any) {
  const text = researchItemText(value);
  if (!text) return '';
  if (!/Command failed:|No suitable Python runtime|ENOENT|spawn/i.test(text)) return text;
  if (/financial_summary|financial|财务/i.test(text)) return '财务数据服务暂不可用，请稍后刷新。';
  if (/market_daily_kline|technical|行情|技术/i.test(text)) return '行情与技术数据服务暂不可用，请稍后刷新。';
  if (/cninfo|announcement|公告/i.test(text)) return '公告数据服务暂不可用，请稍后刷新。';
  if (/xueqiu|sentiment|舆情/i.test(text)) return '舆情数据服务暂不可用，请稍后刷新。';
  return '部分研究数据服务暂不可用，请稍后刷新。';
}

function labelValue(label: string, value: any) {
  if (value == null || value === '' || value === 'unavailable') return null;
  return `${label}：${String(value)}`;
}

export function researchSectionItems(outputs: any, key: Exclude<ResearchSectionKey, 'evidence'>, counterCase: any[] = []) {
  const data = outputs || {};
  if (key === 'fundamental') return mergeResearchItems(data.fundamental?.signals, data.fundamental?.vetoes);
  if (key === 'technical') return mergeResearchItems(data.technical?.signals, data.technical?.vetoes, data.technical?.conditions, data.technical?.summary);
  if (key === 'events') return mergeResearchItems(data.events?.events, data.events?.items, data.events?.summary);
  if (key === 'sentiment') {
    const sentiment = data.sentiment || {};
    return mergeResearchItems(sentiment.items, sentiment.claims, labelValue('关注度', sentiment.attention), labelValue('情绪倾向', sentiment.tone), labelValue('观点分歧', sentiment.disagreement), labelValue('事件后反应', sentiment.eventReaction), labelValue('传播质量', sentiment.propagationQuality));
  }
  if (key === 'valuation') return mergeResearchItems(data.valuation?.reason, data.valuation?.comparison?.reason);
  return mergeResearchItems(data.risk?.vetoes, data.risk?.risks, data.risk?.watchConditions, counterCase);
}

export function createResearchViewModel(payload: any) {
  const manager = payload?.deterministicManager || {};
  const opinion = payload?.opinion || {};
  const snapshot = payload?.managerSnapshot || {};
  const outputs = snapshot.agentOutputs || {};
  const evidence = Array.isArray(snapshot.evidence) ? snapshot.evidence : [];
  const supporting = mergeResearchItems(Array.isArray(opinion.supportingCase) && opinion.supportingCase.length ? opinion.supportingCase : snapshot.supportingCase);
  const counter = mergeResearchItems(Array.isArray(opinion.counterCase) && opinion.counterCase.length ? opinion.counterCase : snapshot.counterCase);
  const required = mergeResearchItems(Array.isArray(opinion.requiredConditions) && opinion.requiredConditions.length ? opinion.requiredConditions : snapshot.requiredConditions, Array.isArray(opinion.researchPriorities) && opinion.researchPriorities.length ? opinion.researchPriorities : snapshot.researchPriorities);
  const dataGaps = [...new Set(mergeResearchItems(snapshot.dataGaps, opinion.dataGaps).map(researchDataGapText).filter(Boolean))].slice(0, 8);
  return { manager, opinion, snapshot, outputs, evidence, supporting, counter, required, dataGaps };
}
