/**
 * tradeTracker.js
 *
 * Background monitor that tracks open trades against live Binance prices.
 * On TP hit  → marks trade SUCCESS.
 * On SL hit  → marks trade FAILED and fires the AI post-mortem learning loop.
 *
 * All persistence is handled by db.js (SQLite).
 * No direct file I/O here.
 */

import fetch from 'node-fetch';
import {
  getActiveTrades,
  updateTradeStatus,
  recordPrice,
  saveLesson,
  hasRecentLesson,
  removeSignalByInstrument,
  getPriceHistory,
  markEnteredZone,
  expireStalePending,
  expireStaleActive,
  expireStaleNeedsConfirmation
} from './db.js';
import { analyzeChart } from './aiProvider.js';
import { trackerLog } from './logger.js';
import { onTradeClosed } from './riskManager.js';

// ─────────────────────────────────────────────
// PRICE FETCHER — multi-source
// Crypto pairs resolve via Binance; traditional instruments (metals, forex,
// indices) resolve via Twelve Data (if TWELVE_DATA_API_KEY is set) or Pyth.
// This prevents PENDING setups from stalling forever just because the
// instrument isn't on Binance (e.g. XAU/USD gold).
// ─────────────────────────────────────────────

// Map a user-supplied symbol to a canonical source + query symbol.
function resolveSymbol(sym) {
  const s = sym.toUpperCase().trim();
  const clean = s.replace(/[\/\.\-]/g, '').replace(/P$/i, ''); // strip separators; trailing P = perpetual suffix only
  // Any pair whose cleaned symbol ends in a stablecoin ticker is a crypto
  // spot/perp — always resolve via Binance. (Covers ALL alts, not just a
  // hardcoded list, so e.g. HYPEUSDT no longer falls through to traditional.)
  if (/USDT$|USDC$|BUSD$|FDUSD$/.test(clean)) {
    return { source: 'binance', query: clean };
  }
  // Traditional instruments → Twelve Data / Pyth use slash notation
  const tradMap = {
    'XAUUSD': 'XAU/USD', 'XAU/USD': 'XAU/USD', 'GOLD': 'XAU/USD',
    'XAGUSD': 'XAG/USD', 'XAG/USD': 'XAG/USD', 'SILVER': 'XAG/USD',
    'EURUSD': 'EUR/USD', 'GBPUSD': 'GBP/USD', 'USDJPY': 'USD/JPY',
    'AUDUSD': 'AUD/USD', 'NAS100': 'NASDAQ', 'US30': 'DOWJONES', 'SPX': 'SPX'
  };
  const canon = tradMap[s] || (s.includes('/') ? s : s.replace(/USD$/, '/USD').replace(/^(\w+)\/USD$/, '$1/USD'));
  return { source: 'traditional', query: canon };
}

