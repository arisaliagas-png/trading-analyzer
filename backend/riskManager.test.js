/**
 * riskManager.test.js
 * Unit tests for ARIS Risk Management System (ESM Compliant).
 */

import { jest, describe, test, expect, beforeEach } from '@jest/globals';

// Setup unstable ESM mocking before importing the tested file
jest.unstable_mockModule('./db.js', () => ({
  getAllTrades: jest.fn()
}));

// Dynamic imports are required when using unstable_mockModule in Jest ESM
const { calcPositionSize, getCircuitBreakerState } = await import('./riskManager.js');
const { getAllTrades } = await import('./db.js');

describe('Risk Manager — Unit Tests', () => {

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Position Sizing', () => {
    test('Should force position size to 0 if status is PENDING', () => {
      const result = calcPositionSize(100, 95, 'A+', 'PENDING');
      expect(result.positionSize).toBe(0);
      expect(result.riskAmount).toBe(0);
    });

    test('Should force position size to 0 if status is WAIT', () => {
      const result = calcPositionSize(100, 95, 'A+', 'WAIT');
      expect(result.positionSize).toBe(0);
    });

    test('Should compute correct size for A+ grade on $200 account (1% risk = $2)', () => {
      const result = calcPositionSize(100, 98, 'A+', 'ACTIVE');
      expect(result.riskAmount).toBe(2.0);
      expect(result.positionSize).toBe(1.0);
    });

    test('Should compute correct size for B grade (0.25% risk = $0.5) with fractional units', () => {
      const result = calcPositionSize(100, 99, 'B', 'ACTIVE');
      expect(result.riskAmount).toBe(0.5);
      expect(result.positionSize).toBe(0.5);
    });

    test('Should return 0 risk and size for Grade C or D', () => {
      const resultC = calcPositionSize(100, 95, 'C', 'ACTIVE');
      const resultD = calcPositionSize(100, 95, 'D', 'ACTIVE');
      expect(resultC.positionSize).toBe(0);
      expect(resultD.positionSize).toBe(0);
    });
  });

  describe('Circuit Breaker Logic', () => {
    test('Should not trip if failures < 3', () => {
      getAllTrades.mockReturnValue([
        { status: 'FAILED', closedAt: '2026-08-10T00:00:00Z' },
        { status: 'SUCCESS', closedAt: '2026-08-09T00:00:00Z' },
        { status: 'FAILED', closedAt: '2026-08-08T00:00:00Z' }
      ]);

      const state = getCircuitBreakerState();
      expect(state.tripped).toBe(false);
      expect(state.consecutiveFails).toBe(1);
    });

    test('Should trip if consecutive failures are 3 or more', () => {
      getAllTrades.mockReturnValue([
        { status: 'FAILED', closedAt: '2026-08-10T00:03:00Z' },
        { status: 'FAILED', closedAt: '2026-08-10T00:02:00Z' },
        { status: 'FAILED', closedAt: '2026-08-10T00:01:00Z' },
        { status: 'SUCCESS', closedAt: '2026-08-09T00:00:00Z' }
      ]);

      const state = getCircuitBreakerState();
      expect(state.tripped).toBe(true);
      expect(state.consecutiveFails).toBe(3);
    });
  });
});
