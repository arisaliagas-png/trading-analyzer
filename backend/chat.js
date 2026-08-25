// ─────────────────────────────────────────────
// AI COACH (free-form chat with system context)
// Grounded in the analyzer's live state: signals, prices, capital flow,
// post-mortem lessons, and system rules ("Πρώτος Νόμος").
// ─────────────────────────────────────────────
import { askAI } from './aiProvider.js';
import { getActiveSignals, getDirectionalEdge } from './scanner.js';
import { getCapitalFlow } from './capitalFlow.js';
import { getAllLessons, getActiveTrades } from './db.js';

async function fetchLivePrices(symbols) {
  if (!symbols.length) return {};
  try {
    const res = await fetch(`https://trading-analyzer-affqwq.fly.dev/api/prices?symbols=${symbols.join(',')}`);
    if (!res.ok) return {};
    const d = await res.json();
    return d.prices || {};
  } catch { return {}; }
}

async function buildContext() {
  const [signals, trades, lessons, directionalEdge] = await Promise.all([
    getActiveSignals(),
    getActiveTrades(),
    getAllLessons().then(l => l.slice(-8)),
    getDirectionalEdge().catch(() => ({})),
  ]);

  // ── Signals with enriched metadata ──
  const sigLines = signals.length
    ? signals.map(s => {
        const dir = s.direction || '?';
        const entry = s.entryPrice ?? s.entry?.price ?? '?';
        const sl = s.sl ?? '?';
        const tp1 = s.tp1 ?? '?';
        const tp2 = s.tp2 ?? '?';
        const status = s.status ?? '?';
        const grade = s.grade ?? '?';
        const atr = s.atr14 ? `ATR${s.atr14.toFixed(2)}` : 'ATR?';
        const inv = s.invalidation ? `inv>${s.invalidation.toFixed?.(2) ?? s.invalidation}` : '';
        const flow = s.flowQuality && s.flowQuality !== 'N/A' ? `flow=${s.flowQuality}` : '';
        const doi = s.doi1h != null ? `ΔOI${s.doi1h}%` : '';
        const cvd = s.cvdBias ? `CVD=${s.cvdBias}` : '';
        const extra = [atr, inv, flow, doi, cvd].filter(Boolean).join(' | ');
        return `- ${s.instrument} ${dir} | entry ${entry} | SL ${sl} | TP1 ${tp1} / TP2 ${tp2} | ${grade} | ${status}${extra ? ' | ' + extra : ''}`;
      }).join('\n')
    : '(none)';

  // ── Active trades with live PnL ──
  const symbols = [...new Set(trades.map(t => t.instrument).filter(Boolean))];
  const prices = await fetchLivePrices(symbols);
  const tradeLines = trades.length
    ? trades.map(t => {
        const live = prices[t.instrument];
        const entry = t.entry_price;
        const pct = live && entry ? ((live - entry) / entry * 100) * (t.direction === 'SHORT' ? -1 : 1) : null;
        return `- ${t.instrument} ${t.direction} | entry ${entry?.toFixed?.(2) ?? '?'} | SL ${t.sl?.toFixed?.(2) ?? '?'} | TP1 ${t.tp1?.toFixed?.(2) ?? '?'} | PnL ${pct != null ? (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%' : 'n/a'} | ${t.status}`;
      }).join('\n')
    : '(none)';

  // ── Capital flow ──
  let flowLines = '(unavailable)';
  try {
    const flow = await getCapitalFlow();
    if (flow && flow.classes && flow.classes.length) {
      flowLines = flow.classes
        .map(c => `- ${c.label}: ${c.available ? (c.flow || 'NEUTRAL') : 'N/A'}`)
        .join('\n');
    }
  } catch { /* ignore */ }

  // ── Lessons ──
  const lessonLines = lessons.length
    ? lessons.map(l => `- ${l.instrument} ${l.direction || ''}: ${l.failure_reason || ''} → ${l.lesson || ''}`).join('\n')
    : '(none)';

  // ── Directional edge (historical win rate by direction) ──
  const edgeLines = directionalEdge && typeof directionalEdge === 'object'
    ? Object.entries(directionalEdge).map(([dir, stats]) => {
        const wins = stats.wins || 0;
        const losses = stats.losses || 0;
        const total = wins + losses;
        const wr = total ? ((wins / total) * 100).toFixed(0) : '?';
        return `- ${dir}: ${wins}W / ${losses}L (${wr}% WR)`;
      }).join('
')
    : '(unavailable)';

  // ── System rules ("Πρώτος Νόμος") ──
  const rules = `SYSTEM RULES (Πρώτος Νόμος):
- Ποτέ μην κυνηγάς το κερι. Wait for the zone (SMC/OTE) με το ΓΙΑΤΙ.
- υπομονή = στρατηγική.
- Επιλογή Α: ΟΧΙ Tavily/live-news (θόρυβος/FOMO).
- R:R floor 1.5:1 για όλα τα setups.
- ATR-floor SL veto + zone invalidation.
- Board correlation risk: αν 5/7 setups είναι ίδια κατεύθυνση, μεγέθυνε προσοχή.
- Flow downgrade: BUY_INTO_SELLING / SELL_INTO_BUYING → PENDING.`;

  return `=== SCANNER SIGNALS ===
${sigLines}\n\n=== ACTIVE TRADES (live PnL) ===
${tradeLines}\n\n=== CAPITAL FLOW ===
${flowLines}\n\n=== RECENT LESSONS ===
${lessonLines}\n\n=== DIRECTIONAL EDGE (historical) ===
${edgeLines}\n\n${rules}`;
}

const ROLE = `You are the ARIS Crypto Coach — an experienced, direct crypto analyst embedded inside the user's "AI Trading Analyzer" (ARIS Quantum v6 strategy: SMC/ICT concepts, OTE zones, R-multiple, squeeze-phase hard gate, directional-edge gate).

Your job: discuss the market, specific coins, and the user's own scanner signals in plain Greek (the user is Greek — always reply in Greek). Be concise, honest, and technically deep. Call out risk. Never guarantee outcomes. Reference the user's own data (scanner signals, capital flow, lessons, live PnL) when relevant. If asked about a coin not in the signals, give a framework + what to watch, not a promise.

Keep replies tight (3-6 sentences unless the user asks for depth).`;

export async function chatWithAI(message, history = []) {
  const ctx = await buildContext();
  const systemPrompt = `${ROLE}\n\n=== LIVE SYSTEM CONTEXT (do not repeat verbatim; use it to ground answers) ===\n${ctx}`;
  const messages = [...history.slice(-10), { role: 'user', content: message }];
  return await askAI(systemPrompt, messages);
}
