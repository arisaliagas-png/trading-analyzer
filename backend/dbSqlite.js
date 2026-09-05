/**
 * db.js — Single Source of Truth for all ARIS trade data.
 *
 * Replaces:  signals.json  (scanner active signals)
 *            history.json  (trade tracker history)
 *            lessons.json  (AI post-mortem lessons)
 *
 * All reads and writes go through this module ONLY.
 * Uses better-sqlite3 (synchronous API) — safe for single-process Node.js.
 * Atomic writes via SQLite transactions → no corrupted state if process dies mid-write.
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { dbLog } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const DB_PATH   = path.join(__dirname, 'data', 'aris.db');
const DATA_DIR  = path.join(__dirname, 'data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ─────────────────────────────────────────────
// OPEN & INITIALISE
// ─────────────────────────────────────────────
export const db = new Database(DB_PATH);

// WAL mode: dramatically reduces write latency and allows
// concurrent readers while a write is in progress.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─────────────────────────────────────────────
// SCHEMA
// ─────────────────────────────────────────────
db.exec(`
  -- ── trades ──────────────────────────────────────────────────────────
  -- Single table for BOTH scanner signals and tracker history.
  -- status lifecycle:  PENDING → ACTIVE → SUCCESS | FAILED
  CREATE TABLE IF NOT EXISTS trades (
    id                TEXT PRIMARY KEY,
    instrument        TEXT NOT NULL,
    timeframe         TEXT,
    direction         TEXT,          -- LONG | SHORT
    entry_low         REAL,
    entry_high        REAL,
    entry_price       REAL,
    sl                REAL,
    tp1               REAL,
    tp2               REAL,
    rr                REAL,
    status            TEXT DEFAULT 'PENDING',
    grade             TEXT,
    confidence_pct    REAL,
    reasoning         TEXT,
    indicator_snapshot TEXT,          -- JSON blob (array of strings)
    strategy          TEXT,
    is_new            INTEGER DEFAULT 1,   -- 1 = show "new" badge once
    created_at        TEXT,
    closed_at         TEXT,
    close_price       REAL              -- price at which the trade closed (SUCCESS/FAILED)
  );

  -- ── lessons ──────────────────────────────────────────────────────────
  -- One row per post-mortem analysis result.
  -- Linked to trades via trade_id (soft link — trade may be gone).
  CREATE TABLE IF NOT EXISTS lessons (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_id       TEXT NOT NULL,
    instrument     TEXT NOT NULL,
    direction      TEXT NOT NULL,
    failure_reason TEXT,
    lesson         TEXT,
    created_at     TEXT
  );

  -- ── price_history ─────────────────────────────────────────────────────
  -- Rolling price samples for active trades (replaces trade.historyPrices[]).
  -- Kept to last 50 rows per trade (pruned on insert).
  CREATE TABLE IF NOT EXISTS price_history (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_id  TEXT NOT NULL,
    price     REAL NOT NULL,
    sampled_at TEXT NOT NULL
  );

  -- Indexes for fast lookups
  CREATE INDEX IF NOT EXISTS idx_trades_instrument ON trades(instrument);
  CREATE INDEX IF NOT EXISTS idx_trades_status     ON trades(status);
  CREATE INDEX IF NOT EXISTS idx_lessons_instrument ON lessons(instrument, direction);
  CREATE INDEX IF NOT EXISTS idx_price_trade        ON price_history(trade_id);
`);

// ── Migration: add close_price column if missing (safe on existing DBs) ──
try {
  db.exec(`ALTER TABLE trades ADD COLUMN close_price REAL`);
} catch (e) {
  // Column already exists — ignore "duplicate column" errors.
  if (!/duplicate column/i.test(e.message)) throw e;
}

// ── Migration: enrich lessons with exit price + realized R (learning analytics) ──
try {
  db.exec(`ALTER TABLE lessons ADD COLUMN exit_price REAL`);
} catch (e) {
  if (!/duplicate column/i.test(e.message)) throw e;
}
try {
  db.exec(`ALTER TABLE lessons ADD COLUMN realized_r REAL`);
} catch (e) {
  if (!/duplicate column/i.test(e.message)) throw e;
}

// ── Migration: add entered_zone flag (persistent PENDING→ACTIVE latch) ──
// Once price has ever touched the entry zone, the trade is ACTIVE for good —
// even if it slipped between monitor ticks. Stored on the row so a restart or
// empty price history can never leave a trade stuck in PENDING.
try {
  db.exec(`ALTER TABLE trades ADD COLUMN entered_zone INTEGER DEFAULT 0`);
} catch (e) {
  if (!/duplicate column/i.test(e.message)) throw e;
}

// ─────────────────────────────────────────────
// PREPARED STATEMENTS
// ─────────────────────────────────────────────
const stmts = {
  insertTrade: db.prepare(`
    INSERT OR IGNORE INTO trades
      (id, instrument, timeframe, direction,
       entry_low, entry_high, entry_price,
       sl, tp1, tp2, rr,
       status, grade, confidence_pct,
       reasoning, indicator_snapshot, strategy, is_new, created_at)
    VALUES
      (@id, @instrument, @timeframe, @direction,
       @entry_low, @entry_high, @entry_price,
       @sl, @tp1, @tp2, @rr,
       @status, @grade, @confidence_pct,
       @reasoning, @indicator_snapshot, @strategy, @is_new, @created_at)
  `),

  updateStatus: db.prepare(`
    UPDATE trades SET status = @status, closed_at = @closed_at,
      close_price = CASE WHEN @close_price IS NOT NULL THEN @close_price ELSE close_price END,
      entry_price = CASE WHEN @entry_price IS NOT NULL THEN @entry_price ELSE entry_price END
    WHERE id = @id
  `),

  updateSignal: db.prepare(`
    UPDATE trades SET
      status = @status,
      grade  = @grade,
      confidence_pct = @confidence_pct,
      reasoning = @reasoning,
      is_new = @is_new,
      sl = COALESCE(@sl, sl),
      entry_price = COALESCE(@entry_price, entry_price),
      entry_low = COALESCE(@entry_low, entry_low),
      entry_high = COALESCE(@entry_high, entry_high),
      tp1 = COALESCE(@tp1, tp1),
      tp2 = COALESCE(@tp2, tp2)
    WHERE id = @id
  `),

  clearIsNew: db.prepare(`UPDATE trades SET is_new = 0 WHERE id = @id`),

  // Latch a trade as having entered its zone — flips PENDING→ACTIVE and
  // persists entered_zone=1 so it can never fall back to PENDING.
  markEnteredZone: db.prepare(`
    UPDATE trades
    SET status = 'ACTIVE', entered_zone = 1,
        entry_price = COALESCE(@entry_price, entry_price)
    WHERE id = @id AND status = 'PENDING'
  `),

  setLesson: db.prepare(`
    UPDATE trades SET reasoning = reasoning WHERE id = @id
  `),

  insertLesson: db.prepare(`
    INSERT INTO lessons (trade_id, instrument, direction, failure_reason, lesson, created_at)
    VALUES (@trade_id, @instrument, @direction, @failure_reason, @lesson, @created_at)
  `),

  attachLessonToTrade: db.prepare(`
    UPDATE trades SET indicator_snapshot = @indicator_snapshot WHERE id = @id
  `),

  insertPrice: db.prepare(`
    INSERT INTO price_history (trade_id, price, sampled_at)
    VALUES (@trade_id, @price, @sampled_at)
  `),

  prunePrice: db.prepare(`
    DELETE FROM price_history
    WHERE trade_id = @trade_id
      AND id NOT IN (
        SELECT id FROM price_history
        WHERE trade_id = @trade_id
        ORDER BY id DESC
        LIMIT 50
      )
  `),

  getById:          db.prepare(`SELECT * FROM trades WHERE id = ?`),
  getByInstrument:  db.prepare(`SELECT * FROM trades WHERE instrument = ? ORDER BY created_at DESC`),
  getActivePending: db.prepare(`SELECT * FROM trades WHERE status IN ('ACTIVE','PENDING','PARTIAL')`),
  getAll:           db.prepare(`SELECT * FROM trades ORDER BY created_at DESC`),
  getPriceHistory:  db.prepare(`SELECT price, sampled_at FROM price_history WHERE trade_id = ? ORDER BY id ASC`),
  getLessons:       db.prepare(`SELECT * FROM lessons WHERE instrument = ? AND direction = ? ORDER BY created_at DESC LIMIT 3`),
  getRecentLessonSamePair: db.prepare(`
    SELECT 1 FROM lessons
    WHERE instrument = ? AND direction = ?
      AND created_at > datetime('now', '-24 hours')
    LIMIT 1
  `),
  getAllLessons:     db.prepare(`SELECT * FROM lessons ORDER BY created_at DESC`),
  deleteById:       db.prepare(`DELETE FROM trades WHERE id = ?`),
  deleteByInstrument: db.prepare(`DELETE FROM trades WHERE instrument = ?`),
};

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * Register a new trade setup (from scanner OR manual analysis).
 * Idempotent — does nothing if the ID already exists.
 */
