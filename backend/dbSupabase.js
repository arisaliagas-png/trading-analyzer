// ─────────────────────────────────────────────
// dbSupabase.js — Supabase (PostgreSQL) adapter
// Mirrors the public API of db.js (same function names, same return shapes)
// but is ASYNC (every function returns a Promise). Selected automatically by
// db.js when SUPABASE_URL is present in the environment.
//
// Tables must already exist (run supabase/migrations/001_init.sql in the
// Supabase SQL Editor first).
// ─────────────────────────────────────────────
import { dbLog } from './logger.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Lazily create the client (dotenv loads after imports; package import is
// deferred so sqlite-only deployments don't need @supabase/supabase-js installed).
let _client = null;
async function client() {
  if (!_client) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set for Supabase mode');
    }
    const { createClient } = await import('@supabase/supabase-js');
    _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false }
    });
  }
  return _client;
}

export const PENDING_EXPIRY_HOURS = 72;
export const ACTIVE_EXPIRY_HOURS = 96;

// ── hydration (DB row → JS object) ───────────────────────────────────────────
function hydrate(row) {
  if (!row) return null;
  return {
    id:          row.id,
    instrument:  row.instrument,
    timeframe:   row.timeframe,
    direction:   row.direction,
    entry: { low: row.entry_low, high: row.entry_high, price: row.entry_price },
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
    symbol:      row.instrument,
    timestamp:   row.created_at,
    createdAt:   row.created_at,
    closedAt:    row.closed_at,
    closePrice:  row.close_price ?? null,
    lessonsLearned: null
  };
}

// R-multiple (risk-normalized outcome)
function computeRMultiple(row, samples) {
  const entry = row.entry_price;
  const sl = row.sl;
  if (entry == null || sl == null) return null;
  const risk = Math.abs(entry - sl);
  if (risk === 0) return null;
  let exit = row.close_price != null ? row.close_price : null;
  if (exit == null && Array.isArray(samples) && samples.length > 0) {
    exit = samples[samples.length - 1].price;
  }
  if (exit == null) return null;
  const r = (row.direction === 'SHORT') ? (entry - exit) / risk : (exit - entry) / risk;
  return parseFloat(r.toFixed(2));
}

// ── writes ───────────────────────────────────────────────────────────────────
export async function registerTrade(setup) {
  if (!setup.id || !setup.instrument) return;
  if (!setup.entry || setup.entry.price === 0) return;
  const direction = setup.direction ? setup.direction :
    setup.bias === 'bullish' ? 'LONG' : setup.bias === 'bearish' ? 'SHORT' : null;
  if (!direction) return;
  const { error } = await (await client()).from('trades').upsert({
    id: setup.id, instrument: setup.instrument, timeframe: setup.timeframe || null,
    direction, entry_low: setup.entry.low ?? null, entry_high: setup.entry.high ?? null,
    entry_price: setup.entry.price, sl: setup.sl ?? null, tp1: setup.targets?.[0] ?? null,
    tp2: setup.targets?.[1] ?? null, rr: setup.rr ?? null, status: setup.status || 'PENDING',
    grade: setup.grade ?? null, confidence_pct: setup.pct ?? null, reasoning: setup.reasoning ?? null,
    indicator_snapshot: JSON.stringify(setup.indicators || []), strategy: setup.strategy ?? null,
    is_new: 1, created_at: new Date().toISOString()
  }, { onConflict: 'id' });
  if (error) dbLog.error({ err: error.message }, 'Supabase registerTrade failed');
  else {
    // Ensure grade/pct are persisted — upsert sometimes drops them on conflict
    const { error: gErr } = await (await client()).from('trades')
      .update({ grade: setup.grade ?? null, confidence_pct: setup.pct ?? null })
      .eq('id', setup.id);
    if (gErr) dbLog.error({ err: gErr.message }, 'Supabase grade update failed');
    dbLog.info({ id: setup.id, instrument: setup.instrument, direction }, 'Trade registered (Supabase)');
  }
}

export async function upsertSignal(signal) {
  const { data: existing } = await (await client()).from('trades')
    .select('*').eq('instrument', signal.symbol).eq('direction', signal.direction)
    .in('status', ['PENDING', 'ACTIVE']).limit(1).maybeSingle();
  if (existing) {
    // Migrate legacy Date.now()-based id → deterministic symbol_direction id
    // AND write grade/pct in the same operation, so no null-grade record lingers.
    const { error } = await (await client()).from('trades').update({
      id:          signal.id,
      status:      signal.status, grade: signal.grade, confidence_pct: signal.pct,
      reasoning:   signal.reasoning, is_new: existing.is_new,
      sl: signal.sl ?? null, entry_low: signal.entry?.low ?? null, entry_high: signal.entry?.high ?? null,
      tp1: signal.targets?.[0] ?? null, tp2: signal.targets?.[1] ?? null
    }).eq('id', existing.id);
    if (error) dbLog.error({ err: error.message }, 'Supabase upsertSignal failed');
  } else {
    await registerTrade({
      id: signal.id, instrument: signal.symbol, timeframe: signal.timeframe, direction: signal.direction,
      entry: signal.entry, sl: signal.sl, targets: signal.targets, rr: signal.rr, status: signal.status,
      grade: signal.grade, pct: signal.pct, reasoning: signal.reasoning, strategy: signal.strategy ?? null, is_new: 1
    });
  }
}

