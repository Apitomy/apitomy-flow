import { describe, it, expect } from 'vitest';
import { validateWorkflow } from './validateWorkflow.ts';
import { normalizeWorkflow } from './workflowShape.ts';
import { type Workflow, type WorkflowNode, type WorkflowEdge } from '../types/workflow.ts';
import { analyzeParallelRegions } from '../simulation/parallelRegions.ts';
import { startSimulation, resumeSimulation, runSimulation } from '../simulation/simulate.ts';
import { TIMEOUT_HANDLE, toReactFlowEdges, toWorkflowEdges } from '../utils/conversion.ts';
import { createEditorState, editorReducer } from '../hooks/editorState.ts';
import { diffWorkflows } from '../diff/workflowDiff.ts';

function node(id: string, type: WorkflowNode['type'], config: Record<string, unknown> = {}): WorkflowNode {
  return { id, type, name: id, config, position: { x: 0, y: 0 } } as WorkflowNode;
}

function edge(id: string, source: string, target: string, opts: Partial<WorkflowEdge> = {}): WorkflowEdge {
  return { id, source, target, priority: 0, isDefault: false, ...opts };
}

/** start → recv(timeout) → done | timeout → expired */
function timeoutWorkflow(timeout: string, edges?: WorkflowEdge[]): Workflow {
  return {
    id: 'w', name: 'W',
    nodes: [node('start', 'start', { inputs: [] }), node('recv', 'receive-event', { eventType: 'payment', timeout }),
      node('done', 'end'), node('expired', 'end')],
    edges: edges ?? [edge('e1', 'start', 'recv'), edge('e2', 'recv', 'done'),
      edge('t1', 'recv', 'expired', { isTimeout: true })],
  };
}

const codes = (w: Workflow) => validateWorkflow(w).map(p => p.code);

describe('receive-event timeout validation', () => {
  it('accepts a positive timeout with exactly one timeout edge', () => {
    expect(codes(timeoutWorkflow('PT1H')).filter(c => c.includes('TIMEOUT'))).toEqual([]);
  });

  it.each(['PT0S', 'P0D', '-PT1M', 'P1M', 'soon'])('rejects invalid or non-positive timeout %s', bad => {
    expect(codes(timeoutWorkflow(bad))).toContain('INVALID_RECEIVE_EVENT_TIMEOUT');
  });

  it('requires exactly one timeout edge and a normal edge', () => {
    expect(codes(timeoutWorkflow('PT1H', [edge('e1', 'start', 'recv'), edge('e2', 'recv', 'done')])))
      .toContain('MISSING_TIMEOUT_EDGE');
    expect(codes(timeoutWorkflow('PT1H', [edge('e1', 'start', 'recv'), edge('e2', 'recv', 'done'),
      edge('t1', 'recv', 'expired', { isTimeout: true }), edge('t2', 'recv', 'done', { isTimeout: true })])))
      .toContain('MULTIPLE_TIMEOUT_EDGES');
    expect(codes(timeoutWorkflow('PT1H', [edge('e1', 'start', 'recv'),
      edge('t1', 'recv', 'expired', { isTimeout: true })]))).toContain('MISSING_EVENT_EDGE');
  });

  it('rejects timeout edges from nodes without a timeout', () => {
    const w = timeoutWorkflow('PT1H');
    w.edges.push(edge('t9', 'start', 'expired', { isTimeout: true }));
    expect(codes(w)).toContain('INVALID_TIMEOUT_EDGE');
  });

  it('shape-checks timeout and isTimeout types', () => {
    const raw = JSON.parse(JSON.stringify(timeoutWorkflow('PT1H')));
    raw.nodes[1].config.timeout = 5;
    raw.edges[2].isTimeout = 'yes';
    const result = normalizeWorkflow(raw);
    expect(result.problems.map(p => p.code)).toEqual(
      expect.arrayContaining(['INVALID_RECEIVE_EVENT_TIMEOUT', 'INVALID_EDGE_TIMEOUT']));
  });
});

describe('receive-event timeout routing', () => {
  it('is not a fork', () => {
    const regions = analyzeParallelRegions(timeoutWorkflow('PT1H'));
    expect(regions.isFork('recv')).toBe(false);
    expect(regions.problems).toEqual([]);
  });

  it('simulation follows the normal edge on event delivery', () => {
    const w = timeoutWorkflow('PT1H');
    const blocked = runSimulation(w, startSimulation(w, {}));
    expect(blocked.status).toBe('blocked');
    const done = runSimulation(w, resumeSimulation(w, blocked, { output: {} }, 'recv'));
    expect(done.status).toBe('completed');
    expect(done.history.map(h => h.nodeId)).toContain('done');
    expect(done.history.map(h => h.nodeId)).not.toContain('expired');
  });
});

describe('receive-event timeout editing', () => {
  it('round-trips isTimeout through the canvas via the timeout handle', () => {
    const edges = timeoutWorkflow('PT1H').edges;
    const canvas = toReactFlowEdges(edges);
    expect(canvas[2].sourceHandle).toBe(TIMEOUT_HANDLE);
    expect(canvas[1].sourceHandle).toBeUndefined();
    expect(toWorkflowEdges(canvas)).toEqual(edges);
  });

  it('connecting from the timeout handle creates a timeout edge', () => {
    const w = timeoutWorkflow('PT1H', [edge('e1', 'start', 'recv'), edge('e2', 'recv', 'done')]);
    const state = editorReducer(createEditorState(w), { type: 'connect', id: 'tNew', connection: {
      source: 'recv', target: 'expired', sourceHandle: TIMEOUT_HANDLE, targetHandle: null,
    } });
    expect(state.document.edges.find(e => e.id === 'tNew')).toMatchObject({ isTimeout: true });
    const normal = editorReducer(createEditorState(w), { type: 'connect', id: 'n', connection: {
      source: 'recv', target: 'expired', sourceHandle: null, targetHandle: null,
    } });
    expect(normal.document.edges.find(e => e.id === 'n')?.isTimeout).toBeUndefined();
  });

  it('diff reports isTimeout changes', () => {
    const base = timeoutWorkflow('PT1H');
    const compare = structuredClone(base);
    compare.edges[2] = { ...compare.edges[2], isTimeout: false };
    const result = diffWorkflows(base, compare);
    expect(result.edges.t1?.changes).toContain('isTimeout');
  });
});
