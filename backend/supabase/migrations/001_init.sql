-- ARIS Trading Analyzer — Supabase (PostgreSQL) schema
-- Run this in Supabase: SQL Editor → paste → Run
-- Idempotent: uses CREATE TABLE IF NOT EXISTS

-- ── trades (signals + history) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trades (
  id                TEXT PRIMARY KEY,
  instrument        TEXT NOT NULL,
  timeframe         TEXT,
  direction         TEXT,            -- LONG | SHORT
  entry_low         FLOAT8,
  entry_high        FLOAT8,
  entry_price       FLOAT8,
  sl                FLOAT8,
  tp1               FLOAT8,
  tp2               FLOAT8,
  rr                FLOAT8,
  status            TEXT DEFAULT 'PENDING',
  grade             TEXT,
  confidence_pct    FLOAT8,
  reasoning         TEXT,
  indicator_snapshot TEXT,           -- JSON string
  strategy          TEXT,
  is_new            INT4 DEFAULT 1,
  created_at        TIMESTAMPTZ DEFAULT now(),
  closed_at         TIMESTAMPTZ,
  close_price       FLOAT8,
  entered_zone      INT4 DEFAULT 0
);

-- ── lessons (AI post-mortem / win-review) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS lessons (
  id                BIGSERIAL PRIMARY KEY,
  trade_id          TEXT,
  instrument        TEXT,
  direction         TEXT,
  failure_reason    TEXT,
  lesson            TEXT,
  created_at        TIMESTAMPTZ DEFAULT now(),
  exit_price        FLOAT8,
  realized_r        FLOAT8
);

-- ── alerts ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alerts (
  id                BIGSERIAL PRIMARY KEY,
  type              TEXT,
  symbol            TEXT,
  direction         TEXT,
  status            TEXT,
  r_multiple        FLOAT8,
  message           TEXT,
  created_at        TIMESTAMPTZ DEFAULT now(),
  seen              INT4 DEFAULT 0,
  trade_id          TEXT
);

-- ── price_history (sampled price points for active trades) ───────────────────
CREATE TABLE IF NOT EXISTS price_history (
  id                BIGSERIAL PRIMARY KEY,
  trade_id          TEXT NOT NULL,
  price             FLOAT8,
  sampled_at        TIMESTAMPTZ DEFAULT now()
);

-- ── indexes (perf) ───────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_trades_status      ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_instrument  ON trades(instrument);
CREATE INDEX IF NOT EXISTS idx_lessons_instrument ON lessons(instrument, direction);
CREATE INDEX IF NOT EXISTS idx_alerts_created     ON alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_history_tid ON price_history(trade_id);
