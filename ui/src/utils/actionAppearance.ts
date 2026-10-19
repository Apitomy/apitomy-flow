import type { ReactNode } from 'react';
import type { ActionTypeCatalog } from '../hooks/actionTypeCatalogState.ts';
import type { WorkflowNode } from '../types/workflow.ts';

/** Host-chosen look for an Action node, taken from its Action Type descriptor. */
export interface ActionAppearance {
    /** Replaces the default play icon. */
    icon?: ReactNode;
    /** Accent color (any CSS color) for the node border and icon. */
    color?: string;
}

/**
 * Finds the appearance for one Action Type value.
 *
 * @param actionType the node's `config.actionType`, of any type
 * @param catalog the loaded Action Type catalog
 * @returns the descriptor's icon and/or color, or undefined when there is no match or nothing to style
 */
export function actionAppearanceFor(actionType: unknown, catalog: ActionTypeCatalog): ActionAppearance | undefined {
    if (typeof actionType !== 'string') return undefined;
    const descriptor = catalog.actionTypes.find(candidate => candidate.value === actionType);
    if (!descriptor) return undefined;
    const icon = descriptor.icon ?? undefined;
    const color = typeof descriptor.color === 'string' && descriptor.color.trim() !== ''
        ? descriptor.color : undefined;
    if (icon === undefined && color === undefined) return undefined;
    const appearance: ActionAppearance = {};
    if (icon !== undefined) appearance.icon = icon;
    if (color !== undefined) appearance.color = color;
    return appearance;
}

/**
 * Computes appearances for every styled Action node.
 *
 * @param nodes the workflow nodes
 * @param catalog the loaded Action Type catalog
 * @returns node id to appearance, containing only Action nodes whose descriptor has an icon or color
 */
export function actionAppearanceByNodeId(nodes: WorkflowNode[], catalog: ActionTypeCatalog): Map<string, ActionAppearance> {
    const result = new Map<string, ActionAppearance>();
    if (catalog.actionTypes.length === 0) return result;
    for (const node of nodes) {
        if (node.type !== 'action') continue;
        const appearance = actionAppearanceFor(node.config.actionType, catalog);
        if (appearance) result.set(node.id, appearance);
    }
    return result;
}
