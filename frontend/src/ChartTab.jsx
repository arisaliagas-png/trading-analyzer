import React, { useState, useEffect, useRef } from 'react';
import { createChart, ColorType } from 'lightweight-charts';

const TIMEFRAMES = ['15m', '1h', '4h', '1d'];

export default function ChartTab({ assets, API_BASE, signals, livePrices, onPrices }) {
  const [symbol, setSymbol] = useState(assets[0] || 'BTCUSDT');
  const [tf, setTf] = useState('1h');
  const [signal, setSignal] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const lineRefs = useRef({});

  // ── Init chart once ──
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
    const ro = new ResizeObserver(() => {
      if (chartContainerRef.current) chart.applyOptions({ width: chartContainerRef.current.clientWidth });
    });
    ro.observe(chartContainerRef.current);
    return () => { ro.disconnect(); chart.remove(); };
  }, []);

  // ── Load candles when symbol/tf changes + poll every 60s ──
  useEffect(() => {
    let cancelled = false;
    let iv;
    async function load() {
      if (cancelled) return;
      setLoading(true); setErr(null);
      try {
        const res = await fetch(`${API_BASE}/api/candles?symbol=${symbol}&interval=${tf}&limit=250`);
        const d = await res.json();
        if (cancelled) return;
        if (d.error) { setErr(d.error); setLoading(false); return; }
        if (seriesRef.current) seriesRef.current.setData(d.candles || []);
        if (chartRef.current) chartRef.current.timeScale().fitContent();
      } catch (e) {
        if (!cancelled) setErr(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    iv = setInterval(load, 60000); // poll every 60s (backend caches 30s)
    return () => { cancelled = true; clearInterval(iv); };
  }, [symbol, tf, API_BASE]);

  // ── Find scanner signal for this symbol ──
  useEffect(() => {
    const sym = symbol.toUpperCase();
    const sig = (signals || []).find(s => (s.symbol || '').toUpperCase() === sym);
    setSignal(sig || null);
  }, [symbol, signals]);

  // ── Draw setup lines (entry/SL/TP) ──
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    // clear old lines
    Object.values(lineRefs.current).forEach(l => { try { chart.removePriceLine(l); } catch {} });
    lineRefs.current = {};
    if (!signal || !signal.entry) return;

    const entry = typeof signal.entry === 'object' ? signal.entry : null;
    const lines = [];
    if (entry?.price) lines.push({ price: entry.price, color: '#3b82f6', label: 'Entry' });
    if (entry?.low) lines.push({ price: entry.low, color: '#2563eb', label: 'OTE Low' });
    if (entry?.high) lines.push({ price: entry.high, color: '#2563eb', label: 'OTE High' });
    if (signal.sl) lines.push({ price: signal.sl, color: '#ef4444', label: 'SL' });
    if (signal.targets && signal.targets[0]) lines.push({ price: signal.targets[0], color: '#22c55e', label: 'TP1' });
    if (signal.targets && signal.targets[1]) lines.push({ price: signal.targets[1], color: '#16a34a', label: 'TP2' });

    lines.forEach(l => {
      try {
        const pl = chart.addPriceLine({ price: l.price, color: l.color, lineWidth: 1, title: l.label, lineStyle: 2 });
        lineRefs.current[l.label] = pl;
      } catch {}
    });
  }, [signal]);

  // ── Live price line ──
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const px = livePrices[symbol.toUpperCase()];
    if (lineRefs.current.__live) { try { chart.removePriceLine(lineRefs.current.__live); } catch {} lineRefs.current.__live = null; }
    if (px != null) {
      try {
        lineRefs.current.__live = chart.addPriceLine({ price: px, color: '#fbbf24', lineWidth: 2, title: 'Live', lineStyle: 0 });
      } catch {}
    }
  }, [livePrices, symbol]);

  // ── Poll prices every 5s ──
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
      <div className="chart-header" style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <select value={symbol} onChange={ev => setSymbol(ev.target.value)} style={{ background: '#161b22', color: '#e2e8f0', border: '1px solid #30363d', borderRadius: '6px', padding: '0.5rem' }}>
          {assets.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={tf} onChange={ev => setTf(ev.target.value)} style={{ background: '#161b22', color: '#e2e8f0', border: '1px solid #30363d', borderRadius: '6px', padding: '0.5rem' }}>
          {TIMEFRAMES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        {signal && (
          <span className={`signal-direction ${signal.direction === 'LONG' ? 'dir-long' : 'dir-short'}`} style={{ fontWeight: 700 }}>
            {signal.direction} {signal.status}
          </span>
        )}
        {livePx != null && (
          <span style={{ color: '#fbbf24', fontWeight: 700 }}>Live: {livePx}</span>
        )}
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

      <div ref={chartContainerRef} style={{ width: '100%', height: '520px', background: '#0d1117', borderRadius: '8px', border: '1px solid #30363d' }} />
    </div>
  );
}
