/**
 * ARIS Quantum Score Engine — Phase 1
 * Computes all indicators derivable purely from OHLCV + Volume data.
 *
 * Phase 1 max MEGA SCORE: 25/31
 * Phase 2 (not yet): Funding Rate, OI, DXY/USDT.D, EQH/EQL Heatmap, OTE swing structure
 *
 * Formula source: ARIS_Unified_Strategy_v1 Pine Script, fully debugged.
 */

// ─── Low-level math helpers ───────────────────────────────────────────────────

function sma(arr, period) {
  const result = [];
  for (let i = 0; i < arr.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += arr[j];
    result.push(sum / period);
  }
  return result;
}

function ema(arr, period) {
  const k = 2 / (period + 1);
  const result = [];
  let emaPrev = null;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] == null) { result.push(null); continue; }
    if (emaPrev == null) {
      // Seed with SMA of first `period` values
      if (i < period - 1) { result.push(null); continue; }
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += arr[j];
      emaPrev = sum / period;
      result.push(emaPrev);
    } else {
      emaPrev = arr[i] * k + emaPrev * (1 - k);
      result.push(emaPrev);
    }
  }
  return result;
}

function highest(arr, period) {
  return arr.map((_, i) => {
    if (i < period - 1) return null;
    return Math.max(...arr.slice(i - period + 1, i + 1).filter(v => v != null));
  });
}

function lowest(arr, period) {
  return arr.map((_, i) => {
    if (i < period - 1) return null;
    return Math.min(...arr.slice(i - period + 1, i + 1).filter(v => v != null));
  });
}

function rma(arr, period) {
  // Wilder's smoothed MA (used in RSI, ATR)
  const k = 1 / period;
  const result = [];
  let prev = null;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] == null) { result.push(null); continue; }
    if (prev == null) {
      if (i < period - 1) { result.push(null); continue; }
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += arr[j];
      prev = sum / period;
      result.push(prev);
    } else {
      prev = arr[i] * k + prev * (1 - k);
      result.push(prev);
    }
  }
  return result;
}

function stdDev(arr, period) {
  const means = sma(arr, period);
  return arr.map((_, i) => {
    if (i < period - 1 || means[i] == null) return null;
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) sumSq += Math.pow(arr[j] - means[i], 2);
    return Math.sqrt(sumSq / period);
  });
}

function atr(highs, lows, closes, period) {
  const trArr = closes.map((c, i) => {
    if (i === 0) return highs[i] - lows[i];
    return Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
  });
  return rma(trArr, period);
}

function last(arr) {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] != null) return arr[i];
  }
  return null;
}

// ─── RSI ─────────────────────────────────────────────────────────────────────

function computeRSI(closes, period = 14) {
  const gains = [], losses = [];
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains.push(Math.max(diff, 0));
    losses.push(Math.max(-diff, 0));
  }
  const avgGain = rma(gains, period);
  const avgLoss = rma(losses, period);
  const rsiArr = avgGain.map((g, i) => {
    if (g == null || avgLoss[i] == null) return null;
    if (avgLoss[i] === 0) return 100;
    return 100 - 100 / (1 + g / avgLoss[i]);
  });
  return [null, ...rsiArr];
}

// ─── WaveTrend ───────────────────────────────────────────────────────────────

function computeWaveTrend(highs, lows, closes, n1 = 10, n2 = 21) {
  const hlc3 = closes.map((c, i) => (highs[i] + lows[i] + c) / 3);
  const esa = ema(hlc3, n1);
  const dArr = esa.map((e, i) => (e != null ? Math.abs(hlc3[i] - e) : null));
  const d = ema(dArr, n1);
  const ci = hlc3.map((h, i) => {
    if (d[i] == null || d[i] === 0) return null;
    return (h - esa[i]) / (0.015 * d[i]);
  });
  const tci = ema(ci, n2);
  const wt2 = sma(tci, 4);
  return { wt1: tci, wt2 };
}

// ─── Hybrid Oscillator (RSI + WT composite) ──────────────────────────────────

function computeHybridOsc(closes, highs, lows) {
  const rsi = computeRSI(closes, 14);
  const { wt1 } = computeWaveTrend(highs, lows, closes);
  // Hybrid: weighted blend (normalized RSI to -100/+100 scale + WT)
  return closes.map((_, i) => {
    if (rsi[i] == null || wt1[i] == null) return null;
    const rsiN = (rsi[i] - 50) * 2; // -100 to +100
    return (rsiN * 0.5 + wt1[i] * 0.5);
  });
}

// ─── StochRSI ────────────────────────────────────────────────────────────────

function computeStochRSI(closes, rsiPeriod = 14, stochPeriod = 14, kPeriod = 3) {
  const rsi = computeRSI(closes, rsiPeriod);
  const loRsi = lowest(rsi, stochPeriod);
  const hiRsi = highest(rsi, stochPeriod);
  const stoch = rsi.map((r, i) => {
    if (r == null || loRsi[i] == null || hiRsi[i] == null) return null;
    const range = hiRsi[i] - loRsi[i];
    return range === 0 ? 50 : ((r - loRsi[i]) / range) * 100;
  });
  const k = ema(stoch, kPeriod);
  const d = ema(k, 3);
  return { k, d };
}

// ─── Money Flow Index (MFI) ──────────────────────────────────────────────────

function computeMFI(highs, lows, closes, volumes, period = 14) {
  const tp = closes.map((c, i) => (highs[i] + lows[i] + c) / 3);
  const mf = tp.map((t, i) => t * volumes[i]);
  const result = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period) { result.push(null); continue; }
    let posFlow = 0, negFlow = 0;
    for (let j = i - period + 1; j <= i; j++) {
      if (tp[j] > tp[j - 1]) posFlow += mf[j];
      else negFlow += mf[j];
    }
    if (negFlow === 0) { result.push(100); continue; }
    result.push(100 - 100 / (1 + posFlow / negFlow));
  }
  return result;
}

// ─── Chaikin Money Flow (CMF) ────────────────────────────────────────────────

function computeCMF(highs, lows, closes, volumes, period = 20) {
  const mfv = closes.map((c, i) => {
    const range = highs[i] - lows[i];
    if (range === 0) return 0;
    return ((c - lows[i]) - (highs[i] - c)) / range * volumes[i];
  });
  return closes.map((_, i) => {
    if (i < period - 1) return null;
    let sumMFV = 0, sumVol = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumMFV += mfv[j];
      sumVol += volumes[j];
    }
    return sumVol === 0 ? 0 : sumMFV / sumVol;
  });
}

// ─── CVD Approximation ───────────────────────────────────────────────────────

function computeCVD(opens, closes, volumes) {
  // Delta per bar: positive if bullish (close > open), negative if bearish
  let cumulative = 0;
  const cvd = opens.map((o, i) => {
    const delta = closes[i] >= o ? volumes[i] : -volumes[i];
    cumulative += delta;
    return cumulative;
  });
  const cvdLast = cvd[cvd.length - 1];
  const cvdPrev20 = cvd[Math.max(0, cvd.length - 21)];
  const cvdDelta20 = cvdLast - cvdPrev20;
  return {
    cvd: cvdLast,
    cvdDelta20,
    bias: cvdDelta20 > 0 ? 'BULL' : 'BEAR'
  };
}

// ─── FP Delta (Footprint Approximation) ──────────────────────────────────────

