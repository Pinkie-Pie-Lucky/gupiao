/**
 * 独立 HTML 研究报告渲染器。
 *
 * 报告仅消费已经冻结的结构化快照；所有插入页面的动态文本均转义，
 * 以便报告能安全分享、离线保存与打印，不执行模型返回的 HTML。
 */

type RecordLike = Record<string, any>;

const statusLabels: Record<string, string> = {
  research_ready: '研究可继续', watch: '持续观察', deferred: '暂缓推进', rejected: '风险否决', blocked: '输入不足',
  positive: '正向', stable: '稳定', mixed: '分歧', deteriorating: '走弱', risk: '风险', data_insufficient: '数据不足',
  clear: '低风险', downgrade: '风险降级', veto: '否决', unavailable: '暂不可用', available: '可用',
};

function text(value: unknown, fallback = '—') {
  const result = String(value ?? '').trim();
  return result || fallback;
}

function escapeHtml(value: unknown) {
  return text(value, '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[character] || character));
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): RecordLike {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordLike : {};
}

function number(value: unknown, digits = 2) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(digits) : '—';
}

function percent(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '—';
  const normalized = Math.abs(parsed) <= 1 ? parsed * 100 : parsed;
  return `${normalized >= 0 ? '+' : ''}${normalized.toFixed(2)}%`;
}

function label(value: unknown) {
  const key = String(value || '').trim();
  return statusLabels[key] || key || '—';
}

function itemText(item: unknown) {
  if (typeof item === 'string' || typeof item === 'number') return text(item);
  const record = asRecord(item);
  return text(record.text || record.summary || record.claim || record.description || record.title || record.signal || record.assessment, '暂无可核验说明');
}

function list(items: unknown, tone: 'positive' | 'risk' | 'neutral' = 'neutral', empty = '暂无可展示内容') {
  const values = asArray(items).map(itemText).filter((value) => value !== '暂无可核验说明').slice(0, 6);
  if (!values.length) return `<p class="empty">${escapeHtml(empty)}</p>`;
  return `<ul class="fact-list ${tone}">${values.map((value) => `<li>${escapeHtml(value)}</li>`).join('')}</ul>`;
}

function statusPill(value: unknown) {
  const key = String(value || 'unavailable');
  const tone = /positive|stable|clear|ready|available/.test(key) ? 'good' : /risk|deteriorating|veto|rejected|blocked/.test(key) ? 'risk' : 'neutral';
  return `<span class="pill ${tone}">${escapeHtml(label(key))}</span>`;
}

function card(title: string, body: string, note = '') {
  return `<section class="card"><div class="card-title"><h2>${escapeHtml(title)}</h2>${note ? `<span>${escapeHtml(note)}</span>` : ''}</div>${body}</section>`;
}

