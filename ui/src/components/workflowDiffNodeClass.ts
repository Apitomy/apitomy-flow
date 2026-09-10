import { type DiffStatus } from '../diff/workflowDiffTypes.ts';

/**
 * Build CSS classes for a diff node based on its diff status.
 */
export function workflowDiffNodeClass(status: DiffStatus | undefined): string {
  const normalizedStatus = status ?? 'unchanged';
  return `flow-diff-node flow-diff-node--${normalizedStatus}`;
}
