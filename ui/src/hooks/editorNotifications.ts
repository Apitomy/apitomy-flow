import type { Workflow } from '../types/workflow.ts';
import type { ChangeMeta, ProposalOutcome } from '../changeset/types.ts';
import type { EditorState } from './editorState.ts';

/** Creates a per-mount publisher for committed revisions; safe to invoke again during effect replay. */
export function createDocumentPublisher(): (state: EditorState, onChange: (document: Workflow, meta: ChangeMeta) => void) => void {
    let emittedRevision = 0;
    return (state, onChange) => {
        if (emittedRevision === state.revision) return;
        emittedRevision = state.revision;
        onChange(structuredClone(state.document), { contentRevision: state.contentRevision, origin: state.origin });
    };
}

/** The nodes and edges currently selected on the canvas, sorted by id. */
export interface EditorSelection {
    nodeIds: string[];
    edgeIds: string[];
}

/**
 * Derives the selection from React Flow selection flags plus the focused node/edge.
 *
 * @param state the editor state
 * @returns sorted, de-duplicated ids
 */
export function selectionOf(state: EditorState): EditorSelection {
    const nodeIds = new Set(state.nodes.filter(node => node.selected).map(node => node.id));
    const edgeIds = new Set(state.edges.filter(edge => edge.selected).map(edge => edge.id));
    if (state.selectedNodeId) nodeIds.add(state.selectedNodeId);
    if (state.selectedEdgeId) edgeIds.add(state.selectedEdgeId);
    return { nodeIds: [...nodeIds].sort(), edgeIds: [...edgeIds].sort() };
}

/** Creates a per-mount publisher that reports each proposal resolution exactly once. */
export function createProposalPublisher():
    (state: EditorState, onResolved?: (id: string, outcome: ProposalOutcome) => void) => void {
    let emittedSeq = 0;
    return (state, onResolved) => {
        const pending = state.proposalEvents.filter(event => event.seq > emittedSeq);
        if (pending.length === 0) return;
        emittedSeq = pending[pending.length - 1].seq;
        pending.forEach(event => onResolved?.(event.id, event.outcome));
    };
}

/** Creates a per-mount publisher that reports selection only when it actually changes. */
export function createSelectionPublisher():
    (state: EditorState, onSelectionChange?: (selection: EditorSelection) => void) => void {
    let last = JSON.stringify({ nodeIds: [], edgeIds: [] });
    return (state, onSelectionChange) => {
        const selection = selectionOf(state);
        const key = JSON.stringify(selection);
        if (key === last) return;
        last = key;
        onSelectionChange?.(selection);
    };
}
