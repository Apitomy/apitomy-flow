import { describe, it, expect } from 'vitest';
import { validationDelta } from './validationDelta.ts';
import type { ValidationProblem } from '../types/validation.ts';

const problem = (code: string, nodeId?: string): ValidationProblem =>
    ({ severity: 'error', code, message: `${code} message`, ...(nodeId ? { nodeId } : {}) });

describe('validationDelta', () => {
    it('reports problems introduced and fixed, ignoring message text', () => {
        const current = [problem('A', 'n1'), problem('B')];
        const preview = [{ ...problem('B'), message: 'reworded' }, problem('C', 'n2')];
        expect(validationDelta(current, preview)).toEqual({ introduced: [problem('C', 'n2')], fixed: [problem('A', 'n1')] });
    });
});

describe('validationDelta edge cases', () => {
    it('treats a severity change as one problem fixed and one introduced', () => {
        const warning: ValidationProblem = { ...problem('A', 'n1'), severity: 'warning' };
        expect(validationDelta([problem('A', 'n1')], [warning])).toEqual({ introduced: [warning], fixed: [problem('A', 'n1')] });
    });

    it('distinguishes edge targets and handles empty lists', () => {
        const onEdge: ValidationProblem = { severity: 'error', code: 'E', message: 'm', edgeId: 'e1' };
        const onOtherEdge: ValidationProblem = { ...onEdge, edgeId: 'e2' };
        expect(validationDelta([onEdge], [onOtherEdge])).toEqual({ introduced: [onOtherEdge], fixed: [onEdge] });
        expect(validationDelta([], [])).toEqual({ introduced: [], fixed: [] });
    });
});
