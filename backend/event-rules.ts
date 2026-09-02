export type StockEventCategory =
  | 'earnings' | 'forecast' | 'contract' | 'm_and_a' | 'financing'
  | 'shareholder' | 'governance' | 'regulatory' | 'litigation'
  | 'production' | 'dividend' | 'clarification' | 'other';

export type StockEventDirection = 'positive' | 'negative' | 'mixed' | 'unknown';
export type StockEventImpactHorizon = 'immediate' | 'short_term' | 'medium_term' | 'long_term' | 'unknown';
export type StockEventStatus = 'new' | 'ongoing' | 'settled' | 'expired' | 'unconfirmed';

export type StockEventMateriality = {
  score: number;
  level: 'high' | 'medium' | 'low';
  isRoutine: boolean;
  reasons: string[];
};

type MaterialityInput = {
  category: StockEventCategory;
  publishedAt?: string | null;
  verification?: string;
  impactScope?: string;
  status?: StockEventStatus | string;
  clusterSize?: number;
  sourceCount?: number;
  factStatus?: string;
  lifecycleState?: string;
  superseded?: boolean;
};

const ROUTINE_ANNOUNCEMENT = /召开.*股东大会|股东大会.*(通知|提示)|董事会.*(会议通知|会议决议)|监事会.*(会议通知|会议决议)|投资者关系活动记录表|内部控制.*报告|独立董事.*意见|审计报告|证券事务代表|公司章程|管理制度|授权(公告|议案)|日常关联交易.*预计|募集资金.*使用情况/;
const MATERIAL_KEYWORDS = /重大|业绩预告|业绩快报|年度报告|半年度报告|季度报告|中标|订单|合同|收购|并购|重组|定增|融资|可转债|回购|增持|减持|监管|处罚|问询|立案|诉讼|仲裁|停产|复产|涨价|降价|澄清|辟谣|风险提示/;

/**
 * 个股事件的确定性重大性评分。用于排序与降权，不直接推导多空或交易结论。
 * 例行治理/会议公告只有在同时包含业绩、融资、监管等实质关键词时才不降权。
 */
export function eventMateriality(title: string, input: MaterialityInput): StockEventMateriality {
  const text = String(title || '');
  const reasons: string[] = [];
  const categoryScore: Record<StockEventCategory, number> = {
    earnings: 46, forecast: 46, contract: 44, m_and_a: 50, financing: 38,
    shareholder: 32, governance: 15, regulatory: 48, litigation: 48,
    production: 36, dividend: 26, clarification: 40, other: 14,
  };
  let score = categoryScore[input.category] || 14;
  const isRoutine = ROUTINE_ANNOUNCEMENT.test(text) && !MATERIAL_KEYWORDS.test(text);
  if (isRoutine) {
    score = Math.min(score, 8);
    reasons.push('例行公告降权');
  } else if (MATERIAL_KEYWORDS.test(text)) {
    score += 10;
    reasons.push('命中实质事项关键词');
  }

  if (input.verification === 'official_verified' || input.verification === 'official_document_only') {
    score += 18;
    reasons.push('官方披露/核验');
  } else if (input.factStatus === 'credible_media_only') {
    score += 5;
    reasons.push('可信媒体线索');
  }
  if (['company', 'policy'].includes(String(input.impactScope))) score += 8;
  else if (input.impactScope === 'industry') score += 5;
  if (Number(input.clusterSize) > 1 || Number(input.sourceCount) > 1) {
    score += Math.min(8, Math.max(Number(input.clusterSize) || 0, Number(input.sourceCount) || 0) * 2);
    reasons.push('多来源/同类披露聚合');
  }

  const time = Date.parse(String(input.publishedAt || ''));
  if (Number.isFinite(time)) {
    const ageDays = Math.max(0, (Date.now() - time) / 86_400_000);
    if (ageDays <= 7) score += 12;
    else if (ageDays <= 30) score += 8;
    else if (ageDays <= 90) score += 4;
  }
  if (input.status === 'unconfirmed') score -= 8;
  if (input.status === 'expired') score -= 18;
  if (input.superseded || input.lifecycleState === 'invalidated') score -= 40;
  if (input.factStatus === 'officially_clarified') reasons.push('官方澄清，原传闻不再作为催化');

  score = Math.max(0, Math.min(100, Math.round(score)));
  const level = score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low';
  if (!reasons.length) reasons.push('按事件类别、时效与来源质量计算');
  return { score, level, isRoutine, reasons };
}

