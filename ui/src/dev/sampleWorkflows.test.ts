import { describe, expect, it } from 'vitest';
import {
  demoScenarios,
  parallelForkJoinWorkflow,
  parallelForkJoinInstance,
  loopWorkflow,
  loopWorkflowInstance,
} from './sampleWorkflows.ts';

describe('demo scenarios', () => {
  it('includes the new parallel and loop examples', () => {
    const keys = demoScenarios.map((scenario) => scenario.key);
    expect(keys).toContain('parallel-fork-join');
    expect(keys).toContain('loop-review');
  });

  it('keeps each representative instance aligned to its workflow id', () => {
    for (const scenario of demoScenarios) {
      expect(scenario.instance.workflowId).toBe(scenario.workflow.id);
    }
  });

  it('parallel example demonstrates multiple active branches', () => {
    expect(parallelForkJoinInstance.currentNodeId).toBeNull();
    expect(parallelForkJoinInstance.activeBranches).toHaveLength(2);
  });

  it('loop example includes repeated visits to the review node', () => {
    const reviewVisits = loopWorkflowInstance.history.filter((entry) => entry.nodeId === 'review');
    expect(reviewVisits).toHaveLength(2);
    expect(loopWorkflow.edges.some((edge) => edge.source === 'revise' && edge.target === 'review')).toBe(true);
  });

  it('exports concrete workflow fixtures for direct use', () => {
    expect(parallelForkJoinWorkflow.id).toBe('parallel-fork-join');
    expect(loopWorkflow.id).toBe('loop-review');
  });
});
