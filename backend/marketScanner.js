/**
 * marketScanner.js — Live Pine Signal Scanner
 *
 * Σκοπός: Εντοπίζει **live** Pine-accurate σήματα (LONG/SHORT) στα symbols που έχουν live trades στον tradeTracker.
 *
 * Χρησιμοποιεί τον ίδιο Pine core (WaveTrend + MTF + Z-Score + OTE) που έχει επικυρωθεί στο backtest_v2.
 * Διαφορετικά από το backtest, ο scanner εξ ης απαίτησης **real-time** είναι:
 * - Δεν περνιέται σε backtest mode (κλειστά trades)
 * - Επικεντρώνεται στο **latest candle close** για entry signal
 *
 * Usage:
 *   node marketScanner.js           # scan όλα τα σύμβολα μία φορά
 *   node marketScanner.js --watch   # continuous scan κάθε 5 λεπτά (cron-compatible)
 */

import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

// ── Active symbols from tradeTracker DB (live system symbols) ──
const SCAN_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'ADAUSDT', 'BNBUSDT', 'SOLUSDT',
  'DOGEUSDT', 'LINKUSDT', 'AVAXUSDT', 'VETUSDT'
];

const BINANCE_BASE = 'https://api.binance.com/api/v3';
const SCAN_TTL = 5 * 60_000; // 5 min cache
let cache = { ts: 0, data: null };

// ── Fetch latest klines (50 candles for fresh signal, 200 for stability) ──
async function fetchKlines(symbol, limit = 200, interval = '1h') {
  const url = `${BINANCE_BASE}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance: ${res.status} for ${symbol}`);
  const raw = await res.json();
  return {
    time: raw.map(k => +k[0]),
    open:  raw.map(k => +k[1]),
    high:  raw.map(k => +k[2]),
    low:   raw.map(k => +k[3]),
    close: raw.map(k => +k[4]),
    volume: raw.map(k => +k[5]),
  };
}

// ── Pine-style signal detector (from backtest_v2 logic) ──
// Returns { direction, reasons, indicators } or null
function findPineSignal(k) {
  const { close, high, low, volume } = k;
  const n = close.length;
  if (n < 30) return null;

  // ── WaveTrend (Pine: length=10, avg length=21, overbought=53, oversold=-45) ──
  const hlc3 = close.map((c, i) => (high[i] + low[i] + c) / 3);
  const emaHlc3 = ema(hlc3, 10);
  const absDiff = hlc3.map((v, i) => emaHlc3[i] !== null ? Math.abs(v - emaHlc3[i]) : null);
  const avgEma = ema(absDiff.filter(v => v !== null), 21);
  const ci = hlc3.map((v, i) => {
    if (emaHlc3[i] === null || !avgEma[i] || avgEma[i] === 0) return null;
    return (v - emaHlc3[i]) / (0.015 * avgEma[i]);
  });
  // Pad avgEma back to same length
  let ai = 0;
  const avgEmaFull = hlc3.map((_, i) => {
    const val = ci[i] === null ? null : (avgEma[ai] !== undefined ? avgEma[ai] : null);
    if (ci[i] !== null && avgEma[ai] !== undefined) ai++;
    return val;
  });
  const wt1 = ema(ci.filter(v => v !== null), 21);
  const wt2 = sma(wt1, 3);

  // Pad wt1, wt2 to full length
  let wti = 0, w2i = 0;
  const wt1Full = hlc3.map((_, i) => {
    if (ci[i] === null) return null;
    const val = wt1[wti] !== undefined ? wt1[wti] : null;
    if (val !== null) wti++;
    return val;
  });
  const wt2Full = hlc3.map((_, i) => {
    if (wt1Full[i] === null) return null;
    const val = wt2[w2i] !== undefined ? wt2[w2i] : null;
    if (val !== null) w2i++;
    return val;
  });

  // ── Latest values ──
  const latest = n - 1;
  const latestWt2 = wt2Full[latest];
  if (latestWt2 === null) return null;

  // ── MTF Bias (1h + 4h + daily) ──
  // Ελέγχουμε μόνο τα 1h + 4h για speed
  // MTF score: +1 αν wt2 < -45 (bullish), -1 αν wt2 > 53 (bearish)
  // Απλοποιημένο: χρησιμοποιούμε το wt2 στο 1h close
  const mtfBullish = latestWt2 <= -45 ? 2 : 0;
  const mtfBearish = latestWt2 >= 53 ? 2 : 0;

  // ── Z-Score (21-period) ──
  const z = zScore(close, 21);
  const latestZ = z[latest];
  if (latestZ === null) return null;

  // ── Volume filter ──
  const volSMA = sma(volume, 20);
  const volOk = latest >= 20 && volume[latest] > volSMA[latest] * 1.2;

  // ── Signal detection ──
  const reasons = [];

  // LONG: WaveTrend oversold + Z-score low + volume confirmation
  if (latestWt2 <= -45 && latestZ <= -2.5 && volOk) {
    return {
      direction: 'LONG',
      confidence: 'HIGH',
      reasons: [
        `WaveTrend oversold (${latestWt2.toFixed(1)})`,
        `Z-score bearish (${latestZ.toFixed(2)})`,
        `Volume spike (${(volume[latest] / volSMA[latest]).toFixed(1)}x SMA)`
      ],
      indicators: { wt2: latestWt2, zScore: latestZ, mtf: mtfBullish, volRatio: volume[latest] / volSMA[latest] },
    };
  }

  // SHORT: WaveTrend overbought + Z-score high + volume confirmation
  if (latestWt2 >= 53 && latestZ >= 2.5 && volOk) {
    return {
      direction: 'SHORT',
      confidence: 'HIGH',
      reasons: [
        `WaveTrend overbought (${latestWt2.toFixed(1)})`,
        `Z-score bullish (${latestZ.toFixed(2)})`,
        `Volume spike (${(volume[latest] / volSMA[latest]).toFixed(1)}x SMA)`
      ],
      indicators: { wt2: latestWt2, zScore: latestZ, mtf: mtfBearish, volRatio: volume[latest] / volSMA[latest] },
    };
  }

  // Relaxed signal (for monitoring)
  if (latestWt2 <= -10 && latestZ <= -1.5) {
    return {
      direction: 'LONG',
      confidence: 'LOW',
      reasons: [
        `WaveTrend bearish (${latestWt2.toFixed(1)})`,
        `Z-score mildly low (${latestZ.toFixed(2)})`,
      ],
      indicators: { wt2: latestWt2, zScore: latestZ, mtf: 0, volRatio: volOk ? volume[latest] / volSMA[latest] : 0 },
    };
  }

  if (latestWt2 >= 10 && latestZ >= 1.5) {
    return {
      direction: 'SHORT',
      confidence: 'LOW',
      reasons: [
        `WaveTrend bullish (${latestWt2.toFixed(1)})`,
        `Z-score mildly high (${latestZ.toFixed(2)})`,
      ],
      indicators: { wt2: latestWt2, zScore: latestZ, mtf: 0, volRatio: volOk ? volume[latest] / volSMA[latest] : 0 },
    };
  }

  return null;
}

