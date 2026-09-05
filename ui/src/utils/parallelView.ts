import { type ActiveBranch, type HistoryEntry } from '../types/instance.ts';
import { type NodeType } from '../types/workflow.ts';

/** A branch parked on a blocking node, with the node kind resolved for display. */
export interface ParkedNode {
  nodeId: string;
  kind: NodeType;
  branchId: string;
}

/** The ordered node path taken by a single branch. */
export interface BranchPath {
  branchId: string;
  nodeIds: string[];
}

/** Inputs for {@link simNodeClass}. */
export interface SimNodeClassOpts {
  /** Node ids of currently-active (runnable) branches. */
  activeIds: Set<string>;
  /** Node ids of parked (blocked) branches. */
  parkedIds: Set<string>;
  /** Node ids visited at any point in the run. */
  visited: ReadonlySet<string>;
  /** The failing node id when the run has failed; omitted otherwise. */
  failedNodeId?: string;
}

/** The branch id an entry belongs to, treating a missing value as the root branch. */
function entryBranchId(entry: HistoryEntry): string {
  return entry.branchId ?? 'root';
}

/**
 * The set of node ids where branches currently sit.
 *
 * @param branches the live branch tokens
 * @param parkedBranchIds branch ids to exclude (parked/blocked); omit to include every branch
 * @returns a set of node ids (never null)
 */
export function activeNodeIds(
  branches: ActiveBranch[],
  parkedBranchIds?: readonly string[],
): Set<string> {
  const parked = parkedBranchIds ? new Set(parkedBranchIds) : undefined;
  const ids = new Set<string>();
  for (const branch of branches) {
    if (parked && parked.has(branch.branchId)) continue;
    ids.add(branch.nodeId);
  }
  return ids;
}

/**
 * The set of arrival edge ids for the currently-active branches: for each branch, the edge id of the
 * most recent history entry matching that branch and its current node.
 *
 * @param branches the live branch tokens
 * @param history the full, branch-attributed history
 * @returns a set of edge ids (branches with no arrival edge, e.g. the start node, contribute nothing)
 */
export function activeEdgeIds(branches: ActiveBranch[], history: HistoryEntry[]): Set<string> {
  const edges = new Set<string>();
  for (const branch of branches) {
    let arrivalEdgeId: string | undefined;
    for (const entry of history) {
      if (entry.nodeId === branch.nodeId && entryBranchId(entry) === branch.branchId && entry.edgeId) {
        arrivalEdgeId = entry.edgeId;
      }
    }
    if (arrivalEdgeId) edges.add(arrivalEdgeId);
  }
  return edges;
}

/**
 * Resolves the parked (blocked) branches to displayable {@link ParkedNode}s.
 *
 * @param branches the live branch tokens
 * @param parkedBranchIds branch ids that are parked on a blocking node
 * @param nodeType resolves a node id to its type (undefined when the node is unknown)
 * @returns one entry per parked branch whose node type resolves, in branch order
 */
export function parkedNodes(
  branches: ActiveBranch[],
  parkedBranchIds: readonly string[],
  nodeType: (nodeId: string) => NodeType | undefined,
): ParkedNode[] {
  const parked = new Set(parkedBranchIds);
  const result: ParkedNode[] = [];
  for (const branch of branches) {
    if (!parked.has(branch.branchId)) continue;
    const kind = nodeType(branch.nodeId);
    if (!kind) continue;
    result.push({ nodeId: branch.nodeId, kind, branchId: branch.branchId });
  }
  return result;
}

/**
 * Groups a branch-attributed history into per-branch ordered paths.
 *
 * @param history the full, branch-attributed history
 * @returns one {@link BranchPath} per branch, in the order each branch first appears
 */
export function branchPaths(history: HistoryEntry[]): BranchPath[] {
  const order: string[] = [];
  const byBranch = new Map<string, string[]>();
  for (const entry of history) {
    const branchId = entryBranchId(entry);
    let nodeIds = byBranch.get(branchId);
    if (!nodeIds) {
      nodeIds = [];
      byBranch.set(branchId, nodeIds);
      order.push(branchId);
    }
    nodeIds.push(entry.nodeId);
  }
  return order.map(branchId => ({ branchId, nodeIds: byBranch.get(branchId)! }));
}

/**
 * The simulation overlay CSS class for a node, given the multi-branch run state. Precedence:
 * failed > blocked (parked) > current (active) > visited > idle.
 *
 * @param nodeId the node to classify
 * @param opts the active/parked/visited sets and optional failing node id
 * @returns one of `flow-sim-node-{failed,blocked,current,visited,idle}`
 */
export function simNodeClass(nodeId: string, opts: SimNodeClassOpts): string {
  if (opts.failedNodeId && nodeId === opts.failedNodeId) return 'flow-sim-node-failed';
  if (opts.parkedIds.has(nodeId)) return 'flow-sim-node-blocked';
  if (opts.activeIds.has(nodeId)) return 'flow-sim-node-current';
  return opts.visited.has(nodeId) ? 'flow-sim-node-visited' : 'flow-sim-node-idle';
}
