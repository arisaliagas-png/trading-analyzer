import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

import { getCapitalFlow } from './capitalFlow.js';

// ─────────────────────────────────────────────
// ZOD SCHEMAS — Validate every AI response before trusting it.
// Catches schema mismatches immediately instead of silently writing bad data.
// ─────────────────────────────────────────────

// Post-mortem (tradeTracker.js → triggerPostMortem)
const PostMortemSchema = z.object({
  failureReason: z.string().min(5),
  lesson:        z.string().min(5)
});

// Win review (tradeTracker.js → triggerWinReview) — analyse a SUCCESS that
// closed with less R than its plan promised, to learn missed-R lessons.
const WinReviewSchema = z.object({
  missedReason: z.string().min(5),
  lesson:       z.string().min(5)
});

// Scanner verification (scanner.js → verifySignal)
const ScannerVerifySchema = z.object({
  setupStatus:     z.enum(['ACTIVE', 'PENDING', 'WAIT']),
  confidenceGrade: z.enum(['A+', 'A', 'B+', 'B', 'C', 'D']),
  confidencePct:   z.number().min(0).max(100),
  reasoning:       z.string()
});

// Second-opinion (devil's advocate)
const SecondOpinionSchema = z.object({
  verdict:             z.enum(['confirm', 'reject', 'caution']),
  verdictReason:       z.string(),
  challengePoints:     z.array(z.string()),
  alternativeBias:     z.enum(['bullish', 'bearish', 'neutral']),
  alternativeScenario: z.string(),
  confidence:          z.number().min(0).max(100),
  reasoning:           z.string()
});

// Main chart analysis (loose — many optional fields)
const AnalysisSchema = z.object({
  methodology:     z.string().optional(),
  bias:            z.enum(['bullish', 'bearish', 'neutral']),
  setupStatus:     z.enum(['ACTIVE', 'PENDING', 'WAIT']),
  confidenceGrade: z.enum(['A+', 'A', 'B+', 'B', 'C', 'D']),
  confidencePct:   z.number().min(0).max(100),
  hardVeto:        z.boolean().optional()
}).passthrough(); // allow extra fields (entry, sl, targets, etc.)

// ─── Schema selector by call type ───
function pickSchema(hints) {
  if (hints === 'POST_MORTEM_OVERRIDE')   return PostMortemSchema;
  if (hints === 'WIN_REVIEW_OVERRIDE')    return WinReviewSchema;
  if (hints === 'SCANNER_VERIFY')         return ScannerVerifySchema;
  if (hints === 'SECOND_OPINION')         return SecondOpinionSchema;
  return AnalysisSchema;
}

// ─── Validate parsed JSON against the appropriate schema ───
function validateAIResponse(parsed, hints) {
  const schema = pickSchema(hints);
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new Error(`AI response schema validation failed [${hints || 'ANALYSIS'}]: ${issues}`);
  }
  return result.data;
}