function compactMetric(labelText: string, value: unknown, tone = '') {
  return `<div class="metric ${tone}"><span>${escapeHtml(labelText)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function annualTrendChart(annual: unknown) {
  const values = asArray(annual).slice(-5).map((item) => {
    const row = asRecord(item);
    return { year: text(row.year || row.period, '—').slice(0, 4), revenue: Number(row.revenue), netProfit: Number(row.netProfit) };
  }).filter((item) => Number.isFinite(item.revenue));
  if (values.length < 2) return '<p class="empty">完整年报序列不足，暂不绘制年度趋势。</p>';
  const max = Math.max(...values.map((item) => Math.abs(item.revenue)), 1);
  const bars = values.map((item, index) => {
    const x = 32 + index * 104;
    const height = Math.max(18, Math.round((Math.abs(item.revenue) / max) * 116));
    return `<rect x="${x}" y="${146 - height}" width="52" height="${height}" rx="9" fill="#4f39f6" opacity="${0.55 + index * 0.08}"/><text x="${x + 26}" y="169" text-anchor="middle" fill="#62748e" font-size="12">${escapeHtml(item.year)}</text>`;
  }).join('');
  return `<div class="trend"><div class="legend"><span><i></i>营业收入（报告原始单位）</span></div><svg viewBox="0 0 560 184" role="img" aria-label="近年营业收入趋势"><line x1="20" y1="147" x2="540" y2="147" stroke="#dbe3f4"/>${bars}</svg></div>`;
}

function stockModule(title: string, output: unknown) {
  const module = asRecord(output);
  if (!Object.keys(module).length) return card(title, '<p class="empty">该模块本次未获得可核验数据。</p>', '数据不足');
  const signals = asArray(module.signals || module.events || module.risks || module.financialPosition?.metrics || module.chain?.mappings);
  const status = module.status || module.valuationStatus || module.decision || module.riskLevel || 'available';
  const rows = signals.slice(0, 4).map((item) => {
    const record = asRecord(item);
    const state = record.status || record.direction || record.level || record.verification || 'available';
    return `<li><span>${escapeHtml(itemText(record))}</span>${statusPill(state)}</li>`;
  }).join('');
  return card(title, rows ? `<ul class="signal-list">${rows}</ul>` : '<p class="empty">暂无结构化信号。</p>', label(status));
}

export function renderStockAnalysisReportHtml(input: RecordLike) {
  const manager = asRecord(input.managerSnapshot);
  const outputs = asRecord(manager.agentOutputs);
  const fundamental = asRecord(outputs.fundamental);
  const quote = asRecord(input.quote || input.factSnapshot?.facts?.quote);
  const company = asRecord(input.company || input.factSnapshot?.company);
  const meta = asRecord(manager.snapshotMeta);
  const title = text(company.name || quote.name || input.symbol, '个股分析');
  const symbol = text(manager.symbol || input.symbol || quote.code, '—');
  const annual = asRecord(fundamental.financialTrends).annual;
  const evidenceCount = asArray(manager.evidence).length || Number(meta.evidenceCount) || 0;
  const dataGaps = [...new Set([...asArray(manager.dataGaps), ...asArray(input.dataGaps)])];
  const generatedAt = text(input.generatedAt || meta.generatedAt || new Date().toISOString());
  const summary = text(manager.managerStance?.oneLine || manager.managerStance?.summary || (manager.researchStatus === 'blocked'
    ? '当前研究输入尚不完整，以下仅展示已获得的可核验事实。'
    : '本报告以程序冻结的事实快照为基础；结论、风险与数据缺口需结合来源继续核验。'));

  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · 个股分析报告</title><style>
    :root{color-scheme:light;--ink:#0f172b;--muted:#62748e;--brand:#4f39f6;--brand-soft:#eef2ff;--line:#dbe3f4;--good:#047857;--good-bg:#ecfdf5;--risk:#be123c;--risk-bg:#fff1f2;--paper:#f8fafc}*{box-sizing:border-box}body{margin:0;background:#f5f7ff;color:var(--ink);font-family:Inter,"PingFang SC","Microsoft YaHei",sans-serif;line-height:1.55}.page{max-width:1120px;margin:0 auto;padding:32px 20px 64px}.hero{overflow:hidden;position:relative;padding:34px;border:1px solid #c7d2fe;border-radius:28px;background:linear-gradient(135deg,#fff 0%,#eef2ff 100%);box-shadow:0 18px 55px rgba(47,41,135,.09)}.hero:after{content:"";position:absolute;width:340px;height:340px;right:-150px;top:-190px;border-radius:50%;background:rgba(79,57,246,.11)}.eyebrow{position:relative;z-index:1;color:var(--brand);font-size:12px;font-weight:800;letter-spacing:.12em}.hero h1{position:relative;z-index:1;margin:8px 0 2px;font-size:34px;letter-spacing:-.04em}.hero p{position:relative;z-index:1;margin:0;color:var(--muted)}.hero-grid{position:relative;z-index:1;display:grid;grid-template-columns:1fr auto;gap:20px;align-items:end}.quote{font-size:26px;font-weight:900}.quote small{margin-left:8px;font-size:13px;color:var(--muted);font-weight:700}.summary{margin-top:22px;max-width:780px;font-size:16px;font-weight:650}.pill{display:inline-flex;align-items:center;border-radius:999px;padding:5px 10px;font-size:12px;font-weight:800;white-space:nowrap}.pill.good{color:var(--good);background:var(--good-bg)}.pill.risk{color:var(--risk);background:var(--risk-bg)}.pill.neutral{color:#4338ca;background:var(--brand-soft)}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:18px 0}.metric{padding:15px;border:1px solid var(--line);border-radius:16px;background:#fff}.metric span{display:block;color:var(--muted);font-size:12px}.metric strong{display:block;margin-top:5px;font-size:18px}.metric.good strong{color:var(--good)}.metric.risk strong{color:var(--risk)}.layout{display:grid;grid-template-columns:1.1fr .9fr;gap:16px}.card{margin-top:16px;padding:22px;border:1px solid var(--line);border-radius:20px;background:#fff;box-shadow:0 8px 24px rgba(15,23,43,.035)}.card-title{display:flex;justify-content:space-between;gap:12px;align-items:center}.card-title h2{margin:0;font-size:17px}.card-title span{color:var(--muted);font-size:12px}.fact-list,.signal-list{margin:14px 0 0;padding:0;list-style:none}.fact-list li{position:relative;margin:9px 0;padding-left:18px;color:#334155;font-size:14px}.fact-list li:before{content:"•";position:absolute;left:2px;color:#64748b}.fact-list.positive li:before{color:var(--good)}.fact-list.risk li:before{color:var(--risk)}.signal-list li{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding:12px 0;border-bottom:1px solid #eef2f7;font-size:14px}.signal-list li:last-child{border-bottom:0}.empty{margin:14px 0 0;color:var(--muted);font-size:13px}.trend{margin-top:14px;padding:16px;border-radius:14px;background:var(--paper)}.legend{font-size:12px;color:var(--muted)}.legend i{display:inline-block;width:10px;height:10px;border-radius:3px;background:var(--brand);margin-right:5px}.trend svg{display:block;width:100%;height:auto;margin-top:8px}.gap-list{columns:2;column-gap:28px}.gap-list li{break-inside:avoid}.sources{margin-top:18px;color:var(--muted);font-size:12px}.disclaimer{margin-top:18px;color:#64748b;font-size:12px}@media(max-width:720px){.page{padding:16px 12px 40px}.hero{padding:24px;border-radius:22px}.hero h1{font-size:28px}.hero-grid{grid-template-columns:1fr}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.layout{grid-template-columns:1fr}.gap-list{columns:1}.quote{font-size:23px}}
  </style></head><body><main class="page"><header class="hero"><div class="eyebrow">STOCK_ANALYZE · RESEARCH SNAPSHOT</div><div class="hero-grid"><div><h1>${escapeHtml(title)} <small>${escapeHtml(symbol)}</small></h1><p>${escapeHtml(text(company.industry, 'A 股个股研究快照'))}</p></div><div>${statusPill(manager.researchStatus)}</div></div><div class="metrics">${compactMetric('最新价格', quote.price === undefined ? '—' : `¥${number(quote.price)}`, Number(quote.changePercent) >= 0 ? 'good' : 'risk')}${compactMetric('涨跌幅', percent(quote.changePercent), Number(quote.changePercent) >= 0 ? 'good' : 'risk')}${compactMetric('风险等级', label(manager.riskLevel))}${compactMetric('证据覆盖', `${evidenceCount} 条`)}</div><p class="summary">${escapeHtml(summary)}</p></header><section class="layout"><div>${card('支持依据', list(manager.supportingCase, 'positive', '当前没有足够的正向事实依据。'))}${card('风险与反方依据', list(manager.counterCase, 'risk', '当前没有额外反方依据。'))}${card('年度财务趋势', annualTrendChart(annual), text(asRecord(fundamental.financialTrends).annualSummary?.revenueTrend || '完整年报'))}</div><div>${stockModule('基本面', fundamental)}${stockModule('技术与市场', outputs.technical)}${stockModule('估值', outputs.valuation)}${stockModule('事件', outputs.events)}${stockModule('行业与产业链', outputs.industry)}${stockModule('舆情', outputs.sentiment)}${stockModule('风险/反方', outputs.risk)}</div></section>${card('数据缺口与下一步核验', `<div class="gap-list">${list(dataGaps, 'neutral', '本次未报告额外数据缺口。')}</div>`)}<footer class="sources">生成时间：${escapeHtml(generatedAt)} · 数据源与报告期请以各模块事实快照、证据 ID 和原始披露为准。</footer><footer class="disclaimer">本报告仅用于信息研究与学习，不构成投资建议、收益承诺或交易指令。</footer></main></body></html>`;
  return html;
}