export function registerTrade(setup) {
  if (!setup.id || !setup.instrument) return;
  if (!setup.entry || setup.entry.price === 0) return;

  const direction =
    setup.direction ? setup.direction :
    setup.bias === 'bullish' ? 'LONG' :
    setup.bias === 'bearish' ? 'SHORT' : null;

  if (!direction) return;

  // GUARD: do not overwrite an in-flight or closed trade with a fresh scan.
  // A new scan re-emitting the same symbol+direction must not clobber a trade
  // that already entered its zone, banked TP1, or already closed (SUCCESS/FAILED/EXPIRED).
  // Look up by instrument+direction (not id) because each scan now gets a
  // unique id, so the id-based check would always miss existing setups.
  const existing = db.prepare('SELECT status,is_new FROM trades WHERE instrument = ? AND direction = ? ORDER BY created_at DESC LIMIT 1').get(setup.instrument, direction);
  const preserveNew = existing && !['PENDING', 'ACTIVE'].includes(existing.status);
  if (existing && !['PENDING', 'ACTIVE'].includes(existing.status)) {
    dbLog.info({ id: setup.id, existingStatus: existing.status, preserveNew }, 'registerTrade skipped — trade already closed/expired, not reopening');
    return;
  }

  stmts.insertTrade.run({
    id:                setup.id,
    instrument:        setup.instrument,
    timeframe:         setup.timeframe || null,
    direction,
    entry_low:         setup.entry.low  ?? null,
    entry_high:        setup.entry.high ?? null,
    entry_price:       setup.entry.price,
    sl:                setup.sl ?? null,
    tp1:               setup.targets?.[0] ?? null,
    tp2:               setup.targets?.[1] ?? null,
    rr:                setup.rr ?? null,
    status:            setup.status || 'PENDING',
    grade:             setup.grade ?? null,
    confidence_pct:    setup.pct ?? null,
    reasoning:         setup.reasoning ?? null,
    indicator_snapshot: JSON.stringify(setup.indicators || []),
    strategy:          setup.strategy ?? null,
    is_new:            preserveNew ? (existing?.is_new ?? 0) : 1,
    created_at:        new Date().toISOString()
  });
  dbLog.info({ id: setup.id, instrument: setup.instrument, direction, preserveNew }, 'Trade registered');
}

