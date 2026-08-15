/**
 * logger.js — Structured logging for ARIS Trading Analyzer.
 *
 * Replaces all console.log/warn/error calls with structured JSON logs.
 * Each log entry includes: timestamp, level, module, correlationId (scan/trade ID), message.
 *
 * In development (NODE_ENV != 'production'):  pretty-printed colored output via pino-pretty.
 * In production:  raw JSON lines — suitable for log aggregators (Datadog, Loki, etc.)
 *
 * Usage:
 *   import { createLogger } from './logger.js';
 *   const log = createLogger('scanner');
 *   log.info({ symbol: 'BTCUSDT', scanId }, 'Scan started');
 *   log.error({ err: e.message }, 'Scan failed');
 */

import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

// Root logger — all module loggers are children of this
const rootLogger = pino(
  {
    level: process.env.LOG_LEVEL || 'info',
    base: { pid: process.pid },
    timestamp: pino.stdTimeFunctions.isoTime,
    // Serialize Error objects properly
    serializers: {
      err: pino.stdSerializers.err
    }
  },
  isDev
    ? pino.transport({
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
          messageFormat: '[{module}] {msg}',
          singleLine: false
        }
      })
    : process.stdout
);

/**
 * Creates a child logger scoped to a specific module.
 * @param {string} module - e.g. 'scanner', 'tracker', 'aiProvider', 'server'
 * @returns pino child logger
 */
export function createLogger(module) {
  return rootLogger.child({ module });
}

// ─────────────────────────────────────────────
// Pre-built module loggers (import directly)
// ─────────────────────────────────────────────
export const scannerLog  = createLogger('scanner');
export const trackerLog  = createLogger('tracker');
export const aiLog       = createLogger('aiProvider');
export const serverLog   = createLogger('server');
export const dbLog       = createLogger('db');

export default rootLogger;
