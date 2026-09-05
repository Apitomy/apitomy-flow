import { describe, it, expect } from 'vitest';
import { type ActiveBranch, type HistoryEntry } from '../types/instance.ts';
import { type NodeType } from '../types/workflow.ts';
import {
  activeNodeIds,
  activeEdgeIds,
  parkedNodes,
  branchPaths,
  simNodeClass,
} from './parallelView.ts';

function branch(branchId: string, nodeId: string): ActiveBranch {
  return { branchId, nodeId };
}
function entry(nodeId: string, extra: Partial<HistoryEntry> = {}): HistoryEntry {
  return { nodeId, nodeName: nodeId, enteredOn: '2026-01-01T00:00:00Z', ...extra };
}

describe('activeNodeIds', () => {
  it('returns every branch node when no parked ids are given', () => {
    const set = activeNodeIds([branch('root.0', 'a'), branch('root.1', 'b')]);
    expect(set).toEqual(new Set(['a', 'b']));
  });

  it('excludes branches whose id is parked', () => {
    const set = activeNodeIds(
      [branch('root.0', 'a'), branch('root.1', 'b')],
      ['root.1'],
    );
    expect(set).toEqual(new Set(['a']));
  });

  it('returns an empty set for no branches', () => {
    expect(activeNodeIds([])).toEqual(new Set());
  });
});

describe('activeEdgeIds', () => {
  it('collects the arrival edge of each active branch (latest matching visit)', () => {
    const history: HistoryEntry[] = [
      entry('a', { branchId: 'root.0', edgeId: 'e-fa' }),
      entry('b', { branchId: 'root.1', edgeId: 'e-fb' }),
    ];
    const set = activeEdgeIds([branch('root.0', 'a'), branch('root.1', 'b')], history);
    expect(set).toEqual(new Set(['e-fa', 'e-fb']));
  });

  it('uses the most recent matching visit when a branch loops back to a node', () => {
    const history: HistoryEntry[] = [
      entry('a', { branchId: 'root', edgeId: 'e1' }),
      entry('a', { branchId: 'root', edgeId: 'e2' }),
    ];
    expect(activeEdgeIds([branch('root', 'a')], history)).toEqual(new Set(['e2']));
  });

  it('treats a missing history branchId as the root branch', () => {
    const history: HistoryEntry[] = [entry('a', { edgeId: 'e1' })];
    expect(activeEdgeIds([branch('root', 'a')], history)).toEqual(new Set(['e1']));
  });

  it('omits branches with no arrival edge (e.g. the start node)', () => {
    const history: HistoryEntry[] = [entry('start', { branchId: 'root' })];
    expect(activeEdgeIds([branch('root', 'start')], history)).toEqual(new Set());
  });

  it('resolves each active branch arrival edge independently (cross-branch isolation)', () => {
    const history: HistoryEntry[] = [
      entry('a', { branchId: 'root.0', edgeId: 'e-to-a' }),
      entry('b', { branchId: 'root.1', edgeId: 'e-to-b' }),
    ];
    const set = activeEdgeIds([branch('root.0', 'a'), branch('root.1', 'b')], history);
    expect(set).toEqual(new Set(['e-to-a', 'e-to-b']));
  });
});

describe('parkedNodes', () => {
  const kinds: Record<string, NodeType> = { a: 'action', w: 'wait' };
  const lookup = (id: string): NodeType | undefined => kinds[id];

  it('returns one entry per parked branch with its node kind and branch id', () => {
    const result = parkedNodes(
      [branch('root.0', 'a'), branch('root.1', 'w')],
      ['root.0', 'root.1'],
      lookup,
    );
    expect(result).toEqual([
      { nodeId: 'a', kind: 'action', branchId: 'root.0' },
      { nodeId: 'w', kind: 'wait', branchId: 'root.1' },
    ]);
  });

  it('ignores non-parked branches', () => {
    const result = parkedNodes([branch('root.0', 'a'), branch('root.1', 'w')], ['root.1'], lookup);
    expect(result).toEqual([{ nodeId: 'w', kind: 'wait', branchId: 'root.1' }]);
  });

  it('drops parked branches whose node type cannot be resolved', () => {
    const result = parkedNodes([branch('root.0', 'gone')], ['root.0'], lookup);
    expect(result).toEqual([]);
  });
});

describe('branchPaths', () => {
  it('groups history nodes per branch, preserving first-appearance branch order', () => {
    const history: HistoryEntry[] = [
      entry('start', { branchId: 'root' }),
      entry('a', { branchId: 'root.0' }),
      entry('b', { branchId: 'root.1' }),
      entry('a2', { branchId: 'root.0' }),
    ];
    expect(branchPaths(history)).toEqual([
      { branchId: 'root', nodeIds: ['start'] },
      { branchId: 'root.0', nodeIds: ['a', 'a2'] },
      { branchId: 'root.1', nodeIds: ['b'] },
    ]);
  });

  it('treats a missing branchId as the root branch', () => {
    const history: HistoryEntry[] = [entry('start'), entry('next')];
    expect(branchPaths(history)).toEqual([{ branchId: 'root', nodeIds: ['start', 'next'] }]);
  });

  it('returns an empty array for empty history', () => {
    expect(branchPaths([])).toEqual([]);
  });
});

describe('simNodeClass', () => {
  const base = { activeIds: new Set<string>(), parkedIds: new Set<string>(), visited: new Set<string>() };

  it('marks the failed node when a failure is present', () => {
    expect(simNodeClass('x', { ...base, activeIds: new Set(['x']), failedNodeId: 'x' }))
      .toBe('flow-sim-node-failed');
  });

  it('marks a parked node as blocked', () => {
    expect(simNodeClass('x', { ...base, parkedIds: new Set(['x']) })).toBe('flow-sim-node-blocked');
  });

  it('marks an active (non-parked) node as current', () => {
    expect(simNodeClass('x', { ...base, activeIds: new Set(['x']) })).toBe('flow-sim-node-current');
  });

  it('prefers blocked over current when a node is both', () => {
    expect(simNodeClass('x', { ...base, activeIds: new Set(['x']), parkedIds: new Set(['x']) }))
      .toBe('flow-sim-node-blocked');
  });

  it('marks a visited-but-inactive node as visited', () => {
    expect(simNodeClass('x', { ...base, visited: new Set(['x']) })).toBe('flow-sim-node-visited');
  });

  it('marks an untouched node as idle', () => {
    expect(simNodeClass('x', base)).toBe('flow-sim-node-idle');
  });

  it('failed outranks blocked when a node is both', () => {
    expect(simNodeClass('x', { ...base, parkedIds: new Set(['x']), failedNodeId: 'x' }))
      .toBe('flow-sim-node-failed');
  });

  it('failed outranks current when a node is both', () => {
    expect(simNodeClass('x', { ...base, activeIds: new Set(['x']), failedNodeId: 'x' }))
      .toBe('flow-sim-node-failed');
  });
});