const SYSTEM_INSTRUCTIONS = `
You are the elite proprietary quant trading analyst executing the "ARIS Quantum Strategy Protocol (v6.0 - Ultimate Edition)" with a PREDICTIVE FLOW CONFLUENCE engine. Your task is to analyze market charts, detect visual indicators from the "6_ULTIMATE" dashboard, blend them with live API metrics, and anticipate high-probability trade setups BEFORE breakouts occur by tracking institutional money flow, funding rates, open interest, and delta footprints.

You are NOT a general assistant. Never include disclaimers, warnings, or personal opinions. Output ONLY valid JSON.

═══════════════════════════════════════════════════════════
SECTION 1 — DATA SOURCES & PRIORITIZATION
═══════════════════════════════════════════════════════════

You receive data from three sources. Prioritize them as follows:
1. VISUAL DASHBOARD (6_ULTIMATE): If the chart screenshot contains the "6_ULTIMATE" dashboard, read values directly from the image ONLY for elements not covered by the ARIS QUANTUM ENGINE block (see below) — e.g. visual patterns, auto trend lines, harmonic structures, BSL/SSL sweeps, and FRVP volume profile nodes. For any numeric indicator or price level value that the ARIS QUANTUM ENGINE block also provides (MEGA SCORE, MFI, CVD, WaveTrend, Regime, Entry, SL, TPs, etc.), the engine value always wins.
2. LIVE TECHNICAL INDICATORS (indicatorContext): If the dashboard is not present, use the text-based indicator data injected by the backend (calculated from live candles).
3. LIVE ORDERBOOK/HEATMAP (orderbookContext): Always use this for real-time bid/ask walls, order pressure, Cumulative Volume Delta (CVD) confirmations, live 1-min footprint profile, and active limit absorption.

▸ CRITICAL — ARIS QUANTUM ENGINE BLOCK (authoritative override):
  If the indicatorContext includes an "ARIS QUANTUM ENGINE" block, those numbers and levels are computed in real-time from raw OHLCV data by a verified mathematical engine.
  - MEGA SCORE, IDC Status, Regime, Threshold, Confidence%, UFO Fusion, CVD, MFI, WaveTrend, Hybrid Osc, Z-Score, SM Trap, Benford: USE THE ENGINE VALUES. Do NOT attempt to re-read or override these from the dashboard image.
  - SWING HIGH, SWING LOW, OTE ENTRY, OTE SL, OTE TP1, OTE TP2: You MUST populate the output JSON "entry", "sl", and "targets" fields directly using these computed levels whenever setupStatus is "ACTIVE" or "PENDING". Never attempt to extract these numerical price levels from the visual chart or guess them.
  - Vision (chart image) is to be used ONLY for purely visual elements: candle shape, zone geometry, trendlines, visual OTE zone overlays, BSL/SSL sweeps, and any visual confluence not captured by the engine.
  - If the engine value/level and the image value/level appear to differ, TRUST THE ENGINE.

═══════════════════════════════════════════════════════════
SECTION 2 — PREDICTIVE FLOW CONFLUENCE MODEL
═══════════════════════════════════════════════════════════

Instead of wait-and-see (reactive trading), you must analyze leading indicators of accumulation/distribution to forecast setups near key levels:

▸ 1. REGIME FILTER (First Step)
  - TREND regime: ADX ≥ 25 AND Choppiness < 61.8. Dynamic Threshold = 14
  - RANGE regime: ADX < 25 OR Choppiness is moderate. Dynamic Threshold = 18
  - CHOPPY regime: ADX < 15 OR Choppiness ≥ 61.8. Dynamic Threshold = 22
  - If regime is CHOPPY and Mega Score is weak, trigger Hard Veto immediately.

▸ 2. MONEY FLOW & CVD ACCUMULATION (Leading Indicators)
  - Look for divergences between Price and Money Flow (CVD / MFI):
    • Bullish Divergence: Price making lower lows but CVD making higher lows, or MFI rising above 55 while price consolidates. This indicates institutional accumulation (Smart Money buying under the radar).
    • Bearish Divergence: Price making higher highs but CVD making lower highs, or MFI dropping below 45 while price rises. This indicates distribution (selling).
  - CVD trend confirms bias direction: positive/rising CVD = buy dominance, negative/falling CVD = sell dominance.

▸ 3. REAL-TIME HEATMAP & LIQUIDITY MAGNETS
  - Orderbook Bid/Ask Walls act as support/resistance and price magnets:
    • Large Bid Wall within 0.5% below current price = strong demand limit order cluster. If CVD is stabilizing/turning up, this is a high-probability LONG entry trigger.
    • Large Ask Wall within 0.5% above current price = supply limit order cluster. Place TP1 slightly below this wall to ensure fills.
  - If actual heatmap walls conflict with Pine Script structural drawings (BSL/SSL lines), the actual orderbook walls ALWAYS override the drawings.

▸ 4. [NEW V6.0] FUNDING RATE & OPEN INTEREST COMBO MODULE
  Analyze the derivatives regime to capture leverage squeezes and positioning:
    • 🚀 SHORT SQUEEZE: Funding Rate (FR) is Extreme Negative (below -0.01%) AND Open Interest (OI) is Rising. Heavy short liquidations/covering fuel immediate upside reversal. Highly bullish confluence.
    • 📈 BULL BUILD: FR is Negative AND OI is Rising. Longs are actively building positions under cheap funding. Bullish.
    • ⚠️ OVERLEVERED: FR is Extreme Positive (above 0.05%) AND OI is Rising. Market is over-leveraged on the long side. High risk of long liquidation cascades.
    • 💥 LONG FLUSH: FR is Extreme Positive AND OI is Falling. Longs are getting flushed out. Strong bearish pressure.
    • 📄 SHORT COVER: FR is Extreme Negative AND OI is Falling. Shorts are closing/covering positions. Local bullish exhaustion or reversal.
    • ➖ NEUTRAL: Funding rate is in the neutral zone, indicating no clear leverage edge.

▸ 5. [NEW V6.0] ALCHEMIC REACTION (Order Flow Sweep & Limit Absorption)
  This is the master trading strategy of the system, prioritizing footprint-level market physics over visual drawings:
    • Trigger: Active BUY_ABSORPTION or SELL_ABSORPTION detected at a specific price level.
    • Bullish Alchemy: Price sweeps recent lows (liquidity run) and is met with a BUY_ABSORPTION signal (aggressive sellers absorbed by institutional passive buyers). This triggers an immediate LONG setup with a tight Stop Loss right below the absorption node.
    • Bearish Alchemy: Price sweeps recent highs and is met with a SELL_ABSORPTION signal (aggressive buyers absorbed by institutional passive sellers). Triggers a SHORT setup with a tight Stop Loss right above the absorption node.

▸ 6. ENTRY & Fibonacci OTE (Optimal Trade Entry)
  - Do NOT draw OTE zones blindly. A setup is only valid if structure aligns with leading flow metrics (CVD, MFI, Whale Walls, Funding/OI, and Footprint Absorption).
  - Entry: Center of the OTE zone (0.618 - 0.786 retracement, centered at 0.666).
  - Stop Loss (SL): Placed at the 1.272 Fibonacci extension (hard invalidation).
  - Take Profit 1 (TP1): Swing high for LONG, Swing low for SHORT (adjusted for whale walls).
  - Take Profit 2 (TP2): 1.618 Fibonacci extension.

▸ 7. PENDING VS. ACTIVE SETUPS (The Execution Gate)
  - Active (Execute): Set "bias" to bullish or bearish ONLY if the setup is fully confirmed by structure AND leading flow metrics (Mega Score ≥ Dynamic Threshold OR IDC long/short confirmed with positive/negative CVD bias). Set "setupStatus" to "ACTIVE".
  - Pending: If structure is confirmed (e.g. valid OTE retest) but current momentum is neutral/weak, do not discard the setup. Set bias to "neutral", output the pending levels (Entry, SL, TPs) and set "setupStatus" to "PENDING".
  - Wait: If structure is invalid or indicators are in strong conflict, output bias "neutral", set entry to 0, and set "setupStatus" to "WAIT".

▸ 8. [CRITICAL HARD GATE] SQUEEZE MOMENTUM PHASE FILTER
  This is the #1 historical failure pattern in the live track record (5 of 11 closed losses).
  Squeeze Momentum has two states you MUST read correctly:
    • SQUEEZED  → energy is building, breakout is IMMINENT (direction not yet confirmed).
    • RELEASED → the breakout has ALREADY fired and is in motion.
  HARD RULE (non-negotiable, overrides MEGA SCORE):
    • If your intended direction is LONG  and Squeeze is SQUEEZED+BEARISH  → HARD VETO / WAIT. Do NOT enter.
    • If your intended direction is LONG  and Squeeze is RELEASED+BEARISH → HARD VETO / WAIT. Do NOT enter.
    • If your intended direction is SHORT and Squeeze is SQUEEZED+BULLISH → HARD VETO / WAIT. Do NOT enter.
    • If your intended direction is SHORT and Squeeze is RELEASED+BULLISH → HARD VETO / WAIT. Do NOT enter.
  In short: the Squeeze phase/direction MUST align with your trade bias. A Squeeze firing against you means the move already happened or is about to fire opposite — entering is a bear/ bull trap.
  Exception: only a confirmed liquidity sweep (BSL/SSL break) on the higher timeframe may justify overriding this gate, and even then downgrade to PENDING, never ACTIVE.

═════════════════════════════════════════════════
SECTION 3 — CONFIDENCE GRADES & POSITION SIZING
═══════════════════════════════════════════════════════════

Calculate a weighted confidence percentage (0-100%) based on confluence alignment. Map to grades:
  • Grade A+ (≥ 90%): 1.0% risk per trade. (High confluence: OTE/Alchemic Zone + positive MFI/CVD + Whale Bid Wall + Bullish Funding/OI combo).
  • Grade A (80-89%): 0.75% risk per trade.
  • Grade B+ (70-79%): 0.5% risk per trade.
  • Grade B (60-69%): 0.5% risk per trade (reduced position size).
  • Grade C (45-59%): 0% risk. Monitor only.
  • Grade D (< 45%): 0% risk. Hard No-Trade.

*RISK SAFETY RULE: If "setupStatus" is "PENDING" or "WAIT", the "positionSizePct" MUST be 0, regardless of the computed confidenceGrade or confidencePct.*

═══════════════════════════════════════════════════════════
SECTION 4 — MTF BIAS CONFIRMATION (Multi-Timeframe EMA200)
═══════════════════════════════════════════════════════════

When the indicatorContext includes a "MULTI-TIMEFRAME BIAS (EMA200)" line, use it as follows:

The MTF Score is calculated from the alignment of Price vs EMA200 across 3-4 timeframes (LTF, Current, HTF1, HTF2). Each timeframe contributes +1 (BULL) or -1 (BEAR).

▸ SCORE INTERPRETATION & EFFECT ON SETUP STATUS:
  - Score +3 or +4 (Full Bull Alignment): Strong confirmation for LONG setups. Supports upgrading a PENDING to ACTIVE if other confluences align.
  - Score +2 (Lean Bullish): Moderate confirmation. LONG setups can proceed as ACTIVE only with IDC confirmation.
  - Score +1 to -1 (Mixed / Neutral): Conflicting timeframes. DOWNGRADE any setup to PENDING, even if single-TF structure looks executable. State "MTF bias mixed — awaiting alignment" in reasoning.
  - Score -2 (Lean Bearish): Moderate confirmation for SHORT. SHORT setups can be ACTIVE; LONG setups must be PENDING or WAIT.
  - Score -3 or -4 (Full Bear Alignment): Strong confirmation for SHORT setups. LONG setups receive a Hard Conflict flag (treat as WAIT unless there is a confirmed liquidity sweep reversal).

▸ MTF BIAS CONFLICT RULE:
  - If the setup direction (e.g. bullish) CONTRADICTS the HTF bias (e.g. 4H and 1D are BEAR), classify the zone as "CONFLICT" and trigger Hard Veto Rule #2, unless a clear liquidity sweep (BSL/SSL break) has occurred on the higher timeframe to justify a reversal.

▸ HOW TO REFERENCE IN OUTPUT:
  - Include the MTF Score and key TF biases inside the "indicators" array (e.g. "MTF Score: -1/4 (Mixed)", "4H: BEAR (Price < EMA200 $64500)").
  - Mention MTF alignment impact in the "reasoning" field.

▸ MTF DATA UNAVAILABLE FALLBACK:
  - If the MTF data string reads "MTF DATA UNAVAILABLE", treat the timeframe bias as neutral/mixed (score = 0).
  - Do NOT upgrade any setup to ACTIVE based on MTF data alone when data is missing.
  - Proceed using single-timeframe analysis only, and note in reasoning: "MTF data unavailable — analysis based on current TF only."

═══════════════════════════════════════════════════════════
SECTION 5 — HARD VETO RULES (IMMEDIATE NO-TRADE)
═══════════════════════════════════════════════════════════

Trigger a Hard Veto (set "hardVeto" to true) if any of the following are met:
1. Benford's Law anomaly detected in volume distribution (volume manipulation risk).
2. Zone is in "CONFLICT" (structure and HTF bias disagree), UNLESS a clear liquidity sweep (SSL/BSL run), equal highs/lows sweep, or active limit absorption (Alchemic Reaction) is identified as a reversal catalyst.
3. Confidence Grade is D (< 45%).
4. Market is in CHOPPY regime AND Mega Score is below Threshold - 3.

═══════════════════════════════════════════════════════════
SECTION 6 — OUTPUT JSON FORMAT (STRICT)
═══════════════════════════════════════════════════════════

Return ONLY a single valid JSON object. No markdown, no fences, no additional prose.
If entry is 0 (no setup), targets and SL must also be 0. Otherwise, "entry" must be returned as an object representing the Entry Zone: {"low": number, "high": number, "price": ideal_number}.

{
  "methodology": "ARIS_QUANTUM_V6",
  "instrument": "Auto-detected trading pair (e.g. BTC/USDT)",
  "timeframe": "Auto-detected timeframe (e.g. 1H)",
  "bias": "bullish|bearish|neutral",
  "setupStatus": "ACTIVE|PENDING|WAIT",
  "megaScore": "Detected score (e.g. 18/31) or computed equivalent",
  "regime": "TREND|RANGE|CHOPPY",
  "dynThreshold": 18,
  "confidenceGrade": "A+|A|B+|B|C|D",
  "confidencePct": 82,
  "idcStatus": "LONG_CONFIRMED|SHORT_CONFIRMED|NONE",
  "frRegime": "EXTREME +|EXTREME -|POSITIVE|NEGATIVE|NEUTRAL",
  "frOiSignal": "🚀 SHORT SQUEEZE|📈 BULL BUILD|⚠️ OVERLEVERED|💥 LONG FLUSH|📄 SHORT COVER|➖ NEUTRAL",
  "patterns": ["e.g. Auto-Fib OTE Zone", "Harmonic Pattern (Gartley)", "CVD Bullish Divergence", "..."],
  "indicators": ["e.g. EMA20/50/200 crossover status", "RSI/MACD readings", "Whale wall detection", "..."],
  "support": [level1, level2],
  "resistance": [level1, level2],
  "entry": {"low": number, "high": number, "price": number},
  "sl": number,
  "targets": [tp1, tp2],
  "positionSizePct": number_percentage_literal_not_fraction,
  "reasoning": "4-6 sentences: Detail the Mega Score vs Threshold, state the IDC status, Regime, and Funding/OI Combo signal. Justify OTE/Alchemic levels, confirm system agreement, explain how orderbook/indicators support/veto the trade, and define the SL validation logic.",
  "hardVeto": false,
  "hardVetoReason": "Explanation of veto or null",
  "overlay": {
    "priceMin": lowest_price_visible,
    "priceMax": highest_price_visible,
    "entryY": entry_y_fraction_0_to_1,
    "targetsY": [tp1_y_fraction, tp2_y_fraction],
    "slY": sl_y_fraction_0_to_1,
    "supportY": [sup1_y, sup2_y],
    "resistanceY": [res1_y, res2_y]
  }
}

*Note on positionSizePct format: Return the literal percent value (e.g., return 1.0 for 1% risk, 0.75 for 0.75% risk, 0.50 for 0.5% risk, 0 for no trade). NEVER return fractional values like 0.01 for 1% risk.*

Use formula: Y = 1.0 - ((price - priceMin) / (priceMax - priceMin)) to map levels onto the overlay chart (0.0 = top/highest price, 1.0 = bottom/lowest price). This is because canvas Y-coordinates start at 0 at the top and end at 1 at the bottom.

═══════════════════════════════════════════════════════════
SECTION 7 — NEWS & MACRO CONTEXT (if provided)
═══════════════════════════════════════════════════════════

If a "MARKET NEWS SUMMARY" or "RECENT ARTICLES" block is included in the user prompt:

▸ Rules for news usage:
  - News is a CONFIRMATION LAYER only — it does NOT override the ARIS QUANTUM ENGINE or the OTE levels.
  - If news is POSITIVE and the engine bias is BULLISH → increase confidence by up to 5%, mention in reasoning.
  - If news is NEGATIVE and the engine bias is BEARISH → increase confidence by up to 5%, mention in reasoning.
  - If news CONTRADICTS the engine bias → mention the contradiction explicitly in reasoning, but KEEP the engine bias. Reduce confidence by up to 5% as extra caution.
  - If the news mentions a major macro event (Fed rate decision, CPI data, SEC ruling, major hack/exploit) → flag it as a RISK EVENT in the reasoning and set setupStatus to "PENDING" unless setup is already confirmed by all other signals.
  - NEVER change the direction (bullish/bearish/neutral) based on news alone.
  - Do NOT cite article URLs or source names in the output. Summarize the news impact in 1-2 sentences only.
`;






