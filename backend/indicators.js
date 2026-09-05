import { EMA, RSI, MACD, ADX } from 'technicalindicators';
import { computeArisScore, finalizeArisScore, formatArisContext } from './arisEngine.js';

// Normalize timeframe for Binance API (e.g. "1H" -> "1h", "1D" -> "1d")
// IMPORTANT: Binance uses case-sensitive codes: '1m' = 1 minute, '1M' = 1 month.
// To avoid collisions, internal labels use '1mo' for monthly which is mapped here.
function normalizeTimeframe(tf) {
  if (!tf) return '1h';
  const clean = tf.toUpperCase().trim();
  if (clean === '1H') return '1h';
  if (clean === '4H') return '4h';
  if (clean === '1D') return '1d';
  if (clean === '1W') return '1w';
  if (clean === '15M') return '15m';
  if (clean === '5M') return '5m';
  if (clean === '30M') return '30m';
  // Monthly: must map BEFORE the generic fallback since '1m' != '1M' on Binance
  if (clean === '1MO' || clean === '1MONTH' || clean === 'MONTHLY') return '1M';
  return clean.toLowerCase();
}

// Normalize symbol for Binance API (e.g. "BTC/USDT" or "BTCUSDT.P" -> "BTCUSDT")
function normalizeSymbol(sym) {
  if (!sym) return 'BTCUSDT';
  return sym.toUpperCase().replace(/[\/\.\-P]/g, '').trim();
}

