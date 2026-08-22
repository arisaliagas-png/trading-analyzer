/**
 * scanner.js
 *
 * On-demand market scanner.
 * Scanning is MANUAL — triggered only via POST /api/scanner/run.
 * No setInterval, no auto-scan. Zero AI calls unless the user presses the button.
 *
 * All persistence is handled by db.js (SQLite).
 */

import { getLiveIndicators } from './indicators.js';
import { analyzeChart }      from './aiProvider.js';
import { aggregator }         from './heatmap.js';
import { fetchAssetNews }     from './newsSearch.js';
import { getLessonsFor }      from './db.js';
import { scannerLog } from './logger.js';

// ─────────────────────────────────────────────
// LESSON-APPLICATION LAYER (hard veto)
// ─────────────────────────────────────────────
// The post-mortem loop records failed trades as free-text lessons in SQLite.
// Those lessons are injected into the AI prompt (aiProvider.js ASSET CONSTRAINTS)
// but the AI frequently ignores them. This function enforces them as HARD rules
// derived from the same metrics the lessons describe (volume, squeeze, orderbook),
// so a setup that contradicts a recorded failure mode is downgraded to WAIT.
//
// Rules (data-driven, mirror the recorded lessons #4/#5/#6/#7/#10/#11/#12):
//   R1 Volume:  relativeVolume.ratio < 0.3  → veto (any direction)
//   R2 Squeeze: squeeze.state==='RELEASED' && squeeze.direction opposes tradeDir → veto
//   R3 Bookmap: liveCvdBias opposes tradeDir (SHORT + BULL bookmap, or LONG + BEAR) → veto
function applyLessonVeto({ engine, tradeDir, liveCvdBias }) {
  const violated = [];
  const reasons = [];

  // Only enforce if we have at least one recorded lesson for this symbol+direction
  // (the lesson DB is the gate — no lesson, no veto; we don't block on first encounter)
  let hasLesson = false;
  try {
    const dir = tradeDir === 'LONG' ? 'LONG' : 'SHORT';
    const lessons = getLessonsFor(engine.symbol || '', dir);
    hasLesson = Array.isArray(lessons) && lessons.length > 0;
  } catch { /* DB not ready — skip veto */ }

  if (!hasLesson) return { veto: false, reason: null, violatedRules: [] };

  // R1 — Volume Engine too weak for continuation
  const volRatio = engine.relativeVolume?.ratio ?? 1;
  if (volRatio < 0.3) {
    violated.push('R1_VOLUME');
    reasons.push(`Volume Engine ${volRatio.toFixed(2)}x < 0.3x (weak continuation — lesson #11)`);
  }

  // R2 — Squeeze already released against our direction
  const sq = engine.squeeze || {};
  if (sq.state === 'RELEASED') {
    const sqDir = sq.direction; // BULLISH / BEARISH / NEUTRAL
    const opposes = (tradeDir === 'LONG' && sqDir === 'BEARISH') ||
                    (tradeDir === 'SHORT' && sqDir === 'BULLISH');
    if (opposes) {
      violated.push('R2_SQUEEZE');
      reasons.push(`Squeeze RELEASED+${sqDir} opposes ${tradeDir} (lesson #4/#6/#7/#10/#12)`);
    }
  }

  // R3 — Live order-book flow opposes direction
  if (liveCvdBias) {
    const bookOpposes = (tradeDir === 'LONG' && liveCvdBias === 'BEAR') ||
                        (tradeDir === 'SHORT' && liveCvdBias === 'BULL');
    if (bookOpposes) {
      violated.push('R3_BOOKMAP');
      reasons.push(`Live order-book CVD bias ${liveCvdBias} opposes ${tradeDir} (lesson #5)`);
    }
  }

  if (violated.length === 0) return { veto: false, reason: null, violatedRules: [] };
  return {
    veto: true,
    reason: `LESSON VETO [${violated.join(',')}]: ${reasons.join('; ')}`,
    violatedRules: violated
  };
}
import { calcPositionSize, getCircuitBreakerState } from './riskManager.js';
import {
  upsertSignal,
  removeSignalByInstrument,
  getActiveTrades,
  hasActiveTrade,
  clearIsNew
} from './db.js';

