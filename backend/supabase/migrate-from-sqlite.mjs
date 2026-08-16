// One-off data migration: SQLite (aris.db) → Supabase.
// Batched inserts for speed. RLS must be disabled on the tables (or policies
// added) or inserts will be rejected — run the DISABLE RLS SQL first.
import 'dotenv/config';
import Database from 'better-sqlite3';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'data', 'aris.db');

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;
if (!URL || !KEY) { console.error('Missing SUPABASE_URL / SUPABASE_ANON_KEY in .env'); process.exit(1); }

const sqlite = new Database(DB_PATH, { readonly: true });
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

const BATCH = 200;

async function insertBatched(table, rows) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { error } = await sb.from(table).insert(chunk);
    if (error) {
      // fall back to per-row (some may already exist)
      for (const r of chunk) {
        const { error: e2 } = await sb.from(table).insert(r);
        if (e2 && !/duplicate|unique|row-level/i.test(e2.message)) console.error(table, 'row', e2.message);
      }
    }
  }
}

async function main() {
  const trades = sqlite.prepare('SELECT * FROM trades').all().map(t => ({
    id: t.id, instrument: t.instrument, timeframe: t.timeframe, direction: t.direction,
    entry_low: t.entry_low, entry_high: t.entry_high, entry_price: t.entry_price,
    sl: t.sl, tp1: t.tp1, tp2: t.tp2, rr: t.rr, status: t.status, grade: t.grade,
    confidence_pct: t.confidence_pct, reasoning: t.reasoning, indicator_snapshot: t.indicator_snapshot,
    strategy: t.strategy, is_new: t.is_new, created_at: t.created_at,
    closed_at: t.closed_at, close_price: t.close_price, entered_zone: t.entered_zone
  }));
  await insertBatched('trades', trades);
  console.log(`trades: ${trades.length} done`);

  const lessons = sqlite.prepare('SELECT * FROM lessons').all().map(l => ({
    trade_id: l.trade_id, instrument: l.instrument, direction: l.direction,
    failure_reason: l.failure_reason, lesson: l.lesson, created_at: l.created_at,
    exit_price: l.exit_price, realized_r: l.realized_r
  }));
  await insertBatched('lessons', lessons);
  console.log(`lessons: ${lessons.length} done`);

  const alerts = sqlite.prepare('SELECT * FROM alerts').all().map(a => ({
    type: a.type, symbol: a.symbol, direction: a.direction, status: a.status,
    r_multiple: a.r_multiple, message: a.message, created_at: a.created_at,
    seen: a.seen, trade_id: a.trade_id
  }));
  await insertBatched('alerts', alerts);
  console.log(`alerts: ${alerts.length} done`);

  const ph = sqlite.prepare('SELECT * FROM price_history').all().map(p => ({
    trade_id: p.trade_id, price: p.price, sampled_at: p.sampled_at
  }));
  await insertBatched('price_history', ph);
  console.log(`price_history: ${ph.length} done`);

  console.log('Migration complete.');
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