function computeFPDelta(opens, closes, volumes) {
  const deltas = opens.map((o, i) => {
    const bullish = closes[i] >= o;
    return bullish ? volumes[i] : -volumes[i];
  });
  const last5 = deltas.slice(-5);
  const sumDelta = last5.reduce((a, b) => a + b, 0);
  const imbalance = sumDelta > 0 ? 'BUY IMB' : 'SELL IMB';
  return { delta: sumDelta, imbalance, bias: sumDelta > 0 ? 1 : -1 };
}

// ─── Z-Score ─────────────────────────────────────────────────────────────────

function computeZScore(closes, period = 20) {
  const means = sma(closes, period);
  const sds = stdDev(closes, period);
  const zArr = closes.map((c, i) => {
    if (means[i] == null || sds[i] == null || sds[i] === 0) return null;
    return (c - means[i]) / sds[i];
  });
  return last(zArr);
}

// ─── Choppiness Index → Regime ───────────────────────────────────────────────

function computeChoppiness(highs, lows, closes, period = 14) {
  const atrArr = atr(highs, lows, closes, 1);
  const result = [];
  for (let i = period; i < closes.length; i++) {
    let sumATR = 0;
    for (let j = i - period + 1; j <= i; j++) {
      if (atrArr[j] != null) sumATR += atrArr[j];
    }
    const hh = Math.max(...highs.slice(i - period + 1, i + 1));
    const ll = Math.min(...lows.slice(i - period + 1, i + 1));
    const range = hh - ll;
    if (range === 0) { result.push(null); continue; }
    result.push(100 * Math.log10(sumATR / range) / Math.log10(period));
  }
  return last(result);
}

// ─── SM Trap Detection ───────────────────────────────────────────────────────

function detectSMTrap(opens, highs, lows, closes, structHigh, structLow) {
  const n = closes.length;
  if (n < 20 || !structHigh || !structLow) return 'NONE';

  // Check the last 15 bars for structural sweeps of the macro swings
  for (let idx = n - 1; idx >= n - 15; idx--) {
    if (idx < 0) break;
    const c = closes[idx];
    const o = opens[idx];
    const h = highs[idx];
    const l = lows[idx];

    // Bear trap (sweep of structural swing low): candle goes below structLow, closes back above
    const isBearTrap = l < structLow && c > structLow && c > o;
    if (isBearTrap) {
      // Invalidation: if any subsequent low went below this candle's low, it's invalid
      const trapLow = l;
      let breached = false;
      for (let j = idx + 1; j < n; j++) {
        if (lows[j] < trapLow) { breached = true; break; }
      }
      if (!breached) return 'BEAR_TRAP';
    }

    // Bull trap (sweep of structural swing high): candle goes above structHigh, closes back below
    const isBullTrap = h > structHigh && c < structHigh && c < o;
    if (isBullTrap) {
      const trapHigh = h;
      let breached = false;
      for (let j = idx + 1; j < n; j++) {
        if (highs[j] > trapHigh) { breached = true; break; }
      }
      if (!breached) return 'BULL_TRAP';
    }
  }

  return 'NONE';
}

// ─── Benford's Law Check ─────────────────────────────────────────────────────

function checkBenford(volumes, threshold = 0.15) {
  // Expected first-digit distribution per Benford's Law
  const expected = [0.301, 0.176, 0.125, 0.097, 0.079, 0.067, 0.058, 0.051, 0.046];
  const counts = new Array(9).fill(0);
  let total = 0;
  for (const v of volumes) {
    const s = Math.floor(v).toString();
    const d = parseInt(s[0]);
    if (d >= 1 && d <= 9) { counts[d - 1]++; total++; }
  }
  if (total < 30) return { ok: true, note: 'INSUFFICIENT_DATA' };
  let maxDeviation = 0;
  for (let i = 0; i < 9; i++) {
    const observed = counts[i] / total;
    maxDeviation = Math.max(maxDeviation, Math.abs(observed - expected[i]));
  }
  return { ok: maxDeviation < threshold, maxDeviation: parseFloat(maxDeviation.toFixed(4)) };
}

// ─── UFO Fusion (6-signal composite) ─────────────────────────────────────────

function computeUFOFusion({ wt1, wt2, hybridOsc, stochK, mfi, cmf, cvdBias }) {
  // Each signal: +1 = bullish, -1 = bearish, 0 = neutral
  const signals = [
    wt1 != null ? (wt1 > 0 ? 1 : wt1 < 0 ? -1 : 0) : 0,
    wt2 != null ? (wt2 > 0 ? 1 : wt2 < 0 ? -1 : 0) : 0,
    hybridOsc != null ? (hybridOsc > 10 ? 1 : hybridOsc < -10 ? -1 : 0) : 0,
    stochK != null ? (stochK > 60 ? 1 : stochK < 40 ? -1 : 0) : 0,
    mfi != null ? (mfi > 55 ? 1 : mfi < 45 ? -1 : 0) : 0,
    cmf != null ? (cmf > 0.05 ? 1 : cmf < -0.05 ? -1 : 0) : 0,
  ];
  const bullCount = signals.filter(s => s === 1).length;
  const bearCount = signals.filter(s => s === -1).length;
  const ufoScore = bullCount - bearCount; // -6 to +6
  const ufoNorm = Math.round((ufoScore / 6) * 100); // -100% to +100%
  return { ufoScore, ufoNorm, bullCount, bearCount, signals };
}

// ─── VWAP (session approximation) ────────────────────────────────────────────

function computeVWAP(highs, lows, closes, volumes) {
  // Use all available bars as a cumulative session VWAP
  const tp = closes.map((c, i) => (highs[i] + lows[i] + c) / 3);
  let sumTV = 0, sumV = 0;
  // Use the last 50 bars as "session"
  const start = Math.max(0, closes.length - 50);
  for (let i = start; i < closes.length; i++) {
    sumTV += tp[i] * volumes[i];
    sumV += volumes[i];
  }
  return sumV === 0 ? closes[closes.length - 1] : sumTV / sumV;
}

// ─── Volume Engine (YoC / Relative Volume) ───────────────────────────────────

function computeRelativeVolume(volumes, period = 20) {
  const avgVol = sma(volumes, period);
  const lastAvg = last(avgVol);
  const lastVol = volumes[volumes.length - 1];
  if (!lastAvg || lastAvg === 0) return { ratio: 1, signal: 'NORMAL' };
  const ratio = lastVol / lastAvg;
  const signal = ratio > 2 ? 'CLIMAX' : ratio > 1.5 ? 'HIGH' : ratio < 0.5 ? 'LOW' : 'NORMAL';
  return { ratio: parseFloat(ratio.toFixed(2)), signal };
}

// ─── Squeeze Momentum (Carter TTM Logic) ──────────────────────────────────────

