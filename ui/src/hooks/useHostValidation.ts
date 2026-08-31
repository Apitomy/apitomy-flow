import { useEffect, useMemo, useState } from 'react';
import { type Workflow } from '../types/workflow.ts';
import { type ValidationProblem } from '../types/validation.ts';
import { type WorkflowValidator } from '../types/spi.ts';
import { createDebouncedValidator } from '../validation/hostValidation.ts';

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

  const validator = useMemo(
    () => (validate ? createDebouncedValidator({ validate }) : undefined),
    [validate],
  );

  useEffect(() => {
    if (!validator) return;
    validator.run(workflow, setHostProblems);
    return () => validator.cancel();
  }, [validator, workflow]);

  return validator ? hostProblems : [];
}