export function eventDate(value: unknown): string | null {
  const text = String(value || '').trim();
  if (!text) return null;
  const normalized = text.replace(/[年/.]/g, '-').replace(/月/g, '-').replace(/日/g, '').replace(/--+/g, '-');
  const date = new Date(/^\d{8}$/.test(text) ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}` : normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function eventCategory(title: string): StockEventCategory {
  if (/盈利预增|预减|预亏|业绩预告/.test(title)) return 'forecast';
  if (/业绩快报|年度报告|半年度报告|季度报告|财报/.test(title)) return 'earnings';
  if (/中标|订单|合同|签署|合作协议/.test(title)) return 'contract';
  if (/收购|并购|重组|资产置换|资产出售/.test(title)) return 'm_and_a';
  if (/定增|增发|配股|融资|可转债|募集资金|发行股票|发行股份|认购/.test(title)) return 'financing';
  if (/股东|减持|增持|持股|控制权/.test(title)) return 'shareholder';
  if (/董事|监事|高管|换届|辞职|任命/.test(title)) return 'governance';
  if (/监管|处罚|问询|警示|行政监管/.test(title)) return 'regulatory';
  if (/诉讼|仲裁|立案|冻结/.test(title)) return 'litigation';
  if (/停产|复产|产能|生产线|产品价格|涨价|降价/.test(title)) return 'production';
  if (/分红|派息|回购|利润分配/.test(title)) return 'dividend';
  if (/澄清|更正|说明|辟谣|风险提示/.test(title)) return 'clarification';
  return 'other';
}

export function eventDirection(title: string, category: StockEventCategory): StockEventDirection {
  if (/诉讼|仲裁|处罚|监管|问询|风险|预亏|预减|亏损|下滑|减持|停产|降价|终止|冻结/.test(title)) return 'negative';
  if (/中标|订单|获批|批准|增持|回购|分红|派息|复产|涨价|增长|预增|盈利/.test(title)) return 'positive';
  if (category === 'clarification' || /可能|拟|计划|预计|调整/.test(title)) return 'mixed';
  return 'unknown';
}

export function eventImpactHorizon(category: StockEventCategory): StockEventImpactHorizon {
  if (['regulatory', 'litigation', 'clarification'].includes(category)) return 'immediate';
  if (['contract', 'shareholder', 'dividend', 'forecast'].includes(category)) return 'short_term';
  if (['earnings', 'financing', 'production'].includes(category)) return 'medium_term';
  if (category === 'm_and_a') return 'long_term';
  return 'unknown';
}

export function eventStatus(title: string, publishedAt: string | null, category: StockEventCategory, now = Date.now()): StockEventStatus {
  if (/传闻|网传|媒体称|市场消息/.test(title)) return 'unconfirmed';
  const ageDays = publishedAt ? Math.max(0, (now - new Date(publishedAt).getTime()) / 86_400_000) : 0;
  const horizon = eventImpactHorizon(category);
  const expiryDays = horizon === 'immediate' ? 5 : horizon === 'short_term' ? 30 : horizon === 'medium_term' ? 120 : horizon === 'long_term' ? 365 : 180;
  if (ageDays > expiryDays && !['contract', 'm_and_a', 'production'].includes(category)) return 'expired';
  if (ageDays <= 7) return 'new';
  if (['contract', 'm_and_a', 'production', 'financing'].includes(category)) return 'ongoing';
  return 'settled';
}

export function normalizedEventKey(title: string, publishedAt: string | null): string {
  return `${title.toLowerCase().replace(/[\s，。；：、“”‘’（）()【】\[\]《》]/g, '').slice(0, 120)}:${publishedAt?.slice(0, 10) || 'unknown'}`;
}
