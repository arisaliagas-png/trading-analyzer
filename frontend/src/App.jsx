import React, { useState, useEffect, useRef } from 'react';
import ChartTab from './ChartTab.jsx';

const ASSETS_LIST = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
  'ADAUSDT', 'LINKUSDT', 'DOGEUSDT', 'AVAXUSDT', 'DOTUSDT', 'LTCUSDT',
  'SUIUSDT', 'SEIUSDT', 'NEARUSDT', 'FETUSDT', 'HBARUSDT'
];

const TRANSLATIONS = {
  el: {
    title: "🧙 Αναλυτής Αγοράς AI",
    subtitle: "Ανέβασε γράφημα συναλλαγής και λάβε άμεσα ένα ολοκληρωμένο πλάνο με AI",
    analyzer: "📊 Ανάλυση",
    history: "🕐 Ιστορικό",
    heatmap: "🌡️ Ζωντανό Heatmap",
    capital: "💰 Capital Flow",
    scanner: "🔍 Scanner",
    analytics: "📊 Στατιστικά",
    coach: "💬 AI Coach",
    early: "🔎 Early Signals",
    analyticsTitle: "📊 Στατιστικά Απόδοσης Συστήματος ARIS",
    winRate: "Ποσοστό Επιτυχίας",
    expectancy: "Προσδοκώμενο Κέρδος",
    circuitBreaker: "Διακόπτης Ασφαλείας",
    tripped: "ΕΝΕΡΓΟΠΟΙΗΘΗΚΕ (Κλειδωμένο)",
    operational: "ΣΕ ΛΕΙΤΟΥΡΓΙΑ",
    consecutiveLosses: "Σερί Αποτυχιών",
    resetBreaker: "Επαναφορά Διακόπτη",
    positionSize: "Υπολογισμός Θέσης",
    riskReward: "Ρίσκο/Απόδοση (R:R)",
    theoreticalRR: "Θεωρητικό R:R (Μ.Ο.)",
    realizedRR: "Πραγματικό R:R (Μ.Ο.)",
    directionStats: "Απόδοση ανά Κατεύθυνση",
    uploadDrag: "Σύρε γράφημα εδώ",
    uploadOr: "ή κλικ για επιλογή αρχείου",
    uploadLoaded: "✓ Γράφημα Φορτώθηκε",
    uploadReplace: "Κλικ εδώ για αντικατάσταση",
    uploadHints: "Εστίαση Δεικτών (Προαιρετικό)",
    uploadHintsPlaceholder: "π.χ. απόκλιση RSI, διπλό κατώτατο",
    uploadEmpty: "Ανέβασε γράφημα αριστερά για προεπισκόπηση",
    timeframeLabel: "Χρονικό Πλαίσιο (Αυτόματο αν επιλεγεί Auto)",
    timeframeAuto: "🤖 Αυτόματο — Ο AI το διαβάζει από το γράφημα",
    tvImport: "🔗 Εισαγωγή από TradingView",
    tvPlaceholder: "Επικόλλησε link στιγμιοτύπου (Κοινοποίηση → Αντιγραφή link εικόνας)",
    tvFetch: "Λήψη Γραφήματος",
    tvFetching: "Φόρτωση...",
    tvError: "Χρησιμοποίησε το TradingView \"Κοινοποίηση → Αντιγραφή link εικόνας γραφήματος\" για να λάβεις URL τύπου /x/.",
    btnAnalyze: "Εκτέλεση Ανάλυσης AI",
    btnAnalyzing: "Ανάλυση Γραφήματος...",
    btnSecondOpinion: "🔍 Δεύτερη Γνώμη (Αντίθετη Άποψη)",
    btnGettingOpinion: "Λήψη Δεύτερης Γνώμης...",
    methodology: "Εφαρμόστηκε",
    strengthScore: "Βαθμός Ισχύος",
    methodologyRationale: "Αιτιολόγηση Μεθοδολογίας:",
    entryTrigger: "Σημείο Εισόδου",
    stopLoss: "Stop Loss (SL)",
    takeProfit: "Στόχος Κέρδους (TP1)",
    secondaryTargets: "Δευτερεύοντες Στόχοι:",
    detectedPatterns: "Ανιχνευμένα Μοτίβα & Δείκτες:",
    aiReasoning: "Αιτιολόγηση AI:",
    loadingMsg: "Εκτέλεση Μηχανής Ανάλυσης...",
    loadingSubMsg: "Εντοπισμός επιπέδων, order blocks και κυματικών δομών",
    soConfirmed: "ΕΠΙΒΕΒΑΙΩΘΗΚΕ",
    soRejected: "ΑΠΟΡΡΙΦΘΗΚΕ",
    soCaution: "ΠΡΟΣΟΧΗ",
    soChallengePoints: "⚡ Σημεία Αμφισβήτησης:",
    soAlternative: "Εναλλακτικό Σενάριο:",
    soConfidence: "Αξιοπιστία",
    historyTitle: "Ιστορικό Αναλύσεων",
    clearAll: "🗑 Εκκαθάριση Όλων",
    noHistory: "Δεν υπάρχουν αποθηκευμένες αναλύσεις. Κάνε την πρώτη σου!",
    goAnalyzer: "Πήγαινε στην Ανάλυση",
    strength: "ισχύς",
    symbol: "Ζεύγος",
    apply: "Εφαρμογή",
    live: "Ζωντανό",
    connecting: "Σύνδεση...",
    bidsLegend: "■ Αγοραστές (Bid walls)",
    asksLegend: "■ Πωλητές (Ask walls)",
    midPriceLegend: "— Μέση τιμή",
    whaleLegend: "🐳 Φάλαινα (>5× μέσος όρος)",
    sources: "Πηγές:",
    midPrice: "Μέση Τιμή",
    topBidWall: "Κορυφαίο Bid Wall",
    topAskWall: "Κορυφαίο Ask Wall",
    spread: "Spread",
    bids: "Αγοραστές",
    asks: "Πωλητές",
    price: "Τιμή",
    volume: "Όγκος",
    intensity: "Ένταση",
    whaleWalls: "🐳 Εντοπίστηκαν Φάλαινες",
    setup: "σετάπ",
    capitalDescription: "Πού ρέει το χρήμα ανά asset class (1d % change μέσω Twelve Data). Πράσινο = εισροή, Κόκκινο = εκροή.",
    capitalRefresh: "🔄 Ανανέωση",
    coachDescription: "Κάνε ερωτήσεις για crypto, συγκεκριμένα coins και την αγορά — με βάση τα δικά σου scanner signals, capital flow και μαθήματα. (Πάντα στα Ελληνικά.)",
    coachEmpty: "Ρώτα π.χ. «Τι βλέπεις για το BTC τώρα;» ή «Πώς διαβάζεις την τρέχουσα ροή κεφαλαίου;»",
    coachPlaceholder: "Ρώτα κάτι για την αγορά…",
    coachYou: "Εσύ",
    coachThinking: "⌛ σκέφτομαι…",
    coachSend: "➤ Στείλε",
    earlyDescription: "Νέα / low-cap coins με όγκο + AI thesis (μόνο για έρευνα, όχι σύσταση).",
    earlyEmpty: "Πάτα «Ανανέωση» για να σκανάρει νέα coins.",
    resetBreakerSuccess: "Ο Διακόπτης Ασφαλείας επαναφέρθηκε επιτυχώς!",
    hardVetoFallback: "A strategic rule vetoed this setup.",
    errorPrefix: "⚠️ Σφάλμα:",
    capitalEmpty: "Πάτα \"Ανανέωση\" για να φορτώσεις τη ροή κεφαλαίων.",
    capitalNA: "δεν υποστηρίζεται (free tier)",
    breakerDesc: "Απενεργοποιεί αυτόματα το scanner μετά από 3 συνεχόμενες αποτυχίες για προστασία κεφαλαίου.",
    analyticsSubtitle: "Στατιστικά στοιχεία ζωντανής παρακολούθησης και επικύρωσης",
    leaderboardTitle: "Τα Ρεκόρ μου",
    leaderboardDesc: "Τα δικά σου ρεκόρ από το ιστορικό — όχι άλλοι χρήστες, μόνο εσύ.",
    currentWinStreak: "Τρέχουσα σειρά νικών",
    bestWinStreak: "Καλύτερη σειρά νικών",
    worstLossStreak: "Χειρότερη σειρά ηττών",
    bestRTrade: "Καλύτερο R",
    worstRTrade: "Χειρότερο R",
    totalR: "Συνολικό R",
    noCandidates: "Δεν βρέθηκαν candidates με τα φίλτρα (low-cap + volume spike).",
    refresh: "🔄 Ανανέωση",
    loading: "Φόρτωση…",
  },
  en: {
    title: "🧙 AI Market Analyzer",
    subtitle: "Upload trade chart and get a complete trade plan instantly from AI",
    analyzer: "📊 Analyzer",
    history: "🕐 History",
    heatmap: "🌡️ Live Heatmap",
    capital: "💰 Capital Flow",
    scanner: "🔍 Scanner",
    analytics: "📊 Analytics",
    coach: "💬 AI Coach",
    early: "🔎 Early Signals",
    analyticsTitle: "📊 ARIS System Performance Analytics",
    winRate: "Win Rate",
    expectancy: "Expectancy",
    circuitBreaker: "Circuit Breaker",
    tripped: "TRIPPED (Locked)",
    operational: "OPERATIONAL",
    consecutiveLosses: "Consecutive Losses",
    resetBreaker: "Reset Breaker",
    positionSize: "Position Size",
    riskReward: "Risk/Reward (R:R)",
    theoreticalRR: "Theoretical R:R (Avg)",
    realizedRR: "Realized R:R (Avg)",
    directionStats: "Performance by Direction",
    uploadDrag: "Drag chart here",
    uploadOr: "or click to select file",
    uploadLoaded: "✓ Chart Loaded",
    uploadReplace: "Click here to replace",
    uploadHints: "Indicator Focus (Optional)",
    uploadHintsPlaceholder: "e.g. RSI divergence, double bottom",
    uploadEmpty: "Upload chart on the left for preview",
    timeframeLabel: "Timeframe (Auto if Auto selected)",
    timeframeAuto: "🤖 Auto — AI reads it from chart",
    tvImport: "🔗 Import from TradingView",
    tvPlaceholder: "Paste snapshot link (Share → Copy link to chart image)",
    tvFetch: "Fetch Chart",
    tvFetching: "Loading...",
    tvError: "Use TradingView 'Share -> Copy link to chart image' to get URL like /x/.",
    btnAnalyze: "Run AI Analysis",
    btnAnalyzing: "Analyzing Chart...",
    btnSecondOpinion: "🔍 Get Second Opinion (Devil's Advocate)",
    btnGettingOpinion: "Getting Second Opinion...",
    methodology: "Applied",
    strengthScore: "Strength Score",
    methodologyRationale: "Methodology Rationale:",
    entryTrigger: "Entry Trigger",
    stopLoss: "Stop Loss (SL)",
    takeProfit: "Target Profit (TP1)",
    secondaryTargets: "Secondary Targets:",
    detectedPatterns: "Detected Patterns & Indicators:",
    aiReasoning: "AI Reasoning:",
    loadingMsg: "Executing Analysis Engine...",
    loadingSubMsg: "Detecting levels, order blocks, and wave structures",
    soConfirmed: "CONFIRMED",
    soRejected: "REJECTED",
    soCaution: "CAUTION",
    soChallengePoints: "⚡ Challenge Points:",
    soAlternative: "Alternative Scenario:",
    soConfidence: "Confidence",
    historyTitle: "Analysis History",
    clearAll: "🗑 Clear All",
    noHistory: "No saved analyses. Create your first one!",
    goAnalyzer: "Go to Analyzer",
    strength: "strength",
    symbol: "Pair",
    apply: "Apply",
    live: "Live",
    connecting: "Connecting...",
    bidsLegend: "■ Bids (Bid walls)",
    asksLegend: "■ Asks (Ask walls)",
    midPriceLegend: "— Mid Price",
    whaleLegend: "🐳 Whale (>5x avg)",
    sources: "Sources:",
    midPrice: "Mid Price",
    topBidWall: "Top Bid Wall",
    topAskWall: "Top Ask Wall",
    spread: "Spread",
    bids: "Bids",
    asks: "Asks",
    price: "Price",
    volume: "Volume",
    intensity: "Intensity",
    whaleWalls: "🐳 Whale Walls Detected",
    setup: "setup",
    capitalDescription: "Where smart money flows across asset classes (1d % change via Twelve Data). Green = inflow, Red = outflow.",
    capitalRefresh: "🔄 Refresh",
    coachDescription: "Ask questions about crypto, specific coins and the market — based on your scanner signals, capital flow and lessons. (Always in Greek.)",
    coachEmpty: "Ask e.g. 'What do you see for BTC now?' or 'How do you read current capital flow?'",
    coachPlaceholder: "Ask something about the market...",
    coachYou: "You",
    coachThinking: "⌛ thinking...",
    coachSend: "➤ Send",
    earlyDescription: "New / low-cap coins with volume + AI thesis (research only, no financial advice).",
    earlyEmpty: "Click 'Refresh' to scan new coins.",
    resetBreakerSuccess: "Circuit Breaker successfully reset!",
    hardVetoFallback: "A strategic rule vetoed this setup.",
    errorPrefix: "⚠️ Error:",
    capitalEmpty: "Click 'Refresh' to load capital flows.",
    capitalNA: "not supported (free tier)",
    breakerDesc: "Automatically disables the scanner after 3 consecutive losses to protect capital.",
    analyticsSubtitle: "Live tracking and validation statistics",
    leaderboardTitle: "My Records",
    leaderboardDesc: "Your own records from history — no other users, just you.",
    currentWinStreak: "Current Win Streak",
    bestWinStreak: "Best Win Streak",
    worstLossStreak: "Worst Loss Streak",
    bestRTrade: "Best R Trade",
    worstRTrade: "Worst R Trade",
    totalR: "Total R",
    noCandidates: "No candidates found with filters (low-cap + volume spike).",
    refresh: "🔄 Refresh",
    loading: "Loading...",
  }
};

// Relative base so it works both locally (vite proxies /api -> :5000) and on
// the deployed host (same origin serves both UI and API). Hardcoding :5000
// breaks on Fly because the proxy exposes the API on the default HTTPS port.
const API_BASE = '';