/**
 * Update or add a scanner signal. If the symbol+direction already exists,
 * updates status/grade/reasoning but LOCKS the original entry/sl/tp levels
 * (no repainting).
 */
export function upsertSignal(signal) {
  const existing = db.prepare(
    `SELECT * FROM trades WHERE instrument = ? AND direction = ? AND status IN ('PENDING','ACTIVE')`
  ).get(signal.symbol, signal.direction);

  if (existing) {
    // Update dynamic fields only. Entry zone/ideal are locked at first scan
    // (must not repaint when a later scan re-computes a different OTE zone);
    // sl/tp are backfilled if missing via COALESCE in updateSignal.
    stmts.updateSignal.run({
      id:             existing.id,
      status:         signal.status,
      grade:          signal.grade,
      confidence_pct: signal.pct,
      reasoning:      signal.reasoning,
      is_new:       0,
      sl:           signal.sl ?? null,
      tp1:          signal.targets?.[0] ?? null,
      tp2:          signal.targets?.[1] ?? null
    });
  } else {
    registerTrade({
      id:         signal.id,
      instrument: signal.symbol,
      timeframe:  signal.timeframe,
      direction:  signal.direction,
      entry:      signal.entry,
      sl:         signal.sl,
      targets:    signal.targets,
      rr:         signal.rr,
      status:     signal.status,
      grade:      signal.grade,
      pct:        signal.pct,
      reasoning:  signal.reasoning,
      strategy:   signal.strategy ?? null,
      is_new:     1
    });
  }
}

/**
 * Update trade status. Used by tradeTracker when price hits SL or TP.
 * Pass closePrice (the price at closure) for SUCCESS/FAILED trades so PnL is exact.
 */
export function updateTradeStatus(id, status, closePrice = null, entryPrice = null, newSl = null) {
  if (status === 'PARTIAL') {
    // Partial-close: trade stays open, SL moves to breakeven (passed as newSl).
    // 70% of position closed at TP1; remaining 30% trails to TP2 with BE stop.
    db.prepare(`UPDATE trades SET status = 'PARTIAL', sl = @sl WHERE id = @id`).run({ id, sl: newSl });
    return;
  }
  stmts.updateStatus.run({
    id,
    status,
    closed_at: (status === 'SUCCESS' || status === 'FAILED') ? new Date().toISOString() : null,
    close_price: (status === 'SUCCESS' || status === 'FAILED') ? closePrice : null,
    entry_price: (status === 'ACTIVE') ? entryPrice : null
  });
}

// Latch a PENDING trade as zone-entered (PENDING→ACTIVE, entered_zone=1).
// Safe to call repeatedly; only affects PENDING rows. Records the price that
// actually entered the zone so future R-multiple / backtest math is possible.
export function markEnteredZone(id, entryPrice = null) {
  return stmts.markEnteredZone.run({ id, entry_price: entryPrice });
}

/**
 * Backfill missing execution levels (sl / entry zone / tp) on an existing trade.
 * Used to repair scans that registered a trade without an SL (older bug) so the
 * tracker can monitor it. Only sets fields that are currently NULL.
 */
