-- =============================================================================
-- Forge DEX – Canonical Schema (Hybrid ARP Calculation)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ROUTERS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS routers (
  id      SERIAL PRIMARY KEY,
  router  TEXT NOT NULL UNIQUE
);

-- -----------------------------------------------------------------------------
-- RETENTION CONFIGURATION
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS retention_config (
  resolution TEXT PRIMARY KEY,
  keep_days INT,  -- NULL = indefinite
  description TEXT
);

INSERT INTO retention_config VALUES
  ('1m', 30, '1-minute candles'),
  ('5m', 90, '5-minute candles'),
  ('15m', 180, '15-minute candles'),
  ('1h', 730, '1-hour candles'),
  ('4h', 1825, '4-hour candles'),
  ('1d', NULL, 'Daily candles'),
  ('1w', NULL, 'Weekly candles'),
  ('1mo', NULL, 'Monthly candles')
ON CONFLICT (resolution) DO NOTHING;

-- =============================================================================
-- UTILITY FUNCTIONS
-- =============================================================================

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- -----------------------------------------------------------------------------
-- ASSETS (canonical, hash-keyed)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assets (
  id          SERIAL PRIMARY KEY,
  hash        BYTEA  NOT NULL UNIQUE,
  ticker      TEXT   NOT NULL,
  decimals    INT    NOT NULL DEFAULT 8,
  meta        JSONB  NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assets_ticker_idx ON assets(ticker);

-- -----------------------------------------------------------------------------
-- ASSET ALIASES (optional, router-scoped)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS asset_aliases (
  id         SERIAL PRIMARY KEY,
  asset_id   INT  NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  router_id  INT  REFERENCES routers(id),  -- NULL = global alias
  ticker     TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS asset_aliases_unique
  ON asset_aliases (asset_id, COALESCE(router_id, 0), ticker);
CREATE INDEX IF NOT EXISTS asset_aliases_lookup
  ON asset_aliases (COALESCE(router_id, 0), ticker);

-- -----------------------------------------------------------------------------
-- PAIRS (canonical A/B by hash; a_hash < b_hash)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pairs (
  id         SERIAL PRIMARY KEY,
  symbol     TEXT NOT NULL,                   -- display/search only
  a_hash     BYTEA NOT NULL,                  -- MIN(hashA, hashB)
  b_hash     BYTEA NOT NULL,                  -- MAX(hashA, hashB)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pairs_canonical_order CHECK (a_hash < b_hash),
  CONSTRAINT pairs_ab_unique UNIQUE (a_hash, b_hash)
);
CREATE INDEX IF NOT EXISTS pairs_symbol_idx ON pairs(symbol);
CREATE INDEX IF NOT EXISTS pairs_a_idx ON pairs(a_hash);
CREATE INDEX IF NOT EXISTS pairs_b_idx ON pairs(b_hash);

-- -----------------------------------------------------------------------------
-- PAIR COMPONENTS (must match A/B from pairs)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pair_components (
  pair_id        INT PRIMARY KEY REFERENCES pairs(id) ON DELETE CASCADE,
  base_asset_id  INT NOT NULL REFERENCES assets(id),
  quote_asset_id INT NOT NULL REFERENCES assets(id),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pair_components_base_ne_quote CHECK (base_asset_id <> quote_asset_id)
);
CREATE INDEX IF NOT EXISTS pair_components_base_idx  ON pair_components(base_asset_id);
CREATE INDEX IF NOT EXISTS pair_components_quote_idx ON pair_components(quote_asset_id);
CREATE INDEX IF NOT EXISTS pair_components_asset_lookup 
  ON pair_components (base_asset_id, quote_asset_id, pair_id);
  
-- Enforce base/quote alignment with pairs.a_hash/pairs.b_hash (idempotent)
CREATE OR REPLACE FUNCTION enforce_pair_components_canonical()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  pa BYTEA; pb BYTEA; ha BYTEA; hb BYTEA;
BEGIN
  SELECT a_hash, b_hash INTO pa, pb FROM pairs WHERE id = NEW.pair_id;
  SELECT hash INTO ha FROM assets WHERE id = NEW.base_asset_id;
  SELECT hash INTO hb FROM assets WHERE id = NEW.quote_asset_id;

  IF pa IS NULL OR pb IS NULL OR ha IS NULL OR hb IS NULL THEN
    RAISE EXCEPTION 'pair_components refs not found (pair %, base %, quote %)',
      NEW.pair_id, NEW.base_asset_id, NEW.quote_asset_id;
  END IF;

  IF ha <> pa OR hb <> pb THEN
    RAISE EXCEPTION 'pair_components (base/quote) must match pairs (a_hash/b_hash)';
  END IF;

  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS trg_pair_components_enforce ON pair_components;
CREATE TRIGGER trg_pair_components_enforce
BEFORE INSERT OR UPDATE ON pair_components
FOR EACH ROW EXECUTE FUNCTION enforce_pair_components_canonical();

-- -----------------------------------------------------------------------------
-- SWAPS (indexer writes)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS swaps (
  id        TEXT PRIMARY KEY,                         -- e.g., tx hash + log index
  router_id INT  NOT NULL REFERENCES routers(id),
  pair_id   INT  NOT NULL REFERENCES pairs(id),
  ts_ms     BIGINT NOT NULL,                          -- event timestamp (ms)
  block     BIGINT NOT NULL,
  side      SMALLINT NOT NULL CHECK (side IN (-1, 1)),
  price     DOUBLE PRECISION NOT NULL CHECK (price > 0), -- quote_per_base
  base_in   DOUBLE PRECISION NOT NULL CHECK (base_in >= 0),
  quote_out DOUBLE PRECISION NOT NULL CHECK (quote_out >= 0)
);
CREATE INDEX IF NOT EXISTS swaps_router_time_idx ON swaps(router_id, ts_ms);
CREATE INDEX IF NOT EXISTS swaps_pair_time_idx   ON swaps(pair_id, ts_ms);
CREATE INDEX IF NOT EXISTS swaps_router_pair_time_idx
  ON swaps(router_id, pair_id, ts_ms);
CREATE INDEX IF NOT EXISTS swaps_ts_brin
  ON swaps USING BRIN (ts_ms) WITH (pages_per_range = 64);
CREATE INDEX IF NOT EXISTS swaps_router_ts_id_idx
  ON swaps (router_id, ts_ms, id);

-- -----------------------------------------------------------------------------
-- CANDLES (5m, 15m, 1h, 4h, 1d)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS candles_1m (
  router_id INT NOT NULL REFERENCES routers(id),
  pair_id   INT NOT NULL REFERENCES pairs(id),
  t_start   BIGINT NOT NULL,                          -- minute open (ms)
  o DOUBLE PRECISION NOT NULL,
  h DOUBLE PRECISION NOT NULL,
  l DOUBLE PRECISION NOT NULL,
  c DOUBLE PRECISION NOT NULL,
  v DOUBLE PRECISION NOT NULL,                        -- base volume in minute
  PRIMARY KEY (router_id, pair_id, t_start),
  CONSTRAINT candles_1m_minute_aligned CHECK (t_start % 60000 = 0)
);

CREATE TABLE IF NOT EXISTS candles_5m (
  router_id INT NOT NULL REFERENCES routers(id),
  pair_id   INT NOT NULL REFERENCES pairs(id),
  t_start   BIGINT NOT NULL,
  o DOUBLE PRECISION NOT NULL,
  h DOUBLE PRECISION NOT NULL,
  l DOUBLE PRECISION NOT NULL,
  c DOUBLE PRECISION NOT NULL,
  v DOUBLE PRECISION NOT NULL,
  num_trades INT NOT NULL DEFAULT 0,  -- count of 1m bars aggregated
  PRIMARY KEY (router_id, pair_id, t_start),
  CONSTRAINT candles_5m_aligned CHECK (t_start % 300000 = 0)
);

CREATE TABLE IF NOT EXISTS candles_15m (
  router_id INT NOT NULL REFERENCES routers(id),
  pair_id   INT NOT NULL REFERENCES pairs(id),
  t_start   BIGINT NOT NULL,
  o DOUBLE PRECISION NOT NULL,
  h DOUBLE PRECISION NOT NULL,
  l DOUBLE PRECISION NOT NULL,
  c DOUBLE PRECISION NOT NULL,
  v DOUBLE PRECISION NOT NULL,
  num_trades INT NOT NULL DEFAULT 0,
  PRIMARY KEY (router_id, pair_id, t_start),
  CONSTRAINT candles_15m_aligned CHECK (t_start % 900000 = 0)
);

CREATE TABLE IF NOT EXISTS candles_1h (
  router_id INT NOT NULL REFERENCES routers(id),
  pair_id   INT NOT NULL REFERENCES pairs(id),
  t_start   BIGINT NOT NULL,
  o DOUBLE PRECISION NOT NULL,
  h DOUBLE PRECISION NOT NULL,
  l DOUBLE PRECISION NOT NULL,
  c DOUBLE PRECISION NOT NULL,
  v DOUBLE PRECISION NOT NULL,
  num_trades INT NOT NULL DEFAULT 0,
  PRIMARY KEY (router_id, pair_id, t_start),
  CONSTRAINT candles_1h_aligned CHECK (t_start % 3600000 = 0)
);

CREATE TABLE IF NOT EXISTS candles_4h (
  router_id INT NOT NULL REFERENCES routers(id),
  pair_id   INT NOT NULL REFERENCES pairs(id),
  t_start   BIGINT NOT NULL,
  o DOUBLE PRECISION NOT NULL,
  h DOUBLE PRECISION NOT NULL,
  l DOUBLE PRECISION NOT NULL,
  c DOUBLE PRECISION NOT NULL,
  v DOUBLE PRECISION NOT NULL,
  num_trades INT NOT NULL DEFAULT 0,
  PRIMARY KEY (router_id, pair_id, t_start),
  CONSTRAINT candles_4h_aligned CHECK (t_start % 14400000 = 0)
);

CREATE TABLE IF NOT EXISTS candles_1d (
  router_id INT NOT NULL REFERENCES routers(id),
  pair_id   INT NOT NULL REFERENCES pairs(id),
  t_start   BIGINT NOT NULL,
  o DOUBLE PRECISION NOT NULL,
  h DOUBLE PRECISION NOT NULL,
  l DOUBLE PRECISION NOT NULL,
  c DOUBLE PRECISION NOT NULL,
  v DOUBLE PRECISION NOT NULL,
  num_trades INT NOT NULL DEFAULT 0,
  PRIMARY KEY (router_id, pair_id, t_start),
  CONSTRAINT candles_1d_aligned CHECK (t_start % 86400000 = 0)
);

CREATE TABLE IF NOT EXISTS candles_1w (
  router_id INT NOT NULL REFERENCES routers(id),
  pair_id   INT NOT NULL REFERENCES pairs(id),
  t_start   BIGINT NOT NULL,
  o DOUBLE PRECISION NOT NULL,
  h DOUBLE PRECISION NOT NULL,
  l DOUBLE PRECISION NOT NULL,
  c DOUBLE PRECISION NOT NULL,
  v DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (router_id, pair_id, t_start),
  CONSTRAINT candles_1w_aligned CHECK (t_start % 604800000 = 0)
);

CREATE TABLE IF NOT EXISTS candles_1mo (
  router_id INT NOT NULL REFERENCES routers(id),
  pair_id   INT NOT NULL REFERENCES pairs(id),
  t_start   BIGINT NOT NULL,
  o DOUBLE PRECISION NOT NULL,
  h DOUBLE PRECISION NOT NULL,
  l DOUBLE PRECISION NOT NULL,
  c DOUBLE PRECISION NOT NULL,
  v DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (router_id, pair_id, t_start)
  -- Note: Monthly buckets are irregular (28-31 days), so no simple modulo check
);

-- -----------------------------------------------------------------------------
-- CANDLE TABLE INDEXES
-- -----------------------------------------------------------------------------

-- 1-minute candles (most frequently queried)
CREATE INDEX IF NOT EXISTS candles_1m_pair_time_idx ON candles_1m(pair_id, t_start);
CREATE INDEX IF NOT EXISTS candles_1m_router_time_idx ON candles_1m(router_id, t_start);
CREATE INDEX IF NOT EXISTS candles_1m_time_idx ON candles_1m(t_start);
CREATE INDEX IF NOT EXISTS candles_1m_time_brin ON candles_1m USING BRIN(t_start) WITH (pages_per_range = 128);

-- 5-minute candles
CREATE INDEX IF NOT EXISTS candles_5m_pair_time_idx ON candles_5m(pair_id, t_start);
CREATE INDEX IF NOT EXISTS candles_5m_router_time_idx ON candles_5m(router_id, t_start);
CREATE INDEX IF NOT EXISTS candles_5m_time_idx ON candles_5m(t_start);
CREATE INDEX IF NOT EXISTS candles_5m_time_brin ON candles_5m USING BRIN(t_start) WITH (pages_per_range = 128);

-- 15-minute candles
CREATE INDEX IF NOT EXISTS candles_15m_pair_time_idx ON candles_15m(pair_id, t_start);
CREATE INDEX IF NOT EXISTS candles_15m_router_time_idx ON candles_15m(router_id, t_start);
CREATE INDEX IF NOT EXISTS candles_15m_time_idx ON candles_15m(t_start);
CREATE INDEX IF NOT EXISTS candles_15m_time_brin ON candles_15m USING BRIN(t_start) WITH (pages_per_range = 128);

-- 1-hour candles
CREATE INDEX IF NOT EXISTS candles_1h_pair_time_idx ON candles_1h(pair_id, t_start);
CREATE INDEX IF NOT EXISTS candles_1h_router_time_idx ON candles_1h(router_id, t_start);
CREATE INDEX IF NOT EXISTS candles_1h_time_idx ON candles_1h(t_start);
CREATE INDEX IF NOT EXISTS candles_1h_time_brin ON candles_1h USING BRIN(t_start) WITH (pages_per_range = 128);

-- 4-hour candles
CREATE INDEX IF NOT EXISTS candles_4h_pair_time_idx ON candles_4h(pair_id, t_start);
CREATE INDEX IF NOT EXISTS candles_4h_router_time_idx ON candles_4h(router_id, t_start);
CREATE INDEX IF NOT EXISTS candles_4h_time_idx ON candles_4h(t_start);
CREATE INDEX IF NOT EXISTS candles_4h_time_brin ON candles_4h USING BRIN(t_start) WITH (pages_per_range = 256);

-- Daily candles
CREATE INDEX IF NOT EXISTS candles_1d_pair_time_idx ON candles_1d(pair_id, t_start);
CREATE INDEX IF NOT EXISTS candles_1d_router_time_idx ON candles_1d(router_id, t_start);
CREATE INDEX IF NOT EXISTS candles_1d_time_idx ON candles_1d(t_start);
CREATE INDEX IF NOT EXISTS candles_1d_time_brin ON candles_1d USING BRIN(t_start) WITH (pages_per_range = 256);

-- Weekly candles (smaller dataset, simpler indexing)
CREATE INDEX IF NOT EXISTS candles_1w_pair_time_idx ON candles_1w(pair_id, t_start);
CREATE INDEX IF NOT EXISTS candles_1w_time_idx ON candles_1w(t_start);

-- Monthly candles (smallest dataset, minimal indexing)
CREATE INDEX IF NOT EXISTS candles_1mo_pair_time_idx ON candles_1mo(pair_id, t_start);
CREATE INDEX IF NOT EXISTS candles_1mo_time_idx ON candles_1mo(t_start);

-- For queries that fetch specific router+pair combinations frequently
CREATE INDEX IF NOT EXISTS candles_1m_router_pair_time_idx 
  ON candles_1m(router_id, pair_id, t_start) 
  INCLUDE (o, h, l, c, v);

CREATE INDEX IF NOT EXISTS candles_5m_router_pair_time_idx 
  ON candles_5m(router_id, pair_id, t_start) 
  INCLUDE (o, h, l, c, v);

-- For efficient aggregation queries during rollup
CREATE INDEX IF NOT EXISTS candles_1m_rollup_idx 
  ON candles_1m(router_id, t_start);

CREATE INDEX IF NOT EXISTS candles_5m_rollup_idx 
  ON candles_5m(router_id, t_start);

CREATE OR REPLACE FUNCTION rollup_and_cleanup_candles(
  p_router_id INT,
  p_now_ms BIGINT DEFAULT extract(epoch from now()) * 1000
) RETURNS TABLE (
  rollup_resolution TEXT,
  rolled_count BIGINT,
  deleted_count BIGINT
) AS $$
DECLARE
  cutoff_1m BIGINT;
  cutoff_5m BIGINT;
  cutoff_15m BIGINT;
  cutoff_1h BIGINT;
  cutoff_4h BIGINT;
  
  v_rolled_1m_5m BIGINT := 0;
  v_rolled_5m_15m BIGINT := 0;
  v_rolled_15m_1h BIGINT := 0;
  v_rolled_1h_4h BIGINT := 0;
  v_rolled_4h_1d BIGINT := 0;
  v_rolled_1d_1w BIGINT := 0;
  v_rolled_1w_1mo BIGINT := 0;
  
  v_deleted_1m BIGINT := 0;
  v_deleted_5m BIGINT := 0;
  v_deleted_15m BIGINT := 0;
  v_deleted_1h BIGINT := 0;
  v_deleted_4h BIGINT := 0;
BEGIN
  -- Load retention config from table
  SELECT p_now_ms - (keep_days::BIGINT * 86400000) INTO cutoff_1m 
    FROM retention_config WHERE resolution = '1m';
  SELECT p_now_ms - (keep_days::BIGINT * 86400000) INTO cutoff_5m 
    FROM retention_config WHERE resolution = '5m';
  SELECT p_now_ms - (keep_days::BIGINT * 86400000) INTO cutoff_15m 
    FROM retention_config WHERE resolution = '15m';
  SELECT p_now_ms - (keep_days::BIGINT * 86400000) INTO cutoff_1h 
    FROM retention_config WHERE resolution = '1h';
  SELECT p_now_ms - (keep_days::BIGINT * 86400000) INTO cutoff_4h 
    FROM retention_config WHERE resolution = '4h';

  -- Roll 1m → 5m (for all data within 5m retention window)
  WITH rolled AS (
    INSERT INTO candles_5m (router_id, pair_id, t_start, o, h, l, c, v, num_trades)
    SELECT 
      router_id, pair_id,
      (t_start / 300000) * 300000 as bucket,
      (array_agg(o ORDER BY t_start))[1],
      MAX(h), MIN(l),
      (array_agg(c ORDER BY t_start DESC))[1],
      SUM(v),
      COUNT(*)::INT
    FROM candles_1m
    WHERE router_id = p_router_id
      AND t_start >= cutoff_5m  -- Within 90-day 5m retention
      AND t_start < p_now_ms - 300000  -- Skip incomplete bucket
    GROUP BY router_id, pair_id, (t_start / 300000) * 300000
    ON CONFLICT (router_id, pair_id, t_start) 
    DO UPDATE SET 
      h = GREATEST(candles_5m.h, EXCLUDED.h),
      l = LEAST(candles_5m.l, EXCLUDED.l),
      c = EXCLUDED.c,
      v = EXCLUDED.v,
      num_trades = EXCLUDED.num_trades
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_rolled_1m_5m FROM rolled;

  -- Roll 5m → 15m
  WITH rolled AS (
    INSERT INTO candles_15m (router_id, pair_id, t_start, o, h, l, c, v, num_trades)
    SELECT 
      router_id, pair_id,
      (t_start / 900000) * 900000 as bucket,
      (array_agg(o ORDER BY t_start))[1],
      MAX(h), MIN(l),
      (array_agg(c ORDER BY t_start DESC))[1],
      SUM(v),
      SUM(num_trades)::INT
    FROM candles_5m
    WHERE router_id = p_router_id
      AND t_start >= cutoff_15m  -- Within 180-day 15m retention
      AND t_start < p_now_ms - 900000
    GROUP BY router_id, pair_id, (t_start / 900000) * 900000
    ON CONFLICT (router_id, pair_id, t_start) 
    DO UPDATE SET 
      h = GREATEST(candles_15m.h, EXCLUDED.h),
      l = LEAST(candles_15m.l, EXCLUDED.l),
      c = EXCLUDED.c,
      v = EXCLUDED.v,
      num_trades = EXCLUDED.num_trades
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_rolled_5m_15m FROM rolled;

  -- Roll 15m → 1h
  WITH rolled AS (
    INSERT INTO candles_1h (router_id, pair_id, t_start, o, h, l, c, v, num_trades)
    SELECT 
      router_id, pair_id,
      (t_start / 3600000) * 3600000 as bucket,
      (array_agg(o ORDER BY t_start))[1],
      MAX(h), MIN(l),
      (array_agg(c ORDER BY t_start DESC))[1],
      SUM(v),
      SUM(num_trades)::INT
    FROM candles_15m
    WHERE router_id = p_router_id
      AND t_start >= cutoff_1h  -- Within 2-year 1h retention
      AND t_start < p_now_ms - 3600000
    GROUP BY router_id, pair_id, (t_start / 3600000) * 3600000
    ON CONFLICT (router_id, pair_id, t_start) 
    DO UPDATE SET 
      h = GREATEST(candles_1h.h, EXCLUDED.h),
      l = LEAST(candles_1h.l, EXCLUDED.l),
      c = EXCLUDED.c,
      v = EXCLUDED.v,
      num_trades = EXCLUDED.num_trades
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_rolled_15m_1h FROM rolled;

  -- Roll 1h → 4h
  WITH rolled AS (
    INSERT INTO candles_4h (router_id, pair_id, t_start, o, h, l, c, v, num_trades)
    SELECT 
      router_id, pair_id,
      (t_start / 14400000) * 14400000 as bucket,
      (array_agg(o ORDER BY t_start))[1],
      MAX(h), MIN(l),
      (array_agg(c ORDER BY t_start DESC))[1],
      SUM(v),
      SUM(num_trades)::INT
    FROM candles_1h
    WHERE router_id = p_router_id
      AND t_start >= cutoff_4h  -- Within 5-year 4h retention
      AND t_start < p_now_ms - 14400000
    GROUP BY router_id, pair_id, (t_start / 14400000) * 14400000
    ON CONFLICT (router_id, pair_id, t_start) 
    DO UPDATE SET 
      h = GREATEST(candles_4h.h, EXCLUDED.h),
      l = LEAST(candles_4h.l, EXCLUDED.l),
      c = EXCLUDED.c,
      v = EXCLUDED.v,
      num_trades = EXCLUDED.num_trades
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_rolled_1h_4h FROM rolled;

  WITH rolled AS (
    INSERT INTO candles_1d (router_id, pair_id, t_start, o, h, l, c, v, num_trades)
    SELECT 
      router_id, pair_id,
      (t_start / 86400000) * 86400000 as bucket,
      (array_agg(o ORDER BY t_start))[1],
      MAX(h), MIN(l),
      (array_agg(c ORDER BY t_start DESC))[1],
      SUM(v),
      SUM(num_trades)::INT
    FROM candles_4h
    WHERE router_id = p_router_id
      AND t_start < p_now_ms - 86400000
    GROUP BY router_id, pair_id, (t_start / 86400000) * 86400000
    ON CONFLICT (router_id, pair_id, t_start) 
    DO UPDATE SET 
      h = GREATEST(candles_1d.h, EXCLUDED.h),
      l = LEAST(candles_1d.l, EXCLUDED.l),
      c = EXCLUDED.c,
      v = EXCLUDED.v,
      num_trades = EXCLUDED.num_trades
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_rolled_4h_1d FROM rolled;

  -- Roll 1D → 1W (Monday-aligned weeks)
  WITH rolled AS (
    INSERT INTO candles_1w (router_id, pair_id, t_start, o, h, l, c, v)
    SELECT 
      router_id, pair_id,
      extract(epoch from date_trunc('week', to_timestamp(t_start/1000)))::BIGINT * 1000 as week_start,
      (array_agg(o ORDER BY t_start))[1],
      MAX(h), MIN(l),
      (array_agg(c ORDER BY t_start DESC))[1],
      SUM(v)
    FROM candles_1d
    WHERE router_id = p_router_id
      AND t_start < p_now_ms - 604800000
    GROUP BY router_id, pair_id, date_trunc('week', to_timestamp(t_start/1000))
    ON CONFLICT (router_id, pair_id, t_start) 
    DO UPDATE SET 
      h = GREATEST(candles_1w.h, EXCLUDED.h),
      l = LEAST(candles_1w.l, EXCLUDED.l),
      c = EXCLUDED.c,
      v = EXCLUDED.v
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_rolled_1d_1w FROM rolled;

  -- Roll 1W → 1MO (calendar months)
  WITH rolled AS (
    INSERT INTO candles_1mo (router_id, pair_id, t_start, o, h, l, c, v)
    SELECT 
      router_id, pair_id,
      extract(epoch from date_trunc('month', to_timestamp(t_start/1000)))::BIGINT * 1000 as month_start,
      (array_agg(o ORDER BY t_start))[1],
      MAX(h), MIN(l),
      (array_agg(c ORDER BY t_start DESC))[1],
      SUM(v)
    FROM candles_1w
    WHERE router_id = p_router_id
      AND t_start < extract(epoch from date_trunc('month', now()))::BIGINT * 1000
    GROUP BY router_id, pair_id, date_trunc('month', to_timestamp(t_start/1000))
    ON CONFLICT (router_id, pair_id, t_start) 
    DO UPDATE SET 
      h = GREATEST(candles_1mo.h, EXCLUDED.h),
      l = LEAST(candles_1mo.l, EXCLUDED.l),
      c = EXCLUDED.c,
      v = EXCLUDED.v
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_rolled_1w_1mo FROM rolled;

  -- Delete old data (with updated thresholds)
  DELETE FROM candles_1m WHERE router_id = p_router_id AND t_start < cutoff_1m;
  GET DIAGNOSTICS v_deleted_1m = ROW_COUNT;
  
  DELETE FROM candles_5m WHERE router_id = p_router_id AND t_start < cutoff_5m;
  GET DIAGNOSTICS v_deleted_5m = ROW_COUNT;
  
  DELETE FROM candles_15m WHERE router_id = p_router_id AND t_start < cutoff_15m;
  GET DIAGNOSTICS v_deleted_15m = ROW_COUNT;
  
  DELETE FROM candles_1h WHERE router_id = p_router_id AND t_start < cutoff_1h;
  GET DIAGNOSTICS v_deleted_1h = ROW_COUNT;
  
  DELETE FROM candles_4h WHERE router_id = p_router_id AND t_start < cutoff_4h;
  GET DIAGNOSTICS v_deleted_4h = ROW_COUNT;

  -- Return summary
  RETURN QUERY
  SELECT '1m→5m', v_rolled_1m_5m, v_deleted_1m
  UNION ALL SELECT '5m→15m', v_rolled_5m_15m, v_deleted_5m
  UNION ALL SELECT '15m→1h', v_rolled_15m_1h, v_deleted_15m
  UNION ALL SELECT '1h→4h', v_rolled_1h_4h, v_deleted_1h
  UNION ALL SELECT '4h→1d', v_rolled_4h_1d, v_deleted_4h
  UNION ALL SELECT '1d→1w', v_rolled_1d_1w, 0::BIGINT
  UNION ALL SELECT '1w→1mo', v_rolled_1w_1mo, 0::BIGINT;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- CANDLE BUILDER CHECKPOINT
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS candle_state (
  router_id  INT PRIMARY KEY REFERENCES routers(id),
  last_ts_ms BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_id TEXT NOT NULL DEFAULT ''
);

-- -----------------------------------------------------------------------------
-- RESERVES SNAPSHOT (opaque latest)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reserves_latest (
  router     TEXT NOT NULL,
  pool_key   TEXT NOT NULL,
  a_amount   TEXT NOT NULL,
  b_amount   TEXT NOT NULL,
  t_ms       BIGINT NOT NULL,
  topo       BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (router, pool_key)
);

-- =============================================================================
-- ARP & ROUTING
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ANCHORS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS anchors (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,                         -- 'XEL','USDT','ETH','BTC',...
  router_id  INT  NOT NULL REFERENCES routers(id),
  pair_id    INT  REFERENCES pairs(id),    -- <ANCHOR>_USD
  target_asset_id INT REFERENCES assets(id),
  version    INT  NOT NULL DEFAULT 1,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS anchors_router_name_unique ON anchors(router_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS anchors_router_pair_unique ON anchors(router_id, pair_id);
CREATE INDEX IF NOT EXISTS anchors_active_idx ON anchors(active);

-- -----------------------------------------------------------------------------
-- ROUTING PATHS (top-K ranked, signed pair_ids encode direction)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS routing_paths (
  router_id   INT NOT NULL REFERENCES routers(id),
  anchor_id   INT NOT NULL REFERENCES anchors(id),
  asset_id    INT NOT NULL REFERENCES assets(id),
  path_rank   SMALLINT NOT NULL,                -- 1..K (1 = preferred)
  edges       INT[] NOT NULL,                   -- e.g., '{12,-34,56}'
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (router_id, anchor_id, asset_id, path_rank),
  CONSTRAINT routing_paths_nonempty CHECK (array_length(edges,1) IS NOT NULL AND array_length(edges,1) > 0),
  CONSTRAINT routing_paths_hop_ceiling CHECK (array_length(edges,1) <= 8)
);
CREATE INDEX IF NOT EXISTS routing_paths_asset_idx
  ON routing_paths(router_id, anchor_id, asset_id, path_rank);

-- -----------------------------------------------------------------------------
-- ARP POINTS (1m) – **with clamping & hop-count enforcement**
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS arp_points_1m (
  router_id          INT NOT NULL REFERENCES routers(id),
  anchor_id          INT NOT NULL REFERENCES anchors(id),
  asset_id           INT NOT NULL REFERENCES assets(id),
  t_start            BIGINT NOT NULL,           -- minute open (ms)
  price_in_anchor    DOUBLE PRECISION NOT NULL, 
  confidence_score   DOUBLE PRECISION NOT NULL, -- 0..1
  narrowest_pair_id  INT REFERENCES pairs(id),
  hop_count          SMALLINT NOT NULL DEFAULT 1,
  flags              TEXT[] NOT NULL DEFAULT '{}',
  best_path_edges    INT[],
  anchor_version     INT NOT NULL DEFAULT 1,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (router_id, anchor_id, asset_id, t_start),
  CONSTRAINT arp_confidence_clamped CHECK (confidence_score >= 0 AND confidence_score <= 1),
  CONSTRAINT arp_hops_reasonable    CHECK (hop_count BETWEEN 0 AND 8),
  CONSTRAINT arp_points_1m_minute_aligned CHECK (t_start % 60000 = 0)
);
CREATE INDEX IF NOT EXISTS arp_points_1m_time_idx
  ON arp_points_1m (t_start);
CREATE INDEX IF NOT EXISTS arp_points_1m_asset_time_idx
  ON arp_points_1m (asset_id, t_start);
CREATE INDEX IF NOT EXISTS arp_points_1m_quality_idx
  ON arp_points_1m (router_id, anchor_id, t_start, confidence_score DESC);

-- =============================================================================
-- ARP AGGREGATION TABLES (for tiered storage)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ARP POINTS (5m) – 5-minute aggregates
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS arp_points_5m (
  router_id          INT NOT NULL REFERENCES routers(id),
  anchor_id          INT NOT NULL REFERENCES anchors(id),
  asset_id           INT NOT NULL REFERENCES assets(id),
  t_start            BIGINT NOT NULL,           -- 5-minute open (ms)
  price_in_anchor    DOUBLE PRECISION NOT NULL, -- Average ASSET/USD for the 5-min window
  confidence_score   DOUBLE PRECISION NOT NULL, -- Average confidence
  hop_count          SMALLINT NOT NULL DEFAULT 1,
  flags              TEXT[] NOT NULL DEFAULT '{}',
  anchor_version     INT NOT NULL DEFAULT 1,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (router_id, anchor_id, asset_id, t_start),
  CONSTRAINT arp_5m_confidence_clamped CHECK (confidence_score >= 0 AND confidence_score <= 1),
  CONSTRAINT arp_5m_hops_reasonable    CHECK (hop_count BETWEEN 0 AND 8),
  CONSTRAINT arp_points_5m_aligned CHECK (t_start % 300000 = 0)  -- 5 minutes
);
CREATE INDEX IF NOT EXISTS arp_points_5m_time_idx
  ON arp_points_5m (t_start);
CREATE INDEX IF NOT EXISTS arp_points_5m_asset_time_idx
  ON arp_points_5m (asset_id, t_start);

-- -----------------------------------------------------------------------------
-- ARP POINTS (1h) – hourly aggregates
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS arp_points_1h (
  router_id          INT NOT NULL REFERENCES routers(id),
  anchor_id          INT NOT NULL REFERENCES anchors(id),
  asset_id           INT NOT NULL REFERENCES assets(id),
  t_start            BIGINT NOT NULL,           -- hour open (ms)
  price_in_anchor    DOUBLE PRECISION NOT NULL, -- Average ASSET/USD for the hour
  confidence_score   DOUBLE PRECISION NOT NULL, -- Average confidence
  hop_count          SMALLINT NOT NULL DEFAULT 1,
  flags              TEXT[] NOT NULL DEFAULT '{}',
  anchor_version     INT NOT NULL DEFAULT 1,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (router_id, anchor_id, asset_id, t_start),
  CONSTRAINT arp_1h_confidence_clamped CHECK (confidence_score >= 0 AND confidence_score <= 1),
  CONSTRAINT arp_1h_hops_reasonable    CHECK (hop_count BETWEEN 0 AND 8),
  CONSTRAINT arp_points_1h_aligned CHECK (t_start % 3600000 = 0)  -- 1 hour
);
CREATE INDEX IF NOT EXISTS arp_points_1h_time_idx
  ON arp_points_1h (t_start);
CREATE INDEX IF NOT EXISTS arp_points_1h_asset_time_idx
  ON arp_points_1h (asset_id, t_start);

-- -----------------------------------------------------------------------------
-- ARP POINTS (1d) – daily aggregates (indefinite retention)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS arp_points_1d (
  router_id          INT NOT NULL REFERENCES routers(id),
  anchor_id          INT NOT NULL REFERENCES anchors(id),
  asset_id           INT NOT NULL REFERENCES assets(id),
  t_start            BIGINT NOT NULL,           -- day open (ms)
  price_in_anchor    DOUBLE PRECISION NOT NULL, -- Average ASSET/USD for the day
  confidence_score   DOUBLE PRECISION NOT NULL, -- Average confidence
  hop_count          SMALLINT NOT NULL DEFAULT 1,
  flags              TEXT[] NOT NULL DEFAULT '{}',
  anchor_version     INT NOT NULL DEFAULT 1,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (router_id, anchor_id, asset_id, t_start),
  CONSTRAINT arp_1d_confidence_clamped CHECK (confidence_score >= 0 AND confidence_score <= 1),
  CONSTRAINT arp_1d_hops_reasonable    CHECK (hop_count BETWEEN 0 AND 8),
  CONSTRAINT arp_points_1d_aligned CHECK (t_start % 86400000 = 0)  -- 1 day alignment
);

CREATE INDEX IF NOT EXISTS arp_points_1d_time_idx ON arp_points_1d (t_start);
CREATE INDEX IF NOT EXISTS arp_points_1d_asset_time_idx ON arp_points_1d (asset_id, t_start);

-- =============================================================================
-- ARP DATA MANAGEMENT FUNCTIONS
-- =============================================================================

-- Function to aggregate and clean old ARP data
CREATE OR REPLACE FUNCTION aggregate_and_clean_arp_data(
  p_router_id INT,
  p_now_ms BIGINT DEFAULT extract(epoch from now()) * 1000
) RETURNS TABLE (
  deleted_1m INT,
  created_5m INT,
  created_1h INT,
  created_1d INT
) AS $$
DECLARE
  thirty_days_ago BIGINT := p_now_ms - (30::BIGINT * 24 * 60 * 60 * 1000);
  ninety_days_ago BIGINT := p_now_ms - (90::BIGINT * 24 * 60 * 60 * 1000);
  one_year_ago BIGINT := p_now_ms - (365::BIGINT * 24 * 60 * 60 * 1000);
  
  v_deleted_1m INT := 0;
  v_deleted_5m INT := 0;
  v_deleted_1h INT := 0;
  v_created_5m INT := 0;
  v_created_1h INT := 0;
  v_created_1d INT := 0;
BEGIN
  -- Aggregate 1m → 5m for data older than 30 days but newer than 90 days
  WITH aggregated AS (
    INSERT INTO arp_points_5m (
      router_id, anchor_id, asset_id, t_start,
      price_in_anchor, confidence_score, hop_count, flags
    )
    SELECT 
      router_id, anchor_id, asset_id,
      (t_start / 300000) * 300000 as bucket,
      AVG(price_in_anchor),
      AVG(confidence_score),
      MIN(hop_count),
      array_agg(DISTINCT flag) FILTER (WHERE flag IS NOT NULL)
    FROM arp_points_1m,
    LATERAL unnest(COALESCE(flags, ARRAY[]::TEXT[])) AS flag
    WHERE router_id = p_router_id
      AND t_start < thirty_days_ago
      AND t_start >= ninety_days_ago
    GROUP BY router_id, anchor_id, asset_id, bucket
    ON CONFLICT (router_id, anchor_id, asset_id, t_start) DO UPDATE
      SET price_in_anchor = EXCLUDED.price_in_anchor,
          confidence_score = EXCLUDED.confidence_score,
          hop_count = EXCLUDED.hop_count,
          flags = EXCLUDED.flags,
          updated_at = now()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_created_5m FROM aggregated;

  -- Aggregate 5m → 1h for data older than 90 days but newer than 1 year
  WITH aggregated AS (
    INSERT INTO arp_points_1h (
      router_id, anchor_id, asset_id, t_start,
      price_in_anchor, confidence_score, hop_count, flags
    )
    SELECT 
      router_id, anchor_id, asset_id,
      (t_start / 3600000) * 3600000 as bucket,
      AVG(price_in_anchor),
      AVG(confidence_score),
      MIN(hop_count),
      array_agg(DISTINCT flag) FILTER (WHERE flag IS NOT NULL)
    FROM arp_points_5m,
    LATERAL unnest(COALESCE(flags, ARRAY[]::TEXT[])) AS flag
    WHERE router_id = p_router_id
      AND t_start < ninety_days_ago
      AND t_start >= one_year_ago
    GROUP BY router_id, anchor_id, asset_id, bucket
    ON CONFLICT (router_id, anchor_id, asset_id, t_start) DO UPDATE
      SET price_in_anchor = EXCLUDED.price_in_anchor,
          confidence_score = EXCLUDED.confidence_score,
          hop_count = EXCLUDED.hop_count,
          flags = EXCLUDED.flags,
          updated_at = now()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_created_1h FROM aggregated;

  -- NEW: Aggregate 1h → 1d for data older than 1 year (indefinite retention)
  WITH aggregated AS (
    INSERT INTO arp_points_1d (
      router_id, anchor_id, asset_id, t_start,
      price_in_anchor, confidence_score, hop_count, flags
    )
    SELECT 
      router_id, anchor_id, asset_id,
      (t_start / 86400000) * 86400000 as bucket,
      AVG(price_in_anchor),
      AVG(confidence_score),
      MIN(hop_count),
      array_agg(DISTINCT flag) FILTER (WHERE flag IS NOT NULL)
    FROM arp_points_1h,
    LATERAL unnest(COALESCE(flags, ARRAY[]::TEXT[])) AS flag
    WHERE router_id = p_router_id
      AND t_start < one_year_ago
    GROUP BY router_id, anchor_id, asset_id, bucket
    ON CONFLICT (router_id, anchor_id, asset_id, t_start) DO UPDATE
      SET price_in_anchor = EXCLUDED.price_in_anchor,
          confidence_score = EXCLUDED.confidence_score,
          hop_count = EXCLUDED.hop_count,
          flags = EXCLUDED.flags,
          updated_at = now()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_created_1d FROM aggregated;

  -- Delete old data
  DELETE FROM arp_points_1m WHERE router_id = p_router_id AND t_start < thirty_days_ago;
  GET DIAGNOSTICS v_deleted_1m = ROW_COUNT;
  
  DELETE FROM arp_points_5m WHERE router_id = p_router_id AND t_start < ninety_days_ago;
  GET DIAGNOSTICS v_deleted_5m = ROW_COUNT;
  
  DELETE FROM arp_points_1h WHERE router_id = p_router_id AND t_start < one_year_ago;
  GET DIAGNOSTICS v_deleted_1h = ROW_COUNT;
  
  -- No deletion for 1d (indefinite retention)

  RETURN QUERY SELECT v_deleted_1m, v_created_5m, v_created_1h, v_created_1d;
END;
$$ LANGUAGE plpgsql;

-- Add triggers for updated_at
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 't_arp_5m_touch') THEN
    CREATE TRIGGER t_arp_5m_touch BEFORE UPDATE ON arp_points_5m
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
    CREATE TRIGGER t_arp_1h_touch BEFORE UPDATE ON arp_points_1h
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
    CREATE TRIGGER t_arp_1d_touch BEFORE UPDATE ON arp_points_1d
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- ARP COMPOSER CHECKPOINT
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS arp_state (
  router_id    INT NOT NULL REFERENCES routers(id),
  anchor_id    INT NOT NULL REFERENCES anchors(id),
  last_t_start BIGINT NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (router_id, anchor_id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 't_pairs_touch') THEN
    CREATE TRIGGER t_pairs_touch BEFORE UPDATE ON pairs
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
    CREATE TRIGGER t_assets_touch BEFORE UPDATE ON assets
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
    CREATE TRIGGER t_pair_components_touch BEFORE UPDATE ON pair_components
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
    CREATE TRIGGER t_anchors_touch BEFORE UPDATE ON anchors
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
    CREATE TRIGGER t_routing_paths_touch BEFORE UPDATE ON routing_paths
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
    CREATE TRIGGER t_arp_points_touch BEFORE UPDATE ON arp_points_1m
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
  END IF;
END $$;

-- =============================================================================
-- PATH FINDING (SQL - Efficient Graph Operations)
-- =============================================================================

-- Update routing paths for an asset (find best K paths)
-- This stays in SQL because recursive CTEs are efficient for graph traversal
CREATE OR REPLACE FUNCTION update_routing_paths(
  p_router_id INT,
  p_anchor_id INT,
  p_asset_id INT,
  p_max_hops INT DEFAULT 6,
  p_top_k INT DEFAULT 5
) RETURNS INT AS $$
DECLARE
  paths_count INT := 0;
  target_id INT;
BEGIN
  -- Get anchor target
  SELECT target_asset_id INTO target_id FROM anchors WHERE id = p_anchor_id;
  
  -- Delete existing paths
  DELETE FROM routing_paths 
  WHERE router_id = p_router_id 
    AND anchor_id = p_anchor_id 
    AND asset_id = p_asset_id;
  
  -- Skip if asset = target (direct path)
  IF p_asset_id = target_id THEN
    RETURN 0;
  END IF;
  
  -- Find paths through TRADEABLE pairs only (exclude ORACLE router)
  WITH RECURSIVE path_search AS (
    SELECT 
      p_asset_id as current_id,
      ARRAY[]::INT[] as edges,
      0 as depth
    
    UNION ALL
    
    SELECT 
      CASE 
        WHEN pc.base_asset_id = ps.current_id THEN pc.quote_asset_id
        ELSE pc.base_asset_id
      END as current_id,
      ps.edges || CASE 
        WHEN pc.base_asset_id = ps.current_id THEN p.id
        ELSE -p.id
      END as edges,
      ps.depth + 1
    FROM path_search ps
    JOIN pair_components pc ON (
      pc.base_asset_id = ps.current_id OR 
      pc.quote_asset_id = ps.current_id
    )
    JOIN pairs p ON p.id = pc.pair_id
    -- CRITICAL: Only traverse pairs that have actual reserves (exclude oracle)
    WHERE ps.depth < p_max_hops
      AND NOT (p.id = ANY(ps.edges) OR (-p.id) = ANY(ps.edges))
      AND EXISTS (
        SELECT 1 FROM reserves_latest rl
        JOIN routers r ON r.router = rl.router
        WHERE r.id = p_router_id
          AND rl.pool_key = CONCAT(
            LEAST(encode(p.a_hash,'hex'), encode(p.b_hash,'hex')),
            '_',
            GREATEST(encode(p.a_hash,'hex'), encode(p.b_hash,'hex'))
          )
      )
  ),
  valid_paths AS (
    SELECT 
      edges,
      array_length(edges, 1) as hop_count
    FROM path_search
    WHERE current_id = target_id
    AND array_length(edges, 1) > 0
    ORDER BY 
      hop_count ASC,
      edges
    LIMIT p_top_k
  )
  INSERT INTO routing_paths (router_id, anchor_id, asset_id, path_rank, edges)
  SELECT 
    p_router_id,
    p_anchor_id,
    p_asset_id,
    row_number() OVER (ORDER BY hop_count, edges)::SMALLINT,
    edges
  FROM valid_paths;
  
  GET DIAGNOSTICS paths_count = ROW_COUNT;
  RETURN paths_count;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- ADMIN AUTHENTICATION & AUDIT (for admin dashboard)
-- =============================================================================

-- Admin users table
CREATE TABLE IF NOT EXISTS admin_users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  
  -- Session management
  token_version INTEGER DEFAULT 1,
  last_login TIMESTAMPTZ,
  last_login_ip INET,
  last_password_verification TIMESTAMPTZ,
  
  -- 2FA
  totp_secret VARCHAR(255),
  is_2fa_enabled BOOLEAN DEFAULT FALSE,
  backup_codes JSONB,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_users_token_version 
  ON admin_users(id, token_version) 
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS admin_users_email_active_idx 
  ON admin_users(email) 
  WHERE is_active = true;

CREATE TABLE IF NOT EXISTS admin_user_invites (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  token TEXT NOT NULL UNIQUE,
  invited_by INTEGER REFERENCES admin_users(id),
  invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  consumed_by_ip TEXT,
  full_name TEXT
);

CREATE INDEX IF NOT EXISTS idx_invites_token ON admin_user_invites(token) WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_invites_expires ON admin_user_invites(expires_at) WHERE consumed_at IS NULL;

-- Super users table - users who can execute raw SQL
CREATE TABLE IF NOT EXISTS admin_super_users (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  granted_by INTEGER NOT NULL REFERENCES admin_users(id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT,
  
  CONSTRAINT unique_super_user UNIQUE (user_id)
);

CREATE INDEX idx_super_users_user_id ON admin_super_users(user_id);

-- Audit log for super user actions
INSERT INTO admin_audit_log (user_email, action, details, success)
VALUES ('system', 'migration_super_users_table', '{"version": "1.0.0"}', true);

-- Admin audit log (enhanced with Cloudflare data)
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id BIGSERIAL PRIMARY KEY,
  user_id INT REFERENCES admin_users(id),
  user_email VARCHAR(255) NOT NULL,
  action VARCHAR(100) NOT NULL,
  target_table VARCHAR(100),
  target_id TEXT,
  details JSONB NOT NULL DEFAULT '{}',
  
  -- Network info
  ip_address INET,
  user_agent TEXT,
  
  -- Cloudflare security data
  cf_ray VARCHAR(255),
  cf_country VARCHAR(10),
  cf_colo VARCHAR(10),
  threat_score INTEGER,
  is_tor BOOLEAN DEFAULT FALSE,
  
  -- Result
  success BOOLEAN NOT NULL DEFAULT true,
  error_message TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS audit_log_user_time_idx 
  ON admin_audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_action_time_idx 
  ON admin_audit_log(action, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_time_brin 
  ON admin_audit_log USING BRIN(created_at);

-- Security indexes
CREATE INDEX IF NOT EXISTS idx_audit_log_threat_score 
  ON admin_audit_log(threat_score, created_at DESC) 
  WHERE threat_score > 30;
CREATE INDEX IF NOT EXISTS idx_audit_log_tor 
  ON admin_audit_log(user_email, created_at DESC) 
  WHERE is_tor = true;
CREATE INDEX IF NOT EXISTS idx_audit_log_cf_ray 
  ON admin_audit_log(cf_ray) 
  WHERE cf_ray IS NOT NULL;

-- Trigger for admin_users updated_at
CREATE TRIGGER t_admin_users_touch BEFORE UPDATE ON admin_users
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- =============================================================================
-- ROUTER METADATA (for better admin UX)
-- =============================================================================

-- Add display metadata to routers table
ALTER TABLE routers ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE routers ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE routers ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE routers ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE routers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Trigger for routers updated_at (if not already exists)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 't_routers_touch') THEN
    CREATE TRIGGER t_routers_touch BEFORE UPDATE ON routers
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
  END IF;
END $$;

-- =============================================================================
-- ADMIN QUERY MACROS (predefined SQL snippets for admin dashboard)
-- =============================================================================

CREATE TABLE IF NOT EXISTS query_macros (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  sql TEXT NOT NULL,
  parameters JSONB DEFAULT '[]',
  category VARCHAR(50),
  requires_confirmation BOOLEAN DEFAULT true,
  created_by INTEGER REFERENCES admin_users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS macro_executions (
  id SERIAL PRIMARY KEY,
  macro_id INTEGER REFERENCES query_macros(id),
  executed_by INTEGER REFERENCES admin_users(id),
  parameters JSONB,
  rows_affected INTEGER,
  execution_time_ms INTEGER,
  success BOOLEAN,
  error_message TEXT,
  executed_at TIMESTAMPTZ DEFAULT now()
);