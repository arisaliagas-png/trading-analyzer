import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const sb = createClient(url, key);

const { data, error } = await sb.from('trades').select('*').limit(1);
if (error) { console.error(error); process.exit(1); }
if (!data || data.length === 0) { console.log('NO TRADES'); process.exit(0); }
console.log('COLUMNS:', Object.keys(data[0]).join(', '));
console.log(JSON.stringify(data[0], null, 2));