function computeSqueezeMomentum(highs, lows, closes, period = 20, multBB = 2.0, multKC = 1.5) {
  // 1. BB lines
  const basis = sma(closes, period);
  const dev = stdDev(closes, period);
  const bbUpper = basis.map((b, i) => (b != null && dev[i] != null) ? b + multBB * dev[i] : null);
  const bbLower = basis.map((b, i) => (b != null && dev[i] != null) ? b - multBB * dev[i] : null);

  // 2. KC lines (using SMA of ATR)
  const atrArr = atr(highs, lows, closes, period);
  const kcUpper = basis.map((b, i) => (b != null && atrArr[i] != null) ? b + multKC * atrArr[i] : null);
  const kcLower = basis.map((b, i) => (b != null && atrArr[i] != null) ? b - multKC * atrArr[i] : null);

  // 3. Squeeze state
  const isSqueeze = basis.map((b, i) => {
    if (bbUpper[i] == null || kcUpper[i] == null) return false;
    return bbUpper[i] < kcUpper[i] && bbLower[i] > kcLower[i];
  });

  // 4. Momentum: Linear Regression slope of price vs average of (highest/lowest/sma)
  const hlc3 = closes.map((c, i) => (highs[i] + lows[i] + c) / 3);
  const highestHigh = highest(highs, period);
  const lowestLow = lowest(lows, period);
  const avg = hlc3.map((h, i) => {
    if (highestHigh[i] == null || lowestLow[i] == null || basis[i] == null) return null;
    return (highestHigh[i] + lowestLow[i] + basis[i]) / 3;
  });

  // Simple regression slope calculation (last 4 bars)
  const momentum = closes.map((_, i) => {
    if (i < period + 5 || avg[i] == null) return 0;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    const size = 5;
    for (let d = 0; d < size; d++) {
      const idx = i - (size - 1) + d;
      const x = d;
      const y = hlc3[idx] - avg[idx];
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
    }
    const slope = (size * sumXY - sumX * sumY) / (size * sumX2 - sumX * sumX);
    return slope;
  });

  const lastSqueeze = last(isSqueeze);
  const lastMom = last(momentum);
  
  let signal = 'RELEASED';
  if (lastSqueeze) {
    signal = 'SQUEEZED';
  }

  return {
    state: signal,
    momentumValue: parseFloat(lastMom.toFixed(4)),
    direction: lastMom > 0 ? 'BULLISH' : lastMom < 0 ? 'BEARISH' : 'NEUTRAL'
  };
}

// ─── CVD Z-Score & Whale Absorption Detection ──────────────────────────────────

function computeWhaleAbsorption(opens, closes, volumes, period = 20) {
  // Delta per bar: positive if bullish (close > open), negative if bearish
  const deltas = opens.map((o, i) => (closes[i] >= o ? volumes[i] : -volumes[i]));
  
  // Calculate average and standard deviation of volume deltas
  const deltaMeans = sma(deltas, period);
  const deltaSds = stdDev(deltas, period);

  const cvdZScores = deltas.map((d, i) => {
    if (deltaMeans[i] == null || deltaSds[i] == null || deltaSds[i] === 0) return 0;
    return (d - deltaMeans[i]) / deltaSds[i];
  });

  const lastCvdZ = cvdZScores[cvdZScores.length - 1] || 0;

  // Price returns (percentage change) Z-score to measure if price action matches volume
  const priceReturns = closes.map((c, i) => (i === 0 ? 0 : (c - closes[i - 1]) / closes[i - 1]));
  const returnMeans = sma(priceReturns, period);
  const returnSds = stdDev(priceReturns, period);
  const priceZScores = priceReturns.map((r, i) => {
    if (returnMeans[i] == null || returnSds[i] == null || returnSds[i] === 0) return 0;
    return (r - returnMeans[i]) / returnSds[i];
  });

  const lastPriceZ = priceZScores[priceZScores.length - 1] || 0;

  // Absorption conditions:
  // - Buying Absorption: Aggressive Buyers (CVD Z-Score > 2.0) but Price fails to rise (Price Z-Score < 0.5)
  // - Selling Absorption: Aggressive Sellers (CVD Z-Score < -2.0) but Price fails to drop (Price Z-Score > -0.5)
  let absorption = 'NONE';
  if (lastCvdZ > 2.0 && lastPriceZ < 0.5) {
    absorption = 'BUY_ABSORPTION'; // Limit sellers absorb aggressive market buyers
  } else if (lastCvdZ < -2.0 && lastPriceZ > -0.5) {
    absorption = 'SELL_ABSORPTION'; // Limit buyers absorb aggressive market sellers
  }

  return {
    cvdZScore: parseFloat(lastCvdZ.toFixed(2)),
    priceZScore: parseFloat(lastPriceZ.toFixed(2)),
    absorptionSignal: absorption
  };
}

// ─── Swing Detection (Fractal Pivots) & Fibonacci OTE Calculator ──────────────

function detectSwings(highs, lows, lookback = 10) {
  let swingHigh = null;
  let swingLow = null;
  let swingHighIndex = null;
  let swingLowIndex = null;
  const n = highs.length;

  // Find most recent Swing High: a bar higher than all its surrounding bars within lookback
  for (let i = n - lookback - 1; i >= lookback; i--) {
    let isHigh = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j !== i && highs[j] > highs[i]) { isHigh = false; break; }
    }
    if (isHigh) {
      swingHigh = highs[i];
      swingHighIndex = i;
      break;
    }
  }

  // Find most recent Swing Low: a bar lower than all its surrounding bars within lookback
  for (let i = n - lookback - 1; i >= lookback; i--) {
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j !== i && lows[j] < lows[i]) { isLow = false; break; }
    }
    if (isLow) {
      swingLow = lows[i];
      swingLowIndex = i;
      break;
    }
  }

  // Fallback to absolute range of last 50 bars if no fractal pivot found
  if (swingHigh == null) {
    let maxVal = -Infinity;
    let maxIdx = n - 1;
    for (let i = n - 50; i < n; i++) {
      if (highs[i] > maxVal) {
        maxVal = highs[i];
        maxIdx = i;
      }
    }
    swingHigh = maxVal;
    swingHighIndex = maxIdx;
  }
  if (swingLow == null) {
    let minVal = Infinity;
    let minIdx = n - 1;
    for (let i = n - 50; i < n; i++) {
      if (lows[i] < minVal) {
        minVal = lows[i];
        minIdx = i;
      }
    }
    swingLow = minVal;
    swingLowIndex = minIdx;
  }

  return { swingHigh, swingLow, swingHighIndex, swingLowIndex };
}

function computeATR(highs, lows, closes, period = 14) {
  if (closes.length < period + 1) return (closes[closes.length - 1] || 0) * 0.01; // fallback
  let trSum = 0;
  for (let i = 1; i <= period; i++) {
    const idx = closes.length - i;
    const h = highs[idx];
    const l = lows[idx];
    const pc = closes[idx - 1];
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    trSum += tr;
  }
  return trSum / period;
}

// ─── Local Swing Detection (Micro-Structure, last N candles) ──────────────────
// Finds the most recent swing high and low in the last `lookback` candles.
// Used to detect shallow pullback / OTE zones closer to current price.
function computeLocalSwing(highs, lows, lookback = 12) {
  const n = highs.length;
  const slice = Math.min(lookback, n);
  const recentHighs = highs.slice(n - slice);
  const recentLows  = lows.slice(n - slice);
  return {
    localHigh: Math.max(...recentHighs),
    localLow:  Math.min(...recentLows)
  };
}

// ─── Order Block Detection (last bearish candle before a strong bullish impulse) ─
// An Order Block (OB) is the LAST bearish (red) candle before a strong UP move.
// Its body low = OB support, body high = OB resistance.
function detectOrderBlock(opens, highs, lows, closes, lookback = 20) {
  const n = closes.length;
  let ob = null;
  // Scan from recent to older
  for (let i = n - 2; i >= Math.max(1, n - lookback); i--) {
    const isBearishCandle = closes[i] < opens[i];
    const nextIsBullish   = closes[i + 1] > opens[i + 1];
    const impulsive       = (closes[i + 1] - opens[i + 1]) > (Math.abs(closes[i] - opens[i]) * 1.5);
    if (isBearishCandle && nextIsBullish && impulsive) {
      ob = {
        low:  Math.min(opens[i], closes[i]), // Body low (demand zone base)
        high: Math.max(opens[i], closes[i]), // Body high (demand zone top)
        barIndex: i
      };
      break;
    }
  }
  return ob;
}

