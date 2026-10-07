import { describe, expect, it } from 'vitest';
import { describeLookback, lookbackMode, withLookback } from './lookback.ts';

describe('lookback helpers', () => {
  it('classifies values into modes', () => {
    expect(lookbackMode(undefined)).toBe('run-start');
    expect(lookbackMode(null)).toBe('run-start');
    expect(lookbackMode('run-start')).toBe('run-start');
    expect(lookbackMode('none')).toBe('none');
    expect(lookbackMode('PT10M')).toBe('duration');
  });

  it('applies modes to config', () => {
    expect(withLookback({ eventType: 'x', lookback: 'none' }, 'run-start')).toEqual({ eventType: 'x' });
    expect(withLookback({ eventType: 'x' }, 'none')).toEqual({ eventType: 'x', lookback: 'none' });
    expect(withLookback({ eventType: 'x' }, 'duration')).toEqual({ eventType: 'x', lookback: 'PT10M' });
    expect(withLookback({ lookback: 'PT1H' }, 'duration')).toEqual({ lookback: 'PT1H' });
    expect(withLookback({ lookback: 'PT1H' }, 'duration', 'PT5M')).toEqual({ lookback: 'PT5M' });
  });

  it('describes the default', () => {
    expect(describeLookback(undefined)).toBe('run-start (default)');
    expect(describeLookback('PT5M')).toBe('PT5M');
  });
});
