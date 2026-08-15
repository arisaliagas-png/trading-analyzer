// ─────────────────────────────────────────────
// Alerts cron — scans for closed FAILED/SUCCESS trades every 5 min
// and writes them to the `alerts` table.
// Runs as a standalone script: node alerts_cron.js
// ─────────────────────────────────────────────
import Database from 'better-sqlite3';

const db = new Database('./data/aris.db');

// Migration: add trade_id column if missing (safe on existing DBs)
try {
  db.exec(`ALTER TABLE alerts ADD COLUMN trade_id TEXT`);
} catch (e) {
  if (!/duplicate column/i.test(e.message)) throw e;
}

// ── Ensure the schema exists (idempotent) ──
db.exec(`
  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    symbol TEXT,
    direction TEXT,
    status TEXT,
    r_multiple REAL,
    message TEXT,
    trade_id TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    seen INTEGER DEFAULT 0
  )
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at DESC)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_alerts_seen ON alerts(seen)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_alerts_trade ON alerts(trade_id)`);

/**
 * R-Multiple computation — matches Pine backtest logic:
 * - LONG SUCCESS: (close_price - entry_price) / ABS(entry_price - SL)
 * - SHORT SUCCESS: (entry_price - close_price) / ABS(entry_price - SL)
 * - FAILED: -1.0 (SL hit)
 * NOTE: Uses 'closed_at' (not 'updated_at') as the filter column.
 */
const closed = db.prepare(`
  SELECT t.id AS trade_id, t.instrument, t.direction, t.status,
         t.close_price, t.entry_price, t.sl,
         t.closed_at, t.created_at
  FROM trades t
  WHERE t.status IN ('SUCCESS', 'FAILED')
    AND t.closed_at IS NOT NULL
    AND t.closed_at > datetime('now', '-5 minutes')
  ORDER BY t.created_at DESC
`).all();

let created = 0;
// Clean any existing alerts that were created with null close_price (data error)
db.exec(`DELETE FROM alerts WHERE r_multiple IS NULL OR message IS NULL`);

for (const t of closed) {
  // Skip if close_price is null (trade data incomplete)
  if (t.close_price === null || t.close_price === undefined) {
    console.log(`[${new Date().toISOString()}] Skipped ${t.instrument} — close_price is null`);
    continue;
  }

  const r = t.status === 'SUCCESS'
    ? (t.direction === 'LONG'
        ? (t.close_price - t.entry_price) / Math.abs(t.entry_price - t.sl)
        : (t.entry_price - t.close_price) / Math.abs(t.entry_price - t.sl))
    : -1.0;

  const msg = `${t.instrument} ${t.direction} → ${t.status} (${r > 0 ? '+' : ''}${r.toFixed(2)}R)`;

  // dedup: skip if an alert for this EXACT trade already exists (by trade_id)
  const existing = db.prepare(
    `SELECT 1 FROM alerts WHERE trade_id = ?`
  ).get(t.trade_id);
  if (existing) continue;

  db.prepare(`
    INSERT INTO alerts (type, symbol, direction, status, r_multiple, message, trade_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    'trade_closed',
    t.instrument,
    t.direction,
    t.status,
    r,
    msg,
    t.trade_id
  );
  created++;
}

if (created > 0) {
  console.log(`[${new Date().toISOString()}] Alerts created: ${created}`);
} else {
  console.log(`[${new Date().toISOString()}] No new closed trades (last 5 min)`);
}
db.close();
