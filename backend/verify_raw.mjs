import { createClient } from '@supabase/supabase-js';
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const sb = createClient(url, key);
const { data } = await sb.from('trades').select('instrument,entry_price,sl,tp1,tp2').order('instrument');
for (const t of data) {
  const e = t.entry_price, s = t.sl, p1 = t.tp1, p2 = t.tp2;
  const risk = Math.abs(e - s), r1 = Math.abs(p1 - e), r2 = Math.abs(p2 - e);
  console.log(`${t.instrument.padEnd(9)} entry=${e} sl=${s} tp1=${p1} tp2=${p2}`);
  console.log(`           SL%=${(risk/e*100).toFixed(2)} TP1%=${(r1/e*100).toFixed(2)} TP2%=${(r2/e*100).toFixed(2)} RR1=${(r1/risk).toFixed(2)} RR2=${(r2/risk).toFixed(2)}`);
}