async function fetchBinance(symbols) {
  const prices = {};
  await Promise.all(symbols.map(async (sym) => {
    const clean = sym.replace(/[\/\.\-]/g, '').replace(/P$/i, ''); // strip separators; trailing P = perpetual suffix only
    try {
      // Use klines to get recent low/high (wick-aware SL/TP detection)
      const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${clean}&interval=1m&limit=3`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length) {
          let low = Infinity, high = -Infinity, last = 0;
          for (const k of data) {
            const kLow = parseFloat(k[3]);
            const kHigh = parseFloat(k[2]);
            const kClose = parseFloat(k[4]);
            if (kLow < low) low = kLow;
            if (kHigh > high) high = kHigh;
            last = kClose;
          }
          // `price` = last close (used for SL/TP + zone checks)
          // `low`/`high` = min/max of the window (wick-aware SL/TP)
          // `close` = last candle close (same as price, explicit for clarity)
          prices[sym] = { price: last, low, high, close: last };
        }
      } else if (res.status === 400) {
        // Invalid symbol — try Hyperliquid (many alts/perps live there, not Binance)
        const hl = await fetchHyperliquid([sym]);
        if (hl[sym] != null) prices[sym] = { price: hl[sym], low: hl[sym], high: hl[sym] };
      }
    } catch { /* ignore per-symbol */ }
  }));
  return prices;
}

// Hyperliquid perpetuals — used as fallback when a symbol isn't on Binance
// (e.g. HYPEUSDT). API is free, no key required. Uses l2Book (mid from
// best bid/ask) since allMids uses opaque numeric IDs.
async function fetchHyperliquid(symbols) {
  const prices = {};
  for (const sym of symbols) {
    const clean = sym.replace(/[\/\.\-]/g, '').replace(/P$/i, '');
    const coin = clean.slice(0, -4); // HYPEUSDT -> HYPE
    try {
      const res = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'l2Book', coin })
      });
      if (!res.ok) continue;
      const j = await res.json();
      const bid = parseFloat(j?.levels?.[0]?.[0]?.px);
      const ask = parseFloat(j?.levels?.[1]?.[0]?.px);
      if (bid && ask) prices[sym] = { price: (bid + ask) / 2, low: (bid + ask) / 2, high: (bid + ask) / 2 };
    } catch { /* ignore */ }
  }
  return prices;
}

async function fetchTraditional(symbols) {
  const prices = {};
  const key = process.env.TWELVE_DATA_API_KEY;
  // Twelve Data path (preferred when key present)
  if (key) {
    await Promise.all(symbols.map(async (sym) => {
      try {
        const res = await fetch(`https://api.twelvedata.com/price?symbol=${encodeURIComponent(sym)}&apikey=${key}`);
        if (res.ok) {
          const data = await res.json();
          if (data?.price) prices[sym] = { price: parseFloat(data.price), low: parseFloat(data.price), high: parseFloat(data.price) };
        }
      } catch { /* ignore */ }
    }));
    return prices;
  }
  // Pyth fallback (no key) — best-effort; may be blocked in some environments
  const FEED_IDS = {
    'XAU/USD': '765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2'
  };
  for (const sym of symbols) {
    const id = FEED_IDS[sym];
    if (!id) continue;
    try {
      const res = await fetch(`https://hermes.pyth.network/v2/updates/price?ids%5B%5D=${id}`, { headers: { Accept: 'application/json' } });
      if (res.ok) {
        const j = await res.json();
        const p = j?.parsed?.[0]?.price;
        if (p) prices[sym] = { price: parseInt(p.price) / Math.pow(10, p.expo), low: parseInt(p.price) / Math.pow(10, p.expo), high: parseInt(p.price) / Math.pow(10, p.expo) };
      }
    } catch { /* ignore */ }
  }
  return prices;
}

async function fetchPrices(symbols) {
  if (!symbols.length) return {};
  const resolved = symbols.map(s => ({ original: s, ...resolveSymbol(s) }));
  const binanceSyms = resolved.filter(r => r.source === 'binance').map(r => r.query);
  const tradSymsRaw = resolved.filter(r => r.source === 'traditional').map(r => r.query);

  const [binancePrices, tradPrices] = await Promise.all([
    binanceSyms.length ? fetchBinance(binanceSyms) : Promise.resolve({}),
    tradSymsRaw.length ? fetchTraditional([...new Set(tradSymsRaw)]) : Promise.resolve({})
  ]);

  // Map binance + traditional results back to original user symbols
  const result = {};
  const binanceQueryToOriginal = {};
  for (const r of resolved.filter(r => r.source === 'binance')) {
    binanceQueryToOriginal[r.query] = r.original;
  }
  for (const [q, price] of Object.entries(binancePrices)) {
    const orig = binanceQueryToOriginal[q] || q;
    result[orig] = price;
  }
  const tradQueryToOriginal = {};
  for (const r of resolved.filter(r => r.source === 'traditional')) {
    tradQueryToOriginal[r.query] = r.original;
  }
  for (const [q, price] of Object.entries(tradPrices)) {
    const orig = tradQueryToOriginal[q];
    if (orig) result[orig] = price;
  }
  return result;
}


// ─────────────────────────────────────────────
// MAIN MONITOR LOOP
// ─────────────────────────────────────────────
// In-memory guard: IDs that already fired a post-mortem/win-review this session.
// Prevents duplicate AI calls if the DB write hasn't committed before the next poll.
const reviewedThisSession = new Set();

