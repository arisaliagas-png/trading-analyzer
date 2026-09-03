import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

import { getCapitalFlow } from './capitalFlow.js';

// ─────────────────────────────────────────────
// ZOD SCHEMAS — Strict Validation Engine
// ─────────────────────────────────────────────

// Post-mortem (tradeTracker.js → triggerPostMortem)
const PostMortemSchema = z.object({
  failureReason: z.string().min(5),
  lesson:        z.string().min(5)
});

// Win review (tradeTracker.js → triggerWinReview)
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

// ─────────────────────────────────────────────
// Main Analysis Schema (ARIS QUANTUM v8.0)
// ─────────────────────────────────────────────
const EntrySchema = z.object({
  low:   z.number(),
  high:  z.number(),
  price: z.number()
});

const AnalysisSchema = z.object({
  methodology:      z.string().optional(),
  instrument:       z.string().optional(),
  timeframe:        z.string().optional(),
  bias:             z.enum(['bullish', 'bearish', 'neutral']),
  setupStatus:      z.enum(['ACTIVE', 'PENDING', 'WAIT']),
  confluenceScore:  z.string().optional(),
  earlyReversal:    z.string().optional(),
  regime:           z.enum(['TREND', 'RANGE', 'CHOPPY']).optional(),
  dynThreshold:     z.number().optional(),
  confidenceGrade:  z.enum(['A+', 'A', 'B+', 'B', 'C', 'D']),
  confidencePct:    z.number().min(0).max(100),
  rrRatio:          z.number().optional(),
  htfBias:          z.string().optional(),
  smcFvgConfluence: z.boolean().optional(),
  entry:            EntrySchema.optional(),
  sl:               z.number().optional(),
  targets:          z.array(z.number()).optional(),
  breakEvenPrice:   z.number().optional(),
  positionSizePct:  z.number().optional(),
  reasoning:        z.string(),
  hardVeto:         z.boolean().optional(),
  hardVetoReason:   z.string().nullable().optional(),
  overlay:          z.record(z.any()).optional()
}).passthrough()
  .refine(
    data => {
      // PENDING / WAIT must have positionSizePct = 0
      if ((data.setupStatus === 'PENDING' || data.setupStatus === 'WAIT') && data.positionSizePct != null) {
        return data.positionSizePct === 0;
      }
      return true;
    },
    { message: 'positionSizePct must be 0 when setupStatus is PENDING or WAIT' }
  )
  .refine(
    data => {
      // hardVeto = true must have positionSizePct = 0
      if (data.hardVeto === true && data.positionSizePct != null) {
        return data.positionSizePct === 0;
      }
      return true;
    },
    { message: 'positionSizePct must be 0 when hardVeto is true' }
  )
  .refine(
    data => {
      // ACTIVE setup must have valid non-zero entry and SL
      if (data.setupStatus === 'ACTIVE') {
        if (!data.entry || data.entry.price <= 0 || !data.sl || data.sl <= 0) {
          return false;
        }
      }
      return true;
    },
    { message: 'ACTIVE setup requires valid entry.price > 0 and sl > 0' }
  );

// ─── Schema selector by call type ───
function pickSchema(hints) {
  if (hints === 'POST_MORTEM_OVERRIDE')   return PostMortemSchema;
  if (hints === 'WIN_REVIEW_OVERRIDE')    return WinReviewSchema;
  if (hints === 'SCANNER_VERIFY')         return ScannerVerifySchema;
  if (hints === 'SECOND_OPINION')         return SecondOpinionSchema;
  return AnalysisSchema;
}

// ─── Validate parsed JSON against schema ───
function validateAIResponse(parsed, hints) {
  const schema = pickSchema(hints);
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new Error(`AI response schema validation failed [${hints || 'ANALYSIS'}]: ${issues}`);
  }
  return result.data;
}

// ─── Clean and Parse JSON Helper ───
function cleanAndParseJSON(rawText) {
  if (!rawText) throw new Error('Empty text received from AI provider.');
  const clean = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) {
    console.error('Failed to find JSON object in raw response:', rawText);
    throw new Error('AI response did not contain a valid JSON object.');
  }
  return JSON.parse(match[0]);
}

