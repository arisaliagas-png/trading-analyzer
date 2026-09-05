// ─────────────────────────────────────────────
// AI COACH 2.0 — Omniscient Intelligence Engine
// Full Application State Context, On-Demand Setup Generation & Zero Cost (Gemini/OpenRouter Free)
// ─────────────────────────────────────────────
import { askCoachAI } from './aiProvider.js';
import { getActiveSignals } from './scanner.js';
import { getAllTrades, getActiveTrades, getAllLessons, getLessonsFor, getDirectionalEdge } from './db.js';
import { getCapitalFlow } from './capitalFlow.js';
import { getCircuitBreakerState } from './riskManager.js';
import { getLiveIndicators } from './indicators.js';
import { getLiveFlow } from './liveFlow.js';
import { fetchAssetNews } from './newsSearch.js';
import { getWalls } from './liquidityStore.js';

// ── System Philosophy (Prótos Nómos) ──────────
const RULES = `SYSTEM PHILOSOPHY — «Πρώτος Νόμος»:
- ΠΟΤΕ μην κυνηγάς το κερί (No FOMO). Η αγορά έρχεται σε σένα στη ζώνη OTE (0.618 - 0.786 Fibonacci).
- Wait for the zone (SMC/OTE). Το setup πρέπει να έχει ξεκάθαρο λόγο (ΓΙΑΤΙ).
- Υπομονή = στρατηγική. Αν δεν υπάρχει καθαρό setup με R:R >= 1.5:1, ΔΕΝ μπαίνουμε στο trade.
- Trade Management: 70% TP1 (bank profit + SL to Break-Even), 30% TP2 (runner).
- Σεβασμός στα Whale Walls: Το SL τοποθετείται ΠΙΣΩ από μεγάλο τοίχο στήριξης, το TP ΠΡΙΝ από μεγάλο τοίχο αντίστασης.
- Lessons > Opinions: Μαθαίνουμε από τα προηγούμενα SL hits και δεν επαναλαμβάνουμε τα ίδια λάθη.`;

const ASSET_SYNONYMS = {
  'BTC': 'BTCUSDT', 'BITCOIN': 'BTCUSDT',
  'ETH': 'ETHUSDT', 'ETHEREUM': 'ETHUSDT',
  'SOL': 'SOLUSDT', 'SOLANA': 'SOLUSDT',
  'BNB': 'BNBUSDT',
  'XRP': 'XRPUSDT', 'RIPPLE': 'XRPUSDT',
  'SUI': 'SUIUSDT',
  'DOGE': 'DOGEUSDT', 'DOGECOIN': 'DOGECOIN',
  'ADA': 'ADAUSDT', 'CARDANO': 'ADAUSDT',
  'LINK': 'LINKUSDT', 'CHAINLINK': 'LINKUSDT',
  'AVAX': 'AVAXUSDT', 'AVALANCHE': 'AVAXUSDT',
  'DOT': 'DOTUSDT', 'POLKADOT': 'DOTUSDT',
  'NEAR': 'NEARUSDT',
  'FET': 'FETUSDT',
  'TAO': 'TAOUSDT',
  'HBAR': 'HBARUSDT',
  'RENDER': 'RENDERUSDT', 'RNDR': 'RENDERUSDT',
  'PEPE': 'PEPEUSDT',
  'SHIB': 'SHIBUSDT',
  'ATOM': 'ATOMUSDT',
  'ARB': 'ARBUSDT', 'ARBITRUM': 'ARBUSDT',
  'OP': 'OPUSDT', 'OPTIMISM': 'OPUSDT',
  'APT': 'APTUSDT', 'APTOS': 'APTUSDT',
  'INJ': 'INJUSDT', 'INJECTIVE': 'INJUSDT',
  'TIA': 'TIAUSDT', 'CELESTIA': 'TIAUSDT',
  'LTC': 'LTCUSDT', 'LITECOIN': 'LTCUSDT',
  'VET': 'VETUSDT',
  'UNI': 'UNIUSDT',
  'AAVE': 'AAVEUSDT',
  'SEI': 'SEIUSDT',
  'KAS': 'KASUSDT',
  'WIF': 'WIFUSDT',
  'BONK': 'BONKUSDT'
};

function extractQueriedAsset(msg) {
  if (!msg) return null;
  const clean = msg.toUpperCase();
  for (const [name, sym] of Object.entries(ASSET_SYNONYMS)) {
    const regex = new RegExp(`\\b${name}(?:USDT)?\\b`, 'i');
    if (regex.test(clean)) return sym;
  }
  const pairMatch = clean.match(/\b([A-Z]{2,10})(?:\/|USDT|\.P)\b/);
  if (pairMatch && pairMatch[1] && pairMatch[1].length >= 3) {
    return `${pairMatch[1]}USDT`;
  }
  return null;
}

