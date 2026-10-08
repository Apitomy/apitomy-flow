import { applyNodeChanges, applyEdgeChanges, type Connection, type Edge, type EdgeChange, type Node, type NodeChange } from '@xyflow/react';
import type { Workflow, WorkflowNode } from '../types/workflow.ts';
import { TIMEOUT_HANDLE, toReactFlowEdges, toReactFlowNodes, type FlowNodeData } from '../utils/conversion.ts';
import { layoutForImport, layoutWorkflow } from '../layout/layoutWorkflow.ts';
import { jsonEqual } from '../utils/jsonEqual.ts';
import { computeContentRevision } from '../changeset/contentRevision.ts';
import { applyChangeSetChecked } from '../changeset/applyChangeSet.ts';
import { changeStatus, highlightOf } from '../changeset/changeStatus.ts';
import type { ChangeSet, Highlight, Origin, ProposalEvent, ProposalOutcome, StagedProposal } from '../changeset/types.ts';

interface Selection {
    selectedNodeId: string | null;
    selectedEdgeId: string | null;
}

interface Snapshot extends Selection {
    document: Workflow;
    /** Stable owned validation input; layout edits retain it and history restores it atomically. */
    semanticDocument: Workflow;
    nodeKeys: Record<string, string>;
    selectedNodeIds: string[];
    selectedEdgeIds: string[];
    /** Content revision of `semanticDocument`; layout-only edits keep it. */
    contentRevision: string;
    /** Origin of the change that produced this state. */
    origin: Origin;
}

export interface EditorState extends Omit<Snapshot, 'selectedNodeIds' | 'selectedEdgeIds'> {
    nodes: Node<FlowNodeData>[];
    edges: Edge[];
    past: Snapshot[];
    future: Snapshot[];
    revision: number;
    /** Monotonic UI draft reset token; deliberately excluded from undo snapshots. */
    draftReset: number;
    group?: string;
    simulating: boolean;
    interactive: boolean;
    /** The single proposal under review, if any. Not part of undo history. */
    proposal: StagedProposal | null;
    /** Elements changed by the most recently applied change set. Not part of undo history. */
    highlight: Highlight | null;
    /** Recent proposal resolutions, drained by `createProposalPublisher`. */
    proposalEvents: ProposalEvent[];
    /** Sequence number of the last emitted proposal event. */
    proposalSeq: number;
}

export type EditorCommand =
    | { type: 'propose'; changeSet: ChangeSet; preview: Workflow }
    | { type: 'withdraw'; id: string }
    | { type: 'applyChangeSet'; changeSet: ChangeSet }
    | { type: 'acceptProposal' }
    | { type: 'rejectProposal' }
    | { type: 'clearHighlights' }
    | { type: 'select'; nodeId?: string; edgeId?: string }
    | { type: 'mode'; simulating?: boolean; interactive?: boolean }
    | { type: 'endGroup' }
    | { type: 'nodeData'; id: string; data: Partial<FlowNodeData>; group?: string }
    | { type: 'edgeData'; id: string; data: Record<string, unknown>; group?: string }
    | { type: 'renameNode'; id: string; newId: string; group?: string }
    | { type: 'delete'; nodeIds?: string[]; edgeIds?: string[] }
    | { type: 'addNode'; node: WorkflowNode }
    | { type: 'cloneNode'; id: string; newId: string }
    | { type: 'connect'; id: string; connection: Connection }
    | { type: 'import'; workflow: Workflow; origin?: Origin }
    | { type: 'metadata'; metadata: Pick<Workflow, 'id' | 'name' | 'description' | 'version'> }
    | { type: 'positions'; positions: Record<string, { x: number; y: number }> }
    | { type: 'commitPositions' }
    | { type: 'tidy' }
    | { type: 'nodesChange'; changes: NodeChange<Node<FlowNodeData>>[] }
    | { type: 'edgesChange'; changes: EdgeChange[] }
    | { type: 'undo' | 'redo' };

/** Initializes an owned document and its independent ReactFlow presentation. */
export function createEditorState(workflow: Workflow): EditorState {
    const placed = layoutForImport(workflow);
    const fallback = placed !== workflow;
    const document = structuredClone(placed);
    return {
        document, semanticDocument: document, nodes: toReactFlowNodes(document.nodes), edges: toReactFlowEdges(document.edges),
        nodeKeys: Object.fromEntries(document.nodes.map(node => [node.id, `initial:${node.id}`])),
        selectedNodeId: null, selectedEdgeId: null, past: [], future: [], revision: fallback ? 1 : 0,
        simulating: false, interactive: true, draftReset: 0,
        contentRevision: computeContentRevision(document), origin: 'user',
        proposal: null, highlight: null, proposalEvents: [], proposalSeq: 0,
    };
}

