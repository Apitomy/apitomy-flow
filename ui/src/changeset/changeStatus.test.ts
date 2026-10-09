import { describe, it, expect } from 'vitest';
import { changeStatus, highlightOf } from './changeStatus.ts';
import type { Workflow } from '../types/workflow.ts';

const before: Workflow = { id: 'w', name: 'W', nodes: [
    { id: 's', type: 'start', name: 'S', config: {}, position: { x: 0, y: 0 } },
    { id: 'a', type: 'action', name: 'A', config: {}, position: { x: 200, y: 0 } },
    { id: 'x', type: 'end', name: 'X', config: {}, position: { x: 400, y: 0 } },
], edges: [{ id: 'sa', source: 's', target: 'a', priority: 0, isDefault: false }] };

const after: Workflow = { ...before, nodes: [
    { id: 's', type: 'start', name: 'S', config: {}, position: { x: 50, y: 50 } },
    { id: 'a', type: 'action', name: 'A2', config: {}, position: { x: 200, y: 0 } },
    { id: 'n', type: 'end', name: 'N', config: {} },
], edges: [{ id: 'sa', source: 's', target: 'a', priority: 0, isDefault: false },
    { id: 'an', source: 'a', target: 'n', priority: 0, isDefault: false }] };

describe('changeStatus', () => {
    it('maps diff results onto added/modified/removed/unchanged, treating moves as unchanged', () => {
        expect(changeStatus(before, after)).toEqual({
            nodes: { s: 'unchanged', a: 'modified', x: 'removed', n: 'added' },
            edges: { sa: 'unchanged', an: 'added' },
        });
    });
});

describe('highlightOf', () => {
    it('lists added and modified ids sorted, and returns null when nothing changed', () => {
        expect(highlightOf(changeStatus(before, after))).toEqual({ nodeIds: ['a', 'n'], edgeIds: ['an'] });
        expect(highlightOf(changeStatus(before, before))).toBeNull();
    });
});