/**
 * Builds on-demand deep technical & liquidity intelligence if an asset is mentioned
 */
async function buildAssetProfile(symbol) {
  try {
    const safeCall = (fn, fallback = null) =>
      Promise.resolve()
        .then(() => fn())
        .catch(() => fallback);

    const [ind1h, ind4h, flow, walls, edge, lessons, news] = await Promise.all([
      safeCall(() => getLiveIndicators(symbol, '1h'), null),
      safeCall(() => getLiveIndicators(symbol, '4h'), null),
      safeCall(() => getLiveFlow(symbol), null),
      safeCall(() => getWalls(symbol), []),
      safeCall(() => getDirectionalEdge(symbol), null),
      safeCall(() => getLessonsFor(symbol), []),
      safeCall(() => fetchAssetNews(symbol), [])
    ]);

    const price = flow?.midPrice || ind1h?.currentPrice || 0;
    const change24h = flow?.ticker?.change24h ?? 0;
    const vol24h = flow?.ticker?.quoteVolume ? `$${(flow.ticker.quoteVolume / 1000000).toFixed(1)}M` : 'n/a';

    const topBidWalls = walls.filter(w => w.side === 'bid').slice(0, 3).map(w => `$${w.price.toFixed(0)} (${w.maxQty.toFixed(1)} ${symbol.replace('USDT','')})`).join(', ') || 'none';
    const topAskWalls = walls.filter(w => w.side === 'ask').slice(0, 3).map(w => `$${w.price.toFixed(0)} (${w.maxQty.toFixed(1)} ${symbol.replace('USDT','')})`).join(', ') || 'none';

    const recentWhales = (flow?.whaleTrades || []).slice(0, 3).map(w => `${w.side} $${Math.round(w.usdValue / 1000)}K @ $${w.price}`).join(', ') || 'none';
    const recentNewsTitles = (news || []).slice(0, 3).map(n => `• "${n.title || n.headline}" (${n.sentiment || 'neutral'})`).join('\n') || 'none';
    const pastLessonsText = (lessons || []).slice(0, 3).map(l => `• ${l.lesson || l.failureReason || l}`).join('\n') || 'none';

    const adxVal = typeof ind1h?.adx === 'object' ? ind1h?.adx?.adx : (typeof ind1h?.adx === 'number' ? ind1h.adx : null);
    const rsiVal = typeof ind1h?.rsi === 'number' ? ind1h.rsi : null;
    const macdHist = ind1h?.macd?.histogram ?? (typeof ind1h?.macd === 'number' ? ind1h.macd : null);
    const ema20Val = typeof ind1h?.ema20 === 'number' ? ind1h.ema20 : null;
    const ema50Val = typeof ind1h?.ema50 === 'number' ? ind1h.ema50 : null;
    const ema200Val = typeof ind1h?.ema200 === 'number' ? ind1h.ema200 : null;
    const atrVal = typeof ind1h?.atr === 'number' ? ind1h.atr : null;

    return `=== LIVE ON-DEMAND INTELLIGENCE FOR ${symbol} ===
Current Price: $${price} | 24h Change: ${change24h > 0 ? '+' : ''}${change24h.toFixed(2)}% | 24h Vol: ${vol24h}

1H Indicators:
- RSI(14): ${rsiVal != null ? rsiVal.toFixed(1) : 'n/a'}
- EMA Structure: EMA20=$${ema20Val != null ? ema20Val.toFixed(2) : 'n/a'} | EMA50=$${ema50Val != null ? ema50Val.toFixed(2) : 'n/a'} | EMA200=$${ema200Val != null ? ema200Val.toFixed(2) : 'n/a'}
- MACD: ${macdHist != null ? (macdHist > 0 ? 'BULLISH' : 'BEARISH') : 'n/a'}
- ADX Trend Strength: ${adxVal != null ? adxVal.toFixed(1) : 'n/a'}
- ATR(14): $${atrVal != null ? atrVal.toFixed(2) : 'n/a'}

4H Trend:
- 4H Bias: ${ind4h ? (ind4h.currentPrice > (ind4h.ema200 || 0) ? 'BULLISH (above EMA200)' : 'BEARISH (below EMA200)') : 'n/a'}
- 4H RSI: ${typeof ind4h?.rsi === 'number' ? ind4h.rsi.toFixed(1) : 'n/a'}

Live Order Flow & Liquidity:
- CVD Volume Delta: ${flow?.moneyFlow?.cvd != null ? `${flow.moneyFlow.cvd > 0 ? '+' : ''}${flow.moneyFlow.cvd.toFixed(2)} (${flow.moneyFlow.cvd > 0 ? 'BUY FLOW' : 'SELL FLOW'})` : 'n/a'}
- Bid/Ask Pressure: ${flow?.moneyFlow?.bidRatio ?? 50}% Bids / ${flow?.moneyFlow?.askRatio ?? 50}% Asks
- Order Book Imbalance: +${flow?.moneyFlow?.imbalancePct ?? 0}% ${flow?.moneyFlow?.imbalanceSide ?? 'NEUTRAL'}
- Key Support Walls: ${topBidWalls}
- Key Resistance Walls: ${topAskWalls}
- Recent Large Whale Orders: ${recentWhales}

Asset Playbook Historical Edge:
${edge ? `- Long Win Rate: ${edge.LONG?.winRate != null ? edge.LONG.winRate + '%' : 'n/a'} | Short Win Rate: ${edge.SHORT?.winRate != null ? edge.SHORT.winRate + '%' : 'n/a'}` : '- No historical trade stats yet'}

Past Mistakes / Lessons on ${symbol}:
${pastLessonsText}

Recent Market News & Sentiment:
${recentNewsTitles}`;
  } catch (err) {
    return `=== LIVE ASSET DATA FOR ${symbol} ===\n(Live feed unavailable: ${err.message})`;
  }
}

