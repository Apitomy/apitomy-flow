import { describe, it, expect } from 'vitest';
import { changesStructure, layoutAppliedChange } from './appliedLayout.ts';
import type { ChangeSet } from './types.ts';
import type { Workflow } from '../types/workflow.ts';

const cs = (ops: ChangeSet['ops']): ChangeSet => ({ id: 'c', baseRevision: 'r', author: 'agent:t', summary: 's', ops });
const workflow = (): Workflow => ({ id: 'w', name: 'W', nodes: [
    { id: 's', type: 'start', name: 'S', config: {}, position: { x: 0, y: 0 } },
    { id: 'e', type: 'end', name: 'E', config: {}, position: { x: 0, y: 0 } },
    { id: 'x', type: 'wait', name: 'X', config: {}, position: { x: 900, y: 900 } },
], edges: [
    { id: 'se', source: 's', target: 'e', priority: 0, isDefault: false },
    { id: 'ex', source: 'e', target: 'x', priority: 0, isDefault: false },
] });

describe('changesStructure', () => {
    it('is true for node and edge additions and removals and for re-pointed edges', () => {
        expect(changesStructure(cs([{ op: 'addNode', node: { id: 'n', type: 'end', name: 'N', config: {} } }]))).toBe(true);
        expect(changesStructure(cs([{ op: 'removeNode', id: 'x' }]))).toBe(true);
        expect(changesStructure(cs([{ op: 'addEdge', edge: { id: 'q', source: 's', target: 'x', priority: 0, isDefault: false } }]))).toBe(true);
        expect(changesStructure(cs([{ op: 'removeEdge', id: 'se' }]))).toBe(true);
        expect(changesStructure(cs([{ op: 'updateEdge', id: 'se', patch: { target: 'x' } }]))).toBe(true);
    });

    it('is false for renames, config, label and metadata changes', () => {
        expect(changesStructure(cs([
            { op: 'updateNode', id: 's', patch: { name: 'Start' } },
            { op: 'renameNode', id: 'x', newId: 'y' },
            { op: 'updateEdge', id: 'se', patch: { label: 'go' } },
            { op: 'metadata', patch: { name: 'New' } },
        ]))).toBe(false);
    });
});

describe('layoutAppliedChange', () => {
    const structural = cs([{ op: 'removeEdge', id: 'ex' }]);

    it("returns the workflow unchanged in 'place' mode", () => {
        const after = workflow();
        expect(layoutAppliedChange(after, structural, 'place')).toBe(after);
    });

    it("lays out the whole graph in 'tidy' mode for structural change sets", () => {
        const tidied = layoutAppliedChange(workflow(), structural, 'tidy');
        const position = (id: string) => tidied.nodes.find(node => node.id === id)!.position;
        expect(position('s')).not.toEqual(position('e'));
        expect(tidied.edges).toEqual(workflow().edges);
    });

    it("leaves the layout alone in 'tidy' mode when the structure does not change", () => {
        const after = workflow();
        expect(layoutAppliedChange(after, cs([{ op: 'updateNode', id: 's', patch: { name: 'Go' } }]), 'tidy')).toBe(after);
    });
});
