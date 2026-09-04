import { type Workflow, type WorkflowEdge } from '../types/workflow.ts';

/** A structural problem discovered during parallel-region analysis. */
export interface ParallelProblem {
    code: string;
    nodeId: string;
}

/**
 * Result of static parallel-region analysis: fork/join classification plus any structural problems.
 * Mirrors the Java {@code io.apitomy.flow.engine.ParallelRegions} so the validator and the simulation
 * agree on what a fork is, what its join is, and what a well-formed region looks like. Pure and
 * side-effect free.
 */
export interface ParallelAnalysis {
    /** @returns true if the node is a fork (≥2 outgoing edges, all unconditional and non-default). */
    isFork(nodeId: string): boolean;
    /** @returns true if the node is the synchronizing join of some fork. */
    isJoin(nodeId: string): boolean;
    /** @returns the join node id paired with the given fork, or undefined if none. */
    joinFor(forkNodeId: string): string | undefined;
    /** @returns a fresh copy of the incoming edge ids a join must collect before it fires. */
    incomingEdgeIds(joinNodeId: string): Set<string>;
    /** The structural problems discovered during analysis. */
    problems: ParallelProblem[];
}

function isUnconditional(e: WorkflowEdge): boolean {
    return !e.condition || e.condition.trim() === '';
}

function outgoing(workflow: Workflow, nodeId: string): WorkflowEdge[] {
    return workflow.edges.filter(e => e.source === nodeId);
}

function isEndNode(workflow: Workflow, nodeId: string): boolean {
    return workflow.nodes.find(n => n.id === nodeId)?.type === 'end';
}

/**
 * Analyzes a workflow's parallel structure.
 *
 * @param workflow the workflow to analyze
 * @returns the computed regions and any structural problems
 */
export function analyzeParallelRegions(workflow: Workflow): ParallelAnalysis {
    const forks = new Set<string>();
    const joins = new Set<string>();
    const forkToJoin = new Map<string, string>();
    const joinIncoming = new Map<string, Set<string>>();
    const problems: ParallelProblem[] = [];

    for (const node of workflow.nodes) {
        const out = outgoing(workflow, node.id);
        if (out.length < 2) {
            continue;
        }
        const anyForkShaped = out.some(e => isUnconditional(e) && !e.isDefault);
        const allForkShaped = out.every(e => isUnconditional(e) && !e.isDefault);
        if (allForkShaped) {
            forks.add(node.id);
        } else if (anyForkShaped) {
            problems.push({ code: 'MIXED_FORK_EDGES', nodeId: node.id });
        }
    }

    for (const forkId of forks) {
        const join = findJoin(workflow, forkId, problems);
        if (join !== null) {
            forkToJoin.set(forkId, join);
            joins.add(join);
            const incoming = new Set<string>();
            for (const e of workflow.edges) {
                if (e.target === join) {
                    incoming.add(e.id);
                }
            }
            joinIncoming.set(join, incoming);
        }
    }

    return {
        isFork: (nodeId) => forks.has(nodeId),
        isJoin: (nodeId) => joins.has(nodeId),
        joinFor: (forkNodeId) => forkToJoin.get(forkNodeId),
        incomingEdgeIds: (joinNodeId) => new Set(joinIncoming.get(joinNodeId) ?? []),
        problems,
    };
}

/**
 * Finds the synchronizing join for a fork: the earliest node where every branch leaving the fork
 * re-converges. Records FORK_WITHOUT_JOIN / PARALLEL_BRANCH_REACHES_END when no single balanced
 * convergence node exists. Mirrors {@code ParallelRegions.findJoin}.
 */
function findJoin(workflow: Workflow, forkId: string, problems: ParallelProblem[]): string | null {
    const branches = outgoing(workflow, forkId);
    const reachablePerBranch: Set<string>[] = [];
    let anyBranchReachesEnd = false;

    for (const branch of branches) {
        const reachable = new Set<string>();
        const queue: string[] = [branch.target];
        while (queue.length > 0) {
            const current = queue.shift() as string;
            if (reachable.has(current)) {
                continue;
            }
            reachable.add(current);
            if (isEndNode(workflow, current)) {
                anyBranchReachesEnd = true;
            }
            for (const out of outgoing(workflow, current)) {
                queue.push(out.target);
            }
        }
        reachablePerBranch.push(reachable);
    }

    // The join is the earliest node reachable from ALL branches.
    let common = new Set<string>(reachablePerBranch[0]);
    for (let i = 1; i < reachablePerBranch.length; i++) {
        common = new Set([...common].filter(n => reachablePerBranch[i].has(n)));
    }
    if (common.size === 0) {
        problems.push({
            code: anyBranchReachesEnd ? 'PARALLEL_BRANCH_REACHES_END' : 'FORK_WITHOUT_JOIN',
            nodeId: forkId,
        });
        return null;
    }

    // Earliest common node, using branch[0]'s BFS insertion order as the canonical ordering.
    let join: string | null = null;
    for (const candidate of reachablePerBranch[0]) {
        if (common.has(candidate)) {
            join = candidate;
            break;
        }
    }
    if (join === null) {
        join = common.values().next().value as string;
    }

    // Balance: every branch must reach the join without first hitting END.
    for (const branch of branches) {
        if (reachesEndBeforeJoin(workflow, branch.target, join)) {
            problems.push({ code: 'PARALLEL_BRANCH_REACHES_END', nodeId: forkId });
            return null;
        }
    }
    return join;
}

function reachesEndBeforeJoin(workflow: Workflow, start: string, join: string): boolean {
    const visited = new Set<string>();
    const queue: string[] = [start];
    while (queue.length > 0) {
        const current = queue.shift() as string;
        if (current === join || visited.has(current)) {
            continue;
        }
        visited.add(current);
        if (isEndNode(workflow, current)) {
            return true;
        }
        for (const out of outgoing(workflow, current)) {
            queue.push(out.target);
        }
    }
    return false;
}
