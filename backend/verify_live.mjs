import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const sb = createClient(url, key);

const { data, error } = await sb.from('trades').select('instrument,direction,entry_price,sl,tp1,status,strategy,created_at').order('created_at');
if (error) { console.error(error); process.exit(1); }
console.log(`Total trades: ${data.length}\n`);
for (const t of data) {
  const entry = t.entry_price;
  const isShort = (t.direction||'').includes('SHORT');
  const risk = t.sl ? Math.abs(entry - t.sl) : 0;
  const tp1Dist = t.tp1 ? Math.abs(t.tp1 - entry) : 0;
  const slPct = entry ? (risk/entry)*100 : 0;
  const tp1Pct = entry ? (tp1Dist/entry)*100 : 0;
  const rr = slPct ? (tp1Pct/slPct) : 0;
  const floor = isShort ? entry - risk*2 : entry + risk*2;
  const ok = t.tp1 ? (isShort ? t.tp1 <= floor : t.tp1 >= floor) : false;
  const created = (t.created_at||'').substring(11,19);
  console.log(`${t.instrument.padEnd(9)} ${t.direction.padEnd(6)} RR=${rr.toFixed(2).padStart(5)} ${ok?'OK':'FAIL'} ${t.status.padEnd(8)} ${created}`);
}
