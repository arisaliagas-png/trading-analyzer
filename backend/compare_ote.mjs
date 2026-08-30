import { calculateExecutionSetup } from './arisEngine.js';

// Reconstruct the PTS Wizard BTC chart structure from the screenshot:
// swingHigh ≈ 78793 (their TP2), swingLow ≈ 76766 (below their SL 77000)
// price dropped from high, now pulling back into OTE zone
const swingHigh = 78793;
const swingLow  = 76766;
const swingHighIndex = 20;
const swingLowIndex  = 5;   // high after low -> isUpward true (LONG)
const currentPrice = 77540; // top of their OTE zone

// tiny OHLCV so computeATR works
const n = 30;
const closes = Array.from({length:n}, (_,i)=> currentPrice + Math.sin(i/2)*80);
const highs = closes.map(c=> c+40);
const lows  = closes.map(c=> c-40);
const opens = closes.map(c=> c);

const res = calculateExecutionSetup({
  swingHigh, swingLow, swingHighIndex, swingLowIndex, currentPrice,
  highs, lows, opens, closes,
  regime: 'RANGE', squeezeState: null, cvdBias: null, whaleWalls: [],
  absorption: null, smTrap: { type: 'NONE', low: null, high: null }, forceDirection: 'LONG'
});

console.log('=== OUR ENGINE (PULLBACK_OTE) ===');
console.log('strategy :', res.strategy, res.direction);
console.log('OTE zone :', res.entry.low, '–', res.entry.high, '(ideal', res.entry.price + ')');
console.log('SL       :', res.sl);
console.log('TP1      :', res.tp1);
console.log('TP2      :', res.tp2);

const range = swingHigh - swingLow;
console.log('\n=== PTS WIZARD (from screenshot) ===');
console.log('OTE zone : 77256 – 77540');
console.log('SL       : 77000');
console.log('TP1      : 78167');
console.log('TP2      : 78793');

console.log('\n=== COMPARISON ===');
console.log('zone low : ours', res.entry.low.toFixed(0), ' vs PTS', 77256);
console.log('zone high: ours', res.entry.high.toFixed(0), ' vs PTS', 77540);
console.log('SL       : ours', res.sl.toFixed(0), ' vs PTS', 77000);
console.log('TP1      : ours', res.tp1.toFixed(0), ' vs PTS', 78167);
console.log('TP2      : ours', res.tp2.toFixed(0), ' vs PTS', 78793);

const e = res.entry.price, risk = Math.abs(e - res.sl);
console.log('\nOur RR1:', ((res.tp1 - e)/e*100 / (risk/e*100)).toFixed(2),
            ' RR2:', ((res.tp2 - e)/e*100 / (risk/e*100)).toFixed(2));
