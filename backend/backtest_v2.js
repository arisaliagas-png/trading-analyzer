/**
 * backtest_v2.js — Pine-accurate backtest (Priority 2, Option 1, V2)
 *
 * DISCLAIMER (honest scope):
 * This is a CLOSE approximation of ARIS QUANTUM ULTIMATE V6.0 Pine logic,
 * simulated on Binance historical klines. It implements the CORE modules
 * that exist in OHLCV data:
 *   - OTE Zone (0.618-0.786 Fib from swing highs/lows)  [from Pine: p_618/p_786]
 *   - ATR Dynamic SL/TP (2.0x ATR SL, 1.5 R/R TP)       [from Pine: dynSL/dynTP1]
 *   - WaveTrend + RSI + MACD direction filters          [from Pine: wtBuy/wtSell]
 *   - MTF Bias (EMA200 on 3 TFs)                        [from Pine: mtfBiasScore]
 *   - Z-Score statistical extreme                       [from Pine: zExtBull/zExtBear]
 *
 * MODULES NOT SIMULATED (require real-time/external data, noted for honesty):
 *   - CVD / Delta / Footprint (intrabar buy/sell pressure)
 *   - Funding Rate + OI Combo (TradingView Request API)
 *   - DXY / US10Y correlation (macro)
 *   - Benford's Law (volume digit distribution)
 *   - UFO Forecast Engine (KNN pattern matching)
 *   - Liquidity Heatmap (EQH/EQL)
 *
 * This is NOT the live AI strategy — it's the rule-based core that the AI
 * uses as a foundation. Results show whether the CORE has edge.
 */

import fetch from 'node-fetch';

// ── Pine input defaults (from the uploaded script) ──
const PINE = {
  wtChannelLen: 10, wtAvgLen: 21, wtMASource: '(H+L+C)/3', wtMALen: 3,
  wtOverbought1: 53, wtOversold1: -45, wtOversold3: -70,
  rsiLen: 14, rsiOversold: 30, rsiOverbought: 70,
  stochRSILength: 14, stochKSmooth: 21,
  atrLength: 14, atrMultiplierSL: 2.0, riskRewardRatio: 1.5,
  zScoreLookback: 75, zScoreThreshold: 2.5,
  volMultiplier: 1.2, volSMAPeriod: 20,
  pivotLen: 5,
  mtfTimeframes: ['60', '240', 'D'],
  // ── Sweepable filters (relaxed defaults so setups actually trigger) ──
  wtBuyThresh: -10,   // Pine uses -45; we relax for backtest volume
  wtSellThresh: 30,   // relaxed from 53 so SHORT setups actually trigger (overbought, not extreme)
  mtfThreshold: 1,    // Pine uses 2 (3/3 alignment); relaxed to 1
  zThresh: 1.5,       // Pine uses 2.5; relaxed to 1.5
  adxLength: 14,
  chopPeriod: 14,
  adxMin: 20,         // require trending regime (ADX >= 20) for directional setups
  chopMax: 61.8,      // reject choppy regime (Choppiness > 61.8)
  volMultiplier: 1.2, // require volume > 1.2x SMA (Pine-equivalent)
  enableShortFilters: false, // Pine: enableShortFilters flag. When false, SHORT doesn't require mtfBearish.
};

// ── Indicator helpers ──
function sma(arr, len) {
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    if (i < len - 1) { out.push(null); continue; }
    let s = 0;
    for (let j = i - len + 1; j <= i; j++) s += arr[j];
    out.push(s / len);
  }
  return out;
}

function ema(arr, len) {
  const out = [];
  const k = 2 / (len + 1);
  let prev = null;
  for (let i = 0; i < arr.length; i++) {
    if (i < len - 1) { out.push(null); continue; }
    if (prev === null) {
      // seed with SMA
      let s = 0;
      for (let j = i - len + 1; j <= i; j++) s += arr[j];
      prev = s / len;
    } else {
      prev = arr[i] * k + prev * (1 - k);
    }
    out.push(prev);
  }
  return out;
}