// --- Lightweight system prompt for text-only structured JSON calls ---
// Used for post-mortem analysis (tradeTracker.js) and scanner AI verification (scanner.js).
// IMPORTANT: these calls send their own complete task description + JSON schema inside the
// user prompt. They must NOT reuse SYSTEM_INSTRUCTIONS, which forces a totally different
// output schema (the full ARIS chart-analysis JSON) and reliably breaks JSON.parse() on the
// caller side — this was silently causing every post-mortem lesson to fall back to the
// generic default text.
const TEXT_JSON_SYSTEM_PROMPT = `
You are a precise quantitative trading assistant operating in text-only mode (no chart image).
You will be given a task description and an exact JSON schema to follow.

Rules:
- Return ONLY a single valid JSON object matching the schema given in the user message.
- No markdown code fences, no preamble, no explanation, no disclaimers — JSON only.
- Base your answer strictly on the data provided in the user message. Do not invent data.
- If the user message references an "ARIS QUANTUM ENGINE" data block, treat those values as
  authoritative and computed — do not question or recompute them.
`;

const SECOND_OPINION_INSTRUCTIONS = `
You are a contrarian technical analyst acting as a DEVIL'S ADVOCATE. 
You have been shown a chart and the initial analysis from another analyst.

Your job is to:
1. CHALLENGE the original setup — find structural reasons it could FAIL
2. Look for opposing signals, hidden patterns, or overlooked risks
3. Give your honest verdict: do you CONFIRM or REJECT the original trade setup?

▸ CRITICAL — ARIS QUANTUM ENGINE BLOCK (authoritative override):
  If the indicatorContext includes an "ARIS QUANTUM ENGINE" block, those numbers and levels are computed in real-time from raw OHLCV data by a verified mathematical engine.
  - MEGA SCORE, IDC Status, Regime, Threshold, Confidence%, UFO Fusion, CVD, MFI, WaveTrend, Hybrid Osc, Z-Score, SM Trap, Benford: USE THE ENGINE VALUES. Do NOT attempt to re-read or override these from the dashboard image.
  - SWING HIGH, SWING LOW, OTE ENTRY, OTE SL, OTE TP1, OTE TP2: Use these computed levels when evaluating the trade structure. Do not reject or challenge a setup based on visual discrepancy if the engine mathematical data supports the entry, SL, and targets.
  - If the engine value/level and the image value/level appear to differ, TRUST THE ENGINE. Do not reject the setup based on OCR vision inaccuracies if the engine data confirms it.

Be concise, sharp, and direct. Return ONLY this JSON:
{
  "verdict": "confirm|reject|caution",
  "verdictReason": "One sentence summary of your verdict",
  "challengePoints": ["risk 1", "risk 2", "risk 3"],
  "alternativeBias": "bullish|bearish|neutral",
  "alternativeScenario": "What could happen instead",
  "confidence": number_0_to_100,
  "reasoning": "2-3 sentences of your contrarian take"
}
`;

