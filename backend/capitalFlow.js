// ─────────────────────────────────────────────
// CAPITAL FLOW MAP
// Tracks where money is rotating across asset classes (crypto / metals /
// forex / commodities / USD) using Twelve Data quotes. Built to respect the
// free-tier rate limit (8 credits/min): one call per class, 60s cache.
// ─────────────────────────────────────────────
import fetch from 'node-fetch';

// Each class → candidate symbols (first that returns valid data wins).
// We use `quote` (1 credit) which returns change + rolling windows at once.
const CLASSES = {
  crypto:     { label: 'Crypto',      symbols: ['BTC/USD'] },
  metals:     { label: 'Metals',      symbols: ['XAU/USD'] },                    // gold spot (silver XAG/USD is Pro-only on free tier)
  forex:      { label: 'Forex',       symbols: ['EUR/USD'] },                     // EUR up = USD down
  commodities:{ label: 'Commodities', symbols: ['COPX', 'UNG', 'USO'] },         // copper / natgas / oil ETFs (free-tier compatible; HG/WTI are Pro-only)
  usd:        { label: 'USD',         symbols: ['UUP'] }                          // Invesco USD Index Bullish ETF (US10Y/DXY unavailable on free tier)
};

const CACHE_TTL = 10 * 60_000; // 10 min — Twelve Data free tier is 800 credits/DAY,
                                // so we must NOT hammer it. Cache is also written on
                                // failure (see below) so a rate-limit blip doesn't
                                // burn the daily quota on repeat fetches.
let cache = { ts: 0, data: null };

function classifyFlow(pct) {
  if (pct >= 1.5)  return { direction: 'STRONG_INFLOW',  score: 2 };
  if (pct >= 0.3)  return { direction: 'INFLOW',          score: 1 };
  if (pct > -0.3)  return { direction: 'NEUTRAL',         score: 0 };
  if (pct > -1.5)  return { direction: 'OUTFLOW',         score: -1 };
  return            { direction: 'STRONG_OUTFLOW', score: -2 };
}

async function fetchQuote(symbol) {
  const KEY = process.env.TWELVE_DATA_API_KEY; // lazy read (dotenv loads after imports)
  // NOTE: do NOT encodeURIComponent the slash — Twelve Data expects "BTC/USD"
  // literally; encoding gives "BTC%2FUSD" which returns 404.
  const url = `https://api.twelvedata.com/quote?symbol=${symbol}&apikey=${KEY}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const j = await res.json();
  if (j?.status === 'error' || !j?.symbol) return null;
  return j;
}

// Returns the full capital-flow map: { available, classes: [...], btcUsd, generatedAt }
// `force` = true bypasses the cache and always hits Twelve Data (used by the manual
// Refresh button). When false (tab open / auto), a fresh cache is returned without
// spending any credits.
export async function getCapitalFlow(force = false) {
  const KEY = process.env.TWELVE_DATA_API_KEY; // lazy read (dotenv loads after imports)
  if (!KEY) return { available: false, reason: 'TWELVE_DATA_API_KEY not set' };

  const now = Date.now();
  if (!force && cache.data && now - cache.ts < CACHE_TTL) return cache.data;

  const result = { available: true, generatedAt: new Date().toISOString(), classes: [] };
  let firstPrice = null;

  for (const [key, cfg] of Object.entries(CLASSES)) {
    let q = null;
    for (const sym of cfg.symbols) {
      try { q = await fetchQuote(sym); } catch { q = null; }
      if (q) break;
    }
    if (!q) {
      result.classes.push({ key, label: cfg.label, available: false });
      continue;
    }
    if (!firstPrice && q.close) firstPrice = parseFloat(q.close); // BTC as anchor

    const pct1d = parseFloat(q.percent_change ?? q.rolling_1d_change ?? 0);
    const pct7d = parseFloat(q.rolling_7d_change ?? 0);
    const flow = classifyFlow(pct1d);

    // USD class is INVERTED: EUR up or yield down = USD weak.
    const inverted = key === 'usd' || key === 'forex';
    const effScore = inverted ? -flow.score : flow.score;
    const effDir = inverted
      ? classifyFlow(-pct1d).direction
      : flow.direction;

    result.classes.push({
      key,
      label: cfg.label,
      symbol: q.symbol,
      name: q.name,
      price: q.close ? parseFloat(q.close) : null,
      change1d: +pct1d.toFixed(2),
      change7d: +pct7d.toFixed(2),
      flow: effDir,
      score: effScore
    });
  }

  result.btcUsd = firstPrice;
  // Always cache the result (even on full failure) so a rate-limit / network blip
  // doesn't burn the daily Twelve Data quota by re-fetching every request. The
  // manual Refresh button passes force=true to bypass this.
  cache = { ts: now, data: result };
  return result;
}
