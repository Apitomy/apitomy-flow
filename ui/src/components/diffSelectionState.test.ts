import { describe, it, expect } from 'vitest';
import { clearDiffSelection } from './diffSelectionState.ts';

describe('clearDiffSelection', () => {
  it('clears selected node and edge', () => {
    expect(clearDiffSelection()).toEqual({
      selectedNodeId: null,
      selectedEdgeId: null,
    });
  });
});
