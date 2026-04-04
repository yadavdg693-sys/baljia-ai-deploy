import { describe, it, expect } from 'vitest';
import { createLogger } from '@/lib/logger';
import type { LogLevel } from '@/lib/logger';

describe('Logger', () => {
  describe('createLogger', () => {
    it('returns an object with all log levels', () => {
      const log = createLogger('TestService');

      expect(log).toBeDefined();
      expect(typeof log.debug).toBe('function');
      expect(typeof log.info).toBe('function');
      expect(typeof log.warn).toBe('function');
      expect(typeof log.error).toBe('function');
    });

    it('does not throw when calling any log level', () => {
      const log = createLogger('TestService');

      expect(() => log.debug('debug message')).not.toThrow();
      expect(() => log.info('info message')).not.toThrow();
      expect(() => log.warn('warn message')).not.toThrow();
      expect(() => log.error('error message')).not.toThrow();
    });

    it('accepts context objects', () => {
      const log = createLogger('TestService');

      expect(() =>
        log.info('with context', { taskId: '123', companyId: 'abc' })
      ).not.toThrow();
    });

    it('accepts error objects in error level', () => {
      const log = createLogger('TestService');
      const error = new Error('test error');

      expect(() =>
        log.error('something failed', { taskId: '123' }, error)
      ).not.toThrow();
    });

    it('creates different loggers with different service names', () => {
      const log1 = createLogger('Service1');
      const log2 = createLogger('Service2');

      // Both should work independently
      expect(() => log1.info('from service 1')).not.toThrow();
      expect(() => log2.info('from service 2')).not.toThrow();
    });
  });

  describe('LogLevel type', () => {
    it('recognizes valid log levels', () => {
      const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
      expect(levels).toHaveLength(4);
    });
  });
});