export async function monitorTrades() {
  // Expire stale PENDING setups that never entered their zone (24h cutoff)
  try { await expireStalePending(); } catch (e) { trackerLog.error({ err: e.message }, 'expireStalePending error'); }
  // Expire stale NEEDS_CONFIRMATION PENDING setups (12h deadlock cutoff)
  try { await expireStaleNeedsConfirmation(); } catch (e) { trackerLog.error({ err: e.message }, 'expireStaleNeedsConfirmation error'); }
  // Expire stale ACTIVE trades that never hit TP/SL (36h cutoff)
  try {
    const expired = await expireStaleActive();
    for (const t of expired) {
      triggerTimeoutPostMortem(t).catch(e =>
        trackerLog.error({ tradeId: t.id, err: e.message }, 'Timeout post-mortem failed')
      );
    }
  } catch (e) { trackerLog.error({ err: e.message }, 'expireStaleActive error'); }

  const activeTrades = await getActiveTrades(); // reads from SQLite
  if (!activeTrades.length) return;

  const uniqueSymbols = [...new Set(activeTrades.map(t => t.instrument))];
  const prices = await fetchPrices(uniqueSymbols);

  for (const trade of activeTrades) {
    // Skip if we already resolved this trade (DB write may not have committed yet)
    if (reviewedThisSession.has(trade.id)) continue;

    const cur = prices[trade.instrument];
    const currentPrice = cur?.price;
    const curLow = cur?.low ?? currentPrice;
    const curHigh = cur?.high ?? currentPrice;

    // Record price sample if we have one (pruned to last 50). We do NOT skip
    // the trade when price is missing — otherwise its history stays empty and
    // the PENDING→ACTIVE latch can never fire.
    if (currentPrice) await recordPrice(trade.id, currentPrice);

    const isLong = trade.direction === 'LONG';

    if (trade.status === 'PENDING') {
      // ── Confirmation gate ───────────────────────────────────────────────────
      // Setups the scanner emitted as WAIT/PENDING due to weak/conflicting signals
      // (bearish CVD into a LONG, lesson veto, flow downgrade, etc.) carry a
      // [NEEDS_CONFIRMATION] marker. They must NOT be auto-activated just because
      // price ticked into the OTE zone — that was the bug that fired bearish-CVD
      // LONGs which then stopped out. They only become tradeable when a fresh
      // scanner run upgrades them to ACTIVE (marker removed).
      if ((trade.reasoning || '').includes('[NEEDS_CONFIRMATION]')) {
        continue; // leave as PENDING; wait for scanner re-confirmation
      }
      // ── FIRST LAW: never chase the candle — let price come TO you ──
      // Activation requires the price to ENTER the zone AND the last candle to
      // CLOSE inside/at the zone edge (a pullback/retest that held), NOT a candle
      // that merely wicks through the zone while momentum carries it the other way.
      // LONG:  price must close >= entryLow (came down into zone, didn't rip through)
      //        and close <= entryHigh (still at/below the zone top — a retest, not a breakout)
      // SHORT: price must close <= entryHigh (came up into zone) and >= entryLow
      const close = cur?.close ?? currentPrice;
      const inZoneClose = isLong
        ? (close >= trade.entryLow && close <= trade.entryHigh)
        : (close <= trade.entryHigh && close >= trade.entryLow);
      // Fallback: if we have no fresh candle close, accept price-in-zone from history
      // (latched entered_zone=1 path below), but prefer the fresh close confirmation.
      let enteredZone = inZoneClose;

      if (!enteredZone) {
        const history = await getPriceHistory(trade.id);
        enteredZone = history.some(h => isLong
          ? (h.price <= trade.entryHigh && h.price >= trade.entryLow)
          : (h.price >= trade.entryLow  && h.price <= trade.entryHigh));
      }

      if (enteredZone) {
        await markEnteredZone(trade.id, currentPrice);
        trackerLog.info({ tradeId: trade.id, symbol: trade.instrument, price: currentPrice }, 'Trade now ACTIVE');
      } else if (currentPrice) {
        // ── Distance-based invalidation ───────────────────────────────────────
        // If price has moved AWAY from the entry zone (against the intended
        // direction), the setup is stale/dead — the market moved opposite to the
        // thesis. Cancel it so stale PENDINGs don't clog the board.
        // SHORT: price fell below entryLow → thesis invalid (should have rallied into zone)
        // LONG:  price rose above entryHigh → thesis invalid (should have dipped into zone)
        const entryMid = (trade.entryLow + trade.entryHigh) / 2;
        const distPct = Math.abs(currentPrice - entryMid) / entryMid * 100;
        const movedAway = isLong
          ? (currentPrice > trade.entryHigh)   // LONG but price rallied past zone
          : (currentPrice < trade.entryLow);   // SHORT but price dropped below zone
        const MAX_PENDING_DIST = 5; // % away from zone before we call it dead

        if (movedAway && distPct > MAX_PENDING_DIST) {
          await updateTradeStatus(trade.id, 'EXPIRED', null, trade.entry_price);
          await removeSignalByInstrument(trade.instrument, trade.direction);
          onTradeClosed('EXPIRED');
          trackerLog.warn({ tradeId: trade.id, symbol: trade.instrument, price: currentPrice, distPct: distPct.toFixed(2) }, '⚠️ PENDING setup invalidated — price moved away from zone (thesis dead)');
        }
      }

    } else if (trade.status === 'ACTIVE') {
      // Wick-aware hit detection: a candle wick can touch the level without the
      // close reaching it. We approximate by allowing a small tolerance band
      // around TP1/SL — if price came within WICK_TOLERANCE% of the level, treat
      // as a touch (prevents missed SL/TP on wicked candles).
      // Fallback to recent historyPrices if currentPrice snapshot missed the hit
      // (e.g. price wick-touched TP1/SL between polls and fell back).
      const WICK_TOL = 0.0015; // 0.15%
      const tp1Band = trade.tp1 * WICK_TOL;
      const slBand  = trade.sl * WICK_TOL;
      // Use the candle low/high (wick-aware) so a wick that touches SL/TP
      // between polls is caught even if price closed back away.
      const hitFromCandle = (level, band, isLow) => {
        // isLow=true → check candle LOW against level (for LONG SL / SHORT TP)
        // isLow=false → check candle HIGH against level (for LONG TP / SHORT SL)
        const ref = isLow ? curLow : curHigh;
        if (ref == null) return false;
        return isLong
          ? (isLow ? (ref <= level + band) : (ref >= level - band))
          : (isLow ? (ref >= level - band) : (ref <= level + band));
      };
      const hitTp1 = hitFromCandle(trade.tp1, tp1Band, false); // TP touched via HIGH (LONG) / LOW (SHORT)
      const hitSl  = hitFromCandle(trade.sl, slBand, true);    // SL touched via LOW (LONG) / HIGH (SHORT)

      if (trade.status === 'PARTIAL') {
        // Already partial-closed: 70% banked at TP1, SL moved to breakeven.
        // Now watching for TP2 (full win) or breakeven SL (still a win on net).
        const tp2Band = trade.tp2 * WICK_TOL;
        const hitTp2 = hitFromCandle(trade.tp2, tp2Band, false); // TP2 touched via HIGH (LONG) / LOW (SHORT)
        if (hitTp2) {
          reviewedThisSession.add(trade.id);
          await updateTradeStatus(trade.id, 'SUCCESS', currentPrice, trade.entry_price);
          await removeSignalByInstrument(trade.instrument, trade.direction);
          onTradeClosed('SUCCESS');
          trackerLog.info({ tradeId: trade.id, symbol: trade.instrument, price: currentPrice }, '🎯 PARTIAL trade hit TP2 — full SUCCESS (70%@TP1 + 30%@TP2)');
          // Win-review is now MANUAL (button on trade card) to save AI credits.
        } else if (hitSl) {
          // Breakeven SL hit: 70% already won at TP1, 30% exited at breakeven → net win.
          reviewedThisSession.add(trade.id);
          await updateTradeStatus(trade.id, 'SUCCESS', currentPrice, trade.entry_price);
          await removeSignalByInstrument(trade.instrument, trade.direction);
          onTradeClosed('SUCCESS');
          trackerLog.info({ tradeId: trade.id, symbol: trade.instrument, price: currentPrice }, '✅ PARTIAL trade hit breakeven SL — net WIN (70% banked @TP1)');
          // Win-review is now MANUAL (button on trade card) to save AI credits.
        }
      } else if (hitTp1) {
        // First TP1 hit: close 70% at TP1, move SL to breakeven, trail 30% to TP2.
        const entryPrice = trade.entry_price ?? trade.entryPrice;
        const beSl = entryPrice; // breakeven stop for the remaining 30%
        await updateTradeStatus(trade.id, 'PARTIAL', currentPrice, entryPrice, beSl);
        trackerLog.info({ tradeId: trade.id, symbol: trade.instrument, price: currentPrice }, '🔪 PARTIAL CLOSE: 70% @TP1, SL→breakeven, 30% trails to TP2');
        // Keep the signal alive (don't removeSignal) — still monitoring for TP2/BE.
        // Win review for the banked 70% portion is now MANUAL (button on trade card).

      } else if (hitSl) {
        // SL hit: record exit at the SL price (not the live price spike) for correct R.
        reviewedThisSession.add(trade.id);
        const slPrice = trade.sl;
        await updateTradeStatus(trade.id, 'FAILED', slPrice, trade.entry_price);
        await removeSignalByInstrument(trade.instrument, trade.direction);
        onTradeClosed('FAILED');
        trackerLog.warn({ tradeId: trade.id, symbol: trade.instrument, price: currentPrice }, '❌ Trade hit STOP LOSS');

        // Fire post-mortem asynchronously (don't block monitor loop)
        triggerPostMortem(trade).catch(e =>
          trackerLog.error({ tradeId: trade.id, err: e.message }, 'Post-mortem failed')
        );
      }
    }
  }
}

