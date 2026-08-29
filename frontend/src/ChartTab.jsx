import React, { useState, useEffect, useRef } from 'react';
import { createChart, ColorType, LineStyle } from 'lightweight-charts';

const TIMEFRAMES = ['15m', '1h', '4h', '1d'];

// ── EMA helper ──
function ema(values, period) {
  const k = 2 / (period + 1);
  const out = [];
  let prev = values[0]?.close ?? 0;
  for (let i = 0; i < values.length; i++) {
    const price = values[i].close;
    prev = i === 0 ? price : price * k + prev * (1 - k);
    out.push({ time: values[i].time, value: prev });
  }
  return out;
}

// ── fetch candles for any tf ──
async function fetchCandles(API_BASE, symbol, interval, limit = 250) {
  const res = await fetch(`${API_BASE}/api/candles?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  const d = await res.json();
  return d.candles || [];
}

export default function ChartTab({ assets, API_BASE, signals, livePrices, onPrices }) {
  const [symbol, setSymbol] = useState(assets[0] || 'BTCUSDT');
  const [tf, setTf] = useState('1h');
  const [signal, setSignal] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [showEma, setShowEma] = useState(true);
  const [showMtf, setShowMtf] = useState(false);
  const [drawMode, setDrawMode] = useState(null); // null | 'LONG' | 'SHORT'
  const [manualPos, setManualPos] = useState(null); // {dir, entry, tp, sl}

  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const emaRefs = useRef({});
  const lineRefs = useRef({});
  const mtfRefs = useRef({}); // { '4h': {chart, series}, '1d': {...} }

  // ── Init main chart ──
  useEffect(() => {
    if (!chartContainerRef.current) return;
    const chart = createChart(chartContainerRef.current, {
      layout: { background: { type: ColorType.Solid, color: '#0d1117' }, textColor: '#c9d1d9' },
      grid: { vertLines: { color: '#161b22' }, horzLines: { color: '#161b22' } },
      rightPriceScale: { borderColor: '#30363d' },
      timeScale: { borderColor: '#30363d' },
      crosshair: { mode: 0 },
      width: chartContainerRef.current.clientWidth,
      height: 520
    });
    const series = chart.addCandlestickSeries({
      upColor: '#26a69a', downColor: '#ef5350',
      borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350'
    });
    chartRef.current = chart;
    seriesRef.current = series;

    // click handler for manual position drawing
    chart.subscribeClick((param) => {
      if (!drawMode || param.time == null) return;
      const price = param.priceScale && param.priceScale.coordinateToPrice
        ? param.seriesData.get(series)?.close
        : null;
      const p = price ?? (param.point && param.priceScale ? undefined : undefined);
      // lightweight-charts gives price via param.priceScale().coordinateToPrice? use param.*
      const priceVal = param.priceScale && typeof param.priceScale.coordinateToPrice === 'function'
        ? param.priceScale.coordinateToPrice(param.point.y)
        : (param.seriesData.get(series)?.close ?? null);
      if (priceVal == null) return;
      setManualPos(prev => {
        if (!prev || prev.dir !== drawMode) {
          return { dir: drawMode, entry: priceVal, tp: null, sl: null };
        }
        // second click sets TP (away from entry) and SL (opposite side)
        const tp = priceVal;
        const sl = prev.entry - (priceVal - prev.entry); // mirror for SL
        const finalPos = { dir: drawMode, entry: prev.entry, tp, sl };
        return finalPos;
      });
    });

    const ro = new ResizeObserver(() => {
      if (chartContainerRef.current) chart.applyOptions({ width: chartContainerRef.current.clientWidth });
    });
    ro.observe(chartContainerRef.current);
    return () => { ro.disconnect(); chart.remove(); };
  }, []); // eslint-disable-line

  // re-bind drawMode handler when it changes (store in ref)
  const drawModeRef = useRef(drawMode);
  useEffect(() => { drawModeRef.current = drawMode; }, [drawMode]);

  // ── Load candles ──
  useEffect(() => {
    let cancelled = false;
    let iv;
    async function load(retry = 0) {
      if (cancelled) return;
      setLoading(true); setErr(null);
      try {
        const candles = await fetchCandles(API_BASE, symbol, tf, 250);
        if (cancelled) return;
        if (seriesRef.current) {
          seriesRef.current.setData(candles);
          // EMA overlays
          Object.values(emaRefs.current).forEach(s => { try { s.series.setData([]); } catch {} });
          if (showEma && candles.length) {
            const mk = (period, color) => {
              const id = `ema${period}`;
              if (!emaRefs.current[id]) {
                emaRefs.current[id] = { series: chartRef.current.addLineSeries({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }) };
              }
              emaRefs.current[id].series.setData(ema(candles, period));
            };
            mk(20, '#fbbf24'); mk(50, '#60a5fa'); mk(200, '#a78bfa');
          }
          chartRef.current.timeScale().fitContent();
        }
      } catch (e) {
        if (!cancelled) setErr(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    iv = setInterval(load, 60000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [symbol, tf, API_BASE, showEma]);

  // ── MTF mini charts ──
  useEffect(() => {
    if (!showMtf) {
      Object.values(mtfRefs.current).forEach(m => { try { m.chart.remove(); } catch {} });
      mtfRefs.current = {};
      return;
    }
    let cancelled = false;
    async function loadMini() {
      for (const t of ['4h', '1d']) {
        if (cancelled) return;
        const el = document.getElementById(`mtf-${t}`);
        if (!el) continue;
        if (mtfRefs.current[t]) { try { mtfRefs.current[t].chart.remove(); } catch {} }
        const chart = createChart(el, {
          layout: { background: { type: ColorType.Solid, color: '#0d1117' }, textColor: '#8b949e', fontSize: 10 },
          grid: { vertLines: { color: '#161b22' }, horzLines: { color: '#161b22' } },
          rightPriceScale: { borderColor: '#30363d' },
          timeScale: { borderColor: '#30363d', visible: false },
          crosshair: { mode: 0 }, width: el.clientWidth, height: 120
        });
        const series = chart.addCandlestickSeries({ upColor: '#26a69a', downColor: '#ef5350', borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350' });
        const candles = await fetchCandles(API_BASE, symbol, t, 120);
        if (cancelled) return;
        series.setData(candles);
        chart.timeScale().fitContent();
        mtfRefs.current[t] = { chart, series };
      }
    }
    loadMini();
    return () => { cancelled = true; };
  }, [showMtf, symbol, API_BASE]);

  // ── Find scanner signal ──
  useEffect(() => {
    const sym = symbol.toUpperCase();
    const sig = (signals || []).find(s => (s.symbol || '').toUpperCase() === sym);
    setSignal(sig || null);
  }, [symbol, signals]);

  // ── Draw setup lines (auto from signal + manual) ──
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    Object.values(lineRefs.current).forEach(l => { try { chart.removePriceLine(l); } catch {} });
    lineRefs.current = {};

    const addLine = (key, price, color, title, width = 1, style = LineStyle.Dashed) => {
      if (price == null) return;
      try {
        lineRefs.current[key] = chart.addPriceLine({ price, color, lineWidth: width, title, lineStyle: style });
      } catch {}
    };

    // Auto from scanner signal
    if (signal && signal.entry) {
      const entry = typeof signal.entry === 'object' ? signal.entry : { price: signal.entry };
      const dir = signal.direction;
      const isLong = dir === 'LONG';
      // OTE zone
      if (entry.low) addLine('oteLow', entry.low, '#2563eb', 'OTE Low');
      if (entry.high) addLine('oteHigh', entry.high, '#2563eb', 'OTE High');
      // Entry
      if (entry.price) addLine('entry', entry.price, '#3b82f6', `ENTRY (${dir})`, 2, LineStyle.Solid);
      // SL
      if (signal.sl) addLine('sl', signal.sl, '#ef4444', 'SL', 2, LineStyle.Solid);
      // TP1 / TP2
      if (signal.targets?.[0]) addLine('tp1', signal.targets[0], '#22c55e', 'TP1', 2, LineStyle.Solid);
      if (signal.targets?.[1]) addLine('tp2', signal.targets[1], '#16a34a', 'TP2', 1, LineStyle.Dashed);
    }

    // Manual position
    if (manualPos && manualPos.tp != null) {
      const { dir, entry, tp, sl } = manualPos;
      const c = dir === 'LONG' ? '#22c55e' : '#ef4444';
      addLine('mEntry', entry, '#3b82f6', `DRAW ${dir} ENTRY`, 2, LineStyle.Solid);
      addLine('mTp', tp, c, `${dir} TP`, 2, LineStyle.Solid);
      addLine('mSl', sl, '#ef4444', `${dir} SL`, 2, LineStyle.Solid);
    }
  }, [signal, manualPos]);

  // ── Live price line ──
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const px = livePrices[symbol.toUpperCase()];
    if (lineRefs.current.__live) { try { chart.removePriceLine(lineRefs.current.__live); } catch {} lineRefs.current.__live = null; }
    if (px != null) {
      try {
        lineRefs.current.__live = chart.addPriceLine({ price: px, color: '#fbbf24', lineWidth: 1, title: 'Live', lineStyle: LineStyle.Dotted });
      } catch {}
    }
  }, [livePrices, symbol]);

  // ── Poll prices ──
  useEffect(() => {
    let iv;
    async function tick() { if (onPrices) await onPrices([symbol]); }
    tick();
    iv = setInterval(tick, 5000);
    return () => clearInterval(iv);
  }, [symbol, onPrices]);

  const livePx = livePrices[symbol.toUpperCase()];

  return (
    <div className="chart-tab" style={{ padding: '1rem 0' }}>
      <div className="chart-header" style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <select value={symbol} onChange={ev => setSymbol(ev.target.value)} style={sel}>
          {assets.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={tf} onChange={ev => setTf(ev.target.value)} style={sel}>
          {TIMEFRAMES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <button onClick={() => setShowEma(v => !v)} style={{ ...btn, background: showEma ? '#1f6feb' : '#21262d' }}>EMA</button>
        <button onClick={() => setShowMtf(v => !v)} style={{ ...btn, background: showMtf ? '#1f6feb' : '#21262d' }}>MTF</button>
        <button onClick={() => setDrawMode(drawMode === 'LONG' ? null : 'LONG')} style={{ ...btn, background: drawMode === 'LONG' ? '#22c55e' : '#21262d' }}>✏️ Draw LONG</button>
        <button onClick={() => setDrawMode(drawMode === 'SHORT' ? null : 'SHORT')} style={{ ...btn, background: drawMode === 'SHORT' ? '#ef4444' : '#21262d' }}>✏️ Draw SHORT</button>
        {drawMode && <span style={{ color: '#fbbf24', fontSize: '0.8rem' }}>Click entry, then click TP (SL auto-mirrored)</span>}
        {drawMode && <button onClick={() => { setManualPos(null); setDrawMode(null); }} style={{ ...btn, background: '#21262d' }}>Clear</button>}
        {signal && (
          <span className={`signal-direction ${signal.direction === 'LONG' ? 'dir-long' : 'dir-short'}`} style={{ fontWeight: 700 }}>
            {signal.direction} {signal.status}
          </span>
        )}
        {livePx != null && <span style={{ color: '#fbbf24', fontWeight: 700 }}>Live: {livePx}</span>}
      </div>

      {err && <div style={{ color: '#ef4444', marginBottom: '0.5rem' }}>⚠️ {err}</div>}
      {loading && <div style={{ color: '#94a3b8', marginBottom: '0.5rem' }}>Loading chart...</div>}

      {signal ? (
        <div className="setup-info" style={{ display: 'flex', gap: '1rem', marginBottom: '0.75rem', flexWrap: 'wrap', fontSize: '0.85rem' }}>
          <span style={{ color: '#3b82f6' }}>Entry: {typeof signal.entry === 'object' ? signal.entry.price : signal.entry}</span>
          <span style={{ color: '#ef4444' }}>SL: {signal.sl}</span>
          <span style={{ color: '#22c55e' }}>TP1: {signal.targets?.[0]}</span>
          <span style={{ color: '#16a34a' }}>TP2: {signal.targets?.[1]}</span>
          <span style={{ color: '#94a3b8' }}>Grade: {signal.grade} ({signal.pct}%)</span>
        </div>
      ) : (
        <div style={{ color: '#94a3b8', marginBottom: '0.75rem', fontSize: '0.85rem' }}>
          No scanner setup for {symbol} yet — run Scanner to detect one.
        </div>
      )}

      {showMtf && (
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.75rem' }}>
          {['4h', '1d'].map(t => (
            <div key={t} style={{ flex: 1 }}>
              <div style={{ color: '#8b949e', fontSize: '0.75rem', marginBottom: '0.25rem' }}>MTF {t.toUpperCase()} — {symbol}</div>
              <div id={`mtf-${t}`} style={{ width: '100%', height: '120px', background: '#0d1117', borderRadius: '6px', border: '1px solid #30363d' }} />
            </div>
          ))}
        </div>
      )}

      <div ref={chartContainerRef} style={{ width: '100%', height: '520px', background: '#0d1117', borderRadius: '8px', border: '1px solid #30363d' }} />
    </div>
  );
}

const sel = { background: '#161b22', color: '#e2e8f0', border: '1px solid #30363d', borderRadius: '6px', padding: '0.5rem' };
const btn = { color: '#e2e8f0', border: '1px solid #30363d', borderRadius: '6px', padding: '0.5rem 0.75rem', cursor: 'pointer', fontSize: '0.8rem' };
