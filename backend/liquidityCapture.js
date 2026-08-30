// liquidityCapture.js — runs INSIDE the Fly server.
// Keeps a full incremental Binance book per symbol and upserts every wall
// >= MIN_BTC into Supabase (liquidity_walls table) via liquidityStore.js.
// Independent of any local machine — data is always live on Fly.
import WebSocket from 'ws';
import { upsertWall } from './liquidityStore.js';
import { dbLog } from './logger.js';

const SYMBOLS = (process.env.LIQUIDITY_SYMBOLS || 'BTCUSDT').toUpperCase().split(',');
const MIN_BTC = parseFloat(process.env.LIQUIDITY_MIN_BTC || '5');

// per-symbol state
const streams = {}; // symbol -> { book, lastUpdateId, primed, cache }

function applyLevels(map, levels) {
  for (const [p, q] of levels) {
    const price = parseFloat(p), qty = parseFloat(q);
    if (qty === 0) map.delete(price); else map.set(price, qty);
  }
}

function startSymbol(symbol) {
  const st = {
    book: { bids: new Map(), asks: new Map() },
    lastUpdateId: null,
    primed: false,
    cache: {}, // price|side -> {hits, maxQty, first_seen}
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
      dbLog.info({ symbol, bids: st.book.bids.size, asks: st.book.asks.size }, 'liquidityCapture primed');
      scanBook(symbol);
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
  for (const [price, qty] of st.book.bids) {
    if (qty >= MIN_BTC) record(symbol, 'bid', price, qty);
  }
  for (const [price, qty] of st.book.asks) {
    if (qty >= MIN_BTC) record(symbol, 'ask', price, qty);
  }
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
