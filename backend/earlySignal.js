// ─────────────────────────────────────────────
// EARLY SIGNAL FINDER (New Coin Intelligence)
// Scans for recently added / low-cap coins with volume spikes using
// free public APIs (CoinGecko + Binance), then runs a cheap AI thesis
// (Claude Sonnet 4.5) only on the top-20 candidates.
// ─────────────────────────────────────────────
import fetch from 'node-fetch';

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';
const CMC_BASE = 'https://pro-api.coinmarketcap.com';
const BINANCE_BASE = 'https://api.binance.com/api/v3';
const CACHE_TTL = 10 * 60_000; // 10 min — AI thesis is expensive (~20 calls),
                               // so cache aggressively; only Refresh forces a rescan.
let cache = { ts: 0, data: null };

// ── CryptoPanic sentiment fetcher ──
// DISABLED: CryptoPanic API is dead (Cloudflare 403 on all requests as of 2026).
// Kept for reference but short-circuits to null so we don't waste an API call.
const CP_API_KEY = process.env.CRYPTOPANIC_API_KEY;
async function fetchCryptoPanicSentiment(symbol, force = false) {
  return null; // CryptoPanic API dead — skip entirely
}

// ── CoinGecko community sentiment fallback (free, no key) ──
// Returns { positive, negative, neutral, total, sentimentScore, source: 'CoinGecko' }
async function fetchCoinGeckoSentiment(symbol, force = false) {
  const cacheKey = `cg_${symbol}`;
  if (!force && global.cpCache && global.cpCache[cacheKey] && Date.now() - global.cpCache[cacheKey].ts < CACHE_TTL) {
    return global.cpCache[cacheKey].data;
  }
  if (!global.cpCache) global.cpCache = {};
  try {
    // CoinGecko /coins/{id}/community has user/bubble sentiment counts
    // Since we use symbol from CoinGecko list, map to id first
    const cgUrl = `${COINGECKO_BASE}/coins/${symbol.toLowerCase()}/community`;
    const res = await fetch(cgUrl);
    if (!res.ok) return null;
    const data = await res.json();
    // CoinGecko gives us a 'sentiment_votes' object-like counts in /community
    // Fallback: count upvotes/downvotes from reddit/github if available
    const positive = (data?.reddit_posts_sentiment?.positive || 0) + (data?.twitter_sentiment?.positive || 0);
    const negative = (data?.reddit_posts_sentiment?.negative || 0) + (data?.twitter_sentiment?.negative || 0);
    const neutral = (data?.reddit_posts_sentiment?.neutral || 0);
    const total = positive + negative + neutral;
    const score = total > 0 ? (positive - negative) / total : 0;
    const result = { positive, negative, neutral, total, sentimentScore: +score.toFixed(3), source: 'CoinGecko' };
    global.cpCache[cacheKey] = { data: result, ts: Date.now() };
    return result;
  } catch {
    return null;
  }
}

// ── Unified sentiment: tries CryptoPanic → falls back to CoinGecko ──
async function fetchSentiment(symbol) {
  let s = await fetchCryptoPanicSentiment(symbol);
  if (s && s.total > 0) return s;
  // Fallback to CoinGecko community sentiment
  s = await fetchCoinGeckoSentiment(symbol);
  if (s && s.total > 0) return s;
  return null;
}

// ── AI thesis (enhanced with sentiment + cross-source validation) ──
async function aiThesis(coin) {
  const prompt = `You are a senior crypto analyst. Given this coin snapshot, write a 3-line thesis in Greek:
- Utility: what it does (1 line)
- Risk score 0-100 + one-line rationale (use ONLY these Greek terms: "Υψηλό ρίσκο", "Χαμηλό ρίσκο", "Μεσαίο ρίσκο", "Εξαιρετικά υψηλό ρίσκο")
- Verdict: "WATCH" or "SKIP"
  Verdict rules (FOLLOW STRICTLY):
  - WATCH if the coin has REAL utility (not a pure meme/pump) AND risk score <= 80 AND volume/market-cap ratio is sane (<5x)
  - Cross-listed coins (present on BOTH CoinGecko + CoinMarketCap) get a WATCH bias — this is a stronger signal
  - SKIP only for pure meme coins, pump.fun origins, rug-pull risk, or volume >10x market cap (wash trading)
  - Do NOT default to SKIP for everything — if a coin is merely "high risk but legitimate", it is WATCH
IMPORTANT: Write clean, correct Greek. Do NOT invent words. If data is missing, say "Ανεπαρκή δεδομένα" — never use made-up phrases.

Snapshot:
${coin.name} (${coin.symbol})
Market cap: $${(((coin.marketCap ?? coin.market_cap) || 0)/1e6).toFixed(1)}M
Volume 24h: $${(((coin.volume24h ?? coin.total_volume) || 0)/1e6).toFixed(1)}M
Price change 24h: ${(((coin.priceChange24h ?? coin.price_change_percentage_24h) || 0)).toFixed(1)}%
Categories: ${(coin.categories||[]).join(', ') || 'N/A'}
Listed on: ${[coin.listedOnBinance ? 'Binance' : '', coin.crossListed ? 'Both CoinGecko+CoinMarketCap' : 'Single source'].filter(Boolean).join(', ') || 'N/A'}
News sentiment: ${coin.sentiment ? 'pos:' + coin.sentiment.positive + ' neg:' + coin.sentiment.negative + ' neut:' + coin.sentiment.neutral + ' score:' + coin.sentiment.sentimentScore : 'N/A'}
`;

  try {
    const { askAI } = await import('./aiProvider.js');
    const sys = 'Απάντησε στα Ελληνικά. Σύντομα, τεχνικά, χωρίς hype.';
    return await askAI(sys, [{ role: 'user', content: prompt }]);
  } catch (e) {
    return '[AI unavailable] ' + e.message;
  }
}