export async function updateTradeStatus(id, status, closePrice = null, entryPrice = null) {
  const closed_at = (status === 'SUCCESS' || status === 'FAILED') ? new Date().toISOString() : null;
  const { error } = await (await client()).from('trades').update({
    status,
    closed_at,
    close_price: (status === 'SUCCESS' || status === 'FAILED') ? closePrice : undefined,
    entry_price: (status === 'ACTIVE') ? entryPrice : undefined
  }).eq('id', id);
  if (error) dbLog.error({ err: error.message }, 'Supabase updateTradeStatus failed');
}

export async function markEnteredZone(id, entryPrice = null) {
  const { error } = await (await client()).from('trades').update({
    status: 'ACTIVE', entered_zone: 1, entry_price: entryPrice ?? undefined
  }).eq('id', id).eq('status', 'PENDING');
  if (error) dbLog.error({ err: error.message }, 'Supabase markEnteredZone failed');
}

export async function updateTradeLevels(id, levels) {
  const { error } = await (await client()).from('trades').update({
    sl: levels.sl ?? null, entry_low: levels.entry_low ?? null, entry_high: levels.entry_high ?? null,
    tp1: levels.tp1 ?? null, tp2: levels.tp2 ?? null
  }).eq('id', id);
  if (error) dbLog.error({ err: error.message }, 'Supabase updateTradeLevels failed');
}

export async function removeSignalByInstrument(instrument) {
  const { count, error } = await (await client()).from('trades')
    .select('*', { count: 'exact', head: true }).eq('instrument', instrument).eq('status', 'PENDING');
  if (count > 0) {
    const { error: e2 } = await (await client()).from('trades').delete().eq('instrument', instrument).eq('status', 'PENDING');
    if (!e2) dbLog.info({ instrument }, 'Removed PENDING signal (ACTIVE preserved)');
  }
  if (error) dbLog.error({ err: error.message }, 'Supabase removeSignalByInstrument failed');
}

export async function recordPrice(tradeId, price) {
  await (await client()).from('price_history').insert({ trade_id: tradeId, price, sampled_at: new Date().toISOString() });
  // prune to last 50
  const { data: all } = await (await client()).from('price_history').select('id').eq('trade_id', tradeId).order('id', { ascending: true });
  if (all && all.length > 50) {
    const idsToDelete = all.slice(0, all.length - 50).map(r => r.id);
    await (await client()).from('price_history').delete().in('id', idsToDelete);
  }
}

export async function saveLesson(trade, analysis) {
  const { error } = await (await client()).from('lessons').insert({
    trade_id: trade.id, instrument: trade.instrument, direction: trade.direction,
    failure_reason: analysis.failureReason, lesson: analysis.lesson,
    exit_price: analysis.exitPrice ?? null, realized_r: analysis.realizedR ?? null,
    created_at: new Date().toISOString()
  });
  if (error) { dbLog.error({ err: error.message }, 'Supabase saveLesson failed'); return; }
  // attach lesson summary to trade row
  const { data: existing } = await (await client()).from('trades').select('indicator_snapshot').eq('id', trade.id).maybeSingle();
  if (existing) {
    let snap = [];
    try { snap = JSON.parse(existing.indicator_snapshot || '[]'); } catch {}
    snap.push(`LESSON: ${analysis.failureReason} → ${analysis.lesson}`);
    await (await client()).from('trades').update({ indicator_snapshot: JSON.stringify(snap) }).eq('id', trade.id);
  }
  dbLog.info({ tradeId: trade.id, instrument: trade.instrument, direction: trade.direction, lesson: analysis.lesson }, 'Lesson saved (Supabase)');
}

export async function clearIsNew(id) {
  const { error } = await (await client()).from('trades').update({ is_new: 0 }).eq('id', id);
  if (error) dbLog.error({ err: error.message }, 'Supabase clearIsNew failed');
}

// ── reads ────────────────────────────────────────────────────────────────────
export async function getActiveTrades() {
  const { data, error } = await (await client()).from('trades').select('*').in('status', ['ACTIVE', 'PENDING']);
  if (error) { dbLog.error({ err: error.message }, 'Supabase getActiveTrades failed'); return []; }
  return (data || []).map(hydrate);
}

export async function getTradeById(id) {
  const { data, error } = await (await client()).from('trades').select('*').eq('id', id).maybeSingle();
  if (error) { dbLog.error({ err: error.message }, 'Supabase getTradeById failed'); return null; }
  return hydrate(data);
}

