import { describe, it, expect } from 'vitest';
import type { WorkflowNode } from '../types/workflow.ts';
import type { HistoryEntry } from '../types/instance.ts';
import { nodeInputRows } from './nodeInputs.ts';

function node(type: WorkflowNode['type'], config: Record<string, unknown>): WorkflowNode {
  return { id: 'n', type, name: 'n', config, position: { x: 0, y: 0 } } as WorkflowNode;
}

function visit(input?: Record<string, unknown>): HistoryEntry {
  return { nodeId: 'n', nodeName: 'n', enteredOn: '2026-01-01T00:00:00Z', ...(input ? { input } : {}) };
}

describe('nodeInputRows', () => {
  const start = node('start', { inputs: [
    { name: 'id', type: 'string', required: true },
    { name: 'note', type: 'string', required: false },
  ] });

  it('lists declared start inputs with recorded values', () => {
    expect(nodeInputRows(start, visit({ id: 'abc' }))).toEqual([
      { name: 'id', typeLabel: 'string', hasValue: true, value: 'abc' },
      { name: 'note', typeLabel: 'string?', hasValue: false },
    ]);
  });

  it('lists declared start inputs without values when not visited', () => {
    expect(nodeInputRows(start, null).map(r => r.hasValue)).toEqual([false, false]);
  });

  it('lists recorded inputs for other nodes, including null values', () => {
    expect(nodeInputRows(node('action', {}), visit({ a: 1, b: null }))).toEqual([
      { name: 'a', hasValue: true, value: 1 },
      { name: 'b', hasValue: true, value: null },
    ]);
  });

  it('returns no rows when nothing was recorded', () => {
    expect(nodeInputRows(node('human-task', { inputs: { a: 'context.a' } }), visit())).toEqual([]);
  });
});
