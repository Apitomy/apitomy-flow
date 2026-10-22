import { describe, it, expect } from 'vitest';
import { getNodeStatusBadge } from './nodeStatus.ts';

describe('getNodeStatusBadge', () => {
  it('reflects the instance status when the node is the current visit', () => {
    expect(getNodeStatusBadge({ isCurrentVisit: true, wasVisited: true, instanceStatus: 'completed' }))
      .toEqual({ key: 'completed', label: 'Completed' });
    expect(getNodeStatusBadge({ isCurrentVisit: true, wasVisited: true, instanceStatus: 'failed' }))
      .toEqual({ key: 'failed', label: 'Failed' });
    expect(getNodeStatusBadge({ isCurrentVisit: true, wasVisited: true, instanceStatus: 'cancelled' }))
      .toEqual({ key: 'cancelled', label: 'Cancelled' });
    expect(getNodeStatusBadge({ isCurrentVisit: true, wasVisited: true, instanceStatus: 'running' }))
      .toEqual({ key: 'waiting', label: 'Current (waiting)' });
    expect(getNodeStatusBadge({ isCurrentVisit: true, wasVisited: true, instanceStatus: 'waiting' }))
      .toEqual({ key: 'waiting', label: 'Current (waiting)' });
  });

  it('is "Completed" for a past (non-current) visit that was reached', () => {
    expect(getNodeStatusBadge({ isCurrentVisit: false, wasVisited: true, instanceStatus: 'running' }))
      .toEqual({ key: 'completed', label: 'Completed' });
  });

  it('is "Not yet reached" for a node that has no history at all', () => {
    expect(getNodeStatusBadge({ isCurrentVisit: false, wasVisited: false, instanceStatus: 'running' }))
      .toEqual({ key: 'not-reached', label: 'Not yet reached' });
  });

  it('reports a scheduled retry for the current visit', () => {
    expect(getNodeStatusBadge({ isCurrentVisit: true, wasVisited: true, instanceStatus: 'waiting',
      pendingRetry: { attempt: 2, maxAttempts: 5, retryAt: '2026-10-21T10:00:30Z' } }))
      .toEqual({ key: 'waiting', label: 'Retry 2/5 scheduled at 2026-10-21T10:00:30Z' });
    expect(getNodeStatusBadge({ isCurrentVisit: true, wasVisited: true, instanceStatus: 'waiting',
      pendingRetry: { attempt: 2, retryAt: '2026-10-21T10:00:30Z' } }).label)
      .toBe('Retry 2 scheduled at 2026-10-21T10:00:30Z');
  });
});