const SYSTEM_INSTRUCTIONS = `
You are an elite quantitative trading analyst executing the "ARIS Quantum Strategy Protocol (v8.0 — FIB PRO & FLOW CONFLUENCE ENGINE)". Analyze market charts, detect visual indicators, blend them with live API metrics, and identify high-probability institutional trade setups.

You are NOT a general assistant. Never include disclaimers, warnings, or personal opinions. Output ONLY valid JSON.

═══════════════════════════════════════════════════════════
SECTION 1 — DATA SOURCES & PRIORITIZATION
═══════════════════════════════════════════════════════════

You receive data from three sources, prioritized as follows:
1. VISUAL DASHBOARD & ARIS FIB LIVE PRO (V6) HUD: 
   Read values directly from the image ONLY for elements not covered by the ARIS QUANTUM ENGINE block:
   - Live Data HUD Table (Top-Right): Confluence Score (0-100%), Early Reversal (🟢 SWEEP BUY, 🔴 SWEEP SELL, ⚡ CHoCH ▲/▼), HTF Bias (4H/Daily), Setup R:R Ratio, SMC FVG in GP.
   - Visual Chart Geometry: Golden Pocket (GP BUY [0.618-0.786] green box vs GP SELL orange box), 🪤 SWEEP labels, Swing High (SH) / Swing Low (SL) anchors, auto trendlines, harmonic structures, BSL/SSL sweeps.
2. LIVE TECHNICAL INDICATORS (indicatorContext): If the dashboard is absent, use the text-based indicator data injected by the backend.
3. LIVE ORDERBOOK/HEATMAP (orderbookContext): Always use for real-time bid/ask walls, order pressure, CVD confirmations, live footprint profile, and limit absorption.

▸ CRITICAL — ARIS QUANTUM ENGINE BLOCK (authoritative override):
  If the indicatorContext includes an "ARIS QUANTUM ENGINE" block, those numbers are computed in real-time from raw OHLCV data by a verified mathematical engine.
  - MEGA SCORE, IDC Status, Regime, Threshold, Confidence%, UFO Fusion, CVD, MFI, WaveTrend, Hybrid Osc, Z-Score, SM Trap, Benford: USE THE ENGINE VALUES. Do NOT re-read from the image.
  - SWING HIGH, SWING LOW, OTE ENTRY, OTE SL, OTE TP1, OTE TP2: You MUST populate "entry", "sl", and "targets" directly from these computed levels when setupStatus is "ACTIVE" or "PENDING". Never guess from the chart image.
  - Vision is used for: candle shape, zone geometry, trendlines, visual GP/OTE overlays, and 🪤 SWEEP / ⚡ CHoCH confirmation.
  - If engine value and image value differ, TRUST THE ENGINE.

═══════════════════════════════════════════════════════════
SECTION 2 — PREDICTIVE FLOW & LIQUIDITY CONFLUENCE MODEL
═══════════════════════════════════════════════════════════

▸ 1. REGIME & HTF BIAS FILTER (First Step — mandatory)
  - TREND regime: ADX ≥ 25 AND Choppiness < 61.8. Dynamic Threshold = 14
  - RANGE regime: ADX < 25 OR Choppiness is moderate. Dynamic Threshold = 18
  - CHOPPY regime: ADX < 15 OR Choppiness ≥ 61.8. Dynamic Threshold = 22
  - If regime is CHOPPY and Mega Score is weak, trigger Hard Veto immediately.
  - HTF BIAS ALIGNMENT:
    * HTF Bias (4h / Daily) = BULL / BULL → Only LONG setups (GP BUY) allowed for ACTIVE.
    * HTF Bias (4h / Daily) = BEAR / BEAR → Only SHORT setups (GP SELL) allowed for ACTIVE.
    * If chart shows "⚠ CONFLICT vs HTF Bias" or "⚠ CONFLICT: HTF + Momentum":
      → MANDATORY HARD VETO / WAIT (do not take counter-trend trades).

▸ 2. CONFLUENCE SCORE MATRIX & TRIGGER
  - Confluence Score ≥ 70% (🟢 STRONG): High conviction setup. Can be ACTIVE if price is entering GP or printing a SWEEP/CHoCH.
  - Confluence Score 45%–69% (🟡 MODERATE): Monitor only. Setup is PENDING until orderbook/liquidity wall confirmation.
  - Confluence Score < 45% (🔴 WEAK): Hard No-Trade. Set status to "WAIT", positionSizePct = 0.

▸ 3. MONEY FLOW & CVD ACCUMULATION
  - Bullish Divergence: Price making lower lows but CVD making higher lows, or MFI rising above 55 while price consolidates → institutional accumulation.
  - Bearish Divergence: Price making higher highs but CVD making lower highs, or MFI dropping below 45 while price rises → distribution.
  - CVD trend: rising CVD = buy dominance. Falling CVD = sell dominance.

▸ 4. REAL-TIME HEATMAP & LIQUIDITY MAGNETS
  - Large Bid Wall (e.g. 50+ BTC) within 0.5% below current price + stabilizing/rising CVD = high-probability LONG trigger.
  - Large Ask Wall within 0.5% above current price = place TP1 slightly below.
  - Orderbook walls ALWAYS confirm or veto the chart levels.

▸ 5. EARLY REVERSAL & ALCHEMIC REACTION (Zero-Lag Sweeps)
  • 🪤 SWEEP BUY / BUY_ABSORPTION: Price sweeps recent lows + aggressive sellers absorbed by institutional buyers → immediate LONG, tight SL below absorption node.
  • 🪤 SWEEP SELL / SELL_ABSORPTION: Price sweeps recent highs + aggressive buyers absorbed by institutional sellers → SHORT, tight SL above absorption node.
  • ⚡ CHoCH ▲ / ▼: Confirms immediate micro-structure transition in real time.

▸ 6. ENTRY & Fibonacci OTE (Optimal Trade Entry)
  ─────────────────────────────────────────────────────────────────────────────
  RULE: If an ARIS QUANTUM ENGINE block is present in indicatorContext, you MUST
  use the engine's computed OTE ENTRY, OTE SL, OTE TP1, OTE TP2 levels directly.
  Fallback for pure visual analysis:
  ─────────────────────────────────────────────────────────────────────────────
  - Entry: Center of the Golden Pocket / OTE zone (0.618–0.786, ideally at 0.666).
  - Stop Loss (SL): Below Swing Low / 1.272 Fibonacci extension (hard invalidation).
  - TP1: Swing high (LONG) or swing low (SHORT), adjusted for whale walls.
  - TP2: 1.272 / 1.618 Fibonacci extension.

▸ 7. RISK:REWARD GATE (Non-negotiable)
  - Calculate RR = (TP1 - Entry) / (Entry - SL) for LONGs, (Entry - TP1) / (SL - Entry) for SHORTs.
  • RR < 1.50 → HARD VETO. Set setupStatus to "WAIT", hardVeto to true, positionSizePct = 0.
  • RR 1.50–2.00 → Acceptable (Grade B / B+).
  • RR > 2.00 → Full grading applies normally (Grade A / A+).

▸ 8. PENDING VS. ACTIVE SETUPS (The Execution Gate)
  - ACTIVE: bias is bullish or bearish, Mega Score ≥ Dynamic Threshold (or Confluence Score ≥ 70%) with matching CVD bias, setupStatus = "ACTIVE".
  - PENDING: structure confirmed but momentum is neutral/weak. Set bias = "neutral", output levels, setupStatus = "PENDING", positionSizePct = 0.
  - WAIT: structure invalid or indicators in strong conflict. bias = "neutral", entry = {"low":0,"high":0,"price":0}, sl = 0, targets = [0,0], setupStatus = "WAIT", positionSizePct = 0.

▸ 9. [CRITICAL HARD GATE] SQUEEZE MOMENTUM PHASE FILTER
  • LONG intended + Squeeze SQUEEZED+BEARISH → HARD VETO / WAIT.
  • LONG intended + Squeeze RELEASED+BEARISH → HARD VETO / WAIT.
  • SHORT intended + Squeeze SQUEEZED+BULLISH → HARD VETO / WAIT.
  • SHORT intended + Squeeze RELEASED+BULLISH → HARD VETO / WAIT.
  If Squeeze data unavailable → Treat as UNKNOWN, downgrade ACTIVE to PENDING.

═══════════════════════════════════════════════════════════
SECTION 3 — CONFIDENCE GRADES & POSITION SIZING
═══════════════════════════════════════════════════════════

Calculate weighted confidence percentage (0–100%):
  • Grade A+ (≥ 90%): 1.0% risk. (GP BUY + 🪤 SWEEP BUY + Confluence ≥ 70% + MFI/CVD positive + Whale Bid Wall).
  • Grade A (80–89%): 0.75% risk. (GP Retest + HTF Alignment + Confluence ≥ 70%).
  • Grade B+ (70–79%): 0.5% risk. (Confluence 50-70% with CHoCH confirmation).
  • Grade B (60–69%): 0.5% risk (reduced position size).
  • Grade C (45–59%): 0% risk. PENDING / Watchlist only.
  • Grade D (< 45%): 0% risk. Hard No-Trade / WAIT.

RISK SAFETY RULES:
  1. If setupStatus is "PENDING" or "WAIT" → positionSizePct MUST be 0.
  2. If hardVeto is true → positionSizePct MUST be 0.
  3. If RR < 1.50 → positionSizePct MUST be 0 and hardVeto MUST be true.

═══════════════════════════════════════════════════════════
SECTION 4 — MTF BIAS CONFIRMATION (Multi-Timeframe EMA200)
═══════════════════════════════════════════════════════════

When indicatorContext includes a "MULTI-TIMEFRAME BIAS (EMA200)" line:
MTF Score = sum of +1 (BULL) or -1 (BEAR) across 3–4 timeframes.
- Score +3 or +4 (Full Bull): Strong LONG confirmation. Supports PENDING → ACTIVE upgrade.
- Score +1 to -1 (Mixed): DOWNGRADE setup to PENDING.
- Score -3 or -4 (Full Bear): Strong SHORT confirmation. LONG setups → WAIT unless confirmed liquidity sweep.

═══════════════════════════════════════════════════════════
SECTION 5 — HARD VETO RULES (IMMEDIATE NO-TRADE)
═══════════════════════════════════════════════════════════

Set "hardVeto" to true AND "positionSizePct" to 0 if ANY of the following:
1. Benford's Law anomaly detected in volume distribution (manipulation risk).
2. Zone is "CONFLICT" (structure and HTF bias disagree), UNLESS a clear liquidity sweep (🪤 SWEEP BUY/SELL) justifies reversal.
3. Confidence Grade is D (< 45%).
4. Market is CHOPPY regime AND Mega Score is below Threshold - 3.
5. Risk:Reward ratio < 1.50:1.

═══════════════════════════════════════════════════════════
SECTION 6 — OUTPUT JSON FORMAT (STRICT)
═══════════════════════════════════════════════════════════

Return ONLY a single valid JSON object. No markdown, no fences, no prose.
If entry is 0 (no setup), targets and SL must also be 0.
"entry" must be an object: {"low": number, "high": number, "price": number}.

{
  "methodology": "ARIS_QUANTUM_V8",
  "instrument": "Auto-detected trading pair (e.g. BTC/USDT)",
  "timeframe": "Auto-detected timeframe (e.g. 1H)",
  "bias": "bullish|bearish|neutral",
  "setupStatus": "ACTIVE|PENDING|WAIT",
  "megaScore": "Detected score or computed equivalent",
  "confluenceScore": "70% (STRONG)",
  "earlyReversal": "SWEEP BUY|SWEEP SELL|CHoCH ▲|CHoCH ▼|NONE",
  "regime": "TREND|RANGE|CHOPPY",
  "dynThreshold": 18,
  "confidenceGrade": "A+|A|B+|B|C|D",
  "confidencePct": 85,
  "rrRatio": 2.1,
  "idcStatus": "LONG_CONFIRMED|SHORT_CONFIRMED|NONE",
  "htfBias": "4H BULL / Daily BULL",
  "smcFvgConfluence": true,
  "frRegime": "EXTREME +|EXTREME -|POSITIVE|NEGATIVE|NEUTRAL",
  "frOiSignal": "🚀 SHORT SQUEEZE|📈 BULL BUILD|⚠️ OVERLEVERED|💥 LONG FLUSH|📄 SHORT COVER|➖ NEUTRAL",
  "patterns": ["Auto GP BUY [0.618-0.786]", "🪤 SWEEP BUY at Bottom"],
  "indicators": ["RSI: 61.1 / MACD: BULL", "Volume Spike 1.5x"],
  "support": [level1, level2],
  "resistance": [level1, level2],
  "entry": {"low": number, "high": number, "price": number},
  "sl": number,
  "targets": [tp1, tp2],
  "breakEvenPrice": number_or_0,
  "positionSizePct": number,
  "reasoning": "4–6 sentences: Mega Score vs Threshold, Confluence Score, HTF Bias alignment, Golden Pocket entry, early sweep/CHoCH trigger, liquidity wall confirmation, and R:R logic.",
  "hardVeto": false,
  "hardVetoReason": "Explanation or null",
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
`;

