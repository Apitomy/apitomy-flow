import { type Workflow, type WorkflowEdge, type WorkflowNode, type NodeType } from '../types/workflow.ts';
import { type HistoryEntry } from '../types/instance.ts';
import { evaluateCondition, ElEvaluationError, type ElScope } from './elEvaluator.ts';

/**
 * Pure, side-effect-free simulation of a workflow's routing logic, mirroring the Java
 * {@code WorkflowEngine} (`advance` / `selectEdge`) and {@code Workflow.getOutgoingEdges} — but
 * without executing real host {@code NodeExecutor}s. Instead, the author supplies mock outputs (or
 * event payloads) where a node would block, so the graph's routing can be exercised entirely at
 * authoring time.
 *
 * The module is deliberately React-free so its behavior is unit-testable and can be pinned to the
 * engine. The UI drives it with {@link startSimulation}, {@link stepSimulation},
 * {@link runSimulation}, and {@link resumeSimulation}.
 */

/** Guard against infinite loops, matching {@code WorkflowEngine.MAX_TRANSITIONS}. */
export const MAX_TRANSITIONS = 100;

/** Node types that pause the simulation to collect a mock output / event payload. */
const BLOCKING_KINDS: ReadonlySet<NodeType> = new Set<NodeType>(['action', 'human-task', 'receive-event']);

export type SimStatus = 'running' | 'blocked' | 'completed' | 'failed';

/** The evaluation outcome for a single edge during the most recent routing decision. */
export type EdgeResult = 'matched' | 'true' | 'false' | 'skipped' | 'error';

/** How a single edge fared the last time its source node made a routing decision. */
export interface EdgeEvaluation {
    edgeId: string;
    condition?: string;
    isDefault: boolean;
    result: EdgeResult;
    /** Present when `result === 'error'` — the evaluation failure message. */
    error?: string;
}

/** A surfaced simulation error, tied to the offending node and/or edge. */
export interface SimError {
    message: string;
    nodeId?: string;
    edgeId?: string;
}

/** The complete, serializable state of a simulation run. */
export interface SimState {
    status: SimStatus;
    /** The node the simulation is currently at. */
    currentNodeId: string;
    /** The evolving instance context (start context plus merged mock outputs). */
    context: Record<string, unknown>;
    /** Nodes entered so far, in order (may contain repeats for loops). */
    visitedNodeIds: string[];
    /** History entries, shaped like a real {@code WorkflowInstance} history. */
    history: HistoryEntry[];
    /** Last routing evaluation per edge id, for the canvas overlay. */
    edgeEvaluations: Record<string, EdgeEvaluation>;
    /** Set when `status === 'blocked'` — the node awaiting a mock output/event. */
    blockedOn?: { nodeId: string; kind: NodeType };
    /** Set when `status === 'failed'`. */
    error?: SimError;
    /** Number of transitions taken, for the loop guard. */
    transitions: number;
}

