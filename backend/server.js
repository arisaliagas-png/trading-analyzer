import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { analyzeChart, getSecondOpinion } from './aiProvider.js';
import { aggregator } from './heatmap.js';
import { getLiveIndicators } from './indicators.js';
import { fetchAssetNews } from './newsSearch.js';
import { registerTradeSetup, startTracker } from './tradeTracker.js';
import { getCapitalFlow } from './capitalFlow.js';
import { startScanner, getActiveSignals, triggerManualScan, getScanState } from './scanner.js';
import { migrateFromJSON, getAllTrades, getAllLessons, db } from './db.js';
import { computeAnalytics } from './analytics.js';
import { serverLog } from './logger.js';
import { resetCircuitBreaker, getCircuitBreakerState, ACCOUNT_EQUITY } from './riskManager.js';

dotenv.config();

// ─────────────────────────────────────────────
// [1B] FAIL-FAST ENV VALIDATION
// If a required key is missing, crash immediately at startup
// instead of failing silently mid-request.
// ─────────────────────────────────────────────
const REQUIRED_ENV = [
  process.env.AI_PROVIDER === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'GEMINI_API_KEY'
];
const missingEnv = REQUIRED_ENV.filter(k => !process.env[k]);
if (missingEnv.length > 0) {
  console.error(`\n❌ Server startup aborted. Missing required environment variables: ${missingEnv.join(', ')}`);
  console.error('   → Add them to backend/.env and restart.');
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 5000;

// ─────────────────────────────────────────────
// [1C] CORS — restrict to localhost only (single-user local deployment)
// Add your production domain here if you ever deploy remotely.
// ─────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'http://localhost:5000',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
  'http://127.0.0.1:5000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000'
];
app.use(cors({
  origin: (origin, cb) => {
    // allow requests with no origin (mobile apps, curl, Postman)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS blocked: ${origin} is not an allowed origin.`));
  },
  credentials: true
}));

// ─────────────────────────────────────────────
// [1C] RATE LIMITING — protect AI endpoints from abuse
// Prevents someone from burning your API budget with request spam.
// ─────────────────────────────────────────────
// Heavy AI endpoints: max 15 requests per minute
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '⚠️ Rate limit exceeded. Max 15 AI requests per minute.' }
});
// General API: max 60 requests per minute
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '⚠️ Too many requests. Please slow down.' }
});

app.use('/api/analyze',        aiLimiter);
app.use('/api/second-opinion', aiLimiter);
app.use('/api/scanner/run',    aiLimiter);
app.use('/api/',               generalLimiter);
app.use(express.json());