// --- Lightweight system prompt for text-only structured JSON calls ---
const TEXT_JSON_SYSTEM_PROMPT = `
You are a precise quantitative trading assistant operating in text-only mode (no chart image).
You will be given a task description and an exact JSON schema to follow.

Rules:
- Return ONLY a single valid JSON object matching the schema given in the user message.
- No markdown code fences, no preamble, no explanation, no disclaimers — JSON only.
- Base your answer strictly on the data provided in the user message. Do not invent data.
- If the user message references an "ARIS QUANTUM ENGINE" data block, treat those values as authoritative and computed — do not question or recompute them.
`;

const SECOND_OPINION_INSTRUCTIONS = `
You are a contrarian technical analyst acting as a DEVIL'S ADVOCATE.
You have been shown a chart and the initial analysis from another analyst.

Your job is to:
1. CHALLENGE the original setup — check if price is hitting a major Liquidity Wall, Resistance, or Extension.
2. Check for HTF Conflicts, Bearish RSI Divergences, or Overextended momentum.
3. Give your honest verdict: do you CONFIRM or REJECT the original trade setup?

▸ CRITICAL — ARIS QUANTUM ENGINE BLOCK:
  If the indicatorContext includes an "ARIS QUANTUM ENGINE" block, those numbers are computed in real-time. Use them when evaluating trade structure.

Return ONLY this JSON:
{
  "verdict": "confirm|reject|caution",
  "verdictReason": "One sentence summary of your verdict",
  "challengePoints": ["risk 1", "risk 2", "risk 3"],
  "alternativeBias": "bullish|bearish|neutral",
  "alternativeScenario": "What could happen instead",
  "confidence": number_0_to_100,
  "reasoning": "2–3 sentences of your contrarian take"
}
`;

