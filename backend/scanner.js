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
import { getMacroOverlay }     from './capitalFlow.js';
import { getDeltaOI }         from './capitalFlow.js';
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

  // R4 — Candle/Footprint flow conflict (from SHORT post-mortems):
  //   SHORT + bullish CMF (+0.1281) opposed bearish bias, or extreme BUY FP
  //   imbalance (> +300k) during a RELEASED/BULLISH squeeze → short trap.
  //   Mirrored for LONG. Only fires when conviction is weak (mega < 15), EXCEPT
  //   for extreme FP imbalance which is an unconditional trap regardless of score.
  const cmf = engine.cmf ?? 0;
  const fpImb = engine.fpImbalance ?? 0; // + = buy-side imbalance, - = sell-side
  const score = engine.megaScore ?? 0;
  if (tradeDir === 'SHORT') {
    if (cmf > 0.05 && score < 15) {
      violated.push('R4_FLOW');
      reasons.push(`Bullish CMF ${cmf.toFixed(3)} opposes SHORT with weak conviction (mega ${score}/28) — long-flow trap (lesson ETHUSDT)`);
    }
    if (fpImb > 300000) {
      violated.push('R4_FLOW');
      reasons.push(`Extreme BUY FP imbalance (+${(fpImb/1000).toFixed(0)}k) invalidates SHORT — squeeze breakout trap (lesson DOTUSDT)`);
    }
  } else if (tradeDir === 'LONG') {
    if (cmf < -0.05 && score < 15) {
      violated.push('R4_FLOW');
      reasons.push(`Bearish CMF ${cmf.toFixed(3)} opposes LONG with weak conviction (mega ${score}/28) — short-flow trap`);
    }
    if (fpImb < -300000) {
      violated.push('R4_FLOW');
      reasons.push(`Extreme SELL FP imbalance (${(fpImb/1000).toFixed(0)}k) invalidates LONG — squeeze breakout trap`);
    }
  }

  // R5 — Entry OUTSIDE OTE zone with low conviction (from SHORT lesson:
  //   price OUTSIDE OTE + mega 12/28 + C-grade = late/exhausted entry).
  //   Symmetric — fires when price has NOT retested the optimal entry and the
  //   mega score is too low to justify a premature entry.
  const oteInside = engine.oteRetest === true;
  if (!oteInside && score < 15) {
    violated.push('R5_OTE');
    reasons.push(`Entry OUTSIDE OTE zone with low conviction (mega ${score}/28) — late/exhausted entry trap (lesson ETHUSDT/DOTUSDT)`);
  }

  // R6 — Counter-trend entry in a TREND regime (from SHORT lessons #5/#9/#21):
  //   SHORT into confirmed uptrend (ADX≥25, structure UP) or LONG into downtrend
  //   with only a single resistance rejection = fade-of-strong-move trap.
  //   Symmetric: fires when tradeDir opposes the structural trend under TREND regime.
  const regime = engine.regime || 'RANGE';
  const structTrend = engine.structure?.trend || null; // 'UP' | 'DOWN' | null
  if (regime === 'TREND' && structTrend) {
    const opposes = (tradeDir === 'SHORT' && structTrend === 'UP') ||
                    (tradeDir === 'LONG' && structTrend === 'DOWN');
    if (opposes) {
      violated.push('R6_TREND');
      reasons.push(`Counter-trend ${tradeDir} in TREND regime (structure ${structTrend}) — fade-of-strong-move trap (lesson ADAUSDT/BTCUSDT)`);
    }
  }

  // R7 — Tight SL / insufficient volatility buffer (from SHORT lessons #16/#18):
  //   SL placed too close to entry (<0.5% buffer) gets wicked out by normal
  //   intrabar volatility before the directional move develops.
  //   Symmetric — checks the computed SL distance vs entry as a % of price.
  const ote = engine.ote || {};
  const entry = ote.entry ?? ote.entryPrice ?? null;
  const sl = ote.sl ?? null;
  if (entry != null && sl != null && entry > 0) {
    const slDistPct = tradeDir === 'SHORT'
      ? Math.abs((sl - entry) / entry) * 100
      : Math.abs((entry - sl) / entry) * 100;
    if (slDistPct < 0.5) {
      violated.push('R7_SL');
      reasons.push(`Stop Loss too tight (${slDistPct.toFixed(2)}% buffer < 0.5%) — normal volatility wick-out trap (lesson BNBUSDT/ADAUSDT)`);
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
  updateTradeMeta,
  hasActiveTrade,
  clearIsNew
} from './db.js';

// ─────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────
const ASSETS_TO_SCAN = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
  'ADAUSDT', 'LINKUSDT', 'DOGEUSDT', 'AVAXUSDT', 'DOTUSDT', 'LTCUSDT',
  'SUIUSDT', 'SEIUSDT', 'NEARUSDT', 'FETUSDT', 'HBARUSDT'
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
async function scanAsset(symbol, scanId, macro = null) {
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
- SM Trap: ${engine.smTrap?.type ?? 'NONE'}
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
    const finalPct   = Math.min(100, (aiResult.confidencePct ?? engine.confidencePct ?? 50) + obConfluence * 5);

    scannerLog.info({ symbol, scanId, status: aiResult.setupStatus, grade: finalGrade, pct: finalPct }, 'AI verification result');

    // 2c. Price-in-zone gate: if current price is NOT inside the OTE entry zone,
    // the setup is not yet triggerable — force PENDING (never ACTIVE). This prevents
    // firing "ACTIVE" on a setup the market has already left behind (e.g. ADAUSDT
    // where price was 0.1821-0.1838 but the zone was 0.1857-0.1859).
    const zoneLow  = ote.entry?.low;
    const zoneHigh = ote.entry?.high;
    const priceNow = ind.currentPrice;
    // Allow ACTIVE if price is INSIDE zone OR within 1.5% of it (near-zone entry).
    const zoneMid = (zoneLow != null && zoneHigh != null) ? (zoneLow + zoneHigh) / 2 : null;
    const zoneWidth = (zoneLow != null && zoneHigh != null) ? Math.abs(zoneHigh - zoneLow) : 0;
    const nearZonePct = zoneMid != null && zoneMid > 0 ? Math.abs(priceNow - zoneMid) / zoneMid * 100 : 999;
    const inZone = zoneLow != null && zoneHigh != null && priceNow != null &&
      (priceNow >= Math.min(zoneLow, zoneHigh) && priceNow <= Math.max(zoneLow, zoneHigh) ||
       nearZonePct <= 2.5);  // within 2.5% of zone center = acceptable entry
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

    // 4d. MACRO OVERLAY (F&G + DXY-proxy) — PTS-style sentiment/headwind filter.
    // A structurally-sound BUY into extreme greed or a strengthening USD is a
    // euphoria/headwind trap; a SHORT into extreme fear is a capitulation trap.
    // Downgrade to PENDING (not auto-execute) but keep it for re-scan.
    let macroDowngrade = false;
    let macroReason = null;
    if (macro && macro.available !== false) {
      const fg = macro.fgValue;
      const dxyUp = macro.dxyDirection === 'UP';
      if (tradeDir === 'LONG') {
        if (fg != null && fg >= 75) {
          macroDowngrade = true;
          macroReason = `F&G ${fg} (EXTREME GREED) — euphoria risk, tightening BUY conviction`;
        } else if (dxyUp) {
          macroDowngrade = true;
          macroReason = `DXY rising (${macro.dxyChange}%) — USD headwind, crypto risk-off`;
        }
      } else if (tradeDir === 'SHORT') {
        if (fg != null && fg <= 25) {
          macroDowngrade = true;
          macroReason = `F&G ${fg} (EXTREME FEAR) — capitulation zone, SHORT trap risk`;
        }
      }
      if (macroDowngrade) scannerLog.warn({ symbol, scanId, fg, dxy: macro.dxyDirection }, 'MACRO OVERLAY DOWNGRADE — ' + macroReason);
    }

    // 4e. DELTA OPEN INTEREST (1h) — PTS "ΔOI1h" flow-quality signal.
    // Combines with CVD to separate genuine new flow from short-covering / long-flush:
    //   LONG  + ΔOI↑ + CVD↑ = STRONG BUILD (reinforce)
    //   LONG  + ΔOI↓ + CVD↑ = SHORT COVERING (weak BUY — soft downgrade)
    //   SHORT + ΔOI↑ + CVD↓ = STRONG BUILD (reinforce)
    //   SHORT + ΔOI↓ + CVD↓ = LONG FLUSH (weak SHORT — soft downgrade)
    // Soft downgrade only (PENDING) when flow is weak, never a hard veto — OI is
    // a confluence filter, not a structural gate.
    let flowDowngrade = false;
    let flowReason = null;
    let doi1h = null;
    let flowQuality = 'N/A';
    try {
      const doi = await getDeltaOI(symbol);
      if (doi?.available) {
        doi1h = doi.doi1h;
        const cvdBull = (liveCvdBias === 'BULL') || (engine.cvdBias === 'BULL');
        const cvdBear = (liveCvdBias === 'BEAR') || (engine.cvdBias === 'BEAR');
        if (tradeDir === 'LONG') {
          if (doi1h > 0.3 && cvdBull) { flowQuality = 'STRONG_BUY_BUILD'; }
          else if (doi1h < -0.3 && cvdBull) {
            flowQuality = 'SHORT_COVERING';
            flowDowngrade = true;
            flowReason = `ΔOI1h ${doi1h}% (falling) + CVD bullish = short-covering, not new demand — weak BUY`;
          }
          else if (doi1h > 0.3 && cvdBear) { flowQuality = 'BUY_INTO_SELLING'; flowDowngrade = true; flowReason = `ΔOI1h ${doi1h}% (rising) + CVD bearish = buying into whale distribution — weak LONG, do NOT auto-execute`; }
          else flowQuality = 'NEUTRAL';
        } else { // SHORT
          if (doi1h > 0.3 && cvdBear) { flowQuality = 'STRONG_SELL_BUILD'; }
          else if (doi1h < -0.3 && cvdBear) {
            flowQuality = 'LONG_FLUSH';
            flowDowngrade = true;
            flowReason = `ΔOI1h ${doi1h}% (falling) + CVD bearish = long-flush, not new supply — weak SHORT`;
          }
          else if (doi1h > 0.3 && cvdBull) { flowQuality = 'SELL_INTO_BUYING'; flowDowngrade = true; flowReason = `ΔOI1h ${doi1h}% (rising) + CVD bullish = selling into whale accumulation — weak SHORT, do NOT auto-execute`; }
          else flowQuality = 'NEUTRAL';
        }
        if (flowDowngrade) scannerLog.warn({ symbol, scanId, doi1h, cvd: liveCvdBias || engine.cvdBias }, 'FLOW WEAK (ΔOI) — ' + flowReason);
      }
    } catch { /* non-fatal */ }

    // 4f. ORDER-BOOK CONFLUENCE BONUS — real limit-order walls confirm setup.
    // Uses stableWhaleWalls (persisted >threshold = real, not spoofing).
    // A wall on the "right" side of price confirms the SMC level; a wall inside
    // or near the OTE zone is a strong confluence signal. Adds bonus points.
    let obConfluence = 0;
    let obNote = null;
    try {
      const snap = aggregator.getSnapshot();
      const walls = snap.stableWhaleWalls || [];
      const zoneMid = (ote.entry?.low != null && ote.entry?.high != null)
        ? (ote.entry.low + ote.entry.high) / 2 : null;
      for (const w of walls) {
        const distPct = zoneMid != null && zoneMid > 0
          ? Math.abs(w.price - zoneMid) / zoneMid * 100 : 999;
        if (distPct > 3) continue; // only walls near the setup zone
        const sideOk = (tradeDir === 'SHORT' && (w.side === 'bid' || w.side === 'ask')) ||
                       (tradeDir === 'LONG'  && (w.side === 'bid' || w.side === 'ask'));
        if (sideOk) {
          obConfluence += 2;
          obNote = `[OB-CONFLUENCE] ${w.side} wall at $${w.price} (${distPct.toFixed(1)}% from zone) confirms ${tradeDir}`;
          break;
        }
      }
    } catch { /* non-fatal */ }

    // 5. Accept grades ≥ C and statuses ACTIVE/PENDING.
    // WAIT is treated as PENDING (kept in DB for re-scan) — the engine isn't
    // ready yet but the setup is real, so we don't delete it.
    const effectiveStatus = (veto.veto || atrFloorDowngrade || macroDowngrade || flowDowngrade)
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
        reasoning:    (lessonVetoReason ? `[LESSON VETO] ${lessonVetoReason} ` : '') + (atrFloorReason ? `[ATR-FLOOR] ${atrFloorReason} ` : '') + (macroReason ? `[MACRO] ${macroReason} ` : '') + (flowReason ? `[FLOW] ${flowReason} ` : '') + (obNote ? `${obNote} ` : '') + (aiResult.reasoning || ''),
        timestamp:    new Date().toISOString(),
        // ── Macro overlay (F&G + DXY) — PTS-style sentiment/headwind filter ──
        fgValue:      macro?.fgValue ?? null,
        dxyDirection: macro?.dxyDirection ?? null,
        dxyChange:    macro?.dxyChange ?? null,
        // ── Flow quality (ΔOI1h + CVD confluence) — PTS "ΔOI1h" signal ──
        doi1h:        doi1h ?? null,
        flowQuality:  flowQuality ?? 'N/A',
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
            atr14: atr14 ?? null, atrFloor: atrFloorReason || null },
          { __macro: true, fgValue: macro?.fgValue ?? null, fgSignal: macro?.fgSignal ?? 0,
            dxyDirection: macro?.dxyDirection ?? null, dxyChange: macro?.dxyChange ?? null },
          { __flow: true, doi1h: doi1h ?? null, flowQuality: flowQuality ?? 'N/A',
            cvdBias: liveCvdBias || engine.cvdBias || null }
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
        const macroMeta = {
          __macro: true,
          fgValue: signal.fgValue ?? null,
          fgSignal: null,
          dxyDirection: signal.dxyDirection ?? null,
          dxyChange: signal.dxyChange ?? null
        };
        registerTradeSetup({
          id:         signal.id,
          instrument: symbol,
          timeframe:  SCAN_TIMEFRAME,
          bias:       tradeDir === 'LONG' ? 'bullish' : 'bearish',
          entry:      ote.entry,
          sl:         ote.sl,
          targets:    [ote.tp1, ote.tp2],
          indicators: ind.arisContext ? [ind.arisContext, riskMeta, macroMeta] : [riskMeta, macroMeta],
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
// BOARD-LEVEL META-ANALYSIS (PTS "ΒΑΘΙΑ ΔΙΥΛΙΣΗ")
// After all per-asset scans, look at the BOARD as a whole. If the vast majority
// of live setups point the same direction, that is ONE correlated bet, not N
// independent opportunities — a systemic tail-risk the per-asset engine can't see.
// We don't veto (each setup already passed its own gates); we TAG every signal in
// the dominant cluster with a correlation-risk flag so the user/AI sees the concentration.
const BOARD_LONG_PCT_THRESHOLD = 70; // ≥70% of live setups LONG → long-cluster risk
const BOARD_MIN_SIGNALS = 5;         // need enough signals for the stat to mean anything

export async function analyzeBoard(scanId) {
  try {
    const trades = await getActiveTrades();
    if (!trades || trades.length < BOARD_MIN_SIGNALS) {
      scannerLog.info({ scanId, count: trades?.length }, 'Board analysis skipped (too few signals)');
      return null;
    }
    const total = trades.length;
    const longs = trades.filter(t => (t.direction || '').toUpperCase() === 'LONG').length;
    const shorts = total - longs;
    const longPct = +((longs / total) * 100).toFixed(0);
    const shortPct = 100 - longPct;

    // Dominant cluster = the side with the larger count.
    const dominantDir = longs >= shorts ? 'LONG' : 'SHORT';
    const dominantCount = Math.max(longs, shorts);
    const dominantPct = dominantDir === 'LONG' ? longPct : shortPct;
    const correlationRisk = dominantPct >= BOARD_LONG_PCT_THRESHOLD;

    const summary = {
      total,
      longs,
      shorts,
      longPct,
      shortPct,
      dominantDir,
      dominantCount,
      dominantPct,
      correlationRisk,
      note: correlationRisk
        ? `⚠ BOARD CORRELATION: ${dominantCount}/${total} live setups are ${dominantDir} (${dominantPct}%) — one concentrated ${dominantDir} bet, not ${total} independent trades. Size accordingly; a single macro shock hits all of them.`
        : `Board balanced-ish: ${longs} LONG / ${shorts} SHORT (${longPct}%/${shortPct}%). No dominant single-direction cluster.`
    };

    scannerLog.info({ scanId, ...summary }, 'Board-level meta-analysis');

    // Tag every signal that belongs to the dominant cluster.
    if (dominantCount > 0) {
      for (const t of trades) {
        const dir = (t.direction || '').toUpperCase();
        if (dir === dominantDir) {
          let snap = [];
          try { snap = JSON.parse(t.indicator_snapshot || '[]'); } catch { snap = []; }
          if (!Array.isArray(snap)) snap = [];
          const board = snap.find(s => s && s.__board);
          const meta = {
            __board: true,
            clusterDir: dominantDir,
            clusterSize: dominantCount,
            clusterPct: dominantPct,
            correlationRisk,
            note: summary.note
          };
          if (board) Object.assign(board, meta);
          else snap.push(meta);
          await updateTradeMeta(t.id, JSON.stringify(snap));
        }
      }
    }
    return summary;
  } catch (e) {
    scannerLog.warn({ scanId, err: e.message }, 'Board analysis failed (non-fatal)');
    return null;
  }
}

// ─────────────────────────────────────────────
// SCAN ALL ASSETS
// ─────────────────────────────────────────────
export async function scanAllAssets() {
  const scanId = `scan_${Date.now()}`;
  scannerLog.info({ scanId, count: ASSETS_TO_SCAN.length }, 'Scan started');

  // Macro overlay (F&G + DXY) — fetched ONCE per scan pass (cached 10 min, cheap).
  let macro = null;
  try { macro = await getMacroOverlay(); scannerLog.info({ scanId, fg: macro.fgValue, dxy: macro.dxyDirection }, 'Macro overlay loaded'); }
  catch (e) { scannerLog.warn({ scanId, err: e.message }, 'Macro overlay fetch failed — scanner proceeds without it'); }

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
    await scanAsset(asset, scanId, macro);
    await new Promise(r => setTimeout(r, 2000)); // 2s pause between assets
  }

  // Board-level meta-analysis: tag correlated clusters across the whole board.
  await analyzeBoard(scanId);

  scannerLog.info({ scanId }, 'Scan complete');
}

// ─────────────────────────────────────────────
// ACTIVE SIGNALS FOR FRONTEND
// Returns all ACTIVE/PENDING trades from SQLite.
// Marks isNew flag as cleared 5s after serving.
// ─────────────────────────────────────────────
export async function getActiveSignals() {
  const trades = await getActiveTrades();

  // Unwrap the indicator_snapshot meta (__risk/__macro/__flow/__board) into
  // flat, UI-friendly fields so the frontend can read them WITHOUT parsing the
  // JSON blob. Backend-only: this is a projection, not a DB change.
  // NOTE: getActiveTrades() already parses indicator_snapshot into `indicators`
  // (via hydrate), so we read that — not the raw string column.
  const enriched = trades.map(t => {
    const snap = Array.isArray(t.indicators) ? t.indicators
                : (() => { try { return JSON.parse(t.indicator_snapshot || '[]'); } catch { return []; } })();
    const risk = snap.find(s => s && s.__risk) || {};
    const macro = snap.find(s => s && s.__macro) || {};
    const flow = snap.find(s => s && s.__flow) || {};
    const board = snap.find(s => s && s.__board) || {};
    return {
      ...t,
      // flat meta for the UI
      atr14:          risk.atr14 ?? null,
      atrFloor:       risk.atrFloor ?? null,
      invalidation:   risk.invalidation ?? null,
      fgValue:        macro.fgValue ?? null,
      fgSignal:       macro.fgSignal ?? 0,
      dxyDirection:   macro.dxyDirection ?? null,
      dxyChange:      macro.dxyChange ?? null,
      doi1h:          (t.doi1h ?? flow.doi1h) ?? null,
      flowQuality:    (t.flowQuality ?? flow.flowQuality) ?? 'N/A',
      cvdBias:        (t.cvdBias ?? flow.cvdBias) ?? null,
      boardClusterDir:    board.clusterDir ?? null,
      boardClusterPct:    board.clusterPct ?? null,
      boardCorrelationRisk: board.correlationRisk ?? false,
      boardNote:      board.note ?? null
    };
  });

  // Schedule isNew flag clear (300s delay so the user has time to SEE the NEW
  // badge even if they screenshot a minute or two after the scan finishes).
  enriched
    .filter(t => t.isNew)
    .forEach(t => setTimeout(async () => { await clearIsNew(t.id); }, 300000));

  return enriched;
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
