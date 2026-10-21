import { type RetryPolicy, type WorkflowDefaults, type WorkflowNode } from '../types/workflow.ts';

/** The policy governing an action node and where it was declared. */
export interface EffectiveRetryPolicy {
    policy: RetryPolicy;
    source: 'node' | 'workflow';
}

/**
 * Resolves an action node's effective retry policy: its own `config.retry`, else `defaults.retry`.
 *
 * @returns the policy and its source, or `undefined` for non-action nodes and legacy (no policy) behavior
 */
export function effectiveRetryPolicy(node: WorkflowNode, defaults?: WorkflowDefaults | null): EffectiveRetryPolicy | undefined {
    if (node.type !== 'action') return undefined;
    if (node.config.retry) return { policy: node.config.retry, source: 'node' };
    if (defaults?.retry) return { policy: defaults.retry, source: 'workflow' };
    return undefined;
}

/** Summarizes a policy in one human-readable sentence for tooltips and the properties panel. */
export function describeRetryPolicy(policy: RetryPolicy): string {
    if (policy.maxAttempts === 1) return '1 attempt, no retries';
    const attempts = `Up to ${policy.maxAttempts ?? '?'} attempts`;
    const delay = policy.delay ?? 'PT0S';
    if (/^P(?:0D)?(?:T(?:0H)?(?:0M)?(?:0(?:\.0+)?S)?)?$/.test(delay)) return `${attempts}, retried immediately`;
    const jitter = policy.jitter ? ', with jitter' : '';
    if (policy.backoff === 'exponential') {
        const extras = [`x${policy.multiplier ?? 2}`, ...(policy.maxDelay ? [`max ${policy.maxDelay}`] : [])];
        return `${attempts}, exponential backoff from ${delay} (${extras.join(', ')})${jitter}`;
    }
    return `${attempts}, ${delay} between attempts${policy.maxDelay ? ` (max ${policy.maxDelay})` : ''}${jitter}`;
}

/** Compact canvas badge for an action node's effective retry policy. */
export interface RetryBadge {
    label: string;
    title: string;
}

/**
 * Computes retry badges for action nodes that have an effective declared policy.
 *
 * @param nodes the workflow's nodes
 * @param defaults the workflow's top-level defaults, whose `retry` applies to actions without their own policy
 * @returns badges keyed by node id; nodes without an effective policy are absent
 */
export function retryBadgesByNodeId(nodes: WorkflowNode[], defaults?: WorkflowDefaults | null): Map<string, RetryBadge> {
    const badges = new Map<string, RetryBadge>();
    for (const node of nodes) {
        const effective = effectiveRetryPolicy(node, defaults);
        if (!effective) continue;
        const prefix = effective.source === 'workflow' ? 'Retry (workflow default): ' : 'Retry: ';
        badges.set(node.id, { label: `↻${effective.policy.maxAttempts ?? '?'}`,
            title: prefix + describeRetryPolicy(effective.policy) });
    }
    return badges;
}
