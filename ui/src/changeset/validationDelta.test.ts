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
