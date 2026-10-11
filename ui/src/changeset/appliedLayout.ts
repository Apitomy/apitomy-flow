import { layoutWorkflow } from '../layout/layoutWorkflow.ts';
import type { Workflow } from '../types/workflow.ts';
import type { ChangeSet } from './types.ts';

/**
 * How the editor lays out the result of an AI or host change set.
 *
 * - `'place'`: only nodes without a position are placed, next to their neighbours; existing nodes never move.
 * - `'tidy'`: when the change set alters the graph's structure, the whole graph is auto-laid-out (like the
 *   toolbar's Tidy up). The tidy is part of the proposal preview and of the same undo step as the change.
 */
export type AppliedChangeLayout = 'place' | 'tidy';

/**
 * Whether a change set alters the graph structure: adds or removes nodes or edges, or re-points an edge.
 *
 * @param changeSet the change set
 * @returns true when a re-layout could be needed
 */
export function changesStructure(changeSet: ChangeSet): boolean {
    return changeSet.ops.some(op => op.op === 'addNode' || op.op === 'removeNode' || op.op === 'addEdge'
        || op.op === 'removeEdge'
        || (op.op === 'updateEdge' && !!op.patch && ('source' in op.patch || 'target' in op.patch)));
}

/**
 * Applies the editor's layout policy to the result of a change set. Layout is not content, so this never
 * changes the workflow's content revision.
 *
 * @param workflow the workflow after the change set was applied
 * @param changeSet the change set that produced it
 * @param mode the layout policy
 * @returns the same object when nothing is re-laid-out, otherwise a copy with new positions
 */
export function layoutAppliedChange(workflow: Workflow, changeSet: ChangeSet, mode: AppliedChangeLayout): Workflow {
    if (mode !== 'tidy' || !changesStructure(changeSet)) return workflow;
    return { ...workflow, nodes: layoutWorkflow(workflow.nodes, workflow.edges) };
}