// ─────────────────────────────────────────────
// AI POST-MORTEM — Learning Loop
// ─────────────────────────────────────────────
async function triggerPostMortem(trade) {
  trackerLog.info({ tradeId: trade.id, symbol: trade.instrument }, 'Running AI post-mortem');

  // Dedupe: if the same instrument+direction already had a post-mortem in the
  // last 24h, skip the AI call — we already learned this lesson (saves credits
  // and avoids re-spamming the same lesson).
  if (await hasRecentLesson(trade.instrument, trade.direction)) {
    trackerLog.info({ tradeId: trade.id, symbol: trade.instrument }, 'Skipped post-mortem (same pair+direction learned <24h ago)');
    return;
  }

  const prompt = `
[POST-MORTEM ANALYSIS REQUEST]
A trade setup has failed (hit Stop Loss). Analyze the failure to extract actionable lessons.

TRADE METRICS:
- Instrument: ${trade.instrument}
- Direction: ${trade.direction}
- Entry Zone: $${trade.entryLow} - $${trade.entryHigh} (Ideal: $${trade.entryPrice})
- Stop Loss: $${trade.sl}
- Take Profit 1: $${trade.tp1}
- Indicator Snapshot at execution:
${JSON.stringify(trade.indicatorSnapshot || [], null, 2)}

- AI Reason at execution:
${trade.reasoning}

TASK:
Identify what went wrong. Did momentum indicators diverge? Was CVD negative?
Was there news pressure? Was the regime misidentified?
Produce a concise, actionable trading lesson (1-2 sentences) to prevent this mistake.

Return ONLY valid JSON (no markdown, no preamble):
{
  "failureReason": "Short explanation of what caused the stop loss hit",
  "lesson": "Actionable rule for the engine (e.g., 'Do not enter LONG when 4H CVD is strictly declining')"
}
`;

  const response = await analyzeChart(
    null, null,
    trade.instrument,
    trade.timeframe,
    'POST_MORTEM_OVERRIDE',
    null,
    prompt,
    null
  );

  // response is already a validated object (Zod checked in aiProvider)
  const analysis = (typeof response === 'object' && response !== null) ? response : {};

  if (!analysis.failureReason || !analysis.lesson) {
    throw new Error('Post-mortem response missing required fields.');
  }

  // Enrich with exit analytics (what price stopped us out, and the realized R)
  const exitPrice = trade.closePrice ?? trade.close_price ?? null;
  const risk = (trade.entryPrice != null && trade.sl != null) ? Math.abs(trade.entryPrice - trade.sl) : 0;
  const realizedR = (exitPrice != null && risk > 0)
    ? ((trade.direction === 'SHORT')
        ? (trade.entryPrice - exitPrice) / risk
        : (exitPrice - trade.entryPrice) / risk)
    : null;
  analysis.exitPrice = exitPrice;
  analysis.realizedR = realizedR != null ? +realizedR.toFixed(2) : null;

  // Persist lesson to SQLite
  await saveLesson(trade, analysis);
  trackerLog.info({ tradeId: trade.id, symbol: trade.instrument, lesson: analysis.lesson, realizedR: analysis.realizedR }, 'Lesson saved');
}