function snapshot(state: EditorState): Snapshot {
    return { document: state.document, semanticDocument: state.semanticDocument, nodeKeys: state.nodeKeys,
        selectedNodeIds: state.nodes.filter(node => node.selected).map(node => node.id),
        selectedEdgeIds: state.edges.filter(edge => edge.selected).map(edge => edge.id),
        selectedNodeId: state.selectedNodeId, selectedEdgeId: state.selectedEdgeId,
        contentRevision: state.contentRevision, origin: state.origin };
}

function validSelection(document: Workflow, selection: Selection): Selection {
    return {
        selectedNodeId: document.nodes.some(node => node.id === selection.selectedNodeId)
            ? selection.selectedNodeId : null,
        selectedEdgeId: document.edges.some(edge => edge.id === selection.selectedEdgeId)
            ? selection.selectedEdgeId : null,
    };
}

// Retain live measurements independently from the selection restored by history.
function present(state: EditorState, document: Workflow, nodeKeys = state.nodeKeys,
    selection?: Pick<Snapshot, 'selectedNodeIds' | 'selectedEdgeIds'>): Pick<EditorState, 'nodes' | 'edges'> {
    const nodes = new Map(state.nodes.map(node => [state.nodeKeys[node.id], node]));
    const edges = new Map(state.edges.map(edge => [edge.id, edge]));
    return {
        nodes: toReactFlowNodes(document.nodes).map(node => ({ ...nodes.get(nodeKeys[node.id]), ...node, dragging: false,
            ...(selection ? { selected: selection.selectedNodeIds.includes(node.id) } : {}) })),
        edges: toReactFlowEdges(document.edges).map(edge => ({ ...edges.get(edge.id), ...edge,
            ...(selection ? { selected: selection.selectedEdgeIds.includes(edge.id) } : {}) })),
    };
}

function commit(state: EditorState, document: Workflow, group?: string, selection: Selection = state,
    keys = state.nodeKeys, layoutOnly = false,
    canvasSelection?: Pick<Snapshot, 'selectedNodeIds' | 'selectedEdgeIds'>): EditorState {
    if (JSON.stringify(document) === JSON.stringify(state.document)) return state;
    const owned = structuredClone(document);
    const semanticDocument = layoutOnly || sameSemantics(state.semanticDocument, owned)
        ? state.semanticDocument : owned;
    const nodeKeys = Object.fromEntries(owned.nodes.map(node => [node.id, keys[node.id] ?? `${state.revision + 1}:${node.id}`]));
    return {
        ...state, document: owned, semanticDocument,
        contentRevision: semanticDocument === state.semanticDocument
            ? state.contentRevision : computeContentRevision(semanticDocument),
        nodeKeys, ...present(state, owned, nodeKeys, canvasSelection), ...validSelection(owned, selection),
        past: group && state.group === group ? state.past : [...state.past, snapshot(state)].slice(-50),
        future: [], group, revision: state.revision + 1,
    };
}

// Ignore only coordinates. Names, metadata and host extension fields may affect host validation.
function sameSemantics(left: Workflow, right: Workflow): boolean {
    const withoutLayout = (workflow: Workflow) => ({ ...workflow,
        nodes: workflow.nodes.map(node => ({ ...node, position: undefined })),
    });
    return jsonEqual(withoutLayout(left), withoutLayout(right));
}

