// liquidityStore.js — persistence layer for the Liquidity Map.
// Stores observed order-book walls in Supabase (table: liquidity_walls) so the
// data survives restarts and is independent of any local machine. The capture
// stream runs INSIDE the Fly server and upserts here continuously.
import { dbLog } from './logger.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let _client = null;
async function client() {
  if (!_client) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set');
    }
    const { createClient } = await import('@supabase/supabase-js');
    const key = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
    _client = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  }
  return _client;
}

// Upsert a single observed wall. `prevHits`/`prevMax` come from the in-memory
// cache so we can increment rather than overwrite.
export async function upsertWall(symbol, side, price, qty, prev) {
  const now = new Date().toISOString();
  const hits = (prev?.hits || 0) + 1;
  const maxQty = Math.max(prev?.maxQty || 0, qty);
  const row = {
    symbol,
    price,
    side,
    max_qty: maxQty,
    hits,
    first_seen: prev?.first_seen || now,
    last_seen: now,
    updated_at: now,
  };
  try {
    const c = await client();
    const { error } = await c
      .from('liquidity_walls')
      .upsert(row, { onConflict: 'symbol,price,side' });
    if (error) dbLog.warn({ err: error.message }, 'liquidityStore upsert failed');
  } catch (e) {
    dbLog.warn({ err: e.message }, 'liquidityStore upsert exception');
  }
  return { hits, maxQty };
}

// Delete a withdrawn wall (whale pulled their limit order back) so the map
// only shows real, live liquidity. Walls that were HIT by price are kept
// (historical map); only withdrawn ones are removed.
export async function deleteWall(symbol, price, side) {
  try {
    const c = await client();
    const { error } = await c
      .from('liquidity_walls')
      .delete()
      .eq('symbol', symbol.toUpperCase())
      .eq('price', price)
      .eq('side', side);
    if (error) dbLog.warn({ err: error.message }, 'liquidityStore delete failed');
  } catch (e) {
    dbLog.warn({ err: e.message }, 'liquidityStore delete exception');
  }
}

// Fetch all walls for a symbol, sorted high→low price.
export async function getWalls(symbol) {
  try {
    const c = await client();
    const { data, error } = await c
      .from('liquidity_walls')
      .select('price,side,max_qty,hits,first_seen,last_seen')
      .eq('symbol', symbol.toUpperCase())
      .order('price', { ascending: false });
    if (error) {
      dbLog.warn({ err: error.message }, 'liquidityStore getWalls failed');
      return [];
    }
    return (data || []).map(r => ({
      price: parseFloat(r.price),
      side: r.side,
      maxQty: parseFloat(r.max_qty),
      hits: r.hits,
      firstSeen: r.first_seen,
      lastSeen: r.last_seen,
    }));
  } catch (e) {
    dbLog.warn({ err: e.message }, 'liquidityStore getWalls exception');
    return [];
  }
}

// Bulk upsert (used on startup to seed from a local JSON file if present).
export async function bulkUpsert(symbol, levels) {
  for (const lvl of levels) {
    await upsertWall(symbol, lvl.side, lvl.price, lvl.maxQty, lvl);
  }
}