// All backend timestamps are stored/returned in UTC. We display them in Greek
// local time (Europe/Athens = UTC+2 EET / UTC+3 EEST) so the user sees their
// actual local time instead of UTC.
const TZ = 'Europe/Athens';
function fmtUTC(iso, opts = {}) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleString('el-GR', { timeZone: TZ, hour12: false, ...opts });
}
const fmtUTCDate = (iso) => fmtUTC(iso, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtUTCTime = (iso) => fmtUTC(iso, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export default function App() {
  const [e, setE] = useState(() => localStorage.getItem('trading_analyzer_lang') || 'el');
  const [l, setL] = useState('analyzer');
  const [a, setA] = useState('');
  const [c, setC] = useState('BTCUSDT');
  const [N, setN] = useState('1h');
  const [m, setM] = useState(null);
  const [E, setEUrl] = useState(null);
  const [q, setQ] = useState(false);
  const [d, setD] = useState(false);
  const [j, setJ] = useState('');
  const [g, setGResult] = useState(null);
  const [z, setZ] = useState('');
  const [B, setB] = useState(false);
  const [stUrl, setStUrl] = useState('');
  const [tl, setTl] = useState(false);
  const [Rn, setRn] = useState(false);
  const [L, setLSoErr] = useState('');
  const [I, setIResult] = useState(null);

  const [G, setGHistory] = useState(() => {
    try {
      const stored = localStorage.getItem('trading_analyzer_history');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const [rt, setRt] = useState(null);
  const [ft, setFt] = useState('ALL');
  const [rl, setRl] = useState('BTCUSDT');
  const [U, setUHeatmap] = useState(null);
  const [Ha, setHaConnected] = useState(false);
  const [dn, setDnSignals] = useState([]);
  const [liquidity, setLiquidity] = useState(null);
  const [liquidityLoading, setLiquidityLoading] = useState(false);
  const alertedIds = useRef(new Set());
  const [Ga, setGaLastScan] = useState(null);
  const [Bt, setBtScannerState] = useState({ isScanning: false, lastScanAt: null });
  const [Ka, setKaElapsed] = useState(0);
  const [D, setDAnalytics] = useState(null);
  const [ba, setBaLoading] = useState(false);
  const [lt, setLtCapital] = useState(null);
  const [ks, setKsLoading] = useState(false);
  const [Es, setEsMessages] = useState([]);
  const [Ts, setTsInput] = useState('');
  const [cr, setCrChatting] = useState(false);
  const [st, setStEarly] = useState(null);
  const [livePrices, setLivePrices] = useState({});
  const [livePricesTs, setLivePricesTs] = useState(0);
  const [sl, setSlLoading] = useState(false);
  const [execPage, setExecPage] = useState(0);
  const EXEC_PER_PAGE = 15;

  const fileInputRef = useRef(null);
  const canvasRef = useRef(null);
  const heatmapCanvasRef = useRef(null);
  const heatmapHistoryRef = useRef([]);

  const t = TRANSLATIONS[e] || TRANSLATIONS.el;

  const toggleLanguage = () => {
    const nextLang = e === 'el' ? 'en' : 'el';
    setE(nextLang);
    localStorage.setItem('trading_analyzer_lang', nextLang);
  };

  const playAlert = () => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const playTone = (freq, duration, delay) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.15, ctx.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + duration);
        osc.start(ctx.currentTime + delay);
        osc.stop(ctx.currentTime + delay + duration);
      };
      playTone(880, 0.15, 0);
      playTone(660, 0.15, 0.1);
      setTimeout(() => {
        playTone(1100, 0.15, 0);
        playTone(880, 0.15, 0.1);
      }, 250);
    } catch (err) {
      console.warn('Audio error:', err);
    }
  };

  useEffect(() => {
    localStorage.setItem('trading_analyzer_history', JSON.stringify(G));
  }, [G]);

  const loadHistory = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/history`);
      if (res.ok) {
        const data = await res.json();
        if (data.history) {
          setGHistory(data.history);
        }
      }
    } catch (err) {
      console.warn('Failed to load history from backend:', err);
    }
  };

  // Manual win-review trigger (HYBRID mode — saves AI credits)
  const [winReviewLoading, setWinReviewLoading] = useState(null); // trade id being reviewed
  const triggerWinReview = async (id) => {
    setWinReviewLoading(id);
    try {
      const res = await fetch(`${API_BASE}/api/trades/${id}/win-review`, { method: 'POST' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed');
      alert('✅ Win review started — lesson will appear in Lessons tab shortly.');
      await loadHistory();
    } catch (e) {
      alert('Win review error: ' + e.message);
    } finally {
      setWinReviewLoading(null);
    }
  };

  // Live prices for ACTIVE trades — poll Binance ticker every 5s so PnL updates in real time
  const loadLivePrices = async () => {
    try {
      const active = (G || []).filter(t => t.status === 'ACTIVE' || t.status === 'PENDING');
      const symbols = [...new Set(active.map(t => (t.instrument || '').toUpperCase()).filter(Boolean))];
      if (symbols.length === 0) { setLivePrices({}); return; }
      const res = await fetch(`${API_BASE}/api/prices?symbols=${symbols.join(',')}`);
      if (res.ok) {
        const data = await res.json();
        if (data.prices) {
          setLivePrices(data.prices);
          setLivePricesTs(data.ts || Date.now());
        }
      }
    } catch (err) {
      console.warn('Failed to load live prices:', err);
    }
  };

  const loadSignals = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/signals`);
      if (res.ok) {
        const data = await res.json();
        if (data.signals) {
          const newIds = data.signals.filter(s => (s.is_new === 1 || s.isNew)).map(s => s.id);
          const unseen = newIds.filter(id => !alertedIds.current.has(id));
          if (unseen.length) {
            unseen.forEach(id => alertedIds.current.add(id));
            playAlert();
          }
          setDnSignals(data.signals);
        }
      }
    } catch (err) {
      console.warn('Failed to fetch signals:', err);
    }
  };

  const loadScannerStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/scanner/status`);
      if (res.ok) {
        const data = await res.json();
        setBtScannerState(data);
      }
    } catch (err) {
      console.warn('Failed to get scanner status:', err);
    }
  };

  useEffect(() => {
    loadHistory();
    loadSignals();
    loadScannerStatus();
    loadLivePrices();

    const historyInterval = setInterval(loadHistory, 30000);
    const signalInterval = setInterval(loadSignals, 5000);
    const scannerInterval = setInterval(loadScannerStatus, 2000);
    const pricesInterval = setInterval(loadLivePrices, 5000);

    return () => {
      clearInterval(historyInterval);
      clearInterval(signalInterval);
      clearInterval(scannerInterval);
      clearInterval(pricesInterval);
    };
  }, []);

  const handleDrag = (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.type === 'dragenter' || ev.type === 'dragover') setQ(true);
    else if (ev.type === 'dragleave') setQ(false);
  };

  const handleDrop = (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    setQ(false);
    if (ev.dataTransfer.files && ev.dataTransfer.files[0]) {
      const file = ev.dataTransfer.files[0];
      setM(file);
      setEUrl(URL.createObjectURL(file));
      setGResult(null);
      setIResult(null);
    }
  };

  const handleFileSelect = (ev) => {
    if (ev.target.files && ev.target.files[0]) {
      const file = ev.target.files[0];
      setM(file);
      setEUrl(URL.createObjectURL(file));
      setGResult(null);
      setIResult(null);
    }
  };

  const fetchTVChart = async () => {
    if (!z) return;
    // Validate the TradingView /x/ link format client-side so the user gets
    // an immediate, clear error instead of a silent no-op or backend 400.
    const tvCode = z.match(/tradingview\.com\/x\/([a-zA-Z0-9]+)/i);
    if (!tvCode) {
      setStUrl('⚠️ Βάλε ολόκληρο το TradingView link (π.χ. https://www.tradingview.com/x/KngcZe9M/). Το link πρέπει να περιέχει τον κωδικό μετά το /x/.');
      setB(false);
      return;
    }
    setB(true);
    setStUrl('');
    try {
      const res = await fetch(`${API_BASE}/api/fetch-tradingview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: z })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch TV chart.');
      
      // data.image is a base64 data: URL — parse it directly into a File (no fetch, which fails on data: URLs in browsers)
      const dataUrl = data.image;
      const mimeMatch = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      let file;
      if (mimeMatch) {
        const mime = mimeMatch[1];
        const bin = atob(mimeMatch[2]);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        file = new File([arr], 'chart.png', { type: mime });
      } else {
        // Fallback: try fetching if it's a real URL
        const blobRes = await fetch(dataUrl);
        const blob = await blobRes.blob();
        file = new File([blob], 'chart.png', { type: data.mimeType || 'image/png' });
      }
      setM(file);
      setEUrl(dataUrl);
      setGResult(null);
      setIResult(null);
    } catch (err) {
      setStUrl(err.message);
    } finally {
      setB(false);
    }
  };

  const runAnalysis = async () => {
    if (!m) return;
    setD(true);
    setJ('');
    setGResult(null);
    setIResult(null);

    const fdObj = new FormData();
    fdObj.append('chart', m);
    fdObj.append('pair', c);
    fdObj.append('timeframe', N);
    fdObj.append('hints', a);

    try {
      const res = await fetch(`${API_BASE}/api/analyze`, {
        method: 'POST',
        body: fdObj
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Analysis failed.');
      setGResult(data);
      
      // Update local history
      const newCard = {
        id: data.id || Date.now().toString(),
        instrument: c,
        timeframe: N,
        bias: data.bias,
        direction: data.bias,
        status: data.setupStatus || 'PENDING',
        entry: data.entry,
        sl: data.sl,
        targets: data.targets || [],
        created_at: new Date().toISOString(),
        reasoning: data.reasoning,
        confidenceGrade: data.confidenceGrade,
        confidencePct: data.confidencePct,
        methodology: data.methodology || 'ARIS_SMC',
        chartDataUrl: E
      };
      setGHistory(prev => [newCard, ...prev.slice(0, 49)]);
    } catch (err) {
      setJ(err.message);
    } finally {
      setD(false);
    }
  };

  const runSecondOpinion = async () => {
    if (!g) return;
    setRn(true);
    setLSoErr('');
    setIResult(null);

    const fdObj = new FormData();
    if (m) fdObj.append('chart', m);
    fdObj.append('originalResult', JSON.stringify(g));
    fdObj.append('pair', c);
    fdObj.append('timeframe', N);

    try {
      const res = await fetch(`${API_BASE}/api/second-opinion`, {
        method: 'POST',
        body: fdObj
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to get second opinion.');
      setIResult(data);
    } catch (err) {
      setLSoErr(err.message);
    } finally {
      setRn(false);
    }
  };

  // Canvas Drawing for Levels overlay
  useEffect(() => {
    if (!canvasRef.current || !E) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);

      // Only draw level overlays if analysis result (g) is present
      if (!g) return;
      const sl = g.sl;
      const entry = g.entry;
      const targets = g.targets || [];
      const overlay = g.overlay || {};

      const priceMin = overlay.priceMin;
      const priceMax = overlay.priceMax;

      if (priceMin != null && priceMax != null) {
        const getValY = (price) => {
          const pct = (price - priceMin) / (priceMax - priceMin);
          return canvas.height * (1 - pct);
        };

        const drawLine = (y, color, txt, dotted = false) => {
          ctx.beginPath();
          ctx.strokeStyle = color;
          ctx.lineWidth = 4;
          if (dotted) ctx.setLineDash([8, 8]);
          else ctx.setLineDash([]);
          ctx.moveTo(0, y);
          ctx.lineTo(canvas.width, y);
          ctx.stroke();

          ctx.font = 'bold 20px Sora, sans-serif';
          ctx.fillStyle = color;
          ctx.fillText(txt, 20, y - 8);
        };

        if (sl != null) drawLine(getValY(sl), '#ef4444', `SL: $${sl.toFixed(4)}`, true);

        if (entry != null) {
          if (typeof entry === 'object' && entry.low != null && entry.high != null) {
            const yLow = getValY(entry.low);
            const yHigh = getValY(entry.high);
            ctx.fillStyle = 'rgba(34, 211, 238, 0.15)';
            ctx.fillRect(0, Math.min(yLow, yHigh), canvas.width, Math.abs(yLow - yHigh));
            drawLine(getValY(entry.price || entry.low), '#22d3ee', `ENTRY: $${(entry.price || entry.low).toFixed(4)}`);
          } else if (typeof entry === 'number') {
            drawLine(getValY(entry), '#22d3ee', `ENTRY: $${entry.toFixed(4)}`);
          }
        }

        targets.forEach((tg, idx) => {
          drawLine(getValY(tg), '#10b981', `TP${idx + 1}: $${tg.toFixed(4)}`);
        });
      }
    };
    img.src = E;
  }, [E, g]);

  // Heatmap Stream & Drawing
  const toggleHeatmap = async (sym) => {
    try {
      setHaConnected(false);
      heatmapHistoryRef.current = [];
      
      await fetch(`${API_BASE}/api/heatmap/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: sym })
      });

      if (window.heatmapSse) window.heatmapSse.close();
      const sse = new EventSource(`${API_BASE}/api/heatmap-stream?symbol=${sym}`);
      window.heatmapSse = sse;

      sse.onmessage = (event) => {
        try {
          const snapshot = JSON.parse(event.data);
          setUHeatmap(snapshot);
          setHaConnected(true);

          // Accumulate history for visualization
          heatmapHistoryRef.current.push({
            midPrice: snapshot.midPrice,
            bids: snapshot.bids || [],
            asks: snapshot.asks || [],
            timestamp: Date.now()
          });
          if (heatmapHistoryRef.current.length > 150) {
            heatmapHistoryRef.current.shift();
          }
        } catch (e) {
          // ignore
        }
      };

      sse.onerror = () => {
        setHaConnected(false);
      };
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (l === 'heatmap') {
      toggleHeatmap(rl);
    } else {
      if (window.heatmapSse) {
        window.heatmapSse.close();
        window.heatmapSse = null;
      }
    }
  }, [l]);

  // Fetch real-time live flow & depth map (Liquidity Map 2.0)
  const fetchLiquidity = async (sym = rl, showLoading = false) => {
    if (showLoading) setLiquidityLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/live-flow?symbol=${sym}`);
      if (r.ok) {
        const d = await r.json();
        setLiquidity(d);
      }
    } catch (e) {
      console.warn('Live flow fetch error:', e);
    } finally {
      if (showLoading) setLiquidityLoading(false);
    }
  };

  useEffect(() => {
    if (l !== 'liquidity') return;
    fetchLiquidity(rl, true);
    const timer = setInterval(() => {
      fetchLiquidity(rl, false);
    }, 4000);
    return () => clearInterval(timer);
  }, [l, rl]);

  // Render heatmap canvas
  useEffect(() => {
    if (!heatmapCanvasRef.current || heatmapHistoryRef.current.length === 0) return;
    const canvas = heatmapCanvasRef.current;
    const ctx = canvas.getContext('2d');
    
    // Clear
    ctx.fillStyle = '#040a07';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const history = heatmapHistoryRef.current;
    const current = history[history.length - 1];
    
    // Find price boundaries across current depth profile
    const allPrices = [...current.bids, ...current.asks].map(o => o.price);
    if (allPrices.length === 0) return;
    
    const maxP = Math.max(...allPrices, current.midPrice) * 1.002;
    const minP = Math.min(...allPrices, current.midPrice) * 0.998;

    const getValY = (price) => {
      const pct = (price - minP) / (maxP - minP);
      return canvas.height * (1 - pct);
    };

    // Draw grid lines
    ctx.strokeStyle = 'rgba(16, 185, 129, 0.05)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 6; i++) {
      const y = (canvas.height / 6) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();

      const priceLabel = minP + (maxP - minP) * (1 - i / 6);
      ctx.fillStyle = 'rgba(148, 163, 184, 0.4)';
      ctx.font = '10px JetBrains Mono';
      ctx.fillText(`$${priceLabel.toFixed(2)}`, canvas.width - 70, y - 4);
    }

    // Draw Heatmap Columns (historical snapshot blocks)
    const colWidth = (canvas.width - 150) / 150;
    history.forEach((snap, idx) => {
      const x = idx * colWidth;
      
      // Draw bids (green intensity)
      snap.bids.forEach(b => {
        const y = getValY(b.price);
        const opacity = Math.min(b.intensity || 0.1, 1);
        ctx.fillStyle = `rgba(16, 185, 129, ${opacity * 0.45})`;
        ctx.fillRect(x, y - 2, colWidth + 1, 4);

        if (b.isWhale) {
          ctx.fillStyle = '#10b981';
          ctx.fillRect(x, y - 3, colWidth + 1, 6);
        }
      });

      // Draw asks (red intensity)
      snap.asks.forEach(a => {
        const y = getValY(a.price);
        const opacity = Math.min(a.intensity || 0.1, 1);
        ctx.fillStyle = `rgba(239, 68, 68, ${opacity * 0.45})`;
        ctx.fillRect(x, y - 2, colWidth + 1, 4);

        if (a.isWhale) {
          ctx.fillStyle = '#ef4444';
          ctx.fillRect(x, y - 3, colWidth + 1, 6);
        }
      });

      // Draw midPrice line segment
      if (idx > 0) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo((idx - 1) * colWidth, getValY(history[idx - 1].midPrice));
        ctx.lineTo(x, getValY(snap.midPrice));
        ctx.stroke();
      }
    });

    // Draw depth chart profile on the right panel (last 150px)
    const profileStart = canvas.width - 140;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(profileStart, 0, 140, canvas.height);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.beginPath();
    ctx.moveTo(profileStart, 0);
    ctx.lineTo(profileStart, canvas.height);
    ctx.stroke();

    // Volume Profile profile bars
    current.bids.forEach(b => {
      const y = getValY(b.price);
      const barLen = Math.min((b.qty / 500) * 120, 120);
      ctx.fillStyle = b.isWhale ? '#00ff96' : 'rgba(16, 185, 129, 0.3)';
      ctx.fillRect(profileStart, y - 3, barLen, 6);
      if (b.isWhale) {
        ctx.fillStyle = '#00ff96';
        ctx.font = '10px Sora';
        ctx.fillText('🐳', profileStart + barLen + 5, y + 4);
      }
    });

    current.asks.forEach(a => {
      const y = getValY(a.price);
      const barLen = Math.min((a.qty / 500) * 120, 120);
      ctx.fillStyle = a.isWhale ? '#ff3a3a' : 'rgba(239, 68, 68, 0.3)';
      ctx.fillRect(profileStart, y - 3, barLen, 6);
      if (a.isWhale) {
        ctx.fillStyle = '#ff3a3a';
        ctx.font = '10px Sora';
        ctx.fillText('🐳', profileStart + barLen + 5, y + 4);
      }
    });

    // Draw current midPrice label
    const midY = getValY(current.midPrice);
    ctx.strokeStyle = '#ffffff';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(canvas.width, midY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px JetBrains Mono';
    ctx.fillText(`Mid: $${current.midPrice.toFixed(2)}`, 10, midY - 6);

  }, [U]);

  // Load Capital Flow
  const fetchCapital = async (force = false) => {
    setKsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/capital-flow${force ? '?force=1' : ''}`);
      const data = await res.json();
      setLtCapital(data);
    } catch {
      // error handling
    } finally {
      setKsLoading(false);
    }
  };

  useEffect(() => {
    if (l === 'capital') fetchCapital();
  }, [l]);

  // Load Early Signals
  const fetchEarly = async (force = false) => {
    setSlLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/early-signals${force ? '?force=1' : ''}`);
      const data = await res.json();
      setStEarly(data);
    } catch {
      // error
    } finally {
      setSlLoading(false);
    }
  };

  useEffect(() => {
    if (l === 'early') fetchEarly();
  }, [l]);

  // Load System Analytics
  const fetchAnalytics = async () => {
    setBaLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/analytics`);
      const data = await res.json();
      setDAnalytics(data);
    } catch {
      // error
    } finally {
      setBaLoading(false);
    }
  };

  useEffect(() => {
    if (l === 'analytics') fetchAnalytics();
  }, [l]);

  const resetBreaker = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/scanner/reset`, { method: 'POST' });
      if (res.ok) {
        alert(t.resetBreakerSuccess);
        fetchAnalytics();
      }
    } catch (err) {
      alert(err.message);
    }
  };

  const triggerScan = async () => {
    try {
      setBtScannerState(s => ({ ...s, isScanning: true }));
      await fetch(`${API_BASE}/api/scanner/run`, { method: 'POST' });
      // Poll scanner status until the scan finishes (isScanning goes false),
      // then reload signals so new setups appear without manual refresh.
      const poll = setInterval(async () => {
        try {
          const res = await fetch(`${API_BASE}/api/scanner/status`);
          if (res.ok) {
            const data = await res.json();
            setBtScannerState(data);
            if (!data.isScanning) {
              clearInterval(poll);
              loadSignals();
              loadScannerStatus();
            }
          }
        } catch { /* ignore */ }
      }, 2000);
    } catch (err) {
      console.warn(err);
    }
  };

  // Coach Chat Submit
  const handleChatSend = async () => {
    if (!Ts.trim() || cr) return;
    const userMsg = { role: 'user', content: Ts };
    setEsMessages(prev => [...prev, userMsg]);
    setTsInput('');
    setCrChatting(true);

    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMsg.content,
          history: Es
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to chat');
      setEsMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
    } catch (err) {
      setEsMessages(prev => [...prev, { role: 'assistant', content: `${t.errorPrefix} ${err.message}` }]);
    } finally {
      setCrChatting(false);
    }
  };

  // History filtering counting helper
  const totalTradesCount = G.length;
  const winCount = G.filter(tCard => tCard.status === 'SUCCESS').length;
  const failCount = G.filter(tCard => tCard.status === 'FAILED').length;
  const activeCount = G.filter(tCard => tCard.status === 'ACTIVE').length;
  const partialCount = G.filter(tCard => tCard.status === 'PARTIAL').length;
  const pendingCount = G.filter(tCard => tCard.status === 'PENDING').length;
  const expiredCount = G.filter(tCard => tCard.status === 'EXPIRED').length;
  const computedWinRate = (winCount + failCount) > 0 ? ((winCount / (winCount + failCount)) * 100).toFixed(1) : '0';

  const filteredHistory = G.filter(tCard => {
    if (ft === 'ALL') return true;
    return tCard.status === ft;
  });

  return (
    <div className="app-container">
      <header>
        <h1>{t.title}</h1>
        <p>{t.subtitle}</p>
        <button onClick={toggleLanguage} className="lang-toggle">
          {e === 'el' ? '🇬🇧 English' : '🇬🇷 Ελληνικά'}
        </button>
      </header>

      {/* Navigation tabs */}
      <nav className="tab-nav">
        {[
          { id: 'analyzer', label: t.analyzer },
          { id: 'chart', label: '📈 Chart' },
          { id: 'history', label: `${t.history} (${totalTradesCount})` },
          { id: 'heatmap', label: t.heatmap },
          { id: 'capital', label: t.capital },
          { id: 'scanner', label: `${t.scanner} (${dn.length})` },
          { id: 'liquidity', label: '🗺️ Liquidity Map' },
          { id: 'analytics', label: t.analytics },
          { id: 'coach', label: t.coach },
          { id: 'early', label: t.early }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setL(tab.id)}
            className={`tab-btn ${l === tab.id ? 'active' : ''}`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Main Sections */}
      {l === 'analyzer' && (
        <div className="main-layout">
          <div className="panel">
            <div
              className={`upload-zone ${q ? 'drag-active' : ''} ${E ? 'loaded' : ''}`}
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current.click()}
            >
              <div className="upload-icon">📷</div>
              {E ? (
                <div>
                  <p style={{ color: '#10b981', fontWeight: 600 }}>{t.uploadLoaded}</p>
                  <p className="muted-sm">{t.uploadReplace}</p>
                </div>
              ) : (
                <div>
                  <p>{t.uploadDrag}</p>
                  <p className="muted-sm">{t.uploadOr}</p>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
            </div>

            {/* TradingView Snapshot Import */}
            <div className="tv-import-section">
              <button className="btn-tv-toggle" onClick={() => setTl(!tl)}>
                {t.tvImport}
              </button>
              {tl && (
                <div style={{ marginTop: '0.5rem' }}>
                  <div className="tv-input-row">
                    <input
                      type="text"
                      placeholder={t.tvPlaceholder}
                      value={z}
                      onChange={ev => setZ(ev.target.value)}
                    />
                    <button className="btn-tv-fetch" onClick={fetchTVChart} disabled={B}>
                      {B ? t.tvFetching : t.tvFetch}
                    </button>
                  </div>
                  {stUrl && <div className="error-box">{stUrl}</div>}
                </div>
              )}
            </div>

            <div className="form-group">
              <label>{t.symbol}</label>
              <input
                type="text"
                value={c}
                onChange={ev => setC(ev.target.value.toUpperCase())}
                placeholder="e.g. BTCUSDT"
              />
            </div>

            <div className="form-group">
              <label>{t.timeframeLabel}</label>
              <select value={N} onChange={ev => setN(ev.target.value)}>
                <option value="auto">{t.timeframeAuto}</option>
                {['1m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d', '3d', '1w'].map(tf => (
                  <option key={tf} value={tf}>{tf}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>{t.uploadHints}</label>
              <input
                type="text"
                value={a}
                onChange={ev => setA(ev.target.value)}
                placeholder={t.uploadHintsPlaceholder}
              />
            </div>

            <button className="btn-analyze" onClick={runAnalysis} disabled={d || !m}>
              {d ? (
                <div className="btn-loading">
                  <div className="spinner-sm"></div>
                  {t.btnAnalyzing}
                </div>
              ) : t.btnAnalyze}
            </button>

            {j && <div className="error-box">{j}</div>}
          </div>

          <div className="panel" style={{ minHeight: '400px' }}>
            {E ? (
              <div className="canvas-container">
                <canvas ref={canvasRef} />
              </div>
            ) : (
              <div className="empty-canvas-placeholder">{t.uploadEmpty}</div>
            )}

            {g && (
              <div className="result-section">
                <div className="result-header">
                  <div>
                    <span className="badge badge-smc">{g.methodology || 'ARIS SMC'}</span>
                    <h2 style={{ fontSize: '1.8rem', marginTop: '0.4rem' }}>{g.instrument}</h2>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className={`bias-tag ${g.bias?.toLowerCase() === 'long' ? 'bullish' : g.bias?.toLowerCase() === 'short' ? 'bearish' : 'neutral'}`}>
                      {g.bias}
                    </div>
                    <div className="score-display">
                      <span className="score-value">{g.megaScore || '0/31'}</span>
                      <div className="score-bar">
                        <div
                          className="score-fill"
                          style={{ width: `${(parseFloat(g.megaScore || '0') / 31) * 100}%` }}
                        ></div>
                      </div>
                    </div>
                  </div>
                </div>

                <p className="methodology-reason">{g.methodologyReason}</p>

                {g.hardVeto && (
                  <div className="error-box" style={{ background: '#ef44441f', borderColor: '#ef444455', color: '#f87171', marginBottom: '1rem' }}>
                    🛑 <strong>HARD VETO ACTIVE</strong> — {g.hardVetoReason || t.hardVetoFallback}
                  </div>
                )}

                <div className="levels-grid">
                  <div className="level-card entry">
                    <div className="card-title">{t.entryTrigger}</div>
                    <div className="level-value cyan">
                      ${typeof g.entry === 'object' ? g.entry.price : g.entry}
                    </div>
                  </div>
                  <div className="level-card sl">
                    <div className="card-title">{t.stopLoss}</div>
                    <div className="level-value red">${g.sl}</div>
                  </div>
                  <div className="level-card tp">
                    <div className="card-title">{t.takeProfit}</div>
                    <div className="level-value green">${g.targets?.[0]}</div>
                  </div>
                </div>

                {g.targets && g.targets.length > 1 && (
                  <div className="secondary-targets">
                    <span className="card-title">{t.secondaryTargets}</span>
                    {g.targets.slice(1).map((tg, idx) => (
                      <span key={idx} className="tp-badge">TP{idx + 2}: ${tg}</span>
                    ))}
                  </div>
                )}

                <div className="confluences-section">
                  <label>{t.detectedPatterns}</label>
                  <div className="confluences-list">
                    {(g.patterns || []).concat(g.indicators || []).map((pat, idx) => (
                      <span key={idx} className="confluence-item">{pat}</span>
                    ))}
                  </div>
                </div>

                <label>{t.aiReasoning}</label>
                <div className="reasoning-text">{g.reasoning}</div>

                <div style={{ marginTop: '1.5rem' }}>
                  <button className="btn-second-opinion" onClick={runSecondOpinion} disabled={Rn}>
                    {Rn ? t.btnGettingOpinion : t.btnSecondOpinion}
                  </button>
                  {L && <div className="error-box">{L}</div>}
                </div>

                {I && (
                  <div className="second-opinion-card" style={{ '--so-color': I.verdict === 'confirm' ? '#10b98144' : I.verdict === 'reject' ? '#ef444444' : '#f59e0b44' }}>
                    <div className="so-header">
                      <div className="so-icon">
                        {I.verdict === 'confirm' ? '✅' : I.verdict === 'reject' ? '🚨' : '⚠️'}
                      </div>
                      <div>
                        <div className="so-verdict" style={{ color: I.verdict === 'confirm' ? '#10b981' : I.verdict === 'reject' ? '#ef4444' : '#f59e0b' }}>
                          {I.verdict === 'confirm' ? t.soConfirmed : I.verdict === 'reject' ? t.soRejected : t.soCaution}
                        </div>
                        <div className="so-reason">{I.verdictReason}</div>
                      </div>
                      <div className="so-confidence">
                        <div className="card-title">{t.soConfidence}</div>
                        <div style={{ fontWeight: 800, color: '#e2e8f0' }}>{I.confidence}%</div>
                      </div>
                    </div>

                    <div className="so-risks">
                      <div className="detail-label">{t.soChallengePoints}</div>
                      <ul className="so-risk-list">
                        {(I.challengePoints || []).map((pt, idx) => (
                          <li key={idx}>{pt}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="so-details">
                      <div className="detail-label">{t.soAlternative}</div>
                      <div className="detail-value" style={{ fontStyle: 'italic' }}>{I.alternativeScenario}</div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {l === 'history' && (
        <div>
          {/* Tracker stats boxes with click to filter handlers */}
          <div className="tracker-stats-bar" style={{ cursor: 'pointer' }}>
            <div className="tracker-stat-box" onClick={() => setFt('ALL')} style={{ borderBottom: ft === 'ALL' ? '3px solid #10b981' : '' }}>
              <span className="stat-label">Total Trades</span>
              <span className="stat-value">{totalTradesCount}</span>
            </div>
            <div className="tracker-stat-box" onClick={() => setFt('ALL')} style={{ borderBottom: ft === 'ALL' ? '3px solid #10b981' : '' }}>
              <span className="stat-label">{t.winRate}</span>
              <span className="stat-value">{computedWinRate}%</span>
            </div>
            <div className="tracker-stat-box" onClick={() => setFt('SUCCESS')} style={{ borderBottom: ft === 'SUCCESS' ? '3px solid #10b981' : '' }}>
              <span className="stat-label">Success (TP)</span>
              <span className="stat-value" style={{ color: '#10b981' }}>{winCount}</span>
            </div>
            <div className="tracker-stat-box" onClick={() => setFt('FAILED')} style={{ borderBottom: ft === 'FAILED' ? '3px solid #ef4444' : '' }}>
              <span className="stat-label">Failed (SL)</span>
              <span className="stat-value" style={{ color: '#ef4444' }}>{failCount}</span>
            </div>
            <div className="tracker-stat-box" onClick={() => setFt('ACTIVE')} style={{ borderBottom: ft === 'ACTIVE' ? '3px solid #06b6d4' : '' }}>
              <span className="stat-label">Active</span>
              <span className="stat-value" style={{ color: '#06b6d4' }}>{activeCount}</span>
            </div>
            <div className="tracker-stat-box" onClick={() => setFt('PENDING')} style={{ borderBottom: ft === 'PENDING' ? '3px solid #fbbf24' : '' }}>
              <span className="stat-label">Pending</span>
              <span className="stat-value" style={{ color: '#fbbf24' }}>{pendingCount}</span>
            </div>
          </div>

          <div className="history-header">
            <h2>{t.historyTitle}</h2>
            <button className="btn-clear" onClick={() => setGHistory([])}>
              {t.clearAll}
            </button>
          </div>

          {/* Filter Pills */}
          <div className="history-filter-bar">
            {[
              { id: 'ALL', label: 'ALL', count: totalTradesCount, color: '#e2e8f0' },
              { id: 'SUCCESS', label: 'SUCCESS', count: winCount, color: '#10b981' },
              { id: 'PARTIAL', label: 'PARTIAL', count: partialCount, color: '#8b5cf6' },
              { id: 'FAILED', label: 'FAILED', count: failCount, color: '#ef4444' },
              { id: 'ACTIVE', label: 'ACTIVE', count: activeCount, color: '#06b6d4' },
              { id: 'PENDING', label: 'PENDING', count: pendingCount, color: '#fbbf24' },
              { id: 'EXPIRED', label: 'EXPIRED', count: expiredCount, color: '#94a3b8' }
            ].map(pill => (
              <button
                key={pill.id}
                onClick={() => setFt(pill.id)}
                className={`history-filter-pill ${ft === pill.id ? 'active' : ''}`}
                style={{ '--pill-color': pill.color }}
              >
                <span className="pill-dot" style={{ backgroundColor: pill.color }}></span>
                <span className="pill-label">{pill.label}</span>
                <span className="pill-count">{pill.count}</span>
              </button>
            ))}
          </div>

          {filteredHistory.length === 0 ? (
            <div className="empty-state">
              <p>{t.noHistory}</p>
              <button className="btn-secondary" onClick={() => setL('analyzer')}>
                {t.goAnalyzer}
              </button>
            </div>
          ) : (
            <div className="history-grid">
              {filteredHistory.map(card => {
                const isExpanded = rt === card.id;
                const entryPrice = typeof card.entry === 'object' ? card.entry?.price : card.entry;
                const fP = (val) => {
                  if (val == null) return '—';
                  const n = Number(val);
                  if (isNaN(n)) return '—';
                  if (Math.abs(n) < 0.001) return n.toFixed(6);
                  if (Math.abs(n) < 1) return n.toFixed(4);
                  if (Math.abs(n) < 1000) return n.toFixed(3);
                  return n.toFixed(2);
                };

                // Prefer live Binance ticker price for ACTIVE/PENDING; fall back to historical snapshot
                const symKey = (card.instrument || '').toUpperCase();
                const livePx = livePrices[symKey];
                const lastPrice = (livePx != null && (card.status === 'ACTIVE' || card.status === 'PENDING'))
                  ? livePx
                  : (card.closePrice || (card.historyPrices?.length > 0 ? card.historyPrices[card.historyPrices.length - 1]?.price : null));
                const livePnL = (lastPrice && entryPrice && Number(entryPrice) > 0)
                  ? ((Number(lastPrice) - Number(entryPrice)) / Number(entryPrice)) * 100 * (card.direction === 'SHORT' ? -1 : 1)
                  : null;

                const liveRMultiple = (lastPrice && entryPrice && sl && Number(entryPrice) > 0 && Number(sl) > 0)
                  ? (card.direction === 'SHORT'
                    ? (Number(entryPrice) - Number(lastPrice)) / (Number(entryPrice) - Number(sl))
                    : (Number(lastPrice) - Number(entryPrice)) / (Number(entryPrice) - Number(sl)))
                  : null;

                const indicatorText = Array.isArray(card.indicators) && card.indicators.length > 0
                  ? card.indicators.join('\n')
                  : Array.isArray(card.indicatorSnapshot) && card.indicatorSnapshot.length > 0
                  ? card.indicatorSnapshot.join('\n')
                  : null;

                return (
                  <div
                    key={card.id}
                    className={`history-card-updated ${isExpanded ? 'expanded' : ''} ${
                      card.status === 'SUCCESS' ? 'success-border' :
                      card.status === 'FAILED' ? 'failed-border' :
                      card.status === 'PARTIAL' ? 'partial-border' :
                      card.status === 'ACTIVE' ? 'active-border' :
                      card.status === 'EXPIRED' ? 'expired-border' : 'pending-border'
                    }`}
                    onClick={() => setRt(isExpanded ? null : card.id)}
                  >
                    <div className="h-top-row">
                      <span className="h-symbol">
                        {card.instrument}
                        <span className="h-tf">{card.timeframe || '1h'}</span>
                        {card.isNew && <span className="h-new-badge">NEW</span>}
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        {card.createdAt && (
                          <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                            {fmtUTCDate(card.createdAt)}
                          </span>
                        )}
                        <span
                          className="h-status-badge"
                          style={{
                            backgroundColor: card.status === 'SUCCESS' ? '#10b981' : card.status === 'FAILED' ? '#ef4444' : card.status === 'PARTIAL' ? '#8b5cf6' : card.status === 'ACTIVE' ? '#06b6d4' : '#fbbf24'
                          }}
                        >
                          {card.status}
                        </span>
                      </span>
                    </div>

                    <div className="h-dir-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0.4rem 0 0.6rem 0' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                        <span className={`badge ${card.direction === 'LONG' ? 'dir-long' : card.direction === 'SHORT' ? 'dir-short' : ''}`}>
                          {card.direction === 'LONG' ? '▲ LONG' : card.direction === 'SHORT' ? '▼ SHORT' : card.direction || '—'}
                        </span>
                        {livePnL != null && (
                          <span style={{ color: livePnL >= 0 ? '#10b981' : '#ef4444', fontWeight: 700, fontSize: '0.88rem' }}>
                            {livePnL >= 0 ? '+' : ''}{livePnL.toFixed(2)}%
                          </span>
                        )}
                      </div>
                      {(() => {
                        const r = card.status === 'ACTIVE' ? liveRMultiple : card.rMultiple;
                        if (r == null) return <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>Grade: <strong style={{ color: '#a78bfa' }}>{card.confidenceGrade || card.grade || 'C'}</strong></span>;
                        return <span style={{ color: r >= 0 ? '#10b981' : '#ef4444', fontWeight: 700, fontSize: '0.88rem' }}>{r >= 0 ? '+' : ''}{r.toFixed(2)}R</span>;
                      })()}
                    </div>

                    <div className="h-levels-box">
                      <div className="h-level-row">
                        <span>Ideal Entry:</span>
                        <span style={{ color: '#06b6d4', fontWeight: 600 }}>${fP(entryPrice)}</span>
                      </div>
                      <div className="h-level-row">
                        <span>Stop Loss:</span>
                        <span style={{ color: '#ef4444', fontWeight: 600 }}>${fP(card.sl)}</span>
                      </div>
                      <div className="h-level-row">
                        <span>Targets:</span>
                        <span style={{ color: '#10b981', fontWeight: 600 }}>
                          TP1: ${fP(card.targets?.[0] || card.tp1)}
                          {card.targets?.[1] && ` | TP2: $${fP(card.targets[1])}`}
                        </span>
                      </div>
                      {lastPrice && (
                        <div className="h-level-row" style={{ marginTop: '0.2rem', paddingTop: '0.2rem', borderTop: '1px dashed #1e293b' }}>
                          <span style={{ color: '#94a3b8' }}>Last Ticker:</span>
                          <span style={{ fontWeight: 700, color: '#e2e8f0' }}>${fP(lastPrice)}</span>
                        </div>
                      )}
                    </div>

                    {isExpanded && (
                      <div className="h-details-expanded" style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #1e293b' }}>
                        {card.chartDataUrl && (
                          <img
                            src={card.chartDataUrl}
                            alt="Analysis screenshot"
                            style={{ width: '100%', borderRadius: '8px', objectFit: 'contain', maxHeight: '200px', marginBottom: '0.75rem' }}
                          />
                        )}

                        {card.reasoning && (
                          <div className="h-detail-section" style={{ marginBottom: '0.75rem' }}>
                            <span className="detail-label" style={{ color: '#fbbf24', fontWeight: 700, display: 'block', marginBottom: '0.25rem' }}>
                              💡 QUANTITATIVE SETUP REASON
                            </span>
                            <p className="detail-value" style={{ fontSize: '0.8rem', color: '#cbd5e1', lineHeight: 1.45, margin: 0 }}>
                              {card.reasoning}
                            </p>
                          </div>
                        )}

                        {card.rMultiple != null && (
                          <div className="h-detail-section" style={{ marginBottom: '0.75rem' }}>
                            <span className="detail-label" style={{ color: '#94a3b8', fontWeight: 600, display: 'block', marginBottom: '0.2rem' }}>
                              📐 R-MULTIPLE
                            </span>
                            <span style={{ color: card.rMultiple >= 0 ? '#10b981' : '#ef4444', fontWeight: 700, fontSize: '0.9rem' }}>
                              {card.rMultiple >= 0 ? '+' : ''}{card.rMultiple}R <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 400 }}>(risk-normalized)</span>
                            </span>
                          </div>
                        )}

                        {indicatorText && (
                          <div className="h-detail-section" style={{ marginBottom: '0.75rem' }}>
                            <span className="detail-label" style={{ color: '#94a3b8', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
                              📜 INDICATOR VALUES AT ENTRY
                            </span>
                            <pre style={{
                              background: '#090d13',
                              border: '1px solid #1e293b',
                              borderRadius: '6px',
                              padding: '0.6rem 0.75rem',
                              fontSize: '0.68rem',
                              color: '#94a3b8',
                              maxHeight: '140px',
                              overflowY: 'auto',
                              fontFamily: 'monospace',
                              whiteSpace: 'pre-wrap',
                              margin: 0
                            }}>
                              {indicatorText}
                            </pre>
                          </div>
                        )}

                        {card.lessonsLearned && (
                          <div className="lessons-alert" style={{ background: '#ef444410', border: '1px solid #ef444430', padding: '0.6rem 0.75rem', borderRadius: '6px', marginTop: '0.5rem' }}>
                            <span className="detail-label text-red" style={{ color: '#ef4444', fontWeight: 700, display: 'block', marginBottom: '0.2rem' }}>
                              🧬 Post-Mortem Lesson
                            </span>
                            <p className="detail-value" style={{ fontStyle: 'italic', fontSize: '0.8rem', color: '#cbd5e1', margin: 0 }}>
                              {card.lessonsLearned}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="h-expand-hint" style={{ textAlign: 'center', fontSize: '0.7rem', color: '#64748b', marginTop: '0.5rem', paddingTop: '0.3rem', borderTop: '1px solid #1e293b22' }}>
                      {isExpanded ? 'Click card to collapse' : 'Click card to view details & indicator values'}
                    {(card.status === 'SUCCESS' || card.status === 'PARTIAL') && (
                      <div style={{ marginTop: '0.5rem' }}>
                        <button
                          onClick={(e) => { e.stopPropagation(); triggerWinReview(card.id); }}
                          disabled={winReviewLoading === card.id}
                          style={{ width: '100%', padding: '0.45rem', borderRadius: '6px', border: '1px solid #10b98140', background: winReviewLoading === card.id ? '#10b98110' : '#10b98120', color: '#10b981', fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer' }}
                        >
                          {winReviewLoading === card.id ? '⏳ Analyzing…' : '🔍 Analyze Win (AI Lesson)'}
                        </button>
                      </div>
                    )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {l === 'heatmap' && (
        <div>
          <div className="heatmap-controls">
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
              <label>{t.symbol}</label>
              <input
                type="text"
                value={rl}
                onChange={ev => setRl(ev.target.value.toUpperCase())}
                placeholder="e.g. BTCUSDT"
              />
            </div>
            <button className="btn-heatmap-start" onClick={() => toggleHeatmap(rl)}>
              {t.apply}
            </button>
            <div className={`heatmap-status ${Ha ? 'connected' : 'disconnected'}`}>
              <span className="status-dot"></span>
              {Ha ? t.live : t.connecting}
            </div>
          </div>

          <div className="heatmap-legend">
            <span className="legend-item green-legend">{t.bidsLegend}</span>
            <span className="legend-item red-legend">{t.asksLegend}</span>
            <span className="legend-item white-legend">{t.midPriceLegend}</span>
            <span className="legend-item whale-legend">{t.whaleLegend}</span>
            <span className="legend-item" style={{ color: '#22d3ee' }}>〜 CVD</span>
            <span className="legend-item" style={{ color: '#7c8f88' }}>│ Vol Profile</span>
            {U?.sources && U.sources.length > 0 && (
              <span className="legend-item" style={{ marginLeft: 'auto', color: '#4b6057' }}>
                {t.sources} {U.sources.join(' · ')}
              </span>
            )}
          </div>

          <div className="heatmap-canvas-wrapper">
            <canvas ref={heatmapCanvasRef} width={1100} height={580} className="heatmap-canvas" />
          </div>

          {U && (
            <div>
              <div className="heatmap-stats">
                <div className="heatmap-stat">
                  <div className="card-title">{t.midPrice}</div>
                  <div className="stat-value cyan">${U.midPrice ? Number(U.midPrice).toFixed(2) : '0.00'}</div>
                </div>
                <div className="heatmap-stat">
                  <div className="card-title">{t.topBidWall}</div>
                  <div className="stat-value green">
                    ${U.bids?.[0]?.price ? Number(U.bids[0].price).toFixed(2) : '0.00'} <small>({U.bids?.[0]?.qty ? Number(U.bids[0].qty).toFixed(1) : '0.0'})</small>
                  </div>
                </div>
                <div className="heatmap-stat">
                  <div className="card-title">{t.topAskWall}</div>
                  <div className="stat-value red">
                    ${U.asks?.[0]?.price ? Number(U.asks[0].price).toFixed(2) : '0.00'} <small>({U.asks?.[0]?.qty ? Number(U.asks[0].qty).toFixed(1) : '0.0'})</small>
                  </div>
                </div>
                <div className="heatmap-stat">
                  <div className="card-title">{t.spread}</div>
                  <div className="stat-value">
                    ${((Number(U.asks?.[0]?.price) || 0) - (Number(U.bids?.[0]?.price) || 0)).toFixed(3)}
                  </div>
                </div>
              </div>

              {/* Order Pressure and Alerts */}
              {U.moneyFlow && (
                <div className="money-flow-panel">
                  <div className="mf-title">💹 Money Flow & Order Pressure</div>
                  <div className="mf-grid">
                    <div className="mf-card">
                      <div className="card-title">Order Pressure</div>
                      <div className="pressure-bar-wrap">
                        <div className="pressure-bar">
                          <div className="pressure-bid" style={{ width: `${U.moneyFlow.bidPct || 50}%` }} />
                          <div className="pressure-ask" style={{ width: `${U.moneyFlow.askPct || 50}%` }} />
                        </div>
                      </div>
                      <div className="pressure-labels">
                        <span className="green">{U.moneyFlow.bidPct}% Bids</span>
                        <span className="red">{U.moneyFlow.askPct}% Asks</span>
                      </div>
                      <div className={`mf-bias ${U.moneyFlow.bias === 'buy' ? 'green' : U.moneyFlow.bias === 'sell' ? 'red' : 'muted'}`}>
                        ● {U.moneyFlow.bias === 'buy' ? 'BUY DOMINANT' : U.moneyFlow.bias === 'sell' ? 'SELL DOMINANT' : 'NEUTRAL'}
                      </div>
                    </div>

                    <div className="mf-card">
                      <div className="card-title">Cumulative Volume Delta</div>
                      <div className="cvd-value" style={{ color: U.moneyFlow.cvd > 0 ? '#10b981' : U.moneyFlow.cvd < 0 ? '#ef4444' : '#cbd5e1' }}>
                        {U.moneyFlow.cvd > 0 ? '+' : ''}{U.moneyFlow.cvd?.toFixed(1)}
                      </div>
                      <div className="card-title" style={{ marginTop: '0.5rem' }}>Net+ Limits</div>
                      <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                        {U.moneyFlow.netPressure > 0 ? '🟢 Net Inflow' : U.moneyFlow.netPressure < 0 ? '🔴 Net Outflow' : '⚪ Neutral'}
                      </div>
                    </div>

                    {/* Volume Depth */}
                    <div className="mf-card">
                      <div className="card-title">Volume Depth</div>
                      <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.4rem', marginBottom: '0.6rem' }}>
                        <div>
                          <div style={{ fontSize: '0.7rem', color: '#64748b' }}>Bid Liquidity</div>
                          <div style={{ fontWeight: 700, color: '#10b981', fontSize: '1.05rem' }}>
                            {U.bids ? U.bids.reduce((s, b) => s + (Number(b.qty) || 0), 0).toFixed(1) : '0.0'}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: '0.7rem', color: '#64748b' }}>Ask Liquidity</div>
                          <div style={{ fontWeight: 700, color: '#ef4444', fontSize: '1.05rem' }}>
                            {U.asks ? U.asks.reduce((s, a) => s + (Number(a.qty) || 0), 0).toFixed(1) : '0.0'}
                          </div>
                        </div>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Bid/Ask Ratio</div>
                      <div style={{ fontWeight: 700, color: '#e2e8f0', fontSize: '0.95rem' }}>
                        {U.bids && U.asks && U.asks.reduce((s, a) => s + (Number(a.qty) || 0), 0) > 0
                          ? (U.bids.reduce((s, b) => s + (Number(b.qty) || 0), 0) / U.asks.reduce((s, a) => s + (Number(a.qty) || 0), 0)).toFixed(2)
                          : '—'}
                      </div>
                    </div>
                  </div>

                  {U.moneyFlow.imbalances && U.moneyFlow.imbalances.length > 0 && (
                    <div className="imbalance-row">
                      <span className="detail-label">Active Imbalances:</span>
                      {U.moneyFlow.imbalances.map((imb, idx) => (
                        <span key={idx} className={`imbalance-tag ${imb.side === 'bid' ? 'green-tag' : 'red-tag'}`}>
                          {imb.side === 'bid' ? 'BUY' : 'SELL'} ${imb.price ? Number(imb.price).toFixed(2) : '0.00'} ({imb.qty}x)
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Smart Money alerts */}
              {U.smartMoneyAlerts && U.smartMoneyAlerts.length > 0 && (
                <div className="panel" style={{ marginBottom: '1.5rem' }}>
                  <div className="whale-title">🔔 Smart Money Alerts</div>
                  <div className="whale-grid">
                    {U.smartMoneyAlerts.map((alrt, idx) => (
                      <div key={idx} className={`whale-card ${alrt.side === 'bid' ? 'bid' : 'ask'}`}>
                        <div className="whale-side">{alrt.side === 'bid' ? 'LIMIT BUY' : 'LIMIT SELL'}</div>
                        <div className="whale-price">${alrt.price ? Number(alrt.price).toFixed(2) : '0.00'}</div>
                        <div className="whale-qty">{alrt.qty ? Number(alrt.qty).toFixed(1) : '0.0'} units</div>
                        <div style={{ fontSize: '0.65rem', color: '#a78bfa', marginTop: '0.2rem' }}>{alrt.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Whale Walls Detected */}
              {U.stableWhaleWalls && U.stableWhaleWalls.length > 0 && (
                <div style={{ background: '#0d1117', border: '1px solid #1e293b', borderRadius: '8px', padding: '1rem', marginBottom: '1rem' }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#fbbf24', marginBottom: '0.75rem' }}>🐳 Whale Walls Detected</div>
                  <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                    {U.stableWhaleWalls.map((w, idx) => (
                      <div key={idx} style={{
                        display: 'flex', flexDirection: 'column', gap: '0.15rem',
                        padding: '0.5rem 0.75rem', borderRadius: '6px', minWidth: '120px',
                        background: w.side === 'bid' ? '#10b98110' : '#ef444410',
                        border: `1px solid ${w.side === 'bid' ? '#10b98130' : '#ef444430'}`
                      }}>
                        <div style={{ fontSize: '0.65rem', color: w.side === 'bid' ? '#10b981' : '#ef4444', fontWeight: 700 }}>
                          {w.side === 'bid' ? '● BID' : '● ASK'} Wall
                        </div>
                        <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#e2e8f0' }}>
                          ${w.price ? Number(w.price).toFixed(2) : '0.00'}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                          {w.qty ? Number(w.qty).toFixed(1) : '0.0'} units
                        </div>
                        {w.hits && (
                          <div style={{ fontSize: '0.65rem', color: '#94a3b8' }}>hits: {w.hits}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Liquidity Clusters */}
              {U.liquidityClusters && (
                <div className="clusters-section">
                  <div className="whale-title">🏦 Smart Money Liquidity Clusters (bin: ${U.liquidityClusters.binSize})</div>
                  <div className="clusters-grid">
                    <div className="cluster-col">
                      <div className="cluster-col-title green">Support Clusters</div>
                      {U.liquidityClusters.bids?.map((clst, idx) => (
                        <div key={idx} className={`cluster-row bid-cluster ${clst.isWhale ? 'mega-wall' : ''}`}>
                          <span className="cluster-price">
                            ${clst.price ? Number(clst.price).toFixed(2) : '0.00'} {clst.isWhale && <span className="mega-badge mega-bid">MEGA</span>}
                          </span>
                          <span className="cluster-vol">{clst.qty ? Number(clst.qty).toFixed(1) : '0.0'}</span>
                          <span className="cluster-dist">{clst.distancePct ? Number(clst.distancePct).toFixed(2) : '0.00'}%</span>
                          <div className="cluster-bar-bg">
                            <div className="cluster-bar-fill green-fill" style={{ width: `${Math.min((clst.qty / U.liquidityClusters.minVol) * 33, 100)}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="cluster-col">
                      <div className="cluster-col-title red">Resistance Clusters</div>
                      {U.liquidityClusters.asks?.map((clst, idx) => (
                        <div key={idx} className={`cluster-row ask-cluster ${clst.isWhale ? 'mega-wall' : ''}`}>
                          <span className="cluster-price">
                            ${clst.price ? Number(clst.price).toFixed(2) : '0.00'} {clst.isWhale && <span className="mega-badge">MEGA</span>}
                          </span>
                          <span className="cluster-vol">{clst.qty ? Number(clst.qty).toFixed(1) : '0.0'}</span>
                          <span className="cluster-dist">+{clst.distancePct ? Math.abs(Number(clst.distancePct)).toFixed(2) : '0.00'}%</span>
                          <div className="cluster-bar-bg">
                            <div className="cluster-bar-fill red-fill" style={{ width: `${Math.min((clst.qty / U.liquidityClusters.minVol) * 33, 100)}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Footprint Profile */}
              {U.footprint && (
                <div className="footprint-section">
                  <div className="footprint-header">
                    <span className="footprint-title">⚡ Live Order Flow · 1-Min Footprint</span>
                    <span className="footprint-meta">POC: ${U.footprint.poc ? Number(U.footprint.poc).toFixed(2) : '0.00'}</span>
                    <span className={`absorption-badge ${U.footprint.absorption?.type === 'BUY_ABSORPTION' ? 'buy-absorption' : U.footprint.absorption?.type === 'SELL_ABSORPTION' ? 'sell-absorption' : 'none'}`}>
                      {U.footprint.absorption?.type === 'BUY_ABSORPTION' ? '🟢 BUY ABSORPTION' : U.footprint.absorption?.type === 'SELL_ABSORPTION' ? '🔴 SELL ABSORPTION' : '⚪ NO ACTIVE ABSORPTION'}
                    </span>
                    {U.footprint.absorption?.price && (
                      <span style={{ fontSize: '0.75rem', color: '#e2e8f0', marginLeft: '0.5rem' }}>
                        @ ${Number(U.footprint.absorption.price).toFixed(2)}
                      </span>
                    )}
                  </div>

                  <div className="footprint-candle">
                    {U.footprint.active?.map((fpNode, idx) => (
                      <div key={idx} className={`fp-row ${fpNode.isPoc ? 'fp-poc' : ''}`}>
                        <span className="fp-price">${fpNode.price ? Number(fpNode.price).toFixed(2) : '0.00'}</span>
                        <div className="fp-bar-wrap">
                          <div className="fp-bar buy" style={{ width: `${(fpNode.buyVol / (fpNode.buyVol + fpNode.sellVol || 1)) * 100}%` }} />
                          <div className="fp-bar sell" style={{ width: `${(fpNode.sellVol / (fpNode.buyVol + fpNode.sellVol || 1)) * 100}%` }} />
                        </div>
                        <span className="fp-vol-label">{fpNode.buyVol}x{fpNode.sellVol}</span>
                        <span className={`fp-delta ${fpNode.delta > 0 ? 'pos' : 'neg'}`}>
                          {fpNode.delta > 0 ? '+' : ''}{fpNode.delta}
                        </span>
                        {fpNode.isPoc && <span className="fp-poc-tag">POC</span>}
                        {fpNode.isImbalance && <span className="fp-imb-tag">IMB</span>}
                      </div>
                    ))}
                  </div>

                  {/* Full BIDS / ASKS price table */}
                  {(U.bids?.length > 0 || U.asks?.length > 0) && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
                      <div>
                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#10b981', marginBottom: '0.5rem', paddingBottom: '0.3rem', borderBottom: '1px solid #10b98122' }}>
                          BIDS
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', fontSize: '0.7rem', color: '#64748b', marginBottom: '0.25rem', fontWeight: 600 }}>
                          <span>Price</span><span>Volume</span><span>Intensity</span>
                        </div>
                        {(U.bids || []).slice(0, 12).map((b, idx) => (
                          <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', fontSize: '0.72rem', padding: '0.1rem 0', borderBottom: '1px solid #0f172a', color: b.isWhale ? '#10b981' : '#94a3b8' }}>
                            <span style={{ fontWeight: b.isWhale ? 700 : 400 }}>${b.price ? Number(b.price).toFixed(2) : '0.00'}</span>
                            <span>{b.qty ? Number(b.qty).toFixed(1) : '0.0'}</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                              <div style={{ height: '4px', width: `${Math.min((b.intensity || 0) * 100, 100)}%`, background: '#10b981', borderRadius: '2px', minWidth: '4px' }} />
                            </div>
                          </div>
                        ))}
                      </div>
                      <div>
                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#ef4444', marginBottom: '0.5rem', paddingBottom: '0.3rem', borderBottom: '1px solid #ef444422' }}>
                          ASKS
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', fontSize: '0.7rem', color: '#64748b', marginBottom: '0.25rem', fontWeight: 600 }}>
                          <span>Price</span><span>Volume</span><span>Intensity</span>
                        </div>
                        {(U.asks || []).slice(0, 12).map((a, idx) => (
                          <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', fontSize: '0.72rem', padding: '0.1rem 0', borderBottom: '1px solid #0f172a', color: a.isWhale ? '#ef4444' : '#94a3b8' }}>
                            <span style={{ fontWeight: a.isWhale ? 700 : 400 }}>${a.price ? Number(a.price).toFixed(2) : '0.00'}</span>
                            <span>{a.qty ? Number(a.qty).toFixed(1) : '0.0'}</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                              <div style={{ height: '4px', width: `${Math.min((a.intensity || 0) * 100, 100)}%`, background: '#ef4444', borderRadius: '2px', minWidth: '4px' }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Trade Tape & Aggregate Ledger ─────────────────────────────── */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>

                {/* Time & Sales Tape */}
                <div style={{ background: '#0d1117', border: '1px solid #1e293b', borderRadius: '8px', padding: '1rem' }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#e2e8f0', marginBottom: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>📋 Time &amp; Sales</span>
                    <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 400 }}>live · last 50</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 70px 40px', fontSize: '0.68rem', color: '#475569', fontWeight: 600, paddingBottom: '0.4rem', borderBottom: '1px solid #1e293b', marginBottom: '0.3rem' }}>
                    <span>Time</span><span>Price</span><span style={{ textAlign: 'right' }}>Size</span><span style={{ textAlign: 'right' }}>Ex</span>
                  </div>
                  <div style={{ maxHeight: '320px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1px' }}>
                    {(U.recentTrades || []).map((tr, idx) => {
                      const isBuy = tr.side === 'buy';
                      const d = new Date(tr.t);
                      const ts = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
                      return (
                        <div key={idx} style={{ display: 'grid', gridTemplateColumns: '60px 1fr 70px 40px', fontSize: '0.72rem', padding: '0.15rem 0.2rem', borderRadius: '2px', background: isBuy ? 'rgba(16,185,129,0.05)' : 'rgba(239,68,68,0.05)' }}>
                          <span style={{ color: '#475569' }}>{ts}</span>
                          <span style={{ fontWeight: 600, color: isBuy ? '#10b981' : '#ef4444' }}>{isBuy ? '▲' : '▼'} ${Number(tr.p).toFixed(2)}</span>
                          <span style={{ textAlign: 'right', color: '#cbd5e1' }}>{Number(tr.q).toFixed(3)}</span>
                          <span style={{ textAlign: 'right', fontSize: '0.6rem', color: '#64748b', fontWeight: 600 }}>{tr.ex}</span>
                        </div>
                      );
                    })}
                    {(!U.recentTrades || U.recentTrades.length === 0) && (
                      <div style={{ color: '#475569', fontSize: '0.75rem', padding: '1rem', textAlign: 'center' }}>Αναμονή trades…</div>
                    )}
                  </div>
                </div>

                {/* Aggregate Ledger — 1-sec bars */}
                <div style={{ background: '#0d1117', border: '1px solid #1e293b', borderRadius: '8px', padding: '1rem' }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#e2e8f0', marginBottom: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>📊 Aggregate Ledger (1s)</span>
                    <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 400 }}>last 60s</span>
                  </div>
                  {(U.tradeLedger || []).length === 0 ? (
                    <div style={{ color: '#475569', fontSize: '0.75rem', padding: '1rem', textAlign: 'center' }}>Αναμονή δεδομένων…</div>
                  ) : (() => {
                    const ledger = U.tradeLedger || [];
                    const maxVol = ledger.reduce((m, b) => Math.max(m, b.buyVol + b.sellVol, 0.001), 0.001);
                    const totalBuy  = ledger.reduce((s, b) => s + b.buyVol, 0);
                    const totalSell = ledger.reduce((s, b) => s + b.sellVol, 0);
                    const netDelta  = totalBuy - totalSell;
                    return (
                      <div>
                        <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '0.75rem', fontSize: '0.78rem' }}>
                          <span style={{ color: '#10b981' }}>▲ Buy <strong>{totalBuy.toFixed(2)}</strong></span>
                          <span style={{ color: '#ef4444' }}>▼ Sell <strong>{totalSell.toFixed(2)}</strong></span>
                          <span style={{ color: netDelta >= 0 ? '#10b981' : '#ef4444', fontWeight: 700 }}>Δ {netDelta >= 0 ? '+' : ''}{netDelta.toFixed(2)}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '280px', overflowY: 'auto' }}>
                          {ledger.map((b, idx) => {
                            const total  = b.buyVol + b.sellVol || 0.001;
                            const buyPct = (b.buyVol / total) * 100;
                            const selPct = (b.sellVol / total) * 100;
                            const net    = b.buyVol - b.sellVol;
                            const barW   = Math.min((total / maxVol) * 100, 100);
                            const d      = new Date(b.t);
                            const ts     = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
                            return (
                              <div key={idx} style={{ display: 'grid', gridTemplateColumns: '52px 1fr 60px', alignItems: 'center', gap: '0.4rem' }}>
                                <span style={{ fontSize: '0.62rem', color: '#475569' }}>{ts}</span>
                                <div style={{ height: '10px', borderRadius: '3px', overflow: 'hidden', background: '#1e293b', width: `${barW}%`, minWidth: '8px' }}>
                                  <div style={{ display: 'flex', height: '100%' }}>
                                    <div style={{ width: `${buyPct}%`, background: '#10b981' }} />
                                    <div style={{ width: `${selPct}%`, background: '#ef4444' }} />
                                  </div>
                                </div>
                                <span style={{ fontSize: '0.65rem', textAlign: 'right', color: net >= 0 ? '#10b981' : '#ef4444', fontWeight: 600 }}>{net >= 0 ? '+' : ''}{net.toFixed(2)}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </div>

              </div>
            </div>
          )}
        </div>
      )}

      {l === 'liquidity' && (() => {
        const LIQ_ASSETS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'SUIUSDT', 'DOGEUSDT', 'ADAUSDT', 'LINKUSDT', 'AVAXUSDT'];
        const data = liquidity;
        const ticker = data?.ticker || {};
        const midP = data?.midPrice || ticker.price || 0;
        const mf = data?.moneyFlow || {};
        const whales = data?.whaleTrades || [];
        const ob = data?.orderBook || { bids: [], asks: [] };
        const dc = data?.depthChart || { bids: [], asks: [], maxCumulative: 1 };

        const fP = (p) => {
          if (!p || isNaN(p)) return '—';
          if (p >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          if (p >= 1) return p.toFixed(4);
          return p.toFixed(6);
        };
        const fQ = (q) => {
          if (!q || isNaN(q)) return '0';
          if (q >= 1000000) return (q / 1000000).toFixed(2) + 'M';
          if (q >= 1000) return (q / 1000).toFixed(1) + 'K';
          return q.toFixed(2);
        };
        const fD = (d) => {
          if (!d || isNaN(d)) return '$0';
          if (d >= 1000000) return `$${(d / 1000000).toFixed(2)}M`;
          if (d >= 1000) return `$${(d / 1000).toFixed(1)}K`;
          return `$${Math.round(d)}`;
        };
        const timeAgo = (t) => {
          if (!t) return '';
          const diff = Math.max(0, Math.floor((Date.now() - t) / 1000));
          if (diff < 60) return `${diff}s ago`;
          if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
          return `${Math.floor(diff / 3600)}h ago`;
        };

        // Depth Chart SVG path calculations
        const svgW = 620, svgH = 220;
        const midX = svgW / 2;
        const maxCum = Math.max(dc.maxCumulative, 1);
        const bids = dc.bids || [];
        const asks = dc.asks || [];

        // Bids path: from midX (y = 200) moving left to 20
        let bidAreaPath = `M ${midX} 200`;
        let bidStrokePath = '';
        if (bids.length > 0) {
          bids.forEach((b, idx) => {
            const x = midX - ((idx + 1) / bids.length) * (midX - 25);
            const y = 200 - (b.cumulative / maxCum) * 160;
            bidAreaPath += ` L ${x} ${y}`;
            bidStrokePath += (idx === 0 ? `M ${midX} 200 L ${x} ${y}` : ` L ${x} ${y}`);
          });
          const lastBidX = midX - (midX - 25);
          bidAreaPath += ` L ${lastBidX} 200 Z`;
        }

        // Asks path: from midX (y = 200) moving right to svgW - 20
        let askAreaPath = `M ${midX} 200`;
        let askStrokePath = '';
        if (asks.length > 0) {
          asks.forEach((a, idx) => {
            const x = midX + ((idx + 1) / asks.length) * (midX - 25);
            const y = 200 - (a.cumulative / maxCum) * 160;
            askAreaPath += ` L ${x} ${y}`;
            askStrokePath += (idx === 0 ? `M ${midX} 200 L ${x} ${y}` : ` L ${x} ${y}`);
          });
          const lastAskX = midX + (midX - 25);
          askAreaPath += ` L ${lastAskX} 200 Z`;
        }

        const isPositiveChange = (ticker.change24h || 0) >= 0;
        const isBullishCvd = (mf.cvd || 0) >= 0;

        return (
          <div className="liquidity-matrix-tab" style={{ padding: '0.5rem 0', maxWidth: '1440px', margin: '0 auto' }}>
            
            {/* 1. Header & Asset Selector Pills */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <span style={{ fontSize: '1.6rem' }}>⚡</span>
                  <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800, background: 'linear-gradient(135deg, #22d3ee, #10b981)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                    LIQUIDITY & ORDER FLOW MATRIX
                  </h2>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                    padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.72rem', fontWeight: 700,
                    background: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)'
                  }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px #10b981', animation: 'pulse 1.5s infinite' }} />
                    LIVE 4s STREAM
                  </span>
                </div>
                <p style={{ margin: '0.2rem 0 0', fontSize: '0.8rem', color: 'var(--color-muted)' }}>
                  Institutional Order Depth · Real-Time CVD Delta · Whale Activity Radar
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <button
                  onClick={() => fetchLiquidity(rl, true)}
                  disabled={liquidityLoading}
                  style={{
                    padding: '0.45rem 1rem', borderRadius: '8px', border: '1px solid rgba(34,211,238,0.3)',
                    background: 'rgba(34,211,238,0.1)', color: '#22d3ee', fontWeight: 700, fontSize: '0.82rem',
                    cursor: liquidityLoading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem',
                    transition: 'all 0.2s'
                  }}
                >
                  {liquidityLoading ? <span className="spinner-sm" /> : '🔄'} {liquidityLoading ? 'Συγχρονισμός…' : 'Ανανέωση'}
                </button>
              </div>
            </div>

            {/* Asset Selector Tabs */}
            <div style={{ display: 'flex', gap: '0.4rem', overflowX: 'auto', paddingBottom: '0.6rem', marginBottom: '1.2rem' }}>
              {LIQ_ASSETS.map((sym) => {
                const isSel = rl === sym;
                return (
                  <button
                    key={sym}
                    onClick={() => {
                      setRl(sym);
                      fetchLiquidity(sym, true);
                    }}
                    style={{
                      padding: '0.45rem 0.9rem', borderRadius: '20px', fontSize: '0.82rem', fontWeight: 700,
                      fontFamily: 'var(--mono)', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.2s',
                      background: isSel ? 'linear-gradient(135deg, rgba(34,211,238,0.25), rgba(16,185,129,0.2))' : 'rgba(255,255,255,0.04)',
                      color: isSel ? '#22d3ee' : 'var(--color-muted)',
                      border: isSel ? '1px solid rgba(34,211,238,0.5)' : '1px solid rgba(255,255,255,0.08)',
                      boxShadow: isSel ? '0 0 14px rgba(34,211,238,0.2)' : 'none'
                    }}
                  >
                    {sym.replace('USDT', '')}
                  </button>
                );
              })}
            </div>

            {/* 2. Cyber Ticker Banner */}
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem',
              background: 'rgba(8, 20, 28, 0.85)', border: '1px solid rgba(34,211,238,0.2)',
              borderRadius: '12px', padding: '1rem 1.25rem', marginBottom: '1.25rem',
              boxShadow: '0 8px 30px rgba(0,0,0,0.4)', backdropFilter: 'blur(12px)'
            }}>
              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {rl} Live Price
                </div>
                <div style={{ fontSize: '1.5rem', fontWeight: 800, fontFamily: 'var(--mono)', color: '#22d3ee', textShadow: '0 0 12px rgba(34,211,238,0.4)' }}>
                  ${fP(midP)}
                </div>
              </div>

              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  24h Change
                </div>
                <div style={{
                  fontSize: '1.2rem', fontWeight: 700, fontFamily: 'var(--mono)',
                  color: isPositiveChange ? '#10b981' : '#ef4444', display: 'flex', alignItems: 'center', gap: '0.3rem'
                }}>
                  {isPositiveChange ? '▲ +' : '▼ '}{(ticker.change24h || 0).toFixed(2)}%
                </div>
              </div>

              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  24h High / Low
                </div>
                <div style={{ fontSize: '0.92rem', fontWeight: 600, fontFamily: 'var(--mono)', color: '#cbd5e1' }}>
                  <span style={{ color: '#10b981' }}>${fP(ticker.high24h)}</span> / <span style={{ color: '#ef4444' }}>${fP(ticker.low24h)}</span>
                </div>
              </div>

              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  24h Volume (USDT)
                </div>
                <div style={{ fontSize: '1.05rem', fontWeight: 700, fontFamily: 'var(--mono)', color: '#e2e8f0' }}>
                  {fD(ticker.quoteVolume)}
                </div>
              </div>
            </div>

            {/* 3. Main Two-Column Cyber Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.35fr) minmax(0, 1fr)', gap: '1.25rem', alignItems: 'start' }}>
              
              {/* LEFT COLUMN: Depth Chart & Order Book Ladder */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                
                {/* SVG Mountain Depth Chart */}
                <div style={{
                  background: 'rgba(8, 20, 28, 0.85)', border: '1px solid rgba(16,185,129,0.2)',
                  borderRadius: '12px', padding: '1.25rem', position: 'relative', overflow: 'hidden'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      📈 Cumulative Mountain Depth
                    </h3>
                    <div style={{ display: 'flex', gap: '1rem', fontSize: '0.75rem', fontFamily: 'var(--mono)' }}>
                      <span style={{ color: '#10b981' }}>■ Bids (Support)</span>
                      <span style={{ color: '#ef4444' }}>■ Asks (Resistance)</span>
                    </div>
                  </div>

                  <div style={{ width: '100%', position: 'relative' }}>
                    <svg viewBox={`0 0 ${svgW} ${svgH}`} style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}>
                      <defs>
                        <linearGradient id="bidGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#10b981" stopOpacity="0.45" />
                          <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
                        </linearGradient>
                        <linearGradient id="askGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#ef4444" stopOpacity="0.45" />
                          <stop offset="100%" stopColor="#ef4444" stopOpacity="0.02" />
                        </linearGradient>
                      </defs>

                      {/* Grid lines */}
                      <line x1="20" y1="50" x2={svgW - 20} y2="50" stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />
                      <line x1="20" y1="120" x2={svgW - 20} y2="120" stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />
                      <line x1="20" y1="200" x2={svgW - 20} y2="200" stroke="rgba(255,255,255,0.1)" />

                      {/* Bid Mountain */}
                      {bidAreaPath && <path d={bidAreaPath} fill="url(#bidGrad)" />}
                      {bidStrokePath && <path d={bidStrokePath} fill="none" stroke="#10b981" strokeWidth="2.2" strokeLinecap="round" />}

                      {/* Ask Mountain */}
                      {askAreaPath && <path d={askAreaPath} fill="url(#askGrad)" />}
                      {askStrokePath && <path d={askStrokePath} fill="none" stroke="#ef4444" strokeWidth="2.2" strokeLinecap="round" />}

                      {/* Center Mid-Price Line */}
                      <line x1={midX} y1="20" x2={midX} y2="205" stroke="#22d3ee" strokeWidth="2" strokeDasharray="4 4" />
                      <circle cx={midX} cy="200" r="4" fill="#22d3ee" style={{ filter: 'drop-shadow(0 0 6px #22d3ee)' }} />

                      {/* Price Axis Labels */}
                      <text x="25" y="215" fill="#10b981" fontSize="10" fontFamily="monospace">
                        ${bids.length > 0 ? fP(bids[bids.length - 1].price) : ''}
                      </text>
                      <text x={midX} y="215" fill="#22d3ee" fontSize="11" fontWeight="bold" textAnchor="middle" fontFamily="monospace">
                        ${fP(midP)}
                      </text>
                      <text x={svgW - 25} y="215" fill="#ef4444" fontSize="10" textAnchor="end" fontFamily="monospace">
                        ${asks.length > 0 ? fP(asks[asks.length - 1].price) : ''}
                      </text>

                      {/* Max Cumulative Volume Tag */}
                      <text x="25" y="38" fill="rgba(255,255,255,0.4)" fontSize="9" fontFamily="monospace">
                        MAX DEPTH: {fQ(maxCum)} {rl.replace('USDT', '')}
                      </text>
                    </svg>
                  </div>
                </div>

                {/* Order Book Depth Ladder */}
                <div style={{
                  background: 'rgba(8, 20, 28, 0.85)', border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '12px', padding: '1.25rem'
                }}>
                  <h3 style={{ margin: '0 0 1rem', fontSize: '0.95rem', fontWeight: 700, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    🪜 Order Book Top Levels (Bids vs Asks)
                  </h3>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    
                    {/* Bids Ladder */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: '#10b981', fontWeight: 700, paddingBottom: '0.4rem', borderBottom: '1px solid rgba(16,185,129,0.2)' }}>
                        <span>PRICE</span>
                        <span>SIZE ({rl.replace('USDT','')})</span>
                        <span>USD</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginTop: '0.4rem' }}>
                        {ob.bids.slice(0, 10).map((b, idx) => (
                          <div
                            key={idx}
                            style={{
                              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                              padding: '0.22rem 0.4rem', borderRadius: '4px', fontSize: '0.78rem',
                              fontFamily: 'var(--mono)', position: 'relative', overflow: 'hidden',
                              background: b.isWall ? 'rgba(16,185,129,0.18)' : 'rgba(0,0,0,0.25)',
                              border: b.isWall ? '1px solid rgba(16,185,129,0.5)' : '1px solid transparent'
                            }}
                          >
                            <div style={{
                              position: 'absolute', right: 0, top: 0, bottom: 0,
                              width: `${b.pct}%`, background: 'rgba(16,185,129,0.18)', pointerEvents: 'none'
                            }} />
                            <span style={{ color: '#10b981', fontWeight: 700, zIndex: 1 }}>${fP(b.price)}</span>
                            <span style={{ color: '#cbd5e1', zIndex: 1 }}>{fQ(b.qty)}</span>
                            <span style={{ color: 'var(--color-muted)', fontSize: '0.72rem', zIndex: 1 }}>{fD(b.totalUsd)}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Asks Ladder */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: '#ef4444', fontWeight: 700, paddingBottom: '0.4rem', borderBottom: '1px solid rgba(239,68,68,0.2)' }}>
                        <span>PRICE</span>
                        <span>SIZE ({rl.replace('USDT','')})</span>
                        <span>USD</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginTop: '0.4rem' }}>
                        {ob.asks.slice(0, 10).map((a, idx) => (
                          <div
                            key={idx}
                            style={{
                              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                              padding: '0.22rem 0.4rem', borderRadius: '4px', fontSize: '0.78rem',
                              fontFamily: 'var(--mono)', position: 'relative', overflow: 'hidden',
                              background: a.isWall ? 'rgba(239,68,68,0.18)' : 'rgba(0,0,0,0.25)',
                              border: a.isWall ? '1px solid rgba(239,68,68,0.5)' : '1px solid transparent'
                            }}
                          >
                            <div style={{
                              position: 'absolute', left: 0, top: 0, bottom: 0,
                              width: `${a.pct}%`, background: 'rgba(239,68,68,0.18)', pointerEvents: 'none'
                            }} />
                            <span style={{ color: '#ef4444', fontWeight: 700, zIndex: 1 }}>${fP(a.price)}</span>
                            <span style={{ color: '#cbd5e1', zIndex: 1 }}>{fQ(a.qty)}</span>
                            <span style={{ color: 'var(--color-muted)', fontSize: '0.72rem', zIndex: 1 }}>{fD(a.totalUsd)}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                  </div>
                </div>

              </div>

              {/* RIGHT COLUMN: Money Flow Radar & Whale Alert Feed */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                
                {/* Money Flow Radar Cards */}
                <div style={{
                  background: 'rgba(8, 20, 28, 0.85)', border: '1px solid rgba(34,211,238,0.2)',
                  borderRadius: '12px', padding: '1.25rem', boxShadow: '0 8px 30px rgba(0,0,0,0.3)'
                }}>
                  <h3 style={{ margin: '0 0 1rem', fontSize: '0.95rem', fontWeight: 700, color: '#22d3ee', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    📡 Money Flow & Pressure Radar
                  </h3>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    
                    {/* Card 1: CVD Delta Arc & Metrics */}
                    <div style={{
                      background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.06)',
                      borderRadius: '8px', padding: '0.9rem 1rem'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                            CVD (Cumulative Volume Delta)
                          </div>
                          <div style={{
                            fontSize: '1.35rem', fontWeight: 800, fontFamily: 'var(--mono)',
                            color: isBullishCvd ? '#10b981' : '#ef4444', marginTop: '0.2rem'
                          }}>
                            {isBullishCvd ? '+' : ''}{fQ(mf.cvd)} {rl.replace('USDT', '')}
                          </div>
                        </div>

                        <div style={{
                          padding: '0.35rem 0.75rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 800,
                          background: isBullishCvd ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)',
                          color: isBullishCvd ? '#10b981' : '#ef4444',
                          border: isBullishCvd ? '1px solid rgba(16,185,129,0.4)' : '1px solid rgba(239,68,68,0.4)'
                        }}>
                          {isBullishCvd ? '🟢 BUY FLOW' : '🔴 SELL FLOW'}
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.6rem', paddingTop: '0.6rem', borderTop: '1px solid rgba(255,255,255,0.05)', fontSize: '0.75rem', fontFamily: 'var(--mono)' }}>
                        <span style={{ color: '#10b981' }}>Market Buys: {fD(mf.buyUsd)}</span>
                        <span style={{ color: '#ef4444' }}>Market Sells: {fD(mf.sellUsd)}</span>
                      </div>
                    </div>

                    {/* Card 2: Bid / Ask Ratio Bar */}
                    <div style={{
                      background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.06)',
                      borderRadius: '8px', padding: '0.9rem 1rem'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--color-muted)', marginBottom: '0.4rem' }}>
                        <span>BID / ASK PRESSURE</span>
                        <span style={{ fontWeight: 700, color: mf.bidRatio >= 50 ? '#10b981' : '#ef4444' }}>
                          {mf.bidRatio || 50}% Bids / {mf.askRatio || 50}% Asks
                        </span>
                      </div>

                      <div style={{ display: 'flex', height: '10px', borderRadius: '5px', overflow: 'hidden', background: '#000' }}>
                        <div style={{ width: `${mf.bidRatio || 50}%`, background: 'linear-gradient(90deg, #059669, #10b981)', transition: 'width 0.4s' }} />
                        <div style={{ width: `${mf.askRatio || 50}%`, background: 'linear-gradient(90deg, #dc2626, #ef4444)', transition: 'width 0.4s' }} />
                      </div>
                    </div>

                    {/* Card 3: Imbalance & Whales Count */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                      <div style={{
                        background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.06)',
                        borderRadius: '8px', padding: '0.8rem', textAlign: 'center'
                      }}>
                        <div style={{ fontSize: '0.68rem', color: 'var(--color-muted)', textTransform: 'uppercase' }}>Book Imbalance</div>
                        <div style={{
                          fontSize: '0.92rem', fontWeight: 800, marginTop: '0.25rem',
                          color: mf.imbalanceSide === 'BID' ? '#10b981' : '#ef4444'
                        }}>
                          +{mf.imbalancePct || 0}% {mf.imbalanceSide || 'NEUTRAL'}
                        </div>
                      </div>

                      <div style={{
                        background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.06)',
                        borderRadius: '8px', padding: '0.8rem', textAlign: 'center'
                      }}>
                        <div style={{ fontSize: '0.68rem', color: 'var(--color-muted)', textTransform: 'uppercase' }}>Whale Activity</div>
                        <div style={{ fontSize: '0.92rem', fontWeight: 800, color: '#a855f7', marginTop: '0.25rem' }}>
                          🐳 {mf.whaleCount || 0} Trades
                        </div>
                      </div>
                    </div>

                  </div>
                </div>

                {/* Whale Alert Feed */}
                <div style={{
                  background: 'rgba(8, 20, 28, 0.85)', border: '1px solid rgba(168,85,247,0.3)',
                  borderRadius: '12px', padding: '1.25rem', boxShadow: '0 8px 30px rgba(0,0,0,0.3)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.9rem' }}>
                    <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#c084fc', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      🐳 Real-Time Whale Alert Stream
                    </h3>
                    <span style={{ fontSize: '0.72rem', color: 'var(--color-muted)' }}>Orders ≥ $25K</span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', maxHeight: '320px', overflowY: 'auto', paddingRight: '4px' }}>
                    {whales.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--color-muted)', fontSize: '0.82rem' }}>
                        ⏳ Παρακολούθηση συναλλαγών… Αναμονή για μεγάλες institutional εντολές.
                      </div>
                    ) : (
                      whales.map((w, idx) => {
                        const isBuy = w.side === 'BUY';
                        return (
                          <div
                            key={w.id || idx}
                            style={{
                              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                              padding: '0.55rem 0.75rem', borderRadius: '6px', fontSize: '0.78rem',
                              fontFamily: 'var(--mono)', background: 'rgba(0,0,0,0.4)',
                              borderLeft: `3px solid ${isBuy ? '#10b981' : '#ef4444'}`,
                              borderTop: '1px solid rgba(255,255,255,0.04)',
                              borderRight: '1px solid rgba(255,255,255,0.04)',
                              borderBottom: '1px solid rgba(255,255,255,0.04)'
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <span>{isBuy ? '🟢' : '🔴'}</span>
                              <div>
                                <span style={{ fontWeight: 800, color: isBuy ? '#10b981' : '#ef4444' }}>
                                  {w.side} {fD(w.usdValue)}
                                </span>
                                <div style={{ fontSize: '0.68rem', color: 'var(--color-muted)' }}>
                                  {fQ(w.qty)} @ ${fP(w.price)}
                                </div>
                              </div>
                            </div>

                            <div style={{ textAlign: 'right' }}>
                              {w.isLargeWhale && (
                                <span style={{
                                  display: 'inline-block', fontSize: '0.62rem', fontWeight: 800,
                                  padding: '1px 5px', borderRadius: '3px', background: 'rgba(168,85,247,0.25)',
                                  color: '#c084fc', border: '1px solid rgba(168,85,247,0.4)', marginBottom: '2px'
                                }}>
                                  INSTITUTIONAL
                                </span>
                              )}
                              <div style={{ fontSize: '0.68rem', color: 'var(--color-muted)' }}>
                                {timeAgo(w.time)}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

              </div>

            </div>

          </div>
        );
      })()}

      {l === 'capital' && (
        <div className="capital-flow-tab" style={{ padding: '1rem 0' }}>
          <div className="analytics-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '1.5rem' }}>💰</span>
              <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: '#e2e8f0' }}>
                Capital Flow Map
              </h2>
            </div>
            <button 
              className="btn-tv-fetch" 
              onClick={() => fetchCapital(true)} 
              disabled={ks}
              style={{ background: '#10b98122', border: '1px solid #10b98144', color: '#10b981', padding: '0.5rem 1rem', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' }}
            >
              🔄 {t.capitalRefresh || 'Ανανέωση'}
            </button>
          </div>
          <p className="muted-sm" style={{ marginTop: '-1rem', marginBottom: '1.5rem', color: '#94a3b8' }}>
            {t.capitalDescription}
          </p>

          {!lt && !ks && <div className="cf-empty">{t.capitalEmpty}</div>}
          {ks && <div className="cf-empty">{t.loading}</div>}

          {lt && lt.classes && (
            <div>
              <div className="cf-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                {lt.classes.map((cls) => {
                  if (!cls.available) return null;
                  const isDown = cls.change1d < 0;
                  const isNeutral = cls.flow === 'NEUTRAL';
                  const flowColor = isNeutral ? '#fbbf24' : isDown ? '#ef4444' : '#10b981';
                  const flowSymbol = isNeutral ? '■' : isDown ? '▼' : '▲';
                  return (
                    <div
                      key={cls.key}
                      className="cf-card"
                      style={{ 
                        borderLeft: `4px solid ${flowColor}`,
                        padding: '1rem',
                        borderRadius: '8px',
                        backgroundColor: '#1e293b44',
                        border: '1px solid #1e293b',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.4rem'
                      }}
                    >
                      <div className="cf-label" style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        {cls.label}
                      </div>
                      <div className="cf-flow" style={{ color: flowColor, fontSize: '1.1rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.3rem', margin: '0.2rem 0' }}>
                        <span>{flowSymbol}</span>
                        <span>{cls.flow}</span>
                      </div>
                      <div className="cf-7d" style={{ fontSize: '0.85rem', fontWeight: 700, color: flowColor }}>
                        {cls.change1d > 0 ? '+' : ''}{cls.change1d?.toFixed(2)}%
                        <span style={{ color: '#64748b', fontWeight: 500, fontSize: '0.75rem', marginLeft: '0.4rem' }}>
                          (7d {cls.change7d > 0 ? '+' : ''}{cls.change7d?.toFixed(2)}%)
                        </span>
                      </div>
                      <div className="cf-sub" style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.2rem' }}>
                        {cls.symbol} @ {cls.price}
                      </div>
                    </div>
                  );
                })}
              </div>
              
              {/* Anchor & Timestamp Info */}
              <div className="cf-footer" style={{ textAlign: 'center', fontSize: '0.8rem', color: '#64748b', marginTop: '1.5rem' }}>
                {lt.btcUsd && `BTC/USD anchor: $${lt.btcUsd.toLocaleString('el-GR', { minimumFractionDigits: 2 })} · `}
                Generated: {fmtUTCTime(lt.generatedAt)}
              </div>
            </div>
          )}
        </div>
      )}

      {l === 'scanner' && (
        <div className="scanner-tab">
          <div className="scanner-header">
            <div>
              <h2 className="scanner-title">🔍 Market Scanner</h2>
              <p className="scanner-subtitle">11 high-liquidity assets · AI-verified setups only · Manual trigger</p>
            </div>
            <div className="scanner-header-right">
              <button className="scan-now-btn" onClick={triggerScan} disabled={Bt.isScanning}>
                {Bt.isScanning ? (
                  <>
                    <div className="scan-spinner"></div>
                    Scanning...
                  </>
                ) : '⚡ Scan Now'}
              </button>
              <div className="scanner-last-update">
                <span className="update-dot"></span>
                <span>Last updated: {Bt.lastScanAt ? fmtUTCTime(Bt.lastScanAt) : 'Never'}</span>
              </div>
            </div>
          </div>

          {dn.length === 0 ? (
            <div className="scanner-empty">
              <div className="scanner-empty-icon">🔍</div>
              <div className="scanner-empty-title">No signals currently active</div>
              <div className="scanner-empty-sub">Run a manual scan using the button above to locate SM setups on crypto markets.</div>
            </div>
          ) : (
            <div className="signal-grid">
              {dn.map(sig => (
                <div
                  key={sig.id}
                  className={`signal-card ${sig.direction === 'LONG' ? 'signal-long' : 'signal-short'} ${sig.is_new ? 'signal-new' : ''}`}
                >
                  <div className="signal-card-header">
                    <span className="signal-symbol">{sig.symbol}</span>
                    <span className={`signal-direction ${sig.direction === 'LONG' ? 'dir-long' : 'dir-short'}`}>
                      {sig.direction}
                    </span>
                  </div>

                  <div className="signal-status-row">
                    <span className="signal-status" style={{ color: sig.status === 'ACTIVE' ? '#06b6d4' : '#fbbf24' }}>
                      {sig.status}
                    </span>
                    <span className="signal-grade" style={{
                      color: sig.grade === 'A+' || sig.grade === 'A' ? '#10b981' : sig.grade === 'B+' || sig.grade === 'B' ? '#fbbf24' : '#94a3b8'
                    }}>
                      Grade {sig.grade}
                    </span>
                    <span className="signal-pct">{sig.pct}% confidence</span>
                    {sig.is_new && <span className="signal-new-badge">NEW</span>}
                  </div>

                  <div className="signal-levels">
                    <div className="signal-level-row">
                      <span className="level-label">Entry Range</span>
                      <span className="level-value" style={{ color: '#22d3ee' }}>
                        ${sig.entry?.low?.toFixed(4)} - ${sig.entry?.high?.toFixed(4)}
                      </span>
                    </div>
                    <div className="signal-level-row">
                      <span className="level-label">Stop Loss</span>
                      <span className="level-value" style={{ color: '#ef4444' }}>${sig.sl?.toFixed(4)}</span>
                    </div>
                    <div className="signal-level-row">
                      <span className="level-label">TP1</span>
                      <span className="level-value" style={{ color: '#10b981' }}>${sig.targets?.[0]?.toFixed(4)}</span>
                    </div>
                    {sig.targets?.[1] && (
                      <div className="signal-level-row">
                        <span className="level-label">TP2</span>
                        <span className="level-value" style={{ color: '#10b981' }}>${sig.targets?.[1]?.toFixed(4)}</span>
                      </div>
                    )}
                  </div>

                  <div className="signal-reasoning">
                    {sig.reasoning}
                  </div>

                  {sig.positionSize > 0 && (
                    <div style={{ fontSize: '0.75rem', color: '#fbbf24', background: '#fbbf2414', padding: '0.45rem 0.60rem', borderRadius: '6px' }}>
                      🛡️ Recommended Size: <strong>{sig.positionSize} units</strong> (Risk: ${sig.riskAmount} / {sig.riskPct}%)
                    </div>
                  )}

                  <div className="signal-footer">
                    <span className="signal-tf">TF: {sig.timeframe}</span>
                    <span>{fmtUTCTime(sig.timestamp)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {l === 'chart' && (
        <ChartTab
          assets={ASSETS_LIST}
          API_BASE={API_BASE}
          signals={dn}
          livePrices={livePrices}
          onPrices={async (syms) => {
            try {
              const res = await fetch(`${API_BASE}/api/prices?symbols=${syms.join(',')}`);
              const d = await res.json();
              if (d.prices) setLivePrices(d.prices);
            } catch {}
          }}
        />
      )}

      {l === 'analytics' && (
        <div className="capital-flow-tab" style={{ padding: '1rem 0' }}>
          <div className="analytics-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                📊 ARIS System Performance Analytics
              </h2>
              <p className="muted-sm" style={{ margin: '0.2rem 0 0 0', color: '#94a3b8' }}>
                Live forward-testing performance metrics and calibration
              </p>
            </div>
            <button
              className="btn-tv-fetch"
              onClick={() => fetchAnalytics()}
              disabled={ba}
              style={{ background: '#3b82f622', border: '1px solid #3b82f644', color: '#60a5fa', padding: '0.5rem 1rem', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' }}
            >
              🔄 Refresh Stats
            </button>
          </div>

          {!D && ba && <div className="cf-empty">{t.loading}</div>}

          {D && (
            <div>
              {/* 4-Card Performance Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                
                {/* 1. Performance Summary */}
                <div className="panel" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: '220px' }}>
                  <div>
                    <h3 style={{ fontSize: '0.9rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      📈 Performance Summary
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.85rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Total Closed Trades</span>
                        <strong style={{ color: '#e2e8f0' }}>{D.summary?.closed ?? 0}</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Wins (TP Hit)</span>
                        <strong style={{ color: '#10b981' }}>{D.summary?.wins ?? 0}</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Losses (SL Hit)</span>
                        <strong style={{ color: '#ef4444' }}>{D.summary?.losses ?? 0}</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Active Tracks</span>
                        <strong style={{ color: '#06b6d4' }}>{D.summary?.active ?? 0}</strong>
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid #1e293b' }}>
                    <span style={{ fontSize: '1.4rem', fontWeight: 800, color: '#10b981' }}>{D.summary?.winRate ?? 0}% WR</span>
                    <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                      Expectancy: <strong style={{ color: '#10b981' }}>{D.summary?.expectancy != null ? (D.summary.expectancy >= 0 ? '+' : '') + Number(D.summary.expectancy).toFixed(2) + ' R' : '0 R'}</strong>
                    </span>
                  </div>
                </div>

                {/* 2. Circuit Breaker */}
                <div className="panel" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: '220px', borderLeft: `4px solid ${D.circuitBreaker?.tripped ? '#ef4444' : '#10b981'}` }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}>
                      <h3 style={{ fontSize: '0.9rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        🛡️ Circuit Breaker
                      </h3>
                      <span style={{
                        fontSize: '0.7rem', fontWeight: 800, padding: '0.15rem 0.5rem', borderRadius: '4px',
                        background: D.circuitBreaker?.tripped ? '#ef444422' : '#10b98122',
                        color: D.circuitBreaker?.tripped ? '#ef4444' : '#10b981'
                      }}>
                        {D.circuitBreaker?.tripped ? 'TRIPPED' : 'OPERATIONAL'}
                      </span>
                    </div>
                    <p style={{ fontSize: '0.78rem', color: '#94a3b8', lineHeight: 1.4, margin: '0 0 1rem 0' }}>
                      Locks the automatic scanner after 3 consecutive failed trades to prevent drawdowns.
                    </p>
                    <div style={{ fontSize: '0.85rem' }}>
                      Consecutive Streak: <strong style={{ color: D.circuitBreaker?.tripped ? '#ef4444' : '#e2e8f0' }}>{D.circuitBreaker?.consecutiveFails ?? 0} / 3</strong>
                    </div>
                  </div>
                  {D.circuitBreaker?.tripped && (
                    <button className="btn-clear" onClick={resetBreaker} style={{ marginTop: '1rem', width: '100%' }}>
                      Reset Breaker
                    </button>
                  )}
                </div>

                {/* 3. Personal Leaderboard */}
                {(() => {
                  const pb = D.leaderboard || D.personalBests || {};
                  return (
                    <div className="panel" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: '220px', borderLeft: '4px solid #fbbf24' }}>
                      <div>
                        <h3 style={{ fontSize: '0.9rem', color: '#fbbf24', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          🏆 Personal Leaderboard
                        </h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.82rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: '#94a3b8' }}>🔥 Current Win Streak</span>
                            <strong style={{ color: '#10b981' }}>{pb.currentWinStreak ?? 0}</strong>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: '#94a3b8' }}>🏆 Best Win Streak</span>
                            <strong style={{ color: '#10b981' }}>{pb.bestWinStreak ?? 0}</strong>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: '#94a3b8' }}>📩 Worst Loss Streak</span>
                            <strong style={{ color: '#ef4444' }}>{pb.worstLossStreak ?? 0}</strong>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: '#94a3b8' }}>💎 Best R Trade</span>
                            <strong style={{ color: (pb.bestR ?? 0) >= 0 ? '#10b981' : '#ef4444' }}>{pb.bestR != null ? (pb.bestR >= 0 ? '+' : '') + pb.bestR.toFixed(2) + 'R' : '—'}</strong>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: '#94a3b8' }}>💀 Worst R Trade</span>
                            <strong style={{ color: '#ef4444' }}>{pb.worstR != null ? pb.worstR.toFixed(2) + 'R' : '—'}</strong>
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem', paddingTop: '0.5rem', borderTop: '1px solid #1e293b' }}>
                        <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>📊 Total R</span>
                        <strong style={{ fontSize: '1rem', color: (pb.totalR ?? 0) >= 0 ? '#10b981' : '#ef4444' }}>
                          {(pb.totalR ?? 0) >= 0 ? '+' : ''}{(pb.totalR ?? 0).toFixed(2)}R
                        </strong>
                      </div>
                    </div>
                  );
                })()}

                {/* 4. Performance by Bias */}
                <div className="panel" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', minHeight: '220px' }}>
                  <h3 style={{ fontSize: '0.9rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '1.2rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    ⚖️ Performance by Bias
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '0.9rem' }}>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                        <span style={{ color: '#10b981', fontWeight: 600 }}>🟢 LONG (Bullish)</span>
                        <strong style={{ color: '#e2e8f0' }}>{D.byDirection?.LONG?.winRate ?? 0}%</strong>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                        {D.byDirection?.LONG?.wins ?? 0}W / {D.byDirection?.LONG?.losses ?? 0}L
                      </div>
                    </div>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                        <span style={{ color: '#ef4444', fontWeight: 600 }}>🔴 SHORT (Bearish)</span>
                        <strong style={{ color: '#e2e8f0' }}>{D.byDirection?.SHORT?.winRate ?? 0}%</strong>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                        {D.byDirection?.SHORT?.wins ?? 0}W / {D.byDirection?.SHORT?.losses ?? 0}L
                      </div>
                    </div>
                  </div>
                </div>

              </div>

              {/* Deterministic Sizing Rules */}
              <div className="panel" style={{ marginBottom: '1.5rem' }}>
                <h3 style={{ fontSize: '0.9rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  📐 Deterministic Sizing Rules
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
                  {[
                    { grade: 'Grade A+', risk: '1.0% Risk', color: '#10b981' },
                    { grade: 'Grade A', risk: '0.75% Risk', color: '#10b981' },
                    { grade: 'Grade B+', risk: '0.5% Risk', color: '#fbbf24' },
                    { grade: 'Grade B', risk: '0.25% Risk', color: '#fbbf24' },
                    { grade: 'Grade C', risk: 'Monitor Only (0% Risk)', color: '#94a3b8' }
                  ].map((rule, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.8rem', backgroundColor: '#1e293b44', borderRadius: '6px', border: '1px solid #1e293b' }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#cbd5e1' }}>{rule.grade}</span>
                      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: rule.color }}>{rule.risk}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recent Executions */}
              {D.recentPerformance?.trades && (
                <div className="panel" style={{ padding: '1rem 0' }}>
                  <h3 style={{ fontSize: '0.9rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', padding: '0 1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    🎯 Recent Executions
                    <span style={{ marginLeft: 'auto', fontWeight: 400, fontSize: '0.8rem', color: '#64748b' }}>
                      {D.recentPerformance.trades.length} σύνολο
                    </span>
                  </h3>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #1e293b', color: '#94a3b8' }}>
                          <th style={{ padding: '0.75rem 1rem' }}>Asset</th>
                          <th style={{ padding: '0.75rem 1rem' }}>Bias</th>
                          <th style={{ padding: '0.75rem 1rem' }}>Grade</th>
                          <th style={{ padding: '0.75rem 1rem' }}>Result</th>
                          <th style={{ padding: '0.75rem 1rem' }}>R:R</th>
                          <th style={{ padding: '0.75rem 1rem' }}>Closed At</th>
                        </tr>
                      </thead>
                      <tbody>
                        {D.recentPerformance.trades.slice(execPage * EXEC_PER_PAGE, (execPage + 1) * EXEC_PER_PAGE).map((trade, idx) => (
                          <tr key={idx} style={{ borderBottom: '1px solid #1e293b44', color: '#cbd5e1' }}>
                            <th style={{ padding: '0.75rem 1rem', fontWeight: 700 }}>{trade.instrument}</th>
                            <td style={{ padding: '0.75rem 1rem' }}>
                              <span style={{ color: trade.direction === 'LONG' ? '#10b981' : '#ef4444', fontWeight: 600 }}>
                                {trade.direction}
                              </span>
                            </td>
                            <td style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>{trade.grade}</td>
                            <td style={{ padding: '0.75rem 1rem' }}>
                              <span style={{
                                display: 'inline-block',
                                padding: '0.15rem 0.4rem',
                                borderRadius: '4px',
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                backgroundColor: trade.status === 'SUCCESS' ? '#10b98122' : trade.status === 'PARTIAL' ? '#a855f722' : '#ef444422',
                                color: trade.status === 'SUCCESS' ? '#10b981' : trade.status === 'PARTIAL' ? '#a855f7' : '#ef4444'
                              }}>
                                {trade.status}
                              </span>
                            </td>
                            <td style={{ padding: '0.75rem 1rem' }}>
                              {trade.rr ? `${trade.rr}x` : '—'}
                            </td>
                            <td style={{ padding: '0.75rem 1rem', color: '#94a3b8' }}>
                              {trade.closedAt ? fmtUTCDate(trade.closedAt) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {/* Pagination controls */}
                  {D.recentPerformance.trades.length > EXEC_PER_PAGE && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', padding: '0.75rem 1rem', borderTop: '1px solid #1e293b' }}>
                      <button
                        onClick={() => setExecPage(p => Math.max(0, p - 1))}
                        disabled={execPage === 0}
                        style={{
                          padding: '0.35rem 0.85rem', borderRadius: '6px', border: 'none', cursor: execPage === 0 ? 'not-allowed' : 'pointer',
                          backgroundColor: execPage === 0 ? '#1e293b' : '#334155', color: execPage === 0 ? '#475569' : '#e2e8f0', fontWeight: 600, fontSize: '0.8rem'
                        }}
                      >← Προηγ.</button>
                      <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}>
                        Σελίδα {execPage + 1} / {Math.ceil(D.recentPerformance.trades.length / EXEC_PER_PAGE)}
                      </span>
                      <button
                        onClick={() => setExecPage(p => Math.min(Math.ceil(D.recentPerformance.trades.length / EXEC_PER_PAGE) - 1, p + 1))}
                        disabled={(execPage + 1) * EXEC_PER_PAGE >= D.recentPerformance.trades.length}
                        style={{
                          padding: '0.35rem 0.85rem', borderRadius: '6px', border: 'none',
                          cursor: (execPage + 1) * EXEC_PER_PAGE >= D.recentPerformance.trades.length ? 'not-allowed' : 'pointer',
                          backgroundColor: (execPage + 1) * EXEC_PER_PAGE >= D.recentPerformance.trades.length ? '#1e293b' : '#334155',
                          color: (execPage + 1) * EXEC_PER_PAGE >= D.recentPerformance.trades.length ? '#475569' : '#e2e8f0',
                          fontWeight: 600, fontSize: '0.8rem'
                        }}
                      >Επόμ. →</button>
                    </div>
                  )}
                </div>
              )}

            </div>
          )}
        </div>
      )}


      {l === 'coach' && (
        <div className="coach-tab">
          <p className="muted-sm">{t.coachDescription}</p>

          <div className="coach-messages">
            {Es.length === 0 ? (
              <div className="coach-empty">{t.coachEmpty}</div>
            ) : (
              Es.map((msg, idx) => (
                <div key={idx} className={`coach-msg ${msg.role}`}>
                  <span className="coach-role">{msg.role === 'user' ? t.coachYou : 'ARIS Coach'}</span>
                  <div className="coach-bubble">{msg.content}</div>
                </div>
              ))
            )}
            {cr && (
              <div className="coach-msg assistant">
                <span className="coach-role">ARIS Coach</span>
                <div className="coach-bubble" style={{ fontStyle: 'italic', opacity: 0.7 }}>
                  {t.coachThinking}
                </div>
              </div>
            )}
          </div>

          <div className="coach-input-row">
            <input
              type="text"
              className="coach-input"
              placeholder={t.coachPlaceholder}
              value={Ts}
              onChange={ev => setTsInput(ev.target.value)}
              onKeyDown={ev => ev.key === 'Enter' && handleChatSend()}
              disabled={cr}
            />
            <button className="btn-tv-fetch" onClick={handleChatSend} disabled={cr || !Ts.trim()}>
              {t.coachSend}
            </button>
          </div>
        </div>
      )}

      {l === 'early' && (
        <div className="early-tab">
          <div className="cf-header">
            <h2>🔎 Early Signals scanner</h2>
            <p className="muted-sm">{t.earlyDescription}</p>
            <button className="btn-secondary" onClick={() => fetchEarly(true)} disabled={sl}>
              {sl ? t.loading : t.refresh}
            </button>
          </div>

          {sl && <div className="cf-empty">{t.loading}</div>}

          {!st && !sl && <div className="cf-empty">{t.earlyEmpty}</div>}

          {st?.available === false && <div className="cf-empty">⚠️ {st.error || 'N/A'}</div>}

          {st?.candidates && st.candidates.length > 0 && (
            <div className="early-grid">
              {st.candidates.map((coin, idx) => (
                <div key={idx} className="early-card">
                  <div className="early-header">
                    <div>
                      <div className="early-name">
                        {coin.name} <span className="early-sym">{coin.symbol}</span>
                      </div>
                      <div className="early-cats">{(coin.categories || []).slice(0, 3).join(', ') || '—'}</div>
                    </div>
                    <div className={`early-badge ${coin.listedOnBinance ? 'yes' : 'no'}`}>
                      {coin.listedOnBinance ? 'Binance' : 'OTC'}
                    </div>
                  </div>

                  <div className="early-metrics">
                    <div className="early-metric">
                      <span className="early-label">MCap</span>
                      <span>${(coin.marketCap / 1000000).toFixed(1)}M</span>
                    </div>
                    <div className="early-metric">
                      <span className="early-label">Vol 24h</span>
                      <span>${(coin.volume24h / 1000000).toFixed(1)}M</span>
                    </div>
                    <div className="early-metric">
                      <span className="early-label">Chg 24h</span>
                      <span style={{ color: coin.priceChange24h >= 0 ? '#10b981' : '#ef4444' }}>
                        {coin.priceChange24h?.toFixed(1)}%
                      </span>
                    </div>
                    <div className="early-metric">
                      <span className="early-label">Score</span>
                      <span>{coin.score?.toFixed(0)}</span>
                    </div>
                  </div>

                  {coin.thesis && (
                    <div className="early-thesis">
                      {coin.thesis}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {st?.candidates?.length === 0 && !sl && <div className="cf-empty">{t.noCandidates}</div>}
        </div>
      )}
    </div>
  );
}
