// ─────────────────────────────────────────────
// AI COACH (free-form chat with system context)
// Lets the user discuss the market using the analyzer's own data (scanner
// signals, capital flow, post-mortem lessons) as grounding context. Cheap by
// design: compact context block + caller-capped history (last ~10 messages).
// ─────────────────────────────────────────────
import { askAI } from './aiProvider.js';
import { getActiveSignals } from './scanner.js';
import { getCapitalFlow } from './capitalFlow.js';
import { getAllLessons, getActiveTrades } from './db.js';

// Build a compact, token-efficient snapshot of the analyzer's current state.
async function buildContext() {
  const signals = await getActiveSignals();
  const sigLines = signals.length
    ? signals.map(s => {
        const dir = s.direction || '?';
        const entry = s.entryPrice ?? s.entry?.price ?? '?';
        const sl = s.stopLoss ?? s.sl ?? '?';
        const tps = Array.isArray(s.targets) && s.targets.length
          ? s.targets.join(' / ')
          : (s.target1 ? `${s.target1}${s.target2 ? ' / ' + s.target2 : ''}` : '?');
        return `- ${s.instrument} ${dir} | entry ${entry} | SL ${sl} | TP ${tps} [${s.status}]`;
      }).join('\n')
    : '(none)';

  let flowLines = '(unavailable)';
  try {
    const flow = await getCapitalFlow();
    if (flow && flow.classes && flow.classes.length) {
      flowLines = flow.classes
        .map(c => `- ${c.label}: ${c.available ? (c.flow || 'NEUTRAL') : 'N/A'}`)
        .join('\n');
    }
  } catch { /* ignore — don't block chat on capital-flow failure */ }

  let lessonLines = '(none)';
  try {
    const lessons = (await getAllLessons()).slice(-5);
    if (lessons.length) {
      lessonLines = lessons
        .map(l => `- ${l.instrument} ${l.direction || ''}: ${l.failure_reason || ''} → lesson: ${l.lesson || ''}`)
        .join('\n');
    }
  } catch { /* ignore */ }

  return `CURRENT SCANNER SIGNALS (from ARIS Quantum v6):\n${sigLines}

CAPITAL FLOW (where money rotates, 1d % change):\n${flowLines}

RECENT POST-MORTEM LESSONS (from past SL hits — what went wrong):\n${lessonLines}`;
}

const ROLE = `You are the ARIS Crypto Coach — an experienced, direct crypto analyst embedded inside the user's "AI Trading Analyzer" (ARIS Quantum v6 strategy: SMC/ICT concepts, OTE zones, R-multiple, squeeze-phase hard gate, directional-edge gate).

Your job: discuss the market, specific coins, and the user's own scanner signals in plain Greek (the user is Greek — always reply in Greek). Be concise, honest, and technically deep. Call out risk. Never guarantee outcomes. Reference the user's own data (scanner signals, capital flow, lessons) when relevant. If asked about a coin not in the signals, give a framework + what to watch, not a promise.

Keep replies tight (3-6 sentences unless the user asks for depth).`;

// message: string, history: [{role:'user'|'assistant', content:string}]
export async function chatWithAI(message, history = []) {
  const ctx = await buildContext();
  const systemPrompt = `${ROLE}\n\n=== LIVE SYSTEM CONTEXT (do not repeat verbatim; use it to ground answers) ===\n${ctx}`;
  const messages = [...history.slice(-10), { role: 'user', content: message }];
  return await askAI(systemPrompt, messages);
}