export function updateTradeLevels(id, levels) {
  db.prepare(`
    UPDATE trades SET
      sl = @sl,
      entry_low = @entry_low,
      entry_high = @entry_high,
      tp1 = @tp1,
      tp2 = @tp2
    WHERE id = @id
  `).run({
    id,
    sl: levels.sl ?? null,
    entry_low: levels.entry_low ?? null,
    entry_high: levels.entry_high ?? null,
    tp1: levels.tp1 ?? null,
    tp2: levels.tp2 ?? null
  });
}

/**
 * Remove only PENDING signals for a given instrument (called when a setup is invalidated).
 * ACTIVE trades are NEVER deleted here — they are being monitored and deleting them
 * would silently kill a live trade if another symbol's scan re-runs.
 */
export function removeSignalByInstrument(instrument, direction = null) {
  // Only remove PENDING signals (never ACTIVE — a live position must survive a rescan).
  // If a direction is given, scope the delete to that direction only (so a new
  // SHORT scan does NOT wipe an existing LONG setup of the same symbol).
  let query = `DELETE FROM trades WHERE instrument = ? AND status = 'PENDING'`;
  const params = [instrument];
  if (direction) { query += ` AND direction = ?`; params.push(direction); }
  const count = db.prepare(
    `SELECT COUNT(*) as c FROM trades WHERE instrument = ? AND status = 'PENDING'${direction ? ` AND direction = ?` : ''}`
  ).get(...params);
  if (count?.c > 0) {
    db.prepare(query).run(...params);
    dbLog.info({ instrument, direction: direction || 'ALL' }, 'Removed PENDING signal(s) (ACTIVE trades preserved)');
  }
}

/**
 * Record a price sample for an active trade. Prunes to last 50 entries.
 */
export function recordPrice(tradeId, price) {
  stmts.insertPrice.run({ trade_id: tradeId, price, sampled_at: new Date().toISOString() });
  stmts.prunePrice.run({ trade_id: tradeId });
}

/**
 * Save an AI post-mortem lesson and attach a summary back to the trade row.
 */
export function saveLesson(trade, analysis) {
  stmts.insertLesson.run({
    trade_id:       trade.id,
    instrument:     trade.instrument,
    direction:      trade.direction,
    failure_reason: analysis.failureReason,
    lesson:         analysis.lesson,
    exit_price:     analysis.exitPrice ?? null,
    realized_r:     analysis.realizedR ?? null,
    created_at:     new Date().toISOString()
  });
  // Attach lesson summary to the trade row (stored as JSON in indicator_snapshot extension)
  const existing = stmts.getById.get(trade.id);
  if (existing) {
    let snap = [];
    try { snap = JSON.parse(existing.indicator_snapshot || '[]'); } catch {}
    snap.push(`LESSON: ${analysis.failureReason} → ${analysis.lesson}`);
    stmts.attachLessonToTrade.run({ id: trade.id, indicator_snapshot: JSON.stringify(snap) });
  }
  dbLog.info({ tradeId: trade.id, instrument: trade.instrument, direction: trade.direction, lesson: analysis.lesson }, 'Lesson saved');
}

/**
 * Mark the isNew flag as seen (called 5s after serving to frontend).
 */
export function clearIsNew(id) {
  stmts.clearIsNew.run({ id });
}

// ─────────────────────────────────────────────
// READ HELPERS
// ─────────────────────────────────────────────

/** Returns all ACTIVE/PENDING trades (used by scanner + tracker). */
export function getActiveTrades() {
  return stmts.getActivePending.all().map(hydrate);
}

/** Returns a trade by ID. */
export function getTradeById(id) {
  const row = stmts.getById.get(id);
  return row ? hydrate(row) : null;
}

/** Returns all trades (for /api/history). */
export function getAllTrades() {
  const rows = stmts.getAll.all();
  return rows.map(row => {
    const hydrated = hydrate(row);
    // Attach recorded price samples so the frontend can compute live/closed PnL.
    const samples = stmts.getPriceHistory.all(row.id);
    hydrated.historyPrices = samples.map(s => ({ price: s.price, sampledAt: s.sampled_at }));
    // Realized / live R-multiple (risk-normalized outcome).
    hydrated.rMultiple = computeRMultiple(row, samples);
    return hydrated;
  });
}