export function renderMarketHotspotsReportHtml(input: RecordLike) {
  const overview = asRecord(input.overview);
  const map = asRecord(input.marketMap);
  const indices = asArray(overview.indices);
  const sectors = asArray(map.sectors);
  const picks = asArray(input.dailyPicks);
  const dataGaps = asArray(input.dataGaps);
  const generatedAt = text(input.generatedAt || overview.timestamp || map.generatedAt || new Date().toISOString());
  const sectorCards = sectors.slice(0, 12).map((sector) => {
    const item = asRecord(sector);
    const change = Number(item.changePercent);
    const tone = change >= 0 ? 'good' : 'risk';
    return `<article class="sector"><div><h3>${escapeHtml(text(item.sector || item.name))}</h3><p>${escapeHtml(text(asArray(item.signalTags).join(' · '), '市场观察'))}</p></div><strong class="${tone}">${escapeHtml(percent(change))}</strong><small>${escapeHtml(text(item.beginnerExplanation || item.professionalSummary, '仅反映当前市场事实。'))}</small></article>`;
  }).join('') || '<p class="empty">当前未获得可用市场地图板块。</p>';
  const pickCards = picks.slice(0, 6).map((pick) => {
    const item = asRecord(pick);
    return `<li><b>${escapeHtml(text(item.sectorName || item.name))}</b><span>${escapeHtml(text(item.rankReason || item.bubbleExplanation || item.reason, '基于当前板块快照入选。'))}</span></li>`;
  }).join('') || '<li><span>每日板块精选暂不可用，以下展示市场地图中的当前热点。</span></li>';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>今日市场热点 · 泡泡看市</title><style>
    :root{--ink:#0f172b;--muted:#62748e;--brand:#4f39f6;--soft:#eef2ff;--line:#dbe3f4;--good:#047857;--risk:#be123c}*{box-sizing:border-box}body{margin:0;background:#f5f7ff;color:var(--ink);font-family:Inter,"PingFang SC","Microsoft YaHei",sans-serif}.page{max-width:1120px;margin:auto;padding:32px 20px 64px}.hero{padding:34px;border:1px solid #c7d2fe;border-radius:28px;background:linear-gradient(135deg,#fff,#eef2ff)}.eyebrow{color:var(--brand);font-size:12px;font-weight:800;letter-spacing:.12em}.hero h1{margin:8px 0;font-size:34px;letter-spacing:-.04em}.hero p{margin:0;color:var(--muted)}.indices{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:22px}.index{padding:15px;border-radius:16px;background:#fff;border:1px solid var(--line)}.index span{display:block;color:var(--muted);font-size:12px}.index b{display:block;margin-top:6px;font-size:20px}.good{color:var(--good)}.risk{color:var(--risk)}.grid{display:grid;grid-template-columns:.75fr 1.25fr;gap:16px}.card{margin-top:16px;padding:22px;border:1px solid var(--line);border-radius:20px;background:#fff;box-shadow:0 8px 24px rgba(15,23,43,.035)}h2{margin:0;font-size:17px}.pick-list{margin:14px 0 0;padding:0;list-style:none}.pick-list li{display:grid;gap:4px;padding:13px 0;border-bottom:1px solid #eef2f7;font-size:14px}.pick-list li:last-child{border:0}.pick-list span,.empty,.source{color:var(--muted);font-size:13px}.sector-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:14px}.sector{display:grid;grid-template-columns:1fr auto;gap:8px;padding:16px;border-radius:15px;background:#f8fafc;border:1px solid #edf1f7}.sector h3{margin:0;font-size:15px}.sector p{margin:4px 0 0;color:var(--muted);font-size:11px}.sector strong{font-size:16px}.sector small{grid-column:1/-1;color:#475569;font-size:12px;line-height:1.45}.gap-list{margin:12px 0 0;padding-left:18px;color:#475569;font-size:13px}.source{margin:18px 2px}@media(max-width:720px){.page{padding:16px 12px 40px}.hero{padding:24px;border-radius:22px}.hero h1{font-size:28px}.indices,.grid,.sector-grid{grid-template-columns:1fr}.indices{gap:8px}}
  </style></head><body><main class="page"><header class="hero"><div class="eyebrow">STOCK_ANALYZE · MARKET HOTSPOTS</div><h1>今日市场热点与板块精选</h1><p>首页市场概览与市场地图使用同一时点的可核验市场快照。</p><div class="indices">${indices.map((index) => { const item = asRecord(index); const change = Number(item.changePercent); return `<div class="index"><span>${escapeHtml(text(item.name))}</span><b>${escapeHtml(number(item.price))}</b><strong class="${change >= 0 ? 'good' : 'risk'}">${escapeHtml(percent(change))}</strong></div>`; }).join('') || '<p class="empty">三大指数数据暂不可用。</p>'}</div></header><section class="grid"><div>${card('每日板块精选', `<ul class="pick-list">${pickCards}</ul>`)}${card('市场广度', `<div class="indices"><div class="index"><span>上涨板块</span><b>${escapeHtml(text(overview.marketBreath?.up))}</b></div><div class="index"><span>下跌板块</span><b>${escapeHtml(text(overview.marketBreath?.down))}</b></div><div class="index"><span>市场温度</span><b>${escapeHtml(text(overview.marketTemperature?.temperature || overview.marketTemperature))}</b></div></div>`)}</div><div>${card('市场地图 · 当前热点', `<div class="sector-grid">${sectorCards}</div>`)}</div></section>${card('数据缺口', dataGaps.length ? `<ul class="gap-list">${dataGaps.slice(0, 12).map((gap) => `<li>${escapeHtml(typeof gap === 'string' ? gap : itemText(gap))}</li>`).join('')}</ul>` : '<p class="empty">本次未报告额外数据缺口。</p>')}<footer class="source">生成时间：${escapeHtml(generatedAt)} · 报告展示的是当前市场快照，不预测后续涨跌。仅供信息研究与学习，不构成投资建议。</footer></main></body></html>`;
}
