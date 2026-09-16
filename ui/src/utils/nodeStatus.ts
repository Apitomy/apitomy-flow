import { type InstanceStatus } from '../types/instance.ts';

/** Status keys used as the `workflow-viewer__status--<key>` CSS modifier for the node status badge. */
export type NodeStatusKey = 'waiting' | 'completed' | 'failed' | 'cancelled' | 'not-reached';

export interface NodeStatusBadge {
  key: NodeStatusKey;
  label: string;
}

/**
 * Computes the badge (key + label) for a node's "Status" field in the Viewer's detail panel.
 *
 * @param isCurrentVisit whether the visit being displayed is the instance's current, in-progress visit
 * @param wasVisited whether the node has been reached at least once
 * @param instanceStatus the workflow instance's overall status
 * @return the status key (used to pick a badge color) and its display label
 */
export function getNodeStatusBadge({ isCurrentVisit, wasVisited, instanceStatus }: {
  isCurrentVisit: boolean;
  wasVisited: boolean;
  instanceStatus: InstanceStatus;
}): NodeStatusBadge {
  if (isCurrentVisit) {
    if (instanceStatus === 'completed') return { key: 'completed', label: 'Completed' };
    if (instanceStatus === 'failed') return { key: 'failed', label: 'Failed' };
    if (instanceStatus === 'cancelled') return { key: 'cancelled', label: 'Cancelled' };
    return { key: 'waiting', label: 'Current (waiting)' };
  }
  if (wasVisited) return { key: 'completed', label: 'Completed' };
  return { key: 'not-reached', label: 'Not yet reached' };
}
