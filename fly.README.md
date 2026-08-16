# Fly.io Deployment — trading-analyzer backend

Μετά το Supabase dual-mode, το DB ζει στο cloud (Supabase PostgreSQL). Το Fly.io
φιλοξενεί μόνο τον Node/Express server· δεν χρειάζεται volume για το SQLite
γιατί το app χρησιμοποιεί Supabase όταν το `SUPABASE_URL` είναι ρυθμισμένο.

## Προαπαιτούμενα
- Λογαριασμός Fly.io (εγγραφή με GitHub: https://fly.io)
- `flyctl` εγκατεστημένο (PowerShell admin: `iwr https://fly.io/install.ps1 -useb | iex`)
- `fly auth login` (browser)

## Βήματα

### 1. Launch (δημιουργία app + volume config)
```powershell
cd C:\Users\Aris\.gemini\antigravity\scratch\trading-analyzer
fly launch --no-deploy --region fra
```
Το `--no-deploy` φτιάχνει το app χωρίς να κάνει deploy αμέσως (θέλουμε πρώτα τα secrets).
Αν το `fly.toml` υπάρχει ήδη, το `fly launch` θα το σεβαστεί ή θα το παρακάμψει —
μπορείς να πεις "y" για overwrite ή να κρατήσεις το δικό μας.

### 2. Ρύθμιση Secrets (ΑΝΤΙ για .env — ποτέ μην βάλεις .env στο image)
```powershell
fly secrets set `
  AI_PROVIDER=anthropic `
  ANTHROPIC_API_KEY=xxx `
  GEMINI_API_KEY=xxx `
  TAVILY_API_KEY=xxx `
  TWELVE_DATA_API_KEY=xxx `
  CRYPTOPANIC_API_KEY=xxx `
  SERPER_API_KEY=xxx `
  COINMARKETCAP_API_KEY=xxx `
  SUPABASE_URL=https://xxxx.supabase.co `
  SUPABASE_ANON_KEY=xxx
```
(Αντέγραψε τις τιμές από το τοπικό `backend/.env` — ΟΧΙ το `DATABASE_URL`,
το Supabase JS client χρησιμοποιεί SUPABASE_URL + SUPABASE_ANON_KEY.)

### 3. Deploy
```powershell
fly deploy
```

### 4. Άνοιγμα
```powershell
fly open
# ή βρες το URL:  https://trading-analyzer.fly.dev
```

### 5. Logs / Status
```powershell
fly logs
fly status
```

## Σημειώσεις
- **Free tier**: 256MB RAM, 1 shared CPU, scale-to-zero (cold start ~2-5s).
  Το `min_machines_running = 0` στο fly.toml σημαίνει ότι το app "κοιμάται"
  μετά από 15min αδράνειας → δωρεάν αλλά αργεί το πρώτο request.
- **Region**: `fra` (Frankfurt) για χαμηλό latency προς Ελλάδα. Αλλαγή στο fly.toml.
- **DB**: Supabase (cloud PostgreSQL) — δεν χρειάζεται Fly volume.
- **CORS**: το `server.js` χρησιμοποιεί `ALLOWED_ORIGINS` env (ή default localhost:5000).
  Αν θες να το ανοίξεις από άλλη συσκευή, βάλε `fly secrets set ALLOWED_ORIGINS=https://trading-analyzer.fly.dev`.
- **Restart**: `fly deploy` ξανακάνει build + deploy. Για απλό restart χωρίς rebuild:
  `fly machines restart`.