// ─────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────
const ASSETS_TO_SCAN = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
  'ADAUSDT', 'LINKUSDT', 'DOGEUSDT', 'AVAXUSDT', 'DOTUSDT', 'LTCUSDT'
];

const SCAN_TIMEFRAME = '1h';

// Build an order-book context string from the live heatmap aggregator
// (mirrors the logic used by the Analyzer's /api/analyze route).
function buildOrderbookContext() {
  if (!aggregator.running || aggregator.midPrice === 0) return null;
  try {
    const snap = aggregator.getSnapshot();
    const f = (val) => {
      if (val == null) return '0';
      return val < 1 ? val.toFixed(5) : val < 1000 ? val.toFixed(3) : val.toFixed(2);
    };
    const topBids = snap.bids.slice(0, 5).map(b => `$${f(b.price)}(${b.qty.toFixed(1)}${b.isWhale ? '🐳' : ''})`);
    const topAsks = snap.asks.slice(0, 5).map(a => `$${f(a.price)}(${a.qty.toFixed(1)}${a.isWhale ? '🐳' : ''})`);
    const mf = snap.moneyFlow || {};
    const whaleWalls = (snap.stableWhaleWalls && snap.stableWhaleWalls.length)
      ? snap.stableWhaleWalls
      : (snap.whaleWalls || []);

    return `LIVE ORDER BOOK (${snap.symbol} from ${snap.sources?.join('+') || 'exchanges'}, 6 exchanges): ` +
      `Mid=$${f(snap.midPrice)} | Bids: ${topBids.join(' ')} | Asks: ${topAsks.join(' ')} | ` +
      `Pressure: ${mf.bidPct ?? '?'}% BUY / ${mf.askPct ?? '?'}% SELL | ` +
      `CVD: ${mf.cvd > 0 ? '+' : ''}${mf.cvd ?? 0} | Bias: ${(mf.bias || '?').toUpperCase()}` +
      (whaleWalls.length ? ` | Stable Whale Walls: ${whaleWalls.map(w => `${w.side === 'bid' ? '🟢' : '🔴'}$${f(w.price)}`).join(' ')}` : '');
  } catch (e) {
    console.warn('[scanner] orderbook ctx error:', e.message);
    return null;
  }
}

// Build an indicator context string from already-fetched live indicators
// (mirrors the Analyzer's indicatorContext formatting).
function buildIndicatorContext(ind, symbol, timeframe) {
  if (!ind || !ind.available) return null;
  const f = (v) => (v == null ? '?' : typeof v === 'number' ? v.toFixed(2) : v);
  const aris = ind.arisContext || '';
  return `LIVE TECHNICAL INDICATORS (${symbol} ${timeframe}): ` +
    `Current Price=$${f(ind.currentPrice)} | EMA20=$${f(ind.ema20)} | EMA50=$${f(ind.ema50)} | ` +
    `EMA200=$${f(ind.ema200)} | POC=$${f(ind.poc)} | RSI(14)=${f(ind.rsi)} | ` +
    `MACD Hist=${f(ind.macd?.histogram)} | ADX: Val=${f(ind.adx?.adx)}, DI+=${f(ind.adx?.pdi)}, DI-=${f(ind.adx?.mdi)}` +
    (aris ? `\n${aris}` : '');
}

