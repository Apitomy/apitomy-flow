import { type HistoryEntry } from '../types/instance.ts';

/**
 * Returns all history entries for the given node, in the order they occur in
 * the instance history (chronological). Returns an empty array when the node
 * was never visited or when {@link nodeId} is null.
 *
 * @param history the full instance history
 * @param nodeId the id of the node whose visits should be collected
 * @returns the node's visits in chronological order (possibly empty)
 */
export function nodeVisits(history: HistoryEntry[], nodeId: string | null): HistoryEntry[] {
  if (!nodeId) return [];
  return history.filter(h => h.nodeId === nodeId);
}

/** A node's visits within a single branch. */
export interface NodeBranchVisits {
  branchId: string;
  visits: HistoryEntry[];
}

/**
 * Groups a node's visits by branch, so a node reached concurrently (or repeatedly) across parallel
 * branches can be shown per-branch. Branches appear in the order they are first seen in the history.
 * A visit whose {@link HistoryEntry.branchId} is absent is attributed to the root branch.
 *
 * @param history the full instance history
 * @param nodeId the id of the node whose visits should be grouped
 * @returns one group per branch that visited the node (empty when never visited or nodeId is null)
 */
export function nodeVisitsByBranch(history: HistoryEntry[], nodeId: string | null): NodeBranchVisits[] {
  if (!nodeId) return [];
  const order: string[] = [];
  const byBranch = new Map<string, HistoryEntry[]>();
  for (const entry of history) {
    if (entry.nodeId !== nodeId) continue;
    const branchId = entry.branchId ?? 'root';
    let visits = byBranch.get(branchId);
    if (!visits) {
      visits = [];
      byBranch.set(branchId, visits);
      order.push(branchId);
    }
    visits.push(entry);
  }
  return order.map(branchId => ({ branchId, visits: byBranch.get(branchId)! }));
}