// ─────────────────────────────────────────────
// DIRECTIONAL EDGE — live win-rate per direction
// Used to bias the AI gate (e.g. require stronger confluence for the
// weaker direction). Computed cheaply from the trades table.
// ─────────────────────────────────────────────
export function getDirectionalEdge() {
  const rows = db.prepare(`
    SELECT direction, status, close_price, entry_price, sl
    FROM trades
    WHERE status IN ('SUCCESS', 'FAILED')
  `).all();

  const dirs = { LONG: { wins: 0, losses: 0 }, SHORT: { wins: 0, losses: 0 } };
  for (const r of rows) {
    const d = dirs[r.direction];
    if (!d) continue;
    if (r.status === 'SUCCESS') d.wins++; else d.losses++;
  }

  const edge = {};
  for (const [dir, v] of Object.entries(dirs)) {
    const total = v.wins + v.losses;
    edge[dir] = {
      wins: v.wins,
      losses: v.losses,
      total,
      winRate: total > 0 ? parseFloat(((v.wins / total) * 100).toFixed(1)) : null
    };
  }
  return edge;
}

/**
 * ASSET EDGE & PLAYBOOK
 * Calculates historical performance metrics for a specific asset and direction.
 * Returns: { wins, losses, total, winRate, avgR, isFavorable, isUnfavorable, bonus }
 */
export function getAssetEdge(instrument, direction = null) {
  const sym = (instrument || '').toUpperCase().trim();
  let query = `
    SELECT direction, status, close_price, entry_price, sl
    FROM trades
    WHERE UPPER(instrument) = ? AND status IN ('SUCCESS', 'FAILED')
  `;
  const params = [sym];
  if (direction) {
    query += ` AND direction = ?`;
    params.push(direction.toUpperCase());
  }

  const rows = db.prepare(query).all(...params);
  let wins = 0;
  let losses = 0;
  let totalR = 0;

  for (const r of rows) {
    if (r.status === 'SUCCESS') wins++;
    else losses++;

    if (r.entry_price && r.sl) {
      const risk = Math.abs(r.entry_price - r.sl);
      if (risk > 0 && r.close_price) {
        const pnl = r.direction === 'LONG' ? (r.close_price - r.entry_price) : (r.entry_price - r.close_price);
        totalR += (pnl / risk);
      }
    }
  }

  const total = wins + losses;
  const winRate = total > 0 ? parseFloat(((wins / total) * 100).toFixed(1)) : null;
  const avgR = total > 0 ? parseFloat((totalR / total).toFixed(2)) : 0;

  return {
    instrument: sym,
    direction: direction ? direction.toUpperCase() : 'ALL',
    wins,
    losses,
    total,
    winRate,
    avgR,
    isFavorable: total >= 3 && winRate >= 65,
    isUnfavorable: total >= 3 && winRate < 40,
    bonus: (total >= 3 && winRate >= 70) ? 8 : (total >= 3 && winRate >= 60) ? 4 : (total >= 3 && winRate < 40) ? -10 : 0
  };
}

/** Returns price history array for a given trade. */
export function getPriceHistory(tradeId) {
  return stmts.getPriceHistory.all(tradeId);
}

/**
 * Returns the last 3 lessons for a given instrument+direction pair.
 * Used by aiProvider.js to inject into the prompt.
 */
export function getLessonsFor(instrument, direction) {
  return stmts.getLessons.all(instrument.toUpperCase(), direction);
}

/** Returns true if the same instrument+direction already had a post-mortem in the last 24h. */
export function hasRecentLesson(instrument, direction) {
  return !!stmts.getRecentLessonSamePair.get(instrument.toUpperCase(), direction);
}

/** Returns all lessons (for diagnostics / dashboard). */
export function getAllLessons() {
  return stmts.getAllLessons.all();
}

/** Returns true if an ACTIVE trade exists for this instrument (PENDING does NOT block — it can re-scan). */
export function hasActiveTrade(instrument) {
  const row = db.prepare(
    `SELECT id FROM trades WHERE instrument = ? AND status = 'ACTIVE' LIMIT 1`
  ).get(instrument);
  return !!row;
}

// ─────────────────────────────────────────────
// STALE PENDING EXPIRY
// A PENDING setup that never entered its zone within PENDING_EXPIRY_HOURS is
// dead (market moved away, or it was a false signal). Expire it so the scanner
// can re-scan the symbol and produce a fresh setup.
// ─────────────────────────────────────────────
export const PENDING_EXPIRY_HOURS = 24;

export function expireStalePending() {
  const cutoff = new Date(Date.now() - PENDING_EXPIRY_HOURS * 60 * 60 * 1000).toISOString();
  const res = db.prepare(
    `DELETE FROM trades WHERE status = 'PENDING' AND created_at < ?`
  ).run(cutoff);
  if (res.changes > 0) {
    dbLog.info({ expired: res.changes, olderThan: cutoff }, 'Expired stale PENDING setups');
  }
  return res.changes;
}

// ─────────────────────────────────────────────
// STALE ACTIVE EXPIRY
// An ACTIVE trade that never hit TP/SL within ACTIVE_EXPIRY_HOURS is stale
// (e.g. a Forex position over a weekend closure, or a setup the market simply
// never resolved). Expire it as 'EXPIRED' (NOT deleted — we keep the history)
// so the scanner can produce a fresh setup for that symbol.
// ─────────────────────────────────────────────
export const ACTIVE_EXPIRY_HOURS = 36; // Reduced from 96h: long-running stale ACTIVE trades
                                        // block the scanner from re-scanning the symbol.
                                        // 36h is enough for a valid 1h-chart trade to play out.

