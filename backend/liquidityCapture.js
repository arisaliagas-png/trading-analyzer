// liquidityCapture.js — runs INSIDE the Fly server.
// Keeps a full incremental Binance book per symbol and upserts every wall
// >= MIN_BTC into Supabase (liquidity_walls table) via liquidityStore.js.
// Independent of any local machine — data is always live on Fly.
import WebSocket from 'ws';
import { upsertWall, deleteWall, getWalls } from './liquidityStore.js';
import { dbLog } from './logger.js';

const SYMBOLS = (process.env.LIQUIDITY_SYMBOLS || 'BTCUSDT').toUpperCase().split(',');
const MIN_BTC = parseFloat(process.env.LIQUIDITY_MIN_BTC || '5');
// A wall is considered "withdrawn" (not hit) only if price never crossed it.
// We track the last mid price; if a wall vanishes while price is still on the
// same side of it, it was pulled — delete. If price crossed it, it was consumed — keep.
const WALL_TTL_MS = parseInt(process.env.LIQUIDITY_WALL_TTL || '3600000', 10); // 1h grace

// per-symbol state
const streams = {}; // symbol -> { book, lastUpdateId, primed, cache, prevSeen, lastMid }

function applyLevels(map, levels) {
  for (const [p, q] of levels) {
    const price = parseFloat(p), qty = parseFloat(q);
    if (qty === 0) map.delete(price); else map.set(price, qty);
  }
}

function midPrice(st) {
  let bestBid = 0, bestAsk = Infinity;
  for (const [p] of st.book.bids) if (p > bestBid) bestBid = p;
  for (const [p] of st.book.asks) if (p < bestAsk) bestAsk = p;
  if (bestBid > 0 && bestAsk < Infinity) return (bestBid + bestAsk) / 2;
  return bestBid || (bestAsk < Infinity ? bestAsk : null);
}

// Reconcile Supabase with the live book on startup: any wall stored in
// Supabase that is NOT present in the current book (and was not consumed by
// price crossing it) is a withdrawn/stale wall — delete it so the map matches
// what the user actually sees. This clears phantom walls left over from before
// a restart. Hit walls (price crossed them) are preserved as historical.
async function reconcileSupabase(symbol) {
  const st = streams[symbol];
  if (!st) return;
  const mid = st.lastMid;
  let rows;
  try {
    rows = await getWalls(symbol);
  } catch (e) {
    dbLog.warn({ err: e.message, symbol }, 'liquidityCapture reconcile getWalls failed');
    return;
  }
  let removed = 0;
  for (const r of rows) {
    const key = `${r.price.toFixed(1)}|${r.side}`;
    const live = st.book[r.side === 'bid' ? 'bids' : 'asks'].get(r.price);
    if (live != null && live >= MIN_BTC) continue; // still live in book → keep
    const crossed = mid != null && (
      (r.side === 'bid' && mid >= r.price) ||
      (r.side === 'ask' && mid <= r.price)
    );
    if (crossed) continue; // consumed by price → historical, keep
    await deleteWall(symbol, r.price, r.side);
    removed++;
  }
  if (removed > 0) dbLog.info({ symbol, removed }, 'liquidityCapture reconciled stale walls');
}

