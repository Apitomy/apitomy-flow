import { type RetryPolicy } from '../../types/workflow.ts';
import { describeRetryPolicy } from '../../utils/retryPolicy.ts';

type RetryField = 'maxAttempts' | 'delay' | 'backoff' | 'multiplier' | 'maxDelay' | 'jitter';

/**
 * Returns a copy of `policy` with one field changed from raw input text. Blank text removes the field;
 * numeric fields parse as numbers; switching to fixed backoff drops the multiplier.
 */
export function updateRetryPolicy(policy: RetryPolicy, field: RetryField, raw: string | boolean): RetryPolicy {
    const next: RetryPolicy = { ...policy };
    if (raw === '' || raw === false) {
        delete next[field];
    } else if (field === 'maxAttempts' || field === 'multiplier') {
        next[field] = Number(raw);
    } else if (field === 'jitter') {
        next.jitter = true;
    } else if (field === 'backoff') {
        next.backoff = raw === 'exponential' ? 'exponential' : 'fixed';
    } else {
        next[field] = String(raw);
    }
    if (next.backoff !== 'exponential') delete next.multiplier;
    return next;
}

/**
 * Edits an optional retry policy. Unchecking the enable box removes the policy (`onChange(undefined)`);
 * checking it starts from `{ maxAttempts: 3 }`.
 */
export function RetryPolicyFields({ policy, onChange, enableLabel, inheritedHint }: {
    policy: RetryPolicy | null | undefined;
    onChange: (policy: RetryPolicy | undefined) => void;
    enableLabel: string;
    inheritedHint?: string;
}) {
    const set = (field: RetryField, raw: string | boolean) => policy && onChange(updateRetryPolicy(policy, field, raw));
    return (
        <div className="properties-panel__field properties-panel__retry">
            <label>
                <input type="checkbox" checked={!!policy}
                    onChange={e => onChange(e.target.checked ? { maxAttempts: 3 } : undefined)} />
                {' '}{enableLabel}
            </label>
            {!policy && inheritedHint && <div className="properties-panel__hint">{inheritedHint}</div>}
            {policy && (
                <>
                    <label>Max attempts</label>
                    <input type="number" min={1} step={1} value={policy.maxAttempts ?? ''}
                        onChange={e => set('maxAttempts', e.target.value)} />
                    <label>Delay (ISO 8601)</label>
                    <input type="text" value={policy.delay ?? ''} placeholder="e.g. PT5S — blank retries immediately"
                        onChange={e => set('delay', e.target.value)} />
                    <label>Backoff</label>
                    <select value={policy.backoff ?? 'fixed'} onChange={e => set('backoff', e.target.value)}>
                        <option value="fixed">Fixed</option>
                        <option value="exponential">Exponential</option>
                    </select>
                    {policy.backoff === 'exponential' && (
                        <>
                            <label>Multiplier</label>
                            <input type="number" min={1} step={0.1} value={policy.multiplier ?? ''} placeholder="2"
                                onChange={e => set('multiplier', e.target.value)} />
                        </>
                    )}
                    <label>Max delay (ISO 8601, optional)</label>
                    <input type="text" value={policy.maxDelay ?? ''} placeholder="e.g. PT1M"
                        onChange={e => set('maxDelay', e.target.value)} />
                    <label>
                        <input type="checkbox" checked={!!policy.jitter} onChange={e => set('jitter', e.target.checked)} />
                        {' '}Jitter
                    </label>
                    <div className="properties-panel__hint">{describeRetryPolicy(policy)}</div>
                </>
            )}
        </div>
    );
}