/**
 * Builds the comprehensive omniscient application context
 */
export async function buildContext(userMessage = '') {
  const queriedAsset = extractQueriedAsset(userMessage);

  const safeCall = (fn, fallback = null) =>
    Promise.resolve()
      .then(() => fn())
      .catch(() => fallback);

  const [signals, activeTrades, allTrades, flow, edgeData, cbState, allLessons, assetProfile] = await Promise.all([
    safeCall(getActiveSignals, []),
    safeCall(getActiveTrades, []),
    safeCall(getAllTrades, []),
    safeCall(getCapitalFlow, { regimes: [], pairs: [] }),
    safeCall(getDirectionalEdge, {}),
    safeCall(getCircuitBreakerState, null),
    safeCall(getAllLessons, []),
    queriedAsset ? buildAssetProfile(queriedAsset) : Promise.resolve(null)
  ]);

  const fmtEntry = (e) => {
    if (e == null) return 'n/a';
    if (typeof e === 'object') return e.price ?? `${e.low}-${e.high}`;
    return e;
  };

  const sigLines = (signals || []).map(s => {
    const d = s.doi1h ?? s.flow?.doi1h ?? null;
    const fq = s.flowQuality ?? s.flow?.flowQuality ?? 'N/A';
    const cvd = s.cvdBias ?? s.flow?.cvdBias ?? null;
    return `- ${s.symbol} ${s.direction}: status=${s.status} strategy=${s.strategy || '?'} R:R=${s.plannedRR ?? '?'}:1 entry=${fmtEntry(s.entry)} tp1=${s.tp1} tp2=${s.tp2 || 'n/a'} sl=${s.sl} grade=${s.confidenceGrade || '?'} flow=${fq} cvd=${cvd ?? 'null'}`;
  }).join('\n') || '(no active scanner signals)';

  const tradeLines = (activeTrades || []).map(t => {
    const pnl = t.live_pnl != null ? `${t.live_pnl > 0 ? '+' : ''}${t.live_pnl.toFixed(2)}% (live)` : `${t.pnl != null ? (t.pnl > 0 ? '+' : '') + t.pnl.toFixed(2) : '—'}%`;
    return `- ${t.symbol} ${t.direction}: status=${t.status} entry=${fmtEntry(t.entry)} tp1=${t.tp1} tp2=${t.tp2 || 'n/a'} sl=${t.sl} current_sl=${t.current_sl || t.sl} PnL=${pnl}`;
  }).join('\n') || '(no open active trades)';

  // Closed trades win rate overview
  const closed = (allTrades || []).filter(t => t.status === 'SUCCESS' || t.status === 'FAILED' || t.status === 'PARTIAL');
  const wins = closed.filter(t => t.status === 'SUCCESS' || t.status === 'PARTIAL').length;
  const recentWinRate = closed.length > 0 ? ((wins / closed.length) * 100).toFixed(1) : 'N/A';

  const flowLines = [
    `Regimes: ${(flow.regimes || []).map(r => `${r.symbol}=${r.regime}`).join(', ') || 'n/a'}`,
    `Capital Flow: ${(flow.pairs || []).map(p => `${p.symbol} ΔOI=${p.doi1h ?? 'n/a'} CVD=${p.cvd ?? 'n/a'}`).join(', ') || 'n/a'}`
  ].join('\n');

  const edgeLines = [
    `Overall LONG Edge:  ${edgeData.LONG ? (edgeData.LONG.winRate != null ? edgeData.LONG.winRate + '% WR' : 'n/a') : 'n/a'} (${edgeData.LONG?.total ?? 0} trades)`,
    `Overall SHORT Edge: ${edgeData.SHORT ? (edgeData.SHORT.winRate != null ? edgeData.SHORT.winRate + '% WR' : 'n/a') : 'n/a'} (${edgeData.SHORT?.total ?? 0} trades)`
  ].join('\n');

  const recentLessons = (allLessons || []).slice(0, 4).map(l => `- [${l.symbol || 'SYSTEM'}] ${l.lesson || l.failureReason || l}`).join('\n') || '(none)';

  let fullContext = `=== SYSTEM & PORTFOLIO OVERVIEW ===
Closed Trades: ${closed.length} | Recent Win Rate: ${recentWinRate}% | Circuit Breaker: ${cbState?.tripped ? 'TRIPPED (Cooling Down)' : 'HEALTHY (Trading Active)'}

=== ACTIVE SCANNER SIGNALS ===
${sigLines}

=== OPEN ACTIVE TRADES (Live Positions) ===
${tradeLines}

=== CAPITAL FLOW & MARKET REGIME ===
${flowLines}

=== DIRECTIONAL PLAYBOOK EDGE ===
${edgeLines}

=== RECENT LESSONS LEARNED ===
${recentLessons}`;

  if (assetProfile) {
    fullContext += `\n\n${assetProfile}`;
  }

  fullContext += `\n\n${RULES}`;

  return fullContext;
}