// ─────────────────────────────────────────────
// DATA FETCHERS (free public APIs, no keys required)
// ─────────────────────────────────────────────
// Retry wrapper: CoinGecko free tier rate-limits (429). Retry up to 3x with backoff.
async function fetchWithRetry(url, opts = {}, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, opts);
    if (res.ok) return res;
    if (res.status === 429 && attempt < retries) {
      const waitMs = 2000 * (attempt + 1); // 2s, 4s, 6s backoff
      console.warn(`[EarlySignal] CoinGecko 429 — retry ${attempt + 1}/${retries} in ${waitMs}ms`);
      await new Promise(r => setTimeout(r, waitMs));
      continue;
    }
    throw new Error(`CoinGecko request failed: ${res.status}`);
  }
  throw new Error('CoinGecko request failed after retries');
}

// Fetch GAINERS from CoinMarketCap (requires COINMARKETCAP_API_KEY, free tier).
// CMC "percent_change_24h desc" = coins moving up NOW. Used alongside CoinGecko
// trending for cross-source validation (a coin on BOTH lists is a stronger signal).
async function fetchCMCCoins() {
  const KEY = process.env.COINMARKETCAP_API_KEY;
  if (!KEY || KEY.trim() === '') return [];
  try {
    const url = `${CMC_BASE}/v1/cryptocurrency/listings/latest?start=1&limit=100&sort=percent_change_24h&sort_dir=desc&convert=USD&aux=num_market_pairs,date_added,tags,platform,cmc_rank`;
    const res = await fetch(url, { headers: { 'X-CMC_PRO_API_KEY': KEY.trim(), Accept: 'application/json' } });
    if (!res.ok) { console.error('[EarlySignal] CMC HTTP', res.status); return []; }
    const data = await res.json();
    if (data.status?.error_code !== 0) { console.error('[EarlySignal] CMC error:', data.status?.error_message); return []; }
    return (data.data || []).map(c => ({
      id: String(c.id),
      symbol: (c.symbol || '').toUpperCase(),
      name: c.name,
      market_cap: c.quote?.USD?.market_cap ?? 0,
      total_volume: c.quote?.USD?.volume_24h ?? 0,
      price_change_percentage_24h: c.quote?.USD?.percent_change_24h ?? 0,
      categories: c.tags || [],
      last_updated: c.last_updated,
      source: 'cmc'
    }));
  } catch (e) {
    console.error('[EarlySignal] fetchCMCCoins failed:', e.message);
    return [];
  }
}