// ── Alerts (trade closed notifications) ──
// Returns recent alerts. ?unread=1 returns unseen alerts and marks as seen.
// NOTE: Must be registered before express.static(frontend) to avoid SPA fallback.
app.get('/api/alerts', (req, res) => {
  try {
    if (req.query.unread === '1') {
      const rows = db.prepare('SELECT * FROM alerts WHERE seen = 0 ORDER BY created_at DESC LIMIT 20').all();
      db.exec('UPDATE alerts SET seen = 1 WHERE seen = 0');
      return res.json({ alerts: rows, unreadCount: rows.length });
    }
    const rows = db.prepare('SELECT * FROM alerts ORDER BY created_at DESC LIMIT 50').all();
    res.json({ alerts: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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
    // First attempt: If it is a TradingView share snapshot link (e.g. tradingview.com/x/ABCDEF/), 
    // convert it directly to the static S3 CDN image URL which is fast and bypasses HTML parsing.
    let targetUrl = url;
    const tvXMatch = url.match(/tradingview\.com\/x\/([a-zA-Z0-9]+)\/?$/);
    if (tvXMatch) {
      const code = tvXMatch[1];
      targetUrl = `https://s3.amazonaws.com/tradingview/snapshots/${code.slice(0, 1).toLowerCase()}/${code}.png`;
      console.log(`Converted TradingView /x/ link to direct CDN URL: ${targetUrl}`);
    }

    let result = await fetchImage(targetUrl);
 
    if (!result && targetUrl !== url) {
      // If S3 conversion failed, fallback to the original page parsing
      result = await fetchImage(url);
    }

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
        error: '❌ Δεν μπόρεσα να βρω την εικόνα στο link. Δοκίμασε: TradingView → 📷 → "Copy image" → Ctrl+V στην εφαρμογή (προτείνεται).'
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
// PRIMARY ANALYSIS (with live orderbook & indicator context)
// ─────────────────────────────────────────────
app.post('/api/analyze', upload.single('chart'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Please upload a chart image.' });

    const { pair, timeframe, hints } = req.body;
    lastChartBuffer = req.file.buffer;
    lastChartMime = req.file.mimetype;

    // Sync aggregator symbol to current pair first before reading orderbook/whale context
    if (pair) {
      try {
        aggregator.setSymbol(pair);
      } catch (e) {
        console.warn('Failed to sync aggregator symbol:', e.message);
      }
    }

    // 1. Fetch indicators context
    let indicatorContext = null;
    if (pair) {
      try {
        const snap = aggregator.running && aggregator.midPrice > 0 ? aggregator.getSnapshot() : null;
        const whaleWalls = snap ? snap.whaleWalls : [];
        const absorption = snap ? snap.footprint?.absorption : null;
        
        const ind = await getLiveIndicators(pair, timeframe || '1h', whaleWalls, absorption, hints);
        if (ind.available) {
          const mtfSection = ind.mtfScore
            ? `\nMULTI-TIMEFRAME BIAS (EMA200): ${ind.mtfDetails} | MTF Score: ${ind.mtfScore}`
            : '';
          const arisSection = ind.arisContext
            ? `\n\n${ind.arisContext}`
            : '';
          indicatorContext = `LIVE TECHNICAL INDICATORS (${pair} ${timeframe || '1h'}): Current Price=$${ind.currentPrice} | EMA20=$${ind.ema20} | EMA50=$${ind.ema50} | EMA200=$${ind.ema200} | POC (Point of Control)=$${ind.poc} | RSI(14)=${ind.rsi} | MACD: Hist=${ind.macd?.histogram}, MACD=${ind.macd?.MACD}, Sig=${ind.macd?.signal} | ADX: Val=${ind.adx?.adx}, DI+=${ind.adx?.pdi}, DI-=${ind.adx?.mdi}${mtfSection}${arisSection}`;
        }
      } catch (e) {
        console.warn('Indicators fetch error:', e.message);
      }
    }

    // 2. Attach live orderbook snapshot if heatmap is active
    let orderbookContext = null;
    if (aggregator.running && aggregator.midPrice > 0) {
      try {
        const snap = aggregator.getSnapshot();
        const f = (val) => {
          if (val == null) return '0';
          return val < 1 ? val.toFixed(5) : val < 1000 ? val.toFixed(3) : val.toFixed(2);
        };
        const topBids = snap.bids.slice(0, 5).map(b => `$${f(b.price)}(${b.qty.toFixed(1)}${b.isWhale ? '🐳' : ''})`);
        const topAsks = snap.asks.slice(0, 5).map(a => `$${f(a.price)}(${a.qty.toFixed(1)}${a.isWhale ? '🐳' : ''})`);
        const mf = snap.moneyFlow;

        // Smart Money cluster zones (price-binned, filtered by significance)
        const lc = snap.liquidityClusters;
        let clusterSection = '';
        if (lc && (lc.bids.length || lc.asks.length)) {
          const topBidClusters = lc.bids.slice(0, 5).map(c =>
            `$${f(c.price)}[${c.qty.toFixed(1)}${c.isWhale ? '★MEGA' : ''}|${c.distancePct}%]`
          );
          const topAskClusters = lc.asks.slice(0, 5).map(c =>
            `$${f(c.price)}[${c.qty.toFixed(1)}${c.isWhale ? '★MEGA' : ''}|+${Math.abs(c.distancePct)}%]`
          );
          clusterSection = `\nSMART MONEY CLUSTERS (bin=$${f(lc.binSize)}, threshold=${lc.minVol}): ` +
            `SUPPORT ZONES: ${topBidClusters.join(' ') || 'none'} | ` +
            `RESISTANCE ZONES: ${topAskClusters.join(' ') || 'none'} ` +
            `(format: price[volume|distance_from_mid], ★MEGA = 3× Smart Money threshold)`;
        }

        // Live Footprint & Absorption
        const fp = snap.footprint;
        let footprintSection = '';
        if (fp && fp.active.length > 0) {
          const topFp = fp.active.slice(0, 6).map(fNode =>
            `$${f(fNode.price)}[Buy:${fNode.buyVol}|Sell:${fNode.sellVol}|Delta:${fNode.delta > 0 ? '+' : ''}${fNode.delta}${fNode.isPoc ? '|★POC' : ''}${fNode.isImbalance ? '|⚠️IMB' : ''}]`
          );
          footprintSection = `\nLIVE 1-MIN FOOTPRINT PROFILE: ${topFp.join(' ')}` +
            `\nACTIVE LIMIT ABSORPTION: ${fp.absorption.type} (Price: $${f(fp.absorption.price)}, Volume: ${fp.absorption.strength.toFixed(1)})`;
        }

        orderbookContext = `LIVE ORDER BOOK (${snap.symbol} from ${snap.sources.join('+')}, 6 exchanges): Mid=$${f(snap.midPrice)} | Bids: ${topBids.join(' ')} | Asks: ${topAsks.join(' ')} | Pressure: ${mf.bidPct}% BUY / ${mf.askPct}% SELL | CVD: ${mf.cvd > 0 ? '+' : ''}${mf.cvd} | Bias: ${mf.bias.toUpperCase()}${snap.whaleWalls.length ? ` | Whale Walls: ${snap.whaleWalls.map(w => `${w.side === 'bid' ? '🟢' : '🔴'}$${f(w.price)}`).join(' ')}` : ''}${clusterSection}${footprintSection}`;
      } catch (e) { console.warn('Orderbook ctx error:', e.message); }
    }


    // 3. Fetch real-time news via Tavily (non-blocking, cached 10 min)
    let newsContext = null;
    if (pair) {
      try {
        newsContext = await fetchAssetNews(pair);
      } catch (e) {
        console.warn('News fetch error:', e.message);
      }
    }

    console.log(`Analyzing via ${process.env.AI_PROVIDER || 'gemini'}${orderbookContext ? ' +orderbook' : ''}${indicatorContext ? ' +indicators' : ''}${newsContext ? ' +news' : ''}...`);
    const result = await analyzeChart(lastChartBuffer, lastChartMime, pair, timeframe, hints, orderbookContext, indicatorContext, newsContext);
    
    // Register setup into autonomous monitor database if it has entry levels
    if (result && result.entry && result.entry.price > 0) {
      // Ensure id, instrument, and timeframe are attached for tracker
      result.id = result.id || Date.now().toString();
      result.instrument = result.instrument || pair || 'unknown';
      result.timeframe = result.timeframe || timeframe || 'unknown';
      registerTradeSetup(result);
    }

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

    if (pair) {
      try {
        aggregator.setSymbol(pair);
      } catch (e) {
        console.warn('Failed to sync aggregator symbol for second opinion:', e.message);
      }
    }

    let indicatorContext = null;
    if (pair) {
      try {
        const ind = await getLiveIndicators(pair, timeframe || '1h');
        if (ind.available) {
          const mtfSection = ind.mtfScore
            ? `\nMULTI-TIMEFRAME BIAS (EMA200): ${ind.mtfDetails} | MTF Score: ${ind.mtfScore}`
            : '';
          const arisSection = ind.arisContext
            ? `\n\n${ind.arisContext}`
            : '';
          indicatorContext = `LIVE TECHNICAL INDICATORS (${pair} ${timeframe || '1h'}): Current Price=$${ind.currentPrice} | EMA20=$${ind.ema20} | EMA50=$${ind.ema50} | EMA200=$${ind.ema200} | POC (Point of Control)=$${ind.poc} | RSI(14)=${ind.rsi} | MACD: Hist=${ind.macd?.histogram}, MACD=${ind.macd?.MACD}, Sig=${ind.macd?.signal} | ADX: Val=${ind.adx?.adx}, DI+=${ind.adx?.pdi}, DI-=${ind.adx?.mdi}${mtfSection}${arisSection}`;
        }
      } catch (e) {
        console.warn('Indicators fetch error for 2nd opinion:', e.message);
      }
    }

    console.log(`Getting second opinion for ${pair || 'unknown'}...`);
    const result = await getSecondOpinion(buffer, mime, originalResult, pair, timeframe, indicatorContext);
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
// SCANNER — manual trigger + active signals
// ─────────────────────────────────────────────
app.get('/api/signals', (req, res) => {
  try {
    const signals = getActiveSignals();
    res.json({ signals });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/scanner/status — returns scan state (isScanning, lastScanAt, circuitBreaker, etc.)
app.get('/api/scanner/status', (req, res) => {
  res.json(getScanState());
});

// POST /api/scanner/run — manually triggers a full scan
app.post('/api/scanner/run', async (req, res) => {
  try {
    res.json({ status: 'started', message: 'Scan started. Poll /api/scanner/status for progress.' });
    triggerManualScan().catch(e => serverLog.error({ err: e.message }, 'Manual scan error'));
  } catch (e) {
    res.status(409).json({ error: e.message });
  }
});

// POST /api/scanner/reset — manually resets the circuit breaker
app.post('/api/scanner/reset', (req, res) => {
  resetCircuitBreaker();
  const state = getCircuitBreakerState();
  serverLog.warn({ resetAt: state.resetAt }, 'Circuit breaker reset by user via API');
  res.json({ ok: true, message: 'Circuit breaker reset. Scanning is now unlocked.', state });
});

// ─────────────────────────────────────────────
// TRACKER HISTORY — trades from SQLite
// ─────────────────────────────────────────────
app.get('/api/history', (req, res) => {
  try {
    const history = getAllTrades();
    res.json({ history });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// LESSONS — AI post-mortem lessons from SQLite
// ─────────────────────────────────────────────
app.get('/api/lessons', (req, res) => {
  try {
    const lessons = getAllLessons();
    res.json({ lessons });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// ANALYTICS — live forward-test statistics
// ─────────────────────────────────────────────
app.get('/api/analytics', (req, res) => {
  try {
    const stats = computeAnalytics();
    res.json(stats);
  } catch (e) {
    serverLog.error({ err: e.message }, 'Analytics computation failed');
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// HEATMAP — instant snapshot (for AI context)
// ─────────────────────────────────────────────
app.get('/api/heatmap-snapshot', (req, res) => {
  if (!aggregator.running || aggregator.midPrice === 0) return res.json({ available: false });
  try { res.json({ available: true, ...aggregator.getSnapshot() }); }
  catch (e) { res.json({ available: false, error: e.message }); }
});

// ── Capital Flow Map (asset-class rotation via Twelve Data) ──
app.get('/api/capital-flow', async (req, res) => {
  try {
    // force=1 (manual Refresh button) bypasses cache and hits Twelve Data;
    // otherwise a fresh cache is served without spending credits.
    const flow = await getCapitalFlow(req.query.force === '1');
    res.json(flow);
  } catch (e) {
    res.json({ available: false, error: e.message });
  }
});

// ── AI Coach (free-form chat grounded in the analyzer's own data) ──
import { chatWithAI } from './chat.js';
app.post('/api/chat', async (req, res) => {
  try {
    const { message, history } = req.body || {};
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'message is required' });
    }
    const reply = await chatWithAI(message.trim(), Array.isArray(history) ? history : []);
    res.json({ reply });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ─────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  const cb = getCircuitBreakerState();
  res.json({
    status:         'ok',
    provider:       process.env.AI_PROVIDER || 'gemini',
    env:            process.env.NODE_ENV || 'development',
    accountEquity:  ACCOUNT_EQUITY,
    circuitBreaker: cb
  });
});

// [1D] /test-api is a debug endpoint — hidden in production
// It exposes your model list via your live API key.
if (process.env.NODE_ENV !== 'production') {
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
}

// ── Early Signal Finder (new low-cap coins + AI thesis) ──
import { getEarlySignals } from './earlySignal.js';
app.get('/api/early-signals', async (req, res) => {
  try {
    // force=1 (manual Refresh) bypasses cache and rescans with AI thesis;
    // otherwise cached results are served without spending Claude tokens.
    const signals = await getEarlySignals(req.query.force === '1');
    res.json(signals);
  } catch (e) {
    res.status(500).json({ available: false, error: e.message });
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
  serverLog.info({ port, provider: process.env.AI_PROVIDER || 'gemini' }, '🚀 Server started');

  // Migrate legacy JSON data to SQLite (runs once, skipped if DB already has data)
  migrateFromJSON();

  // Start autonomous post-trade tracking and learning loop
  startTracker();

  // Initialise scanner (loads signal count from DB)
  startScanner();
});

