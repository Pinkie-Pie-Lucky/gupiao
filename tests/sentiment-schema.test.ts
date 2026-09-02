import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const schema = fs.readFileSync(new URL('../backend/db/schema.sql', import.meta.url), 'utf8');

test('舆情持久化表和关键查询索引存在', () => {
  for (const table of ['sentiment_raw_items', 'sentiment_content_symbols', 'sentiment_source_health', 'sentiment_event_clusters', 'sentiment_cluster_items']) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  for (const table of ['event_fact_chains', 'event_fact_nodes']) assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(schema, /idx_sentiment_content_symbols_symbol_time[\s\S]*\(symbol, observed_at DESC, content_id\)/);
  assert.match(schema, /idx_sentiment_clusters_symbol_time[\s\S]*\(symbol, ended_at DESC, cluster_id\)/);
  assert.match(schema, /PRIMARY KEY \(content_id, symbol\)/);
});

test('实体匹配分数、失败次数和事件簇计数均有数据库约束', () => {
  assert.match(schema, /entity_match_score[\s\S]*CHECK \(entity_match_score >= 0 AND entity_match_score <= 1\)/);
  assert.match(schema, /consecutive_failures[\s\S]*CHECK \(consecutive_failures >= 0\)/);
  assert.match(schema, /item_count[\s\S]*CHECK \(item_count > 0\)/);
  assert.match(schema, /idx_event_fact_chains_symbol_time[\s\S]*\(symbol, last_published_at DESC, chain_id\)/);
});
