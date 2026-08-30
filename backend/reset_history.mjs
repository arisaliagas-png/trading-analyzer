import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const sb = createClient(url, key);

async function sbDelete(table, filterCol, op, val) {
  let q = sb.from(table).delete();
  if (op === 'neq') q = q.neq(filterCol, val);
  else if (op === 'eq') q = q.eq(filterCol, val);
  else q = q.neq('id', 0); // works for bigint id (price_history) and text/uuid (trades)
  const { error } = await q;
  if (error) throw new Error(`${table} delete failed: ${error.message}`);
}

const before = await sb.from('trades').select('*', { count: 'exact', head: true });
const beforeL = await sb.from('lessons').select('*', { count: 'exact', head: true });
const beforeA = await sb.from('alerts').select('*', { count: 'exact', head: true });

await sbDelete('trades', 'id', 'neq', 0);
await sbDelete('price_history', 'id', 'neq', 0);
await sbDelete('alerts', 'id', 'neq', 0);

const after = await sb.from('trades').select('*', { count: 'exact', head: true });
const afterL = await sb.from('lessons').select('*', { count: 'exact', head: true });

console.log(`trades: ${before.count} -> ${after.count}`);
console.log(`lessons: ${beforeL.count} (preserved) -> ${afterL.count}`);
console.log('price_history + alerts cleared');
