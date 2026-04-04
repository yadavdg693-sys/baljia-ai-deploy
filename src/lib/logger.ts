// Structured Logger — replaces console.log/error/warn across the platform
// FIX: G-OBS-001 — JSON structured logging with context
//
// Usage:
//   import { logger } from '@/lib/logger';
//   logger.info('Task started', { taskId, company_id, agent: 'engineering' });
//   logger.error('Credit deduction failed', { company_id, error });

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  service: string;
  context?: Record<string, unknown>;
  error?: {
    message: string;
    stack?: string;
    name?: string;
  };
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Default to 'info' in production, 'debug' in development
const MIN_LEVEL = (process.env.LOG_LEVEL as LogLevel) ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[MIN_LEVEL];
}

function formatError(err: unknown): LogEntry['error'] | undefined {
  if (!err) return undefined;
  if (err instanceof Error) {
    return {
      message: err.message,
      stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
      name: err.name,
    };
  }
  return { message: String(err) };
}

function emit(level: LogLevel, service: string, message: string, context?: Record<string, unknown>, err?: unknown): void {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    service,
    context,
    error: formatError(err),
  };

  // In production: JSON to stdout (for log aggregators like Datadog, CloudWatch)
  // In development: human-readable colored output
  if (process.env.NODE_ENV === 'production') {
    const output = JSON.stringify(entry);
    if (level === 'error') process.stderr.write(output + '\n');
    else process.stdout.write(output + '\n');
  } else {
    const prefix = `[${entry.service}]`;
    const ctx = context ? ` ${JSON.stringify(context)}` : '';
    switch (level) {
      case 'debug': console.debug(prefix, message, ctx); break;
      case 'info':  console.log(prefix, message, ctx); break;
      case 'warn':  console.warn(prefix, message, ctx); break;
      case 'error': console.error(prefix, message, ctx, err ?? ''); break;
    }
  }
}

/**
 * Create a scoped logger for a specific service.
 * @example const log = createLogger('Worker');
 */
export function createLogger(service: string) {
  return {
    debug: (message: string, context?: Record<string, unknown>) => emit('debug', service, message, context),
    info:  (message: string, context?: Record<string, unknown>) => emit('info', service, message, context),
    warn:  (message: string, context?: Record<string, unknown>) => emit('warn', service, message, context),
    error: (message: string, context?: Record<string, unknown>, err?: unknown) => emit('error', service, message, context, err),
  };
}

/**
 * Default logger (service = 'App').
 */
export const logger = createLogger('App');
