// liveFlow.js — Real-time Market Depth, CVD & Whale Flow Engine
import { serverLog } from './logger.js';
import { getWalls } from './liquidityStore.js';

function normalizeSymbol(sym) {
  if (!sym) return 'BTCUSDT';
  return sym.toUpperCase().replace(/[\/\.\-P]/g, '').trim();
}

async function fetchWithFallback(urls) {
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const data = await res.json();
        if (data) return data;
      }
    } catch (err) {
      // try next
    }
  }
  return null;
}

// 1. Fetch Order Book Depth
async function fetchDepth(symbol) {
  const urls = [
    `https://data-api.binance.vision/api/v3/depth?symbol=${symbol}&limit=100`,
    `https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=100`
  ];
  const data = await fetchWithFallback(urls);
  if (data && data.bids && data.asks) {
    return {
      bids: data.bids.map(([p, q]) => [parseFloat(p), parseFloat(q)]),
      asks: data.asks.map(([p, q]) => [parseFloat(p), parseFloat(q)])
    };
  }

  // Bybit Fallback
  try {
    const bybitRes = await fetch(`https://api.bybit.com/v5/market/orderbook?category=spot&symbol=${symbol}&limit=50`, { signal: AbortSignal.timeout(4000) });
    if (bybitRes.ok) {
      const bData = await bybitRes.json();
      if (bData.result && bData.result.b && bData.result.a) {
        return {
          bids: bData.result.b.map(([p, q]) => [parseFloat(p), parseFloat(q)]),
          asks: bData.result.a.map(([p, q]) => [parseFloat(p), parseFloat(q)])
        };
      }
    }
  } catch (e) {}

  return { bids: [], asks: [] };
}

// 2. Fetch Recent Trades
async function fetchTrades(symbol) {
  const urls = [
    `https://data-api.binance.vision/api/v3/trades?symbol=${symbol}&limit=500`,
    `https://api.binance.com/api/v3/trades?symbol=${symbol}&limit=500`
  ];
  const data = await fetchWithFallback(urls);
  if (Array.isArray(data) && data.length > 0) {
    return data.map(t => ({
      id: t.id,
      price: parseFloat(t.price),
      qty: parseFloat(t.qty),
      quoteQty: parseFloat(t.quoteQty || (t.price * t.qty)),
      time: t.time,
      isBuyerMaker: t.isBuyerMaker // true = buyer is maker (seller took market order -> MARKET SELL)
    }));
  }

  // Bybit trades fallback
  try {
    const bRes = await fetch(`https://api.bybit.com/v5/market/recent-trade?category=spot&symbol=${symbol}&limit=100`, { signal: AbortSignal.timeout(4000) });
    if (bRes.ok) {
      const bData = await bRes.json();
      if (bData.result?.list) {
        return bData.result.list.map((t, idx) => ({
          id: t.execId || idx,
          price: parseFloat(t.price),
          qty: parseFloat(t.size),
          quoteQty: parseFloat(t.price) * parseFloat(t.size),
          time: parseInt(t.time, 10),
          isBuyerMaker: t.side === 'Sell'
        }));
      }
    }
  } catch (e) {}

  return [];
}

// 3. Fetch 24hr Ticker
async function fetchTicker(symbol) {
  const urls = [
    `https://data-api.binance.vision/api/v3/ticker/24hr?symbol=${symbol}`,
    `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`
  ];
  const data = await fetchWithFallback(urls);
  if (data && data.lastPrice) {
    return {
      price: parseFloat(data.lastPrice),
      change24h: parseFloat(data.priceChangePercent),
      high24h: parseFloat(data.highPrice),
      low24h: parseFloat(data.lowPrice),
      volume: parseFloat(data.volume),
      quoteVolume: parseFloat(data.quoteVolume)
    };
  }
  return null;
}

const flowCache = {}; // symbol -> { data, expiresAt }

/**
 * Computes live money flow, depth mountains & whale alerts (with 2s TTL caching)
 */
