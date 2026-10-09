import { describe, it, expect } from 'vitest';
import { placeNewNodes, layoutForImport, NODE_DIMENSIONS } from './layoutWorkflow.ts';
import type { Workflow, WorkflowNode } from '../types/workflow.ts';

const edge = (id: string, source: string, target: string) => ({ id, source, target, priority: 0, isDefault: false });
const node = (id: string, type: WorkflowNode['type'], position?: { x: number; y: number }): WorkflowNode =>
    ({ id, type, name: id, config: {}, ...(position ? { position } : {}) }) as WorkflowNode;
const pos = (workflow: Workflow, id: string) => workflow.nodes.find(n => n.id === id)!.position!;

describe('placeNewNodes', () => {
    it('returns the same object when every node is positioned', () => {
        const workflow: Workflow = { id: 'w', name: 'W', nodes: [node('s', 'start', { x: 0, y: 0 })], edges: [] };
        expect(placeNewNodes(workflow)).toBe(workflow);
    });

    it('lays out every node when none is positioned', () => {
        const workflow: Workflow = { id: 'w', name: 'W', nodes: [node('s', 'start'), node('e', 'end')],
            edges: [edge('se', 's', 'e')] };
        const placed = placeNewNodes(workflow);
        expect(placed.nodes.every(n => n.position && Number.isFinite(n.position.x))).toBe(true);
    });

    it('moves only positionless nodes and places them right of a positioned predecessor', () => {
        const workflow: Workflow = { id: 'w', name: 'W',
            nodes: [node('s', 'start', { x: 10, y: 40 }), node('a', 'action'), node('e', 'end', { x: 900, y: 40 })],
            edges: [edge('sa', 's', 'a'), edge('ae', 'a', 'e')] };
        const placed = placeNewNodes(workflow);
        expect(pos(placed, 's')).toEqual({ x: 10, y: 40 });
        expect(pos(placed, 'e')).toEqual({ x: 900, y: 40 });
        expect(pos(placed, 'a')).toEqual({ x: 10 + NODE_DIMENSIONS.start.width + 90, y: 40 });
    });

    it('places a node with only a positioned successor to its left', () => {
        const workflow: Workflow = { id: 'w', name: 'W',
            nodes: [node('a', 'action'), node('e', 'end', { x: 500, y: 0 })], edges: [edge('ae', 'a', 'e')] };
        expect(pos(placeNewNodes(workflow), 'a')).toEqual({ x: 500 - NODE_DIMENSIONS.action.width - 90, y: 0 });
    });

    it('places an unconnected node below the existing bounds', () => {
        const workflow: Workflow = { id: 'w', name: 'W',
            nodes: [node('s', 'start', { x: 20, y: 0 }), node('e', 'end', { x: 300, y: 80 }), node('x', 'wait')],
            edges: [] };
        expect(pos(placeNewNodes(workflow), 'x')).toEqual({ x: 20, y: 80 + NODE_DIMENSIONS.end.height + 100 });
    });

    it('does not overlap two new nodes that share a predecessor', () => {
        const workflow: Workflow = { id: 'w', name: 'W',
            nodes: [node('s', 'start', { x: 0, y: 0 }), node('a', 'action'), node('b', 'action')],
            edges: [edge('sa', 's', 'a'), edge('sb', 's', 'b')] };
        const placed = placeNewNodes(workflow);
        expect(pos(placed, 'a').x).toBe(pos(placed, 'b').x);
        expect(Math.abs(pos(placed, 'a').y - pos(placed, 'b').y)).toBeGreaterThanOrEqual(NODE_DIMENSIONS.action.height);
    });
});

describe('layoutForImport', () => {
    it('re-lays out a fully positioned but stacked graph', () => {
        const workflow: Workflow = { id: 'w', name: 'W',
            nodes: [node('s', 'start', { x: 0, y: 0 }), node('e', 'end', { x: 0, y: 0 })], edges: [edge('se', 's', 'e')] };
        const placed = layoutForImport(workflow);
        expect(pos(placed, 's')).not.toEqual(pos(placed, 'e'));
    });

    it('keeps existing positions when only some nodes lack one', () => {
        const workflow: Workflow = { id: 'w', name: 'W',
            nodes: [node('s', 'start', { x: 7, y: 9 }), node('e', 'end')], edges: [edge('se', 's', 'e')] };
        expect(pos(layoutForImport(workflow), 's')).toEqual({ x: 7, y: 9 });
    });
});
