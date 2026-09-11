import { describe, it, expect } from 'vitest';
import { nodeVisits, nodeVisitsByBranch } from './nodeHistory.ts';
import { type HistoryEntry } from '../types/instance.ts';

function entry(nodeId: string, enteredOn: string, extra: Partial<HistoryEntry> = {}): HistoryEntry {
  return { nodeId, nodeName: nodeId, enteredOn, ...extra };
}

describe('nodeVisits', () => {
  const history: HistoryEntry[] = [
    entry('start', '2024-01-01T00:00:00Z'),
    entry('loop', '2024-01-01T00:00:01Z', { output: { pass: 1 } }),
    entry('check', '2024-01-01T00:00:02Z'),
    entry('loop', '2024-01-01T00:00:03Z', { output: { pass: 2 } }),
    entry('check', '2024-01-01T00:00:04Z'),
    entry('loop', '2024-01-01T00:00:05Z', { output: { pass: 3 } }),
  ];

  it('returns a single-element array for a node visited once', () => {
    expect(nodeVisits(history, 'start')).toEqual([entry('start', '2024-01-01T00:00:00Z')]);
  });

  it('returns all visits in chronological (history) order for a repeated node', () => {
    const visits = nodeVisits(history, 'loop');
    expect(visits).toHaveLength(3);
    expect(visits.map(v => v.enteredOn)).toEqual([
      '2024-01-01T00:00:01Z',
      '2024-01-01T00:00:03Z',
      '2024-01-01T00:00:05Z',
    ]);
    expect(visits.map(v => v.output?.pass)).toEqual([1, 2, 3]);
  });

  it('returns an empty array for a node that was never visited', () => {
    expect(nodeVisits(history, 'never')).toEqual([]);
  });

  it('returns an empty array when nodeId is null', () => {
    expect(nodeVisits(history, null)).toEqual([]);
  });

  it('excludes entries belonging to other nodes', () => {
    const visits = nodeVisits(history, 'check');
    expect(visits).toHaveLength(2);
    expect(visits.every(v => v.nodeId === 'check')).toBe(true);
  });
});

describe('nodeVisitsByBranch', () => {
  const h = (nodeId: string, branchId?: string): HistoryEntry => ({
    nodeId, nodeName: nodeId, enteredOn: '2026-01-01T00:00:00Z', branchId,
  });

  it('returns an empty array when nodeId is null', () => {
    expect(nodeVisitsByBranch([h('a', 'root')], null)).toEqual([]);
  });

  it('returns an empty array when the node was never visited', () => {
    expect(nodeVisitsByBranch([h('a', 'root')], 'b')).toEqual([]);
  });

  it('groups a node visited across multiple branches, in first-appearance order', () => {
    const history = [h('a', 'root.1'), h('a', 'root.0'), h('a', 'root.1')];
    const result = nodeVisitsByBranch(history, 'a');
    expect(result.map(g => g.branchId)).toEqual(['root.1', 'root.0']);
    expect(result[0].visits).toHaveLength(2);
    expect(result[1].visits).toHaveLength(1);
  });

  it('treats a missing branchId as the root branch', () => {
    const result = nodeVisitsByBranch([h('a'), h('a')], 'a');
    expect(result).toEqual([{ branchId: 'root', visits: [h('a'), h('a')] }]);
  });
});
