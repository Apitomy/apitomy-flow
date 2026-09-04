import { type Workflow, type WorkflowEdge, type WorkflowNode, type NodeType } from '../types/workflow.ts';
import { type HistoryEntry, type ActiveBranch } from '../types/instance.ts';
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
    /** Live branch positions (tokens). Replaces the single cursor; mirrors the engine. */
    activeBranches: ActiveBranch[];
    /**
     * Derived, back-compat: the sole active node's id when exactly one branch is active, else `''`
     * (empty) when zero or multiple branches are active. Keeps existing single-path consumers working.
     */
    currentNodeId: string;
    /** Branch ids currently parked on a blocking node, awaiting a mock (not runnable). */
    parkedBranchIds: string[];
    /** Arrived incoming-edge ids per join node, awaiting the remaining branches. */
    joinArrivals: Record<string, string[]>;
    /** The evolving instance context (start context plus merged mock outputs). */
    context: Record<string, unknown>;
    /** Nodes entered so far, in order (may contain repeats for loops / multiple branches). */
    visitedNodeIds: string[];
    /** History entries, shaped like a real {@code WorkflowInstance} history (branch-attributed). */
    history: HistoryEntry[];
    /** Last routing evaluation per edge id, for the canvas overlay. */
    edgeEvaluations: Record<string, EdgeEvaluation>;
    /** Derived, back-compat: the first parked branch's node/kind when `status === 'blocked'`. */
    blockedOn?: { nodeId: string; kind: NodeType };
    /** Set when `status === 'failed'`. */
    error?: SimError;
    /** Number of transitions taken across all branches, for the loop guard. */
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

