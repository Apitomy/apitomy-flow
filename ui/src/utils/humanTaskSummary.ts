import type { HistoryEntry } from '../types/instance.ts';
import type { WorkflowNode } from '../types/workflow.ts';

/** The task summary shown on a human-task node's State tab in the viewer. */
export interface HumanTaskSummary {
  /** The title computed for the selected visit; absent when the node has not been visited. */
  title?: string;
  /** The node's authored description; absent when blank. */
  description?: string;
}

/**
 * Builds the task summary for a human-task node's State tab. The title is the one recorded on the
 * selected visit; history recorded before titles existed falls back to the node name, which is what a host
 * would have shown then. Other node types have no summary.
 *
 * @param node the node being shown
 * @param history the selected visit, or `null` when the node was not visited
 * @return the summary, or `null` for non-human-task nodes
 */
export function humanTaskSummary(node: WorkflowNode, history: HistoryEntry | null): HumanTaskSummary | null {
  if (node.type !== 'human-task') return null;
  const description = typeof node.config.description === 'string' && node.config.description.trim()
    ? node.config.description : undefined;
  return {
    ...(history ? { title: history.title ?? node.name } : {}),
    ...(description ? { description } : {}),
  };
}