function rma(arr, len) {
  // Wilder's smoothing (used by RSI)
  const out = [];
  let prev = null;
  for (let i = 0; i < arr.length; i++) {
    if (i < len - 1) { out.push(null); continue; }
    if (prev === null) {
      let s = 0;
      for (let j = i - len + 1; j <= i; j++) s += arr[j];
      prev = s / len;
    } else {
      prev = (prev * (len - 1) + arr[i]) / len;
    }
    out.push(prev);
  }
  return out;
}

function rsi(close, len) {
  const gains = [], losses = [];
  for (let i = 0; i < close.length; i++) {
    if (i === 0) { gains.push(0); losses.push(0); continue; }
    const ch = close[i] - close[i - 1];
    gains.push(ch > 0 ? ch : 0);
    losses.push(ch < 0 ? -ch : 0);
  }
  const ag = rma(gains, len), al = rma(losses, len);
  const out = [];
  for (let i = 0; i < close.length; i++) {
    if (ag[i] === null) { out.push(null); continue; }
    if (al[i] === 0) { out.push(100); continue; }
    const rs = ag[i] / al[i];
    out.push(100 - 100 / (1 + rs));
  }
  return out;
}

function stoch(rsiArr, len) {
  // Stochastic of RSI (from Pine: ta.stoch(rsi, rsi, rsi, stochKSmooth))
  const out = [];
  for (let i = 0; i < rsiArr.length; i++) {
    if (i < len - 1) { out.push(null); continue; }
    let hh = -Infinity, ll = Infinity;
    for (let j = i - len + 1; j <= i; j++) {
      if (rsiArr[j] > hh) hh = rsiArr[j];
      if (rsiArr[j] < ll) ll = rsiArr[j];
    }
    if (hh === ll) { out.push(50); continue; }
    out.push((rsiArr[i] - ll) / (hh - ll) * 100);
  }
  return out;
}

function macd(close, fast = 12, slow = 26, sig = 9) {
  const emaF = ema(close, fast), emaS = ema(close, slow);
  const line = [], hist = [];
  for (let i = 0; i < close.length; i++) {
    if (emaF[i] === null || emaS[i] === null) { line.push(null); hist.push(null); continue; }
    line.push(emaF[i] - emaS[i]);
  }
  const signal = ema(line.map(v => v === null ? 0 : v), sig);
  for (let i = 0; i < close.length; i++) {
    if (line[i] === null || signal[i] === null) { hist.push(null); continue; }
    hist.push(line[i] - signal[i]);
  }
  return { line, signal, hist };
}

function atr(high, low, close, len) {
  const tr = [];
  for (let i = 0; i < close.length; i++) {
    if (i === 0) { tr.push(high[i] - low[i]); continue; }
    tr.push(Math.max(
      high[i] - low[i],
      Math.abs(high[i] - close[i - 1]),
      Math.abs(low[i] - close[i - 1])
    ));
  }
  return rma(tr, len);
}

function waveTrend(hlc3, high, low, close, p) {
  // Pine: ap = wtMASource; esa = ema(ap, chLen); d = ema(abs(ap-esa), chLen);
  //       ci = (ap-esa)/(0.015*d); wt1 = ema(ci, avgLen); wt2 = sma(wt1, maLen)
  let ap;
  if (p.wtMASource === 'close') ap = close;
  else if (p.wtMASource === 'hl2') ap = high.map((h, i) => (h + low[i]) / 2);
  else if (p.wtMASource === 'hlc3') ap = hlc3;
  else if (p.wtMASource === 'ohlc4') ap = high.map((h, i) => (h + low[i] + close[i] + close[i]) / 4);
  else ap = high.map((h, i) => (h + low[i] + close[i]) / 3);

  const esa = ema(ap, p.wtChannelLen);
  const d = ema(ap.map((v, i) => esa[i] === null ? 0 : Math.abs(v - esa[i])), p.wtChannelLen);
  const ci = ap.map((v, i) => (esa[i] === null || d[i] === 0) ? 0 : (v - esa[i]) / (0.015 * d[i]));
  const wt1 = ema(ci, p.wtAvgLen);
  const wt2 = sma(wt1.map(v => v === null ? 0 : v), p.wtMALen);
  return { wt1, wt2 };
}