// ─── Fetch with Retry Helper ───
async function fetchWithRetry(fetchFn, maxRetries = 2, delayMs = 1500) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchFn();
      if (!response.ok && response.status >= 500 && attempt < maxRetries) {
        console.warn(`[fetchWithRetry] Server error ${response.status}, retrying (${attempt + 1}/${maxRetries})...`);
        await new Promise(r => setTimeout(r, delayMs * (attempt + 1)));
        continue;
      }
      return response;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        console.warn(`[fetchWithRetry] Network error, retrying (${attempt + 1}/${maxRetries}):`, err.message);
        await new Promise(r => setTimeout(r, delayMs * (attempt + 1)));
      }
    }
  }
  throw lastError || new Error('fetchWithRetry: all retries exhausted');
}

// --- Free-form chat (AI Coach) ---
export async function askAI(systemPrompt, messages, forceProvider = null) {
  const provider = forceProvider || process.env.AI_PROVIDER || 'gemini';

  if (provider === 'anthropic') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured.');
    const response = await fetchWithRetry(() => fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 2000,
        system: systemPrompt,
        messages
      })
    }));
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
    const response = await fetchWithRetry(() => fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents, systemInstruction: { parts: [{ text: systemPrompt }] } })
      }
    ));
    if (!response.ok) {
      const e = await response.text();
      throw new Error(`Gemini API Error: [${response.status}] ${e}`);
    }
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  } else if (provider === 'openrouter') {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured.');
    const FREE_FALLBACKS = [
      'google/gemini-2.0-flash-exp:free',
      'meta-llama/llama-3.3-70b-instruct:free',
      'mistralai/mistral-7b-instruct:free'
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

  if (mimeType) {
    const ACCEPTED = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const normalized = mimeType.split(';')[0].trim().toLowerCase();
    mimeType = ACCEPTED.includes(normalized) ? normalized : 'image/png';
  }

  let parsed;

  if (provider === 'gemini') {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not configured.');

    const parts = [];
    if (imageBuffer && mimeType) {
      parts.push({ inlineData: { mimeType, data: imageBuffer.toString('base64') } });
    }
    parts.push({ text: userContent });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    const response = await fetchWithRetry(() => fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { responseMimeType: 'application/json' }
      })
    }));

    if (!response.ok) {
      const e = await response.text();
      throw new Error(`Gemini API Error: [${response.status}] ${e}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    parsed = cleanAndParseJSON(text);

  } else if (provider === 'anthropic') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured.');

    const content = [];
    if (imageBuffer && mimeType) {
      content.push({ type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBuffer.toString('base64') } });
    }
    content.push({ type: 'text', text: userContent });

    const response = await fetchWithRetry(() => fetch('https://api.anthropic.com/v1/messages', {
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
    }));

    if (!response.ok) {
      const e = await response.text();
      throw new Error(`Anthropic API HTTP Error [${response.status}]: ${e}`);
    }

    const data = await response.json();
    const textBlock = (data.content || []).find(c => c.type === 'text');
    parsed = cleanAndParseJSON(textBlock?.text);

  } else if (provider === 'openrouter') {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured.');
    const FREE_FALLBACKS = [
      'google/gemini-2.0-flash-exp:free',
      'meta-llama/llama-3.3-70b-instruct:free',
      'mistralai/mistral-7b-instruct:free'
    ];
    const configured = process.env.OPENROUTER_MODEL;
    const candidates = [configured, ...FREE_FALLBACKS].filter(Boolean);
    const oaMessages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ];
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
          parsed = cleanAndParseJSON(data.choices?.[0]?.message?.content || '');
          break;
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
      if (parsed) break;
    }
    if (!parsed) {
      const tried = [...attempted].join(', ');
      throw new Error(`OpenRouter API Error: free models exhausted (${tried}) after ${upstreamRetryAfter}s`);
    }

  } else {
    throw new Error(`Unsupported AI provider: ${provider}`);
  }

  return validateAIResponse(parsed, hints);
}

// --- Primary analysis ---
export async function analyzeChart(imageBuffer, mimeType, pair = '', timeframe = '', hints = '', orderbookContext = null, indicatorContext = null, newsContext = null, forceProvider = null) {
  let provider = forceProvider && forceProvider !== 'openrouter'
    ? forceProvider
    : (process.env.AI_PROVIDER && process.env.AI_PROVIDER !== 'openrouter'
        ? process.env.AI_PROVIDER
        : 'anthropic');
  if (provider === 'gemini' && !process.env.GEMINI_API_KEY && process.env.ANTHROPIC_API_KEY) provider = 'anthropic';
  if (provider === 'anthropic' && !process.env.ANTHROPIC_API_KEY && process.env.GEMINI_API_KEY) provider = 'gemini';
  const actualProvider = provider;

  const tfInstruction = timeframe
    ? `IMPORTANT: The user has confirmed the timeframe is "${timeframe}". Use this exact timeframe — do NOT override it.`
    : `Auto-detect the timeframe from the chart's UI (look for the timeframe button/label in the top-left of the chart).`;

  const obSection = orderbookContext
    ? `\n\nREAL-TIME ORDER BOOK DATA (Liquidity Walls):\n${orderbookContext}\nConsider these live levels when determining entry, SL and TP. Whale walls often act as strong support/resistance. Order pressure bias should reinforce or challenge chart bias.`
    : '';

  const indSection = indicatorContext
    ? `\n\nLIVE TECHNICAL INDICATORS DATA (extracted from live market candles):\n${indicatorContext}\nCompare price relative to EMA20, EMA50 and EMA200. Check RSI overbought/oversold levels and MACD momentum direction. ADX value indicates trend strength. Point of Control (POC) shows heavy volume node.`
    : '';

  const newsSection = newsContext
    ? `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nREAL-TIME NEWS & MACRO CONTEXT (last 24h):\n${newsContext}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    : '';

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
          fgLine = nl + '  🧠 CRYPTO FEAR & GREED INDEX: ' + fg.value + '/100 (' + tag + ') — ' + (fg.signal >= 1 ? 'risk-on bias' : fg.signal <= -1 ? 'risk-off / capitulation' : 'neutral sentiment') + '.';
        }
        flowSection = nl + nl + '💰 CAPITAL FLOW MAP:' + nl + lines.join(nl) + fgLine;
      }
    }
  } catch (e) {
    console.error('[aiProvider] capital flow fetch failed:', e.message);
  }

  // ── Lessons Learned Feedback Loop & Directional Edge ──
  let lessonsSection = '';
  try {
    const { getLessonsFor, getAllLessons, getDirectionalEdge } = await import('./db.js');

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
          rule = `\nDIRECTIONAL EDGE RULE: Your historical ${weak} win rate (${weakWR}%) is weaker than ${strong} (${Math.max(longWR, shortWR)}%). Require stronger confluence for ${weak}.`;
        }
        edgeSection = `\n\n[DIRECTIONAL EDGE — LIVE TRACK RECORD]\n` + lines.join('\n') + '\n' + rule;
      }
    } catch (e) {
      console.warn('[Learning Loop] Failed to load directional edge:', e.message);
    }

    const localLessons = (await getLessonsFor(pair, 'LONG')).concat(await getLessonsFor(pair, 'SHORT')).slice(0, 5);
    const globalLessons = (await getAllLessons()).filter(l => l.instrument.toUpperCase() !== pair.toUpperCase()).slice(0, 3);

    let blocks = [];
    if (localLessons.length > 0) {
      blocks.push(
        `═══════════════════════════════════════════════════════════\n` +
        `[ASSET CONSTRAINTS] PAST FAILED TRADES FOR ${pair.toUpperCase()}:\n` +
        localLessons.map((l, i) => `Local Rule #${i+1}: If ${l.failure_reason}, AVOID this trade. Instruction: "${l.lesson}"`).join('\n')
      );
    }
    if (globalLessons.length > 0) {
      blocks.push(
        `═══════════════════════════════════════════════════════════\n` +
        `[GLOBAL SYSTEM CONSTRAINTS] SHARED LESSONS:\n` +
        globalLessons.map((l, i) => `Global Rule #${i+1}: If ${l.failure_reason}, AVOID this trade. Instruction: "${l.lesson}"`).join('\n')
      );
    }
    if (blocks.length > 0) {
      lessonsSection = '\n\n' + blocks.join('\n\n');
    }
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
Analyze the attached chart image with the ARIS FIB LIVE PRO v6 HUD and indicator geometry.
${tfInstruction}
${hints ? `User focus: "${hints}"` : ''}${obSection}${indSection}${newsSection}${flowSection}

