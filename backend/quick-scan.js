/**
 * quick-scan.js — Fast Pine-strict filter scan (100-candle limit)
 * Reuses the existing ARIS engine (arisEngine.js) without AI verification.
 * Runs standalone via: node quick-scan.js
 */

import { computeArisScore, finalizeArisScore } from './arisEngine.js';

const SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'ADAUSDT', 'BNBUSDT', 'SOLUSDT',
  'DOGEUSDT', 'LINKUSDT', 'AVAXUSDT', 'VETUSDT'
];

const KLINE_LIMIT = 100;
const MAX_PIVOT_AGE = 24;   // Pine-strict freshness guard
const MIN_MEGA_SCORE = 8;   // Pine-strict minimum score

async function fetchKlines(symbol, limit) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance API ${res.status} for ${symbol}`);
  return res.json();
}

function toOHLCV(data) {
  return {
    opens:   data.map(c => parseFloat(c[1])),
    highs:   data.map(c => parseFloat(c[2])),
    lows:    data.map(c => parseFloat(c[3])),
    closes:  data.map(c => parseFloat(c[4])),
    volumes: data.map(c => parseFloat(c[5])),
  };
}

function getCurrentPrice(closes) {
  return closes[closes.length - 1];
}

function computePivotAge(engine, closesLength) {
  if (!engine.swings) return Infinity;
  const lastBarIdx = closesLength - 1;
  const swingIdx = engine.direction === 'LONG'
    ? engine.swings.swingLowIndex
    : engine.swings.swingHighIndex;
  if (swingIdx == null) return Infinity;
  return lastBarIdx - swingIdx;
}

function formatPrice(v) {
  if (v == null) return '—';
  return v < 1 ? v.toFixed(5) : v < 1000 ? v.toFixed(3) : v.toFixed(2);
}

async function scanSymbol(symbol) {
  const raw = await fetchKlines(symbol, KLINE_LIMIT);
  const ohlcv = toOHLCV(raw);
  const closesLength = ohlcv.closes.length;

  if (closesLength < 100) {
    return { symbol, error: `Only ${closesLength} candles` };
  }

  // Phase 1: compute raw ARIS score from OHLCV
  const arisRaw = computeArisScore(ohlcv);

  // finalizeArisScore without external inputs (no MTF, no live CVD, no news)
  const engine = finalizeArisScore(arisRaw, null, null, null, [], null, null, null);

  // Pine-strict filter
  const hasSetup = engine.executionStrategy &&
                   engine.executionStrategy !== 'WAIT' &&
                   engine.executionStrategy !== 'NO_SETUP' &&
                   engine.ote != null;

  const hasDecentScore = (engine.megaScore ?? 0) >= MIN_MEGA_SCORE;
  const pivotAge = computePivotAge(engine, closesLength);
  const isFresh = pivotAge <= MAX_PIVOT_AGE;

  const triggered = hasSetup && hasDecentScore && isFresh;

  return {
    symbol,
    currentPrice: getCurrentPrice(ohlcv.closes),
    megaScore: engine.megaScore,
    maxScore: engine.maxScore,
    direction: engine.direction,
    strategy: engine.executionStrategy,
    confidence: engine.confidenceGrade,
    confidencePct: engine.confidencePct,
    regime: engine.regime,
    ote: engine.ote ? {
      direction: engine.ote.direction,
      entry: typeof engine.ote.entry === 'object'
        ? `$${formatPrice(engine.ote.entry.low)} - $${formatPrice(engine.ote.entry.high)}`
        : `$${formatPrice(engine.ote.entry)}`,
      sl: `$${formatPrice(engine.ote.sl)}`,
      tp1: `$${formatPrice(engine.ote.tp1)}`,
      tp2: `$${formatPrice(engine.ote.tp2)}`,
    } : null,
    squeeze: engine.squeeze?.state ?? 'N/A',
    squeezeDir: engine.squeeze?.direction ?? 'N/A',
    smTrap: engine.smTrap,
    cvd: engine.cvdBias,
    relVol: engine.relativeVolume?.ratio ?? 0,
    pivotAge,
    hasSetup,
    hasDecentScore,
    isFresh,
    triggered,
  };
}

async function main() {
  console.log(`╔══════════════════════════════════════════════════════════════╗`);
  console.log(`║  Pine-Strict Scanner  |  ${KLINE_LIMIT} candles  |  1h timeframe   ║`);
  console.log(`╚══════════════════════════════════════════════════════════════╝`);
  console.log();

  const results = [];
  for (const sym of SYMBOLS) {
    try {
      const r = await scanSymbol(sym);
      results.push(r);
      const flag = r.triggered ? ' 🚨 SIGNAL' : '';
      console.log(`${sym}  price=$${formatPrice(r.currentPrice)}  mega=${r.megaScore}/${r.maxScore}  dir=${r.direction}  strat=${r.strategy}  conf=${r.confidence}(${r.confidencePct}%)  pivotAge=${r.pivotAge}c  squeeze=${r.squeeze}/${r.squeezeDir}  cvd=${r.cvd}  vol=${r.relVol}x${flag}`);
    } catch (e) {
      console.log(`${sym}  ERROR: ${e.message}`);
      results.push({ symbol: sym, error: e.message, triggered: false });
    }
  }

  console.log();
  const signals = results.filter(r => r.triggered);
  const total = signals.length;

  if (total === 0) {
    console.log('───────────────────────────────────────────────');
    console.log('  No Pine-strict entries triggered. [SILENT]');
    console.log('───────────────────────────────────────────────');
    return;
  }

  console.log(`╔══════════════════════════════════════════════════════════════╗`);
  console.log(`║  🚨 ${total} SIGNAL${total > 1 ? 'S' : ''} FOUND              ║`);
  console.log(`╚══════════════════════════════════════════════════════════════╝`);
  console.log();

  for (const s of signals) {
    console.log(`──────────────────────────────────────────────────────────────`);
    console.log(`  📊 ${s.symbol}`);
    console.log(`     Direction    : ${s.direction}`);
    console.log(`     Strategy     : ${s.strategy}`);
    console.log(`     Mega Score   : ${s.megaScore}/${s.maxScore} (threshold: ${MIN_MEGA_SCORE})`);
    console.log(`     Confidence   : ${s.confidence} (${s.confidencePct}%)`);
    console.log(`     Regime       : ${s.regime}`);
    console.log(`     OTE Entry    : ${s.ote?.entry ?? 'N/A'}`);
    console.log(`     SL           : ${s.ote?.sl ?? 'N/A'}`);
    console.log(`     TP1 / TP2    : ${s.ote?.tp1 ?? 'N/A'} / ${s.ote?.tp2 ?? 'N/A'}`);
    console.log(`     Squeeze      : ${s.squeeze} / ${s.squeezeDir}`);
    console.log(`     SM Trap      : ${s.smTrap?.type ?? 'NONE'}`);
    console.log(`     CVD Bias     : ${s.cvd}`);
    console.log(`     Rel Volume   : ${s.relVol}x`);
    console.log(`     Pivot Age    : ${s.pivotAge} candles (max: ${MAX_PIVOT_AGE})`);
    console.log(`──────────────────────────────────────────────────────────────`);
    console.log();
  }
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
