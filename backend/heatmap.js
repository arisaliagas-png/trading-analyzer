import WebSocket from 'ws';

const WHALE_MULTIPLIER = 5;

// ─── Intra-Candle Footprint Profile Tracker ─────────────────────────────────
class FootprintTracker {
  constructor(aggregator) {
    this.aggregator = aggregator;
    this.candles = {}; // bucket key -> { buyVol, sellVol, price }
    this.candleStart = Date.now();
    this.duration = 60000; // 1-minute footprint resolution
    this.lastCandle = null;
    this.activeAbsorption = { type: 'NONE', strength: 0, price: 0 };
  }

  reset() {
    this.candles = {};
    this.candleStart = Date.now();
    this.activeAbsorption = { type: 'NONE', strength: 0, price: 0 };
  }

  addTrade(price, qty, isBuyerMaker) {
    const now = Date.now();
    if (now - this.candleStart > this.duration) {
      this.rotateCandle();
    }

    const mid = this.aggregator.midPrice || price;
    const config = this.aggregator._getBinConfig(mid);
    const binSize = config.binSize;

    // Group trade into price bucket
    const bucketPrice = isBuyerMaker
      ? Math.floor(price / binSize) * binSize  // Taker sell hit bid
      : Math.ceil(price / binSize) * binSize;   // Taker buy hit ask

    const key = bucketPrice.toFixed(8);
    if (!this.candles[key]) {
      this.candles[key] = { buyVol: 0, sellVol: 0, price: bucketPrice };
    }

    if (isBuyerMaker) {
      this.candles[key].sellVol += qty;
    } else {
      this.candles[key].buyVol += qty;
    }

    // Check absorption
    this.checkAbsorption(bucketPrice, this.candles[key], config.minVol);
  }

  checkAbsorption(price, bucket, minVol) {
    const buyVol = bucket.buyVol;
    const sellVol = bucket.sellVol;
    const delta = buyVol - sellVol;

    const mid = this.aggregator.midPrice;
    if (!mid) return;

    // Absorption check (large delta but price is contained close to mid)
    if (Math.abs(price - mid) < minVol * 10) {
      if (delta > minVol * 4) {
        this.activeAbsorption = { type: 'SELL_ABSORPTION', strength: delta, price };
      } else if (delta < -minVol * 4) {
        this.activeAbsorption = { type: 'BUY_ABSORPTION', strength: Math.abs(delta), price };
      }
    }
  }

  rotateCandle() {
    this.lastCandle = {
      candles: { ...this.candles },
      candleStart: this.candleStart,
      timestamp: Date.now()
    };
    this.reset();
  }

  getSnapshot() {
    try {
      const now = Date.now();
      if (now - this.candleStart > this.duration) {
        this.rotateCandle();
      }

      const list = Object.values(this.candles).sort((a, b) => b.price - a.price);
      if (list.length === 0) {
        return { active: [], poc: 0, absorption: this.activeAbsorption, timestamp: this.candleStart };
      }
      const maxQty = list.reduce((m, c) => Math.max(m, c.buyVol + c.sellVol), 1);

      let pocPrice = 0;
      let maxVol = 0;
      list.forEach(c => {
        const vol = c.buyVol + c.sellVol;
        if (vol > maxVol) { maxVol = vol; pocPrice = c.price; }
      });

      const items = list.map(c => {
        const total = c.buyVol + c.sellVol;
        const delta = c.buyVol - c.sellVol;
        const isImbalance = total > 0 && (c.buyVol > c.sellVol * 3.5 || c.sellVol > c.buyVol * 3.5);
        return {
          price: c.price,
          buyVol: parseFloat(c.buyVol.toFixed(3)),
          sellVol: parseFloat(c.sellVol.toFixed(3)),
          delta: parseFloat(delta.toFixed(3)),
          intensity: Math.min(total / maxQty, 1),
          isImbalance,
          isPoc: c.price === pocPrice
        };
      });

      return {
        active: items.slice(0, 15),
        poc: pocPrice,
        absorption: this.activeAbsorption,
        timestamp: this.candleStart
      };
    } catch (e) {
      return { active: [], poc: 0, absorption: { type: 'NONE', strength: 0, price: 0 }, timestamp: this.candleStart };
    }
  }
}