// ── ADX (trend strength) ──
function computeADX(high, low, close, len = 14) {
  const out = [];
  const tr = [], pDM = [], mDM = [];
  for (let i = 0; i < close.length; i++) {
    if (i === 0) { tr.push(0); pDM.push(0); mDM.push(0); out.push(null); continue; }
    const hl = high[i] - low[i];
    const hc = Math.abs(high[i] - close[i - 1]);
    const lc = Math.abs(low[i] - close[i - 1]);
    tr.push(Math.max(hl, hc, lc));
    const up = high[i] - high[i - 1];
    const dn = low[i - 1] - low[i];
    pDM.push(up > dn && up > 0 ? up : 0);
    mDM.push(dn > up && dn > 0 ? dn : 0);
  }
  const trS = rma(tr, len), pS = rma(pDM, len), mS = rma(mDM, len);
  for (let i = 0; i < close.length; i++) {
    if (i < len * 2) { out.push(null); continue; }
    const diP = trS[i] ? (pS[i] / trS[i]) * 100 : 0;
    const diM = trS[i] ? (mS[i] / trS[i]) * 100 : 0;
    const dx = (diP + diM) ? Math.abs(diP - diM) / (diP + diM) * 100 : 0;
    out.push(dx);
  }
  return out;
}

// ── Choppiness Index (array) ──
function computeChoppinessArr(high, low, close, period = 14) {
  const atrArr = atr(high, low, close, 1);
  const out = [];
  for (let i = 0; i < close.length; i++) {
    if (i < period) { out.push(null); continue; }
    let sumATR = 0;
    for (let j = i - period + 1; j <= i; j++) if (atrArr[j] != null) sumATR += atrArr[j];
    const hh = Math.max(...high.slice(i - period + 1, i + 1));
    const ll = Math.min(...low.slice(i - period + 1, i + 1));
    const range = hh - ll;
    out.push(range === 0 ? null : 100 * Math.log10(sumATR / range) / Math.log10(period));
  }
  return out;
}

function zScore(close, len) {
  const out = [];
  for (let i = 0; i < close.length; i++) {
    if (i < len - 1) { out.push(0); continue; }
    let s = 0;
    for (let j = i - len + 1; j <= i; j++) s += close[j];
    const mean = s / len;
    let varSum = 0;
    for (let j = i - len + 1; j <= i; j++) varSum += (close[j] - mean) ** 2;
    const std = Math.sqrt(varSum / len);
    out.push(std !== 0 ? (close[i] - mean) / std : 0);
  }
  return out;
}

function pivothigh(arr, left, right) {
  // Returns pivot value at bar index-`right` if it's the highest in [i-left, i+right]
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    if (i < left || i >= arr.length - right) { out.push(null); continue; }
    let isPivot = true;
    for (let j = i - left; j <= i + right; j++) {
      if (arr[j] > arr[i]) { isPivot = false; break; }
    }
    out.push(isPivot ? arr[i] : null);
  }
  return out;
}

function pivotlow(arr, left, right) {
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    if (i < left || i >= arr.length - right) { out.push(null); continue; }
    let isPivot = true;
    for (let j = i - left; j <= i + right; j++) {
      if (arr[j] < arr[i]) { isPivot = false; break; }
    }
    out.push(isPivot ? arr[i] : null);
  }
  return out;
}

