import { describe, expect, it } from 'vitest';
import { describeRetryPolicy, effectiveRetryPolicy } from './retryPolicy.ts';
import { isoDurationMillis } from '../validation/validateWorkflow.ts';
import { type WorkflowNode } from '../types/workflow.ts';

const action = (retry?: object): WorkflowNode => ({ id: 'a', name: 'a', type: 'action',
    config: { actionType: 't', ...(retry ? { retry } : {}) } } as WorkflowNode);

describe('retry policy utilities', () => {
    it('prefers the node policy over the workflow default', () => {
        expect(effectiveRetryPolicy(action({ maxAttempts: 2 }), { retry: { maxAttempts: 9 } }))
            .toEqual({ policy: { maxAttempts: 2 }, source: 'node' });
        expect(effectiveRetryPolicy(action(), { retry: { maxAttempts: 9 } }))
            .toEqual({ policy: { maxAttempts: 9 }, source: 'workflow' });
        expect(effectiveRetryPolicy(action(), undefined)).toBeUndefined();
        expect(effectiveRetryPolicy({ id: 'e', name: 'e', type: 'end', config: {} }, { retry: { maxAttempts: 9 } }))
            .toBeUndefined();
    });

    it('describes policies', () => {
        expect(describeRetryPolicy({ maxAttempts: 3 })).toBe('Up to 3 attempts, retried immediately');
        expect(describeRetryPolicy({ maxAttempts: 5, delay: 'PT2S' })).toBe('Up to 5 attempts, PT2S between attempts');
        expect(describeRetryPolicy({ maxAttempts: 5, delay: 'PT2S', backoff: 'exponential', multiplier: 3,
            maxDelay: 'PT1M', jitter: true }))
            .toBe('Up to 5 attempts, exponential backoff from PT2S (x3, max PT1M), with jitter');
    });

    it('describes a single-attempt policy as no retries', () => {
        expect(describeRetryPolicy({ maxAttempts: 1 })).toBe('1 attempt, no retries');
        expect(describeRetryPolicy({ maxAttempts: 1, delay: 'PT5S', backoff: 'exponential' })).toBe('1 attempt, no retries');
    });

    it('parses ISO durations to milliseconds', () => {
        expect(isoDurationMillis('PT0S')).toBe(0);
        expect(isoDurationMillis('P1DT1H1M1.5S')).toBe(90061500);
        expect(isoDurationMillis('soon')).toBeUndefined();
    });
});
