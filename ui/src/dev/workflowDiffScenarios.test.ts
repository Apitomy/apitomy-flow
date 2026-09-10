import { describe, it, expect } from 'vitest';
import { workflowDiffScenarios } from './workflowDiffScenarios.ts';

function hasDirectedCycle(nodeIds: string[], edges: Array<{ source: string; target: string }>): boolean {
  const adjacency = new Map<string, string[]>();
  const indegree = new Map<string, number>();

  for (const nodeId of nodeIds) {
    adjacency.set(nodeId, []);
    indegree.set(nodeId, 0);
  }

  for (const edge of edges) {
    if (!adjacency.has(edge.source) || !adjacency.has(edge.target)) {
      continue;
    }
    adjacency.get(edge.source)!.push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }

  const queue: string[] = [...indegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([nodeId]) => nodeId);

  let visited = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    visited += 1;
    for (const next of adjacency.get(current) ?? []) {
      const degree = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, degree);
      if (degree === 0) {
        queue.push(next);
      }
    }
  }

  return visited !== nodeIds.length;
}

describe('workflowDiffScenarios', () => {
  it('contains at least four diff scenarios including two extensive revisions', () => {
    expect(workflowDiffScenarios.length).toBeGreaterThanOrEqual(4);
    expect(workflowDiffScenarios.some((scenario) => scenario.key === 'linear-major-revision')).toBe(true);
    expect(workflowDiffScenarios.some((scenario) => scenario.key === 'fork-join-major-revision')).toBe(true);
  });

  it('includes valid base/compare workflows for each scenario', () => {
    for (const scenario of workflowDiffScenarios) {
      expect(scenario.baseWorkflow.nodes.length).toBeGreaterThan(0);
      expect(scenario.compareWorkflow.nodes.length).toBeGreaterThan(0);
    }
  });

  it('keeps new major revision scenarios acyclic (no loops)', () => {
    const keys = new Set(['linear-major-revision', 'fork-join-major-revision']);
    const targets = workflowDiffScenarios.filter((scenario) => keys.has(scenario.key));
    expect(targets).toHaveLength(2);

    for (const scenario of targets) {
      const baseNodeIds = scenario.baseWorkflow.nodes.map((node) => node.id);
      const compareNodeIds = scenario.compareWorkflow.nodes.map((node) => node.id);
      expect(hasDirectedCycle(baseNodeIds, scenario.baseWorkflow.edges)).toBe(false);
      expect(hasDirectedCycle(compareNodeIds, scenario.compareWorkflow.edges)).toBe(false);
    }
  });
});
