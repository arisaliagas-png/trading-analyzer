/**
 * live-scanner.js — Run runBacktest over a watchlist with 100-candle limit.
 * Suppresses output when no setups found; prints a compact summary when alerts fire.
 */
import { runBacktest } from './backtest_v2.js';

const WATCHLIST = [
  'BTCUSDT', 'ETHUSDT', 'ADAUSDT', 'BNBUSDT', 'SOLUSDT',
  'DOGEUSDT', 'LINKUSDT', 'AVAXUSDT', 'VETUSDT'
];

const LIMIT = 100; // timeout-safe: 100 1h candles

const results = [];

console.error(`Starting live scanner — ${WATCHLIST.length} symbols × ${LIMIT} candles each...`);

for (const sym of WATCHLIST) {
  try {
    const r = await runBacktest(sym, LIMIT);
    results.push({ symbol: sym, ...r });
    console.error(`  [${sym}] setups=${r.setups} closed=${r.closed} wr=${r.winRate}%`);
  } catch (e) {
    console.error(`  [${sym}] ERROR: ${e.message}`);
  }
}

// Filter to signals only (setups > 0)
const signals = results.filter(r => r.setups > 0);

if (signals.length === 0) {
  // Suppress output — nothing to report
  console.error('No Pine-strict entries triggered across the watchlist.');
  process.exit(0);
}

console.log('\n═══════════════════════════════════════════════');
console.log('  Pine-STRICT ENTRY ALERTS');
console.log('═══════════════════════════════════════════════\n');

for (const s of signals) {
  console.log(`📌 ${s.symbol}`);
  console.log(`   Setups found : ${s.setups}`);
  console.log(`   Closed trades: ${s.closed}  |  Win rate: ${s.winRate}%`);
  console.log(`   Expectancy   : ${s.expectancy} R/trade`);
  console.log(`   LONG setups  : ${s.longCount} (WR ${s.longWinRate}%)`);
  console.log(`   SHORT setups : ${s.shortCount} (WR ${s.shortWinRate}%)`);
  console.log('');
}

console.log('═══════════════════════════════════════════════');
console.log(`  Total symbols scanned : ${results.length}`);
console.log(`  Symbols with signals  : ${signals.length}`);
console.log('═══════════════════════════════════════════════\n');