function calculateExecutionSetup({
  swingHigh, swingLow, currentPrice, highs, lows, opens, closes,
  regime, squeezeState, cvdBias, whaleWalls = [], absorption = null, smTrap = null
}) {
  if (swingHigh <= swingLow) return null;

  const range = swingHigh - swingLow;
  // Override trend bias if a Smart Money Trap is active (Bear Trap dictates LONG setup, Bull Trap dictates SHORT setup)
  let isUpward = currentPrice > (swingHigh + swingLow) / 2; // general direction bias
  if (smTrap === 'BEAR_TRAP') {
    isUpward = true;
  } else if (smTrap === 'BULL_TRAP') {
    isUpward = false;
  }
  const atr = computeATR(highs, lows, closes, 14);

  // Helper to format zone output
  const formatZone = (price, low, high) => ({
    price: parseFloat(price.toFixed(5)),
    low: parseFloat(Math.min(low, high).toFixed(5)),
    high: parseFloat(Math.max(low, high).toFixed(5))
  });

  const f = (val) => {
    if (val == null) return '—';
    return val < 1 ? val.toFixed(5) : val < 1000 ? val.toFixed(3) : val.toFixed(2);
  };

  // 1. STRATEGY: ALCHEMIC REACTION (Order Flow Sweep & Limit Absorption) - HIGHEST PRIORITY
  if (absorption && absorption.type !== 'NONE' && absorption.strength > 0) {
    const tickOffset = currentPrice * 0.0005; // 0.05% safety cushion
    
    if (absorption.type === 'BUY_ABSORPTION') {
      // Passive whale buyers absorbing market sellers (Bullish Reversal Setup)
      const idealPrice = absorption.price + tickOffset;
      const entry = formatZone(idealPrice, idealPrice - 0.5 * atr, idealPrice + 0.5 * atr);
      const sl = Math.min(swingLow, absorption.price - 0.75 * atr); // Tight stop protected by absorption block
      const tp1 = swingHigh;
      const tp2 = swingHigh + range * 0.618;
      return {
        strategy: 'ALCHEMIC_REACTION',
        direction: 'LONG',
        entry,
        sl,
        tp1,
        tp2,
        note: `🧪 ALCHEMIC REACTION (Bullish Sweep & Passive Limit Absorption detected at $${f(absorption.price)} with strength ${absorption.strength.toFixed(1)})`
      };
    } else if (absorption.type === 'SELL_ABSORPTION') {
      // Passive whale sellers absorbing market buyers (Bearish Reversal Setup)
      const idealPrice = absorption.price - tickOffset;
      const entry = formatZone(idealPrice, idealPrice - 0.5 * atr, idealPrice + 0.5 * atr);
      const sl = Math.max(swingHigh, absorption.price + 0.75 * atr);
      const tp1 = swingLow;
      const tp2 = swingLow - range * 0.618;
      return {
        strategy: 'ALCHEMIC_REACTION',
        direction: 'SHORT',
        entry,
        sl,
        tp1,
        tp2,
        note: `🧪 ALCHEMIC REACTION (Bearish Sweep & Passive Limit Absorption detected at $${f(absorption.price)} with strength ${absorption.strength.toFixed(1)})`
      };
    }
  }

  // 2. STRATEGY: MOMENTUM BREAKOUT (Trending, Squeeze released, CVD confirming trend)
  if (regime === 'TREND' && squeezeState === 'RELEASED') {
    if (isUpward && cvdBias === 'BULL') {
      // Bullish Breakout LONG
      const idealPrice = currentPrice;
      const entry = formatZone(idealPrice, idealPrice - 0.5 * atr, idealPrice + 0.5 * atr);
      const sl = currentPrice - 1.5 * atr;
      const tp1 = currentPrice + 2.0 * atr;   // Min 1.33:1 R:R
      const tp2 = currentPrice + 4.0 * atr;   // Extended target
      return { strategy: 'MOMENTUM_BREAKOUT', direction: 'LONG', entry, sl, tp1, tp2, note: '🚀 TRENDING MOMENTUM (Market Entry via ATR Breakout)' };
    } else if (!isUpward && cvdBias === 'BEAR') {
      // Bearish Breakout SHORT
      const idealPrice = currentPrice;
      const entry = formatZone(idealPrice, idealPrice - 0.5 * atr, idealPrice + 0.5 * atr);
      const sl = currentPrice + 1.5 * atr;
      const tp1 = currentPrice - 2.0 * atr;   // Min 1.33:1 R:R
      const tp2 = currentPrice - 4.0 * atr;   // Extended target
      return { strategy: 'MOMENTUM_BREAKOUT', direction: 'SHORT', entry, sl, tp1, tp2, note: '🚀 TRENDING MOMENTUM (Market Entry via ATR Breakout)' };
    }
  }

  // 3. STRATEGY: LIQUIDITY SHIELD (Front-running MEGA walls close to the price)
  if (whaleWalls && whaleWalls.length > 0) {
    // Find closest whale wall within 0.75% of current price
    const wallsWithDist = whaleWalls.map(w => ({
      ...w,
      distPct: Math.abs((w.price - currentPrice) / currentPrice) * 100
    })).filter(w => w.distPct <= 0.75);

    if (wallsWithDist.length > 0) {
      const closestWall = wallsWithDist.sort((a, b) => a.distPct - b.distPct)[0];
      const tick = currentPrice * 0.0005; // 0.05% offset to ensure fill / shield

      if (closestWall.side === 'bid' && isUpward) {
        // Buy support shield (Long)
        const idealPrice = closestWall.price + tick;
        const entry = formatZone(idealPrice, closestWall.price, idealPrice + 0.5 * atr);
        const sl = closestWall.price - tick * 4; // stop loss protected below wall
        const tp1 = swingHigh;
        const tp2 = swingHigh + range * 0.618;
        return { strategy: 'LIQUIDITY_SHIELD', direction: 'LONG', entry, sl, tp1, tp2, note: `🛡️ LIQUIDITY SHIELD (Protected Entry front-running Mega Bid Wall at $${f(closestWall.price)})` };
      } else if (closestWall.side === 'ask' && !isUpward) {
        // Sell resistance shield (Short)
        const idealPrice = closestWall.price - tick;
        const entry = formatZone(idealPrice, idealPrice - 0.5 * atr, closestWall.price);
        const sl = closestWall.price + tick * 4;
        const tp1 = swingLow;
        const tp2 = swingLow - range * 0.618;
        return { strategy: 'LIQUIDITY_SHIELD', direction: 'SHORT', entry, sl, tp1, tp2, note: `🛡️ LIQUIDITY SHIELD (Protected Entry front-running Mega Ask Wall at $${f(closestWall.price)})` };
      }
    }
  }

  // 4. STRATEGY: SMART PULLBACK OTE
  // Blends Macro Fibonacci OTE + Local Swing Micro-OTE + Whale Wall Anchor + Order Block
  // Priority: OB top/bottom > Nearest Bid/Ask Wall > Local Fib 0.618 > Macro Fib 0.666

  // Compute local micro-structure swing (last 12 bars)
  const { localHigh, localLow } = computeLocalSwing(highs, lows, 12);
  const localRange = localHigh - localLow;

  // Order Block detection
  const ob = opens.length ? detectOrderBlock(opens, highs, lows, closes, 20) : null;

  // Nearest bid wall within 1.5% for LONG anchor, nearest ask wall for SHORT
  const findWallAnchor = (side) => {
    if (!whaleWalls || !whaleWalls.length) return null;
    const candidates = whaleWalls
      .filter(w => w.side === side && Math.abs((w.price - currentPrice) / currentPrice) <= 0.015)
      .sort((a, b) => (side === 'bid' ? b.price - a.price : a.price - b.price)); // closest to current price
    return candidates[0] || null;
  };

  if (isUpward) {
    const macroIdeal   = swingHigh - range * 0.666;       // Macro Fib 0.666
    const localIdeal   = localHigh - localRange * 0.618;  // Local Fib 0.618 (shallower pullback)
    const bidWall      = findWallAnchor('bid');
    const obBase       = ob ? ob.low : null;              // OB body low = demand base
    const obTop        = ob ? ob.high : null;             // OB body high = demand ceiling

    // Zone Low: prefer OB base, fallback to bid wall, fallback to local Fib 0.786
    const zoneLow  = obBase    ? Math.max(obBase, localHigh - localRange * 0.786)
                   : bidWall   ? Math.max(bidWall.price, localHigh - localRange * 0.786)
                   : localHigh - localRange * 0.786;

    // Zone High: prefer OB top, fallback to local Fib 0.618
    const zoneHigh = obTop     ? Math.min(obTop, localHigh - localRange * 0.500)
                   : localHigh - localRange * 0.500;

    // Ideal entry: midpoint of the zone (not deep macro fib)
    const idealPrice = (zoneLow + zoneHigh) / 2;

    // Smart SL: ensure at least 1.0 * ATR breathing room; fallback to macro swing low if local low is too tight
    let sl = localLow - 0.5 * atr;
    if (idealPrice - sl < 1.0 * atr) {
      sl = Math.min(sl, swingLow - 0.25 * atr);
    }
    if (obBase && obBase < idealPrice) {
      sl = Math.min(sl, obBase - 0.5 * atr);
    }

    // Enforce Minimum Stop Loss Floor (0.8% distance from Entry)
    const minLongSl = idealPrice * 0.992;
    if (sl > minLongSl) {
      sl = minLongSl;
    }

    const tp1Raw = swingHigh;
    const tp2Raw = swingHigh + range * 0.618;
    const entry = formatZone(idealPrice, zoneLow, zoneHigh);

    // ── Minimum R:R guard ─────────────────────────────────────────────
    // If TP1 is not at least 1.5x the SL risk away from ideal entry, extend it
    const riskDist = idealPrice - sl;
    const tp1 = (tp1Raw - idealPrice) >= (1.5 * riskDist)
      ? tp1Raw
      : idealPrice + 1.5 * riskDist;                     // enforce min 1.5:1 R:R
    const tp2 = Math.max(tp2Raw, idealPrice + 3.0 * riskDist); // enforce min 3:1 R:R

    const note = ob
      ? `📐 SMART OTE LONG (OB Demand Zone $${f(ob.low)}-$${f(ob.high)}${bidWall ? ` | Bid Wall $${f(bidWall.price)}` : ''})`
      : `📐 LOCAL OTE LONG (Micro Swing Fib 0.618-0.786${bidWall ? ` | Bid Wall $${f(bidWall.price)}` : ''})` ;

    return { strategy: 'PULLBACK_OTE', direction: 'LONG', entry, sl, tp1, tp2, note };
  } else {
    const macroIdeal   = swingLow + range * 0.666;
    const localIdeal   = swingLow + localRange * 0.618;
    const askWall      = findWallAnchor('ask');
    const obTop        = ob ? ob.high : null;
    const obBase       = ob ? ob.low : null;

    const zoneHigh = obTop    ? Math.min(obTop, localLow + localRange * 0.786)
                   : askWall  ? Math.min(askWall.price, localLow + localRange * 0.786)
                   : localLow + localRange * 0.786;

    const zoneLow  = obBase   ? Math.max(obBase, localLow + localRange * 0.500)
                   : localLow + localRange * 0.500;

    const idealPrice = (zoneLow + zoneHigh) / 2;

    // Smart SL: ensure at least 1.0 * ATR breathing room; fallback to macro swing high if local high is too tight
    let sl = localHigh + 0.5 * atr;
    if (sl - idealPrice < 1.0 * atr) {
      sl = Math.max(sl, swingHigh + 0.25 * atr);
    }
    if (obTop && obTop > idealPrice) {
      sl = Math.max(sl, obTop + 0.5 * atr);
    }

    // Enforce Minimum Stop Loss Floor (0.8% distance from Entry)
    const minShortSl = idealPrice * 1.008;
    if (sl < minShortSl) {
      sl = minShortSl;
    }

    const tp1Raw = swingLow;
    const tp2Raw = swingLow - range * 0.618;
    const entry = formatZone(idealPrice, zoneLow, zoneHigh);

    // ── Minimum R:R guard ─────────────────────────────────────────────
    const riskDist = sl - idealPrice;
    const tp1 = (idealPrice - tp1Raw) >= (1.5 * riskDist)
      ? tp1Raw
      : idealPrice - 1.5 * riskDist;                     // enforce min 1.5:1 R:R
    const tp2 = Math.min(tp2Raw, idealPrice - 3.0 * riskDist); // enforce min 3:1 R:R

    const note = ob
      ? `📐 SMART OTE SHORT (OB Supply Zone $${f(ob.low)}-$${f(ob.high)}${askWall ? ` | Ask Wall $${f(askWall.price)}` : ''})`
      : `📐 LOCAL OTE SHORT (Micro Swing Fib 0.618-0.786${askWall ? ` | Ask Wall $${f(askWall.price)}` : ''})`;

    return { strategy: 'PULLBACK_OTE', direction: 'SHORT', entry, sl, tp1, tp2, note };
  }
}

