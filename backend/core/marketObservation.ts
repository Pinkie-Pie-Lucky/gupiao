import { OPEN_SOURCE_SCHEMA_VERSION } from './contracts.js';

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** 将原始指数/板块输入转换为无预测的确定性市场观察。 */
export function buildMarketObservation(overview: any) {
  const indices = Array.isArray(overview?.indices) ? overview.indices : [];
  const usableIndices = indices.filter((item: any) => Number.isFinite(Number(item?.changePercent)));
  const upCount = usableIndices.filter((item: any) => Number(item.changePercent) > 0).length;
  const downCount = usableIndices.filter((item: any) => Number(item.changePercent) < 0).length;
  const averageChange = usableIndices.length ? usableIndices.reduce((sum: number, item: any) => sum + Number(item.changePercent), 0) / usableIndices.length : null;
  const marketState = !usableIndices.length ? '数据有限'
    : upCount === usableIndices.length && Number(averageChange) >= 0.5 ? '指数普遍走强'
      : downCount === usableIndices.length && Number(averageChange) <= -0.5 ? '指数普遍走弱'
        : upCount > 0 && downCount > 0 ? '指数表现分歧'
          : Number(averageChange) > 0 ? '指数偏强'
            : Number(averageChange) < 0 ? '指数偏弱' : '指数平稳';
  const topSectors = Array.isArray(overview?.topSectors) ? overview.topSectors : [];
  const dataGaps: string[] = [];
  if (usableIndices.length < 3) dataGaps.push(`三大指数仅取得 ${usableIndices.length}/3 条有效涨跌数据。`);
  if (!topSectors.length) dataGaps.push('未取得当日领涨板块数据。');
  return {
    schemaVersion: OPEN_SOURCE_SCHEMA_VERSION,
    observation: {
      marketState,
      indexBreadth: { up: upCount, down: downCount, flat: Math.max(0, usableIndices.length - upCount - downCount), total: usableIndices.length },
      averageIndexChangePercent: averageChange === null ? null : round(averageChange),
      indices,
      topSectors,
      bottomSectors: Array.isArray(overview?.bottomSectors) ? overview.bottomSectors : [],
      marketBreadth: overview?.marketBreath || overview?.marketBreadth || null,
      marketTemperature: overview?.marketTemperature ?? null,
      marketStatus: overview?.marketStatus || null,
    },
    dataAsOf: overview?.timestamp || overview?.fetchedAt || new Date().toISOString(),
    sourceMeta: overview?.sourceMeta || null,
    dataGaps,
    scope: '仅反映当前已取得的市场事实，不预测后续涨跌，也不构成交易建议。',
  };
}
