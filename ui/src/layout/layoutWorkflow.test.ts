import { describe, it, expect } from 'vitest';
import { layoutWorkflow, needsLayout } from './layoutWorkflow.ts';
import { type WorkflowNode, type WorkflowEdge } from '../types/workflow.ts';

function node(id: string, type: WorkflowNode['type'], x = 0, y = 0): WorkflowNode {
  return { id, type, name: id, config: {}, position: { x, y } };
}

function edge(source: string, target: string): WorkflowEdge {
  return { id: `e-${source}-${target}`, source, target, priority: 0, isDefault: false };
}

describe('layoutWorkflow', () => {
  it('orders a linear graph left-to-right', () => {
    const nodes = [node('s', 'start'), node('a', 'action'), node('e', 'end')];
    const edges = [edge('s', 'a'), edge('a', 'e')];
    const laid = layoutWorkflow(nodes, edges);
    const byId = Object.fromEntries(laid.map(n => [n.id, n.position]));
    expect(byId.s.x).toBeLessThan(byId.a.x);
    expect(byId.a.x).toBeLessThan(byId.e.x);
  });

  it('produces distinct positions for sibling branches (no overlap)', () => {
    const nodes = [node('s', 'start'), node('a', 'action'), node('b', 'action'), node('e', 'end')];
    const edges = [edge('s', 'a'), edge('s', 'b'), edge('a', 'e'), edge('b', 'e')];
    const laid = layoutWorkflow(nodes, edges);
    const positions = laid.map(n => `${n.position.x},${n.position.y}`);
    expect(new Set(positions).size).toBe(positions.length);
  });

  it('terminates and returns finite positions when the graph has a cycle', () => {
    const nodes = [node('s', 'start'), node('a', 'action'), node('b', 'action')];
    const edges = [edge('s', 'a'), edge('a', 'b'), edge('b', 'a')];
    const laid = layoutWorkflow(nodes, edges);
    for (const n of laid) {
      expect(Number.isFinite(n.position.x)).toBe(true);
      expect(Number.isFinite(n.position.y)).toBe(true);
    }
  });

  it('handles empty and single-node graphs', () => {
    expect(layoutWorkflow([], [])).toEqual([]);
    const one = layoutWorkflow([node('s', 'start')], []);
    expect(one).toHaveLength(1);
    expect(Number.isFinite(one[0].position.x)).toBe(true);
  });

  it('does not mutate the input nodes', () => {
    const nodes = [node('s', 'start', 5, 5)];
    layoutWorkflow(nodes, []);
    expect(nodes[0].position).toEqual({ x: 5, y: 5 });
  });

  it('honors direction: TB by ranking a linear graph top-to-bottom', () => {
    const nodes = [node('s', 'start'), node('a', 'action'), node('e', 'end')];
    const edges = [edge('s', 'a'), edge('a', 'e')];
    const laid = layoutWorkflow(nodes, edges, { direction: 'TB' });
    const byId = Object.fromEntries(laid.map(n => [n.id, n.position]));
    expect(byId.s.y).toBeLessThan(byId.a.y);
    expect(byId.a.y).toBeLessThan(byId.e.y);
  });

  it('applies the nodeSize override to spacing', () => {
    const nodes = [node('s', 'start'), node('a', 'action')];
    const edges = [edge('s', 'a')];
    const wide = layoutWorkflow(nodes, edges, { nodeSize: () => ({ width: 400, height: 50 }) });
    const narrow = layoutWorkflow(nodes, edges, { nodeSize: () => ({ width: 40, height: 50 }) });
    const gap = (laid: WorkflowNode[]) => {
      const byId = Object.fromEntries(laid.map(n => [n.id, n.position]));
      return byId.a.x - byId.s.x;
    };
    // Wider nodes push the next rank further right than narrow ones.
    expect(gap(wide)).toBeGreaterThan(gap(narrow));
  });

  it('respects rankSpacing between ranks', () => {
    const nodes = [node('s', 'start'), node('a', 'action')];
    const edges = [edge('s', 'a')];
    const tight = layoutWorkflow(nodes, edges, { rankSpacing: 20 });
    const loose = layoutWorkflow(nodes, edges, { rankSpacing: 300 });
    const gap = (laid: WorkflowNode[]) => {
      const byId = Object.fromEntries(laid.map(n => [n.id, n.position]));
      return byId.a.x - byId.s.x;
    };
    expect(gap(loose)).toBeGreaterThan(gap(tight));
  });
});

describe('needsLayout', () => {
  it('is true when a node is missing a position', () => {
    const n = { id: 's', type: 'start', name: 's', config: {} } as unknown as WorkflowNode;
    expect(needsLayout([n])).toBe(true);
  });

  it('is true when all nodes share the same coordinate (e.g. origin)', () => {
    expect(needsLayout([node('s', 'start', 0, 0), node('a', 'action', 0, 0)])).toBe(true);
  });

  it('is false for a spread-out, intentionally placed graph', () => {
    expect(needsLayout([node('s', 'start', 0, 0), node('a', 'action', 200, 0)])).toBe(false);
  });

  it('is false for a single node with a valid position (respect intentional placement)', () => {
    expect(needsLayout([node('s', 'start', 42, 17)])).toBe(false);
  });

  it('is true for a single node missing its position', () => {
    const n = { id: 's', type: 'start', name: 's', config: {} } as unknown as WorkflowNode;
    expect(needsLayout([n])).toBe(true);
  });

  it('is false for an empty graph', () => {
    expect(needsLayout([])).toBe(false);
  });
});