function startSymbol(symbol) {
  const st = {
    book: { bids: new Map(), asks: new Map() },
    lastUpdateId: null,
    primed: false,
    cache: {}, // price|side -> {hits, maxQty, first_seen, withdrawn}
    prevSeen: new Set(), // keys seen in the previous scanBook pass
  };
  streams[symbol] = st;

  // Prime from REST snapshot (top 5000 levels)
  fetch(`https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=5000`)
    .then(r => r.json())
    .then(snap => {
      if (snap.code) { dbLog.warn({ snap: snap.msg }, 'liquidityCapture REST error'); return; }
      st.lastUpdateId = snap.lastUpdateId;
      applyLevels(st.book.bids, snap.bids);
      applyLevels(st.book.asks, snap.asks);
      st.primed = true;
      st.lastMid = midPrice(st); // for reconcile crossed-check
      dbLog.info({ symbol, bids: st.book.bids.size, asks: st.book.asks.size }, 'liquidityCapture primed');
      scanBook(symbol);
      // Clear phantom walls left in Supabase from before this restart.
      reconcileSupabase(symbol).catch(e =>
        dbLog.warn({ err: e.message, symbol }, 'liquidityCapture reconcile failed'));
    })
    .catch(e => dbLog.warn({ err: e.message }, 'liquidityCapture prime failed'));

  const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@depth@100ms`);
  ws.on('open', () => dbLog.info({ symbol }, 'liquidityCapture WS open'));
  ws.on('message', (raw) => {
    try {
      const d = JSON.parse(raw);
      if (!st.primed) return;
      if (d.U != null && d.U <= st.lastUpdateId + 1) {
        applyLevels(st.book.bids, d.b || []);
        applyLevels(st.book.asks, d.a || []);
        st.lastUpdateId = d.u;
        scanBook(symbol);
      }
    } catch {}
  });
  ws.on('error', e => dbLog.warn({ err: e.message, symbol }, 'liquidityCapture WS error'));
  ws.on('close', () => {
    dbLog.warn({ symbol }, 'liquidityCapture WS closed — reconnecting in 5s');
    setTimeout(() => startSymbol(symbol), 5000);
  });
}

function scanBook(symbol) {
  const st = streams[symbol];
  if (!st) return;
  const mid = midPrice(st);
  st.lastMid = mid;
  const seen = new Set();
  for (const [price, qty] of st.book.bids) {
    if (qty >= MIN_BTC) { record(symbol, 'bid', price, qty); seen.add(`${price.toFixed(1)}|bid`); }
  }
  for (const [price, qty] of st.book.asks) {
    if (qty >= MIN_BTC) { record(symbol, 'ask', price, qty); seen.add(`${price.toFixed(1)}|ask`); }
  }

  // ── Withdrawn-wall cleanup ──
  // Any wall we saw last pass but NOT this pass was either consumed (price crossed it)
  // or withdrawn (whale pulled it). If price never crossed it, delete from Supabase.
  for (const key of st.prevSeen) {
    if (seen.has(key)) continue;
    const [ps, side] = key.split('|');
    const price = parseFloat(ps);
    const cached = st.cache[key];
    const crossed = cached && mid != null && (
      (side === 'bid' && mid >= price) ||  // bid wall consumed when price rose above it
      (side === 'ask' && mid <= price)     // ask wall consumed when price fell below it
    );
    if (!crossed) {
      // Withdrawn — remove from live map
      deleteWall(symbol, price, side);
      delete st.cache[key];
      dbLog.info({ symbol, price, side }, 'liquidityCapture removed withdrawn wall');
    }
    // If crossed → keep (historical map); do NOT delete cache so hits persist.
  }
  st.prevSeen = seen;
}

function record(symbol, side, price, qty) {
  const st = streams[symbol];
  const key = `${price.toFixed(1)}|${side}`;
  const prev = st.cache[key] || null;
  // Only upsert to Supabase on first sighting or if max grew significantly
  const isNew = !prev;
  const grew = prev && qty > prev.maxQty * 1.1;
  if (isNew || grew) {
    upsertWall(symbol, side, price, qty, prev).then(({ hits, maxQty }) => {
      st.cache[key] = { hits, maxQty, first_seen: prev?.first_seen || new Date().toISOString() };
    });
  } else if (prev) {
    // update local cache hit count (cheap, no DB write)
    prev.hits += 1;
  }
}

export function startLiquidityCapture() {
  if (!process.env.SUPABASE_URL) {
    dbLog.warn('SUPABASE_URL not set — Liquidity Map capture disabled');
    return;
  }
  dbLog.info({ symbols: SYMBOLS, minBtc: MIN_BTC }, 'Starting Liquidity Map capture');
  SYMBOLS.forEach(startSymbol);
}
