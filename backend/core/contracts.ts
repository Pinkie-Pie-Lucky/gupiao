/**
 * 开源接口的稳定输出契约。
 *
 * 数据源可以替换、AI 可以关闭，但工具调用方只依赖 schemaVersion、来源元数据和
 * dataGaps 这几个稳定字段。不要在这里放交易建议或任何密钥相关字段。
 */
export const OPEN_SOURCE_SCHEMA_VERSION = 'paopao-open-source.v1';

export type SourceMeta = {
  source: string;
  fetchedAt: string;
  freshness: 'live' | 'cache' | 'fixture' | 'unknown';
  provider?: string;
  fallbackLevel?: number;
};

export type ResultEnvelope<T> = {
  schemaVersion: typeof OPEN_SOURCE_SCHEMA_VERSION;
  kind: string;
  generatedAt: string;
  data: T;
  sourceMeta: SourceMeta | null;
  dataGaps: string[];
  scope: string;
};

export function resultEnvelope<T>(kind: string, data: T, options: {
  sourceMeta?: SourceMeta | null;
  dataGaps?: string[];
  scope: string;
  generatedAt?: string;
}): ResultEnvelope<T> {
  return {
    schemaVersion: OPEN_SOURCE_SCHEMA_VERSION,
    kind,
    generatedAt: options.generatedAt || new Date().toISOString(),
    data,
    sourceMeta: options.sourceMeta || null,
    dataGaps: [...new Set((options.dataGaps || []).map((item) => String(item).trim()).filter(Boolean))],
    scope: options.scope,
  };
}
