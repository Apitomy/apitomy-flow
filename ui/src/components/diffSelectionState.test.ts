import { describe, it, expect } from 'vitest';
import { clearDiffSelection } from './diffSelectionState.ts';

describe('clearDiffSelection', () => {
  it('clears selected node and edge', () => {
    expect(clearDiffSelection({ selectedNodeId: 'n1', selectedEdgeId: 'e1' })).toEqual({
      selectedNodeId: null,
      selectedEdgeId: null,
    });
  });
});