/** A mock delivered to a blocked node to unblock the simulation. */
export interface SimMock {
    /** Context contributions this node produces (merged into context, like a real node output). */
    output?: Record<string, unknown>;
    /** Optional event payload (informational; routing is context-driven, matching the engine). */
    event?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Begins a simulation with the supplied start context. The instance is positioned at (and has
 * "entered") the start node, ready to route outward via {@link stepSimulation} / {@link runSimulation}.
 * If the workflow has no start node the simulation is immediately `failed`.
 */
export function startSimulation(workflow: Workflow, context: Record<string, unknown>): SimState {
    const startNode = workflow.nodes.find(n => n.type === 'start');
    if (!startNode) {
        return {
            status: 'failed',
            currentNodeId: '',
            context: { ...context },
            visitedNodeIds: [],
            history: [],
            edgeEvaluations: {},
            error: { message: 'No start node found' },
            transitions: 0,
        };
    }

    return {
        status: 'running',
        currentNodeId: startNode.id,
        context: { ...context },
        visitedNodeIds: [startNode.id],
        history: [enterEntry(startNode)],
        edgeEvaluations: {},
        transitions: 0,
    };
}

/**
 * Advances the simulation by a single node transition: selects an outgoing edge from the current
 * (routable) node, records how each edge evaluated, moves to the target node, and enters it —
 * stopping there. Landing on a blocking node yields `blocked`; landing on an end node yields
 * `completed`; no matching edge or an evaluation error yields `failed`. When the simulation is not
 * `running` (blocked/terminal), the state is returned unchanged.
 */
export function stepSimulation(workflow: Workflow, state: SimState): SimState {
    if (state.status !== 'running') {
        return state;
    }

    if (state.transitions >= MAX_TRANSITIONS) {
        return fail(state, {
            message: `Exceeded transition limit (${MAX_TRANSITIONS}) — possible infinite loop`,
            nodeId: state.currentNodeId,
        });
    }

    const currentNode = findNode(workflow, state.currentNodeId);
    if (!currentNode) {
        return fail(state, { message: `Current node not found: ${state.currentNodeId}`, nodeId: state.currentNodeId });
    }

    // Select the outgoing edge, recording how each candidate evaluated.
    let selection: EdgeSelection;
    try {
        selection = selectEdge(workflow, currentNode, { context: state.context });
    } catch (e) {
        if (e instanceof EdgeConditionError) {
            const evaluations = mergeEvaluations(state.edgeEvaluations, e.evaluations);
            return {
                ...fail(state, { message: e.message, nodeId: currentNode.id, edgeId: e.edgeId }),
                edgeEvaluations: evaluations,
            };
        }
        throw e;
    }

    const edgeEvaluations = mergeEvaluations(state.edgeEvaluations, selection.evaluations);

    if (!selection.edge) {
        return {
            ...fail(state, {
                message: `No matching outgoing edge from node: ${currentNode.name || currentNode.id}`,
                nodeId: currentNode.id,
            }),
            edgeEvaluations,
        };
    }

    const edge = selection.edge;
    const targetNode = findNode(workflow, edge.target);
    if (!targetNode) {
        return {
            ...fail(state, { message: `Edge target not found: ${edge.target}`, edgeId: edge.id }),
            edgeEvaluations,
        };
    }

    // Complete the current history entry, then enter the target (recording the edge taken).
    const history = completeLast(state.history);
    history.push(enterEntry(targetNode, edge));

    const base: SimState = {
        ...state,
        currentNodeId: targetNode.id,
        visitedNodeIds: [...state.visitedNodeIds, targetNode.id],
        history,
        edgeEvaluations,
        transitions: state.transitions + 1,
    };

    return enterNode(base, targetNode);
}

/**
 * Runs the simulation forward until it blocks, completes, or fails — i.e. "run to the next block
 * or a terminal state". A no-op when the simulation is not `running`.
 */
export function runSimulation(workflow: Workflow, state: SimState): SimState {
    let current = state;
    while (current.status === 'running') {
        const next = stepSimulation(workflow, current);
        // Defensive: stepSimulation always changes status or advances; guard against a stuck loop.
        if (next === current) break;
        current = next;
    }
    return current;
}

/**
 * Delivers a mock output/event to a blocked node, merges any output into the context (as a real
 * node would), and returns the simulation to a `running`, routable state so it can continue. A
 * no-op unless the simulation is `blocked`.
 */
export function resumeSimulation(workflow: Workflow, state: SimState, mock: SimMock): SimState {
    if (state.status !== 'blocked' || !state.blockedOn) {
        return state;
    }

    const output = mock.output ?? {};
    const context = { ...state.context, ...output };
    const history = recordOutputOnLast(state.history, output);

    const resumed: SimState = {
        ...state,
        status: 'running',
        context,
        history,
        blockedOn: undefined,
    };
    // The node is now routable; nothing else to do here — the next step routes outward. `workflow`
    // is accepted for symmetry and future use (e.g. validating the mock against declared outputs).
    void workflow;
    return resumed;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface EdgeSelection {
    edge: WorkflowEdge | null;
    evaluations: EdgeEvaluation[];
}

/** Thrown when an edge condition fails to evaluate, carrying the evaluations gathered so far. */
class EdgeConditionError extends Error {
    readonly edgeId: string;
    readonly evaluations: EdgeEvaluation[];

    constructor(message: string, edgeId: string, evaluations: EdgeEvaluation[]) {
        super(message);
        this.name = 'EdgeConditionError';
        this.edgeId = edgeId;
        this.evaluations = evaluations;
    }
}

/**
 * Mirrors {@code WorkflowEngine.selectEdge} + {@code Workflow.getOutgoingEdges}: outgoing edges are
 * sorted by priority ascending; the first non-default edge whose condition is true is chosen; the
 * default edge is the fallback. Records an {@link EdgeEvaluation} for every edge so the canvas can
 * show which matched, which were false, and which were skipped.
 */
function selectEdge(workflow: Workflow, node: WorkflowNode, scope: ElScope): EdgeSelection {
    const outgoing = workflow.edges
        .filter(e => e.source === node.id)
        .sort((a, b) => a.priority - b.priority);

    const evaluations: EdgeEvaluation[] = [];
    let defaultEdge: WorkflowEdge | null = null;
    let selected: WorkflowEdge | null = null;
    let matchedFound = false;

    for (const edge of outgoing) {
        if (edge.isDefault) {
            defaultEdge = edge;
            // Recorded after the loop as either the matched fallback or skipped.
            continue;
        }
        if (matchedFound) {
            // The engine stops at the first true edge; later edges are never evaluated.
            evaluations.push({ edgeId: edge.id, condition: edge.condition, isDefault: false, result: 'skipped' });
            continue;
        }
        try {
            const matched = evaluateCondition(edge.condition, scope);
            if (matched) {
                evaluations.push({ edgeId: edge.id, condition: edge.condition, isDefault: false, result: 'matched' });
                selected = edge;
                matchedFound = true;
            } else {
                evaluations.push({ edgeId: edge.id, condition: edge.condition, isDefault: false, result: 'false' });
            }
        } catch (e) {
            const message = e instanceof ElEvaluationError ? e.message
                : e instanceof Error ? e.message : String(e);
            evaluations.push({ edgeId: edge.id, condition: edge.condition, isDefault: false, result: 'error', error: message });
            throw new EdgeConditionError(message, edge.id, evaluations);
        }
    }

    if (defaultEdge) {
        if (selected) {
            evaluations.push({ edgeId: defaultEdge.id, condition: defaultEdge.condition, isDefault: true, result: 'skipped' });
        } else {
            evaluations.push({ edgeId: defaultEdge.id, condition: defaultEdge.condition, isDefault: true, result: 'matched' });
            selected = defaultEdge;
        }
    }

    return { edge: selected, evaluations };
}

/** Applies the type-specific behavior when a node is entered (already recorded in history). */
function enterNode(state: SimState, node: WorkflowNode): SimState {
    if (node.type === 'end') {
        return {
            ...state,
            status: 'completed',
            history: completeLast(state.history),
        };
    }
    if (node.type === 'start') {
        // Start nodes have no incoming edges; reaching one mid-run is a malformed graph.
        return fail(state, { message: 'Cannot transition to a start node', nodeId: node.id });
    }
    if (BLOCKING_KINDS.has(node.type)) {
        return {
            ...state,
            status: 'blocked',
            blockedOn: { nodeId: node.id, kind: node.type },
        };
    }
    // 'wait' — parks at runtime but needs no author input; it is immediately routable here.
    return state;
}

function findNode(workflow: Workflow, nodeId: string): WorkflowNode | undefined {
    return workflow.nodes.find(n => n.id === nodeId);
}

function fail(state: SimState, error: SimError): SimState {
    return { ...state, status: 'failed', error, blockedOn: undefined };
}

function mergeEvaluations(
    existing: Record<string, EdgeEvaluation>,
    updates: EdgeEvaluation[],
): Record<string, EdgeEvaluation> {
    const merged = { ...existing };
    for (const evaluation of updates) {
        merged[evaluation.edgeId] = evaluation;
    }
    return merged;
}

function enterEntry(node: WorkflowNode, edge?: WorkflowEdge): HistoryEntry {
    return {
        nodeId: node.id,
        nodeName: node.name,
        edgeId: edge?.id,
        edgeCondition: edge?.condition,
        enteredOn: new Date().toISOString(),
    };
}

/** Returns a copy of history with the final entry marked completed (if not already). */
function completeLast(history: HistoryEntry[]): HistoryEntry[] {
    if (history.length === 0) return [];
    const copy = history.slice();
    const last = copy[copy.length - 1];
    if (!last.completedOn) {
        copy[copy.length - 1] = { ...last, completedOn: new Date().toISOString() };
    }
    return copy;
}

/** Records the produced output on the final (blocked) history entry. */
function recordOutputOnLast(history: HistoryEntry[], output: Record<string, unknown>): HistoryEntry[] {
    if (history.length === 0) return [];
    const copy = history.slice();
    const last = copy[copy.length - 1];
    copy[copy.length - 1] = { ...last, output: { ...(last.output ?? {}), ...output } };
    return copy;
}
