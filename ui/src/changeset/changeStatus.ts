import { diffWorkflows } from '../diff/workflowDiff.ts';
import type { DiffStatus } from '../diff/workflowDiffTypes.ts';
import type { Workflow } from '../types/workflow.ts';
import type { Highlight } from './types.ts';

/** Review-oriented change classification; position-only (cosmetic) changes count as unchanged. */
export type ChangeKind = 'added' | 'modified' | 'removed' | 'unchanged';

/** Per-element change classification keyed by node and edge id. */
export interface ChangeStatusMap {
    nodes: Record<string, ChangeKind>;
    edges: Record<string, ChangeKind>;
}

function toKind(status: DiffStatus): ChangeKind {
    if (status === 'changed') return 'modified';
    if (status === 'cosmetic') return 'unchanged';
    return status;
}

/**
 * Classifies every node and edge of `before` ∪ `after`, reusing the `WorkflowDiffViewer` diff.
 *
 * @param before the current workflow
 * @param after the proposed or newly applied workflow
 * @returns the classification map
 */
export function changeStatus(before: Workflow, after: Workflow): ChangeStatusMap {
    const diff = diffWorkflows(before, after);
    return {
        nodes: Object.fromEntries(diff.nodeOrder.map(id => [id, toKind(diff.nodes[id].status)])),
        edges: Object.fromEntries(diff.edgeOrder.map(id => [id, toKind(diff.edges[id].status)])),
    };
}

/**
 * Collects the ids worth highlighting after an apply (added and modified, never removed).
 *
 * @param status the classification map
 * @returns sorted ids, or null when nothing was added or modified
 */
export function highlightOf(status: ChangeStatusMap): Highlight | null {
    const pick = (map: Record<string, ChangeKind>) =>
        Object.keys(map).filter(id => map[id] === 'added' || map[id] === 'modified').sort();
    const nodeIds = pick(status.nodes);
    const edgeIds = pick(status.edges);
    return nodeIds.length || edgeIds.length ? { nodeIds, edgeIds } : null;
}
