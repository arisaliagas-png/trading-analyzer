// ─────────────────────────────────────────────
// db.js — FACADE / single source of truth
// Picks the storage backend at load time:
//   - if SUPABASE_URL is set  → Supabase (PostgreSQL, cloud)
//   - otherwise                → SQLite (local file, default)
// All functions are ASYNC (return Promises) regardless of backend, so the
// rest of the app calls them identically with `await`.
// ─────────────────────────────────────────────

const USE_SUPABASE = !!process.env.SUPABASE_URL;

// Only load the Supabase adapter when actually needed (keeps sqlite-only
// deployments from requiring @supabase/supabase-js to be installed).
let backend;
if (USE_SUPABASE) {
  backend = await import('./dbSupabase.js');
} else {
  backend = await import('./dbSqlite.js');
}

// Expose backend selection for diagnostics
export const DB_MODE = USE_SUPABASE ? 'supabase' : 'sqlite';

// Re-export the PENDING/ACTIVE expiry constants (used by tradeTracker)
export const PENDING_EXPIRY_HOURS = backend.PENDING_EXPIRY_HOURS;
export const ACTIVE_EXPIRY_HOURS = backend.ACTIVE_EXPIRY_HOURS;

// Re-export every public function from the chosen backend.
export const registerTrade        = backend.registerTrade;
export const upsertSignal         = backend.upsertSignal;
export const updateTradeStatus    = backend.updateTradeStatus;
export const markEnteredZone      = backend.markEnteredZone;
export const updateTradeLevels    = backend.updateTradeLevels;
export const removeSignalByInstrument = backend.removeSignalByInstrument;
export const recordPrice          = backend.recordPrice;
export const saveLesson           = backend.saveLesson;
export const clearIsNew           = backend.clearIsNew;
export const getActiveTrades      = backend.getActiveTrades;
export const getTradeById         = backend.getTradeById;
export const getAllTrades         = backend.getAllTrades;
export const getByInstrument      = backend.getByInstrument;
export const getDirectionalEdge   = backend.getDirectionalEdge;
export const getPriceHistory      = backend.getPriceHistory;
export const getLessonsFor        = backend.getLessonsFor;
export const hasRecentLesson      = backend.hasRecentLesson;
export const getAllLessons        = backend.getAllLessons;
export const getAlerts            = backend.getAlerts;
export const markAlertsSeen       = backend.markAlertsSeen;
export const hasActiveTrade       = backend.hasActiveTrade;
export const expireStalePending   = backend.expireStalePending;
export const expireStaleActive    = backend.expireStaleActive;
export const migrateFromJSON      = backend.migrateFromJSON;

// Re-export the raw better-sqlite3 `db` object only for SQLite mode (some
// modules may still reference it). For Supabase it is undefined.
export const db = backend.db;
