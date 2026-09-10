export interface DiffSelectionState {
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
}

/**
 * Clear all selection state in the diff viewer.
 */
export function clearDiffSelection(_state: DiffSelectionState): DiffSelectionState {
  return {
    selectedNodeId: null,
    selectedEdgeId: null,
  };
}