// ── Fetch klines from Binance ──
async function fetchKlines(symbol, limit = 1000, interval = '1h') {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance ${res.status}: ${await res.text()}`);
  const raw = await res.json();
  return raw.map(k => ({
    time: k[0],
    open: +k[1], high: +k[2], low: +k[3], close: +k[4],
    volume: +k[5], closeTime: k[6]
  }));
}

// ── Main backtest ──
async function runBacktest(symbol, limit = 1000, opts = {}, cachedKlines = null) {
  const cfg = { ...PINE, ...opts };
  const k = cachedKlines || await fetchKlines(symbol, limit, '1h');
  const close = k.map(c => c.close);
  const high = k.map(c => c.high);
  const low = k.map(c => c.low);
  const open = k.map(c => c.open);
  const volume = k.map(c => c.volume);
  const hlc3 = close.map((c, i) => (high[i] + low[i] + c) / 3);

  // Indicators
  const rsiArr = rsi(close, cfg.rsiLen);
  const stochK = sma(stoch(rsiArr, cfg.stochRSILength), cfg.stochKSmooth);

  const atrArr = atr(high, low, close, cfg.atrLength);
  const zArr = zScore(close, cfg.zScoreLookback);
  const volSMA = sma(volume, cfg.volSMAPeriod);
  const { wt1, wt2 } = waveTrend(hlc3, high, low, close, cfg);
  const adxArr = computeADX(high, low, close, cfg.adxLength);
  const chopArr = computeChoppinessArr(high, low, close, cfg.chopPeriod);

  // WaveTrend BUY/SELL signals (Pine: wtBuy = wtCross and wt2 <= -45, etc.)
  // + confluence window (Pine: wtBuy_win = ta.barssince(wtBuy) <= 3)
  const wtBuy = [], wtSell = [], wtBuyWin = [], wtSellWin = [];
  for (let i = 0; i < close.length; i++) {
    if (i === 0 || wt1[i] === null || wt2[i] === null || wt1[i - 1] === null || wt2[i - 1] === null) {
      wtBuy.push(false); wtSell.push(false); wtBuyWin.push(false); wtSellWin.push(false); continue;
    }
    const cross = (wt1[i - 1] <= wt2[i - 1] && wt1[i] > wt2[i]) || (wt1[i - 1] >= wt2[i - 1] && wt1[i] < wt2[i]);
    // RELAXED: Pine uses wt2 <= -45 / >= 53. We apply cfg.wtBuyThresh / cfg.wtSellThresh.
    // Volume filter is applied later in smartLong (Pine applies it in wtBuy, but separating
    // it lets the 3-bar confluence window work even on low-volume crosses).
    wtBuy.push(cross && wt2[i] <= cfg.wtBuyThresh);
    wtSell.push(cross && wt2[i] >= cfg.wtSellThresh);
    // 3-bar confluence window
    let wb = false, ws = false;
    for (let k = 0; k <= 3 && i - k >= 0; k++) {
      if (wtBuy[i - k]) wb = true;
      if (wtSell[i - k]) ws = true;
    }
    wtBuyWin.push(wb); wtSellWin.push(ws);
  }

  // Swing highs/lows (Pine: ta.pivothigh(high, 5, 5) / ta.pivotlow(low, 5, 5))
  const ph = pivothigh(high, cfg.pivotLen, cfg.pivotLen);
  const pl = pivotlow(low, cfg.pivotLen, cfg.pivotLen);

  // MTF Bias: EMA200 on 3 timeframes (approximation: use 1h EMA200, 4h=4x, D=24x)
  const ema200_1h = ema(close, 200);
  const close4h = [];
  for (let i = 0; i < close.length; i += 4) close4h.push(close[i]);
  const closeD = [];
  for (let i = 0; i < close.length; i += 24) closeD.push(close[i]);
  const ema200_4h = ema(close4h, 200);
  const ema200_D = ema(closeD, 200);

  const setups = [];
  let cSwings = 0, cInOTE = 0, cStruct = 0, cFilters = 0;
  const dbg = { wtCross: 0, mtfBull: 0, mtfBear: 0, zBull: 0, zBear: 0, volOk: 0, sLong: 0, sShort: 0, structUp: 0, sLongExact: 0 };
  let prevStruct = null; // stateful BOS direction (Pine: var bool structIsUp = true)

  // Reserve maxBars for forward simulation; reserve maxBars+buffer for warmup
  // (indicators need history: EMA200 ~200, WT ~34, pivots 5+5=10). For short
  // windows (e.g. 100-candle speed scans) fall back to whatever fits rather
  // than silently producing zero iterations — the scan shrinks but still runs.
  const maxBars = 100;
  const simReserve = maxBars + 4;               // small buffer so TP/SL aren't clipped by last candle
  const warmReserve = 205;                       // EMA200 warmup + WT/pivot needs
  const scanEnd = Math.max(0, close.length - simReserve);

  // Adaptive start: if data is shorter than warmup, shrink warmup so the loop still runs
  const effectiveWarmup = Math.min(warmReserve, Math.max(0, scanEnd));
  const scanStart = Math.min(300, Math.max(effectiveWarmup, scanEnd));

  // For very short datasets, ensure we actually enter the loop by bounding start < end
  const loopStart = Math.min(scanStart, Math.max(0, close.length - simReserve + 1));
  const loopEnd = close.length - 1;

  // Fallback MTF EMAs when dataset is too short for EMA200 ( < 200 bars )
  const hasFullEma200 = ema200_1h.some(v => v !== null);
  const fallbackEma_1h = ema(close, Math.min(200, Math.max(10, close.length - 1)));
  const effectiveEma200_1h = hasFullEma200 ? ema200_1h : fallbackEma_1h;

  const ema200_4h_full = ema(close4h, 200);
  const ema200_D_full = ema(closeD, 200);
  const hasEma4h = ema200_4h_full.some(v => v !== null);
  const hasEmaD = ema200_D_full.some(v => v !== null);
  const fallbackEma_4h = ema(close4h, Math.min(200, Math.max(10, close4h.length - 1)));
  const fallbackEma_D = ema(closeD, Math.min(200, Math.max(10, closeD.length - 1)));
  const effectiveEma200_4h = hasEma4h ? ema200_4h_full : fallbackEma_4h;
  const effectiveEma200_D = hasEmaD ? ema200_D_full : fallbackEma_D;

  for (let i = loopStart; i < loopEnd; i++) {
    // Need enough history for pivots + indicators
    if (wt1[i] === null || wt2[i] === null || atrArr[i] === null) continue;
    if (effectiveEma200_1h[i] === null) continue;

    // Find last confirmed swing high/low before i
    let swingH = null, swingL = null;
    for (let j = i - 1; j >= 0; j--) {
      if (ph[j] !== null && swingH === null) swingH = ph[j];
      if (pl[j] !== null && swingL === null) swingL = pl[j];
      if (swingH !== null && swingL !== null) break;
    }
    if (swingH === null || swingL === null) continue;
    cSwings++;
    const oteRange = swingH - swingL;
    if (oteRange <= 0) continue;

    // Structure direction (Pine: structIsUp = BOS-based — flips when price breaks
    // a confirmed pivot. high >= lastConfirmedPH => bullish BOS; low <= lastConfirmedPL => bearish BOS)
    const lastPH = ph[i - 1] !== null ? ph[i - 1] : swingH;
    const lastPL = pl[i - 1] !== null ? pl[i - 1] : swingL;
    if (high[i] >= lastPH) prevStruct = true;
    else if (low[i] <= lastPL) prevStruct = false;
    else if (prevStruct === null) prevStruct = (effectiveEma200_1h[i] < close[i]);
    const structIsUp = prevStruct;
    cStruct++;

    // OTE zone levels
    let p618, p786, p666, sl, tp1, tp2, entry;
    if (structIsUp) {
      // LONG
      p618 = swingH - oteRange * 0.618;
      p786 = swingH - oteRange * 0.786;
      p666 = swingH - oteRange * 0.666;
      sl = swingL - oteRange * 0.272;
      tp1 = swingH;
      tp2 = swingH + oteRange * 0.618;
      entry = (p618 + p786) / 2;
    } else {
      // SHORT
      p618 = swingL + oteRange * 0.618;
      p786 = swingL + oteRange * 0.786;
      p666 = swingL + oteRange * 0.666;
      sl = swingH + oteRange * 0.272;
      tp1 = swingL;
      tp2 = swingL - oteRange * 0.618;
      entry = (p618 + p786) / 2;
    }

    // Check if price is IN OTE zone
    const inOTE = structIsUp
      ? (close[i] <= p618 && close[i] >= p786)
      : (close[i] >= p618 && close[i] <= p786);
    if (!inOTE) continue;
    cInOTE++;

    // ── Regime gate (mirrors live scanner weak-regime guard) ──
    // Reject directional setups in CHOPPY/RANGE regimes (mean-reversion kills entries).
    const adxV = adxArr[i];
    const chopV = chopArr[i];
    const choppy = (adxV != null && adxV < cfg.adxMin) || (chopV != null && chopV > cfg.chopMax);
    if (choppy) continue;

    // ── Filters (from Pine smart entry) ──
    // WaveTrend cross (Pine: wtBuy_win = barssince(wtBuy) <= 3)
    const wtB = wtBuyWin[i];
    const wtS = wtSellWin[i];

    // MTF Bias (Pine: mtfBiasScore = htfB1 + htfB2 + htfB3, each ±1)
    const idx4h = Math.floor(i / 4);
    const idxD = Math.floor(i / 24);
    const htfB1 = close[i] > effectiveEma200_1h[i] ? 1 : close[i] < effectiveEma200_1h[i] ? -1 : 0;
    const htfB2 = idx4h < effectiveEma200_4h.length && close4h[idx4h] > effectiveEma200_4h[idx4h] ? 1 : idx4h < effectiveEma200_4h.length && close4h[idx4h] < effectiveEma200_4h[idx4h] ? -1 : 0;
    const htfB3 = idxD < effectiveEma200_D.length && closeD[idxD] > effectiveEma200_D[idxD] ? 1 : idxD < effectiveEma200_D.length && closeD[idxD] < effectiveEma200_D[idxD] ? -1 : 0;
    const mtfBiasScore = htfB1 + htfB2 + htfB3;
    // RELAXED: Pine uses >=2 / <=-2 (3/3 alignment). Configurable via cfg.mtfThreshold.
    const mtfBullish = mtfBiasScore >= cfg.mtfThreshold;
    const mtfBearish = mtfBiasScore <= -cfg.mtfThreshold;

    // Z-Score (RELAXED threshold: Pine uses ±2.5, we use ±1.5 for more setups)
    const zExtBull = zArr[i] <= -cfg.zThresh;
    const zExtBear = zArr[i] >= cfg.zThresh;

    // Volume filter
    const volCond = volume[i] > volSMA[i] * cfg.volMultiplier;

    if (process.env.BT_DEBUG) {
      dbg.wtCross += (wtB || wtS) ? 1 : 0;
      dbg.mtfBull += mtfBullish ? 1 : 0;
      dbg.mtfBear += mtfBearish ? 1 : 0;
      dbg.zBull += zExtBull ? 1 : 0;
      dbg.zBear += zExtBear ? 1 : 0;
      dbg.volOk += volCond ? 1 : 0;
    }

    // Simplified MEGA SCORE (Pine: 0-31 from UFO+ARIS+MTF+Forecast+FR+DD+USDT+RS+SESS)
    // We approximate with computable modules: WT + MTF + Z + Vol
    const megaScoreBull = (wt2[i] <= cfg.wtBuyThresh ? 1 : 0) + (mtfBiasScore > 0 ? 1 : 0) + (zExtBull ? 1 : 0) + (volCond ? 1 : 0);
    const megaScoreBear = (wt2[i] >= cfg.wtSellThresh ? 1 : 0) + (mtfBiasScore < 0 ? 1 : 0) + (zExtBear ? 1 : 0) + (volCond ? 1 : 0);
    // RELAXED: Pine requires megaScore >= 16/31. We use a soft 2/4 gate (WT signal + 1 confirm).
    // Kept separate from smartLong below so we can report it without blocking setups entirely.
    const megaPasses = structIsUp ? megaScoreBull >= 2 : megaScoreBear >= 2;

    // Direction-specific filter (Pine: smartLong = wtBuy_win and mtfBullish and not benfordVeto)
    // NOTE: megaPasses is reported but NOT required here — Pine's 16/31 gate needs UFO/ARIS
    // modules we can't compute from OHLCV alone. Requiring it would yield 0 setups.
    const smartLong = wtB && mtfBullish && volCond;
    // SHORT: Pine uses enableShortFilters flag. When false, smartShort drops mtfBearish
    // requirement (WT sell signal + volume only) — matches live mode behavior.
    const smartShort = wtS && (!cfg.enableShortFilters || mtfBearish) && volCond;

    if (process.env.BT_DEBUG) {
      dbg.sLong += (structIsUp && smartLong) ? 1 : 0;
      dbg.sShort += (!structIsUp && smartShort) ? 1 : 0;
      dbg.structUp += structIsUp ? 1 : 0;
      dbg.sLongExact += (wtB && mtfBullish && volCond) ? 1 : 0;
    }

    // Decide direction (Pine: smartLong/smartShort are already direction-specific)
    let dir = null;
    if (smartLong) dir = 'LONG';
    else if (smartShort) dir = 'SHORT';
    else if (structIsUp && zExtBull && wt2[i] <= cfg.wtBuyThresh) dir = 'LONG'; // fallback
    else if ((!structIsUp || zExtBear || wt2[i] >= cfg.wtSellThresh) && wt2[i] >= cfg.wtSellThresh && volCond) dir = 'SHORT';
    if (!dir) continue;

    // FIX: recompute OTE zone levels from DIR (not structIsUp) so entry/sl/tp align
    // with the actual signal. Previously entry/sl/tp came from structIsUp while dir
    // came from smartLong/smartShort — anti-correlated — so LONG trades used SHORT
    // sl/tp and hit SL instantly (-1.00R on every trade).
    if (dir === 'LONG') {
      p618 = swingH - oteRange * 0.618;
      p786 = swingH - oteRange * 0.786;
      p666 = swingH - oteRange * 0.666;
      sl = swingL - oteRange * 0.272;
      tp1 = swingH;
      tp2 = swingH + oteRange * 0.618;
      entry = (p618 + p786) / 2;
    } else {
      p618 = swingL + oteRange * 0.618;
      p786 = swingL + oteRange * 0.786;
      p666 = swingL + oteRange * 0.666;
      sl = swingH + oteRange * 0.272;
      tp1 = swingL;
      tp2 = swingL - oteRange * 0.618;
      entry = (p618 + p786) / 2;
    }
    cFilters++;

    // Dynamic SL/TP (Pine: dynSL_Long = close - atr*2, dynTP1 = close + (close-dynSL)*1.5)
    const atr = atrArr[i];
    let dynSL, dynTP1, dynTP2;
    if (dir === 'LONG') {
      dynSL = entry - atr * cfg.atrMultiplierSL;
      dynTP1 = entry + (entry - dynSL) * cfg.riskRewardRatio;
      dynTP2 = entry + (entry - dynSL) * cfg.riskRewardRatio * 2;
    } else {
      dynSL = entry + atr * cfg.atrMultiplierSL;
      dynTP1 = entry - (dynSL - entry) * cfg.riskRewardRatio;
      dynTP2 = entry - (dynSL - entry) * cfg.riskRewardRatio * 2;
    }

    // Use Pine ATR-based SL/TP (dynSL/dynTP1) as the actual trade levels.
    // The Pine OTE sl/tp1/tp2 are "zone" levels (1.272 invalidation) — NOT the trade SL.
    const finalSL = dir === 'LONG' ? dynSL : dynSL;
    const finalTP1 = dir === 'LONG' ? dynTP1 : dynTP1;
    const finalTP2 = dir === 'LONG' ? dynTP2 : dynTP2;

    setups.push({
      i, dir, entry,
      sl: finalSL, tp1: finalTP1, tp2: finalTP2,
      swingH, swingL, structIsUp,
      mtfBiasScore, zScore: zArr[i], wt2: wt2[i]
    });
  }

  if (process.env.BT_DEBUG) {
    console.error(`[DEBUG] swings=${cSwings} structComputed=${cStruct} inOTE=${cInOTE} passedFilters=${cFilters}`);
    console.error(`[DEBUG] filter hits: wtCross=${dbg.wtCross} mtfBull=${dbg.mtfBull} mtfBear=${dbg.mtfBear} zBull=${dbg.zBull} zBear=${dbg.zBear} volOk=${dbg.volOk}`);
    console.error(`[DEBUG] direction: structUp=${dbg.structUp} smartLong=${dbg.sLong} smartShort=${dbg.sShort} sLongExact=${dbg.sLongExact}`);
  }

  // ── Simulation: walk forward from each setup ──
  const results = [];
  for (const s of setups) {
    let exitPrice = null, outcome = null, bars = 0;
    const maxBars = 100; // ~4 days max hold
    for (let j = s.i + 1; j < Math.min(s.i + maxBars, close.length); j++) {
      bars++;
      if (s.dir === 'LONG') {
        if (low[j] <= s.sl) { exitPrice = s.sl; outcome = 'FAILED'; break; }
        if (high[j] >= s.tp1) { exitPrice = s.tp1; outcome = 'SUCCESS'; break; }
        if (high[j] >= s.tp2) { exitPrice = s.tp2; outcome = 'SUCCESS'; break; }
      } else {
        if (high[j] >= s.sl) { exitPrice = s.sl; outcome = 'FAILED'; break; }
        if (low[j] <= s.tp1) { exitPrice = s.tp1; outcome = 'SUCCESS'; break; }
        if (low[j] <= s.tp2) { exitPrice = s.tp2; outcome = 'SUCCESS'; break; }
      }
    }
    if (!outcome) { exitPrice = close[Math.min(s.i + maxBars, close.length - 1)]; outcome = 'OPEN'; }
    const r = s.dir === 'LONG'
      ? (exitPrice - s.entry) / (s.entry - s.sl)
      : (s.entry - exitPrice) / (s.sl - s.entry);
    results.push({ ...s, exitPrice, outcome, r, bars });
  }

  // ── Report ──
  const closed = results.filter(r => r.outcome !== 'OPEN');
  const wins = closed.filter(r => r.outcome === 'SUCCESS');
  const losses = closed.filter(r => r.outcome === 'FAILED');
  const winRate = closed.length ? wins.length / closed.length * 100 : 0;
  const avgWin = wins.length ? wins.reduce((a, r) => a + r.r, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((a, r) => a + r.r, 0) / losses.length : 0;
  const expectancy = closed.length ? (wins.reduce((a, r) => a + r.r, 0) + losses.reduce((a, r) => a + r.r, 0)) / closed.length : 0;
  const longs = results.filter(r => r.dir === 'LONG');
  const shorts = results.filter(r => r.dir === 'SHORT');

  return {
    symbol, limit, setups: setups.length, closed: closed.length,
    winRate: winRate.toFixed(1),
    avgWin: avgWin.toFixed(2), avgLoss: avgLoss.toFixed(2),
    expectancy: expectancy.toFixed(3),
    longCount: longs.length, shortCount: shorts.length,
    longWinRate: longs.length ? (longs.filter(r => r.outcome === 'SUCCESS').length / longs.length * 100).toFixed(1) : '0.0',
    shortWinRate: shorts.length ? (shorts.filter(r => r.outcome === 'SUCCESS').length / shorts.length * 100).toFixed(1) : '0.0',
    // Debug counters (when opts.returnDebug is true)
    dbg: process.env.BT_DEBUG ? {
      swings: cSwings, structComputed: cStruct, inOTE: cInOTE, passedFilters: cFilters,
      wtCross: dbg.wtCross, mtfBull: dbg.mtfBull, mtfBear: dbg.mtfBear,
      zBull: dbg.zBull, zBear: dbg.zBear, volOk: dbg.volOk,
      smartLong: dbg.sLong, smartShort: dbg.sShort, structUp: dbg.structUp,
    } : null,
  };
}

// ── CLI (only when run directly, not imported) ──
if (process.argv[1] && (process.argv[1].endsWith('backtest_v2.js') || process.argv[1].endsWith('/backtest_v2.js'))) {
(async () => {
  const symbol = process.argv[2] || 'BTCUSDT';
  const limit = parseInt(process.argv[3] || '1000', 10);
  console.log(`\n=== ARIS Quantum V6 Backtest V2 (Pine-accurate core) ===`);
  console.log(`Symbol: ${symbol} | Klines: ${limit} (1h)\n`);
  try {
    const r = await runBacktest(symbol, limit);
    console.log(`Setups found:     ${r.setups}`);
    console.log(`Closed trades:    ${r.closed}`);
    console.log(`Win rate:         ${r.winRate}%`);
    console.log(`Avg win:          ${r.avgWin} R`);
    console.log(`Avg loss:         ${r.avgLoss} R`);
    console.log(`Expectancy:       ${r.expectancy} R`);
    console.log(`LONG count:       ${r.longCount} (WR ${r.longWinRate}%)`);
    console.log(`SHORT count:      ${r.shortCount} (WR ${r.shortWinRate}%)`);
    console.log(`\nNOTE: Core modules simulated (OTE, ATR, WT, MTF, Z-Score).`);
    console.log(`Missing: CVD, Funding/OI, DXY, Benford, Forecast KNN, Liquidity Heatmap.\n`);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
}

export { runBacktest };