// ─────────────────────────────────────────────
// SCAN SINGLE ASSET
// ─────────────────────────────────────────────
async function scanAsset(symbol, scanId) {
  try {
    // Skip if a trade is already being tracked for this symbol
    if (await hasActiveTrade(symbol)) {
      scannerLog.info({ symbol, scanId }, 'Skipping — active/pending trade already tracked');
      return null;
    }

    // 1. Fetch live indicators + ARIS engine
    // Pull live order-book context (whale walls + CVD bias) from the running
    // heatmap aggregator so the engine SEES real flow, not just candle geometry.
    let liveWhaleWalls = [];
    let liveCvdBias = null;
    try {
      const snap = aggregator.getSnapshot();
      if (snap && snap.stableWhaleWalls && snap.stableWhaleWalls.length) {
        liveWhaleWalls = snap.stableWhaleWalls;
      } else if (snap && snap.whaleWalls && snap.whaleWalls.length) {
        liveWhaleWalls = snap.whaleWalls;
      }
      if (snap && snap.moneyFlow && snap.moneyFlow.bias) {
        const b = snap.moneyFlow.bias; // 'buy' | 'sell' | 'neutral'
        liveCvdBias = b === 'buy' ? 'BULL' : b === 'sell' ? 'BEAR' : null;
      }
    } catch { /* aggregator not ready — fall back to candle-derived bias */ }

    // 1b. Fetch real-time news BEFORE building the engine context, so the
    // newsSentiment actually reaches getLiveIndicators (and the AI prompt).
    let newsContext = null;
    try { newsContext = await fetchAssetNews(symbol); } catch { newsContext = null; }

    const ind = await getLiveIndicators(symbol, SCAN_TIMEFRAME, liveWhaleWalls, null, '', liveCvdBias, newsContext?.sentimentScore ?? null);
    if (!ind.available || !ind.aris) return null;

    const engine = ind.aris;

    const hasSetup = engine.executionStrategy &&
                     engine.executionStrategy !== 'WAIT' &&
                     engine.executionStrategy !== 'NO_SETUP' &&
                     engine.ote != null;

    const hasDecentScore = (engine.megaScore ?? 0) >= 8;

    // Freshness Guard: Ensure the pivot (Swing High/Low) is relatively recent (max 8 candles old)
    // to prevent entering stale setups that have already played out.
    let pivotAge = 0;
    if (engine.swings) {
      const lastBarIdx = 250 - 1; // getLiveIndicators pulls 250 candles
      const swingIdx = engine.direction === 'LONG' ? engine.swings.swingLowIndex : engine.swings.swingHighIndex;
      if (swingIdx != null) {
        pivotAge = lastBarIdx - swingIdx;
      }
    }

    const MAX_PIVOT_AGE = 100; // 100h on 1h chart — generous; a pivot 66-94 candles old is still a valid SMC setup.
    const isFresh = pivotAge <= MAX_PIVOT_AGE;

    if (!hasSetup || !hasDecentScore || !isFresh) {
      await removeSignalByInstrument(symbol);
      const reason = !isFresh ? `stale swing pivot (${pivotAge} candles old)` : 'no valid setup';
      scannerLog.info({ symbol, scanId, strategy: engine.executionStrategy, score: engine.megaScore, pivotAge }, `Skipped — ${reason}`);
      return null;
    }

    // 2. AI verification (text-only mode)
    scannerLog.info({ symbol, scanId, strategy: engine.executionStrategy, score: engine.megaScore }, 'Candidate found — requesting AI verification');

    const ote = engine.ote;
    const f = v => v?.toFixed(4) ?? '?';

    const prompt = `
[SCANNER AUTO VERIFICATION REQUEST]
The quantitative engine detected a structural setup on ${symbol} (${SCAN_TIMEFRAME}). Verify this setup.

ENGINE SNAPSHOT:
- Mega Score: ${engine.megaScore}/${engine.maxScore ?? 25}
- Regime: ${engine.regime} (Choppiness: ${engine.choppiness?.toFixed(1)}, Threshold: ${engine.dynThreshold})
- Direction: ${engine.direction}
- Strategy: ${engine.executionStrategy}
- Confidence: ${engine.confidenceGrade} (${engine.confidencePct?.toFixed(1)}%)
- IDC Status: ${engine.idcStatus}
- Computed Entry Zone: $${f(ote.entry?.low)} - $${f(ote.entry?.high)} (Ideal: $${f(ote.entry?.price)})
- Computed SL: $${f(ote.sl)}
- Computed TP1/2: TP1=$${f(ote.tp1)} | TP2=$${f(ote.tp2)}
- SM Trap: ${engine.smTrap ?? 'NONE'}
- CVD Bias: ${engine.cvdBias} | UFO: ${engine.ufoScore?.toFixed(0)}%
- Squeeze: ${engine.squeeze?.state} / ${engine.squeeze?.direction}
- Whale Absorption: ${engine.whaleAbsorption?.signal ?? 'NONE'}
|- Market Structure: ${engine.structure?.trend ?? 'N/A'} (BOS: ${engine.structure?.bos ?? false}, CHoCH: ${engine.structure?.choch ?? false})
|- Live Order-Book CVD Bias: ${liveCvdBias ?? 'N/A (fallback to candle-derived)'}
|- Real-News Sentiment: ${newsContext?.sentimentScore != null ? (newsContext.sentimentScore > 0.15 ? 'BULLISH' : newsContext.sentimentScore < -0.15 ? 'BEARISH' : 'NEUTRAL') : 'N/A'}
|- Indicator Data:
${ind.arisContext ?? ''}

TASK:
Verify if this setup is valid under ARIS V6.0 smart money rules.
Consider: MTF alignment, momentum, trap signals, whale absorption, and squeeze state.
- If momentum strongly opposes direction → WAIT
- If minor conflicts exist → PENDING
- If cleanly aligned → ACTIVE

Return ONLY valid JSON (no markdown, no extra text):
{
  "setupStatus": "ACTIVE|PENDING|WAIT",
  "confidenceGrade": "A+|A|B+|B|C|D",
  "confidencePct": number,
  "reasoning": "1-sentence trade verification note"
}
`;

    // 2b. Build live contexts (order book, indicators, news) — same as Analyzer
    // so the scanner sees the SAME data the AI would see in a full analysis.
    // NOTE: newsContext is already fetched above (before getLiveIndicators) — reuse it here.
    const orderbookContext = buildOrderbookContext();
    const indicatorContext = buildIndicatorContext(ind, symbol, SCAN_TIMEFRAME);

    const aiResponse = await analyzeChart(
      null, null,
      symbol, SCAN_TIMEFRAME,
      'SCANNER_VERIFY',
      null,           // orderbookContext — ignored in SCANNER_VERIFY mode (userPrompt = indicatorContext)
      prompt,         // indicatorContext — THIS is what becomes the userPrompt when hints === 'SCANNER_VERIFY'
      newsContext
    );

    // aiResponse is already Zod-validated as ScannerVerifySchema
    const aiResult = (typeof aiResponse === 'object' && aiResponse !== null)
      ? aiResponse
      : { setupStatus: 'PENDING', confidenceGrade: engine.confidenceGrade ?? 'C', confidencePct: engine.confidencePct ?? 50, reasoning: 'Engine-verified setup.' };

    // Defensive fallback: if the AI returned a null/undefined grade or pct
    // (e.g. schema mismatch swallowed upstream), fall back to the quant engine's
    // own computed grade so the UI never shows a blank "Grade %".
    const finalGrade = aiResult.confidenceGrade ?? engine.confidenceGrade ?? 'C';
    const finalPct   = aiResult.confidencePct   ?? engine.confidencePct   ?? 50;

    scannerLog.info({ symbol, scanId, status: aiResult.setupStatus, grade: finalGrade, pct: finalPct }, 'AI verification result');

    // 2c. Price-in-zone gate: if current price is NOT inside the OTE entry zone,
    // the setup is not yet triggerable — force PENDING (never ACTIVE). This prevents
    // firing "ACTIVE" on a setup the market has already left behind (e.g. ADAUSDT
    // where price was 0.1821-0.1838 but the zone was 0.1857-0.1859).
    const zoneLow  = ote.entry?.low;
    const zoneHigh = ote.entry?.high;
    const priceNow = ind.currentPrice;
    const inZone = zoneLow != null && zoneHigh != null && priceNow != null &&
      priceNow >= Math.min(zoneLow, zoneHigh) && priceNow <= Math.max(zoneLow, zoneHigh);
    if (!inZone && aiResult.setupStatus === 'ACTIVE') {
      scannerLog.info({ symbol, scanId, priceNow, zoneLow, zoneHigh }, 'Price outside OTE zone — downgrading ACTIVE → PENDING');
      aiResult.setupStatus = 'PENDING';
      aiResult.reasoning = `[PRICE OUTSIDE OTE ZONE $${zoneLow}-$${zoneHigh}, now $${priceNow}] ` + (aiResult.reasoning || '');
    }

    // 3. Geometry sanity check
    const tradeDir   = ote.direction;
    const idealEntry = ote.entry?.price;
    const tp1Val     = ote.tp1;
    const slVal      = ote.sl;

    const longOk  = tradeDir === 'LONG'  && tp1Val > idealEntry && slVal < idealEntry;
    const shortOk = tradeDir === 'SHORT' && tp1Val < idealEntry && slVal > idealEntry;

    if (!longOk && !shortOk) {
      scannerLog.warn({ symbol, scanId, direction: tradeDir, entry: idealEntry, sl: slVal, tp1: tp1Val }, 'Rejected — geometry invalid');
      await removeSignalByInstrument(symbol);
      return null;
    }

    // 4. Minimum 1.0:1 R:R check
    const riskDist   = Math.abs(idealEntry - slVal);
    const rewardDist = Math.abs(tp1Val - idealEntry);
    const rr = riskDist > 0 ? rewardDist / riskDist : 0;

    if (rr < 1.0) {
      scannerLog.warn({ symbol, scanId, rr }, 'Rejected — R:R too low');
      await removeSignalByInstrument(symbol);
      return null;
    }

    scannerLog.info({ symbol, scanId, direction: tradeDir, rr }, 'Geometry OK');

    // 4b. Minimum SL distance guard (widen, don't reject).
    // High-beta coins (BNB/HYPE/SOL/DOGE/AVAX/ADA/VET/LINK/DOT) need wider stops;
    // if the engine's computed SL is too tight (<1.0% general, <1.5% high-beta),
    // widen it in-place so the trade stays alive (a too-tight SL gets wicked out).
    const HIGH_BETA = ['BNB','HYPE','SOL','DOGE','AVAX','ADA','VET','LINK','DOT'];
    const minSlPct = HIGH_BETA.some(b => symbol.startsWith(b)) ? 1.5 : 1.0;
    const slDistPct = idealEntry > 0 ? (Math.abs(idealEntry - slVal) / idealEntry) * 100 : 0;
    let signalRr = rr;
    if (slDistPct < minSlPct) {
      const widenDir = tradeDir === 'LONG' ? -1 : 1; // SL sits opposite entry
      const newSl = idealEntry * (1 + widenDir * (minSlPct / 100));
      scannerLog.warn({ symbol, scanId, oldSl: slVal, newSl, minSlPct }, 'Widening SL to minimum distance');
      ote.sl = newSl;
      // Recompute dependent values with the widened SL
      const newRiskDist = Math.abs(idealEntry - newSl);
      const newRr = newRiskDist > 0 ? rewardDist / newRiskDist : 0;
      signalRr = newRr;
    }

    // 4b2. ATR-FLOOR SL VETO (structural SL depth — PTS "SL ≥ 1×ATR" rule).
    // A structurally too-tight stop loses measured (PTS data: WR 15% when SL<0.8×ATR).
    //   • slRisk < 0.8×ATR  → HARD VETO (reject entirely, like a structural fail)
    //   • 0.8×ATR ≤ slRisk < 1.0×ATR → DOWNGRADE to PENDING + note (floor breached)
    // The widen logic above is %-based and can still produce a stop narrower than
    // ATR on volatile assets, so this catches the volatility-adjusted case.
    const atr14 = engine.atr14 ?? null;
    const slRisk = Math.abs(idealEntry - ote.sl);
    let atrFloorDowngrade = false;
    let atrFloorReason = null;
    if (atr14 != null && atr14 > 0) {
      const slAtrRatio = slRisk / atr14;
      if (slAtrRatio < 0.8) {
        scannerLog.warn({ symbol, scanId, slRisk, atr14, ratio: slAtrRatio.toFixed(2) }, 'ATR-FLOOR VETO — SL < 0.8×ATR (structurally too tight)');
        await removeSignalByInstrument(symbol);
        return null;
      } else if (slAtrRatio < 1.0) {
        atrFloorDowngrade = true;
        atrFloorReason = `SL ${(slAtrRatio * 100).toFixed(0)}% of ATR — below 1×ATR structural floor (≥1×ATR required)`;
        scannerLog.warn({ symbol, scanId, slRisk, atr14, ratio: slAtrRatio.toFixed(2) }, 'ATR-FLOOR DOWNGRADE — SL < 1×ATR');
      }
    }

    // 4c. LESSON-APPLICATION LAYER (hard veto)
    // If this symbol+direction has recorded failures, enforce the lessons as
    // data-driven rules. A violation downgrades the setup to PENDING (WAIT) so it
    // is NOT auto-executed, but stays in the DB for re-scan when conditions clear.
    const veto = applyLessonVeto({ engine, tradeDir, liveCvdBias });
    let lessonVetoReason = null;
    if (veto.veto) {
      lessonVetoReason = veto.reason;
      scannerLog.warn({ symbol, scanId, direction: tradeDir, violated: veto.violatedRules }, 'LESSON VETO — downgrading to PENDING');
    }

    // 5. Accept grades ≥ C and statuses ACTIVE/PENDING.
    // WAIT is treated as PENDING (kept in DB for re-scan) — the engine isn't
    // ready yet but the setup is real, so we don't delete it.
    const effectiveStatus = (veto.veto || atrFloorDowngrade)
      ? 'PENDING'
      : (aiResult.setupStatus === 'WAIT' ? 'PENDING' : aiResult.setupStatus);
    if (aiResult.confidenceGrade !== 'D') {

      // ── [4A] Deterministic position sizing (no AI involvement) ──
      const sizing = calcPositionSize(
        ote.entry?.price,
        ote.sl,
        aiResult.confidenceGrade,
        effectiveStatus
      );

      // Deterministic id (symbol+direction) so repeated scans UPDATE the
      // same row instead of inserting duplicates. The Supabase upsert uses
      // onConflict:'id', and the SQLite upsert keys off instrument+direction,
      // so a stable id guarantees both backends dedupe correctly.
      const signal = {
        id:           `${symbol}_${tradeDir}`,
        symbol,
        timeframe:    SCAN_TIMEFRAME,
        direction:    tradeDir,
        entry:        ote.entry,
        sl:           ote.sl,
        targets:      [ote.tp1, ote.tp2],
        rr:           parseFloat((signalRr ?? rr).toFixed(2)),
        status:       effectiveStatus,
        grade:        finalGrade,
        pct:          finalPct,
        reasoning:    (lessonVetoReason ? `[LESSON VETO] ${lessonVetoReason} ` : '') + (atrFloorReason ? `[ATR-FLOOR] ${atrFloorReason} ` : '') + (aiResult.reasoning || ''),
        timestamp:    new Date().toISOString(),
        // ── Risk fields (server-computed, not AI) ──
        positionSize: sizing.positionSize,
        riskAmount:   sizing.riskAmount,
        riskPct:      sizing.riskPct,
        sizingNote:   sizing.note,
        // ── Zone invalidation (PTS "ακύρωση" rule): price closing beyond this
        // level without reclaim cancels the setup BEFORE it reaches the SL. ──
        invalidation: tradeDir === 'LONG'
          ? (ote.entry?.high ?? ote.entry?.price)
          : (ote.entry?.low ?? ote.entry?.price),
        atr14:        atr14 ?? null,
        // Risk metadata persisted inside indicator_snapshot JSON (Supabase has no
        // dedicated columns for these) so the UI can show ATR-floor + invalidation.
        indicators: [
          { __risk: true, invalidation: (tradeDir === 'LONG'
              ? (ote.entry?.high ?? ote.entry?.price)
              : (ote.entry?.low ?? ote.entry?.price)),
            atr14: atr14 ?? null, atrFloor: atrFloorReason || null }
        ]
      };

      // Upsert into SQLite (locks original levels if symbol already exists)
      await upsertSignal(signal);

      // Register in trade tracker (same DB — idempotent via INSERT OR IGNORE)
      try {
        const { registerTradeSetup } = await import('./tradeTracker.js');
        const riskMeta = {
          __risk: true,
          invalidation: signal.invalidation,
          atr14: signal.atr14,
          atrFloor: atrFloorReason || null
        };
        registerTradeSetup({
          id:         signal.id,
          instrument: symbol,
          timeframe:  SCAN_TIMEFRAME,
          bias:       tradeDir === 'LONG' ? 'bullish' : 'bearish',
          entry:      ote.entry,
          sl:         ote.sl,
          targets:    [ote.tp1, ote.tp2],
          indicators: ind.arisContext ? [ind.arisContext, riskMeta] : [riskMeta],
          grade:      finalGrade,
          pct:        finalPct,
          reasoning:  `[SCANNER] ${aiResult.reasoning || ''}`
        });
      } catch (trackErr) {
        console.error(`[Scanner] Failed to register in tracker:`, trackErr.message);
      }

      return signal;
    } else {
      scannerLog.info({ symbol, scanId, status: aiResult.setupStatus, grade: aiResult.confidenceGrade }, 'Rejected by AI');
      await removeSignalByInstrument(symbol);
    }

  } catch (e) {
    scannerLog.error({ symbol, scanId, err: e.message }, 'Scan error');
  }
  return null;
}