export async function chatWithAI(userMessage, history = []) {
  const ctx = await buildContext(userMessage);

  const systemPrompt = `You are ARIS COACH (ΑΡΗΣ), the Omniscient Senior Institutional Crypto Trader & AI Copilot of the ARIS QUANTUM Platform.
You have real-time omniscient access to the entire application state, live Binance market indicators (1H & 4H), live Order Book depth walls, CVD volume delta, scanner signals, and active trades.

YOUR MISSION:
Deliver sharp, authoritative, institutional-level market analysis and actionable guidance. Always ground your answers strictly on the REAL DATA provided in the context.

RULES & GUIDANCE:
1. Language: Answer in natural, fluent, confident Greek (unless the user explicitly speaks English).
2. If the user asks for a SETUP or TRADING PLAN for an asset (e.g. BTC, ETH, SOL, SUI, etc.):
   Provide a complete, institutional ARIS SMC Setup:
   - 🧭 **ΚΑΤΕΥΘΥΝΣΗ (BIAS):** LONG / SHORT / WAIT (με σαφή αιτιολόγηση 1h/4h)
   - 🎯 **ΖΩΝΗ ΕΙΣΟΔΟΥ (Entry Zone):** Ακριβές εύρος OTE (0.618 - 0.786 Fibonacci) ή pullback
   - 🛑 **INVALIDATION / STOP LOSS:** Ακριβής τιμή SL (τοποθετημένο πίσω από key swing / whale wall)
   - 🏁 **ΣΤΟΧΟΙ TAKE PROFIT:**
     • **TP1 (70% Banking + Move SL to BE)**
     • **TP2 (30% Runner Target)**
   - 📊 **RISK-TO-REWARD (R:R):** Τουλάχιστον 1.5:1 (π.χ. 2.2:1)
   - ⚡ **ΣΥΝΕΡΓΙΕΣ & ΡΙΣΚΑ (Confluences):** EMA trend, RSI, CVD Flow, Whale Wall warnings
3. If the user asks about MARKET DIRECTION or a specific COIN'S TREND:
   Synthesize the 1H & 4H structure, EMA positions, CVD Buyer/Seller Flow, and Order Book Imbalance.
4. If the user asks about ACTIVE POSITIONS, SCANNER, or PORTFOLIO STATS:
   Give a precise summary of active trades, current PnL, and risk management status.
5. Respect «Πρώτος Νόμος»: Never encourage FOMO. Insist on patient limit entries at key zones.

Do not output any raw JSON or internal thought tags. Output clean, well-formatted, professional Markdown with bullet points and bold highlights.`;

  const messages = [
    ...history.slice(-6).map(h => ({
      role: h.role === 'assistant' ? 'assistant' : 'user',
      content: h.content
    })),
    {
      role: 'user',
      content: `${ctx}\n\nUSER QUESTION: ${userMessage}`
    }
  ];

  const reply = await askCoachAI(systemPrompt, messages);
  return reply;
}