export function expireStaleActive() {
  const cutoff = new Date(Date.now() - ACTIVE_EXPIRY_HOURS * 60 * 60 * 1000).toISOString();
  // First collect the trades that WILL expire (so the caller can run a post-mortem)
  const expiring = db.prepare(
    `SELECT * FROM trades WHERE status = 'ACTIVE' AND created_at < ?`
  ).all(cutoff);
  const res = db.prepare(
    `UPDATE trades SET status = 'EXPIRED', closed_at = ? WHERE status = 'ACTIVE' AND created_at < ?`
  ).run(new Date().toISOString(), cutoff);
  if (res.changes > 0) {
    dbLog.info({ expired: res.changes, olderThan: cutoff }, 'Expired stale ACTIVE trades');
  }
  return expiring; // array of trade rows that just expired (empty if none)
}

// ─────────────────────────────────────────────
// STALE NEEDS_CONFIRMATION EXPIRY
// A PENDING setup with [NEEDS_CONFIRMATION] tag that never gets upgraded
// after 12h is considered a deadlock — the weak conditions that caused it
// likely haven't improved. Expire it so the scanner can re-scan fresh.
// ─────────────────────────────────────────────
export const NEEDS_CONFIRMATION_EXPIRY_HOURS = 12;

export function expireStaleNeedsConfirmation() {
  const cutoff = new Date(Date.now() - NEEDS_CONFIRMATION_EXPIRY_HOURS * 60 * 60 * 1000).toISOString();
  const res = db.prepare(
    `DELETE FROM trades WHERE status = 'PENDING' AND reasoning LIKE '%[NEEDS_CONFIRMATION]%' AND created_at < ?`
  ).run(cutoff);
  if (res.changes > 0) {
    dbLog.info({ expired: res.changes, olderThan: cutoff }, 'Expired stale NEEDS_CONFIRMATION PENDING setups');
  }
  return res.changes;
}

// ─────────────────────────────────────────────
// R-MULTIPLE — realized risk multiple for a trade
// R = (exit - entry) / risk, where risk = |entry - sl|
// For LONG:  exit above entry → +R. For SHORT: exit below entry → +R.
// closedPrice is preferred; falls back to the latest recorded price sample.
// Returns null when data is insufficient (caller shows "—").
// ─────────────────────────────────────────────
function computeRMultiple(row, samples) {
  const entry = row.entry_price ?? row.entryPrice;
  const sl = row.sl;
  const tp1 = row.tp1;
  const tp2 = row.tp2;
  const direction = row.direction || 'LONG';
  const status = row.status;
  const rr = typeof row.rr === 'number' && row.rr > 0 ? row.rr : 2.05;

  if (entry == null) return null;

  // 1. FAILED trade (hit Stop Loss) -> exactly -1.00R
  if (status === 'FAILED') return -1.00;

  // Determine the true initial risk distance
  let initialRisk = 0;
  if (tp1 != null && entry != null && tp1 !== entry) {
    initialRisk = Math.abs(tp1 - entry) / rr;
  } else if (sl != null && sl !== entry) {
    initialRisk = Math.abs(entry - sl);
  }

  // 2. PARTIAL trade (70% banked at TP1, SL moved to Break-Even for 30% runner)
  if (status === 'PARTIAL') {
    return parseFloat((0.70 * rr).toFixed(2));
  }

  // 3. SUCCESS trade (completed win)
  if (status === 'SUCCESS') {
    let exit = row.close_price;
    if (exit == null && Array.isArray(samples) && samples.length > 0) {
      exit = samples[samples.length - 1].price;
    }
    
    // If exit price reached TP2
    if (exit != null && tp2 != null && Math.abs(exit - tp2) / tp2 <= 0.005) {
      return parseFloat((0.70 * rr + 0.30 * (rr * 1.5)).toFixed(2));
    }
    // If exit price reached TP1 or closed after TP1 bank
    if (exit != null && tp1 != null && (direction === 'LONG' ? exit >= tp1 * 0.998 : exit <= tp1 * 1.002)) {
      return parseFloat(rr.toFixed(2));
    }
    
    // If we have an exact exit and initial risk:
    if (exit != null && initialRisk > 0) {
      const realizedPnl = direction === 'SHORT' ? (entry - exit) : (exit - entry);
      const calculatedR = realizedPnl / initialRisk;
      if (calculatedR > 0) {
        return parseFloat(calculatedR.toFixed(2));
      }
    }
    
    // Default SUCCESS floor is at least the 70% TP1 bank or full RR
    return parseFloat((0.70 * rr).toFixed(2));
  }

  // 4. ACTIVE / PENDING trades (live open R)
  if (initialRisk > 0) {
    let currentPrice = row.close_price;
    if (currentPrice == null && Array.isArray(samples) && samples.length > 0) {
      currentPrice = samples[samples.length - 1].price;
    }
    if (currentPrice != null) {
      const openPnl = direction === 'SHORT' ? (entry - currentPrice) : (currentPrice - entry);
      return parseFloat((openPnl / initialRisk).toFixed(2));
    }
  }

  return null;
}