type ProposalCommandType = 'propose' | 'withdraw' | 'applyChangeSet' | 'acceptProposal' | 'rejectProposal' | 'clearHighlights';
function reduceCommand(state: EditorState, command: Exclude<EditorCommand, { type: ProposalCommandType }>): EditorState {
    if (command.type === 'mode') {
        return {
            ...state, simulating: command.simulating ?? state.simulating,
            interactive: command.interactive ?? state.interactive, group: undefined,
            ...present(state, state.document),
        };
    }
    if (command.type === 'endGroup') return state.group ? { ...state, group: undefined } : state;
    if (command.type === 'select') {
        const selection = validSelection(state.document, {
            selectedNodeId: command.nodeId ?? null, selectedEdgeId: command.edgeId ?? null,
        });
        return { ...state, ...selection, group: undefined,
            draftReset: state.draftReset + (selection.selectedNodeId !== state.selectedNodeId
                || selection.selectedEdgeId !== state.selectedEdgeId ? 1 : 0) };
    }
    const canvasEnabled = state.interactive && !state.simulating;
    if (command.type === 'nodesChange') {
        const changes = command.changes.filter(change => change.type === 'dimensions'
            || change.type === 'select' || (canvasEnabled && change.type === 'position'));
        let next = changes.length ? { ...state, nodes: applyNodeChanges(changes, state.nodes) } : state;
        if (canvasEnabled) {
            const nodeIds = command.changes.filter(change => change.type === 'remove').map(change => change.id);
            if (nodeIds.length) next = reduceCommand(next, { type: 'delete', nodeIds });
            // Keyboard movement has no drag-stop callback; pointer movement commits only on release.
            if (changes.some(change => change.type === 'position' && change.dragging !== true)) {
                next = reduceCommand(next, { type: 'commitPositions' });
            }
        }
        return next;
    }
    if (command.type === 'edgesChange') {
        const changes = command.changes.filter(change => change.type === 'select');
        const next = changes.length ? { ...state, edges: applyEdgeChanges(changes, state.edges) } : state;
        const edgeIds = command.changes.filter(change => change.type === 'remove').map(change => change.id);
        return canvasEnabled && edgeIds.length ? reduceCommand(next, { type: 'delete', edgeIds }) : next;
    }
    if (state.simulating) return state;
    if (!state.interactive && ['addNode', 'cloneNode', 'connect', 'delete', 'positions', 'commitPositions', 'tidy']
        .includes(command.type)) return state;

    const document = state.document;
    switch (command.type) {
        case 'undo':
        case 'redo': {
            const source = command.type === 'undo' ? state.past : state.future;
            const target = source.at(-1);
            if (!target) return state;
            return {
                ...state, ...target, ...present(state, target.document, target.nodeKeys, target), group: undefined,
                past: command.type === 'undo' ? state.past.slice(0, -1) : [...state.past, snapshot(state)],
                future: command.type === 'redo' ? state.future.slice(0, -1) : [...state.future, snapshot(state)],
                revision: state.revision + 1,
                draftReset: state.draftReset + 1,
            };
        }
        case 'nodeData':
            return commit(state, { ...document, nodes: document.nodes.map(node => node.id === command.id
                ? { ...node, ...(command.data.name !== undefined ? { name: command.data.name } : {}),
                    ...(command.data.config !== undefined ? { config: command.data.config } : {}) } : node) }, command.group);
        case 'edgeData':
            return commit(state, { ...document, edges: document.edges.map(edge => edge.id === command.id
                ? { ...edge, ...command.data, id: edge.id, source: edge.source, target: edge.target } : edge) }, command.group);
        case 'renameNode': {
            if (!command.newId.trim() || !document.nodes.some(node => node.id === command.id)
                || document.nodes.some(node => node.id === command.newId)) return state;
            return commit(state, {
                ...document,
                nodes: document.nodes.map(node => node.id === command.id ? { ...node, id: command.newId } : node),
                edges: document.edges.map(edge => ({ ...edge,
                    source: edge.source === command.id ? command.newId : edge.source,
                    target: edge.target === command.id ? command.newId : edge.target,
                })),
            }, command.group, { ...state,
                selectedNodeId: state.selectedNodeId === command.id ? command.newId : state.selectedNodeId },
            { ...state.nodeKeys, [command.newId]: state.nodeKeys[command.id] });
        }
        case 'delete': {
            const nodeIds = new Set(command.nodeIds);
            const edgeIds = new Set(command.edgeIds);
            return commit(state, { ...document,
                nodes: document.nodes.filter(node => !nodeIds.has(node.id)),
                edges: document.edges.filter(edge => !edgeIds.has(edge.id)
                    && !nodeIds.has(edge.source) && !nodeIds.has(edge.target)),
            });
        }
        case 'addNode':
            if (document.nodes.some(node => node.id === command.node.id)) return state;
            return commit(state, { ...document, nodes: [...document.nodes, command.node] }, undefined,
                { selectedNodeId: command.node.id, selectedEdgeId: null }, state.nodeKeys, false,
                { selectedNodeIds: [command.node.id], selectedEdgeIds: [] });
        case 'cloneNode': {
            const node = document.nodes.find(node => node.id === command.id);
            return node ? reduceCommand(state, { type: 'addNode', node: {
                ...node, id: command.newId, name: `${node.name} (copy)`,
                position: { x: (node.position?.x ?? 0) + 40, y: (node.position?.y ?? 0) + 40 },
            } }) : state;
        }
        case 'connect': {
            const { source, target, sourceHandle } = command.connection;
            if (![source, target].every(id => document.nodes.some(node => node.id === id))
                || document.edges.some(edge => edge.id === command.id || (edge.source === source && edge.target === target))) return state;
            return commit(state, { ...document, edges: [...document.edges, {
                id: command.id, source, target, priority: 0, isDefault: false,
                ...(sourceHandle === TIMEOUT_HANDLE ? { isTimeout: true } : {}),
            }] });
        }
        case 'import': {
            const imported = command.workflow;
            const next = commit(state, layoutForImport(imported),
            undefined, { selectedNodeId: null, selectedEdgeId: null }, {});
            return { ...next, draftReset: state.draftReset + 1,
                selectedNodeId: null, selectedEdgeId: null,
                nodes: toReactFlowNodes(next.document.nodes), edges: toReactFlowEdges(next.document.edges) };
        }
        case 'metadata':
            return commit(state, { ...document, id: command.metadata.id, name: command.metadata.name,
                description: command.metadata.description, version: command.metadata.version });
        case 'tidy':
            return commit(state, { ...document, nodes: layoutWorkflow(document.nodes, document.edges) },
                undefined, state, state.nodeKeys, true);
        case 'positions':
            return commit(state, { ...document, nodes: document.nodes.map(node => command.positions[node.id]
                ? { ...node, position: command.positions[node.id] } : node) }, undefined, state, state.nodeKeys, true);
        case 'commitPositions':
            return reduceCommand(state, { type: 'positions', positions: Object.fromEntries(
                state.nodes.map(node => [node.id, node.position]),
            ) });
    }
}

