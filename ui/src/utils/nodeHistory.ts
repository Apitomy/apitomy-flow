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
