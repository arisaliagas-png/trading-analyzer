import { getLiveIndicators } from './indicators.js';
const syms = (process.argv[2] || 'BTCUSDT,ETHUSDT,LINKUSDT,SOLUSDT,BNBUSDT,NEARUSDT,DOTUSDT,LTCUSDT').split(',');
const TF = process.env.SCAN_TIMEFRAME || '1h';
let allOk = true;
for (const sym of syms) {
  const ind = await getLiveIndicators(sym, TF, { forceFresh: true });
  const ote = ind.aris && ind.aris.ote;
  if (!ote || !ote.entry || !ote.sl || !ote.tp1) { console.log(`${sym}: NO OTE`); continue; }
  const entry = ote.entry.price ?? ote.entry;
  const isShort = ote.direction === 'SHORT';
  const risk = Math.abs(entry - ote.sl);
  const tp1Dist = Math.abs(ote.tp1 - entry);
  const slPct = (risk / entry) * 100;
  const tp1Pct = (tp1Dist / entry) * 100;
  const rr = tp1Pct / slPct;
  const floor = isShort ? entry - risk * 2 : entry + risk * 2;
  const ok = isShort ? (ote.tp1 <= floor) : (ote.tp1 >= floor);
  if (!ok) allOk = false;
  console.log(`${sym.padEnd(9)} ${ote.direction.padEnd(5)} SL%=${slPct.toFixed(2)} TP1%=${tp1Pct.toFixed(2)} RR=${rr.toFixed(2)} floorOK=${ok}`);
}
console.log(allOk ? '\nALL RR >= 2.0 ✅' : '\nSOME FAILED ❌');