// ─── ARIS UF Score (14 computable conditions) ──────────────────────

function computeUFScore({ rsiLast, wt1Last, wt2Last, hybridLast, stochKLast, mfiLast, cmfLast, cvdBias, macdHist, adxVal, chop, zScore, smTrap, ufoNorm, oteRetest }) {
  // Each condition: 1 = BULL, 0 = BEAR/NEUTRAL
  // Conditions 1-7 (UF Conds 1-7 in dashboard)
  const c1 = rsiLast != null ? (rsiLast > 55 ? 1 : 0) : null;          // RSI Bull
  const c2 = wt1Last != null ? (wt1Last > 0 ? 1 : 0) : null;           // WT1 Bull
  const c3 = wt2Last != null ? (wt2Last > 0 ? 1 : 0) : null;           // WT2 Bull
  const c4 = hybridLast != null ? (hybridLast > 0 ? 1 : 0) : null;     // Hybrid Osc Bull
  const c5 = stochKLast != null ? (stochKLast > 50 ? 1 : 0) : null;    // StochRSI Bull
  const c6 = mfiLast != null ? (mfiLast > 50 ? 1 : 0) : null;          // MFI Bull
  const c7 = cmfLast != null ? (cmfLast > 0 ? 1 : 0) : null;           // CMF Bull

  // Conditions 8-14 (UF Conds 8-14 in dashboard)
  const c8 = cvdBias === 'BULL' ? 1 : 0;                                // CVD Bull
  const c9 = macdHist != null ? (macdHist > 0 ? 1 : 0) : null;         // MACD Hist Bull
  const c10 = adxVal != null ? (adxVal > 20 ? 1 : 0) : null;           // ADX Trending
  const c11 = chop != null ? (chop < 61.8 ? 1 : 0) : null;             // Not Choppy
  const c12 = zScore != null ? (Math.abs(zScore) < 2 ? 1 : 0) : null;  // Z-Score in range
  const c13 = smTrap === 'NONE' ? 1 : 0;                                // No SM Trap
  const c14 = oteRetest ? 1 : 0;                                       // Price in OTE zone

  const conditions = [c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11, c12, c13, c14];
  const bullScore = conditions.filter(c => c === 1).length;
  const bearScore = conditions.filter(c => c === 0).length;
  const total = conditions.filter(c => c !== null).length;

  return {
    bullScore,
    bearScore,
    total,
    condBitmap: conditions.map(c => (c === null ? 'N' : c === 1 ? 'Y' : '0')).join(''),
    conditions
  };
}

