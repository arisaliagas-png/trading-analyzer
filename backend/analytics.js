/**
 * analytics.js — Live Forward-Test Analytics for ARIS Trading System.
 *
 * Reads all trades from SQLite and computes real statistics.
 * No live API calls — pure computation on existing trade data.
 *
 * Exposed via GET /api/analytics
 *
 * Metrics computed:
 *  1. Win rate per confidenceGrade (A+/A/B+/B/C)
 *  2. Win rate per regime (TREND/RANGE/CHOPPY)
 *  3. Win rate per direction (LONG/SHORT)
 *  4. Grade calibration (does 90% confidence actually win 90%?)
 *  5. Realized R:R vs theoretical R:R
 *  6. Circuit breaker status (consecutive recent failures)
 *  7. Overall summary stats
 */

import { getAllTrades, getPriceHistory } from './db.js';

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function winRate(trades) {
  // PARTIAL counts as a WIN: TP1 hit → 70% banked + remaining 30% at breakeven
  // (risk-free). Per system design, a setup that hits TP1 is a successful setup.
  const closed = trades.filter(t => t.status === 'SUCCESS' || t.status === 'FAILED' || t.status === 'PARTIAL');
  if (!closed.length) return { wins: 0, losses: 0, total: 0, winRate: null };
  const wins = closed.filter(t => t.status === 'SUCCESS' || t.status === 'PARTIAL').length;
  return {
    wins,
    losses: closed.length - wins,
    total: closed.length,
    winRate: parseFloat(((wins / closed.length) * 100).toFixed(1))
  };
}

