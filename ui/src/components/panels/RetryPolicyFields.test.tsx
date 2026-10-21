import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RetryPolicyFields, updateRetryPolicy } from './RetryPolicyFields.tsx';

vi.mock('@patternfly/react-core', () => ({}));
vi.mock('@patternfly/react-icons', () => ({}));

describe('retry policy fields', () => {
    it('renders only the enable checkbox when no policy is set', () => {
        const markup = renderToStaticMarkup(<RetryPolicyFields policy={undefined} onChange={() => {}}
            enableLabel="Override workflow default" inheritedHint="Inherits: Up to 3 attempts, retried immediately" />);
        expect(markup).toContain('Override workflow default');
        expect(markup).toContain('Inherits: Up to 3 attempts');
        expect(markup).not.toContain('Max attempts');
    });

    it('renders fields and hides multiplier for fixed backoff', () => {
        const markup = renderToStaticMarkup(<RetryPolicyFields policy={{ maxAttempts: 4, delay: 'PT2S' }}
            onChange={() => {}} enableLabel="Retry" />);
        expect(markup).toContain('Max attempts');
        expect(markup).toContain('value="4"');
        expect(markup).toContain('value="PT2S"');
        expect(markup).not.toContain('Multiplier');
        expect(markup).toContain('Up to 4 attempts, PT2S between attempts');
    });

    it('shows multiplier for exponential backoff', () => {
        const markup = renderToStaticMarkup(<RetryPolicyFields policy={{ maxAttempts: 4, backoff: 'exponential' }}
            onChange={() => {}} enableLabel="Retry" />);
        expect(markup).toContain('Multiplier');
    });

    it('drops blank fields and multiplier when switching to fixed', () => {
        expect(updateRetryPolicy({ maxAttempts: 3, delay: 'PT1S' }, 'delay', '')).toEqual({ maxAttempts: 3 });
        expect(updateRetryPolicy({ maxAttempts: 3, backoff: 'exponential', multiplier: 3 }, 'backoff', 'fixed'))
            .toEqual({ maxAttempts: 3, backoff: 'fixed' });
    });
});
