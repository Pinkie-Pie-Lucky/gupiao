export type StockEventCategory =
  | 'earnings' | 'forecast' | 'contract' | 'm_and_a' | 'financing'
  | 'shareholder' | 'governance' | 'regulatory' | 'litigation'
  | 'production' | 'dividend' | 'clarification' | 'other';

export type StockEventDirection = 'positive' | 'negative' | 'mixed' | 'unknown';
export type StockEventImpactHorizon = 'immediate' | 'short_term' | 'medium_term' | 'long_term' | 'unknown';
export type StockEventStatus = 'new' | 'ongoing' | 'settled' | 'expired' | 'unconfirmed';

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
