import { describe, it, expect } from 'vitest';
import { selectOnlyChanges } from './selectOnly.ts';

const nodes = [{ id: 'a', selected: true }, { id: 'b', selected: false }, { id: 'c' }];
const edges = [{ id: 'ab', selected: true }, { id: 'bc' }];

describe('selectOnlyChanges', () => {
    it('selects the target node and deselects every other selected element', () => {
        expect(selectOnlyChanges(nodes, edges, { nodeId: 'b' })).toEqual({
            nodeChanges: [{ type: 'select', id: 'a', selected: false }, { type: 'select', id: 'b', selected: true }],
            edgeChanges: [{ type: 'select', id: 'ab', selected: false }],
        });
    });

    it('selects the target edge and deselects selected nodes', () => {
        expect(selectOnlyChanges(nodes, edges, { edgeId: 'bc' })).toEqual({
            nodeChanges: [{ type: 'select', id: 'a', selected: false }],
            edgeChanges: [{ type: 'select', id: 'ab', selected: false }, { type: 'select', id: 'bc', selected: true }],
        });
    });

    it('emits nothing for an element that is already the only selection', () => {
        expect(selectOnlyChanges([{ id: 'a', selected: true }], [], { nodeId: 'a' }))
            .toEqual({ nodeChanges: [], edgeChanges: [] });
    });

    it('ignores ids that do not exist', () => {
        expect(selectOnlyChanges(nodes, edges, { nodeId: 'zzz' })).toEqual({
            nodeChanges: [{ type: 'select', id: 'a', selected: false }],
            edgeChanges: [{ type: 'select', id: 'ab', selected: false }],
        });
    });
});
