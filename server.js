import express from 'express';
import cors from 'cors';
import multer from 'multer';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { analyzeChart, getSecondOpinion } from './aiProvider.js';
import { aggregator } from './heatmap.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Serve static assets from frontend if built
const frontendDist = path.join(__dirname, '../frontend/dist');
app.use(express.static(frontendDist));



// Multer: store uploads in memory
const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB

// Store latest chart buffer for second opinion (in memory, per-session)
let lastChartBuffer = null;
let lastChartMime = null;

// ─────────────────────────────────────────────
// TRADINGVIEW SNAPSHOT FETCH
// Accepts a TradingView /x/ snapshot URL, fetches the image server-side
// ─────────────────────────────────────────────
app.post('/api/fetch-tradingview', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'No URL provided.' });
  if (!url.includes('tradingview.com')) {
    return res.status(400).json({ error: 'Please provide a TradingView URL.' });
  }

  const FETCH_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,image/avif,image/webp,image/png,*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.tradingview.com/'
  };

  const ACCEPTED_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

  // Helper: check if buffer is a real image via magic bytes
  const isImageBuffer = (buf) => {
    const magic = buf.slice(0, 4).toString('hex');
    return magic.startsWith('89504e') || // PNG
           magic.startsWith('ffd8ff') || // JPEG
           magic.startsWith('47494638') || // GIF
           magic.startsWith('52494646'); // WEBP
  };

  // Helper: fetch URL and return { buffer, mimeType } or null
  const fetchImage = async (targetUrl) => {
    const resp = await fetch(targetUrl, { headers: FETCH_HEADERS, redirect: 'follow' });
    if (!resp.ok) return null;
    const ct = (resp.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const buf = Buffer.from(await resp.arrayBuffer());
    if (!isImageBuffer(buf)) return null;
    const mime = ACCEPTED_MIMES.includes(ct) ? ct : 'image/png';
    return { buffer: buf, mimeType: mime };
  };

  try {
    // First attempt: try the URL directly (works if it's already a CDN image link)
    let result = await fetchImage(url);

    if (!result) {
      // Second attempt: fetch as HTML and extract image URL
      const htmlResp = await fetch(url, { headers: FETCH_HEADERS, redirect: 'follow' });
      if (htmlResp.ok) {
        const html = await htmlResp.text();

        // Strategy 1: og:image meta tag
        const ogMatch = html.match(/property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
                     || html.match(/content=["']([^"']+)["'][^>]*property=["']og:image["']/i);

        // Strategy 2: direct <img> with snapshot-looking src
        const imgMatch = html.match(/src=["'](https?:\/\/[^"']*(?:snapshot|chart|s3)[^"']*\.(?:png|jpg|jpeg|webp))["']/i);

        const imageUrl = ogMatch?.[1] || imgMatch?.[1];
        if (imageUrl) {
          result = await fetchImage(imageUrl);
        }
      }
    }

    if (!result) {
      return res.status(400).json({
        error: '❌ Δεν μπόρεσα να βρω εικόνα στο link. Δοκίμασε: TradingView → 📷 → "Copy image" → Ctrl+V στην εφαρμογή (πιο αξιόπιστο).'
      });
    }

    lastChartBuffer = result.buffer;
    lastChartMime = result.mimeType;
    const base64 = result.buffer.toString('base64');
    res.json({ image: `data:${result.mimeType};base64,${base64}`, mimeType: result.mimeType });

  } catch (err) {
    console.error('TradingView fetch error:', err.message);
    res.status(500).json({ error: `Αποτυχία λήψης: ${err.message}` });
  }
});


// ─────────────────────────────────────────────
// PRIMARY ANALYSIS (with live orderbook context)
// ─────────────────────────────────────────────
app.post('/api/analyze', upload.single('chart'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Please upload a chart image.' });

    const { pair, timeframe, hints } = req.body;
    lastChartBuffer = req.file.buffer;
    lastChartMime = req.file.mimetype;

    // Attach live orderbook snapshot if heatmap is active
    let orderbookContext = null;
    if (aggregator.running && aggregator.midPrice > 0) {
      try {
        const snap = aggregator.getSnapshot();
        const topBids = snap.bids.slice(0, 5).map(b => `$${b.price.toFixed(2)}(${b.qty.toFixed(1)}${b.isWhale ? '🐳' : ''})`);
        const topAsks = snap.asks.slice(0, 5).map(a => `$${a.price.toFixed(2)}(${a.qty.toFixed(1)}${a.isWhale ? '🐳' : ''})`);
        const mf = snap.moneyFlow;
        orderbookContext = `LIVE ORDER BOOK (${snap.symbol} from ${snap.sources.join('+')}): Mid=$${snap.midPrice.toFixed(2)} | Bids: ${topBids.join(' ')} | Asks: ${topAsks.join(' ')} | Pressure: ${mf.bidPct}% BUY / ${mf.askPct}% SELL | CVD: ${mf.cvd > 0 ? '+' : ''}${mf.cvd} | Bias: ${mf.bias.toUpperCase()}${snap.whaleWalls.length ? ` | Whale Walls: ${snap.whaleWalls.map(w => `${w.side === 'bid' ? '🟢' : '🔴'}$${w.price.toFixed(2)}`).join(' ')}` : ''}`;
      } catch (e) { console.warn('Orderbook ctx error:', e.message); }
    }

    console.log(`Analyzing via ${process.env.AI_PROVIDER || 'gemini'}${orderbookContext ? ' +orderbook' : ''}...`);
    const result = await analyzeChart(lastChartBuffer, lastChartMime, pair, timeframe, hints, orderbookContext);
    res.json(result);
  } catch (error) {
    console.error('Analysis error:', error.message);
    res.status(500).json({ error: error.message || 'Analysis failed.' });
  }
});

// ─────────────────────────────────────────────
// SECOND OPINION
// ─────────────────────────────────────────────
app.post('/api/second-opinion', upload.single('chart'), async (req, res) => {
  try {
    // Accept new chart upload OR reuse the last one
    const buffer = req.file?.buffer || lastChartBuffer;
    const mime = req.file?.mimetype || lastChartMime;

    if (!buffer) return res.status(400).json({ error: 'No chart available. Run primary analysis first.' });

    const originalResult = JSON.parse(req.body.originalResult || '{}');
    const { pair, timeframe } = req.body;

    console.log(`Getting second opinion for ${pair || 'unknown'}...`);
    const result = await getSecondOpinion(buffer, mime, originalResult, pair, timeframe);
    res.json(result);
  } catch (error) {
    console.error('Second opinion error:', error.message);
    res.status(500).json({ error: error.message || 'Second opinion failed.' });
  }
});

// ─────────────────────────────────────────────
// HEATMAP — switch symbol
// ─────────────────────────────────────────────
app.post('/api/heatmap/start', (req, res) => {
  const { symbol } = req.body;
  if (symbol) aggregator.setSymbol(symbol);
  else if (!aggregator.running) aggregator.start();
  res.json({ ok: true, symbol: aggregator.symbol });
});

// ─────────────────────────────────────────────
// HEATMAP — SSE stream
// ─────────────────────────────────────────────
app.get('/api/heatmap-stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Start aggregator if not running
  if (!aggregator.running) aggregator.start();

  const interval = setInterval(() => {
    try {
      const snapshot = aggregator.getSnapshot();
      res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
    } catch (e) {
      // ignore
    }
  }, 500);

  req.on('close', () => clearInterval(interval));
});

// ─────────────────────────────────────────────
// HEATMAP — instant snapshot (for AI context)
// ─────────────────────────────────────────────
app.get('/api/heatmap-snapshot', (req, res) => {
  if (!aggregator.running || aggregator.midPrice === 0) return res.json({ available: false });
  try { res.json({ available: true, ...aggregator.getSnapshot() }); }
  catch (e) { res.json({ available: false, error: e.message }); }
});

// ─────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', provider: process.env.AI_PROVIDER || 'gemini' });
});

app.get('/test-api', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.json({ error: 'No ANTHROPIC_API_KEY set' });
  try {
    const response = await fetch('https://api.anthropic.com/v1/models', {
      method: 'GET',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
    });
    const data = await response.json();
    const models = (data.data || []).map(m => ({ id: m.id, name: m.display_name }));
    res.json({ count: models.length, models });
  } catch (err) {
    res.json({ error: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'), (err) => {
    if (err) {
      res.status(404).send('Not Found');
    }
  });
});

app.listen(port, () => {
  console.log(`\n🚀 Server running on port ${port}`);
  console.log(`   Provider: ${process.env.AI_PROVIDER || 'gemini'}`);
});