// ─────────────────────────────────────────────
// TIMEOUT POST-MORTEM — learn from STALE setups
// A trade that stayed ACTIVE for 96h+ without hitting TP/SL (e.g. weekend Forex
// closure, or a setup the market simply never resolved) is expired as EXPIRED.
// This is different from a hard SL: the trade didn't fail, it just never
// resolved. We still want to learn: did it enter the zone? did price stall?
// ─────────────────────────────────────────────
async function triggerTimeoutPostMortem(trade) {
  trackerLog.info({ tradeId: trade.id, symbol: trade.instrument }, 'Running timeout post-mortem (stale ACTIVE)');

  // Dedupe: skip if same pair+direction learned <24h ago
  if (await hasRecentLesson(trade.instrument, trade.direction)) {
    trackerLog.info({ tradeId: trade.id, symbol: trade.instrument }, 'Skipped timeout post-mortem (same pair+direction learned <24h ago)');
    return;
  }

  const prompt = `
[TIMEOUT POST-MORTEM REQUEST]
A trade setup stayed OPEN for ${ACTIVE_EXPIRY_HOURS}+ hours (ACTIVE) without hitting either Take Profit or Stop Loss, then was auto-expired. This is a STALE setup, not a hard loss — but it tied up capital and blocked fresh scanner signals for the symbol.

TRADE METRICS:
- Instrument: ${trade.instrument}
- Direction: ${trade.direction}
- Entry Zone: $${trade.entryLow} - $${trade.entryHigh} (Ideal: $${trade.entryPrice})
- Stop Loss: $${trade.sl}
- Take Profit 1: $${trade.tp1}
- Entered zone: ${trade.entered_zone ? 'YES (price reached entry zone)' : 'NO (price never entered the zone)'}
- Indicator Snapshot at execution:
${JSON.stringify(trade.indicatorSnapshot || [], null, 2)}

- AI Reason at execution:
${trade.reasoning}

TASK:
Explain WHY this setup stalled instead of resolving (e.g. entered zone but range-bound, never triggered; or never entered because momentum died; or weekend Forex closure froze price action). Then produce ONE actionable rule to avoid tying up capital on non-resolving setups (e.g. 'Expire ACTIVE setups faster if price enters zone but shows <X% movement in N hours' or 'Require momentum continuation confirmation after zone entry').

Return ONLY valid JSON (no markdown, no preamble):
{
  "failureReason": "Short explanation of why the setup stalled (stale, not a loss)",
  "lesson": "Actionable rule for the engine (e.g., 'For range-bound entries, set a tighter max-hold; expire if no TP/SL progress within 24h of zone entry')"
}
`;

  const response = await analyzeChart(
    null, null,
    trade.instrument,
    trade.timeframe,
    'TIMEOUT_POST_MORTEM_OVERRIDE',
    null,
    prompt,
    null
  );

  const analysis = (typeof response === 'object' && response !== null) ? response : {};

  if (!analysis.failureReason || !analysis.lesson) {
    throw new Error('Timeout post-mortem response missing required fields.');
  }

  // A timeout is not a realized loss — mark R as null (no exit price)
  analysis.exitPrice = null;
  analysis.realizedR = null;
  analysis.failureReason = `[STALE/TIMEOUT] ${analysis.failureReason}`;

  await saveLesson(trade, analysis);
  trackerLog.info({ tradeId: trade.id, symbol: trade.instrument, lesson: analysis.lesson }, 'Timeout lesson saved');
}

