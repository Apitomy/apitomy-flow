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
    return new Set(workflow.nodes
        .filter(node => node.type === 'action' && isUnresolvedValue(node.config.actionType, known))
        .map(node => node.id));
}

/**
 * Whether a single Action Type value is unresolved: a non-blank string missing from a `ready` catalog.
 * Non-string values (e.g. a number from hand-edited JSON) are never unresolved and never throw.
 *
 * @param value the node's `config.actionType`, of any type
 * @param catalog the editor's catalog
 * @returns true when the value should be flagged as unresolved
 */
export function isUnresolvedActionType(value: unknown, catalog: ActionTypeCatalog): boolean {
    if (catalog.status !== 'ready') return false;
    return isUnresolvedValue(value, new Set(catalog.actionTypes.map(descriptor => descriptor.value)));
}

function isUnresolvedValue(value: unknown, known: Set<string>): boolean {
    return typeof value === 'string' && value.trim() !== '' && !known.has(value);
}
