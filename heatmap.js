import WebSocket from 'ws';

const WHALE_MULTIPLIER = 5;

export class HeatmapAggregator {
  constructor() {
    this.symbol = 'BTCUSDT';  // ← default changed to BTC
    this.orderbooks = {
      binance:  { bids: {}, asks: {} },
      bybit:    { bids: {}, asks: {} },
      okx:      { bids: {}, asks: {} },
      kraken:   { bids: {}, asks: {} },
      coinbase: { bids: {}, asks: {} },
    };
    this.midPrice = 0;
    this.sockets = {};
    this.running = false;

    // Money flow tracking
    this.cvdHistory = [];      // Cumulative Volume Delta over time
    this.lastSnapshot = null;  // previous snapshot for delta comparison
    this.smartMoneyAlerts = []; // recent smart money events
  }

  setSymbol(symbol) {
    const clean = symbol.replace('/', '').replace('-', '').replace('.P', '').replace('.p', '').toUpperCase();
    if (clean === this.symbol) return;
    this.symbol = clean;
    this.cvdHistory = [];
    this.lastSnapshot = null;
    this.smartMoneyAlerts = [];
    this.stop();
    setTimeout(() => this.start(), 600);
  }

  start() {
    if (this.running) this.stop();
    this.running = true;
    this._connectBinance();
    this._connectBybit();
    this._connectOKX();
    this._connectKraken();
    this._connectCoinbase();
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
    const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${sym}@depth20@500ms`);
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

  // ── Kraken ────────────────────────────────────────────────────────────────
  _connectKraken() {
    const ws = new WebSocket('wss://ws.kraken.com');
    // BTC → XBT for Kraken
    const base = this.symbol.replace('USDT', '').replace('BTC', 'XBT');
    const krakenPair = `${base}/USD`;
    ws.on('open', () => {
      console.log('[Heatmap] Kraken ✓', krakenPair);
      ws.send(JSON.stringify({ event: 'subscribe', pair: [krakenPair], subscription: { name: 'book', depth: 25 } }));
    });
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (!Array.isArray(msg)) return;
        const [, data, channelName] = msg;
        if (!channelName?.startsWith('book')) return;
        const ob = this.orderbooks.kraken;
        if (data.bs) { ob.bids = {}; (data.bs).forEach(([p, q]) => { if (+q > 0) ob.bids[p] = +q; }); }
        if (data.as) { ob.asks = {}; (data.as).forEach(([p, q]) => { if (+q > 0) ob.asks[p] = +q; }); }
        if (data.b) { data.b.forEach(([p, q]) => { if (+q === 0) delete ob.bids[p]; else ob.bids[p] = +q; }); }
        if (data.a) { data.a.forEach(([p, q]) => { if (+q === 0) delete ob.asks[p]; else ob.asks[p] = +q; }); }
      } catch {}
    });
    ws.on('error', e => console.error('[Heatmap] Kraken:', e.message));
    ws.on('close', () => { if (this.running) setTimeout(() => this._connectKraken(), 3000); });
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

  // ── Aggregate + Money Flow ─────────────────────────────────────────────────
  getSnapshot() {
    const aggregated = { bids: {}, asks: {} };
    for (const ob of Object.values(this.orderbooks)) {
      for (const [p, q] of Object.entries(ob.bids)) aggregated.bids[p] = (aggregated.bids[p] || 0) + q;
      for (const [p, q] of Object.entries(ob.asks)) aggregated.asks[p] = (aggregated.asks[p] || 0) + q;
    }

    const bids = Object.entries(aggregated.bids)
      .map(([p, q]) => ({ price: +p, qty: q }))
      .sort((a, b) => b.price - a.price)
      .slice(0, 60);

    const asks = Object.entries(aggregated.asks)
      .map(([p, q]) => ({ price: +p, qty: q }))
      .sort((a, b) => a.price - b.price)
      .slice(0, 60);

    if (bids[0] && asks[0]) this.midPrice = (bids[0].price + asks[0].price) / 2;

    const avgBid = bids.length ? bids.reduce((s, b) => s + b.qty, 0) / bids.length : 1;
    const avgAsk = asks.length ? asks.reduce((s, a) => s + a.qty, 0) / asks.length : 1;
    const maxQty = Math.max(...bids.map(b => b.qty), ...asks.map(a => a.qty), 1);

    const addMeta = (arr, avg) => arr.map(x => ({
      ...x,
      intensity: Math.min(x.qty / maxQty, 1),
      isWhale: x.qty > avg * WHALE_MULTIPLIER
    }));

    const bidsWithMeta = addMeta(bids, avgBid);
    const asksWithMeta = addMeta(asks, avgAsk);

    // ── Money Flow Calculations ──
    const totalBidVol = bids.reduce((s, b) => s + b.qty, 0);
    const totalAskVol = asks.reduce((s, a) => s + a.qty, 0);
    const totalVol = totalBidVol + totalAskVol || 1;
    const bidPct = Math.round((totalBidVol / totalVol) * 100);
    const askPct = 100 - bidPct;

    // Net pressure (positive = buy, negative = sell)
    const netPressure = totalBidVol - totalAskVol;

    // CVD tracking (Cumulative Volume Delta)
    const cvdDelta = netPressure;
    this.cvdHistory.push({ t: Date.now(), delta: cvdDelta });
    if (this.cvdHistory.length > 120) this.cvdHistory.shift();
    const runningCVD = this.cvdHistory.reduce((sum, x) => sum + x.delta, 0);

    // Imbalance: price levels with >3× more bids than asks (or vice versa)
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

    // Smart money events: detect new large orders appearing
    const whaleWalls = [
      ...bidsWithMeta.filter(b => b.isWhale).map(b => ({ ...b, side: 'bid' })),
      ...asksWithMeta.filter(a => a.isWhale).map(a => ({ ...a, side: 'ask' })),
    ].sort((a, b) => b.qty - a.qty).slice(0, 10);

    // Detect new whales (compare with last snapshot)
    if (this.lastSnapshot) {
      const prevWhaleIds = new Set(this.lastSnapshot.whaleWalls?.map(w => `${w.side}_${w.price.toFixed(2)}`));
      whaleWalls.forEach(w => {
        const id = `${w.side}_${w.price.toFixed(2)}`;
        if (!prevWhaleIds.has(id)) {
          this.smartMoneyAlerts.unshift({
            time: Date.now(),
            side: w.side,
            price: w.price,
            qty: w.qty,
            label: w.side === 'bid' ? '🟢 New Bid Wall' : '🔴 New Ask Wall'
          });
        }
      });
      if (this.smartMoneyAlerts.length > 20) this.smartMoneyAlerts.length = 20;
    }

    const snapshot = {
      symbol: this.symbol,
      midPrice: this.midPrice,
      maxQty,
      bids: bidsWithMeta,
      asks: asksWithMeta,
      whaleWalls,
      moneyFlow: {
        bidPct,
        askPct,
        totalBidVol: Math.round(totalBidVol),
        totalAskVol: Math.round(totalAskVol),
        netPressure: Math.round(netPressure),
        cvd: Math.round(runningCVD),
        bias: bidPct > 55 ? 'buy' : bidPct < 45 ? 'sell' : 'neutral',
        imbalances: priceImbalances.slice(0, 5)
      },
      smartMoneyAlerts: this.smartMoneyAlerts.slice(0, 5),
      timestamp: Date.now(),
      sources: Object.entries(this.sockets)
        .filter(([, ws]) => ws?.readyState === 1)
        .map(([name]) => name)
    };

    this.lastSnapshot = snapshot;
    return snapshot;
  }
}

export const aggregator = new HeatmapAggregator();
