import { useEffect, useMemo, useState } from 'react';
import { type Workflow } from '../types/workflow.ts';
import { type ValidationProblem } from '../types/validation.ts';
import { type WorkflowValidator } from '../types/spi.ts';
import { createDebouncedValidator } from '../validation/hostValidation.ts';

/**
 * Stable empty result returned when no validator is configured. Sharing one
 * reference (rather than a fresh `[]` literal) keeps the hook's return value
 * referentially stable across renders, so consumers memoizing on it — and
 * effects like `onValidationChange` — don't re-run on every unrelated render.
 */
const EMPTY_PROBLEMS: ValidationProblem[] = [];

/**
 * Runs an optional host {@link WorkflowValidator} as the workflow changes,
 * debounced and async-safe, and returns its latest problems. Returns an empty
 * array (and does no work) when no validator is provided.
 *
 * @param workflow the current workflow definition
 * @param validate the host validator, or undefined
 * @returns the latest host validation problems
 */
export function useHostValidation(
  workflow: Workflow,
  validate: WorkflowValidator | undefined,
): ValidationProblem[] {
  const [hostProblems, setHostProblems] = useState<ValidationProblem[]>([]);

  // Re-keyed on the `validate` identity: a host passing an inline function
  // rebuilds the validator (and restarts the debounce) every render. Hosts
  // should pass a stable/`useCallback`-wrapped validator to avoid that.
  const validator = useMemo(
    () => (validate ? createDebouncedValidator({ validate }) : undefined),
    [validate],
  );

  useEffect(() => {
    if (!validator) return;
    validator.run(workflow, setHostProblems);
    return () => validator.cancel();
  }, [validator, workflow]);

  return validator ? hostProblems : EMPTY_PROBLEMS;
}