export async function getLiveFlow(rawSymbol = 'BTCUSDT') {
  const symbol = normalizeSymbol(rawSymbol);
  const now = Date.now();

  // Return fresh cache if within 2.5s
  if (flowCache[symbol] && flowCache[symbol].expiresAt > now) {
    return flowCache[symbol].data;
  }

  const withTimeout = (promise, fallback, ms = 3500) =>
    Promise.race([
      promise,
      new Promise(resolve => setTimeout(() => resolve(fallback), ms))
    ]);

  const [depthData, trades, ticker, macroWalls] = await Promise.all([
    withTimeout(fetchDepth(symbol), { bids: [], asks: [] }),
    withTimeout(fetchTrades(symbol), []),
    withTimeout(fetchTicker(symbol), null),
    withTimeout(getWalls(symbol), [])
  ]);

  const bids = (depthData.bids || []).sort((a, b) => b[0] - a[0]); // Descending
  const asks = (depthData.asks || []).sort((a, b) => a[0] - b[0]); // Ascending

  const midPrice = ticker?.price || (bids[0] && asks[0] ? (bids[0][0] + asks[0][0]) / 2 : 0);

  // Calculate Cumulative Depth for SVG Chart
  // Bids: from midPrice downwards
  let cumulativeBidVol = 0;
  const bidDepth = [];
  for (let i = 0; i < bids.length; i++) {
    const [price, qty] = bids[i];
    cumulativeBidVol += qty;
    bidDepth.push({
      price,
      qty,
      cumulative: cumulativeBidVol
    });
  }

  // Asks: from midPrice upwards
  let cumulativeAskVol = 0;
  const askDepth = [];
  for (let i = 0; i < asks.length; i++) {
    const [price, qty] = asks[i];
    cumulativeAskVol += qty;
    askDepth.push({
      price,
      qty,
      cumulative: cumulativeAskVol
    });
  }

  // Top 15 Levels with intensity calculation
  const topBids = bids.slice(0, 15);
  const topAsks = asks.slice(0, 15);
  const maxBidQty = Math.max(...topBids.map(b => b[1]), 1);
  const maxAskQty = Math.max(...topAsks.map(a => a[1]), 1);
  const globalMaxQty = Math.max(maxBidQty, maxAskQty);

  const formattedBids = topBids.map(([price, qty]) => ({
    price,
    qty,
    totalUsd: price * qty,
    pct: Math.min(100, (qty / globalMaxQty) * 100),
    isWall: qty >= globalMaxQty * 0.5
  }));

  const formattedAsks = topAsks.map(([price, qty]) => ({
    price,
    qty,
    totalUsd: price * qty,
    pct: Math.min(100, (qty / globalMaxQty) * 100),
    isWall: qty >= globalMaxQty * 0.5
  }));

  // Analyze Trades: CVD, Buy vs Sell Volume, Whale Trades
  let totalBuyVol = 0;
  let totalSellVol = 0;
  let totalBuyUsd = 0;
  let totalSellUsd = 0;
  const whaleThresholdUsd = midPrice > 10000 ? 50000 : 25000; // $50K for BTC/ETH, $25K for others
  const whaleTrades = [];

  // Trades are chronological ascending or descending. Let's sort ascending for CVD tracking
  const sortedTrades = [...trades].sort((a, b) => a.time - b.time);
  let runningCvd = 0;
  const cvdSeries = [];

  for (const t of sortedTrades) {
    const isMarketBuy = !t.isBuyerMaker;
    const usd = t.quoteQty || (t.price * t.qty);

    if (isMarketBuy) {
      totalBuyVol += t.qty;
      totalBuyUsd += usd;
      runningCvd += t.qty;
    } else {
      totalSellVol += t.qty;
      totalSellUsd += usd;
      runningCvd -= t.qty;
    }

    cvdSeries.push({
      time: t.time,
      cvd: runningCvd
    });

    if (usd >= whaleThresholdUsd) {
      whaleTrades.push({
        id: t.id,
        time: t.time,
        side: isMarketBuy ? 'BUY' : 'SELL',
        price: t.price,
        qty: t.qty,
        usdValue: usd,
        isLargeWhale: usd >= 100000
      });
    }
  }

  // Whale trades descending by time (most recent first)
  whaleTrades.sort((a, b) => b.time - a.time);

  // Top Book Totals & Imbalances
  const topBidVolSum = topBids.reduce((acc, b) => acc + b[1], 0);
  const topAskVolSum = topAsks.reduce((acc, a) => acc + a[1], 0);
  const totalTopVol = topBidVolSum + topAskVolSum;

  const bidRatio = totalTopVol > 0 ? (topBidVolSum / totalTopVol) * 100 : 50;
  const askRatio = totalTopVol > 0 ? (topAskVolSum / totalTopVol) * 100 : 50;

  const imbalanceDiff = bidRatio - 50;
  const imbalancePct = Math.round(Math.abs(imbalanceDiff) * 2);
  const imbalanceSide = bidRatio >= 50 ? 'BID' : 'ASK';

  return {
    symbol,
    timestamp: Date.now(),
    midPrice,
    ticker: ticker || {
      price: midPrice,
      change24h: 0,
      high24h: midPrice,
      low24h: midPrice,
      volume: 0,
      quoteVolume: 0
    },
    depthChart: {
      bids: bidDepth.slice(0, 60),
      asks: askDepth.slice(0, 60),
      maxCumulative: Math.max(cumulativeBidVol, cumulativeAskVol, 1)
    },
    orderBook: {
      bids: formattedBids,
      asks: formattedAsks
    },
    moneyFlow: {
      cvd: runningCvd,
      cvdNormalized: runningCvd,
      buyVol: totalBuyVol,
      sellVol: totalSellVol,
      buyUsd: totalBuyUsd,
      sellUsd: totalSellUsd,
      bidRatio: Math.round(bidRatio),
      askRatio: Math.round(askRatio),
      imbalancePct,
      imbalanceSide,
      tradeCount: trades.length,
      whaleCount: whaleTrades.length
    },
    whaleTrades: whaleTrades.slice(0, 20),
    macroWalls: macroWalls || []
  };

  flowCache[symbol] = {
    data: result,
    expiresAt: now + 2500 // 2.5s cache
  };

  return result;
}