export class HeatmapAggregator {
  constructor() {
    this.symbol = 'BTCUSDT';
    this.orderbooks = {
      binance:  { bids: {}, asks: {} },
      bybit:    { bids: {}, asks: {} },
      okx:      { bids: {}, asks: {} },
      kraken:   { bids: {}, asks: {} },
      coinbase: { bids: {}, asks: {} },
      bitget:   { bids: {}, asks: {} },
    };
    this.midPrice = 0;
    this.sockets = {};
    this.running = false;

    // Money flow & Order Flow tracking
    this.cvdHistory = [];
    this.lastSnapshot = null;
    this.smartMoneyAlerts = [];
    this.footprint = new FootprintTracker(this);

    // ── Whale Wall Persistence Tracker ──
    // A wall that appears for only 1-2 snapshots is likely a spoof (fake order
    // meant to manipulate). A wall that persists across many snapshots is a
    // real whale position we can trade against. We track each wall's "life"
    // and only promote it to a STABLE target after it survives N snapshots.
    this.wallTracker = {};      // id -> { side, price, qty, firstSeen, lastSeen, hits, lastQty }
    this.stableWhaleWalls = [];  // walls that passed the persistence threshold

    // ── Trade Tape & Ledger ──
    this.recentTrades = [];       // last 120 individual trades (Time & Sales tape)
    this.tradeLedger = [];        // 1-second aggregated buckets (last 60 seconds)
    this._ledgerSecond = 0;       // current 1-sec bucket key
    this._ledgerBucket = null;    // current open bucket
  }

  setSymbol(symbol) {
    const clean = symbol.replace('/', '').replace('-', '').replace('.P', '').replace('.p', '').toUpperCase();
    if (clean === this.symbol) return;
    this.symbol = clean;
    this.cvdHistory = [];
    this.lastSnapshot = null;
    this.smartMoneyAlerts = [];
    this.footprint.reset();
    this.wallTracker = {};
    this.stableWhaleWalls = [];
    this.recentTrades = [];
    this.tradeLedger = [];
    this._ledgerSecond = 0;
    this._ledgerBucket = null;
    
    if (this.running) {
      // Instantly terminate all active sockets to trigger immediate reconnection with the new symbol
      Object.values(this.sockets).forEach(ws => {
        try {
          ws.removeAllListeners('close');
          ws.terminate();
        } catch {}
      });
      this.sockets = {};
      this.start();
    }
  }

  start() {
    if (this.running) this.stop();
    this.running = true;
    this._connectBinance();
    this._connectBybit();
    this._connectOKX();
    this._connectKraken();
    this._connectCoinbase();
    this._connectBitget();

    // Trades / Order Flow connections
    this._connectBinanceTrades();
    this._connectBybitTrades();
    this._connectOKXTrades();
  }

  stop() {
    this.running = false;
    Object.values(this.sockets).forEach(ws => { try { ws.terminate(); } catch {} });
    this.sockets = {};
    for (const ex of Object.keys(this.orderbooks)) {
      this.orderbooks[ex] = { bids: {}, asks: {} };
    }
  }