// ─────────────────────────────────────────────
// SCAN ALL ASSETS
// ─────────────────────────────────────────────
export async function scanAllAssets() {
  const scanId = `scan_${Date.now()}`;
  scannerLog.info({ scanId, count: ASSETS_TO_SCAN.length }, 'Scan started');

  // Warm up the live heatmap aggregator so the scanner sees the SAME order-book
  // data the Analyzer does. Start on the first asset and let it fill (~12s).
  try {
    aggregator.setSymbol(ASSETS_TO_SCAN[0]);
    if (!aggregator.running) aggregator.start();
    await new Promise(r => setTimeout(r, 12000));
  } catch (e) {
    scannerLog.warn({ scanId, err: e.message }, 'Heatmap warm-up failed — scanner will proceed without order-book context');
  }

  for (const asset of ASSETS_TO_SCAN) {
    try { aggregator.setSymbol(asset); } catch { /* non-fatal */ }
    await scanAsset(asset, scanId);
    await new Promise(r => setTimeout(r, 2000)); // 2s pause between assets
  }
  scannerLog.info({ scanId }, 'Scan complete');
}

// ─────────────────────────────────────────────
// ACTIVE SIGNALS FOR FRONTEND
// Returns all ACTIVE/PENDING trades from SQLite.
// Marks isNew flag as cleared 5s after serving.
// ─────────────────────────────────────────────
export async function getActiveSignals() {
  const trades = await getActiveTrades();

  // Schedule isNew flag clear (5s delay so frontend sees it once)
  trades
    .filter(t => t.isNew)
    .forEach(t => setTimeout(async () => { await clearIsNew(t.id); }, 5000));

  return trades;
}

