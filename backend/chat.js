// ─────────────────────────────────────────────
// AI COACH (free-form chat with system context)
// ─────────────────────────────────────────────
import { askAI } from './aiProvider.js';
import { getActiveSignals } from './scanner.js';
import { getActiveTrades } from './tradeTracker.js';
import { getCapitalFlow } from './capitalFlow.js';
import { getDirectionalEdge } from './dbSupabase.js';

// ── System Philosophy (Prótos Nómos) ──────────
const RULES = `SYSTEM PHILOSOPHY — «Πρώτος Νόμος»:
- ΠΟΤΕ μην κυνηγάς το κερί. Η αγορά έρχεται σε σένα, όχι το αντίθετο.
- Wait for the zone (SMC/OTE). Το setup πρέπει να έχει λόγο (ΓΙΑΤΙ).
- Υπομονή = στρατηγική. Αν δεν υπάρχει σαφές setup, κανένας trade.
- R:R floor 1.5:1 για όλες τις στρατηγικές (μη διαπραγμάτευση χαμηλότερου).
- Board risk matters: μην είσαι long σε 4 assets ταυτόχρονα χωρίς λόγο.
- Lessons > opinions: ό,τι έγινε στο παρελθόν (SL hit / win) επαναλαμβάνεται.`;

export async function buildContext() {
  const [signals, trades, flow, edgeData] = await Promise.all([
    getActiveSignals().catch(() => []),
    getActiveTrades().catch(() => []),
    getCapitalFlow().catch(() => ({ regimes: [], pairs: [] })),
    getDirectionalEdge().catch(() => ({}))
  ]);

  const sigLines = (signals || []).map(s => {
    const d = s.doi1h ?? s.flow?.doi1h ?? null;
    const fq = s.flowQuality ?? s.flow?.flowQuality ?? 'N/A';
    const cvd = s.cvdBias ?? s.flow?.cvdBias ?? null;
    return `- ${s.symbol} ${s.direction}: status=${s.status} strategy=${s.strategy || '?'} R:R=${s.plannedRR ?? '?'}:1 tp1=${s.tp1} sl=${s.sl} doi1h=${d ?? 'null'} flow=${fq} cvd=${cvd ?? 'null'}`;
  }).join('\n') || '(none)';

  const tradeLines = (trades || []).map(t => {
    const pnl = t.live_pnl != null ? `${t.live_pnl > 0 ? '+' : ''}${t.live_pnl.toFixed(2)}% (live)` : `${t.pnl != null ? (t.pnl > 0 ? '+' : '') + t.pnl.toFixed(2) : '—'}%`;
    return `- ${t.symbol} ${t.direction}: ${t.status} entry=${t.entry} tp1=${t.tp1} sl=${t.sl} PnL=${pnl}`;
  }).join('\n') || '(none)';

  const flowLines = [
    `Regime: ${(flow.regimes || []).map(r => `${r.symbol}=${r.regime}`).join(', ') || 'n/a'}`,
    `ΔOI1h / CVD: ${(flow.pairs || []).map(p => `${p.symbol} ΔOI=${p.doi1h ?? 'n/a'} CVD=${p.cvd ?? 'n/a'}`).join(', ') || 'n/a'}`
  ].join('\n');

  const edgeLines = [
    `Long:  ${edgeData.longWR != null ? edgeData.longWR + '% WR' : 'n/a'} | ${edgeData.longRR != null ? edgeData.longRR + ':1 avg R:R' : 'n/a'} | trades=${edgeData.longTrades ?? '?'}`,
    `Short: ${edgeData.shortWR != null ? edgeData.shortWR + '% WR' : 'n/a'} | ${edgeData.shortRR != null ? edgeData.shortRR + ':1 avg R:R' : 'n/a'} | trades=${edgeData.shortTrades ?? '?'}`,
    `Common LONG failure: ${edgeData.longFailReason || 'n/a'}`,
    `Common SHORT failure: ${edgeData.shortFailReason || 'n/a'}`
  ].join('\n');

  return `=== SCANNER SIGNALS ===
${sigLines}

=== ACTIVE TRADES (live PnL) ===
${tradeLines}

=== CAPITAL FLOW ===
${flowLines}

=== DIRECTIONAL EDGE (historical) ===
${edgeLines}

${RULES}`;
}

export async function chatWithAI(userMessage, history = []) {
  const ctx = await buildContext();
  const prompt = `${ctx}

USER QUESTION: ${userMessage}

INSTRUCTIONS:
- Answer strictly based on the data above.
- Apply the «Πρώτος Νόμος»: never chase the candle, wait for the zone.
- If data is missing, say so explicitly; do not invent values.
- Be concise and actionable (Greek preferred if user writes Greek).`;

  const response = await askAI(prompt, [{ role: 'user', content: userMessage }], 'openrouter');
  return response;
}