function commandOrigin(command: EditorCommand): Origin {
    if (command.type === 'import' && command.origin) return command.origin;
    return command.type === 'metadata' ? 'host' : 'user';
}

function emit(state: EditorState, id: string, outcome: ProposalOutcome): EditorState {
    const seq = state.proposalSeq + 1;
    return { ...state, proposalSeq: seq, proposalEvents: [...state.proposalEvents, { seq, id, outcome }].slice(-20) };
}

function markStale(state: EditorState): EditorState {
    const proposal = state.proposal;
    if (!proposal || proposal.stale) return state;
    return { ...emit(state, proposal.changeSet.id, 'stale'), proposal: { ...proposal, stale: true } };
}

function applyChangeSetCommand(state: EditorState, changeSet: ChangeSet): EditorState {
    const result = applyChangeSetChecked(state.document, changeSet, state.contentRevision);
    if (!result.ok) return state;
    const committed = commit(state, result.workflow);
    let next: EditorState = { ...committed, origin: changeSet.author, group: undefined,
        highlight: highlightOf(changeStatus(state.document, committed.document)) };
    if (state.proposal?.changeSet.id === changeSet.id) {
        next = { ...emit(next, changeSet.id, 'accepted'), proposal: null };
    } else if (next.contentRevision !== state.contentRevision) {
        next = markStale(next);
    }
    return next;
}

/** Applies one atomic editor command without effects, clocks, IDs, or mutable history refs. */
export function editorReducer(state: EditorState, command: EditorCommand): EditorState {
    switch (command.type) {
        case 'propose': {
            if (command.changeSet.baseRevision !== state.contentRevision) return state;
            const next = state.proposal && !state.proposal.stale
                ? emit(state, state.proposal.changeSet.id, 'withdrawn') : state;
            return { ...next, proposal: { changeSet: command.changeSet, preview: command.preview, stale: false } };
        }
        case 'withdraw': {
            const proposal = state.proposal;
            if (!proposal || proposal.changeSet.id !== command.id) return state;
            return { ...(proposal.stale ? state : emit(state, command.id, 'withdrawn')), proposal: null };
        }
        case 'rejectProposal': {
            const proposal = state.proposal;
            if (!proposal) return state;
            return { ...(proposal.stale ? state : emit(state, proposal.changeSet.id, 'rejected')), proposal: null };
        }
        case 'acceptProposal':
            return state.proposal && !state.proposal.stale ? applyChangeSetCommand(state, state.proposal.changeSet) : state;
        case 'applyChangeSet':
            return applyChangeSetCommand(state, command.changeSet);
        case 'clearHighlights':
            return state.highlight ? { ...state, highlight: null } : state;
    }
    const next = reduceCommand(state, command);
    if (next === state || next.revision === state.revision) return next;
    const origin = commandOrigin(command);
    let result: EditorState = { ...next, origin };
    if (result.contentRevision !== state.contentRevision) {
        if (origin === 'user' && result.highlight) result = { ...result, highlight: null };
        result = markStale(result);
    }
    return result;
}