// ─── Regime + Dynamic Threshold ──────────────────────────────────────────────

function computeRegime(adxVal, chop) {
  if (adxVal == null || chop == null) return { regime: 'RANGE', threshold: 18 };
  if (adxVal >= 25 && chop < 61.8) return { regime: 'TREND', threshold: 14 };
  if (adxVal < 15 || chop >= 61.8) return { regime: 'CHOPPY', threshold: 22 };
  return { regime: 'RANGE', threshold: 18 };
}

// ─── Direction-aware IDC ─────────────────────────────────────────────────────

function computeIDC(mfiLast, ufBullScore, ufBearScore) {
  const longOk = mfiLast != null && mfiLast > 55 && ufBullScore > 4;
  const shortOk = mfiLast != null && mfiLast < 45 && ufBearScore > 4;
  if (longOk) return 'LONG_CONFIRMED';
  if (shortOk) return 'SHORT_CONFIRMED';
  return 'NONE';
}

// ─── MEGA SCORE (Phase 1, max 25) ────────────────────────────────────────────
// Each of the 25 scored conditions contributes 0 or 1 point.
// Direction is determined by which side (long vs short) has more points.

function computeMegaScore({ ufScore, ufoNorm, hybridLast, wt1Last, macdHist, mfiLast, cmfLast, cvdBias, fpBias, zScore, chop, adxVal, smTrap, benfordOk, relVol }) {
  // 25 binary conditions (scored for the LONG direction; inverse for SHORT)
  const conds = [
    // UFO Fusion block (6 signals → 6 pts)
    ufoNorm > 33 ? 1 : 0,          // UFO Fusion strongly bullish
    ufoNorm > 0 ? 1 : 0,           // UFO Fusion mildly bullish

    // WaveTrend (2 pts)
    wt1Last != null && wt1Last > 0 ? 1 : 0,
    wt1Last != null && wt1Last > 20 ? 1 : 0,

    // Hybrid Oscillator (2 pts)
    hybridLast != null && hybridLast > 0 ? 1 : 0,
    hybridLast != null && hybridLast > 20 ? 1 : 0,

    // MACD (2 pts)
    macdHist != null && macdHist > 0 ? 1 : 0,
    macdHist != null && macdHist > 0 && zScore != null && zScore > -1 ? 1 : 0,

    // Money Flow MFI (2 pts)
    mfiLast != null && mfiLast > 50 ? 1 : 0,
    mfiLast != null && mfiLast > 60 ? 1 : 0,

    // CMF (1 pt)
    cmfLast != null && cmfLast > 0.05 ? 1 : 0,

    // CVD (2 pts)
    cvdBias === 'BULL' ? 1 : 0,
    cvdBias === 'BULL' && fpBias === 1 ? 1 : 0,

    // FP Delta (1 pt)
    fpBias === 1 ? 1 : 0,

    // Z-Score (1 pt — oversold range = potential long entry)
    zScore != null && zScore < -0.5 && zScore > -2.5 ? 1 : 0,

    // Volume Engine (1 pt)
    relVol != null && relVol.signal !== 'LOW' ? 1 : 0,

    // Regime/ADX (2 pts)
    adxVal != null && adxVal > 20 ? 1 : 0,
    chop != null && chop < 61.8 ? 1 : 0,

    // SM Trap penalty (–1 if BEAR_TRAP active during long consideration)
    smTrap === 'BEAR_TRAP' ? 0 : 1,

    // Benford (1 pt — clean volume distribution)
    benfordOk ? 1 : 0,

    // UFO Fusion bonus for extreme readings
    ufoNorm >= 66 ? 1 : 0,
    ufoNorm === 100 ? 1 : 0,

    // Hybrid + WT agree (confluence bonus)
    hybridLast != null && wt1Last != null && hybridLast > 0 && wt1Last > 0 ? 1 : 0,

    // MFI + CMF agree
    mfiLast != null && cmfLast != null && mfiLast > 50 && cmfLast > 0 ? 1 : 0,

    // CVD + FP agree
    cvdBias === 'BULL' && fpBias > 0 ? 1 : 0,
  ];

  const longScore = conds.reduce((a, b) => a + b, 0); // Bull conditions satisfied
  // SHORT score: inverse logic (how many of 25 are BEARISH)
  const bearConds = [
    ufoNorm < -33 ? 1 : 0,
    ufoNorm < 0 ? 1 : 0,
    wt1Last != null && wt1Last < 0 ? 1 : 0,
    wt1Last != null && wt1Last < -20 ? 1 : 0,
    hybridLast != null && hybridLast < 0 ? 1 : 0,
    hybridLast != null && hybridLast < -20 ? 1 : 0,
    macdHist != null && macdHist < 0 ? 1 : 0,
    macdHist != null && macdHist < 0 && zScore != null && zScore < 1 ? 1 : 0,
    mfiLast != null && mfiLast < 50 ? 1 : 0,
    mfiLast != null && mfiLast < 40 ? 1 : 0,
    cmfLast != null && cmfLast < -0.05 ? 1 : 0,
    cvdBias === 'BEAR' ? 1 : 0,
    cvdBias === 'BEAR' && fpBias === -1 ? 1 : 0,
    fpBias === -1 ? 1 : 0,
    zScore != null && zScore > 0.5 && zScore < 2.5 ? 1 : 0,
    relVol != null && relVol.signal !== 'LOW' ? 1 : 0,
    adxVal != null && adxVal > 20 ? 1 : 0,
    chop != null && chop < 61.8 ? 1 : 0,
    smTrap === 'BULL_TRAP' ? 0 : 1,
    benfordOk ? 1 : 0,
    ufoNorm <= -66 ? 1 : 0,
    ufoNorm === -100 ? 1 : 0,
    hybridLast != null && wt1Last != null && hybridLast < 0 && wt1Last < 0 ? 1 : 0,
    mfiLast != null && cmfLast != null && mfiLast < 50 && cmfLast < 0 ? 1 : 0,
  ];
  const shortScore = bearConds.reduce((a, b) => a + b, 0);

  // Dominant direction and combined MEGA SCORE
  const direction = longScore >= shortScore ? 'LONG' : 'SHORT';
  const megaScore = direction === 'LONG' ? longScore : shortScore;
  const maxScore = 25; // Phase 1 maximum

  return { megaScore, maxScore, longScore, shortScore, direction };
}

// ─── Confidence % (interim, Phase 1) ─────────────────────────────────────────

