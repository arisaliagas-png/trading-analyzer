// ─── Translations dictionary ──────────────────────────────────────────────────
export const t = {
  en: {
    title: '🧙 AI Trading Analyzer',
    subtitle: 'Upload a trading chart and get a deterministic, multi-methodology trade setup instantly',

    tabs: {
      analyzer: '📊 Analyzer',
      history: '🕐 History',
      heatmap: '🌡️ Live Heatmap',
    },

    // Upload
    uploadDrag: 'Drag & drop chart screenshot here',
    uploadOr: 'or click to browse local files',
    uploadLoaded: '✓ Chart Loaded',
    uploadReplace: 'Click here to replace image',
    uploadHints: 'Focus Indicators (Optional)',
    uploadHintsPlaceholder: 'e.g. RSI divergence, double bottom',
    uploadEmpty: 'Upload a chart image on the left to see preview',
    timeframeLabel: 'Timeframe (Auto-detected if left on Auto)',
    timeframeAuto: '🤖 Auto — AI reads from chart',

    // TradingView
    tvImport: '🔗 Import from TradingView',
    tvPlaceholder: 'Paste TradingView snapshot link (Share → Copy link to chart image)',
    tvFetch: 'Fetch Chart',
    tvFetching: 'Fetching...',
    tvError: 'Please use TradingView "Share → Copy link to chart image" to get a /x/ snapshot URL.',

    // Analyze
    btnAnalyze: 'Run AI Analysis',
    btnAnalyzing: 'Analyzing Chart...',
    btnSecondOpinion: "🔍 Get Second Opinion (Devil's Advocate)",
    btnGettingOpinion: 'Getting Second Opinion...',

    // Results
    methodology: 'Applied',
    strengthScore: 'Strength Score',
    methodologyRationale: 'Methodology Rationale:',
    entryTrigger: 'Entry Trigger',
    stopLoss: 'Stop Loss (SL)',
    takeProfit: 'Take Profit (TP1)',
    secondaryTargets: 'Secondary Targets:',
    detectedPatterns: 'Detected Patterns & Indicators:',
    aiReasoning: 'AI Trade Reasoning:',
    loadingMsg: 'Deep Learning Engine running...',
    loadingSubMsg: 'Detecting levels, order blocks and structural waves',

    // Second Opinion
    soConfirmed: 'CONFIRMED',
    soRejected: 'REJECTED',
    soCaution: 'CAUTION',
    soChallengePoints: '⚡ Challenge Points:',
    soAlternative: 'Alternative Scenario:',
    soConfidence: 'Confidence',

    // History
    historyTitle: 'Analysis History',
    clearAll: '🗑 Clear All',
    noHistory: 'No analyses saved yet. Run your first analysis!',
    goAnalyzer: 'Go to Analyzer',
    strength: 'strength',

    // Heatmap
    symbol: 'Symbol',
    apply: 'Apply',
    live: 'Live',
    connecting: 'Connecting...',
    bidsLegend: '■ Bids (Buy walls)',
    asksLegend: '■ Asks (Sell walls)',
    midPriceLegend: '— Mid price',
    whaleLegend: '🐳 Whale wall (>5× avg)',
    sources: 'Sources:',
    midPrice: 'Mid Price',
    topBidWall: 'Top Bid Wall',
    topAskWall: 'Top Ask Wall',
    spread: 'Spread',
    bids: 'Bids',
    asks: 'Asks',
    price: 'Price',
    volume: 'Volume',
    intensity: 'Intensity',
    whaleWalls: '🐳 Whale Walls Detected',
    setup: 'setup',
  },

  el: {
    title: '🧙 Αναλυτής Αγοράς AI',
    subtitle: 'Ανέβασε γράφημα συναλλαγής και λάβε άμεσα ένα ολοκληρωμένο πλάνο με AI',

    tabs: {
      analyzer: '📊 Ανάλυση',
      history: '🕐 Ιστορικό',
      heatmap: '🌡️ Ζωντανό Heatmap',
    },

    // Upload
    uploadDrag: 'Σύρε γράφημα εδώ',
    uploadOr: 'ή κλικ για επιλογή αρχείου',
    uploadLoaded: '✓ Γράφημα Φορτώθηκε',
    uploadReplace: 'Κλικ εδώ για αντικατάσταση',
    uploadHints: 'Εστίαση Δεικτών (Προαιρετικό)',
    uploadHintsPlaceholder: 'π.χ. απόκλιση RSI, διπλό κατώτατο',
    uploadEmpty: 'Ανέβασε γράφημα αριστερά για προεπισκόπηση',
    timeframeLabel: 'Χρονικό Πλαίσιο (Αυτόματο αν επιλεγεί Auto)',
    timeframeAuto: '🤖 Αυτόματο — Ο AI το διαβάζει από το γράφημα',

    // TradingView
    tvImport: '🔗 Εισαγωγή από TradingView',
    tvPlaceholder: 'Επικόλλησε link στιγμιοτύπου (Κοινοποίηση → Αντιγραφή link εικόνας)',
    tvFetch: 'Λήψη Γραφήματος',
    tvFetching: 'Φόρτωση...',
    tvError: 'Χρησιμοποίησε το TradingView "Κοινοποίηση → Αντιγραφή link εικόνας γραφήματος" για να λάβεις URL τύπου /x/.',

    // Analyze
    btnAnalyze: 'Εκτέλεση Ανάλυσης AI',
    btnAnalyzing: 'Ανάλυση Γραφήματος...',
    btnSecondOpinion: '🔍 Δεύτερη Γνώμη (Αντίθετη Άποψη)',
    btnGettingOpinion: 'Λήψη Δεύτερης Γνώμης...',

    // Results
    methodology: 'Εφαρμόστηκε',
    strengthScore: 'Βαθμός Ισχύος',
    methodologyRationale: 'Αιτιολόγηση Μεθοδολογίας:',
    entryTrigger: 'Σημείο Εισόδου',
    stopLoss: 'Stop Loss (SL)',
    takeProfit: 'Στόχος Κέρδους (TP1)',
    secondaryTargets: 'Δευτερεύοντες Στόχοι:',
    detectedPatterns: 'Ανιχνευμένα Μοτίβα & Δείκτες:',
    aiReasoning: 'Αιτιολόγηση AI:',
    loadingMsg: 'Εκτέλεση Μηχανής Ανάλυσης...',
    loadingSubMsg: 'Εντοπισμός επιπέδων, order blocks και κυματικών δομών',

    // Second Opinion
    soConfirmed: 'ΕΠΙΒΕΒΑΙΩΘΗΚΕ',
    soRejected: 'ΑΠΟΡΡΙΦΘΗΚΕ',
    soCaution: 'ΠΡΟΣΟΧΗ',
    soChallengePoints: '⚡ Σημεία Αμφισβήτησης:',
    soAlternative: 'Εναλλακτικό Σενάριο:',
    soConfidence: 'Αξιοπιστία',

    // History
    historyTitle: 'Ιστορικό Αναλύσεων',
    clearAll: '🗑 Εκκαθάριση Όλων',
    noHistory: 'Δεν υπάρχουν αποθηκευμένες αναλύσεις. Κάνε την πρώτη σου!',
    goAnalyzer: 'Πήγαινε στην Ανάλυση',
    strength: 'ισχύς',

    // Heatmap
    symbol: 'Ζεύγος',
    apply: 'Εφαρμογή',
    live: 'Ζωντανό',
    connecting: 'Σύνδεση...',
    bidsLegend: '■ Αγοραστές (Bid walls)',
    asksLegend: '■ Πωλητές (Ask walls)',
    midPriceLegend: '— Μέση τιμή',
    whaleLegend: '🐳 Φάλαινα (>5× μέσος όρος)',
    sources: 'Πηγές:',
    midPrice: 'Μέση Τιμή',
    topBidWall: 'Κορυφαίο Bid Wall',
    topAskWall: 'Κορυφαίο Ask Wall',
    spread: 'Spread',
    bids: 'Αγοραστές',
    asks: 'Πωλητές',
    price: 'Τιμή',
    volume: 'Όγκος',
    intensity: 'Ένταση',
    whaleWalls: '🐳 Εντοπίστηκαν Φάλαινες',
    setup: 'σετάπ',
  }
};
