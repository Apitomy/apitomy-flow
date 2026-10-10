import type { ReactNode } from 'react';
import type { ContextAction, FlowContext, FlowTarget } from '../types/spi.ts';

type Log = (...args: unknown[]) => void;
const defaultLog: Log = (...args) => console.error(...args);

/** A built-in editing item (Clone/Delete). */
export interface BuiltInItem {
    id: string;
    label: string;
    danger?: boolean;
    onSelect: () => void;
}

/** Editor operations the built-in items invoke. */
export interface BuiltInHandlers {
    clone: (nodeId: string) => void;
    deleteElements: (nodeIds: string[], edgeIds: string[]) => void;
}

/** One rendered menu row. `run` performs the action; ids are unique within a menu. */
export type MenuEntry =
    | { type: 'item'; id: string; label: string; icon?: ReactNode; danger: boolean; disabled: boolean;
        source: 'builtin' | 'host'; run: () => void }
    | { type: 'divider'; id: 'divider' };

/**
 * Lists the built-in items for a target.
 *
 * @param target the menu target
 * @param handlers editor operations
 * @returns Clone/Delete for nodes, Delete for edges and selections, nothing otherwise
 */
export function builtInItems(target: FlowTarget, handlers: BuiltInHandlers): BuiltInItem[] {
    switch (target.kind) {
        case 'node':
            return [
                { id: 'clone', label: 'Clone', onSelect: () => handlers.clone(target.nodeId) },
                { id: 'delete', label: 'Delete', danger: true, onSelect: () => handlers.deleteElements([target.nodeId], []) },
            ];
        case 'edge':
            return [{ id: 'delete', label: 'Delete', danger: true, onSelect: () => handlers.deleteElements([], [target.edgeId]) }];
        case 'selection':
            return [{ id: 'delete', label: 'Delete', danger: true,
                onSelect: () => handlers.deleteElements(target.nodeIds, target.edgeIds) }];
        default:
            return [];
    }
}

function hostActions(contextActions: ((context: FlowContext) => ContextAction[]) | undefined, context: FlowContext,
    log: Log): ContextAction[] {
    if (!contextActions) return [];
    let result: unknown;
    try {
        result = contextActions(context);
    } catch (error) {
        log('contextActions threw; showing built-in items only', error);
        return [];
    }
    if (!Array.isArray(result)) {
        log('contextActions must return an array; ignoring', result);
        return [];
    }
    return result.filter((action): action is ContextAction => {
        const valid = !!action && typeof action === 'object' && typeof action.id === 'string'
            && typeof action.label === 'string' && typeof action.onSelect === 'function';
        if (!valid) log('Ignoring invalid context action (needs string id, string label and onSelect)', action);
        return valid;
    });
}

/**
 * Merges built-in and host items: built-ins first, a divider only when both groups are non-empty, then host
 * items. Host failures are logged and never prevent the built-ins from showing.
 *
 * @param builtIns the built-in items for this target (empty when editing is unavailable)
 * @param contextActions the host function, if configured
 * @param context the context for this menu opening
 * @param log error logger (defaults to `console.error`)
 * @returns the entries to render; empty means no menu should open
 */
export function resolveMenuItems(builtIns: BuiltInItem[], contextActions: ((context: FlowContext) => ContextAction[]) | undefined,
    context: FlowContext, log: Log = defaultLog): MenuEntry[] {
    const fixed: MenuEntry[] = builtIns.map(item => ({ type: 'item', id: `builtin:${item.id}`, label: item.label,
        danger: !!item.danger, disabled: false, source: 'builtin', run: item.onSelect }));
    const host: MenuEntry[] = hostActions(contextActions, context, log).map(action => ({ type: 'item',
        id: `host:${action.id}`, label: action.label, icon: action.icon, danger: !!action.danger,
        disabled: !!action.disabled, source: 'host', run: () => action.onSelect(context) }));
    return fixed.length && host.length ? [...fixed, { type: 'divider', id: 'divider' }, ...host] : [...fixed, ...host];
}

/**
 * Runs an entry, logging (never throwing) if it fails. Disabled items and dividers do nothing.
 *
 * @param entry the entry the user chose
 * @param log error logger (defaults to `console.error`)
 */
export function runMenuEntry(entry: MenuEntry, log: Log = defaultLog): void {
    if (entry.type !== 'item' || entry.disabled) return;
    try {
        entry.run();
    } catch (error) {
        log(`Context menu action "${entry.label}" threw`, error);
    }
}