// --- Helper to call the configured AI provider ---
// ── Free-form chat (AI Coach) ──
// Plain-text, multi-turn. No JSON mode, no Zod validation, no image. Used by the
// in-app AI Coach so the user can discuss the market using their own system's data
// (scanner signals, capital flow, lessons) as context. Cheap by design: small system
// prompt + capped history (caller should pass last ~10 messages).
export async function askAI(systemPrompt, messages, forceProvider = null) {
  const provider = forceProvider || process.env.AI_PROVIDER || 'gemini';

  if (provider === 'anthropic') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured.');
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 2000,
        system: systemPrompt,
        messages
      })
    });
    if (!response.ok) {
      const e = await response.text();
      throw new Error(`Anthropic API HTTP Error [${response.status}]: ${e}`);
    }
    const data = await response.json();
    const textBlock = (data.content || []).find(c => c.type === 'text');
    return textBlock?.text || '';
  } else if (provider === 'gemini') {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not configured.');
    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents, systemInstruction: { parts: [{ text: systemPrompt }] } })
      }
    );
    if (!response.ok) {
      const e = await response.text();
      throw new Error(`Gemini API Error: [${response.status}] ${e}`);
    }
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  } else if (provider === 'openrouter') {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured.');
    // OpenAI-compatible chat completions. Free models available (see OPENROUTER_MODEL).
    const FREE_FALLBACKS = [
      'google/gemma-4-31b-it:free',
      'nvidia/nemotron-3.5-lightning:free',
      'z-ai/glm-5.2:free'
    ];
    const configured = process.env.OPENROUTER_MODEL;
    const candidates = [configured, ...FREE_FALLBACKS].filter(Boolean);
    const oaMessages = [{ role: 'system', content: systemPrompt }, ...messages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content
    }))];
    let upstreamRetryAfter = 0;
    const attempted = new Set();
    for (let modelIdx = 0; modelIdx < candidates.length; modelIdx++) {
      const model = candidates[modelIdx];
      attempted.add(model);
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'HTTP-Referer': 'https://trading-analyzer-affqwq.fly.dev',
            'X-Title': 'ARIS Trading Analyzer'
          },
          body: JSON.stringify({ model, messages: oaMessages, max_tokens: 2000, temperature: 0.7 })
        });
        if (response.ok) {
          const data = await response.json();
          return data.choices?.[0]?.message?.content || '';
        }
        const body = await response.text();
        if (response.status === 429 && attempt === 0) {
          const m = body.match(/"retry_after_seconds":(\d+)/);
          const wait = m ? (parseInt(m[1], 10) || 5) : 5;
          if (wait > upstreamRetryAfter) upstreamRetryAfter = wait;
          await new Promise(r => setTimeout(r, wait * 1000));
          continue;
        }
        break;
      }
    }
    const tried = [...attempted].join(', ');
    throw new Error(`OpenRouter API Error: free models exhausted (${tried}) after ${upstreamRetryAfter}s`);
  }
  throw new Error(`Unsupported AI provider: ${provider}`);
}

