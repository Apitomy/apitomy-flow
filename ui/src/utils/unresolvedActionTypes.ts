import type { ActionTypeCatalog } from '../hooks/actionTypeCatalogState.ts';
import type { Workflow } from '../types/workflow.ts';

/**
 * Finds action nodes whose Action Type is not in a loaded catalog.
 *
 * @param workflow the workflow
 * @param catalog the editor's catalog
 * @returns ids of unresolved action nodes; empty unless the catalog status is `ready`
 */
export function unresolvedActionTypeIds(workflow: Workflow, catalog: ActionTypeCatalog): Set<string> {
    if (catalog.status !== 'ready') return new Set();
    const known = new Set(catalog.actionTypes.map(descriptor => descriptor.value));
    return new Set(workflow.nodes.filter(node => {
        if (node.type !== 'action') return false;
        const value = node.config.actionType;
        return typeof value === 'string' && value.trim() !== '' && !known.has(value);
    }).map(node => node.id));
}