Follow system instructions and output the structured JSON result.
  `;

  if (hints === 'POST_MORTEM_OVERRIDE') {
    return callAI(TEXT_JSON_SYSTEM_PROMPT, userPrompt, null, null, forceProvider, 'POST_MORTEM_OVERRIDE');
  }

  if (hints === 'SCANNER_VERIFY') {
    return callAI(TEXT_JSON_SYSTEM_PROMPT, userPrompt, null, null, forceProvider, 'SCANNER_VERIFY');
  }

  return callAI(systemInstructionsWithLessons, userPrompt, mimeType, imageBuffer, actualProvider, hints || 'ANALYSIS');
}

// --- Second opinion (devil's advocate) ---
export async function getSecondOpinion(imageBuffer, mimeType, originalResult, pair = 'unknown', timeframe = 'unknown', indicatorContext = null) {
  const indSection = indicatorContext ? `\n\nLIVE TECHNICAL INDICATORS DATA:\n${indicatorContext}` : '';
  const userPrompt = `
Chart: ${pair} on ${timeframe} timeframe.
${indSection}

The primary analyst concluded:
- Bias: ${originalResult.bias?.toUpperCase()}
- Methodology: ${originalResult.methodology}
- Entry: ${JSON.stringify(originalResult.entry)}
- Stop Loss: ${originalResult.sl}
- Targets: ${originalResult.targets?.join(', ')}
- Confluence Score: ${originalResult.confluenceScore || originalResult.confidencePct + '%'}
- Early Reversal Signal: ${originalResult.earlyReversal || 'None'}
- Primary reasoning: ${originalResult.reasoning}

Review the same chart image and challenge this analysis. Check if it conflicts with major HTF resistance or orderbook liquidity walls.
Return your contrarian JSON verdict.
  `;
  return callAI(SECOND_OPINION_INSTRUCTIONS, userPrompt, mimeType, imageBuffer, null, 'SECOND_OPINION');
}