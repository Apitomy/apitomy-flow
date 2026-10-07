import { type ReceiveEventConfig } from '../types/workflow.ts';

/** Editor-facing look-back mode for a receive-event node. */
export type LookbackMode = 'run-start' | 'none' | 'duration';

/** The default look-back applied by hosts when `lookback` is absent. */
export const DEFAULT_LOOKBACK = 'run-start';

/**
 * Classifies an authored `lookback` value into an editor mode. Absent/null means the `run-start` default;
 * any value other than the two keywords is treated as a duration.
 */
export function lookbackMode(value: string | null | undefined): LookbackMode {
  if (value == null || value === 'run-start') return 'run-start';
  if (value === 'none') return 'none';
  return 'duration';
}

/**
 * Returns a new config with the look-back set for the given mode. Choosing `run-start` removes the
 * property (it is the default); choosing `duration` keeps the existing duration text or seeds `PT10M`.
 */
export function withLookback(config: ReceiveEventConfig, mode: LookbackMode, duration?: string): ReceiveEventConfig {
  const next: ReceiveEventConfig = { ...config };
  if (mode === 'run-start') {
    delete next.lookback;
  } else if (mode === 'none') {
    next.lookback = 'none';
  } else {
    const current = lookbackMode(config.lookback) === 'duration' ? config.lookback : undefined;
    next.lookback = duration ?? current ?? 'PT10M';
  }
  return next;
}

/** Formats a look-back for display, marking the default when the property is absent. */
export function describeLookback(value: string | null | undefined): string {
  return value == null ? `${DEFAULT_LOOKBACK} (default)` : value;
}
