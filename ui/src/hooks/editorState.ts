import { applyNodeChanges, applyEdgeChanges, type Connection, type Edge, type EdgeChange, type Node, type NodeChange } from '@xyflow/react';
import type { Workflow, WorkflowNode } from '../types/workflow.ts';
import { toReactFlowEdges, toReactFlowNodes, type FlowNodeData } from '../utils/conversion.ts';
import { layoutWorkflow, needsLayout } from '../layout/layoutWorkflow.ts';

interface Selection {
    selectedNodeId: string | null;
    selectedEdgeId: string | null;
}

interface Snapshot extends Selection {
    document: Workflow;
    nodeKeys: Record<string, string>;
}

export interface EditorState extends Snapshot {
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
}

export type EditorCommand =
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
    | { type: 'import'; workflow: Workflow }
    | { type: 'metadata'; metadata: Pick<Workflow, 'id' | 'name' | 'description' | 'version'> }
    | { type: 'positions'; positions: Record<string, { x: number; y: number }> }
    | { type: 'commitPositions' }
    | { type: 'tidy' }
    | { type: 'nodesChange'; changes: NodeChange<Node<FlowNodeData>>[] }
    | { type: 'edgesChange'; changes: EdgeChange[] }
    | { type: 'undo' | 'redo' };

/** Initializes an owned document and its independent ReactFlow presentation. */
export function createEditorState(workflow: Workflow): EditorState {
    const fallback = needsLayout(workflow.nodes);
    const document = structuredClone(fallback
        ? { ...workflow, nodes: layoutWorkflow(workflow.nodes, workflow.edges) } : workflow);
    return {
        document, nodes: toReactFlowNodes(document.nodes), edges: toReactFlowEdges(document.edges),
        nodeKeys: Object.fromEntries(document.nodes.map(node => [node.id, `initial:${node.id}`])),
        selectedNodeId: null, selectedEdgeId: null, past: [], future: [], revision: fallback ? 1 : 0,
        simulating: false, interactive: true, draftReset: 0,
    };
}

function snapshot(state: EditorState): Snapshot {
    return { document: state.document, nodeKeys: state.nodeKeys,
        selectedNodeId: state.selectedNodeId, selectedEdgeId: state.selectedEdgeId };
}

function validSelection(document: Workflow, selection: Selection): Selection {
    return {
        selectedNodeId: document.nodes.some(node => node.id === selection.selectedNodeId)
            ? selection.selectedNodeId : null,
        selectedEdgeId: document.edges.some(edge => edge.id === selection.selectedEdgeId)
            ? selection.selectedEdgeId : null,
    };
}

// Merge current measurements/selection into new semantic data, never into history snapshots.
function present(state: EditorState, document: Workflow, nodeKeys = state.nodeKeys): Pick<EditorState, 'nodes' | 'edges'> {
    const nodes = new Map(state.nodes.map(node => [state.nodeKeys[node.id], node]));
    const edges = new Map(state.edges.map(edge => [edge.id, edge]));
    return {
        nodes: toReactFlowNodes(document.nodes).map(node => ({ ...nodes.get(nodeKeys[node.id]), ...node, dragging: false })),
        edges: toReactFlowEdges(document.edges).map(edge => ({ ...edges.get(edge.id), ...edge })),
    };
}

function commit(state: EditorState, document: Workflow, group?: string, selection: Selection = state,
    keys = state.nodeKeys): EditorState {
    if (JSON.stringify(document) === JSON.stringify(state.document)) return state;
    const owned = structuredClone(document);
    const nodeKeys = Object.fromEntries(owned.nodes.map(node => [node.id, keys[node.id] ?? `${state.revision + 1}:${node.id}`]));
    return {
        ...state, document: owned, nodeKeys, ...present(state, owned, nodeKeys), ...validSelection(owned, selection),
        past: group && state.group === group ? state.past : [...state.past, snapshot(state)].slice(-50),
        future: [], group, revision: state.revision + 1,
    };
}

/** Applies one atomic editor command without effects, clocks, IDs, or mutable history refs. */
export function editorReducer(state: EditorState, command: EditorCommand): EditorState {
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
            if (nodeIds.length) next = editorReducer(next, { type: 'delete', nodeIds });
            // Keyboard movement has no drag-stop callback; pointer movement commits only on release.
            if (changes.some(change => change.type === 'position' && change.dragging !== true)) {
                next = editorReducer(next, { type: 'commitPositions' });
            }
        }
        return next;
    }
    if (command.type === 'edgesChange') {
        const changes = command.changes.filter(change => change.type === 'select');
        const next = changes.length ? { ...state, edges: applyEdgeChanges(changes, state.edges) } : state;
        const edgeIds = command.changes.filter(change => change.type === 'remove').map(change => change.id);
        return canvasEnabled && edgeIds.length ? editorReducer(next, { type: 'delete', edgeIds }) : next;
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
                ...state, ...target, ...present(state, target.document, target.nodeKeys), group: undefined,
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
                { selectedNodeId: command.node.id, selectedEdgeId: null });
        case 'cloneNode': {
            const node = document.nodes.find(node => node.id === command.id);
            return node ? editorReducer(state, { type: 'addNode', node: {
                ...node, id: command.newId, name: `${node.name} (copy)`,
                position: { x: node.position.x + 40, y: node.position.y + 40 },
            } }) : state;
        }
        case 'connect': {
            const { source, target } = command.connection;
            if (![source, target].every(id => document.nodes.some(node => node.id === id))
                || document.edges.some(edge => edge.id === command.id || (edge.source === source && edge.target === target))) return state;
            return commit(state, { ...document, edges: [...document.edges, {
                id: command.id, source, target, priority: 0, isDefault: false,
            }] });
        }
        case 'import': {
            const imported = command.workflow;
            const next = commit(state, needsLayout(imported.nodes)
                ? { ...imported, nodes: layoutWorkflow(imported.nodes, imported.edges) } : imported,
            undefined, { selectedNodeId: null, selectedEdgeId: null }, {});
            return { ...next, draftReset: state.draftReset + 1,
                selectedNodeId: null, selectedEdgeId: null,
                nodes: toReactFlowNodes(next.document.nodes), edges: toReactFlowEdges(next.document.edges) };
        }
        case 'metadata':
            return commit(state, { ...document, id: command.metadata.id, name: command.metadata.name,
                description: command.metadata.description, version: command.metadata.version });
        case 'tidy':
            return commit(state, { ...document, nodes: layoutWorkflow(document.nodes, document.edges) });
        case 'positions':
            return commit(state, { ...document, nodes: document.nodes.map(node => command.positions[node.id]
                ? { ...node, position: command.positions[node.id] } : node) });
        case 'commitPositions':
            return editorReducer(state, { type: 'positions', positions: Object.fromEntries(
                state.nodes.map(node => [node.id, node.position]),
            ) });
    }
}
