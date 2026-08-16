/**
 * riskManager.js — Deterministic Risk & Position Sizing + Circuit Breaker
 *
 * [4A] POSITION SIZING
 *   Removes position size from AI control entirely.
 *   Formula: positionSize = (accountEquity × riskPct) / |entry - sl|
 *   Grade determines riskPct. Status PENDING/WAIT always forces 0% risk.
 *   Account equity is set via env var ACCOUNT_EQUITY (default: $200).
 *
 * [4B] CIRCUIT BREAKER
 *   Monitors consecutive FAILED trades from SQLite.
 *   If consecutiveFails >= CIRCUIT_BREAKER_THRESHOLD → scanner is locked.
 *   Manual reset via resetCircuitBreaker() (called from /api/scanner/reset endpoint).
 */

import { getAllTrades } from './db.js';
import { scannerLog } from './logger.js';

// ─────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────

/** Account equity in USD. Change via .env ACCOUNT_EQUITY=500 */
export const ACCOUNT_EQUITY = parseFloat(process.env.ACCOUNT_EQUITY || '200');

/** Risk % per grade (as decimal: 0.01 = 1%) */
const GRADE_RISK = {
  'A+': 0.010,   // $2.00 on $200 account
  'A':  0.0075,  // $1.50
  'B+': 0.005,   // $1.00
  'B':  0.0025,  // $0.50
  'C':  0,       // Monitor only
  'D':  0        // No trade
};

/** Number of consecutive FAILED trades that trips the circuit breaker */
const CIRCUIT_BREAKER_THRESHOLD = 3;

// In-memory circuit breaker override (allows manual reset without DB write)
let _manualReset = false;
let _resetAt = null;

// ─────────────────────────────────────────────
// [4A] POSITION SIZING
// ─────────────────────────────────────────────

/**
 * Calculates the recommended position size for a trade.
 *
 * @param {number} entryPrice  - Ideal entry price
 * @param {number} sl          - Stop loss price
 * @param {string} grade       - Confidence grade (A+/A/B+/B/C/D)
 * @param {string} setupStatus - ACTIVE | PENDING | WAIT
 * @returns {{ positionSize: number, riskAmount: number, riskPct: number, riskPerUnit: number }}
 */
export function calcPositionSize(entryPrice, sl, grade, setupStatus) {
  // PENDING and WAIT always mean zero size — never enter before confirmation
  if (!setupStatus || setupStatus === 'PENDING' || setupStatus === 'WAIT') {
    return { positionSize: 0, riskAmount: 0, riskPct: 0, riskPerUnit: 0, note: 'Status is not ACTIVE — position size forced to 0.' };
  }

  const riskPct    = GRADE_RISK[grade] ?? 0;
  const riskAmount = ACCOUNT_EQUITY * riskPct;          // USD at risk
  const riskPerUnit = Math.abs(entryPrice - sl);         // distance entry→sl

  if (riskPct === 0 || riskPerUnit === 0) {
    return { positionSize: 0, riskAmount: 0, riskPct, riskPerUnit, note: riskPct === 0 ? `Grade ${grade} = no trade.` : 'SL equals entry price.' };
  }

  const positionSize = riskAmount / riskPerUnit;

  return {
    positionSize:  parseFloat(positionSize.toFixed(6)),
    riskAmount:    parseFloat(riskAmount.toFixed(4)),
    riskPct:       riskPct * 100,          // human-readable %
    riskPerUnit:   parseFloat(riskPerUnit.toFixed(6)),
    accountEquity: ACCOUNT_EQUITY,
    note: `${grade} grade: ${riskPct * 100}% risk = $${riskAmount.toFixed(2)} / $${riskPerUnit.toFixed(4)} per unit`
  };
}

/**
 * Returns a human-readable position sizing summary string for logging/display.
 */
export function positionSizeSummary(entry, sl, grade, status) {
  const ps = calcPositionSize(entry, sl, grade, status);
  if (ps.positionSize === 0) return ps.note;
  return `Size: ${ps.positionSize.toFixed(4)} units | Risk: $${ps.riskAmount.toFixed(2)} (${ps.riskPct}% of $${ACCOUNT_EQUITY})`;
}

// ─────────────────────────────────────────────
// [4B] CIRCUIT BREAKER
// ─────────────────────────────────────────────

/**
 * Checks the circuit breaker state from the SQLite trade history.
 * Reads the last N closed trades and counts consecutive failures.
 *
 * @returns {{ tripped: boolean, consecutiveFails: number, resetAt: string|null, message: string|null }}
 */
export async function getCircuitBreakerState() {
  if (_manualReset) {
    return {
      tripped:          false,
      consecutiveFails: 0,
      resetAt:          _resetAt,
      message:          `Circuit breaker manually reset at ${_resetAt}. Scanning resumed.`
    };
  }

  const allTrades = await getAllTrades();
  const closed = allTrades
    .filter(t => t.status === 'SUCCESS' || t.status === 'FAILED')
    .sort((a, b) => new Date(b.closedAt || b.createdAt) - new Date(a.closedAt || a.createdAt));

  let consecutiveFails = 0;
  for (const t of closed) {
    if (t.status === 'FAILED') consecutiveFails++;
    else break;
  }

  const tripped = consecutiveFails >= CIRCUIT_BREAKER_THRESHOLD;

  return {
    tripped,
    consecutiveFails,
    threshold:  CIRCUIT_BREAKER_THRESHOLD,
    resetAt:    null,
    message:    tripped
      ? `🔴 Circuit breaker TRIPPED: ${consecutiveFails} consecutive losses. Scanning is LOCKED. Call POST /api/scanner/reset to resume manually.`
      : consecutiveFails >= CIRCUIT_BREAKER_THRESHOLD - 1
        ? `⚠️ Warning: ${consecutiveFails} consecutive losses — 1 more will trip the circuit breaker.`
        : null
  };
}

/**
 * Manually resets the circuit breaker (user override).
 * The reset is in-memory only — it will re-evaluate after the next trade closes.
 */
export function resetCircuitBreaker() {
  _manualReset = true;
  _resetAt = new Date().toISOString();
  scannerLog.warn({ resetAt: _resetAt }, '⚠️ Circuit breaker manually reset by user');
}

/**
 * Called after a new trade closes (SUCCESS or FAILED) to re-evaluate.
 * If a SUCCESS is recorded, auto-clears the manual reset flag.
 */
export function onTradeClosed(status) {
  if (status === 'SUCCESS' && _manualReset) {
    _manualReset = false;
    _resetAt = null;
    scannerLog.info('Circuit breaker auto-cleared after SUCCESS trade');
  }
}
