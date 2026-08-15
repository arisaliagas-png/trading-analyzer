/**
 * newsSearch.js - Tavily API real-time news for ARIS Quantum Trading Analyzer
 * - Returns null silently if TAVILY_API_KEY is missing (no crash)
 * - Caches results 10 min per symbol to preserve free-tier credits
 * - 1 credit per basic search (free tier: 1000/month)
 */

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';
const SERPER_ENDPOINT = 'https://google.serper.dev/search';
const CACHE_TTL_MS    = 10 * 60 * 1000;

// In-memory cache: { [symbol]: { ts, content } }
const _cache = {};

function buildQuery(symbol) {
  const base = symbol
    .replace(/USDT$/, '').replace(/USD$/, '').replace(/BUSD$/, '')
    .replace(/\.P$/i, '').toUpperCase();

  const names = {
    BTC:'Bitcoin', ETH:'Ethereum', SOL:'Solana', BNB:'BNB Binance',
    XRP:'Ripple XRP', ADA:'Cardano', DOGE:'Dogecoin', AVAX:'Avalanche',
    DOT:'Polkadot', LINK:'Chainlink', NEAR:'NEAR Protocol', ARB:'Arbitrum',
    OP:'Optimism', MATIC:'Polygon MATIC', APT:'Aptos', SUI:'Sui Network',
    INJ:'Injective', TIA:'Celestia', SEI:'Sei Network',
    WIF:'dogwifhat', PEPE:'PEPE memecoin', SHIB:'Shiba Inu',
  };

  const fullName = names[base] || base;
  return `${base} ${fullName} crypto news today price analysis 2026`;
}

// ── Serper fallback: if Tavily fails or is missing, try Serper.dev ──
// Serper returns Google search results (news + web). Free tier ~2500 queries.
async function fetchSerper(symbol, maxResults) {
  const key = process.env.SERPER_API_KEY;
  if (!key || key.trim() === '') return null;
  const query = buildQuery(symbol);
  try {
    const res = await fetch(SERPER_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': key.trim(),
      },
      body: JSON.stringify({ q: query, num: maxResults, gl: 'us', hl: 'en' }),
    });
    if (!res.ok) { console.error(`[News] Serper HTTP ${res.status}`); return null; }
    const data = await res.json();
    const lines = [];
    if (data.news && data.news.length) {
      lines.push(`MARKET NEWS SUMMARY FOR ${symbol} (Serper Google News):`);
      data.news.slice(0, maxResults).forEach((r, i) => {
        const title = (r.title || '').trim();
        const snippet = (r.snippet || '').trim().slice(0, 220);
        const date = r.date ? ` [${r.date.slice(0, 10)}]` : '';
        lines.push(`${i + 1}. ${title}${date}`);
        if (snippet) lines.push(`   "${snippet}..."`);
      });
    } else if (data.organic && data.organic.length) {
      lines.push(`MARKET NEWS SUMMARY FOR ${symbol} (Serper Web):`);
      data.organic.slice(0, maxResults).forEach((r, i) => {
        const title = (r.title || '').trim();
        const snippet = (r.snippet || '').trim().slice(0, 220);
        lines.push(`${i + 1}. ${title}`);
        if (snippet) lines.push(`   "${snippet}..."`);
      });
    }
    return lines.length ? lines.join('\n') : null;
  } catch (e) {
    console.error('[News] Serper fetch failed:', e.message);
    return null;
  }
}

export async function fetchAssetNews(symbol, maxResults = 5) {
  const cleanSym = symbol.replace(/\.P$/i, '').replace(/USDT$/, '').toUpperCase();

  // Cache check
  const cached = _cache[cleanSym];
  if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
    console.log(`[News] Cache hit for ${cleanSym}`);
    return cached.content;
  }

  const query = buildQuery(symbol);

  // ── Primary: Tavily ──
  const tavilyKey = process.env.TAVILY_API_KEY;
  if (tavilyKey && tavilyKey.trim() !== '') {
    console.log(`[News] Fetching Tavily: "${query}"`);
    try {
      const res = await fetch(TAVILY_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tavilyKey.trim()}`,
        },
        body: JSON.stringify({
          query,
          search_depth: 'basic',
          max_results: maxResults,
          include_answer: true,
          include_raw_content: false,
          include_images: false,
          topic: 'finance',
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const lines = [];

        if (data.answer) {
          lines.push(`MARKET NEWS SUMMARY FOR ${cleanSym} (Tavily AI):`);
          lines.push(data.answer.trim());
          lines.push('');
        }

        if (data.results && data.results.length > 0) {
          lines.push('RECENT ARTICLES:');
          data.results.slice(0, maxResults).forEach((r, i) => {
            const title   = (r.title || '').trim();
            const snippet = (r.content || '').trim().slice(0, 220);
            const date    = r.published_date ? ` [${r.published_date.slice(0, 10)}]` : '';
            lines.push(`${i + 1}. ${title}${date}`);
            if (snippet) lines.push(`   "${snippet}..."`);
          });
        }

        if (lines.length > 0) {
          const content = lines.join('\n');
          _cache[cleanSym] = { ts: Date.now(), content };
          console.log(`[News] Cached news for ${cleanSym}`);
          return content;
        }
      } else {
        console.error(`[News] Tavily HTTP ${res.status} — falling back to Serper`);
      }
    } catch (err) {
      console.error('[News] Tavily fetch failed, trying Serper:', err.message);
    }
  }

  // ── Fallback: Serper ──
  console.log(`[News] Trying Serper fallback for ${cleanSym}`);
  const serperContent = await fetchSerper(cleanSym, maxResults);
  if (serperContent) {
    _cache[cleanSym] = { ts: Date.now(), content: serperContent };
    return serperContent;
  }

  return null;
}

export function clearNewsCache(symbol) {
  if (symbol) {
    const clean = symbol.replace(/\.P$/i, '').replace(/USDT$/, '').toUpperCase();
    delete _cache[clean];
  } else {
    Object.keys(_cache).forEach(k => delete _cache[k]);
  }
}