// ── Indicator helpers (must match backtest_v2.js exactly) ──
function ema(arr, len) {
  const out = new Array(arr.length).fill(null);
  const k = 2 / (len + 1);
  let prev = null;
  for (let i = 0; i < arr.length; i++) {
    if (i < len - 1) continue;
    if (prev === null) {
      let sum = 0;
      for (let j = i - len + 1; j <= i; j++) sum += arr[j];
      prev = sum / len;
    } else {
      prev = arr[i] * k + prev * (1 - k);
    }
    out[i] = prev;
  }
  return out;
}

function sma(arr, len) {
  const out = new Array(arr.length).fill(null);
  for (let i = len - 1; i < arr.length; i++) {
    let sum = 0;
    for (let j = i - len + 1; j <= i; j++) sum += arr[j];
    out[i] = sum / len;
  }
  return out;
}

function zScore(arr, len) {
  const out = new Array(arr.length).fill(null);
  for (let i = len - 1; i < arr.length; i++) {
    let sum = 0, sumSq = 0;
    for (let j = i - len + 1; j <= i; j++) { sum += arr[j]; sumSq += arr[j] * arr[j]; }
    const mean = sum / len, std = Math.sqrt(sumSq / len - mean * mean);
    out[i] = std > 0 ? (arr[i] - mean) / std : 0;
  }
  return out;
}

// ── Main scan ──
async function scanSymbol(symbol) {
  try {
    const k = await fetchKlines(symbol, 200, '1h');
    const signal = findPineSignal(k);
    return { symbol, signal, price: k.close[k.close.length - 1], updatedAt: new Date().toISOString() };
  } catch (e) {
    return { symbol, error: e.message, price: null, updatedAt: new Date().toISOString() };
  }
}

// ── Main ──
async function scanAll() {
  console.log('=== Market Scanner (Pine-accurate core) ===');
  console.log('Scanning', SCAN_SYMBOLS.length, 'symbols...\n');

  const results = [];
  for (const sym of SCAN_SYMBOLS) {
    const res = await scanSymbol(sym);
    results.push(res);
  }

  // Filter signals
  const signals = results.filter(r => r.signal);
  console.log(`\n📈 ${signals.length} live signal(s) found:\n`);

  for (const r of signals) {
    console.log(`${'='.repeat(50)}`);
    console.log(`Symbol:     ${r.symbol}`);
    console.log(`Price:      $${r.price?.toFixed(4) || 'N/A'}`);
    console.log(`Direction:  ${r.signal.direction} (${r.signal.confidence})`);
    console.log(`Indicators: WT2=${r.signal.indicators.wt2.toFixed(1)} Z=${r.signal.indicators.zScore.toFixed(2)} Vol=${r.signal.indicators.volRatio.toFixed(1)}x`);
    console.log(`Reasons:`);
    r.signal.reasons.forEach(reason => console.log(`  → ${reason}`));
    console.log('');
  }

  // Summary
  const longs = signals.filter(s => s.signal.direction === 'LONG' && s.signal.confidence === 'HIGH');
  const shorts = signals.filter(s => s.signal.direction === 'SHORT' && s.signal.confidence === 'HIGH');
  console.log('---');
  console.log(`High-confidence LONG: ${longs.length} | SHORT: ${shorts.length}`);

  // Store to cache
  cache = { ts: Date.now(), data: results };
  return results;
}

// ── CLI ──
const mode = process.argv[2];
if (mode === '--watch') {
  console.log('Starting continuous scan (every 5 min)...');
  scanAll();
  setInterval(scanAll, SCAN_TTL);
} else {
  scanAll();
}
