import { describe, it, expect } from 'vitest';
import type { WorkflowNode } from '../types/workflow.ts';
import type { HistoryEntry } from '../types/instance.ts';
import { humanTaskSummary } from './humanTaskSummary.ts';

function node(type: WorkflowNode['type'], config: Record<string, unknown> = {}): WorkflowNode {
  return { id: 'n', type, name: 'Review Task', config, position: { x: 0, y: 0 } } as WorkflowNode;
}

function visit(extra: Partial<HistoryEntry> = {}): HistoryEntry {
  return { nodeId: 'n', nodeName: 'Review Task', enteredOn: '2026-01-01T00:00:00Z', ...extra };
}

describe('humanTaskSummary', () => {
  it('shows the recorded title and the description', () => {
    expect(humanTaskSummary(node('human-task', { description: 'Check it' }), visit({ title: 'Review A-1' })))
      .toEqual({ title: 'Review A-1', description: 'Check it' });
  });

  it('falls back to the node name for history recorded without a title', () => {
    expect(humanTaskSummary(node('human-task'), visit())).toEqual({ title: 'Review Task' });
  });

  it('omits the title when the node was not visited, and a blank description', () => {
    expect(humanTaskSummary(node('human-task', { description: '  ' }), null)).toEqual({});
  });

  it('returns null for other node types', () => {
    expect(humanTaskSummary(node('action'), visit())).toBeNull();
  });
});