function computeConfidence(megaScore, maxScore, regime, threshold, mtfScoreNum) {
  const baseConf = (megaScore / maxScore) * 100;
  // MTF alignment bonus/penalty
  const mtfBonus = mtfScoreNum != null ? (mtfScoreNum / 3) * 10 : 0; // ±10% max
  const regimePenalty = regime === 'CHOPPY' ? -10 : 0;
  const raw = Math.min(100, Math.max(0, baseConf + mtfBonus + regimePenalty));

  let grade;
  if (raw >= 90) grade = 'A+';
  else if (raw >= 80) grade = 'A';
  else if (raw >= 70) grade = 'B+';
  else if (raw >= 60) grade = 'B';
  else if (raw >= 45) grade = 'C';
  else grade = 'D';

  return { confidencePct: parseFloat(raw.toFixed(1)), confidenceGrade: grade };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN EXPORTED FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

export function computeArisScore({ opens, highs, lows, closes, volumes }) {
  // 1. Core oscillators
  const rsiArr = computeRSI(closes, 14);
  const rsiLast = last(rsiArr);

  const { wt1, wt2 } = computeWaveTrend(highs, lows, closes);
  const wt1Last = last(wt1);
  const wt2Last = last(wt2);

  const hybridArr = computeHybridOsc(closes, highs, lows);
  const hybridLast = last(hybridArr);

  const { k: stochK } = computeStochRSI(closes);
  const stochKLast = last(stochK);

  // 2. Money Flow
  const mfiArr = computeMFI(highs, lows, closes, volumes, 14);
  const mfiLast = last(mfiArr);

  const cmfArr = computeCMF(highs, lows, closes, volumes, 20);
  const cmfLast = last(cmfArr);

  // 3. Volume/Delta
  const cvdResult = computeCVD(opens, closes, volumes);
  const fpResult = computeFPDelta(opens, closes, volumes);
  const relVol = computeRelativeVolume(volumes, 20);
  const vwap = computeVWAP(highs, lows, closes, volumes);

  // 4. Structural
  const zScore = computeZScore(closes, 20);
  const chop = computeChoppiness(highs, lows, closes, 14);

  // 5. Pattern detection & Swing/OTE analysis
  const swings = detectSwings(highs, lows, 10);
  const smTrap = detectSMTrap(opens, highs, lows, closes, swings.swingHigh, swings.swingLow);
  const benford = checkBenford(volumes);
  const currentPrice = closes[closes.length - 1];

  // Compute a preliminary OTE (RANGE fallback) for the oteRetest flag only.
  // The real execution setup (with regime / whale walls) is computed in finalizeArisScore.
  const ote = calculateExecutionSetup({
    swingHigh: swings.swingHigh, swingLow: swings.swingLow, currentPrice,
    highs, lows, opens, closes,
    regime: 'RANGE', squeezeState: null, cvdBias: null, whaleWalls: [],
    smTrap
  });

  // Check if current price is inside the OTE zone (0.618 to 0.786 of swing range)
  let oteRetest = false;
  if (ote && swings.swingHigh > swings.swingLow) {
    const range = swings.swingHigh - swings.swingLow;
    const oteUpper = swings.swingHigh - range * 0.618;
    const oteLower = swings.swingHigh - range * 0.786;
    const price = currentPrice;
    if (price >= Math.min(oteLower, oteUpper) && price <= Math.max(oteLower, oteUpper)) {
      oteRetest = true;
    }
  }

  // 5b. Squeeze Momentum (Carter TTM)
  const squeeze = computeSqueezeMomentum(highs, lows, closes);

  // 5c. Whale Absorption (CVD Z-Score divergence)
  const whaleAbsorption = computeWhaleAbsorption(opens, closes, volumes);

  // 6. UFO Fusion
  const ufo = computeUFOFusion({
    wt1: wt1Last, wt2: wt2Last, hybridOsc: hybridLast,
    stochK: stochKLast, mfi: mfiLast, cmf: cmfLast,
    cvdBias: cvdResult.bias
  });

  // 7. ADX (already computed externally, but we'll leave placeholder)
  // ADX is passed in from getLiveIndicators merged result
  const adxPlaceholder = null; // Will be merged from main indicators.js output

  // 8. UF Score
  const ufScoreResult = computeUFScore({
    rsiLast, wt1Last, wt2Last, hybridLast, stochKLast,
    mfiLast, cmfLast, cvdBias: cvdResult.bias,
    macdHist: null, // merged later from indicators.js
    adxVal: null,   // merged later
    chop,
    zScore,
    smTrap,
    ufoNorm: ufo.ufoNorm,
    oteRetest
  });

  return {
    // Raw oscillator values
    rsi: rsiLast != null ? parseFloat(rsiLast.toFixed(2)) : null,
    wt1: wt1Last != null ? parseFloat(wt1Last.toFixed(2)) : null,
    wt2: wt2Last != null ? parseFloat(wt2Last.toFixed(2)) : null,
    hybridOsc: hybridLast != null ? parseFloat(hybridLast.toFixed(2)) : null,
    stochRsiK: stochKLast != null ? parseFloat(stochKLast.toFixed(2)) : null,
    mfi: mfiLast != null ? parseFloat(mfiLast.toFixed(2)) : null,
    cmf: cmfLast != null ? parseFloat(cmfLast.toFixed(4)) : null,
    cvd: parseFloat(cvdResult.cvd.toFixed(0)),
    cvdBias: cvdResult.bias,
    cvdDelta20: parseFloat(cvdResult.cvdDelta20.toFixed(0)),
    fpDelta: fpResult.delta,
    fpImbalance: fpResult.imbalance,
    fpBias: fpResult.bias,
    zScore: zScore != null ? parseFloat(zScore.toFixed(3)) : null,
    choppiness: chop != null ? parseFloat(chop.toFixed(1)) : null,
    vwap: parseFloat(vwap.toFixed(4)),
    relativeVolume: relVol,
    smTrap,
    benfordOk: benford.ok,
    benfordNote: benford.note || (benford.ok ? 'NORMAL' : 'ANOMALY'),
    ufoNorm: ufo.ufoNorm,
    ufoScore: ufo.ufoScore,
    ufBullScore: ufScoreResult.bullScore,
    ufBearScore: ufScoreResult.bearScore,
    ufCondBitmap: ufScoreResult.condBitmap,
    swings,
    ote,
    oteRetest,
    squeeze,
    whaleAbsorption,
    _ohlcv: { highs, lows, opens, closes } // kept for ATR + OB in finalizeArisScore
  };
}

export function finalizeArisScore(raw, mtfScoreStr, extAdx = null, extMacdHist = null, whaleWalls = [], absorption = null) {
  // Parse MTF score number from string like "+1/4" or "-3/3"
  let mtfScoreNum = null;
  if (mtfScoreStr) {
    const m = mtfScoreStr.match(/^([+-]?\d+)\//);
    if (m) mtfScoreNum = parseInt(m[1]);
  }

  // Re-run UF Score — adx and macdHist come from indicators.js parameters
  const adxVal = extAdx;
  const macdHist = extMacdHist;

  const ufScoreResult = computeUFScore({
    rsiLast: raw.rsi,
    wt1Last: raw.wt1,
    wt2Last: raw.wt2,
    hybridLast: raw.hybridOsc,
    stochKLast: raw.stochRsiK,
    mfiLast: raw.mfi,
    cmfLast: raw.cmf,
    cvdBias: raw.cvdBias,
    macdHist,
    adxVal,
    chop: raw.choppiness,
    zScore: raw.zScore,
    smTrap: raw.smTrap,
    ufoNorm: raw.ufoNorm,
    oteRetest: raw.oteRetest
  });

  const { regime, threshold } = computeRegime(adxVal, raw.choppiness);
  const idcStatus = computeIDC(raw.mfi, ufScoreResult.bullScore, ufScoreResult.bearScore);

  // ── Execution Setup (regime-aware, whale-wall-aware) ────────────────────────
  // Recompute using the real regime we just determined + live whale walls from heatmap.
  const ohlcv = raw._ohlcv || {};
  const executionSetup = raw.swings ? calculateExecutionSetup({
    swingHigh:    raw.swings.swingHigh,
    swingLow:     raw.swings.swingLow,
    currentPrice: ohlcv.closes?.length
      ? ohlcv.closes[ohlcv.closes.length - 1]
      : (raw.swings.swingHigh + raw.swings.swingLow) / 2,
    highs:  ohlcv.highs  || [],
    lows:   ohlcv.lows   || [],
    opens:  ohlcv.opens  || [],
    closes: ohlcv.closes || [],
    regime,
    squeezeState: raw.squeeze?.state ?? null,
    cvdBias: raw.cvdBias,
    whaleWalls,
    absorption,
    smTrap: raw.smTrap
  }) : raw.ote;

  const { megaScore, maxScore, longScore, shortScore, direction } = computeMegaScore({
    ufScore: ufScoreResult.bullScore,
    ufoNorm: raw.ufoNorm,
    hybridLast: raw.hybridOsc,
    wt1Last: raw.wt1,
    macdHist,
    mfiLast: raw.mfi,
    cmfLast: raw.cmf,
    cvdBias: raw.cvdBias,
    fpBias: raw.fpBias,
    zScore: raw.zScore,
    chop: raw.choppiness,
    adxVal,
    smTrap: raw.smTrap,
    benfordOk: raw.benfordOk,
    relVol: raw.relativeVolume
  });

  const { confidencePct, confidenceGrade } = computeConfidence(megaScore, maxScore, regime, threshold, mtfScoreNum);

  // Direction-aware MEGA SCORE label
  let scoreLabel;
  if (megaScore >= threshold + 6) scoreLabel = '🔥 LEGENDARY';
  else if (megaScore >= threshold + 3) scoreLabel = '⚡ ELITE';
  else if (megaScore >= threshold) scoreLabel = '✅ STRONG';
  else if (megaScore >= threshold - 3) scoreLabel = '⚠️ AVERAGE';
  else scoreLabel = '❌ WEAK';

  const { _ohlcv, ...rawClean } = raw; // strip private price arrays from output
  return {
    ...rawClean,
    ufBullScore: ufScoreResult.bullScore,
    ufBearScore: ufScoreResult.bearScore,
    ufCondBitmap: ufScoreResult.condBitmap,
    regime,
    dynThreshold: threshold,
    idcStatus,
    megaScore,
    maxScore,
    megaScoreStr: `${megaScore}/${maxScore} (Phase1)`,
    scoreLabel,
    longScore,
    shortScore,
    direction,
    confidencePct,
    confidenceGrade,
    ote: executionSetup,
    executionStrategy: executionSetup?.strategy ?? 'PULLBACK_OTE',
    executionNote: executionSetup?.note ?? '📐 PULLBACK OTE (Waiting for Fibonacci retracement retest)',
  };
}


export function formatArisContext(result) {
  const f = (val) => {
    if (val == null) return '0';
    return val < 1 ? val.toFixed(5) : val < 1000 ? val.toFixed(3) : val.toFixed(2);
  };

  let entryStr = 'NONE';
  if (result.ote?.entry) {
    const ent = result.ote.entry;
    entryStr = typeof ent === 'object'
      ? `$${f(ent.low)} - $${f(ent.high)} (Ideal: $${f(ent.price)})`
      : `$${f(Number(ent))}`;
  }

  const oteText = result.ote
    ? `Execution Strategy: ${result.executionStrategy || 'PULLBACK_OTE'} | ${result.executionNote || ''}
OTE Setup Type : ${result.ote.direction} (Swing High: $${f(result.swings.swingHigh)}, Low: $${f(result.swings.swingLow)})
Computed Entry Zone : ${entryStr}
Computed SL    : $${f(result.ote.sl)}
Computed TP1/2 : TP1=$${f(result.ote.tp1)} | TP2=$${f(result.ote.tp2)}
OTE Zone Retest: ${result.oteRetest ? 'ACTIVE RETEST' : 'OUTSIDE ZONE'}`
    : 'OTE Setup Type : NONE (No valid swing structure detected)';

  return `
ARIS QUANTUM ENGINE (Phase 1 — computed from OHLCV, authoritative, do NOT re-read from image):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MEGA SCORE     : ${result.megaScoreStr} — ${result.scoreLabel}
Direction Bias : ${result.direction} (Long:${result.longScore}/25 vs Short:${result.shortScore}/25)
Regime         : ${result.regime} (Chop:${result.choppiness}, Threshold:${result.dynThreshold})
IDC Status     : ${result.idcStatus}
Confidence     : ${result.confidencePct}% — Grade ${result.confidenceGrade}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${oteText}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
UFO Fusion     : ${result.ufoNorm > 0 ? '+' : ''}${result.ufoNorm}% (${result.ufoScore}/6 signals)
WaveTrend      : WT1=${result.wt1}, WT2=${result.wt2}
Hybrid Osc     : ${result.hybridOsc}
StochRSI K     : ${result.stochRsiK}
Money Flow MFI : ${result.mfi}/100 (${result.mfi > 55 ? 'BULL' : result.mfi < 45 ? 'BEAR' : 'NEUTRAL'})
CMF            : ${result.cmf} (${result.cmf > 0.05 ? 'BULL' : result.cmf < -0.05 ? 'BEAR' : 'NEUTRAL'})
CVD            : ${result.cvd > 0 ? '+' : ''}${result.cvd} | 20-bar Delta: ${result.cvdDelta20 > 0 ? '+' : ''}${result.cvdDelta20} | Bias: ${result.cvdBias}
FP Delta       : ${result.fpDelta > 0 ? '+' : ''}${result.fpDelta} (${result.fpImbalance})
Z-Score        : ${result.zScore} (${result.zScore > 2 ? 'OVERBOUGHT' : result.zScore < -2 ? 'OVERSOLD' : 'IN RANGE'})
VWAP           : ${result.vwap}
Volume Engine  : ${result.relativeVolume.ratio}x (${result.relativeVolume.signal})
SM Trap        : ${result.smTrap}
Benford Law    : ${result.benfordNote}
UF Conds (1-14): ${result.ufCondBitmap} | Bull:${result.ufBullScore} Bear:${result.ufBearScore}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Squeeze Momentum: ${result.squeeze?.state ?? 'N/A'} | Direction: ${result.squeeze?.direction ?? 'N/A'} | Value: ${result.squeeze?.momentumValue ?? 'N/A'}
  → If SQUEEZED+BULLISH: expect imminent upside breakout. If SQUEEZED+BEARISH: expect imminent downside breakout. If RELEASED: breakout already in motion.
Whale Absorption: CVD-Z=${result.whaleAbsorption?.cvdZScore ?? 'N/A'} | Price-Z=${result.whaleAbsorption?.priceZScore ?? 'N/A'} | Signal: ${result.whaleAbsorption?.absorptionSignal ?? 'NONE'}
  → BUY_ABSORPTION = large buyers absorbed by limit sellers (hidden distribution). SELL_ABSORPTION = large sellers absorbed by limit buyers (hidden accumulation). NONE = no anomaly.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NOTE: Phase 1 max score is 25/31. Phase 2 additions pending: Funding Rate, OI, DXY correlation, EQH/EQL heatmap.
`.trim();
}
