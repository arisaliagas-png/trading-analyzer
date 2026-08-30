// BTCUSDT order-book capture — records large walls in a target price band.
// Run in background; it keeps the full incremental book via depth@100ms and logs
// any wall >= MIN_BTC that appears inside TARGET_LOW..TARGET_HIGH.
//
// Usage: node book_capture.mjs [symbol] [low] [high] [minBtc]
//   e.g. node book_capture.mjs BTCUSDT 76500 77000 5

import WebSocket from 'ws';

const SYMBOL   = (process.argv[2] || 'BTCUSDT').toLowerCase();
const LOW      = parseFloat(process.argv[3] || '76500');
const HIGH     = parseFloat(process.argv[4] || '77000');
const MIN_BTC  = parseFloat(process.argv[5] || '5');     // wall size threshold
const LOG      = process.env.LOCALAPPDATA + '/Temp/book_capture_' + SYMBOL + '.log';

import fs from 'fs';
const log = (m) => { const line = `[${new Date().toISOString()}] ${m}`; console.log(line); fs.appendFileSync(LOG, line + '\n'); };

// Full book reconstruction from incremental depth stream.
const book = { bids: new Map(), asks: new Map() };
let lastUpdateId = null;
let primed = false;

function applyLevels(map, levels) {
  for (const [p, q] of levels) {
    const price = parseFloat(p), qty = parseFloat(q);
    if (qty === 0) map.delete(price); else map.set(price, qty);
  }
}

function scanBand() {
  for (const [price, qty] of book.bids) {
    if (price >= LOW && price <= HIGH && qty >= MIN_BTC) {
      log(`BID  wall @ ${price.toFixed(1)} = ${qty.toFixed(3)} BTC`);
    }
  }
  for (const [price, qty] of book.asks) {
    if (price >= LOW && price <= HIGH && qty >= MIN_BTC) {
      log(`ASK  wall @ ${price.toFixed(1)} = ${qty.toFixed(3)} BTC`);
    }
  }
}

// 1) Get initial snapshot via REST
const snap = await fetch(`https://api.binance.com/api/v3/depth?symbol=${SYMBOL.toUpperCase()}&limit=1000`).then(r => r.json());
if (snap.code) { log('REST error: ' + snap.msg); process.exit(1); }
lastUpdateId = snap.lastUpdateId;
applyLevels(book.bids, snap.bids);
applyLevels(book.asks, snap.asks);
primed = true;
log(`Primed book from REST (lastUpdateId=${lastUpdateId}, bids=${book.bids.size}, asks=${book.asks.size})`);
log(`Watching ${SYMBOL.toUpperCase()} band ${LOW}-${HIGH}, min wall ${MIN_BTC} BTC. Logging to ${LOG}`);

// 2) Connect incremental stream, skip updates older than snapshot
const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${SYMBOL}@depth@100ms`);
ws.on('open', () => log('WS open'));
ws.on('message', (raw) => {
  try {
    const d = JSON.parse(raw);
    if (!primed) return;
    // Incremental update: {e, u, U, b:[[p,q]], a:[[p,q]]}
    if (d.U != null && d.U <= lastUpdateId + 1) {
      applyLevels(book.bids, d.b || []);
      applyLevels(book.asks, d.a || []);
      lastUpdateId = d.u;
      scanBand();
    }
  } catch {}
});
ws.on('error', e => log('WS error: ' + e.message));
ws.on('close', () => { if (!process.exitCode) setTimeout(() => process.exit(0), 1000); });

// Keep alive + periodic summary
setInterval(() => {
  let inBand = 0;
  for (const [, q] of book.bids) {} // noop
  log(`[heartbeat] book bids=${book.bids.size} asks=${book.asks.size} | band ${LOW}-${HIGH} total BTC: BID ${[...book.bids].filter(([p])=>p>=LOW&&p<=HIGH).reduce((s,[,q])=>s+q,0).toFixed(2)} ASK ${[...book.asks].filter(([p])=>p>=LOW&&p<=HIGH).reduce((s,[,q])=>s+q,0).toFixed(2)}`);
}, 60000);
