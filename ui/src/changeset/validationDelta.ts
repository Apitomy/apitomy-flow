import type { ValidationProblem } from '../types/validation.ts';

/** Problems a proposal would introduce and problems it would fix. */
export interface ValidationDelta {
    introduced: ValidationProblem[];
    fixed: ValidationProblem[];
}

const problemKey = (problem: ValidationProblem) =>
    [problem.code, problem.severity, problem.nodeId ?? '', problem.edgeId ?? ''].join('|');

/**
 * Compares current and previewed validation results by code, severity and target (not message text).
 *
 * @param current problems of the current workflow
 * @param preview problems of the proposed workflow
 * @returns introduced and fixed problems
 */
export function validationDelta(current: ValidationProblem[], preview: ValidationProblem[]): ValidationDelta {
    const currentKeys = new Set(current.map(problemKey));
    const previewKeys = new Set(preview.map(problemKey));
    return {
        introduced: preview.filter(problem => !currentKeys.has(problemKey(problem))),
        fixed: current.filter(problem => !previewKeys.has(problemKey(problem))),
    };
}