// ─────────────────────────────────────────────
// HYDRATION — DB row → JS object
// ─────────────────────────────────────────────
function hydrate(row) {
  return {
    id:          row.id,
    instrument:  row.instrument,
    timeframe:   row.timeframe,
    direction:   row.direction,
    // Reconstitute entry object (compatible with scanner + tracker)
    entry: {
      low:   row.entry_low,
      high:  row.entry_high,
      price: row.entry_price
    },
    entryLow:    row.entry_low,
    entryHigh:   row.entry_high,
    entryPrice:  row.entry_price,
    sl:          row.sl,
    tp1:         row.tp1,
    tp2:         row.tp2,
    targets:     [row.tp1, row.tp2].filter(v => v != null),
    rr:          row.rr,
    status:      row.status,
    enteredZone: row.entered_zone,
    grade:       row.grade,
    confidencePct: row.confidence_pct,
    pct:         row.confidence_pct,
    reasoning:   row.reasoning,
    indicators:  (() => { try { return JSON.parse(row.indicator_snapshot || '[]'); } catch { return []; } })(),
    indicatorSnapshot: (() => { try { return JSON.parse(row.indicator_snapshot || '[]'); } catch { return []; } })(),
    strategy:    row.strategy,
    isNew:       row.is_new === 1,
    symbol:      row.instrument,  // scanner compat alias
    timestamp:   row.created_at,
    createdAt:   row.created_at,
    closedAt:    row.closed_at,
    closePrice:  row.close_price ?? null,
    lessonsLearned: null          // populated on demand via getLessonsFor()
  };
}

