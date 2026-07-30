import React, { useState, useRef, useEffect } from 'react';
import { t } from './i18n.js';

// ─── LocalStorage helpers ─────────────────────────────────────────────────────
const HISTORY_KEY = 'trading_analyzer_history';
const LANG_KEY    = 'trading_analyzer_lang';
const loadHistory = () => { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; } };
const saveHistory = (items) => localStorage.setItem(HISTORY_KEY, JSON.stringify(items));

const API_BASE = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:5000`;

export default function App() {
  // ── Language ──
  const [lang, setLang] = useState(() => localStorage.getItem(LANG_KEY) || 'en');
  const T = t[lang];
  const toggleLang = () => {
    const next = lang === 'en' ? 'el' : 'en';
    setLang(next); localStorage.setItem(LANG_KEY, next);
  };

  // ── Tab ──
  const [activeTab, setActiveTab] = useState('analyzer');

  // ── Analyzer ──
  const [hints, setHints] = useState('');
  const [timeframe, setTimeframe] = useState('auto'); // 'auto' = AI reads from chart
  const [imageFile, setImageFile] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  // ── TradingView import ──
  const [tvUrl, setTvUrl] = useState('');
  const [tvLoading, setTvLoading] = useState(false);
  const [tvError, setTvError] = useState(null);
  const [showTvInput, setShowTvInput] = useState(false);

  // ── Second Opinion ──
  const [soLoading, setSoLoading] = useState(false);
  const [soError, setSoError] = useState(null);
  const [secondOpinion, setSecondOpinion] = useState(null);

  // ── History ──
  const [history, setHistory] = useState(loadHistory);
  const [expandedHistory, setExpandedHistory] = useState(null);

  // ── Heatmap ──
  const [heatmapPair, setHeatmapPair] = useState('BTCUSDT.P');
  const [heatmapData, setHeatmapData] = useState(null);
  const [heatmapConnected, setHeatmapConnected] = useState(false);
  const heatmapCanvasRef = useRef(null);
  const heatmapHistoryRef = useRef([]);
  const sseRef = useRef(null);

  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);

  // ── Cleanup ──
  useEffect(() => () => { if (imageUrl) URL.revokeObjectURL(imageUrl); }, [imageUrl]);

  // ── Global Ctrl+V paste ──
  useEffect(() => {
    const handlePaste = (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) { applyFile(file); }
          break;
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  // ── Chart overlay ──
  useEffect(() => {
    if (!imageUrl || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);
      if (result?.overlay) drawOverlay(ctx, canvas.width, canvas.height, result);
    };
    img.src = imageUrl;
  }, [imageUrl, result]);

  // ── Heatmap SSE ──
  useEffect(() => {
    if (activeTab !== 'heatmap') { sseRef.current?.close(); sseRef.current = null; return; }
    startHeatmapStream(heatmapPair);
    return () => { sseRef.current?.close(); sseRef.current = null; };
  }, [activeTab, heatmapPair]);

  // ── Heatmap canvas render ──
  useEffect(() => {
    if (!heatmapData || !heatmapCanvasRef.current) return;
    renderHeatmap(heatmapCanvasRef.current, heatmapData, heatmapHistoryRef.current);
  }, [heatmapData]);

  // ── Heatmap stream ──
  const startHeatmapStream = async (symbol) => {
    try {
      await fetch(`${API_BASE}/api/heatmap/start`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol })
      });
    } catch {}
    sseRef.current?.close();
    // For cloud environments, standard Server-Sent Events (SSE) will route via https/wss protocol
    const sseUrl = API_BASE.startsWith('http') ? `${API_BASE}/api/heatmap-stream` : `http://${window.location.hostname}:5000/api/heatmap-stream`;
    const sse = new EventSource(sseUrl);


    sse.onopen = () => setHeatmapConnected(true);
    sse.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        setHeatmapData(data);
        heatmapHistoryRef.current.push(data);
        if (heatmapHistoryRef.current.length > 120) heatmapHistoryRef.current.shift();
      } catch {}
    };
    sse.onerror = () => setHeatmapConnected(false);
    sseRef.current = sse;
  };

  const renderHeatmap = (canvas, latest, history) => {
    const W = canvas.width, H = canvas.height;
    const ctx = canvas.getContext('2d');

    // ── Layout ──────────────────────────────────────────────────
    const LABEL_W  = 88;   // right price labels
    const CVD_H    = 52;   // CVD panel at bottom
    const CHART_W  = W - LABEL_W;
    const CHART_H  = H - CVD_H - 1;
    const NUM_ROWS = 150;  // price buckets (rows) — more = finer resolution

    // ── Background ───────────────────────────────────────────────
    ctx.fillStyle = '#030b07';
    ctx.fillRect(0, 0, W, H);

    const mid = latest.midPrice || 0;
    if (!mid) {
      ctx.fillStyle = '#3a5a48'; ctx.font = '14px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Connecting to exchanges...', W / 2, H / 2);
      return;
    }

    // ── Price range: ±0.7% from mid ─────────────────────────────
    const RANGE_PCT = 0.007;
    const priceMin  = mid * (1 - RANGE_PCT);
    const priceMax  = mid * (1 + RANGE_PCT);
    const priceRange = priceMax - priceMin;
    const cellH = CHART_H / NUM_ROWS;

    // Convert price → row index (row 0 = top = highest price)
    const priceToRow = (p) => {
      const row = Math.floor((priceMax - p) / priceRange * NUM_ROWS);
      return Math.max(0, Math.min(NUM_ROWS - 1, row));
    };
    const rowToY = (r) => r * cellH;
    const rowToPrice = (r) => priceMax - (r / NUM_ROWS) * priceRange;

    // ── Heat color palette: dark navy → blue → cyan → green → yellow → orange ──
    // Uses reference Bookmap color scale
    const heatColor = (t, isWhale) => {
      if (t <= 0.005) return null; // invisible
      const c = Math.min(t, 1);

      if (isWhale) {
        // Whale: bright white-yellow with glow
        const a = 0.92 + c * 0.08;
        return [255, 240, 80, a];
      }
      // Normal heat ramp
      let r, g, b, a;
      if (c < 0.15) {
        const f = c / 0.15;
        r = 0; g = Math.round(f * 50); b = Math.round(80 + f * 120); a = 0.3 + f * 0.4;
      } else if (c < 0.35) {
        const f = (c - 0.15) / 0.2;
        r = 0; g = Math.round(50 + f * 150); b = Math.round(200 - f * 50); a = 0.65 + f * 0.15;
      } else if (c < 0.55) {
        const f = (c - 0.35) / 0.2;
        r = Math.round(f * 30); g = Math.round(200 + f * 55); b = Math.round(150 - f * 100); a = 0.80;
      } else if (c < 0.75) {
        const f = (c - 0.55) / 0.2;
        r = Math.round(30 + f * 200); g = Math.round(255); b = Math.round(50 - f * 50); a = 0.88;
      } else {
        const f = (c - 0.75) / 0.25;
        r = 255; g = Math.round(255 - f * 180); b = 0; a = 0.93 + f * 0.07;
      }
      return [r, g, b, a];
    };

    // ── Grid lines (subtle) ──────────────────────────────────────
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    for (let r = 0; r <= NUM_ROWS; r += 15) {
      const y = rowToY(r);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CHART_W, y); ctx.stroke();
    }

    // ── Draw heatmap columns ─────────────────────────────────────
    const numCols = Math.max(history.length, 1);
    const cellW   = CHART_W / numCols;

    // First pass: group all entries into row buckets per column
    history.forEach((snap, colIdx) => {
      const x = colIdx * cellW;

      // Aggregate volume per row bucket for this snapshot
      const rowVol   = new Float32Array(NUM_ROWS);
      const rowWhale = new Uint8Array(NUM_ROWS);

      [...(snap.bids || []), ...(snap.asks || [])].forEach(({ price, intensity, isWhale }) => {
        const row = priceToRow(price);
        rowVol[row]   = Math.max(rowVol[row], intensity);
        if (isWhale) rowWhale[row] = 1;
      });

      // Render each row
      for (let r = 0; r < NUM_ROWS; r++) {
        if (rowVol[r] < 0.005 && !rowWhale[r]) continue;
        const rgba = heatColor(rowVol[r], rowWhale[r] === 1);
        if (!rgba) continue;
        const [rv, gv, bv, a] = rgba;
        const y = rowToY(r);

        if (rowWhale[r]) {
          // Glow for whale walls
          ctx.shadowColor = `rgba(255, 240, 80, 0.7)`;
          ctx.shadowBlur  = 8;
        }
        ctx.fillStyle = `rgba(${rv},${gv},${bv},${a})`;
        ctx.fillRect(x, y, Math.ceil(cellW) + 1, Math.max(cellH, 1.5));
        ctx.shadowBlur = 0;
      }
    });

    // ── Volume profile (rightmost ~8px strip before labels) ──────
    const profileX = CHART_W - 8;
    const rowMaxVol = new Float32Array(NUM_ROWS);
    [...(latest.bids || []), ...(latest.asks || [])].forEach(({ price, intensity }) => {
      const row = priceToRow(price);
      rowMaxVol[row] = Math.max(rowMaxVol[row], intensity);
    });
    for (let r = 0; r < NUM_ROWS; r++) {
      if (rowMaxVol[r] < 0.01) continue;
      const rgba = heatColor(rowMaxVol[r], false);
      if (!rgba) continue;
      const [rv, gv, bv, a] = rgba;
      ctx.fillStyle = `rgba(${rv},${gv},${bv},${a * 0.8})`;
      ctx.fillRect(profileX, rowToY(r), 8, Math.max(cellH, 1.5));
    }

    // ── Mid price line (bright white) ─────────────────────────────
    const midRow = priceToRow(mid);
    const midY   = rowToY(midRow) + cellH / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(0, midY); ctx.lineTo(CHART_W, midY); ctx.stroke();
    ctx.setLineDash([]);

    // ── Price labels (right side) ─────────────────────────────────
    ctx.font = 'bold 11px JetBrains Mono, monospace';
    ctx.textAlign = 'left';
    const labelX = CHART_W + 4;

    // Mid price — white box
    const midText = `$${mid.toFixed(2)}`;
    const mtw = ctx.measureText(midText).width;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(CHART_W, midY - 9, LABEL_W, 18);
    ctx.fillStyle = '#000';
    ctx.fillText(midText, labelX, midY + 4);

    // Top / bottom
    ctx.fillStyle = 'rgba(80,120,90,0.8)'; ctx.font = '9px JetBrains Mono, monospace';
    ctx.fillText(`$${priceMax.toFixed(2)}`, labelX, 11);
    ctx.fillText(`$${priceMin.toFixed(2)}`, labelX, CHART_H - 2);

    // Intermediate ticks
    for (let step = 1; step <= 7; step++) {
      const r = Math.round(NUM_ROWS * step / 8);
      const p = rowToPrice(r);
      const y = rowToY(r);
      if (Math.abs(y - midY) < 16) continue;
      ctx.fillStyle = 'rgba(60,100,75,0.6)';
      ctx.fillText(`$${p.toFixed(2)}`, labelX, y + 4);
    }

    // ── CVD panel ────────────────────────────────────────────────
    const cvdY0 = CHART_H + 1;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, cvdY0, CHART_W, CVD_H);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, cvdY0); ctx.lineTo(CHART_W, cvdY0); ctx.stroke();

    if (history.length > 2) {
      const cvdVals = history.map(s => s.moneyFlow?.cvd ?? 0);
      const cvdMin  = Math.min(...cvdVals), cvdMax = Math.max(...cvdVals);
      const cvdSpan = cvdMax - cvdMin || 1;
      const cvdToY  = v => cvdY0 + CVD_H - 4 - ((v - cvdMin) / cvdSpan) * (CVD_H - 10);

      // Fill under curve
      ctx.beginPath();
      history.forEach((snap, i) => {
        const x = i * cellW + cellW / 2;
        const y = cvdToY(snap.moneyFlow?.cvd ?? 0);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.lineTo((history.length - 1) * cellW + cellW / 2, cvdY0 + CVD_H);
      ctx.lineTo(0, cvdY0 + CVD_H);
      ctx.closePath();
      const latestCVD = history.at(-1)?.moneyFlow?.cvd ?? 0;
      ctx.fillStyle = latestCVD >= 0 ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.12)';
      ctx.fill();

      // CVD line
      ctx.strokeStyle = latestCVD >= 0 ? 'rgba(34,211,238,0.9)' : 'rgba(239,100,100,0.9)';
      ctx.lineWidth = 1.5; ctx.setLineDash([]);
      ctx.beginPath();
      history.forEach((snap, i) => {
        const x = i * cellW + cellW / 2;
        const y = cvdToY(snap.moneyFlow?.cvd || 0);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();

      // Zero line
      ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 0.5;
      ctx.setLineDash([4, 4]);
      const zeroY = cvdToY(0);
      ctx.beginPath(); ctx.moveTo(0, zeroY); ctx.lineTo(CHART_W, zeroY); ctx.stroke();
      ctx.setLineDash([]);
    }

    // CVD label
    ctx.fillStyle = 'rgba(34,211,238,0.6)'; ctx.font = '9px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('CVD', 4, cvdY0 + 12);


    // Exchange source badges (top-left)
    const exchColors = { binance: '#f0b90b', bybit: '#f7a600', okx: '#5f64f5', kraken: '#5741d9', coinbase: '#0052ff' };
    ctx.textAlign = 'left'; ctx.font = '9px sans-serif';
    (latest.sources || []).forEach((s, i) => {
      ctx.fillStyle = exchColors[s] || '#94a3b8';
      ctx.fillText(`● ${s}`, 6, 12 + i * 12);
    });
  };


  // ── Chart overlay drawing ──
  const drawOverlay = (ctx, w, h, data) => {
    const { overlay, entry, targets, sl } = data;
    const drawLine = (yVal, color, label, price) => {
      if (typeof yVal !== 'number') return;
      const y = yVal * h;
      ctx.strokeStyle = color; ctx.lineWidth = Math.max(2, Math.round(h * 0.003));
      ctx.setLineDash([Math.round(w * 0.01), Math.round(w * 0.01)]);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); ctx.setLineDash([]);
      const fontSize = Math.max(12, Math.round(h * 0.02));
      ctx.font = `bold ${fontSize}px 'JetBrains Mono', monospace`;
      const text = `${label}: $${price}`, tw = ctx.measureText(text).width;
      const pad = fontSize * 0.5, ch = fontSize + pad * 2, cw = tw + pad * 2;
      const cx = w - cw - 10, cy = y - ch / 2;
      ctx.fillStyle = 'rgba(10,25,18,0.9)'; ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(cx, cy, cw, ch, 6) : ctx.rect(cx, cy, cw, ch);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = color; ctx.textBaseline = 'middle';
      ctx.fillText(text, cx + pad, y);
    };
    drawLine(overlay.slY, '#ef4444', 'SL', sl);
    drawLine(overlay.entryY, '#22d3ee', 'ENTRY', entry);
    if (targets && overlay.targetsY) targets.forEach((tp, i) => drawLine(overlay.targetsY[i], '#10b981', `TP${i + 1}`, tp));
  };

  // ── File handling ──
  const handleDrag = (e) => { e.preventDefault(); e.stopPropagation(); setDragActive(e.type === 'dragenter' || e.type === 'dragover'); };
  const applyFile = (file) => { if (!file?.type.startsWith('image/')) return setError('Only image files are supported.'); setImageFile(file); setImageUrl(URL.createObjectURL(file)); setResult(null); setSecondOpinion(null); setError(null); setTvError(null); };
  const handleDrop = (e) => { e.preventDefault(); e.stopPropagation(); setDragActive(false); applyFile(e.dataTransfer.files?.[0]); };
  const handleFileChange = (e) => applyFile(e.target.files?.[0]);

  // ── TradingView fetch ──
  const handleTvFetch = async () => {
    if (!tvUrl.trim()) return;
    setTvLoading(true); setTvError(null);
    try {
      const res = await fetch(`${API_BASE}/api/fetch-tradingview`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: tvUrl.trim() })
      });


      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch chart');
      // Convert base64 back to a blob for display
      const blob = await (await fetch(data.image)).blob();
      const file = new File([blob], 'tradingview-chart.png', { type: data.mimeType });
      setImageFile(file);
      setImageUrl(data.image);
      setResult(null); setSecondOpinion(null); setError(null);
      setShowTvInput(false); setTvUrl('');
    } catch (err) {
      setTvError(err.message);
    } finally {
      setTvLoading(false);
    }
  };

  // ── Primary analysis ──
  const handleAnalyze = async () => {
    if (!imageFile) return;
    setLoading(true); setError(null); setResult(null); setSecondOpinion(null);
    const fd = new FormData();
    fd.append('chart', imageFile);
    fd.append('pair', '');
    fd.append('timeframe', timeframe === 'auto' ? '' : timeframe);
    fd.append('hints', hints);

    try {
      const res = await fetch(`${API_BASE}/api/analyze`, { method: 'POST', body: fd });


      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Server error');
      setResult(data);
      const entry = { id: Date.now(), pair: data.instrument || '?', timeframe: data.timeframe || '?', date: new Date().toLocaleString(), bias: data.bias, strength: data.strength, entry: data.entry, sl: data.sl, targets: data.targets, methodology: data.methodology, reasoning: data.reasoning, chartDataUrl: null };
      if (canvasRef.current) { setTimeout(() => { try { entry.chartDataUrl = canvasRef.current.toDataURL('image/jpeg', 0.4); } catch {} }, 300); }
      const newHistory = [entry, ...loadHistory()].slice(0, 50);
      setHistory(newHistory); saveHistory(newHistory);
    } catch (err) { setError(err.message || 'Network error.'); }
    finally { setLoading(false); }
  };

  // ── Second Opinion ──
  const handleSecondOpinion = async () => {
    if (!result) return;
    setSoLoading(true); setSoError(null); setSecondOpinion(null);
    const fd = new FormData();
    if (imageFile) fd.append('chart', imageFile);
    fd.append('originalResult', JSON.stringify(result));
    fd.append('pair', result.instrument || ''); fd.append('timeframe', result.timeframe || '');
    try {
      const res = await fetch(`${API_BASE}/api/second-opinion`, { method: 'POST', body: fd });


      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Second opinion failed');
      setSecondOpinion(data);
    } catch (err) { setSoError(err.message || 'Network error.'); }
    finally { setSoLoading(false); }
  };

  // ── History ──
  const clearHistory = () => { setHistory([]); saveHistory([]); setExpandedHistory(null); };

  // ── Helpers ──
  const getMethodologyBadge = (m) => { if (!m) return 'badge-smc'; const l = m.toLowerCase(); if (l.includes('elliott')) return 'badge-elliott'; if (l.includes('price')) return 'badge-pa'; return 'badge-smc'; };
  const verdictConfig = {
    confirm: { icon: '✅', color: '#10b981', label: T.soConfirmed },
    reject:  { icon: '🚨', color: '#ef4444', label: T.soRejected },
    caution: { icon: '⚠️', color: '#f59e0b', label: T.soCaution }
  };

  // ──────────────────────────────────────────────────────────────────────────
  return (
    <div className="app-container">
      {/* Header */}
      <header>
        <h1>{T.title}</h1>
        <p>{T.subtitle}</p>
        <button className="lang-toggle" onClick={toggleLang} title="Switch language">
          {lang === 'en' ? '🇬🇷 Ελληνικά' : '🇬🇧 English'}
        </button>
      </header>

      {/* Tabs */}
      <nav className="tab-nav">
        {[
          { id: 'analyzer', label: T.tabs.analyzer },
          { id: 'history',  label: `${T.tabs.history} (${history.length})` },
          { id: 'heatmap',  label: T.tabs.heatmap }
        ].map(tab => (
          <button key={tab.id} className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`} onClick={() => setActiveTab(tab.id)}>
            {tab.label}
          </button>
        ))}
      </nav>

      {/* ═══ ANALYZER TAB ═══════════════════════════════════════════════════ */}
      {activeTab === 'analyzer' && (
        <div className="main-layout">
          {/* Left panel */}
          <div className="panel">
            <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" style={{ display: 'none' }} />

            {/* Upload zone */}
            <div className={`upload-zone ${dragActive ? 'drag-active' : ''} ${imageUrl ? 'loaded' : ''}`}
              onDragEnter={handleDrag} onDragOver={handleDrag} onDragLeave={handleDrag} onDrop={handleDrop}
              onClick={() => fileInputRef.current.click()}>
              {imageUrl ? (
                <div><p style={{ color: '#10b981', fontWeight: 600 }}>{T.uploadLoaded}</p><p className="muted-sm">{T.uploadReplace}</p></div>
              ) : (
                <div><div className="upload-icon">📸</div><p style={{ fontWeight: 600 }}>{T.uploadDrag}</p><p className="muted-sm">{T.uploadOr}</p></div>
              )}
            </div>

            {/* TradingView import */}
            <div className="tv-import-section">
              <button className="btn-tv-toggle" onClick={() => setShowTvInput(v => !v)}>
                {T.tvImport}
              </button>
              {showTvInput && (
                <div>
                  <div className="tv-hint-box">
                    <p className="tv-hint-title">📸 {lang === 'el' ? 'Πώς να ανεβάσεις από TradingView:' : 'How to import from TradingView:'}</p>
                    <ol className="tv-hint-list">
                      <li>{lang === 'el' ? 'Πάτα το εικονίδιο 📷 στο TradingView' : 'Click the 📷 camera icon in TradingView'}</li>
                      <li><strong>{lang === 'el' ? 'Επιλογή Α:' : 'Option A:'}</strong> {lang === 'el' ? '"Copy image" → Ctrl+V εδώ' : '"Copy image" → then Ctrl+V here'}</li>
                      <li><strong>{lang === 'el' ? 'Επιλογή Β:' : 'Option B:'}</strong> {lang === 'el' ? '"Copy link" → επικόλλησε το URL παρακάτω' : '"Copy link" → paste the URL below'}</li>
                    </ol>
                  </div>
                  <div className="tv-input-row">
                    <input
                      type="text" value={tvUrl}
                      onChange={e => setTvUrl(e.target.value)}
                      placeholder={T.tvPlaceholder}
                      onKeyDown={e => e.key === 'Enter' && handleTvFetch()}
                    />
                    <button className="btn-tv-fetch" onClick={handleTvFetch} disabled={tvLoading}>
                      {tvLoading ? T.tvFetching : T.tvFetch}
                    </button>
                  </div>
                </div>
              )}
              {tvError && <div className="error-box" style={{ marginTop: '0.5rem' }}>{tvError}</div>}
            </div>

            {/* Optional timeframe override */}
            <div className="form-group">
              <label>{T.timeframeLabel}</label>
              <select value={timeframe} onChange={e => setTimeframe(e.target.value)}>
                <option value="auto">{T.timeframeAuto}</option>
                <option value="1M">1 Minute</option>
                <option value="5M">5 Minutes</option>
                <option value="15M">15 Minutes</option>
                <option value="30M">30 Minutes</option>
                <option value="1H">1 Hour</option>
                <option value="2H">2 Hours</option>
                <option value="4H">4 Hours</option>
                <option value="6H">6 Hours</option>
                <option value="12H">12 Hours</option>
                <option value="1D">1 Day</option>
                <option value="3D">3 Days</option>
                <option value="1W">1 Week</option>
                <option value="1M_tf">1 Month</option>
              </select>
            </div>

            {/* Hints */}
            <div className="form-group" style={{ marginTop: '1rem' }}>
              <label>{T.uploadHints}</label>
              <input type="text" value={hints} onChange={e => setHints(e.target.value)} placeholder={T.uploadHintsPlaceholder} />
            </div>

            <button className="btn-analyze" onClick={handleAnalyze} disabled={!imageFile || loading}>
              {loading ? <span className="btn-loading"><span className="spinner-sm" />{T.btnAnalyzing}</span> : T.btnAnalyze}
            </button>

            {error && <div className="error-box">{error}</div>}
          </div>

          {/* Right panel */}
          <div className="panel">
            {imageUrl ? (
              <div className="canvas-container"><canvas ref={canvasRef} /></div>
            ) : (
              <div className="empty-canvas-placeholder">{T.uploadEmpty}</div>
            )}

            {loading && (
              <div className="loader-container">
                <div className="loader" />
                <p style={{ fontWeight: 600, color: '#10b981' }}>{T.loadingMsg}</p>
                <p className="muted-sm">{T.loadingSubMsg}</p>
              </div>
            )}

            {result && (
              <div className="result-section">
                <div className="result-header">
                  <div>
                    <span className={`badge ${getMethodologyBadge(result.methodology)}`}>{result.methodology || 'SMC'} {T.methodology}</span>
                    <div className={`bias-tag ${result.bias?.toLowerCase()}`}>{result.bias} {T.setup}</div>
                    {(result.instrument || result.timeframe) && (
                      <div className="chart-meta">{result.instrument} · {result.timeframe}</div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="card-title">{T.strengthScore}</div>
                    <div className="score-display">
                      <span className="score-value">{result.strength}%</span>
                      <div className="score-bar"><div className="score-fill" style={{ width: `${result.strength}%` }} /></div>
                    </div>
                  </div>
                </div>

                <p className="methodology-reason">{result.methodologyReason}</p>

                <div className="levels-grid">
                  <div className="level-card entry"><div className="card-title">{T.entryTrigger}</div><div className="level-value cyan">${result.entry}</div></div>
                  <div className="level-card sl"><div className="card-title">{T.stopLoss}</div><div className="level-value red">${result.sl}</div></div>
                  <div className="level-card tp"><div className="card-title">{T.takeProfit}</div><div className="level-value green">${result.targets?.[0] ?? 'N/A'}</div></div>
                </div>

                {result.targets?.length > 1 && (
                  <div className="secondary-targets">
                    <span className="card-title">{T.secondaryTargets} </span>
                    {result.targets.slice(1).map((tp, i) => <span key={i} className="tp-badge">TP{i + 2}: ${tp}</span>)}
                  </div>
                )}

                <div className="confluences-section">
                  <span className="card-title">{T.detectedPatterns}</span>
                  <div className="confluences-list">
                    {result.patterns?.map((p, i) => <span key={i} className="confluence-item">{p}</span>)}
                    {result.indicators?.map((ind, i) => <span key={i} className="confluence-item cyan-item">{ind}</span>)}
                  </div>
                </div>

                <div><span className="card-title">{T.aiReasoning}</span><p className="reasoning-text">{result.reasoning}</p></div>

                {/* Second Opinion */}
                <div style={{ marginTop: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1.5rem' }}>
                  <button className="btn-second-opinion" onClick={handleSecondOpinion} disabled={soLoading}>
                    {soLoading ? <span className="btn-loading"><span className="spinner-sm" />{T.btnGettingOpinion}</span> : T.btnSecondOpinion}
                  </button>
                  {soError && <div className="error-box" style={{ marginTop: '0.5rem' }}>{soError}</div>}
                </div>

                {secondOpinion && (() => {
                  const vc = verdictConfig[secondOpinion.verdict] || verdictConfig.caution;
                  return (
                    <div className="second-opinion-card" style={{ '--so-color': vc.color }}>
                      <div className="so-header">
                        <span className="so-icon">{vc.icon}</span>
                        <div>
                          <div className="so-verdict" style={{ color: vc.color }}>{vc.label}</div>
                          <div className="so-reason">{secondOpinion.verdictReason}</div>
                        </div>
                        <div className="so-confidence">
                          <div className="card-title">{T.soConfidence}</div>
                          <div style={{ color: vc.color, fontWeight: 700, fontSize: '1.1rem' }}>{secondOpinion.confidence}%</div>
                        </div>
                      </div>
                      <div className="so-risks">
                        <span className="card-title">{T.soChallengePoints}</span>
                        <ul className="so-risk-list">{secondOpinion.challengePoints?.map((p, i) => <li key={i}>{p}</li>)}</ul>
                      </div>
                      {secondOpinion.alternativeScenario && (
                        <div style={{ marginTop: '0.75rem' }}>
                          <span className="card-title">{T.soAlternative} </span>
                          <span style={{ fontSize: '0.85rem', color: '#cbd5e1' }}>{secondOpinion.alternativeScenario}</span>
                        </div>
                      )}
                      <p className="reasoning-text" style={{ marginTop: '0.75rem' }}>{secondOpinion.reasoning}</p>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ HISTORY TAB ════════════════════════════════════════════════════ */}
      {activeTab === 'history' && (
        <div className="history-tab">
          <div className="history-header">
            <h2 style={{ fontSize: '1.3rem', fontWeight: 700 }}>{T.historyTitle}</h2>
            {history.length > 0 && <button className="btn-clear" onClick={clearHistory}>{T.clearAll}</button>}
          </div>

          {history.length === 0 ? (
            <div className="empty-state">
              <div style={{ fontSize: '3rem' }}>📭</div>
              <p>{T.noHistory}</p>
              <button className="btn-analyze" style={{ maxWidth: 220, marginTop: '1rem' }} onClick={() => setActiveTab('analyzer')}>{T.goAnalyzer}</button>
            </div>
          ) : (
            <div className="history-grid">
              {history.map(item => (
                <div key={item.id} className={`history-card ${expandedHistory === item.id ? 'expanded' : ''}`} onClick={() => setExpandedHistory(expandedHistory === item.id ? null : item.id)}>
                  {item.chartDataUrl && <img src={item.chartDataUrl} alt="chart" className="history-thumb" />}
                  <div className="history-card-body">
                    <div className="history-card-top">
                      <div><span className="history-pair">{item.pair}</span><span className="history-tf">{item.timeframe}</span></div>
                      <span className={`bias-pill ${item.bias?.toLowerCase()}`}>{item.bias}</span>
                    </div>
                    <div className="history-date">{item.date}</div>
                    <div className="history-levels">
                      <span className="cyan">Entry: ${item.entry}</span>
                      <span className="red">SL: ${item.sl}</span>
                      <span className="green">TP1: ${item.targets?.[0]}</span>
                    </div>
                    <div className="history-strength">
                      <div className="score-bar" style={{ marginTop: '0.5rem' }}><div className="score-fill" style={{ width: `${item.strength}%` }} /></div>
                      <span className="card-title">{item.strength}% {T.strength}</span>
                    </div>
                    {expandedHistory === item.id && <div className="history-expanded"><p className="reasoning-text">{item.reasoning}</p></div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ HEATMAP TAB ════════════════════════════════════════════════════ */}
      {activeTab === 'heatmap' && (
        <div className="heatmap-tab">
          {/* ── Controls ── */}
          <div className="heatmap-controls">
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
              <label>{T.symbol}</label>
              <input type="text" value={heatmapPair} onChange={e => setHeatmapPair(e.target.value.toUpperCase())} placeholder="e.g. BTCUSDT, ETHUSDT" />
            </div>
            <button className="btn-heatmap-start" onClick={() => startHeatmapStream(heatmapPair)}>{T.apply}</button>
            <div className={`heatmap-status ${heatmapConnected ? 'connected' : 'disconnected'}`}>
              <span className="status-dot" /> {heatmapConnected ? T.live : T.connecting}
            </div>
          </div>

          {/* ── Legend ── */}
          <div className="heatmap-legend">
            <span className="legend-item green-legend">■ {T.bidsLegend}</span>
            <span className="legend-item red-legend">■ {T.asksLegend}</span>
            <span className="legend-item white-legend">— {T.midPriceLegend}</span>
            <span className="legend-item whale-legend">█ {T.whaleLegend}</span>
            <span className="legend-item" style={{ color: '#22d3ee' }}>〜 CVD</span>
            <span className="legend-item" style={{ color: '#7c8f88' }}>│ Vol Profile</span>
            {heatmapData?.sources?.length > 0 && <span className="legend-item" style={{ marginLeft: 'auto', color: '#4b6057' }}>⬡ {heatmapData.sources.join(' · ')}</span>}
          </div>

          {/* ── Bookmap Canvas ── */}
          <div className="heatmap-canvas-wrapper">
            <canvas ref={heatmapCanvasRef} width={1100} height={580} className="heatmap-canvas" />
          </div>

          {/* ── Stats Row ── */}
          {heatmapData && (
            <div className="heatmap-stats">
              <div className="heatmap-stat">
                <div className="card-title">{T.midPrice}</div>
                <div className="stat-value cyan">${heatmapData.midPrice?.toFixed(2)}</div>
              </div>
              <div className="heatmap-stat">
                <div className="card-title">{T.topBidWall}</div>
                <div className="stat-value green">${heatmapData.bids?.[0]?.price?.toFixed(2)} <small>({(heatmapData.bids?.[0]?.qty || 0).toFixed(1)})</small></div>
              </div>
              <div className="heatmap-stat">
                <div className="card-title">{T.topAskWall}</div>
                <div className="stat-value red">${heatmapData.asks?.[0]?.price?.toFixed(2)} <small>({(heatmapData.asks?.[0]?.qty || 0).toFixed(1)})</small></div>
              </div>
              <div className="heatmap-stat">
                <div className="card-title">{T.spread}</div>
                <div className="stat-value">${((heatmapData.asks?.[0]?.price || 0) - (heatmapData.bids?.[0]?.price || 0)).toFixed(3)}</div>
              </div>
            </div>
          )}

          {/* ══════════════════════ MONEY FLOW PANEL ══════════════════════ */}
          {heatmapData?.moneyFlow && (() => {
            const mf = heatmapData.moneyFlow;
            const biasColor = mf.bias === 'buy' ? '#10b981' : mf.bias === 'sell' ? '#ef4444' : '#94a3b8';
            const cvdColor = mf.cvd > 0 ? '#10b981' : mf.cvd < 0 ? '#ef4444' : '#94a3b8';
            return (
              <div className="money-flow-panel">
                <h3 className="mf-title">💹 Money Flow & Order Pressure</h3>
                <div className="mf-grid">

                  {/* Pressure Gauge */}
                  <div className="mf-card">
                    <div className="card-title">Order Pressure</div>
                    <div className="pressure-bar-wrap">
                      <div className="pressure-bar">
                        <div className="pressure-bid" style={{ width: `${mf.bidPct}%` }} />
                        <div className="pressure-ask" style={{ width: `${mf.askPct}%` }} />
                      </div>
                      <div className="pressure-labels">
                        <span className="green" style={{ fontWeight: 700 }}>{mf.bidPct}% BUY</span>
                        <span className="red" style={{ fontWeight: 700 }}>{mf.askPct}% SELL</span>
                      </div>
                    </div>
                    <div className="mf-bias" style={{ color: biasColor }}>
                      {mf.bias === 'buy' ? '▲ BUY DOMINANT' : mf.bias === 'sell' ? '▼ SELL DOMINANT' : '◆ BALANCED'}
                    </div>
                  </div>

                  {/* CVD */}
                  <div className="mf-card">
                    <div className="card-title">Cumulative Volume Delta</div>
                    <div className="cvd-value" style={{ color: cvdColor }}>
                      {mf.cvd > 0 ? '+' : ''}{mf.cvd.toLocaleString()}
                    </div>
                    <div className="cvd-bar-wrap">
                      <div className="cvd-bar">
                        <div className="cvd-fill" style={{
                          width: `${Math.min(Math.abs(mf.netPressure) / Math.max(mf.totalBidVol, mf.totalAskVol, 1) * 100, 100)}%`,
                          background: cvdColor,
                          marginLeft: mf.cvd >= 0 ? '50%' : 'auto',
                          marginRight: mf.cvd < 0 ? '50%' : 'auto'
                        }} />
                      </div>
                    </div>
                    <div className="card-title" style={{ marginTop: '0.4rem' }}>
                      Net: {mf.netPressure > 0 ? '+' : ''}{mf.netPressure.toLocaleString()} units
                    </div>
                  </div>

                  {/* Volume breakdown */}
                  <div className="mf-card">
                    <div className="card-title">Volume Depth</div>
                    <div className="vol-row"><span className="green">Bid Liquidity</span><span>{mf.totalBidVol.toLocaleString()}</span></div>
                    <div className="vol-row"><span className="red">Ask Liquidity</span><span>{mf.totalAskVol.toLocaleString()}</span></div>
                    <div className="vol-divider"/>
                    <div className="vol-row">
                      <span style={{ color: '#94a3b8' }}>Bid/Ask Ratio</span>
                      <span style={{ fontWeight: 700, color: biasColor }}>{mf.totalAskVol ? (mf.totalBidVol / mf.totalAskVol).toFixed(2) : '—'}x</span>
                    </div>
                  </div>

                  {/* Smart Money Alerts */}
                  <div className="mf-card">
                    <div className="card-title">🐳 Smart Money Alerts</div>
                    {heatmapData.smartMoneyAlerts?.length > 0 ? (
                      <div className="sm-alerts">
                        {heatmapData.smartMoneyAlerts.slice(0, 4).map((alert, i) => (
                          <div key={i} className={`sm-alert ${alert.side}`}>
                            <span className="sm-label">{alert.label}</span>
                            <span className="sm-price">${alert.price?.toFixed(2)}</span>
                            <span className="sm-qty">{alert.qty?.toFixed(0)}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="sm-empty">Monitoring for large orders...</div>
                    )}
                  </div>

                </div>

                {/* Price Imbalances */}
                {mf.imbalances?.length > 0 && (
                  <div className="imbalance-row">
                    <span className="card-title" style={{ marginRight: '0.75rem' }}>⚡ Imbalances:</span>
                    {mf.imbalances.map((imb, i) => (
                      <span key={i} className={`imbalance-tag ${imb.type === 'bid_dominance' ? 'green-tag' : 'red-tag'}`}>
                        ${imb.price.toFixed(2)} {imb.type === 'bid_dominance' ? '▲' : '▼'} {imb.ratio}x
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── Whale Walls ── */}
          {heatmapData?.whaleWalls?.length > 0 && (
            <div className="whale-section">
              <h3 className="whale-title">{T.whaleWalls}</h3>
              <div className="whale-grid">
                {heatmapData.whaleWalls.map((w, i) => (
                  <div key={i} className={`whale-card ${w.side}`}>
                    <div className="whale-side">{w.side === 'bid' ? '🟢 BID' : '🔴 ASK'}</div>
                    <div className="whale-price">${w.price.toFixed(2)}</div>
                    <div className="whale-qty">{w.qty.toFixed(1)} units</div>
                    <div className="ob-bar-bg" style={{ marginTop: '0.4rem' }}>
                      <div className={`ob-bar-fill ${w.side === 'bid' ? 'green-fill' : 'red-fill'}`} style={{ width: `${w.intensity * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Order Book Tables ── */}
          {heatmapData && (
            <div className="orderbook-tables">
              <div className="ob-side">
                <h3 className="ob-title green">{T.bids}</h3>
                <table className="ob-table">
                  <thead><tr><th>{T.price}</th><th>{T.volume}</th><th>{T.intensity}</th></tr></thead>
                  <tbody>
                    {heatmapData.bids?.slice(0, 15).map((b, i) => (
                      <tr key={i} className={b.isWhale ? 'whale-row' : ''}>
                        <td className="green">{b.isWhale ? '🐳 ' : ''}${b.price.toFixed(2)}</td>
                        <td>{b.qty.toFixed(2)}</td>
                        <td><div className="ob-bar-bg"><div className="ob-bar-fill green-fill" style={{ width: `${b.intensity * 100}%` }} /></div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="ob-side">
                <h3 className="ob-title red">{T.asks}</h3>
                <table className="ob-table">
                  <thead><tr><th>{T.price}</th><th>{T.volume}</th><th>{T.intensity}</th></tr></thead>
                  <tbody>
                    {heatmapData.asks?.slice(0, 15).map((a, i) => (
                      <tr key={i} className={a.isWhale ? 'whale-row' : ''}>
                        <td className="red">{a.isWhale ? '🐳 ' : ''}${a.price.toFixed(2)}</td>
                        <td>{a.qty.toFixed(2)}</td>
                        <td><div className="ob-bar-bg"><div className="ob-bar-fill red-fill" style={{ width: `${a.intensity * 100}%` }} /></div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
