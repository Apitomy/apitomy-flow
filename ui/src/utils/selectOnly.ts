/** A React Flow selection change. */
export interface SelectChange {
    type: 'select';
    id: string;
    selected: boolean;
}

/**
 * Builds the React Flow selection changes that make one node or edge the only selected element: everything
 * else that is selected is deselected, and the target is selected unless it already is.
 *
 * @param nodes canvas nodes with their current selection flags
 * @param edges canvas edges with their current selection flags
 * @param target the node or edge to select; an unknown id only clears the selection
 * @returns changes for `onNodesChange` and `onEdgesChange` (empty when nothing changes)
 */
export function selectOnlyChanges(nodes: { id: string; selected?: boolean }[], edges: { id: string; selected?: boolean }[],
    target: { nodeId: string } | { edgeId: string }): { nodeChanges: SelectChange[]; edgeChanges: SelectChange[] } {
    const nodeId = 'nodeId' in target ? target.nodeId : undefined;
    const edgeId = 'edgeId' in target ? target.edgeId : undefined;
    const changes = (items: { id: string; selected?: boolean }[], wanted: string | undefined): SelectChange[] =>
        items.flatMap(item => {
            const shouldSelect = item.id === wanted;
            return !!item.selected === shouldSelect ? [] : [{ type: 'select' as const, id: item.id, selected: shouldSelect }];
        });
    return { nodeChanges: changes(nodes, nodeId), edgeChanges: changes(edges, edgeId) };
}
