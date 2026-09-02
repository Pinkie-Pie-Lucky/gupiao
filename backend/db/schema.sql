-- 泡泡看市 · 数据库 Schema（PostgreSQL，本地 Docker / 生产阿里云共用）
-- 由 backend/db/migrate.ts 读取执行，可重复执行（幂等）。
-- id 由应用层用 crypto.randomUUID() 生成（TEXT），不依赖 pgcrypto 扩展。

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  phone         TEXT NOT NULL UNIQUE,          -- 手机号（唯一）
  password_hash TEXT NOT NULL,                 -- bcrypt 哈希，绝不存明文
  nickname      TEXT NOT NULL,                 -- 昵称
  role          TEXT NOT NULL DEFAULT 'user',  -- 'user' | 'admin'（管理端：统计/用户管理）
  status        TEXT NOT NULL DEFAULT 'active',-- 'active' | 'banned'（封禁后已发 token 因每次鉴权查库即时失效）
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 角色与状态枚举约束（幂等添加；老库迁移时上面 ADD COLUMN 已填默认值）
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('active', 'banned'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

-- 访问埋点（管理端统计）：
--   event_kind='api'       —— 服务端中间件记录的每个业务请求（访问活跃度 / 来源 / 平台分布）
--   event_kind='pageview'  —— 前端上报的页面浏览（PV 口径 + 停留时长 duration_ms）
-- 保留策略：定时任务清理 180 天前明细；量大后再上按天 rollup 表。
CREATE TABLE IF NOT EXISTS access_events (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,   -- 登录用户；匿名为 NULL
  session_key TEXT NOT NULL,                 -- 前端 localStorage 匿名 UUID，UV 去重口径
  platform    TEXT NOT NULL DEFAULT 'web',   -- 'web' | 'app' | 'miniprogram'
  path        TEXT NOT NULL,
  method      TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  referer     TEXT,                          -- 来源页；空 = direct
  utm_source  TEXT,                          -- 渠道参数
  device      TEXT NOT NULL DEFAULT 'desktop', -- mobile | tablet | desktop
  ip_hash     TEXT,                          -- HMAC-SHA256(secret, ip)，不落明文 IP
  duration_ms INTEGER,                       -- pageview：页面停留毫秒数
  event_kind  TEXT NOT NULL DEFAULT 'api',   -- 'api' | 'pageview'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_access_events_created ON access_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_events_session ON access_events (session_key, created_at);
CREATE INDEX IF NOT EXISTS idx_access_events_kind_path ON access_events (event_kind, path, created_at DESC);
ALTER TABLE access_events ADD COLUMN IF NOT EXISTS event_kind TEXT NOT NULL DEFAULT 'api';

-- JWT 撤销黑名单：登出或强制下线时把 jti 写进来即可即时失效
CREATE TABLE IF NOT EXISTS token_blacklist (
  jti         TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,            -- 超过此时间即过期，无需再放进黑名单
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_token_blacklist_expires_at
  ON token_blacklist (expires_at);

-- 用户反馈：由 /api/feedback 写入（登录时带 user_id，未登录则为 NULL）
CREATE TABLE IF NOT EXISTS feedback (
  id             TEXT PRIMARY KEY,
  user_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
  content_type   TEXT NOT NULL,
  content_id     TEXT NOT NULL,
  prompt_version TEXT NOT NULL DEFAULT '',
  rating         TEXT NOT NULL,                -- 'positive' | 'negative'
  reasons        JSONB NOT NULL DEFAULT '[]'::jsonb,
  comment        TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback (created_at);
CREATE INDEX IF NOT EXISTS idx_feedback_prompt_version ON feedback (prompt_version);

-- 用户保存的条件选股；每日刷新结果与候选变化用于研究候选观察，不自动触发个股 Agent。
CREATE TABLE IF NOT EXISTS saved_screeners (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  query       TEXT NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  last_result JSONB,
  last_diff   JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_saved_screeners_user_updated ON saved_screeners (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_saved_screeners_enabled ON saved_screeners (enabled, updated_at ASC);

-- ============================================================
-- 以下为后续批次的数据表（已建表，数据流接入见各批次计划）
-- ============================================================

-- ---------- A. 行情与快照 ----------

-- 最近成功快照：多源回退链最后一级，重启后仍可 stale 回退。
-- key 示例：'index_snapshot' / 'sector_list' / 'stock:600519' / 'market_pulse'
CREATE TABLE IF NOT EXISTS market_snapshots (
  id          TEXT PRIMARY KEY,                  -- 业务 key
  payload     JSONB NOT NULL,
  source      TEXT,                              -- 与 sourceMeta.source 对应
  freshness   TEXT,                              -- 'realtime' | 'delayed' | 'stale'
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  as_of       TIMESTAMPTZ,                       -- 数据本身时间（区别于抓取时间）
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 日 K 线（约 560 天前复权，避免重复调 Python 脚本）
CREATE TABLE IF NOT EXISTS kline_bars (
  symbol  TEXT NOT NULL,
  date    TEXT NOT NULL,                         -- 'YYYY-MM-DD'
  open    DOUBLE PRECISION,
  high    DOUBLE PRECISION,
  low     DOUBLE PRECISION,
  close   DOUBLE PRECISION,
  volume  DOUBLE PRECISION,
  amount  DOUBLE PRECISION,
  adjust  TEXT NOT NULL DEFAULT 'none',          -- 'none' | 'qfq' | 'hfq'
  source  TEXT,
  PRIMARY KEY (symbol, date, adjust)
);
CREATE INDEX IF NOT EXISTS idx_kline_bars_symbol_date ON kline_bars (symbol, date);

-- ---------- B. 公司 / 官方数据（含量价与权威标记） ----------

-- 雪球 F10 公司画像（7 天缓存）
CREATE TABLE IF NOT EXISTS company_profiles (
  symbol      TEXT PRIMARY KEY,
  payload     JSONB NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 财务报告（银行/普通双模板；数字以 CNINFO 对应报告期为准）
CREATE TABLE IF NOT EXISTS financial_reports (
  id            TEXT PRIMARY KEY,
  symbol        TEXT NOT NULL,
  report_period TEXT NOT NULL,                   -- 如 '2025Q3'
  template      TEXT NOT NULL DEFAULT 'non_financial', -- 'bank' | 'non_financial'
  metrics       JSONB NOT NULL DEFAULT '{}'::jsonb,
  verification  TEXT,                            -- 'official_verified' | 'official_document_only' | 'stale' | 'unavailable'
  source        TEXT,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (symbol, report_period)
);

-- CNINFO 官方公告（追加型）
CREATE TABLE IF NOT EXISTS announcements (
  id            TEXT PRIMARY KEY,
  code          TEXT NOT NULL,                   -- 证券代码
  title         TEXT NOT NULL,
  url           TEXT NOT NULL,
  category      TEXT,
  publish_date  TEXT,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (title, url)
);
CREATE INDEX IF NOT EXISTS idx_announcements_code_date ON announcements (code, publish_date);

-- 雪球舆情热度（15 分钟缓存）
CREATE TABLE IF NOT EXISTS sentiment_heat (
  symbol      TEXT PRIMARY KEY,
  payload     JSONB NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 舆情原始内容：只保存平台允许使用的摘要、哈希和原文链接；按 content_id 幂等更新。
CREATE TABLE IF NOT EXISTS sentiment_raw_items (
  content_id          TEXT PRIMARY KEY,
  platform            TEXT NOT NULL,
  content_type        TEXT NOT NULL,
  title               TEXT NOT NULL,
  summary             TEXT NOT NULL DEFAULT '',
  original_url        TEXT,
  published_at        TIMESTAMPTZ,
  fetched_at          TIMESTAMPTZ NOT NULL,
  author_id_hash      TEXT,
  engagement          JSONB NOT NULL DEFAULT '{}'::jsonb,
  entity_match_score  DOUBLE PRECISION NOT NULL CHECK (entity_match_score >= 0 AND entity_match_score <= 1),
  source_quality      TEXT NOT NULL,
  verification        TEXT NOT NULL,
  content_hash        TEXT NOT NULL,
  evidence_id         TEXT NOT NULL UNIQUE,
  requires_review     BOOLEAN NOT NULL DEFAULT false,
  first_seen_at       TIMESTAMPTZ NOT NULL,
  last_seen_at        TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sentiment_raw_published_at ON sentiment_raw_items (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_sentiment_raw_content_hash ON sentiment_raw_items (content_hash);

-- 内容与股票使用关系表，避免在数组列上做高频“股票 + 时间窗”过滤。
CREATE TABLE IF NOT EXISTS sentiment_content_symbols (
  content_id   TEXT NOT NULL REFERENCES sentiment_raw_items(content_id) ON DELETE CASCADE,
  symbol       TEXT NOT NULL,
  observed_at  TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (content_id, symbol)
);
CREATE INDEX IF NOT EXISTS idx_sentiment_content_symbols_symbol_time
  ON sentiment_content_symbols (symbol, observed_at DESC, content_id);

CREATE TABLE IF NOT EXISTS sentiment_source_health (
  source                TEXT PRIMARY KEY,
  status                TEXT NOT NULL,
  last_attempt_at       TIMESTAMPTZ,
  last_success_at       TIMESTAMPTZ,
  last_error            TEXT,
  consecutive_failures  INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at            TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS sentiment_event_clusters (
  cluster_id                 TEXT PRIMARY KEY,
  symbol                     TEXT NOT NULL,
  category                   TEXT NOT NULL,
  representative_title       TEXT NOT NULL,
  representative_content_id  TEXT NOT NULL REFERENCES sentiment_raw_items(content_id) ON DELETE CASCADE,
  started_at                 TIMESTAMPTZ,
  ended_at                   TIMESTAMPTZ,
  item_count                 INTEGER NOT NULL CHECK (item_count > 0),
  source_count               INTEGER NOT NULL CHECK (source_count > 0),
  source_breakdown           JSONB NOT NULL DEFAULT '{}'::jsonb,
  stance_metrics             JSONB NOT NULL DEFAULT '{}'::jsonb,
  verification               TEXT NOT NULL,
  updated_at                 TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sentiment_clusters_symbol_time
  ON sentiment_event_clusters (symbol, ended_at DESC, cluster_id);

CREATE TABLE IF NOT EXISTS sentiment_cluster_items (
  content_id   TEXT NOT NULL REFERENCES sentiment_raw_items(content_id) ON DELETE CASCADE,
  symbol       TEXT NOT NULL,
  cluster_id   TEXT NOT NULL REFERENCES sentiment_event_clusters(cluster_id) ON DELETE CASCADE,
  assigned_at  TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (content_id, symbol)
);
CREATE INDEX IF NOT EXISTS idx_sentiment_cluster_items_cluster ON sentiment_cluster_items (cluster_id, content_id);

-- 事件事实链：同一事项的传闻、媒体、公告、澄清、监管与后续进展以链路保存。
CREATE TABLE IF NOT EXISTS event_fact_chains (
  chain_id               TEXT PRIMARY KEY,
  symbol                 TEXT NOT NULL,
  topic_key              TEXT NOT NULL,
  category               TEXT NOT NULL,
  headline               TEXT NOT NULL,
  lifecycle_state        TEXT NOT NULL,
  fact_status            TEXT NOT NULL,
  first_published_at     TIMESTAMPTZ,
  last_published_at      TIMESTAMPTZ,
  official_node_id       TEXT,
  clarification_node_id  TEXT,
  source_count           INTEGER NOT NULL DEFAULT 0 CHECK (source_count >= 0),
  node_count             INTEGER NOT NULL DEFAULT 0 CHECK (node_count >= 0),
  propagation            JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at             TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_event_fact_chains_symbol_time
  ON event_fact_chains (symbol, last_published_at DESC, chain_id);

CREATE TABLE IF NOT EXISTS event_fact_nodes (
  node_id          TEXT PRIMARY KEY,
  chain_id         TEXT NOT NULL REFERENCES event_fact_chains(chain_id) ON DELETE CASCADE,
  symbol           TEXT NOT NULL,
  evidence_id      TEXT NOT NULL,
  title            TEXT NOT NULL,
  summary          TEXT NOT NULL DEFAULT '',
  source           TEXT NOT NULL,
  source_url       TEXT,
  published_at     TIMESTAMPTZ,
  category         TEXT NOT NULL,
  direction        TEXT NOT NULL,
  verification     TEXT NOT NULL,
  role             TEXT NOT NULL,
  parent_node_id   TEXT,
  relation_type    TEXT NOT NULL,
  link_confidence  TEXT NOT NULL,
  superseded       BOOLEAN NOT NULL DEFAULT false,
  updated_at       TIMESTAMPTZ NOT NULL,
  UNIQUE (symbol, evidence_id)
);
CREATE INDEX IF NOT EXISTS idx_event_fact_nodes_chain_time
  ON event_fact_nodes (chain_id, published_at ASC, node_id);
CREATE INDEX IF NOT EXISTS idx_event_fact_nodes_symbol_time
  ON event_fact_nodes (symbol, published_at DESC, node_id);

-- 兼容早期仅以 content_id 为主键的本地开发表；允许同一内容按不同股票进入不同事件簇。
ALTER TABLE sentiment_cluster_items ADD COLUMN IF NOT EXISTS symbol TEXT;
UPDATE sentiment_cluster_items memberships
SET symbol = clusters.symbol
FROM sentiment_event_clusters clusters
WHERE memberships.cluster_id = clusters.cluster_id AND memberships.symbol IS NULL;
ALTER TABLE sentiment_cluster_items ALTER COLUMN symbol SET NOT NULL;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sentiment_cluster_items_pkey'
      AND conrelid = 'sentiment_cluster_items'::regclass
      AND array_length(conkey, 1) = 1
  ) THEN
    ALTER TABLE sentiment_cluster_items DROP CONSTRAINT sentiment_cluster_items_pkey;
    ALTER TABLE sentiment_cluster_items ADD PRIMARY KEY (content_id, symbol);
  END IF;
END $$;

-- 行业基准（同花顺行业指数 + baostock 兜底）
CREATE TABLE IF NOT EXISTS industry_benchmarks (
  id        TEXT PRIMARY KEY,
  symbol    TEXT NOT NULL,
  industry  TEXT NOT NULL,
  metric    TEXT NOT NULL,
  value     DOUBLE PRECISION,
  date      TEXT,
  source    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_industry_benchmarks_symbol ON industry_benchmarks (symbol);

-- 估值历史分位（东方财富估值 + 历史分位对比）
CREATE TABLE IF NOT EXISTS valuation_history (
  id          TEXT PRIMARY KEY,
  symbol      TEXT NOT NULL,
  date        TEXT,
  percentile  DOUBLE PRECISION,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_valuation_history_symbol_date ON valuation_history (symbol, date);

-- ---------- C. AI 生成与市场报告（贵、值得缓存） ----------

-- 市场温度历史（替代原 work/.runtime/market-temperature-history.json）
CREATE TABLE IF NOT EXISTS market_temperature (
  date        TEXT PRIMARY KEY,                  -- 'YYYY-MM-DD'
  temperature DOUBLE PRECISION,
  turnover    JSONB NOT NULL DEFAULT '{}'::jsonb, -- TurnoverSample[]
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 早报（每个交易日一份）
CREATE TABLE IF NOT EXISTS morning_reports (
  market_date TEXT PRIMARY KEY,                  -- 'YYYY-MM-DD'
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 今日市场动态（一键深度研判，每次生成追加一条，保留生成历史）
CREATE TABLE IF NOT EXISTS market_reports (
  id             TEXT PRIMARY KEY,
  market_date    TEXT NOT NULL,                  -- 'YYYY-MM-DD'
  report         TEXT NOT NULL,
  fallback       BOOLEAN NOT NULL DEFAULT false,
  prompt_version TEXT NOT NULL DEFAULT '',
  input_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb, -- 指数/板块等输入快照
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_market_reports_market_date ON market_reports (market_date, created_at);

-- 泡泡精选（市场地图，每次生成追加一条，保留生成历史）
CREATE TABLE IF NOT EXISTS bubble_selections (
  id             TEXT PRIMARY KEY,
  market_date    TEXT NOT NULL,                  -- 'YYYY-MM-DD'
  payload        JSONB NOT NULL,
  prompt_version TEXT NOT NULL DEFAULT '',
  fallback       BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bubble_selections_market_date ON bubble_selections (market_date, created_at);

-- 今日市场概览（三大指数 / 两市成交额 / 涨跌停家数，按交易日幂等更新，
-- 交易时段内由定时任务每 5/15 分钟刷新，页面读库展示）
CREATE TABLE IF NOT EXISTS market_overviews (
  market_date TEXT PRIMARY KEY,                  -- 'YYYY-MM-DD'
  payload     JSONB NOT NULL,                    -- GET /api/market-overview 的完整响应
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 领涨领跌（东方财富板块接口全量，按交易日幂等更新）
CREATE TABLE IF NOT EXISTS sector_snapshots (
  market_date TEXT PRIMARY KEY,                  -- 'YYYY-MM-DD'
  payload     JSONB NOT NULL,                    -- { sectors, timestamp }
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 个股分析 Agent 输出（按 symbol + agent 幂等更新）
CREATE TABLE IF NOT EXISTS stock_agent_outputs (
  symbol      TEXT NOT NULL,                     -- 6 位证券代码
  agent       TEXT NOT NULL,                     -- 'cio-manager' | 'industry-chain' | ...
  payload     JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, agent)
);

-- 通用 AI 输出缓存（各 Agent/接口可复用）
CREATE TABLE IF NOT EXISTS ai_cache (
  cache_key   TEXT PRIMARY KEY,                  -- 如 'stock-agents/cio-manager:600519'
  payload     JSONB NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_cache_expires_at ON ai_cache (expires_at);

-- ---------- D. 用户数据 ----------

-- 自选股（账号启用后按 user_id 隔离）
CREATE TABLE IF NOT EXISTS watchlist (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol      TEXT NOT NULL,
  name        TEXT NOT NULL DEFAULT '',
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, symbol)
);

-- 聊天记录（AI 泡泡会话，后续接入）
CREATE TABLE IF NOT EXISTS chat_messages (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
  session_id  TEXT NOT NULL,
  role        TEXT NOT NULL,                     -- 'user' | 'assistant'
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages (session_id, created_at);
