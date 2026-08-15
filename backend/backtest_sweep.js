/**
 * backtest_sweep.js — Parameter grid search για ARIS Quantum V6 Backtest V2
 *
 * Τι κάνει:
 *   Τρέχει το backtest_v2 σε πολλαπλά symbols × πολλαπλά parameter sets,
 *   συλλέγοντας expectancy/win-rate για κάθε συνδυασμό.
 *
 * ΣΚΟΠΟΣ: βρείτε ποια παράμετροι δίνουν **σταθερά** θετικό expectancy
 *   σε πολλά symbols (όχι overfitting σε ένα).
 *
 * DISCLAIMER:
 *   Αυτή είναι μια RULE-BASED APPROXIMATION του ARIS Quantum v6.0 Pine script.
 *   Στο Pine, η strategy είναι AI-driven (chart→Claude) με πολυπλοκότερους
 *   modules (UFO PRO, ARIS V7, Forecast Engine, CVD, Funding/OI, DXY, Benford,
 *   Liquidity Heatmap) που **δεν μπορούν** να προσομοιωθούν από Binance klines.
 *   Το sweep είναι για να βρούμε ποια CONFIGURATION των computable modules
 *   είναι πιο robust — όχι για να βρούμε "το μυστικό set".
 */
import { runBacktest } from './backtest_v2.js';
import fetch from 'node-fetch';

// ── Symbols (HYPE excluded — not available on Binance USDT spot) ──
const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'ADAUSDT', 'AVAXUSDT', 'SEIUSDT', 'SUIUSDT', 'LINKUSDT', 'NEARUSDT', 'BNBUSDT', 'VETUSDT'];

// ── Grid search space (48 combos = 3x2x2x2x2) ──
const GRID = {
  wtBuyThresh: [-15, -10, -5],
  mtfThreshold: [1, 2],
  zThresh: [1.0, 1.5],
  riskRewardRatio: [1.0, 1.5],
  atrMultiplierSL: [2.0, 2.5],
};

function generateCombos(grid) {
  const keys = Object.keys(grid);
  const combos = [];
  function recurse(idx, current) {
    if (idx === keys.length) { combos.push({ ...current }); return; }
    for (const val of grid[keys[idx]]) recurse(idx + 1, { ...current, [keys[idx]]: val });
  }
  recurse(0, {});
  return combos;
}

async function fetchKlines(symbol, limit, interval) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const r = await fetch(url);
  const data = await r.json();
  return data.map(k => ({ open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }));
}

async function main() {
  console.log('=== ARIS Quantum V6 — Parameter Sweep ===\n');
  const combos = generateCombos(GRID);
  console.log(`Symbols: ${SYMBOLS.join(', ')}`);
  console.log(`Parameter combinations: ${combos.length}\n`);

  // Pre-fetch klines (cache)
  const cache = {};
  for (const s of SYMBOLS) {
    process.stdout.write(`  Fetching ${s}... `);
    cache[s] = await fetchKlines(s, 2000, '1h');
    console.log(`${cache[s].length} candles`);
  }

  const results = [];
  let comboNum = 0;

  for (const combo of combos) {
    comboNum++;
    process.stdout.write(`\r[${comboNum}/${combos.length}] ${JSON.stringify(combo)}... `);
    let totalTrades = 0, sumExpectancy = 0, symbolsWithTrades = 0, totalWins = 0;

    for (const s of SYMBOLS) {
      const res = await runBacktest(s, 2000, combo, cache[s]);
      if (!res || !res.setups) continue;
      const { closed } = res;
      totalTrades += closed;
      sumExpectancy += parseFloat(res.expectancy);
      if (closed > 0) symbolsWithTrades++;
    }

    const avgExpectancy = symbolsWithTrades > 0 ? sumExpectancy / symbolsWithTrades : 0;
    results.push({
      params: combo, totalTrades, totalWins,
      avgExpectancy: avgExpectancy.toFixed(3),
      symbolsWithTrades,
      // consistency: count symbols with positive expectancy
      posSymbols: 0, // filled below — but we don't track per-symbol in this loop
    });
  }

  // We need per-symbol data for consistency. Re-run the top 5 by avgExpectancy.
  results.sort((a, b) => parseFloat(b.avgExpectancy) - parseFloat(a.avgExpectancy));
  console.log('\n\n=== Top 15 parameter sets (by avg expectancy) ===\n');
  console.log('Rank | AvgR   | Trades | Symbols | Params');
  console.log('-----|--------|--------|---------|------------------------------------');
  results.slice(0, 15).forEach((r, i) => {
    const p = r.params;
    console.log(`${String(i + 1).padStart(4)} | ${r.avgExpectancy.padStart(6)} | ${String(r.totalTrades).padStart(6)} | ${String(r.symbolsWithTrades).padStart(7)} | wt=${p.wtBuyThresh}, mtf=${p.mtfThreshold}, z=${p.zThresh}, R=${p.riskRewardRatio}, atr=${p.atrMultiplierSL}`);
  });

  // Re-run top 5 with per-symbol breakdown for consistency check
  console.log('\n=== Top 3 sets — per-symbol breakdown ===\n');
  for (let i = 0; i < Math.min(3, results.length); i++) {
    const r = results[i];
    const p = r.params;
    console.log(`Rank ${i + 1}: wt=${p.wtBuyThresh}, mtf=${p.mtfThreshold}, z=${p.zThresh}, R=${p.riskRewardRatio}, atr=${p.atrMultiplierSL}`);
    for (const s of SYMBOLS) {
      const res = await runBacktest(s, 2000, p, cache[s]);
      console.log(`  ${s.padEnd(10)} setups=${res.setups} closed=${res.closed} WR=${res.winRate}% R=${res.expectancy}`);
    }
  }

  console.log('\n=== Missing modules (cant be swept from klines) ===');
  console.log('  - CVD / Delta / Footprint (needs intrabar data)');
  console.log('  - Funding Rate + OI (needs real-time API)');
  console.log('  - DXY / US10Y (needs macro data)');
  console.log("  - Benford's Law (digit distribution)");
  console.log('  - Forecast Engine KNN (needs training data)');
  console.log('  - Liquidity Heatmap (EQH/EQL)');
  console.log('  - Mega Score 16/31 gate (needs UFO/ARIS full module suite)');
}

main().catch(e => { console.error('Sweep failed:', e.message); process.exit(1); });