export async function fetchNewCoins() {
  // MERGE two independent sources for cross-validation:
  //  - CoinGecko /search/trending → coins gaining attention NOW
  //  - CoinMarketCap gainers (percent_change_24h desc) → coins moving up NOW
  // A coin appearing on BOTH lists is a stronger early-signal candidate.
  const [geckoMarkets, cmcCoins] = await Promise.all([
    (async () => {
      try {
        const trendRes = await fetchWithRetry(`${COINGECKO_BASE}/search/trending`, { headers: { Accept: 'application/json' } });
        const trendData = await trendRes.json();
        const trendCoins = trendData.coins || [];
        if (!trendCoins.length) return [];
        const ids = trendCoins.map(c => c.item.id).join(',');
        const marketsRes = await fetchWithRetry(
          `${COINGECKO_BASE}/coins/markets?vs_currency=usd&ids=${encodeURIComponent(ids)}&order=market_cap_desc&per_page=100&page=1&sparkline=false&price_change_percentage=24h`,
          { headers: { Accept: 'application/json' } }
        );
        return await marketsRes.json();
      } catch (e) { console.error('[EarlySignal] CoinGecko fetch failed:', e.message); return []; }
    })(),
    fetchCMCCoins()
  ]);

  // Build a map keyed by SYMBOL (uppercased) so we can merge both sources
  const bySym = new Map();
  const now = Date.now();

  for (const c of geckoMarkets) {
    const sym = (c.symbol || '').toUpperCase();
    if (!sym) continue;
    bySym.set(sym, {
      id: c.id, symbol: sym, name: c.name,
      market_cap: c.market_cap || 0, total_volume: c.total_volume || 0,
      price_change_percentage_24h: c.price_change_percentage_24h || 0,
      categories: c.categories || [], last_updated: c.last_updated,
      fromGecko: true
    });
  }
  for (const c of cmcCoins) {
    const sym = (c.symbol || '').toUpperCase();
    if (!sym) continue;
    const existing = bySym.get(sym);
    if (existing) {
      existing.market_cap = existing.market_cap || c.market_cap;
      existing.total_volume = existing.total_volume || c.total_volume;
      existing.price_change_percentage_24h = existing.price_change_percentage_24h || c.price_change_percentage_24h;
      existing.fromCMC = true;
      existing.crossListed = true;
    } else {
      bySym.set(sym, {
        id: c.id, symbol: sym, name: c.name,
        market_cap: c.market_cap || 0, total_volume: c.total_volume || 0,
        price_change_percentage_24h: c.price_change_percentage_24h || 0,
        categories: c.categories || [], last_updated: c.last_updated,
        fromCMC: true
      });
    }
  }

  // Filter: real market cap (>0, excludes dead/bankrupt like FTT), cap <$200M,
  // decent volume (>$200k), recent data. crossListed coins get a bonus later.
  return Array.from(bySym.values()).filter(c => {
    const mc = c.market_cap || 0;
    const vol = c.total_volume || 0;
    const updated = c.last_updated ? Date.parse(c.last_updated) : 0;
    const isRecent = updated && (now - updated) < 30 * 24 * 60 * 60 * 1000;
    return mc > 0 && mc < 200_000_000 && vol > 200_000 && isRecent;
  });
}

async function checkBinanceListing(symbol) {
  // Validation: is this coin listed on Binance spot? (cheap signal)
  try {
    const r = await fetch(`${BINANCE_BASE}/ticker/price?symbol=${encodeURIComponent(symbol.toUpperCase())}USDT`);
    if (!r.ok) return false;
    const j = await r.json();
    return !!j.price;
  } catch {
    return false;
  }
}

async function buildCandidate(coin) {
  const sym = coin.symbol?.toUpperCase();
  const onBinance = await checkBinanceListing(sym || '');
  // Fetch news sentiment (CryptoPanic primary, CoinGecko fallback)
  const sentiment = await fetchSentiment(sym);
  return {
    id: coin.id,
    symbol: sym,
    name: coin.name,
    marketCap: coin.market_cap,
    volume24h: coin.total_volume,
    priceChange24h: coin.price_change_percentage_24h,
    categories: coin.categories || [],
    listedOnBinance: onBinance,
    crossListed: !!coin.crossListed, // set by fetchNewCoins merge (on both CoinGecko + CMC)
    sentiment: sentiment, // { positive, negative, neutral, total, sentimentScore }
    score: 0 // will be filled after AI thesis
  };
}

// ─────────────────────────────────────────────
// MAIN ORCHESTRATOR
// force=true bypasses cache and always rescans (manual Refresh button).
// force=false (default) returns cached data if fresh (<10 min).
// ─────────────────────────────────────────────
export async function getEarlySignals(force = false) {
  const now = Date.now();
  if (!force && cache.data && now - cache.ts < CACHE_TTL) {
    return cache.data;
  }

  try {
    const raw = await fetchNewCoins();
    if (!raw.length) return { available: true, candidates: [], note: 'No new low-cap coins matched filters.' };

    // Build candidates (parallel Binance checks)
    const candidates = await Promise.all(raw.slice(0, 60).map(buildCandidate));

    // Rank: Binance listing bonus + volume/market-cap ratio + cross-listed bonus
    candidates.forEach(c => {
      const mc = c.marketCap || 0;
      const vol = c.volume24h || 0;
      const volRatio = mc > 0 ? (vol / mc) * 100 : 0; // missing data → 0, not false 350M
      const crossBonus = c.crossListed ? 30 : 0;
      c.rawScore = volRatio + (c.listedOnBinance ? 20 : 0) + crossBonus;
    });
    candidates.sort((a, b) => b.rawScore - a.rawScore);

    // AI thesis on top-20 only (cost control)
    const top = candidates.slice(0, 20);
    for (const c of top) {
      c.thesis = await aiThesis(c);
      const m = c.thesis.match(/Risk score[:\s]+(\d+)/i);
      c.riskScore = m ? parseInt(m[1], 10) : 50;
      c.score = c.rawScore + (100 - c.riskScore); // higher = better
    }

    candidates.sort((a, b) => b.score - a.score);
    const result = {
      available: true,
      generatedAt: new Date().toISOString(),
      candidates: candidates.slice(0, 20),
      totalScanned: raw.length
    };

    // Always cache result (even on failure) to protect AI quota
    cache = { ts: now, data: result };
    return result;
  } catch (e) {
    const result = { available: false, error: e.message };
    cache = { ts: now, data: result }; // cache errors too
    return result;
  }
}
