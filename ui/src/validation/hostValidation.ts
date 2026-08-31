import { type Workflow } from '../types/workflow.ts';
import { type ValidationProblem } from '../types/validation.ts';
import { type WorkflowValidator } from '../types/spi.ts';

export const DEFAULT_DELAY = 300;

export interface DebouncedValidatorOptions {
  validate: WorkflowValidator;
  /** Debounce delay in milliseconds (default {@link DEFAULT_DELAY}). */
  delay?: number;
}

export interface DebouncedValidator {
  /** Schedule a (debounced) validation run; `onResult` fires with the latest problems. */
  run(workflow: Workflow, onResult: (problems: ValidationProblem[]) => void): void;
  /** Cancel any pending run and invalidate any in-flight async result. */
  cancel(): void;
}

/**
 * Creates a debounced, async-safe wrapper around a host {@link WorkflowValidator}.
 * Coalesces rapid calls, normalizes sync/async return values, and drops stale
 * (out-of-order) results so only the most recent run is ever applied. Validator
 * failures are swallowed (yield `[]` and warn) so they never affect built-in
 * validation.
 */
export function createDebouncedValidator(opts: DebouncedValidatorOptions): DebouncedValidator {
  const delay = opts.delay ?? DEFAULT_DELAY;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let latestToken = 0;

  function run(workflow: Workflow, onResult: (problems: ValidationProblem[]) => void): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(async () => {
      timer = undefined;
      const token = ++latestToken;
      try {
        const problems = await opts.validate(workflow);
        if (token === latestToken) onResult(problems);
      } catch (err) {
        if (token === latestToken) {
          console.warn('Host workflow validation failed:', err);
          onResult([]);
        }
      }
    }, delay);
  }

  function cancel(): void {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    // Invalidate any in-flight promise so its result is ignored.
    latestToken++;
  }

  return { run, cancel };
}
