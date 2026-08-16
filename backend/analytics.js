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
  const closed = trades.filter(t => t.status === 'SUCCESS' || t.status === 'FAILED');
  if (!closed.length) return { wins: 0, losses: 0, total: 0, winRate: null };
  const wins = closed.filter(t => t.status === 'SUCCESS').length;
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
  const closed = trades
    .filter(t => t.status === 'SUCCESS' || t.status === 'FAILED')
    .sort((a, b) => new Date(b.closedAt || b.createdAt) - new Date(a.closedAt || a.createdAt));

  if (closed.length < threshold) return { tripped: false, consecutiveFails: 0 };

  let consecutiveFails = 0;
  for (const t of closed) {
    if (t.status === 'FAILED') consecutiveFails++;
    else break;
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
  const closed = trades
    .filter(t => t.status === 'SUCCESS' || t.status === 'FAILED')
    .sort((a, b) => new Date(a.closedAt || a.createdAt) - new Date(b.closedAt || b.createdAt));

  // Streaks (by close time order)
  let curWin = 0, bestWin = 0, curLoss = 0, worstLoss = 0;
  for (const t of closed) {
    if (t.status === 'SUCCESS') {
      curWin++; bestWin = Math.max(bestWin, curWin); curLoss = 0;
    } else {
      curLoss++; worstLoss = Math.max(worstLoss, curLoss); curWin = 0;
    }
  }

  // R stats (uses rMultiple if present, else falls back to a ±1 estimate)
  const rValues = closed.map(t => {
    if (typeof t.rMultiple === 'number') return t.rMultiple;
    return t.status === 'SUCCESS' ? 1 : -1;
  });
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
    closedCount: closed.length
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
export async function computeAnalytics() {
  const allTrades = await getAllTrades();
  const closed    = allTrades.filter(t => t.status === 'SUCCESS' || t.status === 'FAILED');
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
    rrDelta:           (avg(thRR) && avg(realRR))
      ? parseFloat((avg(realRR) - avg(thRR)).toFixed(3))
      : null,
    note: avg(realRR) === null
      ? 'Realized R:R requires price history — will populate as trades accumulate.'
      : null
  };

  // ── 6. Expectancy (per trade average profit in R) ───────
  // Expectancy = (Win% × avg_win_R) - (Loss% × avg_loss_R)
  // Simplified: Win% × avg_theoretical_RR - Loss% × 1.0
  const expectancy = overall.total > 0
    ? parseFloat((
        (overall.wins / overall.total * (rrAnalysis.avgTheoreticalRR || 1.5)) -
        (overall.losses / overall.total * 1.0)
      ).toFixed(3))
    : null;

  // ── 7. Recent performance (last 10 closed trades) ───────
  const recent10 = closed
    .sort((a, b) => new Date(b.closedAt || 0) - new Date(a.closedAt || 0))
    .slice(0, 10);
  const recentPerf = winRate(recent10);

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

    recentPerformance: {
      last10Trades: recentPerf,
      trades: recent10.map(t => ({
        id:         t.id,
        instrument: t.instrument,
        direction:  t.direction,
        grade:      t.grade,
        status:     t.status,
        rr:         t.rr,
        closedAt:   t.closedAt
      }))
    },

    circuitBreaker
  };
}
