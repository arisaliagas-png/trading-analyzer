/**
 * backtest.js — Rule-based approximation backtest (Option 1, Priority 2)
 *
 * DISCLAIMER (honest scope):
 * This is NOT the ARIS Quantum v6 AI strategy. The real strategy is
 * AI-driven (multi-timeframe context + order flow + live structure) and
 * cannot be reproduced without calling the LLM on every historical chart
 * (Option 3 — expensive, ~$7-20).
 *
 * What this DOES: simulates a *simplified* version of the entry logic the
 * AI uses — "SHORT at resistance after a bearish structural shift, with a
 * 1:2 R/R target" — over historical 1h Binance candles. It gives a rough
 * read on whether the *shape* of the setup has any edge. Treat the numbers
 * as indicative, not definitive.
 *
 * Usage: node backtest.js [SYMBOL] [LIMIT]
 *   e.g. node backtest.js BTCUSDT 1000
 */

import fetch from 'node-fetch';

const SYMBOL = process.argv[2] || 'BTCUSDT';
const LIMIT  = parseInt(process.argv[3] || '1000', 10);

// ── Fetch historical 1h klines from Binance (free, no key) ──────────────
async function fetchKlines(symbol, limit) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance ${res.status}: ${await res.text()}`);
  const raw = await res.json();
  // Binance kline: [openTime, open, high, low, close, volume, closeTime, ...]
  return raw.map(k => ({
    t: k[0],
    o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5]
  }));
}

// ── Simplified "ARIS-like" entry rule ───────────────────────────────────
// SHORT when price is near a recent local resistance (swing high) AND
// structure has shifted bearish (recent lower highs). LONG is the mirror.
//
// All decisions use ONLY data up to candle i (no future leakage).
function findSetups(klines) {
  const setups = [];
  const LOOKBACK = 20; // bars to define "recent" swing
  for (let i = LOOKBACK; i < klines.length - 1; i++) {
    const window = klines.slice(i - LOOKBACK, i + 1);
    const res = Math.max(...window.map(k => k.h));      // recent resistance
    const sup  = Math.min(...window.map(k => k.l));      // recent support
    const mid  = (res + sup) / 2;
    const last = klines[i];

    // Bearish structure: last 3 highs are descending
    const h1 = klines[i].h, h2 = klines[i - 1].h, h3 = klines[i - 2].h;
    const bearStruct = h1 < h2 && h2 < h3;
    // Bullish structure: last 3 lows are ascending
    const l1 = klines[i].l, l2 = klines[i - 1].l, l3 = klines[i - 2].l;
    const bullStruct = l1 > l2 && l2 > l3;

    // Price near resistance (within 0.5%) and bearish → SHORT
    const nearRes = last.c >= res * 0.995;
    // Price near support (within 0.5%) and bullish → LONG
    const nearSup = last.c <= sup * 1.005;

    if (bearStruct && nearRes) {
      const entry = last.c;
      const sl = res * 1.003;
      const tp = entry - 2 * (sl - entry); // 1:2 R/R
      setups.push({ i, dir: 'SHORT', entry, sl, tp, res, sup });
    } else if (bullStruct && nearSup) {
      const entry = last.c;
      const sl = sup * 0.997;
      const tp = entry + 2 * (entry - sl); // 1:2 R/R
      setups.push({ i, dir: 'LONG', entry, sl, tp, res, sup });
    }
  }
  return setups;
}

// ── Simulate each setup against forward candles (no future leakage) ─────
// Walk forward from the setup bar; first touch of TP or SL decides outcome.
function simulate(setups, klines) {
  const results = [];
  for (const s of setups) {
    let outcome = null;
    for (let j = s.i + 1; j < klines.length; j++) {
      const k = klines[j];
      if (s.dir === 'SHORT') {
        if (k.l <= s.tp) { outcome = 'SUCCESS'; break; }
        if (k.h >= s.sl) { outcome = 'FAILED';  break; }
      } else {
        if (k.h >= s.tp) { outcome = 'SUCCESS'; break; }
        if (k.l <= s.sl) { outcome = 'FAILED';  break; }
      }
    }
    // R-multiple: how many R the trade captured (capped at TP/SL for simplicity)
    let r = 0;
    if (outcome === 'SUCCESS') r = s.dir === 'SHORT' ? (s.entry - s.tp) / (s.sl - s.entry) : (s.tp - s.entry) / (s.entry - s.sl);
    else if (outcome === 'FAILED') r = s.dir === 'SHORT' ? (s.entry - s.sl) / (s.sl - s.entry) : (s.sl - s.entry) / (s.entry - s.sl);
    results.push({ ...s, outcome: outcome || 'OPEN', r });
  }
  return results;
}

// ── Report ─────────────────────────────────────────────────────────────
function report(symbol, results) {
  const closed = results.filter(r => r.outcome !== 'OPEN');
  const wins = closed.filter(r => r.outcome === 'SUCCESS');
  const losses = closed.filter(r => r.outcome === 'FAILED');
  const winRate = closed.length ? (wins.length / closed.length * 100).toFixed(1) : 'N/A';
  const expectancy = closed.length
    ? (closed.reduce((a, r) => a + r.r, 0) / closed.length).toFixed(3)
    : 'N/A';
  const avgWin = wins.length ? (wins.reduce((a, r) => a + r.r, 0) / wins.length).toFixed(3) : 'N/A';
  const avgLoss = losses.length ? (losses.reduce((a, r) => a + r.r, 0) / losses.length).toFixed(3) : 'N/A';
  const byDir = { LONG: { n: 0, w: 0 }, SHORT: { n: 0, w: 0 } };
  closed.forEach(r => { byDir[r.dir].n++; if (r.outcome === 'SUCCESS') byDir[r.dir].w++; });

  console.log(`\n=== RULE-BASED BACKTEST (approximation — NOT ARIS Quantum v6) ===`);
  console.log(`Symbol: ${symbol}`);
  console.log(`Setups found: ${results.length} (closed: ${closed.length}, still OPEN: ${results.length - closed.length})`);
  console.log(`Win rate: ${winRate}%  (${wins.length}W / ${losses.length}L)`);
  console.log(`Expectancy: ${expectancy} R per trade`);
  console.log(`Avg win: ${avgWin} R | Avg loss: ${avgLoss} R`);
  console.log(`Directional edge:`);
  for (const d of ['LONG', 'SHORT']) {
    const e = byDir[d];
    const wr = e.n ? (e.w / e.n * 100).toFixed(1) : 'N/A';
    console.log(`  ${d}: ${e.n} setups, ${wr}% win`);
  }
  console.log(`\n⚠️  Caveat: simplified rule (resistance/support + structure). Real AI`);
  console.log(`   strategy uses multi-TF context + order flow not modeled here.`);
}

// ── Main ───────────────────────────────────────────────────────────────
(async () => {
  try {
    console.log(`Fetching ${LIMIT} 1h klines for ${SYMBOL}...`);
    const klines = await fetchKlines(SYMBOL, LIMIT);
    console.log(`Got ${klines.length} candles (${new Date(klines[0].t).toISOString().slice(0,10)} → ${new Date(klines[klines.length-1].t).toISOString().slice(0,10)})`);
    const setups = findSetups(klines);
    console.log(`Found ${setups.length} setups`);
    const results = simulate(setups, klines);
    report(SYMBOL, results);
  } catch (e) {
    console.error('Backtest failed:', e.message);
    process.exit(1);
  }
})();