export async function getAllTrades() {
  const { data, error } = await (await client()).from('trades').select('*').order('created_at', { ascending: false });
  if (error) { dbLog.error({ err: error.message }, 'Supabase getAllTrades failed'); return []; }
  const trades = [];
  for (const row of (data || [])) {
    const hydrated = hydrate(row);
    const { data: samples } = await (await client()).from('price_history').select('price, sampled_at').eq('trade_id', row.id).order('id', { ascending: true });
    hydrated.historyPrices = (samples || []).map(s => ({ price: s.price, sampledAt: s.sampled_at }));
    hydrated.rMultiple = computeRMultiple(row, samples || []);
    trades.push(hydrated);
  }
  return trades;
}

export async function getByInstrument(instrument) {
  const { data, error } = await (await client()).from('trades').select('*').eq('instrument', instrument).order('created_at', { ascending: false });
  if (error) return [];
  return (data || []).map(hydrate);
}

export async function getDirectionalEdge() {
  const { data, error } = await (await client()).from('trades').select('direction, status, close_price, entry_price, sl').in('status', ['SUCCESS', 'FAILED']);
  if (error) return {};
  const dirs = { LONG: { wins: 0, losses: 0 }, SHORT: { wins: 0, losses: 0 } };
  for (const r of (data || [])) {
    const d = dirs[r.direction];
    if (!d) continue;
    if (r.status === 'SUCCESS') d.wins++; else d.losses++;
  }
  const edge = {};
  for (const [dir, v] of Object.entries(dirs)) {
    const total = v.wins + v.losses;
    edge[dir] = { wins: v.wins, losses: v.losses, total, winRate: total > 0 ? parseFloat(((v.wins / total) * 100).toFixed(1)) : null };
  }
  return edge;
}

export async function getPriceHistory(tradeId) {
  const { data, error } = await (await client()).from('price_history').select('price, sampled_at').eq('trade_id', tradeId).order('id', { ascending: true });
  if (error) return [];
  return data || [];
}

export async function getLessonsFor(instrument, direction) {
  const { data, error } = await (await client()).from('lessons').select('*').eq('instrument', instrument.toUpperCase()).eq('direction', direction).order('created_at', { ascending: false }).limit(3);
  if (error) return [];
  return data || [];
}

export async function hasRecentLesson(instrument, direction) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await (await client()).from('lessons').select('id').eq('instrument', instrument.toUpperCase()).eq('direction', direction).gte('created_at', since).limit(1);
  if (error) return false;
  return !!(data && data.length);
}

export async function getAllLessons() {
  const { data, error } = await (await client()).from('lessons').select('*').order('created_at', { ascending: false });
  if (error) return [];
  return data || [];
}

export async function getAlerts({ unreadOnly = false } = {}) {
  let q = (await client()).from('alerts').select('*').order('created_at', { ascending: false }).limit(50);
  const { data, error } = await q;
  if (error) return [];
  let rows = data || [];
  if (unreadOnly) rows = rows.filter(a => !a.seen);
  return rows;
}

export async function markAlertsSeen() {
  const { error } = await (await client()).from('alerts').update({ seen: 1 }).eq('seen', 0);
  if (error) return;
}

export async function hasActiveTrade(instrument) {
  const { data, error } = await (await client()).from('trades').select('id').eq('instrument', instrument).eq('status', 'ACTIVE').limit(1);
  if (error) return false;
  return !!(data && data.length);
}

export async function expireStalePending() {
  const cutoff = new Date(Date.now() - PENDING_EXPIRY_HOURS * 60 * 60 * 1000).toISOString();
  const { data, error } = await (await client()).from('trades').select('id').eq('status', 'PENDING').lt('created_at', cutoff);
  if (error) return 0;
  const ids = (data || []).map(r => r.id);
  if (ids.length) {
    await (await client()).from('trades').delete().in('id', ids);
    dbLog.info({ expired: ids.length, olderThan: cutoff }, 'Expired stale PENDING setups (Supabase)');
  }
  return ids.length;
}

export async function expireStaleActive() {
  const cutoff = new Date(Date.now() - ACTIVE_EXPIRY_HOURS * 60 * 60 * 1000).toISOString();
  const { data, error } = await (await client()).from('trades').select('*').eq('status', 'ACTIVE').lt('created_at', cutoff);
  if (error) return [];
  const expiring = data || [];
  if (expiring.length) {
    const ids = expiring.map(r => r.id);
    await (await client()).from('trades').update({ status: 'EXPIRED', closed_at: new Date().toISOString() }).in('id', ids);
    dbLog.info({ expired: ids.length, olderThan: cutoff }, 'Expired stale ACTIVE trades (Supabase)');
  }
  return expiring.map(hydrate);
}

// No-op for Supabase mode (migration is done via SQL script, not JSON files)
export async function migrateFromJSON() {
  dbLog.info('migrateFromJSON is a no-op in Supabase mode');
}
