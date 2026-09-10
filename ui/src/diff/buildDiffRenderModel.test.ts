import { describe, it, expect } from 'vitest';
import { type Workflow } from '../types/workflow.ts';
import { diffWorkflows } from './workflowDiff.ts';
import { buildDiffRenderModel } from './buildDiffRenderModel.ts';

function makeWorkflow(nodes: Workflow['nodes'], edges: Workflow['edges']): Workflow {
  return { id: 'wf', name: 'WF', nodes, edges };
}

describe('buildDiffRenderModel', () => {
  it('uses compare position when both versions contain the node', () => {
    const base = makeWorkflow(
      [{ id: 'a', type: 'action', name: 'A', config: {}, position: { x: 1, y: 1 } }],
      [],
    );
    const compare = makeWorkflow(
      [{ id: 'a', type: 'action', name: 'A', config: {}, position: { x: 9, y: 9 } }],
      [],
    );

    const diff = diffWorkflows(base, compare);
    const model = buildDiffRenderModel(base, compare, diff);

    expect(model.nodes[0].position).toEqual({ x: 9, y: 9 });
  });

  it('keeps removed nodes in the render model using base coordinates', () => {
    const base = makeWorkflow(
      [{ id: 'gone', type: 'action', name: 'Gone', config: {}, position: { x: 4, y: 2 } }],
      [],
    );
    const compare = makeWorkflow([], []);

    const diff = diffWorkflows(base, compare);
    const model = buildDiffRenderModel(base, compare, diff);

    expect(model.nodes.map((node) => node.id)).toContain('gone');
    expect(model.nodes.find((node) => node.id === 'gone')?.position).toEqual({ x: 4, y: 2 });
  });

  it('includes union of edges by id', () => {
    const base = makeWorkflow(
      [{ id: 'a', type: 'start', name: 'A', config: {}, position: { x: 0, y: 0 } }],
      [{ id: 'e-removed', source: 'a', target: 'a', priority: 0, isDefault: true }],
    );
    const compare = makeWorkflow(
      [{ id: 'a', type: 'start', name: 'A', config: {}, position: { x: 0, y: 0 } }],
      [{ id: 'e-added', source: 'a', target: 'a', priority: 1, isDefault: false }],
    );

    const diff = diffWorkflows(base, compare);
    const model = buildDiffRenderModel(base, compare, diff);

    expect(model.edges.map((edge) => edge.id)).toEqual(expect.arrayContaining(['e-removed', 'e-added']));
  });
});
