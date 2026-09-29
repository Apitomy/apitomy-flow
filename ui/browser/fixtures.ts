import type { Workflow, WorkflowInstance } from '../src/index.ts';

/** Hand-authored graph with literal inputs and a second draft-editable node. */
export function workflow(positioned = true): Workflow {
    const result: Workflow = {
        id: 'original', name: 'Original', description: 'Original description', version: 1,
        nodes: [
            { id: 's', type: 'start', name: 'Start', config: {}, position: { x: 0, y: 100 } },
            { id: 'a', type: 'action', name: 'Action', config: { actionType: 'noop',
                inputs: { first: 'context.first', count: 3, enabled: false, data: { nested: [1, null] } },
                outputs: [] }, position: { x: 230, y: 20 } },
            { id: 'h', type: 'human-task', name: 'Review', config: { description: 'Review request',
                inputs: { first: 'context.first', count: 3, enabled: false, data: { nested: [1, null] } },
                outputs: [] }, position: { x: 460, y: 160 } },
            { id: 'e', type: 'end', name: 'End', config: {}, position: { x: 690, y: 100 } },
        ],
        edges: [
            { id: 'sa', source: 's', target: 'a', priority: 0, isDefault: false },
            { id: 'ah', source: 'a', target: 'h', priority: 0, isDefault: false },
            { id: 'he', source: 'h', target: 'e', priority: 0, isDefault: false },
        ],
    };
    if (!positioned) result.nodes.forEach(node => { delete (node as Partial<typeof node>).position; });
    return result;
}

/** Positionless import deliberately reuses IDs and carries new metadata and extensions. */
export function importedWorkflow(): Workflow {
    return { ...workflow(false), id: 'imported', name: 'Imported', description: 'Imported description', version: 7 };
}

/** Loop visits and concurrent branch history supplied by a real host to the viewer. */
export function instance(updated = false): WorkflowInstance {
    const time = '2026-09-21T12:00:00Z';
    return {
        id: 'instance', workflowId: 'original', currentNodeId: null, status: updated ? 'completed' : 'waiting',
        activeBranches: updated ? [] : [{ branchId: 'left', nodeId: 'a' }, { branchId: 'right', nodeId: 'h' }],
        joinArrivals: {}, context: { live: updated ? 'new context' : 'initial context' },
        history: [
            { nodeId: 'a', nodeName: 'Action', branchId: 'left', enteredOn: time, completedOn: time, output: { visit: 'first' } },
            { nodeId: 'a', nodeName: 'Action', branchId: 'left', enteredOn: time, output: { visit: 'second' } },
            { nodeId: 'h', nodeName: 'Review', branchId: 'right', enteredOn: time },
            ...(updated ? [{ nodeId: 'a', nodeName: 'Action', branchId: 'right', enteredOn: time,
                completedOn: time, output: { visit: 'third' } }] : []),
        ], createdOn: time, updatedOn: time,
    };
}
