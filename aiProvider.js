import dotenv from 'dotenv';

dotenv.config();

const SYSTEM_INSTRUCTIONS = `
You are an expert technical analyst with deep knowledge of:
1. SMC/ICT (Smart Money Concepts) - Order Blocks, FVG, CHoCH, BOS, Liquidity
2. Elliott Wave Theory - wave counting, impulse/corrective structure
3. Classical Price Action - support/resistance, patterns, candlesticks

STEP 0 - AUTO-DETECT FROM CHART:
Read the chart's UI carefully. Extract:

a) INSTRUMENT: Look at the top-left area of the chart for the symbol label.
   - The symbol is always BASE/QUOTE format, e.g. "SOLUSDT", "ETH/USDT", "BTCUSDT.P", "ADA/USD"
   - Extract the FULL pair: SOL/USDT, ETH/USDT, BTC/USDT, ADA/USDT etc.
   - NEVER return just "USDT" or just the quote currency alone.
   - If you see "SOLUSDT.P" → return "SOL/USDT"
   - If you see "ETHUSDT" → return "ETH/USDT"
   - The BASE asset (SOL, ETH, BTC, ADA, etc.) is always on the LEFT side of the pair label.

b) TIMEFRAME: Look for the timeframe button/selector (typically shows "1", "5", "15", "1H", "4H", "1D", "1W").
   - This is usually visible in the top toolbar area of the chart.


STEP 1 - METHODOLOGY SELECTION:
Examine the chart and select the methodology that best fits the current market structure. State which one (or combination) you are applying and why.

STEP 2 - TRADE SETUP:
Apply the selected methodology and deliver your verdict. Be decisive. If a valid setup exists, commit to numbers.

Return ONLY a single valid JSON object, no markdown blocks, no formatting fences, no prose:
{
  "methodology": "SMC|Elliott|PriceAction|Combined",
  "methodologyReason": "Brief explanation of choice",
  "instrument": "AUTO-DETECTED symbol from chart",
  "timeframe": "AUTO-DETECTED timeframe from chart",
  "bias": "bullish|bearish|neutral",
  "patterns": ["pattern 1", "pattern 2"],
  "indicators": ["indicator reading 1"],
  "support": [number1, number2],
  "resistance": [number1, number2],
  "entry": number,
  "targets": [tp1, tp2, tp3],
  "sl": number,
  "strength": number_0_to_100,
  "reasoning": "3-5 sentences explaining your reasoning",
  "overlay": {
    "priceMin": number_lowest_visible_price,
    "priceMax": number_highest_visible_price,
    "entryY": number_0_to_1_relative_to_chart_height,
    "targetsY": [number_0_to_1_relative_to_chart_height],
    "slY": number_0_to_1_relative_to_chart_height,
    "supportY": [number_0_to_1_relative_to_chart_height],
    "resistanceY": [number_0_to_1_relative_to_chart_height]
  }
}
`;


const SECOND_OPINION_INSTRUCTIONS = `
You are a contrarian technical analyst acting as a DEVIL'S ADVOCATE. 
You have been shown a chart and the initial analysis from another analyst.

Your job is to:
1. CHALLENGE the original setup — find structural reasons it could FAIL
2. Look for opposing signals, hidden patterns, or overlooked risks
3. Give your honest verdict: do you CONFIRM or REJECT the original trade setup?

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
async function callAI(systemPrompt, userContent, mimeType = null, imageBuffer = null) {
  const provider = process.env.AI_PROVIDER || 'gemini';

  // Always normalize MIME type to avoid API rejection
  if (mimeType) {
    const ACCEPTED = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const normalized = mimeType.split(';')[0].trim().toLowerCase();
    mimeType = ACCEPTED.includes(normalized) ? normalized : 'image/png';
  }

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
    return JSON.parse(match[0]);

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
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{ role: 'user', content }]
      })
    });

    if (!response.ok) {
      const e = await response.text();
      throw new Error(`${response.status} ${e}`);
    }

    const data = await response.json();
    const text = data.content?.[0]?.text;
    if (!text) throw new Error('Empty response from Anthropic API.');
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Claude response did not contain valid JSON.');
    return JSON.parse(match[0]);

  } else {
    throw new Error(`Unsupported AI provider: ${provider}`);
  }
}

// --- Primary analysis ---
export async function analyzeChart(imageBuffer, mimeType, pair = '', timeframe = '', hints = '', orderbookContext = null) {
  const tfInstruction = timeframe
    ? `IMPORTANT: The user has confirmed the timeframe is "${timeframe}". Use this exact timeframe — do NOT override it.`
    : `Auto-detect the timeframe from the chart's UI (look for the timeframe button/label in the top-left of the chart).`;

  const obSection = orderbookContext
    ? `\n\nREAL-TIME ORDER BOOK DATA (use this to enhance your analysis):\n${orderbookContext}\nConsider these live levels when determining entry, SL and TP. Whale walls often act as strong support/resistance. Order pressure bias should reinforce or challenge chart bias.`
    : '';

  const userPrompt = `
Analyze the attached chart image.
${tfInstruction}
${hints ? `User focus: "${hints}"` : ''}${obSection}

Follow system instructions and output the JSON result.
  `;
  return callAI(SYSTEM_INSTRUCTIONS, userPrompt, mimeType, imageBuffer);
}

// --- Second opinion (devil's advocate) ---
export async function getSecondOpinion(imageBuffer, mimeType, originalResult, pair = 'unknown', timeframe = 'unknown') {
  const userPrompt = `
Chart: ${pair} on ${timeframe} timeframe.

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
  return callAI(SECOND_OPINION_INSTRUCTIONS, userPrompt, mimeType, imageBuffer);
}