// ─────────────────────────────────────────────
// SCAN STATE (for frontend progress display)
// ─────────────────────────────────────────────
let scanState = { isScanning: false, lastScanAt: null, lastScanDuration: null };

export async function getScanState() {
  const cb = getCircuitBreakerState();
  return {
    ...scanState,
    activeCount:    await getActiveTrades().length,
    circuitBreaker: cb
  };
}

// ─────────────────────────────────────────────
// INITIALISE — called at server boot
// Loads existing signals from DB into memory state.
// Does NOT auto-scan.
// ─────────────────────────────────────────────
export async function startScanner() {
  const count = await getActiveTrades().length;
  scannerLog.info({ activeSignals: count }, 'Scanner ready — waiting for manual trigger');
}

// ─────────────────────────────────────────────
// MANUAL SCAN TRIGGER — POST /api/scanner/run
// ─────────────────────────────────────────────
export async function triggerManualScan() {
  // ── [4B] Circuit breaker check ──
  const cb = getCircuitBreakerState();
  if (cb.tripped) {
    scannerLog.warn({ consecutiveFails: cb.consecutiveFails }, 'Scan blocked by circuit breaker');
    throw new Error(cb.message);
  }

  if (scanState.isScanning) {
    throw new Error('A scan is already in progress.');
  }
  scanState.isScanning = true;
  scanState.lastScanAt = new Date().toISOString();
  const t0 = Date.now();
  try {
    await scanAllAssets();
    scanState.lastScanDuration = Date.now() - t0;
  } finally {
    scanState.isScanning = false;
  }
}

// Legacy export aliases (used in tradeTracker.js dynamic import)
export { removeSignalByInstrument as removeActiveSignal };