  // ── Binance ────────────────────────────────────────────────────────────────
  _connectBinance() {
    const sym = this.symbol.toLowerCase();
    const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${sym}@depth500@100ms`);
    ws.on('open', () => console.log('[Heatmap] Binance ✓', sym));
    ws.on('message', (raw) => {
      try {
        const d = JSON.parse(raw);
        const ob = this.orderbooks.binance;
        ob.bids = {}; ob.asks = {};
        (d.bids || []).forEach(([p, q]) => { if (+q > 0) ob.bids[p] = +q; });
        (d.asks || []).forEach(([p, q]) => { if (+q > 0) ob.asks[p] = +q; });
      } catch {}
    });
    ws.on('error', e => console.error('[Heatmap] Binance:', e.message));
    ws.on('close', () => { if (this.running) setTimeout(() => this._connectBinance(), 3000); });
    this.sockets.binance = ws;
  }

  // ── Bybit ──────────────────────────────────────────────────────────────────
  _connectBybit() {
    const ws = new WebSocket('wss://stream.bybit.com/v5/public/linear');
    ws.on('open', () => {
      console.log('[Heatmap] Bybit ✓');
      ws.send(JSON.stringify({ op: 'subscribe', args: [`orderbook.50.${this.symbol}`] }));
    });
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (!msg.data) return;
        const ob = this.orderbooks.bybit;
        if (msg.type === 'snapshot') { ob.bids = {}; ob.asks = {}; }
        (msg.data.b || []).forEach(([p, q]) => { const qty = +q; if (qty === 0) delete ob.bids[p]; else ob.bids[p] = qty; });
        (msg.data.a || []).forEach(([p, q]) => { const qty = +q; if (qty === 0) delete ob.asks[p]; else ob.asks[p] = qty; });
      } catch {}
    });
    ws.on('error', e => console.error('[Heatmap] Bybit:', e.message));
    ws.on('close', () => { if (this.running) setTimeout(() => this._connectBybit(), 3000); });
    this.sockets.bybit = ws;
  }

  // ── OKX ───────────────────────────────────────────────────────────────────
  _connectOKX() {
    const ws = new WebSocket('wss://ws.okx.com:8443/ws/v5/public');
    const instId = this.symbol.replace('USDT', '-USDT-SWAP');
    ws.on('open', () => {
      console.log('[Heatmap] OKX ✓');
      ws.send(JSON.stringify({ op: 'subscribe', args: [{ channel: 'books5', instId }] }));
    });
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (!msg.data?.[0]) return;
        const d = msg.data[0];
        const ob = this.orderbooks.okx;
        ob.bids = {}; ob.asks = {};
        (d.bids || []).forEach(([p, q]) => { if (+q > 0) ob.bids[p] = +q; });
        (d.asks || []).forEach(([p, q]) => { if (+q > 0) ob.asks[p] = +q; });
      } catch {}
    });
    ws.on('error', e => console.error('[Heatmap] OKX:', e.message));
    ws.on('close', () => { if (this.running) setTimeout(() => this._connectOKX(), 3000); });
    this.sockets.okx = ws;
  }

  // ── Kraken Futures (Perpetuals) ───────────────────────────────────────────
  // Uses wss://futures.kraken.com/ws/v1 — public, no auth required
  // Products: PF_XBTUSD, PF_ETHUSD, PF_SOLUSD, etc. (PF_ = perpetual multi-collateral)
  _connectKraken() {
    const ws = new WebSocket('wss://futures.kraken.com/ws/v1');

    // Map common symbols to Kraken Futures PF_ product IDs
    const krakenFuturesId = (() => {
      const base = this.symbol.replace('USDT', '').replace('USD', '').toUpperCase();
      const map = {
        BTC: 'PF_XBTUSD', ETH: 'PF_ETHUSD', SOL: 'PF_SOLUSD',
        XRP: 'PF_XRPUSD', ADA: 'PF_ADAUSD', DOGE: 'PF_DOGEUSD',
        AVAX: 'PF_AVAXUSD', LINK: 'PF_LINKUSD', DOT: 'PF_DOTUSD',
        MATIC: 'PF_MATICUSD', LTC: 'PF_LTCUSD', BCH: 'PF_BCHUSD',
        UNI: 'PF_UNIUSD', ATOM: 'PF_ATOMUSD', NEAR: 'PF_NEARUSD',
        APT: 'PF_APTUSD', ARB: 'PF_ARBUSD', OP: 'PF_OPUSD',
      };
      return map[base] || null;
    })();

    if (!krakenFuturesId) {
      console.log(`[Heatmap] Kraken Futures: no perpetual for ${this.symbol}, skipping`);
      return;
    }

    // 30-second keepalive ping
    let pingTimer = null;

    ws.on('open', () => {
      console.log('[Heatmap] Kraken Futures ✓', krakenFuturesId);
      ws.send(JSON.stringify({ event: 'subscribe', feed: 'book', product_ids: [krakenFuturesId] }));
      pingTimer = setInterval(() => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ event: 'heartbeat' }));
      }, 30000);
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.feed === 'book_snapshot') {
          const ob = this.orderbooks.kraken;
          ob.bids = {}; ob.asks = {};
          (msg.bids || []).forEach(({ price, qty }) => { if (+qty > 0) ob.bids[price] = +qty; });
          (msg.asks || []).forEach(({ price, qty }) => { if (+qty > 0) ob.asks[price] = +qty; });
        } else if (msg.feed === 'book') {
          // Incremental update
          const ob = this.orderbooks.kraken;
          if (msg.side === 'buy')  { if (+msg.qty === 0) delete ob.bids[msg.price]; else ob.bids[msg.price] = +msg.qty; }
          if (msg.side === 'sell') { if (+msg.qty === 0) delete ob.asks[msg.price]; else ob.asks[msg.price] = +msg.qty; }
        }
      } catch {}
    });

    ws.on('error', e => console.error('[Heatmap] Kraken Futures:', e.message));
    ws.on('close', () => {
      clearInterval(pingTimer);
      if (this.running) setTimeout(() => this._connectKraken(), 3000);
    });
    this.sockets.kraken = ws;
  }

  // ── Coinbase ──────────────────────────────────────────────────────────────
  _connectCoinbase() {
    const ws = new WebSocket('wss://ws-feed.exchange.coinbase.com');
    const base = this.symbol.replace('USDT', '').replace('BUSD', '');
    const cbProductId = `${base}-USD`;
    ws.on('open', () => {
      console.log('[Heatmap] Coinbase ✓', cbProductId);
      ws.send(JSON.stringify({ type: 'subscribe', product_ids: [cbProductId], channels: ['level2'] }));
    });
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        const ob = this.orderbooks.coinbase;
        if (msg.type === 'snapshot') {
          ob.bids = {}; ob.asks = {};
          (msg.bids || []).forEach(([p, q]) => { if (+q > 0) ob.bids[p] = +q; });
          (msg.asks || []).forEach(([p, q]) => { if (+q > 0) ob.asks[p] = +q; });
        } else if (msg.type === 'l2update') {
          (msg.changes || []).forEach(([side, p, q]) => {
            if (side === 'buy') { if (+q === 0) delete ob.bids[p]; else ob.bids[p] = +q; }
            else { if (+q === 0) delete ob.asks[p]; else ob.asks[p] = +q; }
          });
        }
      } catch {}
    });
    ws.on('error', e => console.error('[Heatmap] Coinbase:', e.message));
    ws.on('close', () => { if (this.running) setTimeout(() => this._connectCoinbase(), 3000); });
    this.sockets.coinbase = ws;
  }

  // ── Bitget (USDT-FUTURES Perpetuals) ──────────────────────────────────────
  // Public endpoint, no auth required. Uses incremental depth channel.
  _connectBitget() {
    const ws = new WebSocket('wss://ws.bitget.com/v3/ws/public');
    // Bitget USDT-FUTURES instId is just the symbol e.g. "BTCUSDT"
    const instId = this.symbol; // already uppercase BTCUSDT / SOLUSDT etc.

    let pingTimer = null;

    ws.on('open', () => {
      console.log('[Heatmap] Bitget ✓', instId);
      ws.send(JSON.stringify({
        op: 'subscribe',
        args: [{ instType: 'USDT-FUTURES', channel: 'books', instId }]
      }));
      // Bitget requires ping every 30s to keep connection alive
      pingTimer = setInterval(() => {
        if (ws.readyState === ws.OPEN) ws.send('ping');
      }, 30000);
    });

    ws.on('message', (raw) => {
      try {
        // Bitget sends 'pong' as plain text
        if (raw.toString() === 'pong') return;

        const msg = JSON.parse(raw);
        if (!msg.data?.[0]) return;

        const d = msg.data[0];
        const ob = this.orderbooks.bitget;

        if (msg.action === 'snapshot') {
          ob.bids = {}; ob.asks = {};
        }
        // Both snapshot and update share same format: array of [price, qty, ...]
        (d.bids || []).forEach(([p, q]) => {
          const qty = +q;
          if (qty === 0) delete ob.bids[p]; else ob.bids[p] = qty;
        });
        (d.asks || []).forEach(([p, q]) => {
          const qty = +q;
          if (qty === 0) delete ob.asks[p]; else ob.asks[p] = qty;
        });
      } catch {}
    });

    ws.on('error', e => console.error('[Heatmap] Bitget:', e.message));
    ws.on('close', () => {
      clearInterval(pingTimer);
      if (this.running) setTimeout(() => this._connectBitget(), 3000);
    });
    this.sockets.bitget = ws;
  }

  // ── Adaptive Bin Config (mirrors Python get_config) ────────────────────────
  // Returns { binSize, minVol, unitName } based on current asset price.
  // Higher-priced assets need larger bins to avoid noise; lower-priced need finer bins.
  _getBinConfig(price) {
    if (price >= 10000) return { binSize: 50,    minVol: 2.5,   unitName: 'BTC' }; // Raised from 0.5 to 2.5 to avoid spamming MEGA walls
    if (price >= 1000)  return { binSize: 5,     minVol: 10,    unitName: 'Coin' }; // Raised from 2 to 10
    if (price >= 100)   return { binSize: 0.5,   minVol: 50,    unitName: 'Coin' }; // Raised from 20 to 50
    if (price >= 10)    return { binSize: 0.05,  minVol: 500,   unitName: 'Coin' }; // Raised from 200 to 500
    if (price >= 1)     return { binSize: 0.005, minVol: 5000,  unitName: 'Coin' };
    return               { binSize: 0.0005, minVol: 50000, unitName: 'Coin' };
  }

  // ── Cluster order book levels into price bins (Smart Money filter) ──────────
  // Replicates the Python bid_clusters/ask_clusters + significant filter logic.
  // NOTE: `minVol` is interpreted as a RATIO of the largest cluster (not an
  // absolute size). This keeps the filter working whether the input volumes
  // are raw exchange sizes or normalized-to-notional (post equal-weighting).
  _clusterLevels(levels, binSize, minVol, side) {
    const clusters = {};

    for (const { price, qty } of levels) {
      // Round down for bids (support), round up for asks (resistance)
      const bucket = side === 'bid'
        ? Math.floor(price / binSize) * binSize
        : Math.ceil(price  / binSize) * binSize;

      // Use a stable string key rounded to avoid float drift
      const key = bucket.toFixed(8);
      clusters[key] = (clusters[key] || 0) + qty;
    }

    // Relative significance filter: a cluster is "Smart Money" if it holds at
    // least `minVol` share of the largest single cluster in this book side.
    const maxVol = Math.max(0, ...Object.values(clusters));
    const threshold = maxVol * (minVol <= 1 ? minVol : 0.15); // minVol given as ratio (e.g. 0.15)

    const significant = Object.entries(clusters)
      .filter(([, vol]) => vol >= threshold)
      .map(([priceStr, vol]) => ({ price: +parseFloat(priceStr).toPrecision(8), qty: vol }));

    // Sort and take top 10 (same as Python [:10])
    if (side === 'bid') {
      return significant.sort((a, b) => b.price - a.price).slice(0, 10);
    } else {
      return significant.sort((a, b) => a.price - b.price).slice(0, 10);
    }
  }

  // ── Aggregate + Money Flow ─────────────────────────────────────────────────
  getSnapshot() {
    // ── Pass 1: Aggregate raw order book across all exchanges ──
    // DATA-QUALITY FILTER + EQUAL WEIGHTING:
    // 1. Only count an exchange if it has BOTH bid and ask levels populated
    //    (exchanges still connecting / bad snapshots skew the reading).
    // 2. Normalize each exchange's volume to a fixed notional before summing,
    //    so a deep book (e.g. Kraken with 1700 levels) doesn't drown out a
    //    shallow one (e.g. Bybit with 50). Without this, one exchange dominates
    //    the money-flow reading and produces fake 96%/4% splits.
    const MIN_LEVELS = 3;
    const NOTIONAL = 1.0; // each valid exchange contributes equal weight
    const validExchanges = [];
    const aggregated = { bids: {}, asks: {} };
    for (const [name, ob] of Object.entries(this.orderbooks)) {
      const bidLevels = Object.entries(ob.bids).map(([p, q]) => [+p, +q]);
      const askLevels = Object.entries(ob.asks).map(([p, q]) => [+p, +q]);
      if (bidLevels.length < MIN_LEVELS || askLevels.length < MIN_LEVELS) continue;

      const bidSum = bidLevels.reduce((s, [, q]) => s + q, 0);
      const askSum = askLevels.reduce((s, [, q]) => s + q, 0);
      if (bidSum <= 0 || askSum <= 0) continue;

      const bidNorm = NOTIONAL / bidSum;
      const askNorm = NOTIONAL / askSum;
      validExchanges.push(name);

      for (const [p, q] of bidLevels) {
        const key = p.toFixed(8);
        aggregated.bids[key] = (aggregated.bids[key] || 0) + q * bidNorm;
      }
      for (const [p, q] of askLevels) {
        const key = p.toFixed(8);
        aggregated.asks[key] = (aggregated.asks[key] || 0) + q * askNorm;
      }
    }

    // All raw levels sorted
    let allBids = Object.entries(aggregated.bids)
      .map(([p, q]) => ({ price: +p, qty: q }))
      .sort((a, b) => b.price - a.price);

    let allAsks = Object.entries(aggregated.asks)
      .map(([p, q]) => ({ price: +p, qty: q }))
      .sort((a, b) => a.price - b.price);

    // FIX NEGATIVE SPREAD: Ensure ask prices do not overlap or drop below bid prices
    if (allBids.length > 0 && allAsks.length > 0) {
      const bestBid = allBids[0].price;
      // Filter out any ask price that crosses over the best bid
      allAsks = allAsks.filter(a => a.price > bestBid);
      if (allAsks.length === 0) {
        // Fallback: build a mock ask to avoid negative spread crashing metrics
        allAsks = [{ price: bestBid + 0.01, qty: 0.1 }];
      }
    }

    // Update mid price from raw best bid/ask
    if (allBids[0] && allAsks[0]) this.midPrice = (allBids[0].price + allAsks[0].price) / 2;

    // Slice display levels (top 60 each side for the visual heatmap)
    const bids = allBids.slice(0, 60);
    const asks = allAsks.slice(0, 60);

    // Metadata for visual heatmap
    const maxQty = Math.max(...bids.map(b => b.qty), ...asks.map(a => a.qty), 1);
    const avgBid = bids.length ? bids.reduce((s, b) => s + b.qty, 0) / bids.length : 1;
    const avgAsk = asks.length ? asks.reduce((s, a) => s + a.qty, 0) / asks.length : 1;

    const addMeta = (arr, avg) => arr.map(x => ({
      ...x,
      intensity: Math.min(x.qty / maxQty, 1),
      isWhale: x.qty > avg * WHALE_MULTIPLIER
    }));

    const bidsWithMeta = addMeta(bids, avgBid);
    const asksWithMeta = addMeta(asks, avgAsk);

    // ── Pass 2: Smart Money Clustering ──────────────────────────────────────
    // Adaptive bin size based on current mid price (same as Python get_config)
    const { binSize, minVol, unitName } = this._getBinConfig(this.midPrice || 1);

    const bidClusters = this._clusterLevels(allBids, binSize, minVol, 'bid');
    const askClusters = this._clusterLevels(allAsks, binSize, minVol, 'ask');

    // Intensity relative to the largest cluster (for UI heat color)
    const maxClusterQty = Math.max(
      ...bidClusters.map(c => c.qty),
      ...askClusters.map(c => c.qty),
      1
    );
    const withClusterMeta = (arr, side) => arr.map(c => ({
      ...c,
      side,
      intensity: Math.min(c.qty / maxClusterQty, 1),
      // Whale = a cluster holding at least 50% of the largest cluster on its
      // side. Relative (not absolute) so it works with normalized volumes.
      isWhale: maxClusterQty > 0 && c.qty >= maxClusterQty * 0.5,
      distancePct: this.midPrice > 0
        ? (((c.price - this.midPrice) / this.midPrice) * 100).toFixed(2)
        : '0.00'
    }));

    const liquidityClusters = {
      bids: withClusterMeta(bidClusters, 'bid'),
      asks: withClusterMeta(askClusters, 'ask'),
      binSize,
      minVol,
      unitName,
    };

    // ── Money Flow Calculations ──────────────────────────────────────────────
    const totalBidVol = bids.reduce((s, b) => s + b.qty, 0);
    const totalAskVol = asks.reduce((s, a) => s + a.qty, 0);
    const totalVol = totalBidVol + totalAskVol || 1;
    const bidPct = Math.round((totalBidVol / totalVol) * 100);
    const askPct = 100 - bidPct;
    const netPressure = totalBidVol - totalAskVol;

    // CVD tracking
    this.cvdHistory.push({ t: Date.now(), delta: netPressure });
    if (this.cvdHistory.length > 120) this.cvdHistory.shift();
    const runningCVD = this.cvdHistory.reduce((sum, x) => sum + x.delta, 0);

    // Price-level imbalances
    const priceImbalances = [];
    const allPrices = new Set([...bids.map(b => b.price.toFixed(2)), ...asks.map(a => a.price.toFixed(2))]);
    allPrices.forEach(pStr => {
      const p = +pStr;
      const bidHere = bids.find(b => Math.abs(b.price - p) < 0.01)?.qty || 0;
      const askHere = asks.find(a => Math.abs(a.price - p) < 0.01)?.qty || 0;
      if (bidHere > 0 && askHere > 0) {
        const ratio = bidHere / askHere;
        if (ratio > 3) priceImbalances.push({ price: p, type: 'bid_dominance', ratio: ratio.toFixed(1) });
        else if (ratio < 0.33) priceImbalances.push({ price: p, type: 'ask_dominance', ratio: (1 / ratio).toFixed(1) });
      }
    });

    // ── Whale Walls + Persistence Filter ────────────────────────────────────
    // Step 1: collect current whale walls (clustered = more accurate than raw)
    const whaleWalls = [
      ...liquidityClusters.bids.filter(c => c.isWhale),
      ...liquidityClusters.asks.filter(c => c.isWhale),
    ].sort((a, b) => b.qty - a.qty).slice(0, 10);

    // Step 2: update persistence tracker
    const PERSIST_THRESHOLD = 6;   // survive 6 snapshots (~3s at 500ms) → real wall
    const MAX_ABSENCE = 3;         // missing for 3 snapshots → considered gone/spoof
    const seenNow = new Set();
    for (const w of whaleWalls) {
      const id = `${w.side}_${w.price.toFixed(2)}`;
      seenNow.add(id);
      const prev = this.wallTracker[id];
      if (prev) {
        prev.hits += 1;
        prev.lastSeen = Date.now();
        prev.lastQty = w.qty;
        prev.absence = 0;
      } else {
        this.wallTracker[id] = {
          side: w.side, price: w.price, qty: w.qty,
          firstSeen: Date.now(), lastSeen: Date.now(),
          hits: 1, absence: 0
        };
      }
    }
    // Age out walls that disappeared
    for (const [id, rec] of Object.entries(this.wallTracker)) {
      if (!seenNow.has(id)) {
        rec.absence += 1;
        if (rec.absence > MAX_ABSENCE) delete this.wallTracker[id];
      }
    }

    // Step 3: promote persistent walls to STABLE targets
    this.stableWhaleWalls = Object.values(this.wallTracker)
      .filter(r => r.hits >= PERSIST_THRESHOLD)
      .map(r => ({
        side: r.side,
        price: r.price,
        qty: +r.lastQty.toFixed(3),
        hits: r.hits,
        ageSec: Math.round((Date.now() - r.firstSeen) / 1000),
        distancePct: this.midPrice > 0 ? (((r.price - this.midPrice) / this.midPrice) * 100).toFixed(2) : '0.00'
      }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 10);

    // Step 4: alert only on NEW stable walls (not every flicker)
    if (this.lastSnapshot) {
      const prevStableIds = new Set((this.lastSnapshot.stableWhaleWalls || []).map(w => `${w.side}_${w.price.toFixed(2)}`));
      for (const w of this.stableWhaleWalls) {
        const id = `${w.side}_${w.price.toFixed(2)}`;
        if (!prevStableIds.has(id)) {
          this.smartMoneyAlerts.unshift({
            time: Date.now(),
            side: w.side,
            price: w.price,
            qty: w.qty,
            label: w.side === 'bid' ? '🟢 STABLE Bid Wall (whale)' : '🔴 STABLE Ask Wall (whale)',
            distancePct: w.distancePct,
            stable: true
          });
        }
      }
      if (this.smartMoneyAlerts.length > 20) this.smartMoneyAlerts.length = 20;
    }

    const snapshot = {
      symbol: this.symbol,
      midPrice: this.midPrice,
      maxQty,
      bids: bidsWithMeta,
      asks: asksWithMeta,
      liquidityClusters,   // ← NEW: Smart Money clustered zones
      whaleWalls,
      stableWhaleWalls: this.stableWhaleWalls,  // ← NEW: persistent (real) whale walls
      moneyFlow: {
        bidPct,
        askPct,
        totalBidVol: Math.round(totalBidVol),
        totalAskVol: Math.round(totalAskVol),
        netPressure: Math.round(netPressure),
        cvd: Math.round(runningCVD),
        bias: bidPct > 55 ? 'buy' : bidPct < 45 ? 'sell' : 'neutral',
        imbalances: priceImbalances.slice(0, 5),
        validSources: validExchanges.length,
        // Low sample → money-flow reading is unreliable (flag it)
        reliable: validExchanges.length >= 2
      },
      smartMoneyAlerts: this.smartMoneyAlerts.slice(0, 5),
      timestamp: Date.now(),
      sources: Object.entries(this.sockets)
        .filter(([, ws]) => ws?.readyState === 1)
        .map(([name]) => name),
      footprint: (() => {
        try { return this.footprint.getSnapshot(); }
        catch { return { active: [], poc: 0, absorption: { type: 'NONE', strength: 0, price: 0 }, timestamp: 0 }; }
      })(),
      // ── Trade Tape & Aggregate Ledger ──
      recentTrades: this.recentTrades.slice(-50).reverse(), // newest first, last 50
      tradeLedger: (() => {
        // Include the still-open current bucket so the chart is live
        const ledger = [...this.tradeLedger];
        if (this._ledgerBucket) ledger.push({ ...this._ledgerBucket });
        return ledger.slice(-60).reverse(); // newest first
      })()
    };

    this.lastSnapshot = snapshot;
    return snapshot;
  }

  // ── Trade Tape & Ledger helper ────────────────────────────────────────────
  _addToLedger(price, qty, isSell, exchange) {
    const now = Date.now();
    const secKey = Math.floor(now / 1000);

    // ① Individual tape (newest first after reverse in snapshot)
    this.recentTrades.push({ t: now, p: price, q: qty, side: isSell ? 'sell' : 'buy', ex: exchange });
    if (this.recentTrades.length > 120) this.recentTrades.shift();

    // ② 1-second aggregate bucket
    if (secKey !== this._ledgerSecond) {
      if (this._ledgerBucket) {
        this.tradeLedger.push(this._ledgerBucket);
        if (this.tradeLedger.length > 60) this.tradeLedger.shift();
      }
      this._ledgerBucket = { t: secKey * 1000, buyVol: 0, sellVol: 0, count: 0 };
      this._ledgerSecond = secKey;
    }
    if (isSell) { this._ledgerBucket.sellVol += qty; }
    else        { this._ledgerBucket.buyVol  += qty; }
    this._ledgerBucket.count++;
  }

  // ── Binance Trades (Perpetuals) ───────────────────────────────────────────
  _connectBinanceTrades() {
    const sym = this.symbol.toLowerCase();
    const ws = new WebSocket(`wss://fstream.binance.com/ws/${sym}@aggTrade`);
    ws.on('open', () => console.log('[Footprint] Binance Trades ✓', sym));
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        // m: isBuyerMaker (true = sell taker hit bid, false = buy taker hit ask)
        const price = parseFloat(msg.p);
        const qty = parseFloat(msg.q);
        const isSell = msg.m; // isBuyerMaker
        this.footprint.addTrade(price, qty, isSell);
        this._addToLedger(price, qty, isSell, 'BIN');
      } catch {}
    });
    ws.on('error', e => console.error('[Footprint] Binance Trades Error:', e.message));
    ws.on('close', () => {
      if (this.running) setTimeout(() => this._connectBinanceTrades(), 3000);
    });
    this.sockets.binanceTrades = ws;
  }

  // ── Bybit Trades (Perpetuals) ─────────────────────────────────────────────
  _connectBybitTrades() {
    const ws = new WebSocket('wss://stream.bybit.com/v5/public/linear');
    const topic = `publicTrade.${this.symbol}`;
    ws.on('open', () => {
      console.log('[Footprint] Bybit Trades ✓', this.symbol);
      ws.send(JSON.stringify({ op: 'subscribe', args: [topic] }));
    });
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.topic !== topic || !msg.data) return;
        msg.data.forEach(t => {
          const price = parseFloat(t.p);
          const qty = parseFloat(t.v);
          const isSell = t.S === 'Sell';
          this.footprint.addTrade(price, qty, isSell);
          this._addToLedger(price, qty, isSell, 'BYB');
        });
      } catch {}
    });
    ws.on('error', e => console.error('[Footprint] Bybit Trades Error:', e.message));
    ws.on('close', () => {
      if (this.running) setTimeout(() => this._connectBybitTrades(), 3000);
    });
    this.sockets.bybitTrades = ws;
  }

  // ── OKX Trades (Perpetuals) ───────────────────────────────────────────────
  _connectOKXTrades() {
    const ws = new WebSocket('wss://wspap.okx.com:443/ws/v5/public');
    const instId = `${this.symbol.replace('USDT', '')}-USDT-SWAP`;
    ws.on('open', () => {
      console.log('[Footprint] OKX Trades ✓', instId);
      ws.send(JSON.stringify({
        op: 'subscribe',
        args: [{ channel: 'trades', instId }]
      }));
    });
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.arg?.channel !== 'trades' || !msg.data) return;
        msg.data.forEach(t => {
          const price = parseFloat(t.px);
          const qty = parseFloat(t.sz);
          const isSell = t.side === 'sell';
          this.footprint.addTrade(price, qty, isSell);
          this._addToLedger(price, qty, isSell, 'OKX');
        });
      } catch {}
    });
    ws.on('error', e => console.error('[Footprint] OKX Trades Error:', e.message));
    ws.on('close', () => {
      if (this.running) setTimeout(() => this._connectOKXTrades(), 3000);
    });
    this.sockets.okxTrades = ws;
  }
}

export const aggregator = new HeatmapAggregator();