// Helper to fetch Klines from Binance with geo-block resilience
async function fetchBinanceKlines(symbol, interval, limit) {
  const hosts = [
    'https://data-api.binance.vision/api/v3/klines',
    'https://api.binance.com/api/v3/klines',
    'https://fapi.binance.com/fapi/v1/klines'
  ];
  for (const host of hosts) {
    try {
      const url = `${host}?symbol=${symbol}&interval=${interval}&limit=${limit}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) return data;
      }
    } catch { /* try next host */ }
  }
  return null;
}

/**
 * Fetch historical candles and calculate technical indicators.
 * Returns a clean object containing indicator readings.
 */
export async function getLiveIndicators(symbol, timeframe, whaleWalls = [], absorption = null, hints = '', liveCvdBias = null, newsSentiment = null) {
  const binanceSymbol = normalizeSymbol(symbol);
  const interval = normalizeTimeframe(timeframe);

  try {
    // We request 200 candles to have enough data for EMA200
    const data = await fetchBinanceKlines(binanceSymbol, interval, 250);
    if (!data) throw new Error(`Failed to fetch Binance klines for ${binanceSymbol}`);

    // Map to OHLCV arrays
    const opens = [];
    const closes = [];
    const highs = [];
    const lows = [];
    const volumes = [];
    const pricesForPoc = [];

    data.forEach(c => {
      const openPrice = parseFloat(c[1]);
      const highPrice = parseFloat(c[2]);
      const lowPrice = parseFloat(c[3]);
      const closePrice = parseFloat(c[4]);
      const vol = parseFloat(c[5]);

      opens.push(openPrice);
      closes.push(closePrice);
      highs.push(highPrice);
      lows.push(lowPrice);
      volumes.push(vol);

      // Add close and volume weight for POC approximation
      pricesForPoc.push({ price: closePrice, volume: vol });
    });

    if (closes.length < 200) {
      return { error: 'Insufficient candle data retrieved' };
    }

    // 1. Calculate EMAs
    const ema20Arr = EMA.calculate({ period: 20, values: closes });
    const ema50Arr = EMA.calculate({ period: 50, values: closes });
    const ema200Arr = EMA.calculate({ period: 200, values: closes });

    // 2. Calculate RSI (14)
    const rsiArr = RSI.calculate({ period: 14, values: closes });

    // 3. Calculate MACD (12, 26, 9)
    const macdArr = MACD.calculate({
      values: closes,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    });

    // 4. Calculate ADX (14)
    const adxArr = ADX.calculate({
      high: highs,
      low: lows,
      close: closes,
      period: 14
    });

    // 5. Calculate POC (Point of Control / Volume Profile) approximation
    const minPrice = Math.min(...closes);
    const maxPrice = Math.max(...closes);
    const numBuckets = 50;
    const bucketSize = (maxPrice - minPrice) / numBuckets;
    const volumeProfile = new Array(numBuckets).fill(0);

    pricesForPoc.forEach(({ price, volume }) => {
      const bucketIdx = Math.min(
        Math.floor((price - minPrice) / bucketSize),
        numBuckets - 1
      );
      volumeProfile[bucketIdx] += volume;
    });

    let maxVolIdx = 0;
    let maxVol = 0;
    volumeProfile.forEach((v, idx) => {
      if (v > maxVol) {
        maxVol = v;
        maxVolIdx = idx;
      }
    });
    const poc = minPrice + (maxVolIdx * bucketSize) + (bucketSize / 2);

    // Helper to fetch close price and EMA200 for any specific timeframe
    const fetchEma200 = async (tf) => {
      try {
        const tfInterval = normalizeTimeframe(tf);
        const tfData = await fetchBinanceKlines(binanceSymbol, tfInterval, 210);
        if (!tfData || !Array.isArray(tfData)) return null;
        const tfCloses = tfData.map(c => parseFloat(c[4]));
        if (tfCloses.length < 200) return null;
        const tfEmaArr = EMA.calculate({ period: 200, values: tfCloses });
        const lastEma = tfEmaArr[tfEmaArr.length - 1];
        const lastClose = tfCloses[tfCloses.length - 1];
        return {
          close: lastClose,
          ema200: lastEma,
          bias: lastClose > lastEma ? 1 : -1
        };
      } catch {
        return null;
      }
    };

    // Define MTF hierarchy based on current timeframe
    // NOTE: Use '1mo' (not '1m') for monthly — normalizeTimeframe() maps '1mo' -> '1M' (Binance monthly)
    let ltf = '15m', htf1 = '4h', htf2 = '1d';
    const tfClean = (timeframe || '1h').toUpperCase().trim();
    if (tfClean === '15M' || tfClean === '5M' || tfClean === '5') {
      ltf = '5m'; htf1 = '1h'; htf2 = '4h';
    } else if (tfClean === '4H' || tfClean === '2H' || tfClean === '4') {
      ltf = '1h'; htf1 = '1d'; htf2 = '1w';
    } else if (tfClean === '1D' || tfClean === '1d') {
      ltf = '4h'; htf1 = '1w'; htf2 = '1mo'; // '1mo' → maps to Binance '1M' (monthly), NOT '1m' (1-minute)
    }

    // Run parallel fetches for MTF timeframes
    const [ltfRes, htf1Res, htf2Res] = await Promise.all([
      fetchEma200(ltf),
      fetchEma200(htf1),
      fetchEma200(htf2)
    ]);

    const currentPrice = closes[closes.length - 1];
    const latestEma20 = ema20Arr[ema20Arr.length - 1];
    const latestEma50 = ema50Arr[ema50Arr.length - 1];
    const latestEma200 = ema200Arr[ema200Arr.length - 1];
    const latestRsi = rsiArr[rsiArr.length - 1];
    const latestMacd = macdArr[macdArr.length - 1];
    const latestAdx = adxArr[adxArr.length - 1];

    // Compute MTF score: (Current timeframe bias + LTF + HTF1 + HTF2 EMA200 statuses)
    const currentBias = currentPrice > latestEma200 ? 1 : -1;
    let mtfScore = currentBias;
    let mtfDetails = [];

    mtfDetails.push(`${timeframe || '1h'} (current): Price $${currentPrice} vs EMA200 $${latestEma200?.toFixed(2)} -> ${currentBias > 0 ? 'BULL' : 'BEAR'}`);

    if (ltfRes) {
      mtfScore += ltfRes.bias;
      mtfDetails.push(`${ltf}: Price $${ltfRes.close} vs EMA200 $${ltfRes.ema200?.toFixed(2)} -> ${ltfRes.bias > 0 ? 'BULL' : 'BEAR'}`);
    }
    if (htf1Res) {
      mtfScore += htf1Res.bias;
      mtfDetails.push(`${htf1}: Price $${htf1Res.close} vs EMA200 $${htf1Res.ema200?.toFixed(2)} -> ${htf1Res.bias > 0 ? 'BULL' : 'BEAR'}`);
    }
    if (htf2Res) {
      mtfScore += htf2Res.bias;
      mtfDetails.push(`${htf2}: Price $${htf2Res.close} vs EMA200 $${htf2Res.ema200?.toFixed(2)} -> ${htf2Res.bias > 0 ? 'BULL' : 'BEAR'}`);
    }

    // Guard: require at least 3 successful TF fetches (current + 2 others) for a valid MTF score.
    // A score from only 1 TF (current alone) is NOT multi-timeframe — it would mislead the AI.
    const totalChecks = 1 + (ltfRes ? 1 : 0) + (htf1Res ? 1 : 0) + (htf2Res ? 1 : 0);
    const mtfValid = totalChecks >= 3;

    // ── ARIS Quantum Engine (Phase 1) ─────────────────────────────────────────
    const arisRaw = computeArisScore({ opens, highs, lows, closes, volumes });
    
    // Parse manual trap override from hints
    const cleanHints = (hints || '').toLowerCase();
    if (cleanHints.includes('bear trap') || cleanHints.includes('beartrap')) {
      arisRaw.smTrap = 'BEAR_TRAP';
    } else if (cleanHints.includes('bull trap') || cleanHints.includes('bulltrap')) {
      arisRaw.smTrap = 'BULL_TRAP';
    }

    const mtfScoreStr = mtfValid ? `${mtfScore > 0 ? '+' : ''}${mtfScore}/${totalChecks}` : null;
    const adxVal = latestAdx ? latestAdx.adx : null;
    const macdHist = latestMacd ? latestMacd.histogram : null;
    const arisResult = finalizeArisScore(arisRaw, mtfScoreStr, adxVal, macdHist, whaleWalls, absorption, liveCvdBias, newsSentiment);
    const arisContext = formatArisContext(arisResult);
    // ──────────────────────────────────────────────────────────────────────────

    const formatPriceDynamic = (val) => {
      if (val == null) return null;
      return val < 1 ? parseFloat(val.toFixed(5)) : val < 1000 ? parseFloat(val.toFixed(3)) : parseFloat(val.toFixed(2));
    };

    return {
      available: true,
      currentPrice,
      poc: formatPriceDynamic(poc),
      ema20: latestEma20 ? formatPriceDynamic(latestEma20) : null,
      ema50: latestEma50 ? formatPriceDynamic(latestEma50) : null,
      ema200: latestEma200 ? formatPriceDynamic(latestEma200) : null,
      rsi: latestRsi ? parseFloat(latestRsi.toFixed(2)) : null,
      macd: latestMacd ? {
        histogram: parseFloat(latestMacd.histogram?.toFixed(5) || '0'),
        MACD: parseFloat(latestMacd.MACD?.toFixed(5) || '0'),
        signal: parseFloat(latestMacd.signal?.toFixed(5) || '0')
      } : null,
      adx: latestAdx ? {
        adx: parseFloat(latestAdx.adx?.toFixed(2) || '0'),
        pdi: parseFloat(latestAdx.pdi?.toFixed(2) || '0'),
        mdi: parseFloat(latestAdx.mdi?.toFixed(2) || '0')
      } : null,
      mtfScore: mtfValid ? `${mtfScore > 0 ? '+' : ''}${mtfScore}/${totalChecks}` : null,
      mtfDetails: mtfValid
        ? mtfDetails.join(' | ')
        : 'MTF DATA UNAVAILABLE (insufficient timeframe fetches — treat as neutral/mixed)',
      aris: arisResult,
      arisContext
    };

  } catch (err) {
    return { available: false, error: err.message };
  }
}