// ─────────────────────────────────────────────
// WIN REVIEW — learn from SUCCESS that under-delivered R
// If a winning trade closed with materially less R than its plan promised,
// ask the AI why we left R on the table and store it as a lesson.
// ─────────────────────────────────────────────
async function triggerWinReview(trade, closePrice) {
  try {
    const entry = trade.entryPrice ?? trade.entry?.price;
    const sl    = trade.sl;
    if (entry == null || sl == null) return;

    const risk = Math.abs(entry - sl);
    if (risk === 0) return;

    // Realized R from the actual close price
    const realizedR = (trade.direction === 'SHORT')
      ? (entry - closePrice) / risk
      : (closePrice - entry) / risk;

    // Planned/theoretical R (use tp2 if present, else tp1)
    const plannedTarget = trade.tp2 ?? trade.tp1;
    const plannedR = (trade.direction === 'SHORT')
      ? (entry - plannedTarget) / risk
      : (plannedTarget - entry) / risk;

    // Only review when we left a meaningful amount of R on the table
    const shortfall = plannedR - realizedR;
    if (shortfall < 0.3) {
      trackerLog.info({ tradeId: trade.id, realizedR: realizedR.toFixed(2), plannedR: plannedR.toFixed(2) }, 'Win review skipped — R capture acceptable');
      return;
    }

    trackerLog.info({ tradeId: trade.id, symbol: trade.instrument }, 'Running AI win review (under-delivered R)');

    const prompt = `
[WIN REVIEW REQUEST]
A trade setup WON (hit Take Profit) but captured less reward than planned.

TRADE METRICS:
- Instrument: ${trade.instrument}
- Direction: ${trade.direction}
- Entry: $${entry}
- Stop Loss: $${sl}
- Planned Target (TP2/TP1): $${plannedTarget}
- Realized Close Price: $${closePrice}
- Realized R: ${realizedR.toFixed(2)}R
- Planned R: ${plannedR.toFixed(2)}R
- R shortfall (left on table): ${shortfall.toFixed(2)}R
- Indicator Snapshot at execution:
${JSON.stringify(trade.indicatorSnapshot || [], null, 2)}

- AI Reason at execution:
${trade.reasoning}

TASK:
Explain WHY the trade captured less R than planned (e.g. early exit, trailed stop too tight,
price reversed before TP2, news scare, weak momentum). Then produce ONE actionable rule
to improve R-capture next time — without becoming reckless (still respect invalidation).

Return ONLY valid JSON (no markdown, no preamble):
{
  "missedReason": "Short explanation of why realized R < planned R",
  "lesson": "Actionable rule for the engine (e.g., 'Let TP2 run unless MTF flips bearish; only trail SL to breakeven after TP1, not beyond')"
}
`;

    const response = await analyzeChart(
      null, null,
      trade.instrument,
      trade.timeframe,
      'WIN_REVIEW_OVERRIDE',
      null,
      prompt,
      null
    );

    const analysis = (typeof response === 'object' && response !== null) ? response : {};
    if (!analysis.missedReason || !analysis.lesson) {
      throw new Error('Win review response missing required fields.');
    }

    // Enrich with exit analytics (already computed above)
    analysis.exitPrice = closePrice;
    analysis.realizedR = +realizedR.toFixed(2);
    analysis.failureReason = `Under-delivered R (${realizedR.toFixed(2)}R vs ${plannedR.toFixed(2)}R planned)`;

    await saveLesson(trade, analysis);
    trackerLog.info({ tradeId: trade.id, symbol: trade.instrument, lesson: analysis.lesson, realizedR: analysis.realizedR }, 'Win-review lesson saved');
  } catch (e) {
    trackerLog.error({ tradeId: trade.id, err: e.message }, 'Win review error');
  }
}

// ─────────────────────────────────────────────
// PUBLIC: register a new trade setup
// ─────────────────────────────────────────────
export { registerTrade as registerTradeSetup } from './db.js';
export { triggerWinReview };

// ─────────────────────────────────────────────
// START BACKGROUND MONITOR (every 30s)
// ─────────────────────────────────────────────
export function startTracker() {
  trackerLog.info('Starting Live Trade Monitor (5s interval)');
  setInterval(() => {
    monitorTrades().catch(e => trackerLog.error({ err: e.message }, 'monitorTrades error'));
  }, 5000);
}
