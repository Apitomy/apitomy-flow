/**
 * Whether a given node id is currently selected.
 */
export function isNodeSelected(nodeId: string, selectedNodeId: string | null): boolean {
  return selectedNodeId === nodeId;
}
