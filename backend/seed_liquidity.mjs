// Seed Supabase liquidity_walls from the local book_history JSON file.
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supa = createClient(url, key, { auth: { persistSession: false } });

const tmp = process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}/Temp` : (process.env.TMP || '/tmp');
const file = `${tmp}/book_history_btcusdt.json`;
const db = JSON.parse(fs.readFileSync(file, 'utf8'));

const rows = Object.entries(db).map(([price, v]) => ({
  symbol: 'BTCUSDT',
  price: parseFloat(price),
  side: v.side,
  max_qty: v.maxQty,
  hits: v.hits,
  first_seen: v.firstSeen,
  last_seen: v.lastSeen,
  updated_at: new Date().toISOString(),
}));

console.log(`Seeding ${rows.length} rows to Supabase...`);
const { error } = await supa.from('liquidity_walls').upsert(rows, { onConflict: 'symbol,price,side' });
if (error) { console.log('ERROR:', error.message); process.exit(1); }
console.log('✅ Seeded', rows.length, 'rows');