export function startSimulation(workflow: Workflow, context: Record<string, unknown>): SimState {
    const startNode = workflow.nodes.find(n => n.type === 'start');
    if (!startNode) {
        return {
            status: 'failed',
            activeBranches: [],
            currentNodeId: '',
            parkedBranchIds: [],
            joinArrivals: {},
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
        activeBranches: [{ branchId: 'root', nodeId: startNode.id }],
        currentNodeId: startNode.id,
        parkedBranchIds: [],
        joinArrivals: {},
        context: { ...context },
        visitedNodeIds: [startNode.id],
        history: [{ ...enterEntry(startNode), branchId: 'root' }],
        edgeEvaluations: {},
        transitions: 0,
    };
}

/**
 * Advances the simulation by a single step: picks the first runnable branch and resolves its outgoing
 * edge, moving it to (and entering) the target. When no branch is runnable the state quiesces to a
 * blocked/terminal status. A no-op when the simulation is not `running`.
 */
export function stepSimulation(workflow: Workflow, state: SimState): SimState {
    if (state.status !== 'running') {
        return state;
    }
    if (state.transitions >= MAX_TRANSITIONS) {
        return derive(workflow, fail(state, {
            message: `Exceeded transition limit (${MAX_TRANSITIONS}) — possible infinite loop`,
            nodeId: state.currentNodeId || undefined,
        }));
    }
    const branch = runnableBranch(workflow, state);
    if (!branch) {
        return quiesce(workflow, state);
    }
    const node = findNode(workflow, branch.nodeId);
    if (!node) {
        return derive(workflow, fail(state, {
            message: `Current node not found: ${branch.nodeId}`, nodeId: branch.nodeId,
        }));
    }

    // Resolve the single outgoing edge (fork handling is added in Task 5).
    let selection: EdgeSelection;
    try {
        selection = selectEdge(workflow, node, { context: state.context });
    } catch (e) {
        if (e instanceof EdgeConditionError) {
            return derive(workflow, {
                ...fail(state, { message: e.message, nodeId: node.id, edgeId: e.edgeId }),
                edgeEvaluations: mergeEvaluations(state.edgeEvaluations, e.evaluations),
            });
        }
        throw e;
    }
    const edgeEvaluations = mergeEvaluations(state.edgeEvaluations, selection.evaluations);
    if (!selection.edge) {
        return derive(workflow, {
            ...fail(state, {
                message: `No matching outgoing edge from node: ${node.name || node.id}`,
                nodeId: node.id,
            }),
            edgeEvaluations,
        });
    }

    const history = completeBranchEntry(state.history, branch.branchId, node.id);
    const moved = moveBranch(
        workflow,
        { ...state, history, edgeEvaluations, transitions: state.transitions + 1 },
        branch.branchId,
        selection.edge,
    );
    return quiesce(workflow, moved);
}

/**
 * Runs the simulation forward until it blocks, completes, or fails. A no-op when not `running`.
 */
export function runSimulation(workflow: Workflow, state: SimState): SimState {
    let current = state;
    while (current.status === 'running') {
        const next = stepSimulation(workflow, current);
        if (next === current) {
            break;
        }
        current = next;
    }
    return current;
}

/**
 * Delivers a mock output/event to a parked (blocking) branch, merges any output into context (as a
 * real node would), and marks that branch runnable so the next step routes it onward. When `nodeId`
 * is given the matching parked branch is targeted; otherwise the first parked branch is resumed. A
 * no-op unless the simulation is `blocked`.
 */
export function resumeSimulation(
    workflow: Workflow,
    state: SimState,
    mock: SimMock,
    nodeId?: string,
): SimState {
    if (state.status !== 'blocked') {
        return state;
    }
    const parked = state.activeBranches.filter(b => state.parkedBranchIds.includes(b.branchId));
    const target = nodeId ? parked.find(b => b.nodeId === nodeId) : parked[0];
    if (!target) {
        return state;
    }
    const output = mock.output ?? {};
    const context = { ...state.context, ...output };
    const history = recordOutputOnBranch(state.history, target.branchId, target.nodeId, output);
    const parkedBranchIds = state.parkedBranchIds.filter(id => id !== target.branchId);
    return derive(workflow, { ...state, status: 'running', context, history, parkedBranchIds });
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

/** @returns the first branch that is runnable (not parked, not sitting on an end node), or undefined. */
function runnableBranch(workflow: Workflow, state: SimState): ActiveBranch | undefined {
    return state.activeBranches.find(b =>
        !state.parkedBranchIds.includes(b.branchId) && findNode(workflow, b.nodeId)?.type !== 'end');
}

/**
 * Moves a branch across a single edge to its target and enters it. (Join synchronization is added in
 * Task 5.)
 */
function moveBranch(
    workflow: Workflow,
    state: SimState,
    branchId: string,
    edge: WorkflowEdge,
): SimState {
    const target = findNode(workflow, edge.target);
    if (!target) {
        return fail(state, { message: `Edge target not found: ${edge.target}`, edgeId: edge.id });
    }
    const activeBranches = state.activeBranches
        .filter(b => b.branchId !== branchId)
        .concat({ branchId, nodeId: target.id });
    return enterNode({ ...state, activeBranches }, workflow, branchId, target, edge);
}

/** Applies the type-specific behavior when a branch enters a node, recording branch-attributed history. */
function enterNode(
    state: SimState,
    workflow: Workflow,
    branchId: string,
    node: WorkflowNode,
    viaEdge?: WorkflowEdge,
): SimState {
    void workflow;
    const history = state.history.concat({ ...enterEntry(node, viaEdge), branchId });
    const visitedNodeIds = [...state.visitedNodeIds, node.id];
    const base: SimState = { ...state, history, visitedNodeIds };

    if (node.type === 'end') {
        // END completes the whole run and cancels siblings. Keep the end node as the terminal
        // `currentNodeId` (branches are cleared, so `derive` preserves it for terminal states).
        return {
            ...base,
            status: 'completed',
            currentNodeId: node.id,
            history: completeBranchEntry(base.history, branchId, node.id),
            activeBranches: [],
            parkedBranchIds: [],
            joinArrivals: {},
        };
    }
    if (node.type === 'start') {
        return fail(base, { message: 'Cannot transition to a start node', nodeId: node.id });
    }
    if (BLOCKING_KINDS.has(node.type)) {
        return { ...base, parkedBranchIds: [...base.parkedBranchIds, branchId] };
    }
    // 'wait' — routable in the simulation; the branch stays runnable and the next step routes it.
    return base;
}

/**
 * Derives the instance status once no branch is runnable: `blocked` when a branch is parked, a
 * defensive `failed` on an empty non-terminal state, otherwise `running`. Always recomputes the
 * derived `currentNodeId`/`blockedOn`.
 */
function quiesce(workflow: Workflow, state: SimState): SimState {
    if (state.status !== 'running') {
        return derive(workflow, state);
    }
    if (runnableBranch(workflow, state)) {
        return derive(workflow, state);
    }
    if (state.activeBranches.length === 0) {
        return derive(workflow, fail(state, {
            message: 'No active branches and the simulation did not complete (parallel deadlock)',
        }));
    }
    return derive(workflow, { ...state, status: 'blocked' });
}

/**
 * Recomputes the derived back-compat fields (`currentNodeId`, `blockedOn`) from the branch set. During
 * a live run (`running`/`blocked`) `currentNodeId` is the sole active node or `''` (when 0 or ≥2
 * branches are active). At a terminal state (`completed`/`failed`) the branch set is empty, so the
 * terminal/failing node id already on the state is preserved (existing tests assert it).
 */
function derive(workflow: Workflow, state: SimState): SimState {
    let currentNodeId = state.currentNodeId;
    if (state.status === 'running' || state.status === 'blocked') {
        currentNodeId = state.activeBranches.length === 1 ? state.activeBranches[0].nodeId : '';
    }
    let blockedOn: SimState['blockedOn'];
    if (state.status === 'blocked') {
        const firstParked = state.activeBranches.find(b => state.parkedBranchIds.includes(b.branchId));
        const node = firstParked ? findNode(workflow, firstParked.nodeId) : undefined;
        if (node) {
            blockedOn = { nodeId: node.id, kind: node.type };
        }
    }
    return { ...state, currentNodeId, blockedOn };
}

/** Marks the open (not-yet-completed) history entry for `(branchId, nodeId)` completed. */
function completeBranchEntry(history: HistoryEntry[], branchId: string, nodeId: string): HistoryEntry[] {
    const copy = history.slice();
    for (let i = copy.length - 1; i >= 0; i--) {
        const e = copy[i];
        if (e.branchId === branchId && e.nodeId === nodeId && !e.completedOn) {
            copy[i] = { ...e, completedOn: new Date().toISOString() };
            return copy;
        }
    }
    return copy;
}

/** Records the produced output on the open history entry for `(branchId, nodeId)`. */
function recordOutputOnBranch(
    history: HistoryEntry[],
    branchId: string,
    nodeId: string,
    output: Record<string, unknown>,
): HistoryEntry[] {
    const copy = history.slice();
    for (let i = copy.length - 1; i >= 0; i--) {
        const e = copy[i];
        if (e.branchId === branchId && e.nodeId === nodeId && !e.completedOn) {
            copy[i] = { ...e, output: { ...(e.output ?? {}), ...output } };
            return copy;
        }
    }
    return copy;
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