// ─────────────────────────────────────────────
// MIGRATION — import legacy JSON data once
// ─────────────────────────────────────────────
export function migrateFromJSON() {
  const SIGNALS_PATH = path.join(DATA_DIR, 'signals.json');
  const HISTORY_PATH = path.join(DATA_DIR, 'history.json');
  const LESSONS_PATH = path.join(DATA_DIR, 'lessons.json');
  const SEED_PATH    = path.join(DATA_DIR, 'seed_backup.json');

  const existingCount = db.prepare('SELECT COUNT(*) as c FROM trades').get().c;
  if (existingCount > 0) {
    dbLog.info({ trades: existingCount }, 'Migration skipped — DB already populated');
    return;
  }

  let migrated = 0;

  // Import seed_backup.json if available
  if (fs.existsSync(SEED_PATH)) {
    try {
      const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
      if (Array.isArray(seed.trades)) {
        const insertSeed = db.transaction((trades) => {
          for (const t of trades) {
            try {
              stmts.insertTrade.run({
                id:                t.id,
                instrument:        t.instrument || t.symbol,
                timeframe:         t.timeframe ?? null,
                direction:         t.direction ?? null,
                entry_low:         t.entry?.low ?? t.entryLow ?? null,
                entry_high:        t.entry?.high ?? t.entryHigh ?? null,
                entry_price:       t.entry?.price ?? t.entryPrice ?? null,
                sl:                t.sl ?? null,
                tp1:               t.tp1 ?? t.targets?.[0] ?? null,
                tp2:               t.tp2 ?? t.targets?.[1] ?? null,
                rr:                t.rr ?? null,
                status:            t.status ?? 'PENDING',
                grade:             t.grade ?? null,
                confidence_pct:    t.confidencePct ?? t.pct ?? null,
                reasoning:         t.reasoning ?? null,
                indicator_snapshot: JSON.stringify(t.indicatorSnapshot || t.indicators || []),
                strategy:          t.strategy ?? null,
                is_new:            t.isNew ? 1 : 0,
                created_at:        t.createdAt ?? t.timestamp ?? new Date().toISOString()
              });
              if (t.closedAt) {
                stmts.updateTradeClosed.run({
                  status: t.status,
                  close_price: t.closePrice ?? null,
                  closed_at: t.closedAt,
                  id: t.id
                });
              }
              if (t.enteredZone) {
                stmts.markEnteredZone.run({ id: t.id });
              }
              migrated++;
            } catch {}
          }
        });
        insertSeed(seed.trades);
      }

      if (Array.isArray(seed.lessons)) {
        const insertLessons = db.transaction((lessons) => {
          for (const l of lessons) {
            try {
              stmts.insertLesson.run({
                trade_id:       l.tradeId ?? l.trade_id ?? 'seed',
                instrument:     l.instrument ?? 'UNKNOWN',
                direction:      l.direction ?? 'LONG',
                failure_reason: l.failureReason ?? l.failure_reason ?? '',
                lesson:         l.lesson ?? '',
                created_at:     l.createdAt ?? l.created_at ?? new Date().toISOString()
              });
            } catch {}
          }
        });
        insertLessons(seed.lessons);
      }
      dbLog.info({ count: migrated }, 'Successfully loaded trades & lessons from seed_backup.json');
    } catch (e) {
      dbLog.error({ err: e.message }, 'Failed to import seed_backup.json');
    }
  }

  // Import history.json
  if (fs.existsSync(HISTORY_PATH)) {
    try {
      const history = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
      const insertMany = db.transaction((trades) => {
        for (const t of trades) {
          try {
            stmts.insertTrade.run({
              id:                t.id,
              instrument:        t.instrument,
              timeframe:         t.timeframe ?? null,
              direction:         t.direction ?? null,
              entry_low:         t.entryLow ?? null,
              entry_high:        t.entryHigh ?? null,
              entry_price:       t.entryPrice ?? null,
              sl:                t.sl ?? null,
              tp1:               t.tp1 ?? null,
              tp2:               t.tp2 ?? null,
              rr:                t.rr ?? null,
              status:            t.status ?? 'PENDING',
              grade:             t.grade ?? null,
              confidence_pct:    t.confidencePct ?? null,
              reasoning:         t.reasoning ?? null,
              indicator_snapshot: JSON.stringify(t.indicatorSnapshot || []),
              strategy:          t.strategy ?? null,
              is_new:            0,
              created_at:        t.timestamp ?? new Date().toISOString()
            });
            migrated++;
          } catch {}
        }
      });
      insertMany(history);
      dbLog.info({ count: migrated }, 'Migrated trades from history.json');
    } catch (e) {
      dbLog.error({ err: e.message }, 'Failed to migrate history.json');
    }
  }

  // Import signals.json (only those not already in history)
  if (fs.existsSync(SIGNALS_PATH)) {
    try {
      const signals = JSON.parse(fs.readFileSync(SIGNALS_PATH, 'utf8'));
      const insertSignals = db.transaction((sigs) => {
        for (const s of sigs) {
          try {
            stmts.insertTrade.run({
              id:                s.id,
              instrument:        s.symbol,
              timeframe:         s.timeframe ?? null,
              direction:         s.direction ?? null,
              entry_low:         s.entry?.low ?? null,
              entry_high:        s.entry?.high ?? null,
              entry_price:       s.entry?.price ?? null,
              sl:                s.sl ?? null,
              tp1:               s.targets?.[0] ?? null,
              tp2:               s.targets?.[1] ?? null,
              rr:                s.rr ?? null,
              status:            s.status ?? 'PENDING',
              grade:             s.grade ?? null,
              confidence_pct:    s.pct ?? null,
              reasoning:         s.reasoning ?? null,
              indicator_snapshot: '[]',
              strategy:          null,
              is_new:            0,
              created_at:        s.timestamp ?? new Date().toISOString()
            });
            migrated++;
          } catch {}
        }
      });
      insertSignals(signals);
    } catch {}
  }

  // Import lessons.json
  if (fs.existsSync(LESSONS_PATH)) {
    try {
      const lessonsDb = JSON.parse(fs.readFileSync(LESSONS_PATH, 'utf8'));
      const insertLessons = db.transaction((entries) => {
        for (const [key, arr] of entries) {
          const [instrument, direction] = key.split('_');
          for (const l of arr) {
            try {
              stmts.insertLesson.run({
                trade_id:       l.tradeId ?? 'legacy',
                instrument:     instrument ?? 'UNKNOWN',
                direction:      direction ?? 'LONG',
                failure_reason: l.failureReason,
                lesson:         l.lesson,
                created_at:     l.timestamp ?? new Date().toISOString()
              });
            } catch {}
          }
        }
      });
      insertLessons(Object.entries(lessonsDb));
      dbLog.info('Migrated lessons from lessons.json');
    } catch (e) {
      dbLog.error({ err: e.message }, 'Failed to migrate lessons.json');
    }
  }

  dbLog.info({ totalMigrated: migrated }, 'Migration complete');
}

// ── Alerts (read helpers for Supabase parity) ──
export async function getAlerts({ unreadOnly = false } = {}) {
  let rows = db.prepare('SELECT * FROM alerts ORDER BY created_at DESC LIMIT 50').all();
  if (unreadOnly) rows = rows.filter(a => !a.seen);
  return rows;
}

export async function markAlertsSeen() {
  db.prepare('UPDATE alerts SET seen = 1 WHERE seen = 0').run();
}
