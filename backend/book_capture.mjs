// BTCUSDT order-book capture with PERSISTENT HISTORY.
// Keeps the full incremental book via depth@100ms and records every significant
// wall (>= MIN_BTC) it ever sees — across ALL price levels, not just a band — into
// a JSON database file. This builds a "where orders have been parked" map over time
// (like PTS Wizard's multi-hour book observation), so we can later query support/
// resistance zones even if price is far away right now.
//
// Also logs the target band (default 76500-77000) to a plain .log for quick view.
//
// Usage: node book_capture.mjs [symbol] [low] [high] [minBtc]
//   e.g. node book_capture.mjs BTCUSDT 76500 77000 5

import WebSocket from 'ws';
import fs from 'fs';

const SYMBOL   = (process.argv[2] || 'BTCUSDT').toLowerCase();
const LOW      = parseFloat(process.argv[3] || '76500');
const HIGH     = parseFloat(process.argv[4] || '77000');
const MIN_BTC  = parseFloat(process.argv[5] || '5');

const TMP      = process.env.LOCALAPPDATA + '/Temp';
const LOG      = `${TMP}/book_capture_${SYMBOL}.log`;
const DBFILE   = `${TMP}/book_history_${SYMBOL}.json`;

const log = (m) => { const line = `[${new Date().toISOString()}] ${m}`; console.log(line); fs.appendFileSync(LOG, line + '\n'); };

// ── Persistent history DB ───────────────────────────────────────────────
// Structure: { "78500.0": { side:"bid", hits:12, maxQty:14.2, firstSeen, lastSeen }, ... }
let db = {};
try { db = JSON.parse(fs.readFileSync(DBFILE, 'utf8')); } catch { db = {}; }

function recordWall(side, price, qty) {
  const key = price.toFixed(1);
  const prev = db[key] || { side, hits: 0, maxQty: 0, firstSeen: null, lastSeen: null };
  prev.side = side;
  prev.hits += 1;
  prev.maxQty = Math.max(prev.maxQty, qty);
  const now = new Date().toISOString();
  if (!prev.firstSeen) prev.firstSeen = now;
  prev.lastSeen = now;
  db[key] = prev;
}

// Persist every ~30s (don't write on every tick — too I/O heavy)
let dirty = false;
setInterval(() => {
  if (dirty) {
    try { fs.writeFileSync(DBFILE, JSON.stringify(db, null, 1)); dirty = false; } catch {}
  }
}, 30000);

function flushNow() { try { fs.writeFileSync(DBFILE, JSON.stringify(db, null, 1)); } catch {} }

// ── Full book reconstruction ──────────────────────────────────────────
const book = { bids: new Map(), asks: new Map() };
let lastUpdateId = null;
let primed = false;

function applyLevels(map, levels) {
  for (const [p, q] of levels) {
    const price = parseFloat(p), qty = parseFloat(q);
    if (qty === 0) map.delete(price); else map.set(price, qty);
  }
}

// Scan full book: record every wall >= MIN_BTC into history DB + log target band.
function scanBook() {
  const now = Date.now();
  for (const [price, qty] of book.bids) {
    if (qty >= MIN_BTC) {
      recordWall('bid', price, qty);
      dirty = true;
      if (price >= LOW && price <= HIGH) log(`BID  wall @ ${price.toFixed(1)} = ${qty.toFixed(3)} BTC (band)`);
    }
  }
  for (const [price, qty] of book.asks) {
    if (qty >= MIN_BTC) {
      recordWall('ask', price, qty);
      dirty = true;
      if (price >= LOW && price <= HIGH) log(`ASK  wall @ ${price.toFixed(1)} = ${qty.toFixed(3)} BTC (band)`);
    }
  }
}

// 1) Prime from REST snapshot
const snap = await fetch(`https://api.binance.com/api/v3/depth?symbol=${SYMBOL.toUpperCase()}&limit=5000`).then(r => r.json());
if (snap.code) { log('REST error: ' + snap.msg); process.exit(1); }
lastUpdateId = snap.lastUpdateId;
applyLevels(book.bids, snap.bids);
applyLevels(book.asks, snap.asks);
primed = true;
log(`Primed book (lastUpdateId=${lastUpdateId}, bids=${book.bids.size}, asks=${book.asks.size})`);
log(`Watching ${SYMBOL.toUpperCase()} — recording ALL walls >=${MIN_BTC}BTC to ${DBFILE}`);
log(`Target band ${LOW}-${HIGH} logged separately. DB currently has ${Object.keys(db).length} price levels.`);
scanBook();

// 2) Incremental stream
const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${SYMBOL}@depth@100ms`);
ws.on('open', () => log('WS open'));
ws.on('message', (raw) => {
  try {
    const d = JSON.parse(raw);
    if (!primed) return;
    if (d.U != null && d.U <= lastUpdateId + 1) {
      applyLevels(book.bids, d.b || []);
      applyLevels(book.asks, d.a || []);
      lastUpdateId = d.u;
      scanBook();
    }
  } catch {}
});
ws.on('error', e => log('WS error: ' + e.message));
ws.on('close', () => {
  log('WS closed — flushing DB');
  flushNow();
  if (!process.exitCode) setTimeout(() => process.exit(0), 1000);
});

// 3) Heartbeat: top walls in band + DB size
setInterval(() => {
  const inBand = [...book.bids, ...book.asks]
    .filter(([p]) => p >= LOW && p <= HIGH)
    .sort((a, b) => b[1] - a[1]).slice(0, 5);
  const summary = inBand.map(([p, q]) => `$${p.toFixed(0)}=${q.toFixed(2)}BTC`).join(' ');
  log(`[heartbeat] DB levels=${Object.keys(db).length} | band ${LOW}-${HIGH}: ${summary || 'empty'}`);
}, 60000);

// Flush on exit
process.on('SIGINT', () => { flushNow(); uploadToServer(); process.exit(0); });
process.on('SIGTERM', () => { flushNow(); uploadToServer(); process.exit(0); });

// Upload to server (Fly) so the Liquidity Map tab works everywhere
const UPLOAD_URL = process.env.UPLOAD_URL || 'https://trading-analyzer-affqwq.fly.dev/api/book-history/upload';
function uploadToServer() {
  try {
    const body = JSON.stringify({ symbol: SYMBOL.toUpperCase(), levels: db });
    fetch(UPLOAD_URL + '?symbol=' + SYMBOL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    }).then(r => r.json()).then(d => log(`[upload] ${JSON.stringify(d)}`)).catch(e => log('[upload] error: ' + e.message));
  } catch (e) { log('[upload] exception: ' + e.message); }
}

// Also upload every 5 min
setInterval(uploadToServer, 300000);