function avg(arr) {
  if (!arr.length) return null;
  return parseFloat((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(3));
}

// ─────────────────────────────────────────────
// REALIZED R:R
// Computed from the actual price path stored in price_history.
// For a LONG: realized = (max_price - entry) / (entry - sl)
// For a SHORT: realized = (entry - min_price) / (sl - entry)
// Only available for trades with price history records.
// ─────────────────────────────────────────────
async function realizedRR(trade) {
  // A FAILED trade means the stop loss was hit → realized R is exactly -1.0.
  // Do NOT derive it from price history (which may show a wick above entry before
  // the SL was hit, producing a bogus positive R for a losing trade).
  if (trade.status === 'FAILED') return -1.0;
  if (!trade.entryPrice || !trade.sl) return null;
  const prices = (await getPriceHistory(trade.id)).map(r => r.price);
  if (!prices.length) return null;

  const entry = trade.entryPrice;
  const sl    = trade.sl;
  const risk  = Math.abs(entry - sl);
  if (risk === 0) return null;

  if (trade.direction === 'LONG') {
    const maxPrice = Math.max(...prices);
    return parseFloat(((maxPrice - entry) / risk).toFixed(2));
  } else {
    const minPrice = Math.min(...prices);
    return parseFloat(((entry - minPrice) / risk).toFixed(2));
  }
}

// ─────────────────────────────────────────────
// CIRCUIT BREAKER CHECK
// Returns true if last N closed trades are all FAILED.
// ─────────────────────────────────────────────
function checkCircuitBreaker(trades, threshold = 3) {
  // Count consecutive failures from the most recent closed trade backwards.
  // A "failure" for circuit-breaker purposes = any closed trade that did NOT win
  // (FAILED, EXPIRED, or a PARTIAL that later got stopped — though PARTIAL is risk-free
  // after TP1, we still treat it as a non-loss streak-breaker only if it resolved as win).
  // We include EXPIRED so a run of dead setups also trips the breaker.
  const closed = trades
    .filter(t => ['SUCCESS', 'FAILED', 'PARTIAL', 'EXPIRED'].includes(t.status))
    .sort((a, b) => new Date(b.closedAt || b.createdAt) - new Date(a.closedAt || a.createdAt));

  let consecutiveFails = 0;
  for (const t of closed) {
    if (t.status === 'FAILED' || t.status === 'EXPIRED') consecutiveFails++;
    else break; // SUCCESS or PARTIAL resets the fail streak
  }

  return {
    tripped: consecutiveFails >= threshold,
    consecutiveFails,
    message: consecutiveFails >= threshold
      ? `⚠️ Circuit breaker: ${consecutiveFails} consecutive failures. Consider pausing scanning.`
      : null
  };
}

// ─────────────────────────────────────────────
// PERSONAL BESTS — "leaderboard vs your own records"
// Streaks and R-stat milestones computed locally from the trade log.
// ─────────────────────────────────────────────
function personalBests(trades) {
  // R-math pool: only fully-resolved trades with a P&L (SUCCESS/FAILED/PARTIAL).
  // EXPIRED setups never entered a position (thesis died before entry) → they are
  // NOT counted in R, but they ARE counted in the loss streak (a setup that didn't win).
  const rPool = trades
    .filter(t => t.status === 'SUCCESS' || t.status === 'FAILED' || t.status === 'PARTIAL')
    .sort((a, b) => new Date(a.closedAt || a.createdAt) - new Date(b.closedAt || a.createdAt));

  // Streak pool: any closed trade that is NOT a win counts as a loss-streak increment.
  const streakPool = trades
    .filter(t => ['SUCCESS', 'FAILED', 'PARTIAL', 'EXPIRED'].includes(t.status))
    .sort((a, b) => new Date(a.closedAt || a.createdAt) - new Date(b.closedAt || a.createdAt));

  // Streaks (by close time order)
  let curWin = 0, bestWin = 0, curLoss = 0, worstLoss = 0;
  for (const t of streakPool) {
    if (t.status === 'SUCCESS' || t.status === 'PARTIAL') {
      curWin++; bestWin = Math.max(bestWin, curWin); curLoss = 0;
    } else {
      curLoss++; worstLoss = Math.max(worstLoss, curLoss); curWin = 0;
    }
  }

  // R stats (uses rMultiple if present, else falls back to a ±1 estimate)
  const rValues = rPool.map(t => {
    if (typeof t.rMultiple === 'number') return t.rMultiple;
    if (t.status === 'SUCCESS') return 1;
    if (t.status === 'FAILED') return -1;
    if (t.status === 'PARTIAL') return null; // should have rMultiple from computeRMultiple
    return 0;
  }).filter(v => v !== null);
  const totalR = rValues.length ? parseFloat(rValues.reduce((a, b) => a + b, 0).toFixed(2)) : 0;
  const bestR  = rValues.length ? Math.max(...rValues) : null;
  const worstR = rValues.length ? Math.min(...rValues) : null;

  return {
    currentWinStreak: curWin,
    bestWinStreak:    bestWin,
    worstLossStreak:  worstLoss,
    totalR,
    bestR,
    worstR,
    closedCount: streakPool.length
  };
}

function gradeCalibration(trades) {
  const gradeOrder = ['A+', 'A', 'B+', 'B', 'C', 'D'];
  const result = {};

  for (const grade of gradeOrder) {
    const gradeGroup = trades.filter(t => t.grade === grade);
    const stats = winRate(gradeGroup);
    const avgConfidence = avg(gradeGroup.map(t => t.pct).filter(Boolean));

    result[grade] = {
      ...stats,
      avgConfidencePct: avgConfidence,
      calibrationDelta: (stats.winRate !== null && avgConfidence !== null)
        ? parseFloat((stats.winRate - avgConfidence).toFixed(1))
        : null,
      // Positive = overconfident (promised more than delivered)
      // Negative = underconfident (delivered more than promised)
    };
  }

  return result;
}

// ─────────────────────────────────────────────
// MAIN ANALYTICS FUNCTION
// ─────────────────────────────────────────────
export async function computeAnalytics(req) {
  const allTrades = await getAllTrades();
  const closed    = allTrades.filter(t => ['SUCCESS', 'FAILED', 'PARTIAL'].includes(t.status));
  const active    = allTrades.filter(t => t.status === 'ACTIVE');
  const pending   = allTrades.filter(t => t.status === 'PENDING');

  // ── 1. Overall summary ──────────────────────────────────
  const overall = winRate(allTrades);

  // ── 2. Win rate per grade ───────────────────────────────
  const byGrade = gradeCalibration(allTrades);

  // ── 3. Win rate per direction ───────────────────────────
  const byDirection = {
    LONG:  winRate(allTrades.filter(t => t.direction === 'LONG')),
    SHORT: winRate(allTrades.filter(t => t.direction === 'SHORT'))
  };

  // ── 4. Win rate per instrument (top performers) ─────────
  const instruments = [...new Set(allTrades.map(t => t.instrument))];
  const byInstrument = {};
  for (const sym of instruments) {
    byInstrument[sym] = winRate(allTrades.filter(t => t.instrument === sym));
  }

  // ── 5. Theoretical vs Realized R:R ─────────────────────
  const thRR = closed.map(t => t.rr).filter(Boolean);
  const realRR = await Promise.all(closed.map(async t => realizedRR(t))).then(rs => rs.filter(v => v !== null));

  const rrAnalysis = {
    avgTheoreticalRR:  avg(thRR),
    avgRealizedRR:     avg(realRR),
    rrDelta:           (avg(realRR) && avg(thRR))
      ? parseFloat((avg(realRR) - avg(thRR)).toFixed(3))
      : null,
    note: avg(realRR) === null
      ? 'Realized R:R requires price history — will populate as trades accumulate.'
      : null
  };

  // ── 6. Expectancy (per trade average profit in R) ───────
  const closedWinPct = overall.total > 0 ? (overall.wins / overall.total) : 0;
  const closedLossPct = overall.total > 0 ? (overall.losses / overall.total) : 0;
  const expectancy = overall.total > 0
    ? parseFloat((
        (closedWinPct * (rrAnalysis.avgTheoreticalRR || 1.5)) -
        (closedLossPct * 1.0)
      ).toFixed(3))
    : null;

  // ── 7. Recent performance (last 50 closed/partial trades — frontend handles pagination) ─
  const recentAll = allTrades
    .filter(t => ['SUCCESS', 'FAILED', 'PARTIAL'].includes(t.status))
    .sort((a, b) => {
      const aTime = new Date(a.closedAt || a.createdAt || 0).getTime();
      const bTime = new Date(b.closedAt || b.createdAt || 0).getTime();
      return bTime - aTime;
    })
    .slice(0, 50);
  const recentPerf = winRate(recentAll);

  // ── 8. Circuit breaker ──────────────────────────────────
  const circuitBreaker = checkCircuitBreaker(allTrades);

  // ── 9. Personal Bests (leaderboard vs your own records) ──
  const personalBestsStats = personalBests(allTrades);

  // ── 10. Sample size warning ──────────────────────────────
  const sampleWarning = closed.length < 30
    ? `⚠️ Low sample size (${closed.length} closed trades). Statistics are directional only — not statistically significant until ~30+ trades.`
    : null;

  return {
    generatedAt: new Date().toISOString(),
    sampleWarning,

    summary: {
      totalTrades:  allTrades.length,
      closed:       closed.length,
      active:       active.length,
      pending:      pending.length,
      wins:         overall.wins,
      losses:       overall.losses,
      winRate:      overall.winRate,
      expectancy,
    },

    byGrade,
    byDirection,
    byInstrument,

    riskReward: rrAnalysis,

    personalBests: personalBestsStats,
    leaderboard: personalBestsStats,
    circuitBreaker,

    recentPerformance: {
      last10Trades: recentPerf,
      total: recentAll.length,
      trades: recentAll.map(t => ({
        id:         t.id,
        instrument: t.instrument,
        direction:  t.direction,
        grade:      t.grade,
        status:     t.status,
        rr:         (typeof t.rMultiple === 'number') ? t.rMultiple : (t.rr ?? null),
        closedAt:   t.closedAt
      }))
    }
  };
}
