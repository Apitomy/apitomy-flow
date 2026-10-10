import { describe, it, expect, vi } from 'vitest';
import { builtInItems, resolveMenuItems, runMenuEntry, type MenuEntry } from './menuItems.ts';
import type { ContextAction, FlowContext } from '../types/spi.ts';

const context: FlowContext = { target: { kind: 'node', nodeId: 'a' }, workflow: { id: 'w', name: 'W', nodes: [], edges: [] },
    contentRevision: 'sha256:x', selection: { nodeIds: [], edgeIds: [] }, problems: [], readOnly: false,
    screenPosition: { x: 0, y: 0 } };
const handlers = () => ({ clone: vi.fn(), deleteElements: vi.fn() });
const labels = (entries: MenuEntry[]) => entries.map(entry => entry.type === 'divider' ? '---' : entry.label);

describe('builtInItems', () => {
    it('offers Clone and Delete for a node, wired to the handlers', () => {
        const h = handlers();
        const items = builtInItems({ kind: 'node', nodeId: 'a' }, h);
        expect(items.map(item => [item.id, item.label, item.danger ?? false])).toEqual([['clone', 'Clone', false], ['delete', 'Delete', true]]);
        items[0].onSelect();
        items[1].onSelect();
        expect(h.clone).toHaveBeenCalledWith('a');
        expect(h.deleteElements).toHaveBeenCalledWith(['a'], []);
    });

    it('offers Delete for edges and selections and nothing for canvas or problems', () => {
        const h = handlers();
        builtInItems({ kind: 'edge', edgeId: 'x' }, h)[0].onSelect();
        builtInItems({ kind: 'selection', nodeIds: ['a', 'b'], edgeIds: ['x'] }, h)[0].onSelect();
        expect(h.deleteElements.mock.calls).toEqual([[[], ['x']], [['a', 'b'], ['x']]]);
        expect(builtInItems({ kind: 'canvas', flowPosition: { x: 0, y: 0 } }, h)).toEqual([]);
        expect(builtInItems({ kind: 'problem', problem: { severity: 'error', code: 'X', message: 'm' } }, h)).toEqual([]);
    });
});

describe('resolveMenuItems', () => {
    const builtIn = [{ id: 'clone', label: 'Clone', onSelect: () => {} }];
    const host = (actions: ContextAction[]) => () => actions;
    const action = (id: string, extra: Partial<ContextAction> = {}): ContextAction => ({ id, label: id.toUpperCase(), onSelect: () => {}, ...extra });

    it('puts built-ins first, a divider only between non-empty groups, then host items', () => {
        expect(labels(resolveMenuItems(builtIn, host([action('ask')]), context))).toEqual(['Clone', '---', 'ASK']);
        expect(labels(resolveMenuItems([], host([action('ask')]), context))).toEqual(['ASK']);
        expect(labels(resolveMenuItems(builtIn, undefined, context))).toEqual(['Clone']);
        expect(resolveMenuItems([], host([]), context)).toEqual([]);
    });

    it('passes the context to the host and to onSelect, and keeps flags', () => {
        const onSelect = vi.fn();
        const provider = vi.fn(host([action('ask', { onSelect, danger: true, disabled: true })]));
        const [entry] = resolveMenuItems([], provider, context);
        expect(provider).toHaveBeenCalledWith(context);
        expect(entry).toMatchObject({ type: 'item', id: 'host:ask', label: 'ASK', danger: true, disabled: true, source: 'host' });
        if (entry.type === 'item') entry.run();
        expect(onSelect).toHaveBeenCalledWith(context);
    });

    it('contains host failures and drops invalid items', () => {
        const log = vi.fn();
        const throwing = () => { throw new Error('boom'); };
        expect(labels(resolveMenuItems(builtIn, throwing, context, log))).toEqual(['Clone']);
        expect(labels(resolveMenuItems(builtIn, (() => 'nope') as unknown as () => ContextAction[], context, log))).toEqual(['Clone']);
        const invalid = [{ id: 1, label: 'X', onSelect: () => {} }, { id: 'ok', label: 'OK', onSelect: () => {} }, null];
        expect(labels(resolveMenuItems([], () => invalid as unknown as ContextAction[], context, log))).toEqual(['OK']);
        expect(log).toHaveBeenCalledTimes(4);
    });

    it('drops host actions whose id duplicates an earlier one', () => {
        const log = vi.fn();
        const actions: ContextAction[] = [
            { id: 'a', label: 'First', onSelect: () => {} },
            { id: 'b', label: 'Other', onSelect: () => {} },
            { id: 'a', label: 'Second', onSelect: () => {} },
        ];
        expect(labels(resolveMenuItems([], () => actions, context, log))).toEqual(['First', 'Other']);
        expect(log).toHaveBeenCalledTimes(1);
        expect(log.mock.calls[0][1]).toBe(actions[2]);
    });

    it('treats an item without a function onSelect as invalid', () => {
        const log = vi.fn();
        const items = [{ id: 'x', label: 'X' }] as unknown as ContextAction[];
        expect(resolveMenuItems([], () => items, context, log)).toEqual([]);
        expect(log).toHaveBeenCalledTimes(1);
    });
});

describe('runMenuEntry', () => {
    it('logs instead of throwing when an action fails', () => {
        const log = vi.fn();
        const [entry] = resolveMenuItems([], () => [{ id: 'x', label: 'X', onSelect: () => { throw new Error('bad'); } }], context);
        expect(() => runMenuEntry(entry, log)).not.toThrow();
        expect(log).toHaveBeenCalledTimes(1);
    });

    it('does nothing for disabled items and dividers', () => {
        const onSelect = vi.fn();
        const entries = resolveMenuItems([{ id: 'noop', label: 'Noop', onSelect: () => {} }],
            () => [{ id: 'x', label: 'X', disabled: true, onSelect }], context);
        expect(entries.map(entry => entry.type)).toEqual(['item', 'divider', 'item']);
        runMenuEntry(entries[1]);
        runMenuEntry(entries[2]);
        expect(onSelect).not.toHaveBeenCalled();
    });
});