async function callAI(systemPrompt, userContent, mimeType = null, imageBuffer = null, forceProvider = null, hints = null) {
  const provider = forceProvider || process.env.AI_PROVIDER || 'gemini';

  // Always normalize MIME type to avoid API rejection
  if (mimeType) {
    const ACCEPTED = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const normalized = mimeType.split(';')[0].trim().toLowerCase();
    mimeType = ACCEPTED.includes(normalized) ? normalized : 'image/png';
  }

  let parsed;

  if (provider === 'gemini') {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not configured.');

    const parts = [{ text: userContent }];
    if (imageBuffer && mimeType) {
      parts.push({ inlineData: { mimeType, data: imageBuffer.toString('base64') } });
    }

    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { responseMimeType: 'application/json' }
      })
    });

    if (!response.ok) {
      const e = await response.text();
      throw new Error(`Gemini API Error: [${response.status}] ${e}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Empty response from Gemini API.');
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Response did not contain valid JSON.');
    parsed = JSON.parse(match[0]);

  } else if (provider === 'anthropic') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured.');

    const content = [];
    if (imageBuffer && mimeType) {
      content.push({ type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBuffer.toString('base64') } });
    }
    content.push({ type: 'text', text: userContent });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 16000,
        system: systemPrompt,
        messages: [{ role: 'user', content }]
      })
    });

    if (!response.ok) {
      const e = await response.text();
      console.error('Anthropic API HTTP Error:', response.status, e);
      throw new Error(`Anthropic API HTTP Error [${response.status}]: ${e}`);
    }

    const data = await response.json();
    const textBlock = (data.content || []).find(c => c.type === 'text');
    const text = textBlock?.text;

    if (!text) {
      console.error('Raw Anthropic Response (no text block found):', JSON.stringify(data, null, 2));
      throw new Error('Empty response from Anthropic API.');
    }

    const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const match = cleanText.match(/\{[\s\S]*\}/);
    if (!match) {
      console.error('Raw Claude text output:', text);
      throw new Error('Claude response did not contain valid JSON structure.');
    }
    try {
      parsed = JSON.parse(match[0]);
    } catch (parseErr) {
      console.error('Failed to parse Claude JSON. Raw text:', text);
      throw new Error(`JSON parsing failed: ${parseErr.message}`);
    }

  } else {
    throw new Error(`Unsupported AI provider: ${provider}`);
  }

  // ── Zod schema validation (throws immediately on mismatch) ──
  return validateAIResponse(parsed, hints);
}

// --- Primary analysis ---
export async function analyzeChart(imageBuffer, mimeType, pair = '', timeframe = '', hints = '', orderbookContext = null, indicatorContext = null, newsContext = null, forceProvider = null) {
  const tfInstruction = timeframe
    ? `IMPORTANT: The user has confirmed the timeframe is "${timeframe}". Use this exact timeframe — do NOT override it.`
    : `Auto-detect the timeframe from the chart's UI (look for the timeframe button/label in the top-left of the chart).`;

  const obSection = orderbookContext
    ? `\n\nREAL-TIME ORDER BOOK DATA (use this to enhance your analysis):\n${orderbookContext}\nConsider these live levels when determining entry, SL and TP. Whale walls often act as strong support/resistance. Order pressure bias should reinforce or challenge chart bias.`
    : '';

  const indSection = indicatorContext
    ? `\n\nLIVE TECHNICAL INDICATORS DATA (extracted from live market candles):\n${indicatorContext}\nCompare price relative to EMA20, EMA50 and EMA200. Check RSI overbought/oversold levels and MACD momentum direction. ADX value indicates trend strength. Point of Control (POC) shows heavy volume node.`
    : '';

  const newsSection = newsContext
    ? `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nREAL-TIME NEWS & MACRO CONTEXT (Tavily — last 24h, use per Section 7 rules):\n${newsContext}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    : '';

  // ── Capital Flow Map (asset-class rotation via Twelve Data) ──
  let flowSection = '';
  try {
    const flow = await getCapitalFlow();
    if (flow?.available && Array.isArray(flow.classes) && flow.classes.length) {
      const lines = flow.classes
        .filter(c => c.available !== false)
        .map(c => {
          const arrow = c.score > 0 ? '▲ INFLOW' : c.score < 0 ? '▼ OUTFLOW' : '■ NEUTRAL';
          const extra = c.change7d != null ? ` (7d ${c.change7d > 0 ? '+' : ''}${c.change7d}%)` : '';
          return `  • ${c.label}: ${arrow} ${c.change1d > 0 ? '+' : ''}${c.change1d}% 1d${extra}  [${c.symbol}]`;
        });
      if (lines.length) {
        const nl = '\n';
        let fgLine = '';
        if (flow.fearGreed?.available) {
          const fg = flow.fearGreed;
          const tag = fg.value >= 75 ? 'EXTREME GREED' : fg.value >= 50 ? 'GREED' : fg.value >= 25 ? 'FEAR' : 'EXTREME FEAR';
          fgLine = nl + '  🧠 CRYPTO FEAR & GREED INDEX: ' + fg.value + '/100 (' + tag + ') — ' + (fg.signal >= 1 ? 'risk-on bias, watch for euphoria/reversal' : fg.signal <= -1 ? 'risk-off / capitulation zone, watch for bottoms' : 'neutral sentiment') + '.';
        }
        const head = '💰 CAPITAL FLOW MAP (where money is rotating across asset classes, last 24h):';
        const tail = 'Interpretation: If capital is flowing OUT of crypto into metals/USD, reduce long conviction. If flowing INTO crypto, it supports risk-on setups. Use as a macro tailwind/headwind filter on your bias. Cross-reference with the Fear & Greed signal above.';
        flowSection = nl + nl + head + nl + lines.join(nl) + fgLine + nl + tail;
      }
    }
  } catch (e) {
    // Non-fatal: analysis proceeds without flow context if API fails
    console.error('[aiProvider] capital flow fetch failed:', e.message);
  }

  // ─── INTEGRATE AI LESSONS LEARNED FEEDBACK LOOP (reads from SQLite) ───
  let lessonsSection = '';
  try {
    const { getLessonsFor, getAllLessons, getDirectionalEdge } = await import('./db.js');
    
    // 0. Directional Edge Gate — bias the AI toward the statistically
    // stronger direction and demand stricter confluence for the weak one.
    let edgeSection = '';
    try {
      const edge = getDirectionalEdge();
      const longWR  = edge.LONG?.winRate;
      const shortWR = edge.SHORT?.winRate;
      const longN   = edge.LONG?.total || 0;
      const shortN  = edge.SHORT?.total || 0;

      if (longN >= 5 || shortN >= 5) {
        const lines = [];
        if (longWR != null)  lines.push(`LONG:  ${longWR}% win rate (${edge.LONG.wins}W / ${edge.LONG.losses}L over ${longN} closed)`);
        if (shortWR != null) lines.push(`SHORT: ${shortWR}% win rate (${edge.SHORT.wins}W / ${edge.SHORT.losses}L over ${shortN} closed)`);

        let rule = '';
        if (longWR != null && shortWR != null && Math.abs(longWR - shortWR) >= 10) {
          const weak = longWR < shortWR ? 'LONG' : 'SHORT';
          const strong = longWR < shortWR ? 'SHORT' : 'LONG';
          const weakWR = Math.min(longWR, shortWR);
          rule = `\nDIRECTIONAL EDGE RULE: Your historical ${weak} win rate (${weakWR}%) is materially weaker than ${strong} (${Math.max(longWR, shortWR)}%). ` +
                 `Therefore: PREFER ${strong} setups. For any ${weak} setup you still consider, you MUST require a STRONGER confluence than usual ` +
                 `(MEGA SCORE must clear the Dynamic Threshold by at least +3, and HTF/MTF bias must confirm — no mixed-timeframe ${weak} setups). ` +
                 `If the ${weak} confluence is merely "okay", downgrade to PENDING or trigger WAIT/HARD VETO. Do NOT force a ${weak} trade to hit an A/B grade.`;
        } else {
          rule = `\nDIRECTIONAL EDGE RULE: Both directions show comparable win rates — no directional penalty applies. Evaluate each setup on its own confluence.`;
        }

        edgeSection = `\n\n═══════════════════════════════════════════════════════════\n` +
          `[DIRECTIONAL EDGE — YOUR LIVE TRACK RECORD]\n` +
          lines.join('\n') + '\n' + rule;
      }
    } catch (e) {
      console.warn('[Learning Loop] Failed to load directional edge:', e.message);
    }

    // 1. Asset-Specific Lessons
    const longLessons  = getLessonsFor(pair, 'LONG');
    const shortLessons = getLessonsFor(pair, 'SHORT');
    const localLessons = [...longLessons, ...shortLessons]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 2);

    // 2. Global Rules (Lessons from other assets)
    const allSystemLessons = getAllLessons();
    const globalLessons = allSystemLessons
      .filter(l => l.instrument.toUpperCase() !== pair.toUpperCase())
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 3);

    let blocks = [];

    if (localLessons.length > 0) {
      blocks.push(
        `═══════════════════════════════════════════════════════════\n` +
        `[ASSET CONSTRAINTS] PAST FAILED TRADES FOR ${pair.toUpperCase()}:\n` +
        localLessons.map((l, i) =>
          `Local Rule #${i+1}: If ${l.failure_reason}, AVOID this trade. Instruction: "${l.lesson}"`
        ).join('\n')
      );
    }

    if (globalLessons.length > 0) {
      blocks.push(
        `═══════════════════════════════════════════════════════════\n` +
        `[GLOBAL SYSTEM CONSTRAINTS] LESSONS SHARED FROM OTHER CRYPTO ASSETS:\n` +
        globalLessons.map((l, i) =>
          `Global Rule #${i+1} (Learned from ${l.instrument}): If ${l.failure_reason}, AVOID this trade. Instruction: "${l.lesson}"`
        ).join('\n')
      );
    }

    if (blocks.length > 0) {
      lessonsSection = '\n\n' + blocks.join('\n\n') + 
        `\n\nApply these negative confluences immediately. Adjust scores downwards or trigger a hard veto (WAIT status) if the current indicators match any local or global failure conditions.`;
    }
    // Always append the directional edge gate (independent of failure lessons).
    if (edgeSection) {
      lessonsSection = (lessonsSection ? lessonsSection + '\n' : '') + edgeSection;
    }
  } catch (err) {
    console.warn('[Learning Loop] Failed to load lessons from DB:', err.message);
  }

  const systemInstructionsWithLessons = SYSTEM_INSTRUCTIONS + lessonsSection;

  const userPrompt = (hints === 'POST_MORTEM_OVERRIDE' || hints === 'SCANNER_VERIFY')
    ? indicatorContext
    : `
Analyze the attached chart image.
${tfInstruction}
${hints ? `User focus: "${hints}"` : ''}${obSection}${indSection}${newsSection}${flowSection}

Follow system instructions and output the JSON result.
  `;

  if (hints === 'POST_MORTEM_OVERRIDE') {
    // Post-mortem: text-only, AI diagnoses a trade failure and produces lesson
    return callAI(TEXT_JSON_SYSTEM_PROMPT, userPrompt, null, null, forceProvider, 'POST_MORTEM_OVERRIDE');
  }

  if (hints === 'SCANNER_VERIFY') {
    // Scanner verification: text-only, AI verifies a scan candidate setup
    // Uses TEXT_JSON_SYSTEM_PROMPT so the caller's task prompt+schema isn't overridden
    // Validates against ScannerVerifySchema (setupStatus, confidenceGrade, confidencePct, reasoning)
    return callAI(TEXT_JSON_SYSTEM_PROMPT, userPrompt, null, null, forceProvider, 'SCANNER_VERIFY');
  }

  console.log('=== FULL PROMPT SENT TO AI ===');
  console.log(userPrompt);
  console.log('=== END PROMPT ===');

  return callAI(systemInstructionsWithLessons, userPrompt, mimeType, imageBuffer, forceProvider, hints || 'ANALYSIS');
}


// --- Second opinion (devil's advocate) ---
export async function getSecondOpinion(imageBuffer, mimeType, originalResult, pair = 'unknown', timeframe = 'unknown', indicatorContext = null) {
  console.log('=== SECOND OPINION CALLED ===');  // ← πρόσθεσε αυτό
  const indSection = indicatorContext
    ? `\n\nLIVE TECHNICAL INDICATORS DATA:\n${indicatorContext}`
    : '';

  const userPrompt = `
Chart: ${pair} on ${timeframe} timeframe.
${indSection}

The primary analyst concluded:
- Bias: ${originalResult.bias?.toUpperCase()}
- Methodology: ${originalResult.methodology}
- Entry: ${originalResult.entry}
- Stop Loss: ${originalResult.sl}
- Targets: ${originalResult.targets?.join(', ')}
- Strength score: ${originalResult.strength}/100
- Primary reasoning: ${originalResult.reasoning}

Review the same chart image and challenge this analysis. Find what could go wrong.
Return your contrarian JSON verdict.
  `;
  return callAI(SECOND_OPINION_INSTRUCTIONS, userPrompt, mimeType, imageBuffer, null, 'SECOND_OPINION');
}